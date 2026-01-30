from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

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