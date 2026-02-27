"""
Transcripción batch (pre-recorded) con Deepgram REST API.

Recibe bytes de audio + mimetype y retorna el transcript completo.
Usa la API pre-recorded de Deepgram (NO WebSocket).

DEEPGRAM_API_KEY se lee desde app.config (variable de entorno DEEPGRAM_API_KEY en .env).
"""

import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Deepgram pre-recorded endpoint
DEEPGRAM_PRERECORDED_URL = "https://api.deepgram.com/v1/listen"

# Mimetypes soportados por Deepgram
SUPPORTED_MIMETYPES = {
    "audio/wav", "audio/wave", "audio/x-wav",
    "audio/mpeg", "audio/mp3",
    "audio/mp4", "audio/m4a", "audio/x-m4a",
    "audio/flac", "audio/x-flac",
    "audio/ogg", "audio/webm",
    # Browsers/OS a veces reportan .m4a como video/mp4, .webm como video/webm
    "video/mp4", "video/webm",
}

# Normalizar video/* → audio/* para Deepgram
MIME_NORMALIZE = {
    "video/mp4": "audio/mp4",
    "video/webm": "audio/webm",
}


async def transcribe_audio(
    file_bytes: bytes,
    mimetype: str,
    language: str = "es",
) -> str:
    """
    Transcribe audio completo usando Deepgram pre-recorded API.

    Args:
        file_bytes: Bytes del archivo de audio.
        mimetype: MIME type del archivo (ej: "audio/wav").
        language: Idioma de transcripción (default: "es").

    Returns:
        Transcript completo como string.

    Raises:
        ValueError: Si el archivo está vacío o el formato no es soportado.
        RuntimeError: Si hay error de credenciales o de la API.
    """
    if not file_bytes:
        raise ValueError("El archivo de audio está vacío")

    # Normalizar mimetype
    mime_clean = mimetype.lower().split(";")[0].strip()
    # Normalizar video/* → audio/* (ej: .m4a reportado como video/mp4)
    mime_clean = MIME_NORMALIZE.get(mime_clean, mime_clean)
    if mime_clean not in SUPPORTED_MIMETYPES:
        raise ValueError(
            f"Formato de audio no soportado: '{mime_clean}'. "
            f"Formatos aceptados: WAV, MP3, M4A, FLAC, OGG, WEBM. "
            f"Recomendado: WAV PCM16 16kHz mono."
        )

    api_key = settings.deepgram_api_key
    if not api_key:
        raise RuntimeError("DEEPGRAM_API_KEY no configurada. Revisa el archivo .env")

    # Parámetros de transcripción
    params = {
        "model": settings.deepgram_model,
        "language": language,
        "punctuate": "true",
        "smart_format": "true",
        "utterances": "true",
        "paragraphs": "true",
    }

    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": mime_clean,
    }

    logger.info(
        f"[Batch-DG] Transcribiendo audio: {len(file_bytes)} bytes, "
        f"mime={mime_clean}, lang={language}, model={settings.deepgram_model}"
    )

    async with httpx.AsyncClient(timeout=600.0) as client:
        try:
            response = await client.post(
                DEEPGRAM_PRERECORDED_URL,
                params=params,
                headers=headers,
                content=file_bytes,
            )
        except httpx.TimeoutException:
            raise RuntimeError("Timeout al conectar con Deepgram. Intenta con un audio más corto.")
        except httpx.ConnectError as e:
            raise RuntimeError(f"Error de conexión con Deepgram: {e}")

    if response.status_code == 401:
        raise RuntimeError("Credenciales de Deepgram inválidas. Verifica DEEPGRAM_API_KEY en .env")

    if response.status_code != 200:
        body = response.text[:500]
        raise RuntimeError(
            f"Error de Deepgram (HTTP {response.status_code}): {body}"
        )

    data = response.json()

    # Log estructura de respuesta para debug
    try:
        channels = data.get("results", {}).get("channels", [])
        n_channels = len(channels)
        n_alts = len(channels[0].get("alternatives", [])) if channels else 0
        utterances = data.get("results", {}).get("utterances", [])
        n_utterances = len(utterances)
        logger.info(
            f"[Batch-DG] Respuesta: {n_channels} canal(es), {n_alts} alternativa(s), "
            f"{n_utterances} utterance(s)"
        )
    except Exception as e:
        logger.warning(f"[Batch-DG] Error al loguear estructura: {e}")

    # Extraer transcript completo
    # Estrategia: usar paragraphs > utterances > transcript directo
    full_transcript = ""

    try:
        channels = data["results"]["channels"]
        alternatives = channels[0]["alternatives"]

        # 1. Intentar paragraphs (más completo para audios largos)
        paragraphs_data = alternatives[0].get("paragraphs", {})
        if paragraphs_data and "paragraphs" in paragraphs_data:
            parts = []
            for para in paragraphs_data["paragraphs"]:
                sentences = para.get("sentences", [])
                para_text = " ".join(s.get("text", "") for s in sentences)
                if para_text.strip():
                    parts.append(para_text.strip())
            if parts:
                full_transcript = " ".join(parts)
                logger.info(f"[Batch-DG] Transcript vía paragraphs: {len(full_transcript)} chars")

        # 2. Fallback: utterances (concatenar todos)
        if not full_transcript and utterances:
            parts = [u.get("transcript", "") for u in utterances if u.get("transcript", "").strip()]
            if parts:
                full_transcript = " ".join(parts)
                logger.info(f"[Batch-DG] Transcript vía utterances: {len(full_transcript)} chars")

        # 3. Fallback: transcript directo de la primera alternativa
        if not full_transcript:
            full_transcript = alternatives[0].get("transcript", "")
            logger.info(f"[Batch-DG] Transcript vía alternativa directa: {len(full_transcript)} chars")

    except (KeyError, IndexError) as e:
        logger.error(f"[Batch-DG] Respuesta inesperada de Deepgram: {e}")
        raise RuntimeError("Respuesta inesperada de Deepgram al extraer transcript")

    if not full_transcript or not full_transcript.strip():
        logger.warning("[Batch-DG] Transcript vacío — el audio puede no contener habla")
        return ""

    logger.info(f"[Batch-DG] Transcript final ({len(full_transcript)} chars): '{full_transcript[:200]}...'")
    return full_transcript.strip()
