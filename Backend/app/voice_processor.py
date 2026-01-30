import base64
import io
import tempfile
import os
from groq import Groq
from app.config import get_settings
from app.models import FormStructure, FieldMapping
from typing import List, Dict, Any
import json

settings = get_settings()

class VoiceProcessor:
    def __init__(self):
        self.groq_client = Groq(api_key=settings.groq_api_key)
        self.accumulated_text = ""
        self.form_structure: FormStructure = None
        self.audio_chunks = []
        print("✅ VoiceProcessor inicializado")
    
    def set_form_structure(self, structure: FormStructure):
        """Guarda la estructura del formulario"""
        self.form_structure = structure
        print(f"📋 Estructura del formulario guardada: {len(structure.fields)} campos")
    
    def add_audio_chunk(self, audio_base64: str):
        """Acumula chunks de audio para transcripción posterior"""
        try:
            audio_bytes = base64.b64decode(audio_base64)
            self.audio_chunks.append(audio_bytes)
            print(f"📦 Chunk acumulado: {len(audio_bytes)} bytes (Total chunks: {len(self.audio_chunks)})")
        except Exception as e:
            print(f"❌ Error acumulando chunk: {e}")
    
    async def transcribe_accumulated_audio(self) -> str:
        """
        Transcribe todos los chunks acumulados como un solo archivo
        """
        if not self.audio_chunks:
            print("⚠️ No hay chunks de audio para transcribir")
            return ""
        
        try:
            # Combinar todos los chunks
            combined_audio = b''.join(self.audio_chunks)
            total_size = len(combined_audio)
            
            print(f"🎵 Transcribiendo audio combinado: {total_size} bytes ({len(self.audio_chunks)} chunks)")
            
            # 🔍 DEBUGGING: Ver los primeros bytes del archivo
            print(f"🔍 Primeros 20 bytes (hex): {combined_audio[:20].hex()}")
            print(f"🔍 Primeros 20 bytes (texto): {combined_audio[:20]}")
            
            # Verificar tamaño mínimo
            if total_size < 1000:
                print(f"⚠️ Audio demasiado corto: {total_size} bytes")
                self.audio_chunks.clear()
                return ""
            
            # Guardar en archivo temporal
            with tempfile.NamedTemporaryFile(delete=False, suffix='.webm', mode='wb') as temp_file:
                temp_file.write(combined_audio)
                temp_file_path = temp_file.name
            
            print(f"💾 Audio guardado en: {temp_file_path}")
            
            # 🔍 DEBUGGING: Verificar que el archivo existe y tiene contenido
            file_size = os.path.getsize(temp_file_path)
            print(f"🔍 Tamaño del archivo en disco: {file_size} bytes")
            
            # 🔍 DEBUGGING: Leer los primeros bytes del archivo guardado
            with open(temp_file_path, 'rb') as f:
                first_bytes = f.read(20)
                print(f"🔍 Primeros 20 bytes del archivo: {first_bytes.hex()}")
            
            try:
                # Transcribir con Groq Whisper
                print("🎙️ Enviando a Groq Whisper...")
                
                with open(temp_file_path, 'rb') as audio_file:
                    transcription = self.groq_client.audio.transcriptions.create(
                        file=audio_file,
                        model=settings.whisper_model,
                        language="es",
                        response_format="json"
                    )
                
                # Extraer texto
                if hasattr(transcription, 'text'):
                    transcription_text = transcription.text.strip()
                elif isinstance(transcription, dict) and 'text' in transcription:
                    transcription_text = transcription['text'].strip()
                else:
                    transcription_text = str(transcription).strip()
                
                print(f"📝 Transcripción: '{transcription_text}'")
                
                # Guardar como texto acumulado
                self.accumulated_text = transcription_text
                
                # Limpiar chunks
                self.audio_chunks.clear()
                
                return self.accumulated_text
                
            finally:
                # 🔍 NO eliminar el archivo todavía para poder inspeccionarlo
                print(f"📁 Archivo guardado para inspección: {temp_file_path}")
                # NO ejecutar: os.unlink(temp_file_path)
        
        except Exception as e:
            print(f"❌ Error en transcripción: {e}")
            print(f"❌ Tipo: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            self.audio_chunks.clear()
            return ""

    async def map_voice_to_fields(self, transcription: str) -> List[FieldMapping]:
        """
        Mapea la transcripción a campos del formulario usando Llama 3
        """
        if not self.form_structure:
            print("⚠️ No hay estructura de formulario definida")
            return []
        
        print(f"🧠 Mapeando transcripción: '{transcription}'")
        
        # Construir contexto médico
        medical_context = self._build_medical_context()
        
        # Construir prompt para Llama
        prompt = f"""Eres un asistente médico experto en mapear dictados médicos a formularios.

CONTEXTO MÉDICO:
{medical_context}

ESTRUCTURA DEL FORMULARIO:
{self._format_form_structure()}

TRANSCRIPCIÓN DEL DOCTOR:
"{transcription}"

TAREA:
Extrae la información del dictado y mapeala a los campos del formulario.
Devuelve SOLO un JSON válido con este formato:
{{
  "mappings": [
    {{
      "field_name": "nombre_del_campo",
      "value": "valor_extraido",
      "confidence": 0.95
    }}
  ]
}}

REGLAS:
1. Para selects/radios, usa EXACTAMENTE el valor de las opciones
2. Para órganos: "derecho"/"ojo derecho" → "OD", "izquierdo"/"ojo izquierdo" → "OI", "ambos"/"los dos" → "AO"
3. Para vía oftálmica: "gotas"/"oftálmico" → "Oftalmico"
4. Para formas farmacéuticas: busca palabras clave como "gotas"→"Frasco", "tableta"→"Tableta"
5. Si no estás seguro, omite el campo
6. NO incluyas campos que no se mencionan en el dictado
7. Responde SOLO con el JSON, sin explicaciones

JSON:"""

        try:
            print("🤖 Enviando a Llama 3 para mapeo...")
            
            response = self.groq_client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Eres un asistente médico que extrae información estructurada de dictados. Respondes SOLO en formato JSON válido."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.1,
                max_tokens=2000
            )
            
            # Extraer JSON de la respuesta
            response_text = response.choices[0].message.content.strip()
            print(f"📄 Respuesta de Llama: {response_text[:200]}...")
            
            # Limpiar respuesta (a veces viene con ```json```)
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()
            
            # Parsear JSON
            result = json.loads(response_text)
            
            # Convertir a FieldMapping
            mappings = [
                FieldMapping(**mapping) 
                for mapping in result.get("mappings", [])
            ]
            
            print(f"✅ Campos mapeados: {len(mappings)}")
            for mapping in mappings:
                print(f"   - {mapping.field_name} = {mapping.value}")
            
            return mappings
            
        except json.JSONDecodeError as e:
            print(f"❌ Error parseando JSON: {e}")
            print(f"❌ Respuesta recibida: {response_text}")
            return []
        except Exception as e:
            print(f"❌ Error en mapeo: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def _build_medical_context(self) -> str:
        """Contexto médico para mejorar el mapeo"""
        return """
TERMINOLOGÍA MÉDICA:
- OD = Ojo Derecho
- OI = Ojo Izquierdo  
- AO = Ambos Ojos
- N/A = No Aplica

SINÓNIMOS COMUNES:
- "sí", "si", "afirmativo", "correcto" → si
- "no", "negativo" → no
- "derecho", "ojo derecho" → OD
- "izquierdo", "ojo izquierdo" → OI
- "ambos", "los dos", "ambos ojos" → AO
- "gotas", "oftálmico", "ocular" → Vía: Oftalmico
- "pastilla", "comprimido" → Forma: Tableta
- "inyección" → Vía: Intramuscular/Intraocular

MEDICAMENTOS COMUNES:
- Tropicamida, Fenilefrina → Dilatación pupilar
- Dolex → Analgésico
- Latanoprost → Glaucoma
"""
    
    def _format_form_structure(self) -> str:
        """Formatea la estructura del formulario para el prompt"""
        formatted = []
        
        for field in self.form_structure.fields:
            field_info = f"- {field.name} ({field.label})"
            
            if field.required:
                field_info += " [REQUERIDO]"
            
            if field.options:
                options_str = ", ".join([f'"{opt.value}"' for opt in field.options])
                field_info += f" | Opciones: {options_str}"
            
            formatted.append(field_info)
        
        return "\n".join(formatted)
    
    def reset_accumulation(self):
        """Reinicia el texto y chunks acumulados"""
        self.accumulated_text = ""
        self.audio_chunks.clear()
        print("🔄 Acumulación reiniciada")