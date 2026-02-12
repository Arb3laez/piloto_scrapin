"""
Módulo de streaming de audio con Deepgram.

Maneja la conexión en tiempo real con la API de Deepgram
para transcripción de voz a texto con resultados parciales.
"""

import asyncio
import logging
from typing import Callable, Awaitable, Optional

from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class DeepgramStreamer:
    """
    Gestiona una conexión de streaming con Deepgram para transcripción
    en tiempo real. Recibe chunks de audio y emite transcripciones
    parciales y finales a través de un callback async.
    """

    def __init__(self, on_partial: Callable[[str, bool], Awaitable[None]]):
        self.client = DeepgramClient(settings.deepgram_api_key)
        self.connection = None
        self.on_partial = on_partial
        self.final_transcript_parts: list[str] = []
        self.is_open = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._transcript_queue: asyncio.Queue = asyncio.Queue()

    async def start(self) -> None:
        """Abre la conexión de streaming con Deepgram."""
        self._loop = asyncio.get_running_loop()

        options = LiveOptions(
            model=settings.deepgram_model,
            language=settings.deepgram_language,
            punctuate=True,
            interim_results=True,
            endpointing=200,
            smart_format=True,
            encoding="linear16",
            sample_rate=16000,
            channels=1,
            vad_events=True,
            utterance_end_ms=1000,
            # Keywords médicos para mejorar precisión de transcripción en español
            keywords=[
                "motivo de consulta:2",
                "enfermedad actual:2",
                "visión borrosa:2",
                "visión:2",
                "agudeza visual:2",
                "presión intraocular:2",
                "ojo derecho:2",
                "ojo izquierdo:2",
                "ambos ojos:2",
                "córnea:1",
                "conjuntiva:1",
                "cristalino:1",
                "retina:1",
                "nervio óptico:1",
                "vítreo:1",
                "biomicroscopía:1",
                "fondo de ojo:1",
                "normal:1",
                "transparente:1",
                "opacidad:1",
                "edema:1",
                "glaucoma:1",
                "catarata:1",
                "pterigión:1",
                "diagnóstico:1",
                "tratamiento:1",
                "antecedentes:1",
            ],
        )

        self.connection = self.client.listen.websocket.v("1")

        # Registrar handlers de eventos
        self.connection.on(LiveTranscriptionEvents.Transcript, self._on_transcript)
        self.connection.on(LiveTranscriptionEvents.UtteranceEnd, self._on_utterance_end)
        self.connection.on(LiveTranscriptionEvents.Error, self._on_error)
        self.connection.on(LiveTranscriptionEvents.Close, self._on_close)
        self.connection.on(LiveTranscriptionEvents.Open, self._on_open)

        logger.info("Iniciando conexión con Deepgram streaming...")

        # keepalive_options para mantener viva la conexión durante silencios
        success = self.connection.start(options, addons={"keepalive": "true"})

        if success:
            self.is_open = True
            logger.info("Conexión Deepgram streaming abierta exitosamente (con keepalive)")
        else:
            raise RuntimeError("No se pudo abrir la conexión de streaming con Deepgram")

    async def send_audio(self, audio_bytes: bytes) -> None:
        """Envía bytes de audio PCM16 a Deepgram."""
        if self.connection and self.is_open:
            try:
                self.connection.send(audio_bytes)
            except Exception as e:
                logger.warning(f"[Deepgram] Error enviando audio: {e}")
                self.is_open = False

    async def consume_transcripts(self) -> None:
        """
        Tarea async que consume transcripciones del queue interno
        y las envía al frontend a través del callback on_partial.
        """
        try:
            while self.is_open:
                try:
                    text, is_final = await asyncio.wait_for(
                        self._transcript_queue.get(),
                        timeout=1.0
                    )
                    await self.on_partial(text, is_final)
                except asyncio.TimeoutError:
                    continue
        except asyncio.CancelledError:
            # Procesar transcripciones restantes
            while not self._transcript_queue.empty():
                try:
                    text, is_final = self._transcript_queue.get_nowait()
                    await self.on_partial(text, is_final)
                except asyncio.QueueEmpty:
                    break
            raise

    async def finish(self) -> str:
        """Cierra Deepgram y retorna la transcripción final completa."""
        if self.connection and self.is_open:
            try:
                self.connection.finish()
                self.is_open = False
                logger.info("Conexión Deepgram cerrada")
            except Exception as e:
                logger.error(f"Error cerrando conexión Deepgram: {e}")
                self.is_open = False

        await asyncio.sleep(0.5)

        full_transcript = " ".join(self.final_transcript_parts).strip()
        logger.info(f"Transcripción final completa: {full_transcript[:100]}...")

        return full_transcript

    # ==========================================
    # Handlers de eventos Deepgram (corren en thread del SDK)
    # ==========================================

    def _on_transcript(self, _self_client, result, **kwargs) -> None:
        """
        Handler para transcripciones de Deepgram.
        IMPORTANTE: Corre en un thread del SDK, NO en el event loop de asyncio.
        Usa call_soon_threadsafe para enviar al queue de forma segura.
        """
        try:
            transcript = result.channel.alternatives[0].transcript

            if not transcript:
                return

            is_final = result.is_final

            if is_final:
                self.final_transcript_parts.append(transcript)
                logger.info(f"[Deepgram FINAL] {transcript}")
            else:
                logger.info(f"[Deepgram PARCIAL] {transcript}")

            # THREAD-SAFE: usar call_soon_threadsafe para poner en el queue
            # try/except protege contra race condition si el loop cierra entre
            # el check is_running() y la llamada call_soon_threadsafe()
            try:
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(
                        self._transcript_queue.put_nowait,
                        (transcript, is_final)
                    )
                else:
                    logger.warning("[Deepgram] Event loop no disponible, transcripción perdida")
            except RuntimeError:
                logger.warning("[Deepgram] Event loop cerrado durante enqueue, transcripción perdida")

        except Exception as e:
            logger.error(f"Error procesando transcripción Deepgram: {e}")

    def _on_utterance_end(self, _self_client, utterance_end, **kwargs) -> None:
        """Handler para fin de utterance — confirma que un bloque de habla terminó."""
        logger.info("[Deepgram] Utterance end detectado")

    def _on_error(self, _self_client, error, **kwargs) -> None:
        """Handler para errores de Deepgram."""
        logger.error(f"[Deepgram ERROR] {error}")

    def _on_close(self, _self_client, close, **kwargs) -> None:
        """Handler para cierre de conexión Deepgram."""
        self.is_open = False
        logger.info(f"[Deepgram] Conexión cerrada: {close}")

    def _on_open(self, _self_client, open_response, **kwargs) -> None:
        """Handler para apertura de conexión Deepgram."""
        logger.info("[Deepgram] Conexión abierta exitosamente")
