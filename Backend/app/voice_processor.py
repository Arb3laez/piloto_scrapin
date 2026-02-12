"""
Procesador de voz para mapeo de campos con LLM.

Se encarga de mapear transcripciones de texto a campos
del formulario médico usando Groq Llama 3.
La transcripción en tiempo real ahora es manejada por deepgram_streamer.py.

HU-010: Mapeo inteligente voz → campo con filtro de relevancia clínica.
El LLM puede responder null/vacío si la transcripción no contiene
información clínica relevante para la historia clínica.
"""

import json
import re
import logging
from typing import List, Dict, Optional

from groq import Groq

from app.config import get_settings
from app.models import FormStructure, FieldMapping
from app.realtime_extractor import normalize_value

logger = logging.getLogger(__name__)
settings = get_settings()

# Regex para extraer JSON de respuestas LLM con code fences
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


def _extract_json(text: str) -> str:
    """Extrae JSON limpio de respuestas LLM que pueden venir con code fences."""
    m = _JSON_FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    return text.strip()


# ============================================
# Registro de campos por sección (mini-prompts)
# Cada sección define: campos, system prompt, user prompt template, max_tokens.
# Extensible: agregar nuevas secciones aquí sin tocar main.py.
# ============================================
SECTION_FIELD_REGISTRY = {
    "attention-origin": {
        "fields": [
            {
                "key": "attention-origin-reason-for-consulting-badge-field",
                "label": "Motivo de consulta",
                "type": "textarea",
            },
            {
                "key": "attention-origin-current-disease-badge-field",
                "label": "Enfermedad actual",
                "type": "textarea",
            },
            {
                "key": "attention-origin-select",
                "label": "Origen de la atención",
                "type": "select",
            },
            {
                "key": "attention-origin-adverse-event-checkbox",
                "label": "Evento adverso",
                "type": "checkbox",
            },
            {
                "key": "attention-origin-evolution-time-input",
                "label": "Cantidad de evolución",
                "type": "number",
            },
            {
                "key": "attention-origin-evolution-time-unit-select",
                "label": "Unidad de tiempo de evolución",
                "type": "select",
            },
        ],
        "system_prompt": (
            "Eres un asistente médico oftalmológico. Mapeas frases dictadas "
            "a campos de historia clínica. Respondes SOLO JSON válido.\n"
            "La transcripción viene de voz y puede tener errores fonéticos. "
            "Interpreta la intención del doctor."
        ),
        "user_prompt_template": """Campos disponibles:
- attention-origin-reason-for-consulting-badge-field (Motivo de consulta) [textarea]
- attention-origin-current-disease-badge-field (Enfermedad actual) [textarea]

Frase dictada: "{segment}"

REGLAS:
1. Si menciona "motivo de consulta" seguido de texto → campo motivo de consulta, el valor es el texto DESPUÉS de "motivo de consulta".
2. Si menciona "enfermedad actual" o "padecimiento" seguido de texto → campo enfermedad actual, el valor es el texto DESPUÉS.
3. El "value" es SOLO el contenido clínico, SIN la etiqueta del campo ni conectores.
   ELIMINA siempre: "es el", "es la", "es", "son", "tiene", artículos iniciales.
   Ej: "motivo de consulta el paciente tiene dolor de cabeza" → value="Paciente tiene dolor de cabeza"
   Ej: "enfermedad actual es el atigmatismo" → value="Atigmatismo"
   Ej: "motivo de consulta visión borrosa" → value="Visión borrosa"
4. Si no hay info clínica para estos 2 campos → null
5. NUNCA inventes campos que no estén en la lista.

JSON:
{{"mappings": [{{"field_name": "unique_key", "value": "texto_clinico", "confidence": 0.9}}]}}
o {{"mappings": null}}""",
        "max_tokens": 150,
    },
    # Futuras secciones:
    # "physical-exam": { "fields": [...], "system_prompt": "...", ... },
    # "diagnostic-impression": { "fields": [...], "system_prompt": "...", ... },
}


class VoiceProcessor:
    def __init__(self):
        self.groq_client = Groq(api_key=settings.groq_api_key)
        self.form_structure: FormStructure = None
        self.biowel_fields: Optional[List[Dict]] = None
        logger.info("VoiceProcessor inicializado (solo mapeo LLM)")

    def set_form_structure(self, structure: FormStructure):
        """Guarda la estructura del formulario."""
        self.form_structure = structure
        logger.info(f"Estructura del formulario guardada: {len(structure.fields)} campos")

    def set_biowel_context(self, biowel_fields: List[Dict]):
        """Guarda los campos escaneados de Biowel para contexto del LLM."""
        self.biowel_fields = biowel_fields
        logger.info(f"Contexto Biowel guardado: {len(biowel_fields)} campos")

    async def map_segment_to_fields(
        self, segment: str, already_filled: Optional[Dict[str, str]] = None
    ) -> List[FieldMapping]:
        """
        HU-012: Mapeo en TIEMPO REAL de un segmento individual.
        Prompt ligero optimizado para baja latencia (~200ms en Groq).
        """
        if not self.biowel_fields:
            return []

        segment = segment.strip()
        if not segment:
            return []

        # Construir lista compacta de campos disponibles
        fields_compact = []
        for f in self.biowel_fields:
            key = f.get("unique_key", "")
            label = f.get("label", "")
            eye = f.get("eye", "")
            section = f.get("section", "")
            opts = f.get("options", [])

            # Saltar campos ya llenos
            if already_filled and key in already_filled:
                continue

            entry = f"{key} ({label})"
            if eye:
                entry += f" [{eye}]"
            if section:
                entry += f" [{section}]"
            if opts:
                entry += f" opciones: {', '.join(opts[:5])}"
            fields_compact.append(entry)

        if not fields_compact:
            return []

        prompt = f"""Campos disponibles en la historia clínica (identificador → descripción):
{chr(10).join(fields_compact)}

Frase dictada por el doctor: "{segment}"

REGLAS:
1. Si la frase contiene info clínica para algún campo, responde con el mapeo.
2. El "value" debe ser SOLO el CONTENIDO clínico, SIN la etiqueta del campo ni conectores.
   ELIMINA siempre: "es el", "es la", "es", "son los", "fue el", artículos iniciales.
   Ejemplos:
   - "motivo de consulta visión borrosa" → value="Visión borrosa"
   - "motivo de consulta dolor de ojos" → value="Dolor de ojos"
   - "enfermedad actual es el atigmatismo" → value="Atigmatismo" (NO "es el atigmatismo")
   - "la enfermedad actual es glaucoma" → value="Glaucoma"
3. Si dice "motivo de consulta: X" → el valor es X, el campo es attention-origin-reason-for-consulting-badge-field
4. Si dice "enfermedad actual: X" → el valor es X, el campo es attention-origin-current-disease-badge-field
5. Si menciona enfermedad/diagnóstico, TAMBIÉN mapea al campo diagnostic-impression-diagnosis-select con el nombre de la enfermedad
6. NUNCA mapees a campos que contengan "button", "btn", "link", "load-previous" en su nombre
7. Si es conversación casual o instrucción al paciente → null

Responde SOLO JSON:
{{"mappings": [{{"field_name": "unique_key_del_campo", "value": "texto_clinico", "confidence": 0.9}}]}}
o {{"mappings": null}}"""

        try:
            response = self.groq_client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Eres un asistente médico oftalmológico. Mapeas frases de "
                            "dictado por voz a campos de formulario. Respondes SOLO JSON.\n\n"
                            "IMPORTANTE: La transcripción viene de reconocimiento de voz y puede "
                            "tener errores. Debes INTERPRETAR la intención del doctor aunque "
                            "haya errores de transcripción. Ejemplos:\n"
                            "- 'quisión borrosa' = 'visión borrosa'\n"
                            "- 'vicio por rosa' = 'visión borrosa'\n"
                            "- 'preción' = 'presión'\n"
                            "- 'cornea normal' siempre es dato clínico\n"
                            "- 'motivo de consulta' seguido de texto = llenar campo de motivo\n\n"
                            "Si no hay info clínica, responde {\"mappings\": null}."
                        )
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=500
            )

            raw_content = response.choices[0].message.content
            if not raw_content:
                logger.warning("[Segment LLM] Respuesta vacía del LLM")
                return []

            response_text = _extract_json(raw_content)
            result = json.loads(response_text)
            raw_mappings = result.get("mappings")

            if raw_mappings is None or raw_mappings == []:
                logger.info(f"[Segment LLM] Casual/sin datos: '{segment[:50]}'")
                return []

            mappings = []
            for mapping_data in raw_mappings:
                mapping = FieldMapping(**mapping_data)
                field_type = self._get_field_type_for_key(mapping.field_name)
                mapping.value = normalize_value(str(mapping.value), field_type)
                mappings.append(mapping)

            logger.info(
                f"[Segment LLM] '{segment[:40]}' → "
                f"{[(m.field_name, m.value) for m in mappings]}"
            )
            return mappings

        except json.JSONDecodeError as e:
            logger.error(f"[Segment LLM] Error JSON: {e} | raw: {raw_content[:200] if 'raw_content' in dir() else 'N/A'}")
            return []
        except Exception as e:
            logger.error(f"[Segment LLM] Error: {e}")
            return []

    async def map_section_fields(
        self, section: str, segment: str, already_filled: Optional[Dict[str, str]] = None
    ) -> List[FieldMapping]:
        """
        CAPA 3a: Mini-prompt LLM para una sección específica.
        Usa un prompt ultraligero con solo los campos de esa sección (~100ms).

        Args:
            section: Nombre de sección de SECTION_CLASSIFIERS (ej: "attention-origin")
            segment: Segmento de transcripción a procesar
            already_filled: Campos ya llenos (para excluir)

        Returns:
            Lista de FieldMapping solo para campos de esta sección
        """
        section_config = SECTION_FIELD_REGISTRY.get(section)
        if not section_config:
            logger.warning(f"[Section LLM] Sección desconocida: {section}")
            return []

        segment = segment.strip()
        if not segment:
            return []

        # Verificar si todos los campos de la sección ya están llenos
        section_fields = section_config["fields"]
        available_fields = [
            f for f in section_fields
            if not (already_filled and f["key"] in already_filled)
        ]
        if not available_fields:
            logger.info(f"[Section LLM] Todos los campos de '{section}' ya están llenos")
            return []

        # Construir prompt desde el template de la sección
        user_prompt = section_config["user_prompt_template"].format(segment=segment)
        system_prompt = section_config["system_prompt"]
        max_tokens = section_config.get("max_tokens", 150)

        try:
            response = self.groq_client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=max_tokens,
            )

            raw_content = response.choices[0].message.content
            if not raw_content:
                logger.warning(f"[Section LLM] Respuesta vacía para '{section}'")
                return []

            response_text = _extract_json(raw_content)
            result = json.loads(response_text)
            raw_mappings = result.get("mappings")

            if raw_mappings is None or raw_mappings == []:
                logger.info(f"[Section LLM] Sin datos para '{section}': '{segment[:50]}'")
                return []

            # Guard anti-alucinación: solo aceptar campos de esta sección
            valid_keys = {f["key"] for f in section_fields}
            mappings = []
            for mapping_data in raw_mappings:
                mapping = FieldMapping(**mapping_data)
                if mapping.field_name not in valid_keys:
                    logger.warning(
                        f"[Section LLM] Campo '{mapping.field_name}' "
                        f"no pertenece a sección '{section}', ignorado"
                    )
                    continue
                if already_filled and mapping.field_name in already_filled:
                    continue
                field_type = next(
                    (f["type"] for f in section_fields if f["key"] == mapping.field_name),
                    "text"
                )
                mapping.value = normalize_value(str(mapping.value), field_type)
                mappings.append(mapping)

            logger.info(
                f"[Section LLM] '{section}' | '{segment[:40]}' → "
                f"{[(m.field_name, m.value) for m in mappings]}"
            )
            return mappings

        except json.JSONDecodeError as e:
            logger.error(f"[Section LLM] JSON error para '{section}': {e}")
            return []
        except Exception as e:
            logger.error(f"[Section LLM] Error para '{section}': {e}")
            return []

    async def map_voice_to_fields(
        self, transcription: str, already_filled: Optional[Dict[str, str]] = None
    ) -> List[FieldMapping]:
        """
        Mapea la transcripción a campos del formulario usando Llama 3.

        Args:
            transcription: Texto completo transcrito por Deepgram.
            already_filled: Campos ya llenos por el extractor en tiempo real.

        Returns:
            Lista de FieldMapping con los campos mapeados.
        """
        if not self.form_structure:
            logger.warning("No hay estructura de formulario definida")
            return []

        logger.info(f"Mapeando transcripción: '{transcription[:100]}...'")

        # Construir contexto médico
        medical_context = self._build_medical_context()

        # Construir contexto de campos ya llenos
        already_filled_context = ""
        if already_filled:
            filled_lines = [f"  - {k} = {v}" for k, v in already_filled.items()]
            already_filled_context = f"""
CAMPOS YA COMPLETADOS (NO los repitas en tu respuesta):
{chr(10).join(filled_lines)}
"""

        # Contexto Biowel si aplica
        biowel_context = ""
        if self.biowel_fields:
            biowel_context = self._format_biowel_fields()

        # Estructura del formulario
        form_structure_text = self._format_form_structure()
        if not form_structure_text and biowel_context:
            form_structure_text = biowel_context

       
        prompt = f"""Eres un asistente médico experto en extraer información clínica de dictados de consultas oftalmológicas y mapearla a campos de formularios.

CONTEXTO MÉDICO:
{medical_context}

ESTRUCTURA DEL FORMULARIO:
{form_structure_text}
{already_filled_context}

TRANSCRIPCIÓN DEL DOCTOR:
"{transcription}"

TAREA:
Analiza la transcripción y determina si contiene información clínica relevante para llenar campos de la historia clínica.

Si la transcripción contiene información clínica, responde con:
{{
  "mappings": [
    {{
      "field_name": "nombre_del_campo",
      "value": "valor_extraido",
      "confidence": 0.95
    }}
  ]
}}

Si la transcripción es conversación casual, saludos, instrucciones al paciente, o NO contiene información relevante para la historia clínica, responde con:
{{
  "mappings": null
}}

REGLAS:
1. Para selects/radios, usa EXACTAMENTE el valor de las opciones
2. Para órganos: "derecho"/"ojo derecho" → "OD", "izquierdo"/"ojo izquierdo" → "OI", "ambos"/"los dos" → "AO"
3. Para vía oftálmica: "gotas"/"oftálmico" → "Oftalmico"
4. Para formas farmacéuticas: "gotas"→"Frasco", "tableta"→"Tableta"
5. Si no estás seguro, omite el campo
6. NO incluyas campos que no se mencionan en el dictado
7. NO repitas campos que ya están completados
8. IGNORA conversación casual: saludos ("hola", "buenos días"), despedidas, instrucciones al paciente ("siéntese", "mire aquí", "abra los ojos"), preguntas personales ("cómo está", "cuántos años tiene"), frases de cortesía
9. IGNORA indicaciones de procedimiento: "le voy a poner gotas", "vamos a examinar", "un momento"
10. Responde SOLO con el JSON, sin explicaciones
11. NUNCA mapees a campos que contengan "button", "btn", "link", "load-previous" en su nombre — esos son botones, no campos
12. El "value" debe ser SOLO el contenido clínico. ELIMINA conectores: "es el", "es la", "es", "tiene", "son", artículos iniciales
    Ej: "enfermedad actual es atigmatismo" → value="Atigmatismo" (NO "es atigmatismo")
13. Si el doctor menciona un diagnóstico/enfermedad, mapea TAMBIÉN al campo diagnostic-impression-diagnosis-select con el nombre de la enfermedad

JSON:"""

        try:
            logger.info("Enviando a Llama 3 para mapeo...")

            response = self.groq_client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Eres un asistente médico oftalmológico que extrae información "
                            "clínica de dictados y la mapea a campos de formularios. "
                            "Respondes SOLO en formato JSON válido.\n\n"
                            "IMPORTANTE: La transcripción viene de reconocimiento de voz y puede "
                            "tener errores fonéticos. INTERPRETA la intención del doctor:\n"
                            "- 'quisión/vicio' probablemente = 'visión'\n"
                            "- 'por rosa' probablemente = 'borrosa'\n"
                            "- 'motivo de consulta' seguido de texto = campo motivo\n"
                            "- Cualquier mención de síntomas, hallazgos, diagnósticos = dato clínico\n\n"
                            "Si el dictado es conversación casual o no contiene datos "
                            "clínicos para la historia, responde {\"mappings\": null}."
                        )
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
            raw_content = response.choices[0].message.content
            if not raw_content:
                logger.warning("Respuesta vacía del LLM en mapeo completo")
                return []

            logger.debug(f"Respuesta de Llama: {raw_content[:200]}...")

            response_text = _extract_json(raw_content)
            result = json.loads(response_text)

            # HU-010: Manejar respuesta null del LLM (conversación casual)
            raw_mappings = result.get("mappings")
            if raw_mappings is None or raw_mappings == []:
                logger.info("LLM determinó: conversación casual / sin datos clínicos")
                return []

            # Convertir a FieldMapping con normalización de valores
            mappings = []
            for mapping_data in raw_mappings:
                mapping = FieldMapping(**mapping_data)

                # Normalizar valor según tipo de campo
                field_type = self._get_field_type_for_key(mapping.field_name)
                mapping.value = normalize_value(str(mapping.value), field_type)

                mappings.append(mapping)

            logger.info(f"Campos mapeados: {len(mappings)}")
            for mapping in mappings:
                logger.info(f"  - {mapping.field_name} = {mapping.value}")

            return mappings

        except json.JSONDecodeError as e:
            logger.error(f"Error parseando JSON: {e} | raw: {raw_content[:200] if 'raw_content' in dir() else 'N/A'}")
            return []
        except Exception as e:
            logger.error(f"Error en mapeo: {e}")
            return []

    def _build_medical_context(self) -> str:
        """Contexto médico para mejorar el mapeo."""
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
        """Formatea la estructura del formulario para el prompt."""
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

    def _format_biowel_fields(self) -> str:
        """Formatea los campos Biowel para el prompt del LLM."""
        if not self.biowel_fields:
            return ""

        formatted = ["CAMPOS DE BIOWEL (usar unique_key como field_name):"]
        for field in self.biowel_fields:
            key = field.get("unique_key", "")
            label = field.get("label", "")
            ftype = field.get("field_type", "")
            eye = field.get("eye", "")
            section = field.get("section", "")
            options = field.get("options", [])

            info = f"- {key} ({label}) [{ftype}]"
            if eye:
                info += f" Ojo: {eye}"
            if section:
                info += f" Sección: {section}"
            if options:
                info += f" | Opciones: {', '.join(options[:5])}"

            formatted.append(info)

        return "\n".join(formatted)

    def _get_field_type_for_key(self, field_name: str) -> str:
        """Retorna el tipo de campo dado un field_name/unique_key."""
        if self.biowel_fields:
            for field in self.biowel_fields:
                if field.get("unique_key") == field_name:
                    return field.get("field_type", "text")

        if self.form_structure and self.form_structure.fields:
            for field in self.form_structure.fields:
                if field.name == field_name:
                    if field.options:
                        return "select"
                    return "text"

        return "text"
