import sys
import logging
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # API Keys
    groq_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"

    # Deepgram
    deepgram_api_key: str = ""
    deepgram_model: str = "nova-2"
    deepgram_language: str = "es"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Groq Models
    whisper_model: str = "whisper-large-v3"
    llm_model: str = "llama-3.1-70b-versatile"

    # TTS
    tts_enabled: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings():
    settings = Settings()
    missing = []
    if not settings.groq_api_key:
        missing.append("GROQ_API_KEY")
    if not settings.deepgram_api_key:
        missing.append("DEEPGRAM_API_KEY")
    if missing:
        logger.critical(
            f"Faltan variables de entorno requeridas: {', '.join(missing)}. "
            "Configúralas en el archivo .env"
        )
        sys.exit(1)
    return settings