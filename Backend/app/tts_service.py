import base64
from app.config import get_settings

settings = get_settings()

class TTSService:
    def __init__(self):
        self.enabled = False
        
        if not self.enabled:
            print("  TTS DESACTIVADO - Modo solo transcripción")
            print(" Para activar TTS: configura ELEVENLABS_API_KEY en .env")
    
    async def generate_speech(self, text: str) -> str:
        if not self.enabled:
            print(f" [TTS Mock] {text}")
            return ""
        
        try:
            from elevenlabs.client import ElevenLabs
            
            client = ElevenLabs(api_key=settings.elevenlabs_api_key)
            
            audio_generator = client.generate(
                text=text,
                voice=settings.elevenlabs_voice_id,
                model="eleven_multilingual_v2"
            )
            
            audio_bytes = b"".join(audio_generator)
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            
            return audio_base64
            
        except Exception as e:
            print(f" Error generando TTS: {e}")
            return ""
