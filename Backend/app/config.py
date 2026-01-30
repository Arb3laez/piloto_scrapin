from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # API Keys
    groq_api_key: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    
    # Groq Models
    whisper_model: str = "whisper-large-v3"
    llm_model: str = "llama-3.1-70b-versatile"
    
    class Config:
        env_file = ".env"
        case_sensitive = False

@lru_cache()
def get_settings():
    return Settings()