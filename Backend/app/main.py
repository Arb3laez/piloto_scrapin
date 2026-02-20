"""
FastAPI application principal con WebSocket endpoint
para streaming de voz a formulario médico.

Usa Deepgram para transcripción en tiempo real
y Groq Llama 3 para mapeo inteligente de campos.
"""

import asyncio
import base64
import json
import logging
import re
from pathlib import Path

# Constantes
RECONNECT_LOG_INTERVAL = 50   # Log de reconexión cada N chunks
AUDIO_DEBUG_LOG_INTERVAL = 20  # Log debug de audio cada N chunks
CONSUMER_CANCEL_TIMEOUT = 3.0  # Timeout (seg) para cancelar consumer_task

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.models import FormStructure
from app.voice_processor import VoiceProcessor
from app.deepgram_streamer import DeepgramStreamer
from app.realtime_extractor import (
    RealtimeExtractor,
    ActiveFieldTracker,
    normalize_value,
    clean_captured_value,
    strip_keywords_and_commands,
    get_select_value_for_keyword,
    EVOLUTION_TIME_ANCHORED_RE,
    EXCLUSIVE_FIELDS
)

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

settings = get_settings()
# FastAPI Setup
app = FastAPI(title="Voice-to-Form Medical System")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/voice-stream")
async def voice_stream_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Cliente conectado al WebSocket")

    # Inicializar servicios
    voice_processor = VoiceProcessor()
    realtime_extractor = RealtimeExtractor()
    active_field_tracker = ActiveFieldTracker()  # Sistema de activación por palabra clave
    deepgram_streamer: DeepgramStreamer | None = None
    consumer_task: asyncio.Task | None = None
    is_biowel_mode = False
    validator = None

    async def process_segment_with_llm(text: str):
        """
        Procesa un segmento con LLM en background.
        CAPA 2 + 3: Clasifica sección → mini-prompt, o fallback genérico.
        No bloquea el flujo de audio/transcripción.
        """
        try:
            if not realtime_extractor.is_relevant(text):
                logger.info(f"[RT-LLM] Segmento casual ignorado: '{text[:50]}'")
                return

            already = dict(realtime_extractor.already_filled)

            # CAPA 2: Clasificar sección (<5ms, regex)
            section = realtime_extractor.classify_section(text)

            llm_mappings = []
            if section:
                # CAPA 3a: Mini-prompt para sección específica (~100ms)
                logger.info(f"[RT-LLM] Sección detectada: '{section}' para '{text[:50]}'")
                llm_mappings = await voice_processor.map_section_fields(
                    section, text, already_filled=already
                )

            if not llm_mappings:
                # CAPA 3b: Fallback al prompt genérico (~200ms)
                # Solo si el mini-prompt no retornó nada o no se detectó sección
                llm_mappings = await voice_processor.map_segment_to_fields(
                    text, already_filled=already
                )

            if llm_mappings:
                llm_items = [
                    {"unique_key": m.field_name, "value": m.value, "confidence": m.confidence}
                    for m in llm_mappings
                    if m.field_name not in already
                ]
                if llm_items:
                    await websocket.send_json({
                        "type": "partial_autofill",
                        "items": llm_items,
                        "source_text": text
                    })
                    for item in llm_items:
                        realtime_extractor.already_filled[item["unique_key"]] = str(item["value"])
                    logger.info(
                        f"[RT-LLM] {len(llm_items)} campos: "
                        f"{[(i['unique_key'], i['value']) for i in llm_items]}"
                    )
        except Exception as e:
            logger.error(f"[RT-LLM] Error: {e}")

    # Buffer para detectar patrones directos en parciales
    partial_buffer = {"text": "", "processed_prefixes": set()}
    
    # Buffer para acumular texto de sesión y buscar keywords en contexto completo
    # Esto resuelve el problema donde Deepgram envía "Origen" -> "de" -> "la" -> "atención"
    # en segmentos separados, y "origen de la atención" solo se detecta si acumulamos
    session_keyword_buffer = ""

    async def on_partial_transcript(text: str, is_final: bool):
        """
        Callback que recibe transcripciones parciales/finales de Deepgram.
        Envía al frontend inmediatamente.

        SISTEMA DE ACTIVACIÓN POR PALABRA CLAVE (CAPA 0):
        Cuando se detecta una palabra clave médica (ej: "motivo de consulta"),
        ese campo se activa y todo el texto posterior se acumula ahí hasta
        que se detecte una nueva palabra clave.

        Ejemplo:
        1. Doctor dice: "Motivo de consulta"
           → Activa campo hc_motivo_consulta (o attention-origin-reason-for-consulting-badge-field)
        2. Doctor dice: "dolor en ambos ojos"
           → Se acumula en el campo activo
        3. Doctor dice: "Enfermedad actual"
           → Envía campo anterior, activa nuevo campo
        4. Doctor dice: "astigmatismo"
           → Se acumula en el nuevo campo activo

        Esto resuelve el problema de fragmentación de Deepgram donde la palabra clave
        y el valor llegan en segmentos separados.
        """
        try:
            msg_type = "final_segment" if is_final else "partial_transcription"
            await websocket.send_json({
                "type": msg_type,
                "text": text,
                "is_final": is_final
            })
            logger.info(f"[{'FINAL' if is_final else 'PARCIAL'}] {text}")

            if not is_biowel_mode or not text.strip():
                return

            # =============================================
            # CAPA 0: SISTEMA DE ACTIVACIÓN POR PALABRA CLAVE
            # =============================================
            
            # Acumular texto en buffer de sesión para detectar keywords en contexto completo
            # Esto resuelve el problema donde "origen de la atención" llega como segmentos separados
            nonlocal session_keyword_buffer
            session_keyword_buffer += " " + text if session_keyword_buffer else text
            session_keyword_buffer = session_keyword_buffer.strip()
            
            # Buffer sin límite para permitir párrafos largos
            # El buffer crece según sea necesario para dictado continuo
            
            # Detectar keywords en el texto actual Y en el buffer acumulado
            # Priorizar match en texto actual (más preciso) sobre el buffer (puede tener keywords viejas)
            keyword_match = realtime_extractor.detect_keyword(text)
            if not keyword_match:
                keyword_match = realtime_extractor.detect_keyword(session_keyword_buffer)
            logger.info(f"[KeywordDetect] text='{text[:60]}' match={keyword_match}")
            
            if is_final:
                # =============================================
                # PRIORIDAD 1: COMANDOS DE CONTROL (siempre primero)
                # Detectar cmd_stop y cmd_clear INCLUSO si hay campo activo
                # =============================================
                if keyword_match and (keyword_match[0] in ("cmd_stop", "cmd_clear") or keyword_match[0].startswith("cmd_uncheck::")):
                    testid, keyword, content_after = keyword_match
                    
                    if testid.startswith("cmd_uncheck::"):
                        # Desmarcar un checkbox específico (ej: "borrar ojos normales")
                        target_testid = testid.replace("cmd_uncheck::", "")
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": target_testid, "value": "false", "confidence": 1.0}],
                            "source_text": f"[Checkbox desmarcado: {keyword}]"
                        })
                        realtime_extractor.already_filled.pop(target_testid, None)
                        logger.info(f"[Uncheck] '{target_testid}' desmarcado por '{keyword}'")
                        session_keyword_buffer = ""
                        return

                    if testid == "cmd_stop":
                        # Finalizar campo actual sin activar uno nuevo
                        previous_field = active_field_tracker.activate_field(None, keyword)
                        if previous_field:
                            prev_testid, prev_text = previous_field
                            ftype = realtime_extractor.get_field_type(prev_testid)
                            normalized = normalize_value(prev_text, ftype)
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": prev_testid, "value": normalized, "confidence": 1.0}],
                                "source_text": f"[Finalizado por comando: {keyword}]"
                            })
                        session_keyword_buffer = ""
                        return

                    if testid == "cmd_clear":
                        # Borrar contenido del campo activo
                        if active_field_tracker.active_field:
                            curr_testid = active_field_tracker.active_field
                            active_field_tracker.clear()
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": curr_testid, "value": "", "confidence": 1.0}],
                                "source_text": f"[Borrado por comando: {keyword}]"
                            })
                        session_keyword_buffer = ""
                        return
                
                # =============================================
                # PRIORIDAD 2: Patrones anclados específicos (tiempo evolución, etc.)
                # Estos se ejecutan INCLUSO si hay campo activo porque son muy específicos
                # =============================================
                # Ejecutar solo para detectar patrones "2 semanas", "3 días", etc.
                anchored_items = []
                for match in EVOLUTION_TIME_ANCHORED_RE.finditer(text.lower()):
                    val_num, val_unit = match.groups()
                    normalized_unit = normalize_value(val_unit, "select")
                    anchored_items.append({
                        "unique_key": "attention-origin-evolution-time-input",
                        "value": val_num.replace(",", "."),
                        "confidence": 0.98
                    })
                    anchored_items.append({
                        "unique_key": "attention-origin-evolution-time-unit-select",
                        "value": normalized_unit,
                        "confidence": 0.98
                    })
                
                if anchored_items:
                    await websocket.send_json({
                        "type": "partial_autofill",
                        "items": anchored_items,
                        "source_text": text
                    })
                    return
                
                # =============================================
                # PRIORIDAD 3: CHECKBOX / SELECT INMEDIATO por keyword
                # Estos se procesan ANTES que process_segment para evitar
                # que el LLM intercepte "ojos normales", "evento adverso", etc.
                # =============================================
                if keyword_match and keyword_match[0] not in ("cmd_stop", "cmd_clear") and not keyword_match[0].startswith("cmd_uncheck::"):
                    testid_candidate = keyword_match[0]
                    ftype_candidate = realtime_extractor.get_field_type(testid_candidate)
                    logger.info(f"[PRIO3-DEBUG] testid='{testid_candidate}', ftype='{ftype_candidate}', keyword='{keyword_match[1]}'")
                    
                    if ftype_candidate == "checkbox":
                        testid, keyword, content_after = keyword_match
                        # Finalizar campo anterior si existe
                        previous_field = active_field_tracker.activate_field(None, keyword)
                        if previous_field:
                            prev_testid, prev_text = previous_field
                            prev_ftype = realtime_extractor.get_field_type(prev_testid)
                            normalized = normalize_value(prev_text, prev_ftype)
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": prev_testid, "value": normalized, "confidence": 0.95}],
                                "source_text": f"[Finalizado por checkbox: {keyword}]"
                            })
                            realtime_extractor.already_filled[prev_testid] = normalized
                        
                        checkbox_value = normalize_value("sí", ftype_candidate)
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": testid, "value": checkbox_value, "confidence": 1.0}],
                            "source_text": f"[Checkbox activado: {keyword}]"
                        })
                        realtime_extractor.already_filled[testid] = checkbox_value
                        active_field_tracker.active_field = None
                        active_field_tracker.accumulated_text = ""
                        logger.info(f"[Checkbox] '{testid}' activado inmediatamente por keyword '{keyword}'")
                        session_keyword_buffer = ""
                        return
                    
                    elif ftype_candidate == "select" and keyword_match[1].lower() not in ["tiempo", "unidad", "cantidad", "valor"]:
                        testid, keyword, content_after = keyword_match
                        # Finalizar campo anterior si existe
                        previous_field = active_field_tracker.activate_field(None, keyword)
                        if previous_field:
                            prev_testid, prev_text = previous_field
                            prev_ftype = realtime_extractor.get_field_type(prev_testid)
                            normalized = normalize_value(prev_text, prev_ftype)
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": prev_testid, "value": normalized, "confidence": 0.95}],
                                "source_text": f"[Finalizado por select: {keyword}]"
                            })
                            realtime_extractor.already_filled[prev_testid] = normalized
                        
                        select_value = get_select_value_for_keyword(keyword)
                        normalized_select = normalize_value(select_value, ftype_candidate)
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": testid, "value": normalized_select, "confidence": 1.0}],
                            "source_text": f"[Select activado: {keyword}]"
                        })
                        realtime_extractor.already_filled[testid] = normalized_select
                        active_field_tracker.active_field = None
                        active_field_tracker.accumulated_text = ""
                        logger.info(f"[Select] '{testid}' = '{normalized_select}' por keyword '{keyword}'")
                        session_keyword_buffer = ""
                        return

                    elif ftype_candidate == "radio":
                        testid, keyword, content_after = keyword_match
                        # Finalizar campo anterior si existe
                        previous_field = active_field_tracker.activate_field(None, keyword)
                        if previous_field:
                            prev_testid, prev_text = previous_field
                            prev_ftype = realtime_extractor.get_field_type(prev_testid)
                            normalized = normalize_value(prev_text, prev_ftype)
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": prev_testid, "value": normalized, "confidence": 0.95}],
                                "source_text": f"[Finalizado por radio: {keyword}]"
                            })
                            realtime_extractor.already_filled[prev_testid] = normalized
                        
                        # Radio buttons se activan con "true" (click para seleccionar)
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": testid, "value": "true", "confidence": 1.0}],
                            "source_text": f"[Radio activado: {keyword}]"
                        })
                        realtime_extractor.already_filled[testid] = "true"
                        active_field_tracker.active_field = None
                        active_field_tracker.accumulated_text = ""
                        logger.info(f"[Radio] '{testid}' activado por keyword '{keyword}'")
                        session_keyword_buffer = ""
                        return

                # =============================================
                # PRIORIDAD 4: Patrones directos (si NO hay campo activo)
                # =============================================
                if not active_field_tracker.active_field:
                    items = realtime_extractor.process_segment(text)
                    if items:
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [item.model_dump() for item in items],
                            "source_text": text
                        })
                        return

                # =============================================
                # PRIORIDAD 5: ACTIVACIÓN DE NUEVO CAMPO (palabras clave de texto)
                # =============================================
                # Flag para evitar doble acumulación en Prioridad 6
                keyword_handled = False
                
                if keyword_match and keyword_match[0] not in ("cmd_stop", "cmd_clear") and not keyword_match[0].startswith("cmd_uncheck::"):
                    testid, keyword, content_after = keyword_match
                    ftype = realtime_extractor.get_field_type(testid)
                    
                    # Checkbox/select/radio ya manejados en Prioridad 3, skip
                    if ftype in ("checkbox", "select", "radio"):
                        pass
                    # [MODIFICACIÓN LOCK EXCLUSIVO]
                    elif active_field_tracker.active_field in EXCLUSIVE_FIELDS:
                        logger.info(
                            f"[Lock] Campo exclusivo '{active_field_tracker.active_field}' activo. "
                            f"Ignorando keyword '{keyword}'."
                        )
                        pass
                    
                    else:
                        keyword_handled = True
                        
                        previous_field = active_field_tracker.activate_field(testid, keyword)

                        if previous_field:
                            prev_testid, prev_text = previous_field
                            prev_ftype = realtime_extractor.get_field_type(prev_testid)
                            normalized = normalize_value(prev_text, prev_ftype)
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": prev_testid, "value": normalized, "confidence": 0.95}],
                                "source_text": f"[Finalizado por nueva keyword: {keyword}]"
                            })
                            realtime_extractor.already_filled[prev_testid] = normalized
                        
                        if content_after:
                            clean_after = strip_keywords_and_commands(content_after, keyword)
                            if clean_after:
                                active_field_tracker.append_text(clean_after)
                        
                        session_keyword_buffer = ""

                # =============================================
                # PRIORIDAD 5: ACUMULAR AL CAMPO ACTIVO
                # Solo si NO se acaba de activar un campo nuevo (evitar doble acumulación)
                # =============================================
                if active_field_tracker.active_field and not keyword_handled:
                    # PRIMERO: Detectar palabras de finalización ANTES de limpiar
                    finalization_words = ["listo", "terminado", "fin", "finalizado", "eso es todo", "se acabó"]
                    text_lower = text.lower().strip()
                    
                    # Verificar si el texto contiene alguna palabra de finalización
                    is_finalization = any(word in text_lower for word in finalization_words)
                    
                    if is_finalization:
                        # Finalizar el campo actual automáticamente
                        current_testid, accumulated_text = active_field_tracker.current_field
                        ftype = realtime_extractor.get_field_type(current_testid)
                        
                        # Eliminar palabra de finalización del texto acumulado
                        clean_text = accumulated_text
                        for word in finalization_words:
                            clean_text = clean_text.replace(word, "").strip()
                        
                        normalized = normalize_value(clean_text, ftype)
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": current_testid, "value": normalized, "confidence": 1.0}],
                            "source_text": f"[Dictado finalizado: {text}]"
                        })
                        realtime_extractor.already_filled[current_testid] = normalized
                        active_field_tracker.activate_field(None, None)  # Desactivar campo
                        logger.info(f"[Finalización] Campo '{current_testid}' finalizado por palabra: {text}")
                        session_keyword_buffer = ""
                        return
                    
                    # SEGUNDO: Eliminar keywords y comandos del texto antes de acumular
                    # Esto previene que "motivo de consulta", etc. aparezcan como contenido
                    cleaned_text = strip_keywords_and_commands(
                        text, active_field_tracker.last_keyword
                    )
                    if cleaned_text:
                        # Acumular texto en lugar de sobrescribir
                        # Los parciales de Deepgram pueden venir fragmentados
                        # pero necesitamos acumular todo el contenido
                        active_field_tracker.append_text(cleaned_text)
                
                # Enviar actualización persistente para campo activo
                current_data = active_field_tracker.get_current()
                if current_data:
                    curr_testid, curr_text = current_data
                    ftype = realtime_extractor.get_field_type(curr_testid)
                    normalized = normalize_value(curr_text, ftype)
                    await websocket.send_json({
                        "type": "partial_autofill",
                        "items": [{"unique_key": curr_testid, "value": normalized, "confidence": 0.95}],
                        "source_text": text
                    })
                    # No lanzar LLM si ya hay campo activo por keyword
                    return

                asyncio.create_task(process_segment_with_llm(text))

            else:
                # PARTIAL: Detectar comandos y patrones anclados en tiempo real
                # =============================================
                # PRIORIDAD 1: COMANDOS (cmd_stop, cmd_clear) en tiempo real
                # =============================================
                if keyword_match and (keyword_match[0] in ("cmd_stop", "cmd_clear") or keyword_match[0].startswith("cmd_uncheck::")):
                    testid, keyword, content_after = keyword_match
                    
                    if testid.startswith("cmd_uncheck::"):
                        # cmd_uncheck se maneja solo en FINAL (esperar confirmación)
                        pass
                    elif testid == "cmd_clear":
                        # Borrar contenido del campo activo INMEDIATAMENTE en PARCIAL también
                        if active_field_tracker.active_field:
                            curr_testid = active_field_tracker.active_field
                            active_field_tracker.clear()
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{"unique_key": curr_testid, "value": "", "confidence": 1.0}],
                                "source_text": f"[Borrado por comando: {keyword}]"
                            })
                        session_keyword_buffer = ""
                    elif testid == "cmd_stop":
                        # Finalizar campo activo en PARCIAL para respuesta rápida
                        if active_field_tracker.active_field:
                            previous_field = active_field_tracker.activate_field(None, keyword)
                            if previous_field:
                                prev_testid, prev_text = previous_field
                                ftype = realtime_extractor.get_field_type(prev_testid)
                                normalized = normalize_value(prev_text, ftype)
                                await websocket.send_json({
                                    "type": "partial_autofill",
                                    "items": [{"unique_key": prev_testid, "value": normalized, "confidence": 1.0}],
                                    "source_text": f"[Finalizado por comando parcial: {keyword}]"
                                })
                                realtime_extractor.already_filled[prev_testid] = normalized
                            session_keyword_buffer = ""
                            logger.info(f"[cmd_stop PARCIAL] Campo cerrado")
                
                # =============================================
                # PRIORIDAD 2: Patrones anclados (tiempo evolución) en tiempo real
                # =============================================
                anchored_items = []
                for match in EVOLUTION_TIME_ANCHORED_RE.finditer(text.lower()):
                    val_num, val_unit = match.groups()
                    normalized_unit = normalize_value(val_unit, "select")
                    anchored_items.append({
                        "unique_key": "attention-origin-evolution-time-input",
                        "value": val_num.replace(",", "."),
                        "confidence": 0.90
                    })
                    anchored_items.append({
                        "unique_key": "attention-origin-evolution-time-unit-select",
                        "value": normalized_unit,
                        "confidence": 0.90
                    })
                
                if anchored_items:
                    await websocket.send_json({
                        "type": "partial_autofill",
                        "items": anchored_items,
                        "source_text": text
                    })
                # Continuar con acumulación normal del campo activo incluso si hay patrones anclados
                
                # =============================================
                # PRIORIDAD 3: ACUMULAR PARCIALES AL CAMPO ACTIVO
                # =============================================
                if active_field_tracker.active_field:
                    # Parciales de Deepgram son ACUMULATIVOS (cada parcial contiene todo
                    # el texto desde el inicio de la utterance). Usar set_text para reemplazar,
                    # NO append_text que duplicaría el contenido.
                    # Eliminar keywords y comandos (listo, borrar, motivo de consulta, etc.)
                    # para que no aparezcan como contenido del campo.
                    cleaned_text = strip_keywords_and_commands(
                        text, active_field_tracker.last_keyword
                    )
                    if cleaned_text:
                        # Acumular texto en lugar de sobrescribir para evitar pérdida en pausas
                        active_field_tracker.append_text(cleaned_text)
                    
                    # Enviar preview actualizado solo si no tenemos command o patrón anclado
                    if keyword_match and (keyword_match[0] in ("cmd_stop", "cmd_clear") or keyword_match[0].startswith("cmd_uncheck::")):
                        pass  # Ya manejado arriba
                    elif anchored_items:
                        pass  # Ya manejado arriba
                    else:
                        # Preview normal del campo - solo si el texto cambió
                        curr_data = active_field_tracker.get_current()
                        if curr_data:
                            curr_testid, curr_text = curr_data
                            # Verificar si el texto realmente cambió desde el último envío
                            last_sent = getattr(active_field_tracker, '_last_sent_text', '')
                            if curr_text != last_sent:
                                ftype = realtime_extractor.get_field_type(curr_testid)
                                normalized = normalize_value(curr_text, ftype)
                                await websocket.send_json({
                                    "type": "partial_autofill",
                                    "items": [{"unique_key": curr_testid, "value": normalized, "confidence": 0.80}],
                                    "source_text": text
                                })
                                # Guardar el último texto enviado
                                active_field_tracker._last_sent_text = curr_text
                elif keyword_match and keyword_match[0] not in ("cmd_stop", "cmd_clear") and not keyword_match[0].startswith("cmd_uncheck::"):
                    testid, keyword, content_after = keyword_match
                    ftype = realtime_extractor.get_field_type(testid)
                    
                    # Activar radio/checkbox/select INMEDIATAMENTE en parciales
                    # No esperar a is_final porque el usuario puede parar el dictado antes
                    if ftype == "radio" and testid not in realtime_extractor.already_filled:
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": testid, "value": "true", "confidence": 1.0}],
                            "source_text": f"[Radio activado parcial: {keyword}]"
                        })
                        realtime_extractor.already_filled[testid] = "true"
                        logger.info(f"[Radio PARCIAL] '{testid}' activado por '{keyword}'")
                        session_keyword_buffer = ""
                    elif ftype == "checkbox" and testid not in realtime_extractor.already_filled:
                        checkbox_value = normalize_value("sí", ftype)
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": testid, "value": checkbox_value, "confidence": 1.0}],
                            "source_text": f"[Checkbox activado parcial: {keyword}]"
                        })
                        realtime_extractor.already_filled[testid] = checkbox_value
                        logger.info(f"[Checkbox PARCIAL] '{testid}' activado por '{keyword}'")
                        session_keyword_buffer = ""
                    else:
                        # Preview normal para campos de texto
                        normalized = normalize_value(content_after, ftype) if content_after else ""
                        await websocket.send_json({
                            "type": "partial_autofill",
                            "items": [{"unique_key": testid, "value": normalized, "confidence": 0.80}],
                            "source_text": text
                        })

            # IMPORTANTE: NO enviamos el campo activo solo porque is_final=True
            # porque Deepgram marca segmentos como "final" en pausas naturales del habla.
            # El campo activo solo se envía cuando:
            # 1. Se detecta una NUEVA palabra clave (ya manejado arriba)
            # 2. El usuario DETIENE el dictado (evento end_stream)
            # 
            # Esto permite acumular párrafos completos aunque el doctor haga pausas.

        except Exception as e:
            logger.error(f"Error enviando transcripción parcial: {e}")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"Mensaje WebSocket inválido (no es JSON): {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": "Mensaje inválido: JSON mal formado"
                })
                continue

            msg_type = message.get("type")
            if not msg_type or not isinstance(msg_type, str):
                logger.warning(f"Mensaje sin type válido: {message}")
                continue

            # =============================================
            # 1. RECIBIR ESTRUCTURA DEL FORMULARIO
            # =============================================
            if msg_type == "form_structure":
                logger.info("Recibiendo estructura del formulario...")

                form_data = message.get("data")

                try:
                    form_structure = FormStructure(**form_data)
                    logger.info(
                        f"FormStructure creado: {form_structure.form_id} "
                        f"({len(form_structure.fields)} campos)"
                    )

                    voice_processor.set_form_structure(form_structure)
                    validator = FormValidator(form_structure)

                    # Iniciar conexión de streaming con Deepgram
                    deepgram_streamer = DeepgramStreamer(
                        on_partial=on_partial_transcript
                    )
                    await deepgram_streamer.start()

                    # Lanzar tarea consumidora de transcripciones
                    consumer_task = asyncio.create_task(
                        deepgram_streamer.consume_transcripts()
                    )

                    await websocket.send_json({
                        "type": "info",
                        "message": "Estructura recibida, streaming Deepgram listo"
                    })
                    logger.info("Deepgram streaming iniciado, listo para audio")

                except Exception as e:
                    logger.error(f"Error inicializando sesión: {e}", exc_info=True)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Error inicializando: {str(e)}"
                    })

            # =============================================
            # 1b. RECIBIR ESTRUCTURA BIOWEL (data-testid)
            # =============================================
            elif msg_type == "biowel_form_structure":
                logger.info("Recibiendo estructura Biowel...")

                biowel_fields = message.get("fields", [])
                already_filled = message.get("already_filled", {})

                try:
                    is_biowel_mode = True
                    # Resetear estado del extractor para nueva sesión
                    realtime_extractor.reset()
                    active_field_tracker.reset()
                    realtime_extractor.set_biowel_fields(biowel_fields)
                    realtime_extractor.set_already_filled(already_filled)

                    # Crear FormStructure genérica para el VoiceProcessor
                    form_structure = FormStructure(
                        form_id="biowel_form",
                        fields=[]
                    )
                    voice_processor.set_form_structure(form_structure)
                    voice_processor.set_biowel_context(biowel_fields)

                    # Iniciar conexión de streaming con Deepgram
                    deepgram_streamer = DeepgramStreamer(
                        on_partial=on_partial_transcript
                    )
                    await deepgram_streamer.start()

                    consumer_task = asyncio.create_task(
                        deepgram_streamer.consume_transcripts()
                    )

                    await websocket.send_json({
                        "type": "info",
                        "message": f"Modo Biowel activo ({len(biowel_fields)} campos), streaming listo"
                    })
                    logger.info(
                        f"Modo Biowel activado: {len(biowel_fields)} campos, "
                        f"streaming Deepgram iniciado"
                    )

                except Exception as e:
                    logger.error(f"Error inicializando sesión Biowel: {e}", exc_info=True)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Error inicializando Biowel: {str(e)}"
                    })

            # =============================================
            # 2. RECIBIR CHUNK DE AUDIO → PIPA A DEEPGRAM
            # =============================================
            elif msg_type == "audio_chunk":
                audio_base64 = message.get("data")

                if not audio_base64 or not deepgram_streamer:
                    if not audio_base64:
                        logger.warning("[Audio] Chunk recibido sin data")
                    if not deepgram_streamer:
                        logger.warning("[Audio] Chunk recibido sin streamer activo")
                    continue

                try:
                    audio_bytes = base64.b64decode(audio_base64)

                    # Contador de chunks para logging
                    if not hasattr(voice_stream_endpoint, '_chunk_count'):
                        voice_stream_endpoint._chunk_count = 0
                    voice_stream_endpoint._chunk_count += 1

                    # Si Deepgram se desconectó, reconectar
                    if not deepgram_streamer.is_open:
                        if voice_stream_endpoint._chunk_count % RECONNECT_LOG_INTERVAL == 1:
                            logger.warning("[Audio] Deepgram cerrado, intentando reconectar...")
                        try:
                            # Crear nuevo streamer
                            deepgram_streamer = DeepgramStreamer(
                                on_partial=on_partial_transcript
                            )
                            await deepgram_streamer.start()
                            if consumer_task and not consumer_task.done():
                                consumer_task.cancel()
                            consumer_task = asyncio.create_task(
                                deepgram_streamer.consume_transcripts()
                            )
                            logger.info("[Audio] Deepgram reconectado exitosamente")
                            await websocket.send_json({
                                "type": "info",
                                "message": "Reconectado a Deepgram"
                            })
                        except Exception as re:
                            logger.error(f"[Audio] Error reconectando Deepgram: {re}")
                            continue

                    if voice_stream_endpoint._chunk_count % AUDIO_DEBUG_LOG_INTERVAL == 1:
                        logger.info(
                            f"[Audio] Chunk #{voice_stream_endpoint._chunk_count}: "
                            f"{len(audio_bytes)} bytes, "
                            f"primeros 10: {audio_bytes[:10].hex()}, "
                            f"deepgram_open: {deepgram_streamer.is_open}"
                        )

                    await deepgram_streamer.send_audio(audio_bytes)
                except Exception as e:
                    logger.error(f"Error enviando audio a Deepgram: {e}")

            # =============================================
            # 3. FIN DEL STREAM → FINALIZAR Y MAPEAR
            # =============================================
            elif msg_type == "end_stream":
                logger.info("Stream finalizado, procesando transcripción...")

                if not deepgram_streamer:
                    await websocket.send_json({
                        "type": "error",
                        "message": "No hay sesión de streaming activa"
                    })
                    continue

                try:
                    # IMPORTANTE: Enviar el campo activo si existe antes de cerrar
                    # Este es el momento correcto para finalizar el campo activo,
                    # no en cada segmento is_final (que ocurre en pausas naturales)
                    if active_field_tracker.active_field:
                        final_data = active_field_tracker.get_and_clear()
                        if final_data:
                            final_testid, final_text = final_data
                            normalized = normalize_value(final_text, "textarea")
                            await websocket.send_json({
                                "type": "partial_autofill",
                                "items": [{
                                    "unique_key": final_testid,
                                    "value": normalized,
                                    "confidence": 0.95
                                }],
                                "source_text": "[Dictado finalizado]"
                            })
                            realtime_extractor.already_filled[final_testid] = normalized
                            logger.info(
                                f"[Keyword] Campo activo enviado al finalizar: "
                                f"'{final_testid}' = '{normalized[:50]}...'"
                            )

                    # Cancelar tarea consumidora con timeout
                    if consumer_task:
                        consumer_task.cancel()
                        try:
                            await asyncio.wait_for(consumer_task, timeout=CONSUMER_CANCEL_TIMEOUT)
                        except (asyncio.CancelledError, asyncio.TimeoutError):
                            pass

                    # Cerrar Deepgram y obtener transcripción final
                    full_transcription = await deepgram_streamer.finish()
                    deepgram_streamer = None

                    if full_transcription:
                        logger.info(f"Transcripción final: '{full_transcription[:100]}...'")

                        # Enviar transcripción completa al cliente
                        await websocket.send_json({
                            "type": "transcription",
                            "text": full_transcription
                        })

                        # HU-010: Filtro de relevancia antes del LLM
                        # Si la transcripción completa no es clínicamente relevante,
                        # saltar la llamada al LLM (ahorra latencia y tokens)
                        if not realtime_extractor.is_relevant(full_transcription):
                            logger.info(
                                "Transcripción no clínicamente relevante, "
                                "saltando llamada al LLM"
                            )
                            await websocket.send_json({
                                "type": "info",
                                "message": "Conversación casual detectada, sin campos clínicos"
                            })
                            # Resetear y continuar
                            if is_biowel_mode:
                                realtime_extractor.reset()
                            await websocket.send_json({
                                "type": "info",
                                "message": "Stream procesado completamente"
                            })
                            continue

                        # Mapear a campos del formulario con LLM
                        # SKIP LLM si ya se llenaron campos por keywords (ahorra tokens
                        # y evita que el LLM sobreescriba campos correctos)
                        already_filled = realtime_extractor.already_filled if is_biowel_mode else {}
                        if already_filled:
                            logger.info(
                                f"[LLM-SKIP] {len(already_filled)} campos ya llenados por keywords, "
                                f"saltando LLM: {list(already_filled.keys())}"
                            )
                        else:
                            logger.info("Iniciando mapeo de campos con LLM...")
                            mappings = await voice_processor.map_voice_to_fields(
                                full_transcription,
                                already_filled=already_filled
                            )

                            if mappings:
                                # Preparar y enviar datos para auto-fill
                                autofill_data = {
                                    mapping.field_name: mapping.value
                                    for mapping in mappings
                                }

                                logger.info(f"Campos mapeados: {len(mappings)}")
                                for field_name, value in autofill_data.items():
                                    logger.info(f"  - {field_name} = {value}")

                                await websocket.send_json({
                                    "type": "autofill_data",
                                    "data": autofill_data
                                })

                                # Validar formulario
                                if validator:
                                    validation = validator.validate_mappings(mappings)

                                    await websocket.send_json({
                                        "type": "validation_result",
                                        "is_valid": validation.is_valid,
                                        "missing_fields": validation.missing_fields,
                                        "errors": validation.errors
                                    })

                                    if not validation.is_valid:
                                        logger.info(
                                            f"Campos faltantes: {validation.missing_fields}"
                                        )

                                        # Generar TTS para campos faltantes
                                        missing_msg = validator.get_missing_fields_message(
                                            validation.missing_fields
                                        )
                                        tts_audio = await tts_service.generate_speech(
                                            missing_msg
                                        )

                                        if tts_audio:
                                            await websocket.send_json({
                                                "type": "tts_audio",
                                                "audio_base64": tts_audio,
                                                "text": missing_msg
                                            })
                                    else:
                                        logger.info("Formulario completo")
                            else:
                                logger.warning(
                                    "No se pudieron mapear campos de la transcripción"
                                )
                    else:
                        logger.warning("Transcripción vacía")

                    # Resetear extractor para siguiente sesión
                    if is_biowel_mode:
                        realtime_extractor.reset()

                    await websocket.send_json({
                        "type": "info",
                        "message": "Stream procesado completamente"
                    })
                    logger.info("Stream procesado completamente")

                except Exception as e:
                    logger.error(f"Error procesando stream: {e}", exc_info=True)
                    deepgram_streamer = None

                    await websocket.send_json({
                        "type": "error",
                        "message": f"Error procesando audio: {str(e)}"
                    })

    except WebSocketDisconnect:
        logger.info("Cliente desconectado del WebSocket")
    except Exception as e:
        logger.error(f"Error general en WebSocket: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except Exception:
            pass
    finally:
        # Limpiar recursos
        if consumer_task and not consumer_task.done():
            consumer_task.cancel()
            try:
                await asyncio.wait_for(consumer_task, timeout=CONSUMER_CANCEL_TIMEOUT)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        if deepgram_streamer:
            try:
                await deepgram_streamer.finish()
            except Exception:
                pass
        logger.info("Sesión WebSocket finalizada")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "voice-to-form-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
