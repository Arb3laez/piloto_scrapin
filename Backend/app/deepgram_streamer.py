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
        self._keepalive_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Abre la conexión de streaming con Deepgram."""
        self._loop = asyncio.get_running_loop()

        options = LiveOptions(
            model=settings.deepgram_model,
            language=settings.deepgram_language,
            punctuate=False,  # Desactivado para evitar cortes por puntuación
            interim_results=True,
            endpointing=2000,  # 2 segundos - valor seguro para evitar cortes prematuros
            smart_format=True,
            encoding="linear16",
            sample_rate=16000,
            channels=1,
            vad_events=True,
            utterance_end_ms=4000,  # 4 segundos - valor seguro para párrafos largos
            # Keywords médicos para mejorar precisión de transcripción en español
            # Boost máximo (5) para palabras clave de activación de campos principales
            # Esto ayuda a que Deepgram transcriba "motivo de consulta" en vez de "o dio consulta"
            keywords=[
                "motivo de consulta:5",
                "enfermedad actual:5",
                "observaciones:5",
                "análisis y plan:5",
                "análisis:4",
                "motivo:4",
                "consulta:3",
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
                # Palabras para finalizar dictado
                "listo:5",
                "terminado:3",
                "finalizado:3",
                "eso es todo:3",
                "se acabó:3",
                # Comandos de borrado
                "borrar:5",
                "borrar todo:5",
                "limpiar:4",
                "deshacer:3",
                # Oftalmología - hallazgos
                "justificación:4",
                "hallazgo:3",
                "hallazgos:3",
                "guardar:4",
                "ojo derecho externo:3",
                "párpados simétricos:2",
                "ausencia de edema:2",
                "movimientos oculares:2",
                "pestañas:2",
                "lesiones:2",
                "rosácea:2",
                # Clasificación del riesgo
                "caídas previas:3",
                "déficit sensorial:5",
                "déficit:5",
                "estado mental:3",
                "marcha actual:3",
                "medicación actual:3",
                # Preconsulta
                "dilatación:3",
                "signos vitales:3",
                "tamizaje:3",
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

        try:
            # FIX: El SDK de Deepgram start() NO soporta parámetro 'addons'
            # Usar solo 'options' sin parámetro adicional
            success = self.connection.start(options)

            if not success:
                raise RuntimeError("Connection.start() retornó False")

            self.is_open = True
            logger.info("Conexión Deepgram streaming abierta exitosamente")
            
            # FIX: Iniciar tarea de keep-alive para prevenir timeout de inactividad
            # Deepgram cierra la conexión si no recibe datos por ~10 segundos
            # Enviamos audio vacío cada 5 segundos para mantener viva la conexión
            self._keepalive_task = self._loop.create_task(self._keepalive_loop())
            logger.info("[Deepgram] Keep-alive task iniciado")

        except Exception as e:
            self.is_open = False
            logger.error(f"Error al inicializar conexión Deepgram: {e}")
            raise RuntimeError(f"No se pudo abrir la conexión de streaming con Deepgram: {e}")

    async def send_audio(self, audio_bytes: bytes) -> None:
        """Envía bytes de audio PCM16 a Deepgram."""
        if not self.connection:
            logger.warning("[Deepgram.send_audio] Connection es None, no se puede enviar audio")
            self.is_open = False
            return

        if not self.is_open:
            logger.warning("[Deepgram.send_audio] is_open=False, ignorando audio")
            return

        try:
            self.connection.send(audio_bytes)
            logger.debug(f"[Deepgram] Audio enviado: {len(audio_bytes)} bytes")
        except Exception as e:
            logger.error(f"[Deepgram.send_audio] Error enviando audio: {e}")
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
        # Cancelar keep-alive task primero
        if self._keepalive_task and not self._keepalive_task.done():
            self._keepalive_task.cancel()
            try:
                await self._keepalive_task
            except asyncio.CancelledError:
                pass
            logger.info("[Deepgram] Keep-alive task cancelado")
        
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

    async def _keepalive_loop(self) -> None:
        """
        Envía datos periódicos a Deepgram para mantener viva la conexión.
        
        Deepgram cierra automáticamente la conexión si no recibe datos por ~10 segundos.
        Este background task envía audio vacío (silencio) cada 4 segundos para mantener viva
        la conexión mientras esperamos que el usuario hable.
        """
        try:
            while self.is_open:
                try:
                    await asyncio.sleep(4.0)  # Esperar 4 segundos antes de enviar keep-alive
                    if self.is_open and self.connection:
                        # Enviar 320 bytes de silencio (0x0000) en PCM16
                        # 320 bytes = 160 samples @ 16-bit = 10ms de audio @ 16kHz
                        silence = b'\x00' * 320
                        try:
                            self.connection.send(silence)
                            logger.debug("[Deepgram] Keep-alive enviado (silencio)")
                        except Exception as e:
                            logger.error(f"[Deepgram] Error enviando keep-alive: {e}")
                            break
                except asyncio.CancelledError:
                    logger.info("[Deepgram] Keep-alive task cancelado")
                    break
                except Exception as e:
                    logger.error(f"[Deepgram._keepalive_loop] Error: {e}")
                    break
        except Exception as e:
            logger.error(f"[Deepgram._keepalive_loop] Error en loop: {e}")
        finally:
            logger.info("[Deepgram] Keep-alive loop terminado")

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
                logger.debug("[Deepgram._on_transcript] Transcripción vacía, ignorando")
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
            
            if not self._loop:
                logger.error("[Deepgram._on_transcript] _loop es None, no se puede encolar transcripción")
                return
            
            if not self._loop.is_running():
                logger.error("[Deepgram._on_transcript] Event loop no está corriendo, transcripción perdida")
                return

            try:
                self._loop.call_soon_threadsafe(
                    self._transcript_queue.put_nowait,
                    (transcript, is_final)
                )
                logger.debug(f"[Deepgram._on_transcript] Encolado exitosamente: {transcript[:50]}...")
            except RuntimeError as e:
                logger.error(f"[Deepgram._on_transcript] Error encolando transcripción: {e}")

        except Exception as e:
            logger.error(f"[Deepgram._on_transcript] Error procesando transcripción: {e}", exc_info=True)

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
