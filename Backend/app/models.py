from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any, Literal

class FormFieldOption(BaseModel):
    value: str
    text: str

class FormField(BaseModel):
    name: str
    id: Optional[str] = None
    label: str
    type: str
    required: bool = False
    selector: str
    options: Optional[List[FormFieldOption]] = None

class FormStructure(BaseModel):
    form_id: str
    fields: List[FormField]

class TranscriptionChunk(BaseModel):
    text: str
    is_final: bool = False

class FieldMapping(BaseModel):
    field_name: str
    value: Any
    confidence: float = 1.0

class ValidationResult(BaseModel):
    is_valid: bool
    missing_fields: List[str] = []
    filled_fields: List[str] = []
    errors: List[str] = []

class WebSocketMessage(BaseModel):
    type: str
    data: Optional[Any] = None
    text: Optional[str] = None
    message: Optional[str] = None


# ============================================
# Modelos para Biowel (HU-009)
# ============================================

VALID_FIELD_TYPES = {"text", "select", "checkbox", "radio", "textarea", "number"}
VALID_EYE_VALUES = {"OD", "OI", "AO"}


class BiowelFieldIdentifier(BaseModel):
    """Identificador de un campo en el DOM de Biowel."""
    data_testid: str
    unique_key: str  # ej: cornea_od_checkbox
    label: str
    field_type: str  # text, select, checkbox, radio, textarea, number
    eye: Optional[str] = None  # OD, OI, AO, None
    section: Optional[str] = None  # ej: "cornea", "retina"
    options: Optional[List[str]] = None

    @field_validator("field_type")
    @classmethod
    def validate_field_type(cls, v: str) -> str:
        if v not in VALID_FIELD_TYPES:
            return "text"  # Fallback seguro
        return v

    @field_validator("eye")
    @classmethod
    def validate_eye(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_EYE_VALUES:
            return None
        return v


class PartialAutofillItem(BaseModel):
    """Un campo individual para autofill parcial en tiempo real."""
    unique_key: str
    value: Any
    confidence: float = 1.0


class PartialAutofillMessage(BaseModel):
    """Mensaje de autofill parcial enviado al frontend."""
    type: str = "partial_autofill"
    items: List[PartialAutofillItem]
    source_text: str = ""  # el segmento de transcripción que generó esto