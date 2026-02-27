"""
Endpoint batch para procesamiento de audio completo → llenado de campos Biowel.

POST /api/biowel/audio/process
- multipart/form-data:
    - audio_file: archivo de audio (WAV recomendado, acepta mp3/m4a/flac/ogg/webm)
    - fields: JSON string con array de campos [{data_testid, unique_key, label, field_type, options}]
    - already_filled: JSON string con dict {data_testid: value}
- response JSON:
    - transcript: string
    - filled_fields: dict {data_testid: value}
    - stats: {mapped_count, skipped_already_filled_count, total_fields}

CORS: ya configurado en main.py (allow_origins=["*"]).
DEEPGRAM_API_KEY: configurar en .env (se lee desde app.config).
"""

import json
import logging
from typing import Dict, List

from starlette.formparsers import MultiPartParser
# Aumentar límite de upload de 1MB (default) a 200MB para audios largos (5+ min)
MultiPartParser.max_file_size = 200 * 1024 * 1024  # 200 MB

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Request
from pydantic import BaseModel

from app.services.deepgram_batch import transcribe_audio
from app.services.biowel_batch_mapper import map_transcript_to_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/biowel", tags=["biowel-batch"])


class BatchProcessStats(BaseModel):
    mapped_count: int
    skipped_already_filled_count: int
    total_fields: int


class BatchProcessResponse(BaseModel):
    transcript: str
    filled_fields: Dict[str, str]
    stats: BatchProcessStats


# Límite de 200 MB para audios largos (5+ min en WAV pueden ser >50MB)
MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB


@router.post("/audio/process", response_model=BatchProcessResponse)
async def process_audio_batch(
    request: Request,
    audio_file: UploadFile = File(..., description="Archivo de audio (WAV recomendado)"),
    fields: str = Form(..., description="JSON array de campos Biowel"),
    already_filled: str = Form(default="{}", description="JSON dict de campos ya llenos"),
):
    """
    Procesa un archivo de audio completo en modo batch:
    1. Transcribe con Deepgram (pre-recorded)
    2. Mapea el transcript a campos Biowel por data-testid
    3. Retorna transcript + filled_fields + stats
    """
    # --- Validar audio ---
    if not audio_file.filename:
        raise HTTPException(status_code=400, detail="No se proporcionó archivo de audio")

    content_type = audio_file.content_type or "application/octet-stream"
    # Inferir mimetype por extensión si el content_type es genérico o video/*
    # (browsers/OS reportan .m4a como video/mp4)
    if content_type == "application/octet-stream" or content_type.startswith("video/"):
        ext = (audio_file.filename or "").rsplit(".", 1)[-1].lower()
        ext_to_mime = {
            "wav": "audio/wav",
            "mp3": "audio/mpeg",
            "m4a": "audio/mp4",
            "flac": "audio/flac",
            "ogg": "audio/ogg",
            "webm": "audio/webm",
        }
        content_type = ext_to_mime.get(ext, content_type)

    audio_bytes = await audio_file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío")

    logger.info(
        f"[Batch] Audio recibido: '{audio_file.filename}', "
        f"{len(audio_bytes)} bytes, mime={content_type}"
    )

    # --- Parsear fields ---
    try:
        fields_list: List[Dict] = json.loads(fields)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"El campo 'fields' no es JSON válido: {e}"
        )

    if not isinstance(fields_list, list):
        raise HTTPException(
            status_code=400,
            detail="El campo 'fields' debe ser un array JSON"
        )

    # --- Parsear already_filled ---
    try:
        already_filled_dict: Dict[str, str] = json.loads(already_filled)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"El campo 'already_filled' no es JSON válido: {e}"
        )

    if not isinstance(already_filled_dict, dict):
        raise HTTPException(
            status_code=400,
            detail="El campo 'already_filled' debe ser un dict JSON"
        )

    logger.info(
        f"[Batch] Fields: {len(fields_list)}, "
        f"Already filled: {len(already_filled_dict)}"
    )

    # --- 1. Transcribir ---
    try:
        transcript = await transcribe_audio(
            file_bytes=audio_bytes,
            mimetype=content_type,
            language="es",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not transcript:
        return BatchProcessResponse(
            transcript="",
            filled_fields={},
            stats=BatchProcessStats(
                mapped_count=0,
                skipped_already_filled_count=len(already_filled_dict),
                total_fields=len(fields_list),
            ),
        )

    # --- 2. Mapear ---
    filled_fields = map_transcript_to_fields(
        transcript=transcript,
        fields=fields_list,
        already_filled=already_filled_dict,
    )

    # --- 3. Stats ---
    stats = BatchProcessStats(
        mapped_count=len(filled_fields),
        skipped_already_filled_count=len(already_filled_dict),
        total_fields=len(fields_list),
    )

    logger.info(
        f"[Batch] Resultado: transcript={len(transcript)} chars, "
        f"filled={stats.mapped_count}, skipped={stats.skipped_already_filled_count}"
    )

    return BatchProcessResponse(
        transcript=transcript,
        filled_fields=filled_fields,
        stats=stats,
    )
