from app.models import FormStructure, FieldMapping, ValidationResult
from typing import Dict, Any, List

class FormValidator:
    def __init__(self, form_structure: FormStructure):
        self.form_structure = form_structure

    def validate_mappings(self, mappings: List[FieldMapping]) -> ValidationResult:
        """
        Valida que todos los campos requeridos estén completos
        """
        # Campos mapeados
        filled_fields = {mapping.field_name for mapping in mappings}
        
        # Verificar si requiere dilatación
        requiere_dilatacion = next(
            (mapping.value for mapping in mappings if mapping.field_name == 'requiere_dilatacion'), 
            None
        )
        
        # Determinar campos requeridos según requiere_dilatacion
        if requiere_dilatacion == 'no':
            # Si NO requiere dilatación, solo validar estos campos
            required_fields = ['requiere_dilatacion', 'motivo_no_dilatacion']
        elif requiere_dilatacion == 'si':
            # Si SÍ requiere dilatación, validar campos del registro (excepto motivo)
            required_fields = [
                field.name 
                for field in self.form_structure.fields 
                if field.required and field.name != 'motivo_no_dilatacion'
            ]
        else:
            # Si no se especificó requiere_dilatacion, usar todos los campos requeridos
            required_fields = [
                field.name 
                for field in self.form_structure.fields 
                if field.required
            ]
        
        # Campos faltantes
        missing_fields = [
            field for field in required_fields 
            if field not in filled_fields
        ]
        
        # Validar tipos de datos
        errors = self._validate_field_types(mappings)
        
        return ValidationResult(
            is_valid=len(missing_fields) == 0 and len(errors) == 0,
            missing_fields=missing_fields,
            filled_fields=list(filled_fields),
            errors=errors
        )
       
    def _validate_field_types(self, mappings: List[FieldMapping]) -> List[str]:
        """Valida tipos de datos"""
        errors = []
        
        for mapping in mappings:
            field = self._get_field_by_name(mapping.field_name)
            if not field:
                continue
            
            # Validar opciones de select/radio
            if field.options and mapping.value not in [opt.value for opt in field.options]:
                errors.append(
                    f"Valor inválido para {field.label}: '{mapping.value}' no está en las opciones"
                )
        
        return errors
    
    def _get_field_by_name(self, field_name: str):
        """Obtiene un campo por su nombre"""
        for field in self.form_structure.fields:
            if field.name == field_name:
                return field
        return None
    
    def get_missing_fields_message(self, missing_fields: List[str]) -> str:
        """
        Genera mensaje legible de campos faltantes
        """
        if not missing_fields:
            return "Formulario completo"
        
        field_labels = []
        for field_name in missing_fields:
            field = self._get_field_by_name(field_name)
            if field:
                field_labels.append(field.label)
        
        return f"Faltan los siguientes campos obligatorios: {', '.join(field_labels)}"