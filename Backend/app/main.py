from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
from pathlib import Path

from app.config import get_settings
from app.models import FormStructure, WebSocketMessage
from app.voice_processor import VoiceProcessor
from app.validator import FormValidator
from app.tts_service import TTSService

settings = get_settings()
app = FastAPI(title="Voice-to-Form Medical System")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir archivos estáticos
frontend_path = Path(__file__).parent.parent.parent / "front"
app.mount("/static", StaticFiles(directory=frontend_path / "static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_form():
    """Servir el formulario HTML"""
    form_path = frontend_path / "form.html"
    return form_path.read_text(encoding='utf-8')

@app.websocket("/ws/voice-stream")
async def voice_stream_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("\n" + "=" * 70)
    print("✅ Cliente conectado al WebSocket")
    print("=" * 70)
    
    # Inicializar servicios
    voice_processor = VoiceProcessor()
    tts_service = TTSService()
    validator = None
    
    try:
        while True:
            # Recibir mensaje
            data = await websocket.receive_text()
            message = json.loads(data)
            
            msg_type = message.get("type")
            print(f"\n📨 Mensaje recibido - Tipo: {msg_type}")
            
            # 1. RECIBIR ESTRUCTURA DEL FORMULARIO
            if msg_type == "form_structure":
                print("\n" + "=" * 70)
                print("📥 RECIBIENDO ESTRUCTURA DEL FORMULARIO")
                print("=" * 70)
                
                form_data = message.get("data")
                
                print(f"📊 Tipo de form_data: {type(form_data)}")
                print(f"📊 Claves en form_data: {form_data.keys() if isinstance(form_data, dict) else 'No es dict'}")
                
                try:
                    print("\n🔨 Intentando crear FormStructure...")
                    form_structure = FormStructure(**form_data)
                    
                    print(f"✅ FormStructure creado exitosamente")
                    print(f"📋 form_id: {form_structure.form_id}")
                    print(f"📋 Número de fields: {len(form_structure.fields)}")
                    
                    voice_processor.set_form_structure(form_structure)
                    validator = FormValidator(form_structure)
                    
                    await websocket.send_json({
                        "type": "info",
                        "message": "Estructura del formulario recibida"
                    })
                    print("✅ Estructura del formulario guardada correctamente\n")
                    
                except Exception as e:
                    print("\n" + "=" * 70)
                    print(f"❌ ERROR CREANDO FormStructure")
                    print("=" * 70)
                    print(f"❌ Tipo de error: {type(e).__name__}")
                    print(f"❌ Mensaje: {str(e)}")
                    print(f"\n❌ Traceback completo:")
                    import traceback
                    traceback.print_exc()
                    print("=" * 70)
                    
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Error en estructura del formulario: {str(e)}"
                    })
            
            # 2. RECIBIR CHUNK DE AUDIO - SOLO ACUMULAR
            elif msg_type == "audio_chunk":
                audio_base64 = message.get("data")
                
                if not audio_base64:
                    print("⚠️ Chunk vacío recibido")
                    continue
                
                # Solo acumular el chunk (no transcribir todavía)
                voice_processor.add_audio_chunk(audio_base64)
            
            # 3. FIN DEL STREAM - TRANSCRIBIR TODO
            elif msg_type == "end_stream":
                print("\n" + "=" * 70)
                print("🎬 STREAM FINALIZADO - INICIANDO TRANSCRIPCIÓN")
                print("=" * 70)
                
                try:
                    # Transcribir todos los chunks acumulados
                    transcription = await voice_processor.transcribe_accumulated_audio()
                    
                    if transcription:
                        print(f"\n📝 Transcripción completa: '{transcription}'")
                        
                        # Enviar transcripción al cliente
                        await websocket.send_json({
                            "type": "transcription",
                            "text": transcription
                        })
                        
                        # Mapear a campos del formulario
                        print(f"\n🧠 Iniciando mapeo de campos...")
                        mappings = await voice_processor.map_voice_to_fields(transcription)
                        
                        if mappings:
                            print(f"\n✅ Campos mapeados exitosamente: {len(mappings)}")
                            
                            # Preparar datos para auto-fill
                            autofill_data = {
                                mapping.field_name: mapping.value 
                                for mapping in mappings
                            }
                            
                            print(f"\n📤 Datos para auto-fill:")
                            for field_name, value in autofill_data.items():
                                print(f"   - {field_name} = {value}")
                            
                            # Enviar datos para auto-fill
                            await websocket.send_json({
                                "type": "autofill_data",
                                "data": autofill_data
                            })
                            print("\n✅ Datos de auto-fill enviados al cliente")
                            
                            # Validar formulario
                            if validator:
                                validation = validator.validate_mappings(mappings)
                                
                                await websocket.send_json({
                                    "type": "validation_result",
                                    "is_valid": validation.is_valid,
                                    "missing_fields": validation.missing_fields,
                                    "errors": validation.errors
                                })
                                
                                if validation.is_valid:
                                    print(f"\n✅ Validación: Formulario completo")
                                else:
                                    print(f"\n⚠️ Validación: Campos faltantes:")
                                    for field in validation.missing_fields:
                                        print(f"   - {field}")
                                    
                                    # Generar TTS para campos faltantes
                                    missing_msg = validator.get_missing_fields_message(
                                        validation.missing_fields
                                    )
                                    
                                    print(f"\n🔊 Generando TTS: '{missing_msg}'")
                                    tts_audio = await tts_service.generate_speech(missing_msg)
                                    
                                    if tts_audio:
                                        await websocket.send_json({
                                            "type": "tts_audio",
                                            "audio_base64": tts_audio,
                                            "text": missing_msg
                                        })
                                        print("✅ TTS enviado al cliente")
                        else:
                            print("\n⚠️ No se pudieron mapear campos de la transcripción")
                    else:
                        print("\n⚠️ Transcripción vacía o sin audio suficiente")
                    
                    # Reiniciar acumulación para el próximo dictado
                    voice_processor.reset_accumulation()
                    
                    await websocket.send_json({
                        "type": "info",
                        "message": "Stream procesado completamente"
                    })
                    
                    print("\n" + "=" * 70)
                    print("✅ STREAM PROCESADO COMPLETAMENTE")
                    print("=" * 70 + "\n")
                    
                except Exception as e:
                    print(f"\n❌ Error procesando stream:")
                    print(f"   Tipo: {type(e).__name__}")
                    print(f"   Mensaje: {str(e)}")
                    import traceback
                    traceback.print_exc()
                    
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Error procesando audio: {str(e)}"
                    })
                    
                    # Limpiar acumulación en caso de error
                    voice_processor.reset_accumulation()
    
    except WebSocketDisconnect:
        print("\n" + "=" * 70)
        print("🔌 Cliente desconectado del WebSocket")
        print("=" * 70 + "\n")
    except Exception as e:
        print(f"\n❌ Error general en WebSocket:")
        print(f"   Tipo: {type(e).__name__}")
        print(f"   Mensaje: {str(e)}")
        import traceback
        traceback.print_exc()
        
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass

@app.get("/health")
async def health_check():
    return {"status":"healthy","service":"voice-to-form-api"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )