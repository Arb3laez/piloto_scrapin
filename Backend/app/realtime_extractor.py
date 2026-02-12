"""
Extractor en tiempo real de campos oftalmológicos.

Procesa segmentos finales de Deepgram con patrones médicos,
mantiene contexto stateful (ojo actual, sección), y genera
PartialAutofillItems en <10ms.

Incluye filtro de relevancia clínica para ignorar conversación casual.
"""

import re
import logging
from datetime import datetime
from typing import List, Optional, Dict, Tuple

from app.models import BiowelFieldIdentifier, PartialAutofillItem

logger = logging.getLogger(__name__)


# ============================================
# Sistema de Activación de Campos por Palabra Clave
# ============================================

# Mapeo de palabras clave a data-testid de Biowel
# Cuando el doctor dice una palabra clave, se activa ese campo
# y todo lo que diga después se acumula ahí hasta la siguiente palabra clave
KEYWORD_TO_FIELD = {
    # Historia clínica básica - Origen de atención
    "motivo de consulta": "attention-origin-reason-for-consulting-badge-field",
    "motivo": "attention-origin-reason-for-consulting-badge-field",
    "consulta por": "attention-origin-reason-for-consulting-badge-field",
    
    "enfermedad actual": "attention-origin-current-disease-badge-field",
    "padecimiento actual": "attention-origin-current-disease-badge-field",

    "origen de la atención": "attention-origin-select",
    "origen de atención": "attention-origin-select",
    "origen de atencion": "attention-origin-select",
    "origen": "attention-origin-select",
    "enfermedad general": "attention-origin-select",
    "enfermedad profesional": "attention-origin-select",
    "soat": "attention-origin-select",
    "tránsito": "attention-origin-select",
    "transito": "attention-origin-select",
    "accidente laboral": "attention-origin-select",
    "accidente de trabajo": "attention-origin-select",
    "evento adverso": "attention-origin-adverse-event-checkbox",
    "evento": "attention-origin-adverse-event-checkbox",
    "adverso": "attention-origin-adverse-event-checkbox",
    
    # Intento con otros posibles testids si el anterior falla
    "evento adverso switch": "attention-origin-adverse-event-switch",
    "evento adverso badge": "attention-origin-adverse-event-badge-field",
    
    "impresión diagnóstica": "diagnostic-impression-diagnosis-select",
    
    # Tiempo de evolución
    "cantidad": "attention-origin-evolution-time-input",
    "valor": "attention-origin-evolution-time-input",
    "tiempo": "attention-origin-evolution-time-unit-select",
    "unidad": "attention-origin-evolution-time-unit-select",
    

    

}

# Palabras clave de control (comandos)
COMMAND_KEYWORDS = {
    "listo": "cmd_stop",
    "confirmar": "cmd_stop",
    "terminar": "cmd_stop",
    "finalizar": "cmd_stop",
    "borrar": "cmd_clear",
    "limpiar": "cmd_clear",
    "deshacer": "cmd_clear",
}


class ActiveFieldTracker:
    """
    Gestiona el estado del campo activo en el sistema de dictado médico.
    
    Cuando se detecta una palabra clave (ej: "motivo de consulta"),
    ese campo se activa y todo el texto posterior se acumula ahí
    hasta que se detecte una nueva palabra clave.
    
    Ejemplo de uso:
        Doctor dice: "Motivo de consulta dolor en ambos ojos"
        1. Se detecta "motivo de consulta" → activa campo correspondiente
        2. "dolor en ambos ojos" se acumula en ese campo
        3. Doctor dice: "Enfermedad actual astigmatismo"
        4. Se detecta "enfermedad actual" → envía campo anterior y activa nuevo campo
    """
    
    def __init__(self):
        self.active_field: Optional[str] = None  # testid del campo activo
        self.accumulated_text: str = ""  # texto acumulado para ese campo
        self.last_keyword: str = ""  # última palabra clave detectada
        self.min_chars_to_send: int = 5  # mínimo de caracteres para enviar
        
    def activate_field(self, testid: str, keyword: str) -> Optional[Tuple[str, str]]:
        """
        Activa un nuevo campo y retorna el contenido del campo anterior si existe.
        """
        # Si es el MISMO campo que ya tenemos activo, no resetear acumulado
        # a menos que la keyword sea nueva y esté en una posición diferente
        if testid == self.active_field:
            self.last_keyword = keyword
            return None

        previous_data = None
        if self.active_field and self.accumulated_text.strip():
            previous_data = (self.active_field, self.accumulated_text.strip())
            logger.info(f"[ActiveField] Finalizando campo anterior '{self.active_field}'")
        
        self.active_field = testid
        self.accumulated_text = ""
        self.last_keyword = keyword
        logger.info(f"[ActiveField] Nuevo campo activado: '{testid}' (keyword: '{keyword}')")
        return previous_data
    
    def set_text(self, text: str) -> None:
        """Establece el texto del campo activo (sobrescribe para modo acumulativo)."""
        if self.active_field:
            self.accumulated_text = text.strip()

    def clear(self) -> None:
        """Limpia el contenido del campo activo."""
        self.accumulated_text = ""

    def append_text(self, text: str) -> None:
        """Acumula texto en el campo activo solo si no es repetido."""
        if not self.active_field:
            return
        
        text_clean = text.strip()
        if not text_clean:
            return

        # Si el texto es una extensión del actual (Deepgram cumulative), actualizar
        if self.accumulated_text and text_clean.startswith(self.accumulated_text):
            self.accumulated_text = text_clean
            return

        if not self.accumulated_text:
            self.accumulated_text = text_clean
        else:
            if not self.accumulated_text.endswith(" "):
                self.accumulated_text += " "
            self.accumulated_text += text_clean
        
        logger.debug(
            f"[ActiveField] Acumulado en '{self.active_field}': "
            f"'{self.accumulated_text[:50]}...' ({len(self.accumulated_text)} chars)"
        )
    
    def get_current(self) -> Optional[Tuple[str, str]]:
        """
        Retorna el campo activo actual sin limpiarlo.
        
        Returns:
            (testid, accumulated_text) si hay campo activo con contenido, None si no
        """
        if self.active_field and len(self.accumulated_text.strip()) >= self.min_chars_to_send:
            return (self.active_field, self.accumulated_text.strip())
        return None
    
    def get_and_clear(self) -> Optional[Tuple[str, str]]:
        """
        Retorna (testid, accumulated_text) del campo activo y limpia el estado.
        
        Returns:
            (testid, accumulated_text) si hay campo activo con contenido, None si no
        """
        if not self.active_field or not self.accumulated_text.strip():
            return None
        
        data = (self.active_field, self.accumulated_text.strip())
        
        logger.info(
            f"[ActiveField] Limpiando campo '{self.active_field}' "
            f"({len(self.accumulated_text)} caracteres)"
        )
        
        # Limpiar estado
        self.active_field = None
        self.accumulated_text = ""
        self.last_keyword = ""
        
        return data
    
    def reset(self) -> None:
        """Reinicia completamente el estado del tracker."""
        self.active_field = None
        self.accumulated_text = ""
        self.last_keyword = ""
        logger.debug("[ActiveField] Estado reiniciado")


# ============================================
# Patrones médicos oftalmológicos
# ============================================

# Patrones para detectar ojo
EYE_PATTERNS = {
    "OD": [
        r"\bojo\s+derecho\b", r"\bo\.?\s*d\.?\b", r"\bderecho\b",
        r"\bOD\b", r"\bod\b"
    ],
    "OI": [
        r"\bojo\s+izquierdo\b", r"\bo\.?\s*i\.?\b", r"\bizquierdo\b",
        r"\bOI\b", r"\boi\b"
    ],
    "AO": [
        r"\bambos\s+ojos\b", r"\ba\.?\s*o\.?\b", r"\bambos\b",
        r"\blos\s+dos\b", r"\bbilateral\b"
    ],
}

# Patrones para detectar sección/estructura anatómica
SECTION_PATTERNS = {
    "cornea": [r"\bcórnea\b", r"\bcornea\b", r"\bcorneal\b"],
    "conjuntiva": [r"\bconjuntiva\b", r"\bconjuntival\b"],
    "iris": [r"\biris\b"],
    "pupila": [r"\bpupila\b", r"\bpupilar\b", r"\bpupilas\b"],
    "cristalino": [r"\bcristalino\b", r"\blente\b"],
    "retina": [r"\bretina\b", r"\bretiniana\b", r"\bretinal\b"],
    "vitreo": [r"\bvítreo\b", r"\bvitreo\b"],
    "nervio": [r"\bnervio\s+óptico\b", r"\bnervio\b", r"\bpapilar\b"],
    "macula": [r"\bmácula\b", r"\bmacula\b", r"\bmacular\b"],
    "parpado": [r"\bpárpado\b", r"\bparpado\b", r"\bpalpebral\b"],
    "esclera": [r"\besclera\b", r"\bescleral\b"],
    "camara": [r"\bcámara\s+anterior\b", r"\bcámara\b", r"\bcamara\b"],
    "presion": [r"\bpresión\b", r"\bpresion\b", r"\bPIO\b", r"\btonometría\b", r"\btonometria\b"],
    "agudeza": [r"\bagudeza\b", r"\bvisual\b", r"\bAV\b"],
    "fondo": [r"\bfondo\s+de\s+ojo\b", r"\bfondoscopia\b"],
    "biomicroscopia": [r"\bbiomicroscopia\b", r"\blámpara\s+de\s+hendidura\b"],
    "segmento_anterior": [r"\bsegmento\s+anterior\b"],
    "segmento_posterior": [r"\bsegmento\s+posterior\b"],
    "anexos": [r"\banexos\b"],
}

# ============================================
# Mapeo directo: keyword → data-testid de Biowel
# Cuando el doctor dice estas frases, se llena directamente el campo
# ============================================
DIRECT_FIELD_PATTERNS: List[Tuple[str, str, List[str]]] = [
    # (data_testid de Biowel, tipo_captura, patrones_regex)
    # tipo_captura: "after" = capturar texto DESPUÉS del patrón, "full" = todo el segmento

    # Motivo de consulta
    # IMPORTANTE: Los patrones más específicos van PRIMERO.
    # El patrón genérico "motivo" al final se eliminó porque capturaba
    # "de consulta dolor de ojos" como valor (bug).
    ("attention-origin-reason-for-consulting-badge-field", "after", [
        r"motivo\s+de\s+(?:la\s+)?consulta\s*(?:es|fue|será|son)?[:\.,;\s]+(.+)",
        r"el\s+motivo\s+(?:es|de\s+(?:la\s+)?consulta)\s*[:\.,;\s]+(.+)",
        r"consulta\s+por\s*[:\.,;\s]+(.+)",
        r"viene\s+por\s*[:\.,;\s]+(.+)",
        r"paciente\s+(?:consulta|refiere|acude|viene)\s+por\s*[:\.,;\s]+(.+)",
        r"motivo\s+de\s+consulta\s*[,;\s]+(.+)",
    ]),

    # Enfermedad actual
    ("attention-origin-current-disease-badge-field", "after", [
        r"(?:la\s+)?enfermedad\s+actual\s*(?:es|fue|será|son)?[:\.,;\s]+(.+)",
        r"padecimiento\s+actual\s*(?:es|fue)?[:\.,;\s]+(.+)",
        r"cuadro\s+cl[ií]nico\s*(?:es|fue)?[:\.,;\s]+(.+)",
        r"historia\s+de\s+(?:la\s+)?enfermedad\s*[:\.,;\s]+(.+)",
    ]),

    # Diagnóstico / Impresión diagnóstica (CIE-10 searchable select)
    # Comparte patrones con enfermedad actual: si el doctor dice
    # "enfermedad actual es atigmatismo", también se busca en CIE-10.
    # Además captura "diagnóstico: X" directamente.
    ("diagnostic-impression-diagnosis-select", "after", [
        r"(?:el\s+)?diagn[oó]stico\s*(?:es|fue|será)?[:\.,;\s]+(.+)",
        r"impresi[oó]n\s+diagn[oó]stica\s*(?:es|fue)?[:\.,;\s]+(.+)",
        r"(?:la\s+)?enfermedad\s+actual\s*(?:es|fue|será|son)?[:\.,;\s]+(.+)",
        r"padecimiento\s+actual\s*(?:es|fue)?[:\.,;\s]+(.+)",
    ]),
]

# ============================================
# Clasificador de sección por keywords (CAPA 2)
# Mapea keywords del dictado → sección del formulario.
# Usado para enrutar al mini-prompt LLM correcto.
# Extensible: agregar nuevas secciones aquí.
# ============================================
SECTION_CLASSIFIERS: Dict[str, List[re.Pattern]] = {
    "attention-origin": [
        re.compile(r"\b(?:motivo|consulta)\b", re.IGNORECASE),
        re.compile(r"\b(?:enfermedad\s+actual|padecimiento\s+actual)\b", re.IGNORECASE),
        re.compile(r"\b(?:viene\s+por|consulta\s+por|acude\s+por)\b", re.IGNORECASE),
    ],
    # Futuras secciones:
    # "physical-exam": [
    #     re.compile(r"\b(?:córnea|cornea|conjuntiva|iris|pupila|cristalino)\b", re.IGNORECASE),
    # ],
}

# Regex para limpiar conectores/artículos al inicio del valor capturado.
_LEADING_CONNECTORS_RE = re.compile(
    r"^(?:"
    r"es\s+(?:el|la|un|una|los|las|que)\s+|"
    r"es\s+|"
    r"son\s+(?:los|las|unos|unas)?\s*|"
    r"fue\s+(?:el|la|un|una)?\s*|"
    r"(?:el|la|los|las|un|una|de|del|di)\s+|"
    r"[,\.\s:;]+"
    r")",
    re.IGNORECASE
)

# Regex para evolución anclada (ej: "2 días", "3 semanas")
EVOLUTION_TIME_ANCHORED_RE = re.compile(
    r"\b(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:-)?\s*(segundos?|minutos?|días?|dias?|semanas?|meses|mes|horas?|años?|anios?)\b",
    re.IGNORECASE
)


def clean_captured_value(value: str) -> str:
    """
    Limpia un valor capturado por regex de patrones directos.
    Remueve conectores, artículos iniciales y puntuación que no son parte del dato clínico.
    """
    if not value:
        return value
    
    val = value.strip()
    
    while True:
        cleaned = _LEADING_CONNECTORS_RE.sub("", val).strip()
        if cleaned == val:
            break
        val = cleaned
        
    return val # Retorna lo que quede (puede ser "")

# Patrones para "normal" en contexto específico de ojo/sección.
# IMPORTANTE: Cuando el doctor dice "ojo derecho normal" o "córnea normal",
# esto describe la sección/estructura específica como "Normal",
# NO el checkbox global "Examen normal en ambos ojos".
# Estos patrones tienen prioridad especial en process_segment.
NORMAL_CONTEXT_PATTERNS = [
    # "ojo derecho normal" / "ojo izquierdo normal" / "ambos ojos normal"
    re.compile(r"\bojo\s+(?:derecho|izquierdo)\s+normal\b", re.IGNORECASE),
    re.compile(r"\bambos\s+ojos\s+normal(?:es)?\b", re.IGNORECASE),
    # "<estructura> normal" (cornea normal, conjuntiva normal, etc.)
    re.compile(
        r"\b(?:córnea|cornea|conjuntiva|iris|pupila|cristalino|retina|"
        r"vítreo|vitreo|nervio|mácula|macula|párpado|parpado|esclera|"
        r"cámara|camara|fondo|segmento)\s+(?:\w+\s+)?normal\b",
        re.IGNORECASE
    ),
    # "OD normal", "OI normal"
    re.compile(r"\b(?:OD|OI|AO)\s+normal\b", re.IGNORECASE),
    # "normal" after a structure mention in same segment
    re.compile(r"\b(?:derecho|izquierdo)\s+(?:es\s+)?normal\b", re.IGNORECASE),
]


# Patrones de valores médicos con su campo y valor
MEDICAL_VALUE_PATTERNS: List[Tuple[str, str, List[str]]] = [
    # (campo_parcial, valor, patrones_regex)

    # Hallazgos comunes - normales
    # NOTA: "normal" es un valor que se aplica a la sección/estructura actual,
    # NO al checkbox global "Examen normal en ambos ojos"
    ("normal", "Normal", [
        r"\bsin\s+alteraciones\b", r"\bsano\b",
        r"\bsin\s+hallazgos\b", r"\bsin\s+lesiones\b"
    ]),
    ("transparente", "Transparente", [
        r"\btransparente\b", r"\bclara\b", r"\blimpia\b"
    ]),
    ("profunda", "Profunda", [r"\bprofunda\b"]),
    ("reactiva", "Reactiva", [r"\breactiva\b", r"\breactivas\b"]),
    ("redonda", "Redonda", [r"\bredonda\b", r"\bredondas\b"]),

    # Hallazgos patológicos
    ("opacidad", "Opacidad", [r"\bopacidad\b", r"\bopaco\b"]),
    ("edema", "Edema", [r"\bedema\b", r"\bedematosa\b"]),
    ("hiperemia", "Hiperemia", [r"\bhiperemia\b", r"\bhiperémica\b"]),
    ("infiltrado", "Infiltrado", [r"\binfiltrado\b"]),
    ("neovascularizacion", "Neovascularización", [r"\bneovascularización\b", r"\bneovasos\b"]),
    ("hemorragia", "Hemorragia", [r"\bhemorragia\b"]),
    ("exudado", "Exudado", [r"\bexudado\b", r"\bexudados\b"]),
    ("desprendimiento", "Desprendimiento", [r"\bdesprendimiento\b"]),
    ("catarata", "Catarata", [r"\bcatarata\b"]),
    ("glaucoma", "Glaucoma", [r"\bglaucoma\b"]),
    ("pterigion", "Pterigión", [r"\bpterigión\b", r"\bpterigion\b"]),
    ("pinguécula", "Pingüécula", [r"\bpingüécula\b", r"\bpinguecula\b"]),

    # Valores numéricos de agudeza visual
    ("av_20_20", "20/20", [r"\b20\s*/?\s*20\b", r"\bveinte\s+veinte\b"]),
    ("av_20_25", "20/25", [r"\b20\s*/?\s*25\b"]),
    ("av_20_30", "20/30", [r"\b20\s*/?\s*30\b"]),
    ("av_20_40", "20/40", [r"\b20\s*/?\s*40\b"]),
    ("av_20_50", "20/50", [r"\b20\s*/?\s*50\b"]),
    ("av_20_60", "20/60", [r"\b20\s*/?\s*60\b"]),
    ("av_20_80", "20/80", [r"\b20\s*/?\s*80\b"]),
    ("av_20_100", "20/100", [r"\b20\s*/?\s*100\b"]),
    ("av_20_200", "20/200", [r"\b20\s*/?\s*200\b"]),
    ("av_20_400", "20/400", [r"\b20\s*/?\s*400\b"]),

    # Presión intraocular (números típicos)
    ("pio", "", [r"\b\d{1,2}\s*(?:mmHg|milímetros)\b"]),

    # Dilatación
    ("dilatacion_si", "si", [
        r"\bsí\s+(?:requiere|necesita)\s+dilatación\b",
        r"\bdilatar\b", r"\bdilatación\b", r"\bdilatacion\b"
    ]),
    ("dilatacion_no", "no", [
        r"\bno\s+(?:requiere|necesita)\s+dilatación\b",
        r"\bsin\s+dilatación\b", r"\bno\s+dilatar\b"
    ]),

    # Medicamentos
    ("tropicamida", "Tropicamida", [r"\btropicamida\b"]),
    ("fenilefrina", "Fenilefrina", [r"\bfenilefrina\b"]),
    ("ciclopentolato", "Ciclopentolato", [r"\bciclopentolato\b"]),
    ("atropina", "Atropina", [r"\batropina\b"]),
]

# Patrones para extraer números (PIO, agudeza, etc.)
NUMBER_PATTERN = re.compile(r"\b(\d{1,3}(?:[.,]\d{1,2})?)\b")

# ============================================
# Filtro de relevancia clínica (HU-010)
# ============================================

# Patrones de conversación casual que NO deben generar autofill
CASUAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"^\s*(?:hola|buenos?\s+(?:días|tardes|noches))\s*$",
        r"^\s*(?:cómo\s+(?:está|estás|se\s+siente|le\s+va|amaneció))",
        r"^\s*(?:mucho\s+gusto|un\s+placer|encantado)",
        r"^\s*(?:gracias|muchas\s+gracias|de\s+nada)",
        r"^\s*(?:sí|no|ok|bueno|listo|vale|claro|perfecto|entiendo)\s*$",
        r"^\s*(?:siéntese|siéntate|pase|tome\s+asiento|póngase\s+cómodo)",
        r"^\s*(?:me\s+(?:llamo|nombre)|soy\s+el\s+doctor)",
        r"^\s*(?:cuántos\s+años\s+tiene|qué\s+edad|dónde\s+vive)",
        r"^\s*(?:vamos\s+a\s+(?:ver|revisar|examinar|empezar))",
        r"^\s*(?:mire\s+(?:aquí|acá|hacia)|abra\s+los\s+ojos|cierre)",
        r"^\s*(?:un\s+momento|espere|ya\s+(?:casi|terminamos))",
        r"^\s*(?:tiene\s+(?:alguna\s+)?(?:pregunta|duda|consulta))",
        r"^\s*(?:nos\s+vemos|hasta\s+(?:luego|pronto)|cuídese|chao|adiós)",
        r"^\s*(?:le\s+voy\s+a\s+(?:poner|aplicar|echar)\s+unas?\s+gotas)",
        r"^\s*(?:no\s+se\s+preocupe|tranquilo|está\s+bien|todo\s+(?:bien|normal))\s*$",
        r"^\s*(?:qué\s+(?:lo|le)\s+trae|cuál\s+es\s+el\s+motivo)",
    ]
]

# Palabras clave que indican contenido clínico relevante
CLINICAL_KEYWORDS = re.compile(
    r"\b(?:"
    # Estructuras anatómicas
    r"córnea|cornea|conjuntiva|iris|pupila|cristalino|retina|vítreo|vitreo|"
    r"nervio|mácula|macula|párpado|parpado|esclera|cámara|camara|"
    # Hallazgos
    r"normal|transparente|opacidad|edema|hiperemia|infiltrado|hemorragia|"
    r"exudado|catarata|glaucoma|pterigión|pterigion|desprendimiento|"
    r"neovascularización|neovasos|reactiva|redonda|profunda|"
    # Mediciones
    r"agudeza|visual|presión|presion|PIO|tonometría|tonometria|"
    r"20\s*/\s*\d+|mmHg|dioptrías|dioptrias|"
    # Ojos
    r"ojo\s+derecho|ojo\s+izquierdo|ambos\s+ojos|OD|OI|AO|"
    r"derecho|izquierdo|bilateral|"
    # Secciones de examen
    r"biomicroscopia|lámpara|lampara|fondo\s+de\s+ojo|fondoscopia|"
    r"segmento\s+anterior|segmento\s+posterior|anexos|"
    # Medicamentos
    r"tropicamida|fenilefrina|ciclopentolato|atropina|latanoprost|"
    r"timolol|dorzolamida|brimonidina|"
    # Acciones clínicas
    r"dilatación|dilatacion|dilatar|refracción|refraccion|"
    r"diagnóstico|diagnostico|tratamiento|hallazgo|"
    # Campos de historia clínica y tiempo de evolución
    r"motivo\s+de\s+consulta|enfermedad\s+actual|consulta\s+por|viene\s+por|"
    r"padecimiento|cuadro\s+clínico|cuadro\s+clinico|"
    r"antecedente|alergia|medicamento|cirugía|cirugia|"
    r"evolución|evolucion|tiempo|cantidad|valor|unidad|"
    r"segundos?|minutos?|horas?|días?|dias?|semanas?|meses|mes|años?|anios?"
    # Condiciones
    r"sin\s+alteraciones|sin\s+hallazgos|sin\s+lesiones|sano"
    r")\b",
    re.IGNORECASE
)

# Normalización de fechas y valores médicos
DATE_PATTERNS = [
    # "15 de enero de 2024", "15 de enero 2024"
    (re.compile(
        r"\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|"
        r"julio|agosto|septiembre|octubre|noviembre|diciembre)"
        r"(?:\s+(?:de\s+|del\s+)?(\d{4}))?\b",
        re.IGNORECASE
    ), "date_long"),
    # "15/01/2024", "15-01-2024"
    (re.compile(r"\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})\b"), "date_numeric"),
    # "hoy", "ayer"
    (re.compile(r"\bhoy\b", re.IGNORECASE), "date_today"),
    (re.compile(r"\bayer\b", re.IGNORECASE), "date_yesterday"),
]

MONTH_MAP = {
    "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
    "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
    "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12",
}


def is_clinically_relevant(text: str) -> bool:
    """
    Determina si un segmento de texto contiene información
    clínica relevante para la historia clínica.
    Retorna False para conversación casual.
    """
    text_stripped = text.strip()

    # Textos muy cortos (< 3 palabras) sin keywords → casual
    word_count = len(text_stripped.split())
    if word_count < 2:
        return False

    # Coincide con patrón casual → no relevante
    for pattern in CASUAL_PATTERNS:
        if pattern.search(text_stripped):
            return False

    # Contiene keywords clínicos → relevante
    if CLINICAL_KEYWORDS.search(text_stripped):
        return True

    # Contiene números que podrían ser mediciones (PIO, agudeza)
    if re.search(r"\b\d{1,2}\s*/\s*\d{1,3}\b", text_stripped):  # 20/20
        return True
    if re.search(r"\b\d{1,2}\s*(?:mmHg|mm)\b", text_stripped, re.IGNORECASE):
        return True

    # Si tiene más de 5 palabras pero no matchea nada → ambiguo, dejar pasar
    # para que el LLM decida (el LLM tiene su propio filtro)
    if word_count >= 5:
        return True

    # Por defecto, segmentos cortos sin keywords → no relevante
    return False


def normalize_value(value: str, field_type: str = "text") -> str:
    """
    Normaliza un valor extraído según el tipo de campo.
    - Fechas → formato YYYY-MM-DD
    - Texto médico → capitalización correcta
    - Números → formato limpio
    """
    if not value:
        return value

    # Normalizar fechas
    for pattern, date_type in DATE_PATTERNS:
        match = pattern.search(value)
        if match:
            return _normalize_date(match, date_type)

    # Mapeos específicos para Origen de la Atención
    origin_map = {
        "general": "Enfermedad general",
        "enfermedad general": "Enfermedad general",
        "url": "Accidente de trabajo",
        "laboral": "Accidente de trabajo",
        "accidente laboral": "Accidente de trabajo",
        "accidente de trabajo": "Accidente de trabajo",
        "profesional": "Enfermedad profesional",
        "enfermedad profesional": "Enfermedad profesional",
        "transito": "SOAT (Accidente de tránsito)",
        "tránsito": "SOAT (Accidente de tránsito)",
        "soat": "SOAT (Accidente de tránsito)",
        "soat tránsito": "SOAT (Accidente de tránsito)",
        "soat transito": "SOAT (Accidente de tránsito)"
    }
    
    # Mapeo para unidades de tiempo de evolución
    time_unit_map = {
        "segundo": "Segundo(s)",
        "segundos": "Segundo(s)",
        "minuto": "Minuto(s)",
        "minutos": "Minuto(s)",
        "dia": "Día(s)",
        "día": "Día(s)",
        "dias": "Día(s)",
        "días": "Día(s)",
        "semanas": "Semana(s)",
        "mes": "Mes(es)",
        "meses": "Mes(es)",
        "hora": "Hora(s)",
        "horas": "Hora(s)",
        "año": "Año(s)",
        "año(s)": "Año(s)",
        "años": "Año(s)",
        "anio": "Año(s)"
    }
    
    # Normalizar valor para búsqueda en los mapas
    val_clean = value.lower().strip().rstrip(".").strip()
    
    if val_clean in origin_map:
        return origin_map[val_clean]
    if val_clean in time_unit_map:
        return time_unit_map[val_clean]

    # Normalizar según tipo de campo
    if field_type == "number":
        # Limpiar separadores
        cleaned = value.replace(",", ".").strip()
        try:
            num = float(cleaned)
            return str(int(num)) if num == int(num) else str(num)
        except ValueError:
            return value

    if field_type == "checkbox":
        # Búsqueda más robusta de sí/no dentro de la frase dictada
        val_lower = value.lower()
        # Patrones para afirmativo
        if re.search(r"\b(sí|si|afirmativo|correcto|marcar|activar|yes|true|1)\b", val_lower):
            return "true"
        # Patrones para negativo
        if re.search(r"\b(no|negativo|desactivar|quitar|false|0)\b", val_lower):
            return "false"
        return value

    # Texto médico: capitalizar primera letra
    if field_type in ("text", "textarea"):
        return value.strip().capitalize() if value else value

    return value


def _normalize_date(match: re.Match, date_type: str) -> str:
    """Convierte una fecha a formato YYYY-MM-DD."""
    today = datetime.now()

    if date_type == "date_today":
        return today.strftime("%Y-%m-%d")

    if date_type == "date_yesterday":
        from datetime import timedelta
        yesterday = today - timedelta(days=1)
        return yesterday.strftime("%Y-%m-%d")

    if date_type == "date_long":
        day = match.group(1).zfill(2)
        month = MONTH_MAP.get(match.group(2).lower(), "01")
        year = match.group(3) if match.group(3) else str(today.year)
        return f"{year}-{month}-{day}"

    if date_type == "date_numeric":
        day = match.group(1).zfill(2)
        month = match.group(2).zfill(2)
        year = match.group(3)
        if len(year) == 2:
            year = f"20{year}"
        return f"{year}-{month}-{day}"

    return match.group(0)


class RealtimeExtractor:
    """
    Extractor stateful que procesa segmentos de transcripción
    y genera autofill parcial en tiempo real.
    """

    def __init__(self):
        self.current_eye: Optional[str] = None
        self.current_section: Optional[str] = None
        self.biowel_fields: List[BiowelFieldIdentifier] = []
        self.already_filled: Dict[str, str] = {}

        # Compilar patrones una vez
        self._compiled_eye = {
            eye: [re.compile(p, re.IGNORECASE) for p in patterns]
            for eye, patterns in EYE_PATTERNS.items()
        }
        self._compiled_sections = {
            section: [re.compile(p, re.IGNORECASE) for p in patterns]
            for section, patterns in SECTION_PATTERNS.items()
        }
        self._compiled_values = [
            (field, value, [re.compile(p, re.IGNORECASE) for p in patterns])
            for field, value, patterns in MEDICAL_VALUE_PATTERNS
        ]
        # Compilar patrones directos (keyword → data-testid)
        self._compiled_direct = [
            (testid, capture_type, [re.compile(p, re.IGNORECASE) for p in patterns])
            for testid, capture_type, patterns in DIRECT_FIELD_PATTERNS
        ]

        logger.info("RealtimeExtractor inicializado")

    def set_biowel_fields(self, fields: List[Dict]) -> None:
        """Recibe los campos escaneados del DOM de Biowel."""
        self.biowel_fields = [
            BiowelFieldIdentifier(**f) for f in fields
        ]
        logger.info(f"Campos Biowel cargados: {len(self.biowel_fields)}")

    def set_already_filled(self, filled: Dict[str, str]) -> None:
        """Recibe campos ya llenos para no repetirlos."""
        self.already_filled = filled

    def process_segment(self, text: str) -> List[PartialAutofillItem]:
        """
        Procesa un segmento de transcripción final y extrae
        campos para autofill parcial.
        """
        if not text or not text.strip():
            return []

        # Filtro de relevancia clínica: ignorar conversación casual
        if not is_clinically_relevant(text):
            logger.debug(f"[Extractor] Segmento casual ignorado: '{text[:50]}'")
            return []

        items: List[PartialAutofillItem] = []
        text_lower = text.lower().strip()

        # 0. Check for "Evolution Time Anchored" (ej: "2 días")
        for anchored_match in EVOLUTION_TIME_ANCHORED_RE.finditer(text_lower):
            val_num, val_unit = anchored_match.groups()
            normalized_unit = normalize_value(val_unit, "select")
            
            # Crear items para ambos campos
            items.append(PartialAutofillItem(
                unique_key="attention-origin-evolution-time-input",
                value=val_num.replace(",", "."),
                confidence=0.98
            ))
            items.append(PartialAutofillItem(
                unique_key="attention-origin-evolution-time-unit-select",
                value=normalized_unit,
                confidence=0.98
            ))
            logger.info(f"[Extractor-ANCHORED] Tiempo evolución encontrado: {val_num} {normalized_unit}")
            # Seguimos buscando más matches en el mismo segmento
        
        text_original = text.strip()

        # 0. Patrones DIRECTOS (keyword → data-testid de Biowel)
        #    Estos tienen prioridad máxima y mapean directo
        for testid, capture_type, patterns in self._compiled_direct:
            if testid in self.already_filled:
                continue
            for pattern in patterns:
                match = pattern.search(text_original)
                if match:
                    if capture_type == "after" and match.lastindex and match.lastindex >= 1:
                        value = match.group(1).strip()
                    else:
                        value = text_original

                    if value:
                        # Limpiar conectores/artículos iniciales
                        # "es el atigmatismo" → "atigmatismo"
                        value = clean_captured_value(value)
                        normalized = normalize_value(value, "textarea")
                        items.append(PartialAutofillItem(
                            unique_key=testid,
                            value=normalized,
                            confidence=0.95
                        ))
                        self.already_filled[testid] = normalized
                        logger.info(
                            f"[Extractor-DIRECTO] '{testid}' = '{normalized[:50]}' "
                            f"(patrón: {pattern.pattern[:30]})"
                        )
                    break  # Un match es suficiente por campo

        # Si ya encontramos match directo, retornar
        if items:
            return items

        # 1. Actualizar contexto (ojo, sección)
        self._update_context(text_lower)

        # 0.5. Check for "normal" in specific context (ojo/estructura + normal)
        # This prevents "ojo derecho normal" from triggering the global checkbox
        for ncp in NORMAL_CONTEXT_PATTERNS:
            if ncp.search(text_original):
                # "normal" refers to specific eye/section, NOT global checkbox
                logger.info(
                    f"[Extractor] 'normal' en contexto específico: "
                    f"ojo={self.current_eye}, sección={self.current_section}"
                )
                # Map to section-specific field with current eye context
                section_normal_items = self._map_contextual_normal(text_original)
                if section_normal_items:
                    return section_normal_items
                # If no specific field found, skip (don't let it fall to global)
                break

        # 2. Extraer valores médicos
        matched_values = self._extract_values(text_lower)

        # 3. Mapear valores a campos de Biowel con normalización
        for field_hint, value in matched_values:
            matched_fields = self._match_to_biowel_field(field_hint, value)
            for unique_key, final_value in matched_fields:
                if unique_key in self.already_filled:
                    continue

                field_type = self._get_field_type(unique_key)
                normalized_value = normalize_value(final_value, field_type)

                items.append(PartialAutofillItem(
                    unique_key=unique_key,
                    value=normalized_value,
                    confidence=0.85
                ))

        if items:
            logger.info(
                f"[Extractor] Segmento: '{text[:50]}...' → "
                f"{len(items)} campos extraídos "
                f"(ojo={self.current_eye}, sección={self.current_section})"
            )

        return items

    def is_relevant(self, text: str) -> bool:
        """Expone el filtro de relevancia para uso externo (main.py)."""
        return is_clinically_relevant(text)

    def detect_keyword(self, text: str) -> Optional[Tuple[str, str, str]]:
        """Detecta la última palabra clave en el texto (más robusto para cumulative)."""
        text_lower = text.lower()
        best_match = None
        max_idx = -1
        
        # 1. Buscar comandos primeramente (listo, borrar)
        for cmd, testid in COMMAND_KEYWORDS.items():
            idx = text_lower.rfind(cmd)
            if idx != -1 and idx > max_idx:
                max_idx = idx
                best_match = (testid, cmd, text[idx + len(cmd):].strip())

        # 2. Buscar palabras clave de campo
        for keyword, testid in KEYWORD_TO_FIELD.items():
            kw_lower = keyword.lower()
            idx = text_lower.rfind(kw_lower)
            if idx != -1:
                # Prioridad: 1. Posición más tardía, 2. Longitud de keyword
                if idx > max_idx:
                    max_idx = idx
                    best_match = (testid, keyword, text[idx + len(kw_lower):].strip())
                elif idx == max_idx:
                    if best_match and len(keyword) > len(best_match[1]):
                        best_match = (testid, keyword, text[idx + len(kw_lower):].strip())
        
        if best_match:
            testid, keyword, content_after = best_match
            content_after = clean_captured_value(content_after)
            logger.debug(f"[Keyword] Match: '{keyword}' en idx {max_idx}")
            return (testid, keyword, content_after)
        return None

    def classify_section(self, text: str) -> Optional[str]:
        """
        CAPA 2: Clasifica un segmento de texto en una sección del formulario.
        Retorna el nombre de la sección si hay match, None si no.
        Ejecuta en <5ms (pure regex, sin LLM).
        """
        text_stripped = text.strip()
        if not text_stripped:
            return None

        for section_name, patterns in SECTION_CLASSIFIERS.items():
            for pattern in patterns:
                if pattern.search(text_stripped):
                    logger.debug(
                        f"[Classifier] Sección '{section_name}' "
                        f"detectada para '{text_stripped[:50]}'"
                    )
                    return section_name

        return None

    def reset(self) -> None:
        """Reinicia el estado del extractor."""
        self.current_eye = None
        self.current_section = None
        self.already_filled = {}

    def _update_context(self, text: str) -> None:
        """Actualiza el ojo y sección actuales basándose en el texto."""
        # Detectar ojo
        for eye, patterns in self._compiled_eye.items():
            for pattern in patterns:
                if pattern.search(text):
                    self.current_eye = eye
                    logger.debug(f"[Contexto] Ojo actualizado: {eye}")
                    break

        # Detectar sección
        for section, patterns in self._compiled_sections.items():
            for pattern in patterns:
                if pattern.search(text):
                    self.current_section = section
                    logger.debug(f"[Contexto] Sección actualizada: {section}")
                    break

    def _extract_values(self, text: str) -> List[Tuple[str, str]]:
        """Extrae pares (hint_campo, valor) del texto."""
        results: List[Tuple[str, str]] = []

        for field_hint, value, patterns in self._compiled_values:
            for pattern in patterns:
                match = pattern.search(text)
                if match:
                    # Caso especial para PIO: extraer el número
                    if field_hint == "pio":
                        num_match = NUMBER_PATTERN.search(match.group())
                        if num_match:
                            value = num_match.group(1)
                    results.append((field_hint, value))
                    break  # Una coincidencia por patrón es suficiente

        return results

    def _match_to_biowel_field(
        self, field_hint: str, value: str
    ) -> List[Tuple[str, str]]:
        """
        Dado un hint de campo y valor, busca los campos Biowel
        que correspondan usando el contexto actual (ojo, sección).
        """
        matches: List[Tuple[str, str]] = []

        if not self.biowel_fields:
            # Si no hay campos Biowel, generar key genérica
            key_parts = []
            if self.current_section:
                key_parts.append(self.current_section)
            if self.current_eye:
                key_parts.append(self.current_eye.lower())
            key_parts.append(field_hint)
            generic_key = "_".join(key_parts)
            matches.append((generic_key, value))
            return matches

        for field in self.biowel_fields:
            score = self._field_match_score(field, field_hint)
            if score > 0:
                matches.append((field.unique_key, value))

        # Si no hay match exacto, generar key genérica
        if not matches:
            key_parts = []
            if self.current_section:
                key_parts.append(self.current_section)
            if self.current_eye:
                key_parts.append(self.current_eye.lower())
            key_parts.append(field_hint)
            generic_key = "_".join(key_parts)
            matches.append((generic_key, value))

        return matches

    def _field_match_score(
        self, field: BiowelFieldIdentifier, hint: str
    ) -> float:
        """
        Calcula un score de coincidencia entre un campo Biowel
        y un hint de campo extraído.
        """
        score = 0.0

        # El hint debe estar en el unique_key, label o testid
        hint_lower = hint.lower()
        key_lower = field.unique_key.lower()
        label_lower = field.label.lower()
        testid_lower = field.data_testid.lower()

        if hint_lower in key_lower or hint_lower in testid_lower:
            score += 0.5
        elif hint_lower in label_lower:
            score += 0.3

        # El ojo actual debe coincidir (si aplica)
        if self.current_eye and field.eye:
            if field.eye == self.current_eye:
                score += 0.3
            else:
                return 0  # Ojo incorrecto, descartado

        # La sección actual debe coincidir (si aplica)
        if self.current_section and field.section:
            if field.section == self.current_section:
                score += 0.2
            else:
                score *= 0.5  # Penalizar pero no descartar

        return score

    def _map_contextual_normal(self, text: str) -> List[PartialAutofillItem]:
        """
        Cuando el doctor dice "ojo derecho normal" o "córnea normal",
        mapea "Normal" al campo textarea de la sección/ojo correcto,
        NO al checkbox global "Examen normal en ambos ojos".

        Busca campos Biowel que coincidan con el ojo y sección actuales
        y que sean textarea (no checkbox).
        """
        items = []

        if not self.biowel_fields:
            return items

        # Buscar campos que coincidan con sección + ojo actual y sean textarea
        for field in self.biowel_fields:
            key = field.unique_key.lower()
            ftype = field.field_type

            # Excluir checkboxes (eso es lo que queremos evitar)
            if ftype == 'checkbox':
                continue

            # Solo textareas e inputs de texto
            if ftype not in ('textarea', 'text'):
                continue

            # Verificar que coincide con el ojo actual
            if self.current_eye:
                if field.eye and field.eye != self.current_eye:
                    continue
                # Si no tiene eye pero la key contiene referencia al ojo equivocado
                if self.current_eye == 'OD' and ('oi' in key or 'izquierdo' in key or 'left' in key):
                    continue
                if self.current_eye == 'OI' and ('od' in key or 'derecho' in key or 'right' in key):
                    continue

            # Verificar sección
            if self.current_section:
                if field.section and field.section == self.current_section:
                    # Perfect match: sección + ojo
                    unique_key = field.unique_key
                    if unique_key not in self.already_filled:
                        items.append(PartialAutofillItem(
                            unique_key=unique_key,
                            value="Normal",
                            confidence=0.9
                        ))
                        self.already_filled[unique_key] = "Normal"
                        logger.info(
                            f"[Extractor-NORMAL] Sección '{self.current_section}' "
                            f"ojo={self.current_eye} → '{unique_key}' = Normal"
                        )

        return items

    def get_field_type(self, unique_key: str) -> str:
        """Retorna el tipo de campo para un unique_key dado."""
        if not unique_key:
            return "text"
            
        # Fallback para campos de producción conocidos si biowel_fields está vacío
        if "select" in unique_key:
            return "select"
        if "switch" in unique_key or "check" in unique_key:
            return "checkbox"
        if "evolution-time-input" in unique_key:
            return "number"
        if "badge-field" in unique_key or "history" in unique_key:
            return "textarea"
            
        if self.biowel_fields:
            for field in self.biowel_fields:
                if field.unique_key == unique_key:
                    return field.field_type
                    
        return "text"
