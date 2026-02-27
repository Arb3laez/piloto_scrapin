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
    "motivo de la consulta": "attention-origin-reason-for-consulting-badge-field",
    "el motivo de consulta": "attention-origin-reason-for-consulting-badge-field",
    "motivo se consulta": "attention-origin-reason-for-consulting-badge-field",
    # NOTA: "motivo" suelto y "consulta por" ELIMINADOS — causaban activaciones falsas

    "enfermedad actual": "attention-origin-current-disease-badge-field",
    "la enfermedad actual": "attention-origin-current-disease-badge-field",
    # NOTA: "padecimiento actual", "cuadro clínico" ELIMINADOS — causaban activaciones falsas
    # NOTA: "enfermedad" suelto ELIMINADO — causaba cambios accidentales de campo
    

    "origen de la atención": "attention-origin-select",
    "origen de atención": "attention-origin-select",
    "origen de atencion": "attention-origin-select",
    "Origen de atencion": "attention-origin-select",
    "Origen de atención": "attention-origin-select",


    
    "general": "attention-origin-select",
    "enfermedad general": "attention-origin-select",
    "url": "attention-origin-select",
    "soat": "attention-origin-select",
    "accidente de tránsito": "attention-origin-select",
    "accidente de transito": "attention-origin-select",
    "laboral": "attention-origin-select",
    "accidente de trabajo": "attention-origin-select",
    "enfermedad profesional": "attention-origin-select",
    "profesional": "attention-origin-select",
    "evento adverso": "attention-origin-adverse-event-checkbox",
    "adverso": "attention-origin-adverse-event-checkbox",

    # Examen físico / ocular
    "ojos normales": "oftalmology-all-normal-checkbox",
    "examen normal": "oftalmology-all-normal-checkbox",
    "examen normal en ambos ojos": "oftalmology-all-normal-checkbox",
    "normal en ambos ojos": "oftalmology-all-normal-checkbox",
    "ambos ojos normales": "oftalmology-all-normal-checkbox",
    "todo normal": "oftalmology-all-normal-checkbox",
    "examen de ojos normal": "oftalmology-all-normal-checkbox",
    "examen ojos normal": "oftalmology-all-normal-checkbox",
    "examen de ojo normal": "oftalmology-all-normal-checkbox",
    "ojo normal": "oftalmology-all-normal-checkbox",
    "ojos normal": "oftalmology-all-normal-checkbox",
    "examen de ambos ojos normal": "oftalmology-all-normal-checkbox",
    "ambos ojos normal": "oftalmology-all-normal-checkbox",
    "examen ocular normal": "oftalmology-all-normal-checkbox",

    "impresión diagnóstica": "diagnostic-impression-diagnosis-select",
    
    # Tipo de diagnóstico (radio buttons CIE-10)
    "diagnóstico simple": "diagnostic-impression-type-cie10-radio",
    "diagnostico simple": "diagnostic-impression-type-cie10-radio",
    "idx simple": "diagnostic-impression-type-cie10-radio",
    "idx": "diagnostic-impression-type-cie10-radio",
    "diagnóstico ampliado": "diagnostic-impression-type-extended-radio",
    "diagnostico ampliado": "diagnostic-impression-type-extended-radio",
    "diagnóstico amplio": "diagnostic-impression-type-extended-radio",
    "diagnostico amplio": "diagnostic-impression-type-extended-radio",
    "diagnóstico amplia": "diagnostic-impression-type-extended-radio",
    "diagnostico amplia": "diagnostic-impression-type-extended-radio",
    "idx ampliada": "diagnostic-impression-type-extended-radio",
    "idx amplio": "diagnostic-impression-type-extended-radio",
    "ampliada": "diagnostic-impression-type-extended-radio",
    "ampliado": "diagnostic-impression-type-extended-radio",
    "amplio": "diagnostic-impression-type-extended-radio",

    # Paso 1: Abrir dropdown de categorías CIE-10 (click en contenedor scoped)
    "selección de diagnóstico amplio": "diagnostic-impression-diagnosis-select",
    "seleccion de diagnostico amplio": "diagnostic-impression-diagnosis-select",
    "selección diagnóstico amplio": "diagnostic-impression-diagnosis-select",
    "seleccion diagnostico amplio": "diagnostic-impression-diagnosis-select",
    "selección de diagnóstico ampliado": "diagnostic-impression-diagnosis-select",
    "seleccion de diagnostico ampliado": "diagnostic-impression-diagnosis-select",
    "selección diagnóstico ampliado": "diagnostic-impression-diagnosis-select",
    "seleccion diagnostico ampliado": "diagnostic-impression-diagnosis-select",
    "selección de diagnóstico ampliada": "diagnostic-impression-diagnosis-select",
    "seleccion de diagnostico ampliada": "diagnostic-impression-diagnosis-select",
    "seleccionar diagnóstico ampliado": "diagnostic-impression-diagnosis-select",
    "seleccionar diagnostico ampliado": "diagnostic-impression-diagnosis-select",

    # Paso 2: Categorías CIE-10 de diagnóstico ampliado — data-testid directos
    # select-option-0 = Prueba Qqq (no se registra, es de prueba)
    "enfermedades del aparato circulatorio": "select-option-1",
    "enfermedades aparato circulatorio": "select-option-1",
    "aparato circulatorio": "select-option-1",

    "enfermedades del aparato respiratorio": "select-option-2",
    "enfermedades aparato respiratorio": "select-option-2",
    "aparato respiratorio": "select-option-2",

    "enfermedades del aparato digestivo": "select-option-3",
    "enfermedades aparato digestivo": "select-option-3",
    "aparato digestivo": "select-option-3",

    "enfermedades de la piel y el tejido subcutáneo": "select-option-4",
    "enfermedades de la piel y el tejido subcutaneo": "select-option-4",
    "enfermedades de la piel": "select-option-4",
    "tejido subcutáneo": "select-option-4",
    "tejido subcutaneo": "select-option-4",

    "enfermedades del sistema osteomuscular y del tejido conectivo": "select-option-5",
    "enfermedades del sistema osteomuscular": "select-option-5",
    "sistema osteomuscular": "select-option-5",
    "tejido conectivo": "select-option-5",

    "enfermedades de la sangre y de los órganos hematopoyéticos": "select-option-6",
    "enfermedades de la sangre y de los organos hematopoyeticos": "select-option-6",
    "enfermedades de la sangre": "select-option-6",
    "órganos hematopoyéticos": "select-option-6",
    "organos hematopoyeticos": "select-option-6",

    "enfermedades endocrinas nutricionales y metabólicas": "select-option-7",
    "enfermedades endocrinas nutricionales y metabolicas": "select-option-7",
    "enfermedades endocrinas": "select-option-7",
    "endocrinas nutricionales": "select-option-7",

    "trastornos mentales y del comportamiento": "select-option-8",
    "trastornos mentales": "select-option-8",

    "enfermedades del ojo y sus anexos": "select-option-9",
    "enfermedades del ojo": "select-option-9",

    # Paso 3: Ojo del diagnóstico (radio buttons nativos)
    "diagnóstico ojo derecho": "diagnostic-impression-eye-radio-0",
    "diagnostico ojo derecho": "diagnostic-impression-eye-radio-0",
    "diagnóstico ojo izquierdo": "diagnostic-impression-eye-radio-1",
    "diagnostico ojo izquierdo": "diagnostic-impression-eye-radio-1",
    "diagnóstico ambos ojos": "diagnostic-impression-eye-radio-2",
    "diagnostico ambos ojos": "diagnostic-impression-eye-radio-2",
    "diagnóstico no aplica": "diagnostic-impression-eye-radio-3",
    "diagnostico no aplica": "diagnostic-impression-eye-radio-3",

    # Paso 4: Agregar diagnóstico (botón +)
    "agregar diagnóstico": "diagnostic-impression-add-button",
    "agregar diagnostico": "diagnostic-impression-add-button",
    "Agregar": "diagnostic-impression-add-button",
    "Agregar diagnóstico": "diagnostic-impression-add-button",


    # Observaciones del examen físico
    "observaciones del examen físico": "oftalmology-observations-textarea",
    "observaciones del examen fisico": "oftalmology-observations-textarea",
    "observaciones de examen": "oftalmology-observations-textarea",
    "observaciones de examen físico": "oftalmology-observations-textarea",
    "observaciones de examen fisico": "oftalmology-observations-textarea",
    "observaciones examen": "oftalmology-observations-textarea",
    "observaciones examen físico": "oftalmology-observations-textarea",
    "observaciones examen fisico": "oftalmology-observations-textarea",
    "observaciones": "oftalmology-observations-textarea",

    # Análisis y plan
    "análisis y plan": "analysis-and-plan-textarea",
    "analisis y plan": "analysis-and-plan-textarea",
    "análisis y plan de tratamiento": "analysis-and-plan-textarea",
    "analisis y plan de tratamiento": "analysis-and-plan-textarea",
    # NOTA: "análisis" suelto, "analisis" suelto, "plan" suelto, "análisis plan" ELIMINADOS — causaban activaciones falsas
    
    # Tiempo de evolución
    "cantidad": "attention-origin-evolution-time-input",
    "valor": "attention-origin-evolution-time-input",
    "tiempo": "attention-origin-evolution-time-unit-select",
    "unidad": "attention-origin-evolution-time-unit-select",

    # ============================================
    # Preconsulta - Dropdown items (click directo)
    # ============================================
    "preconsulta dilatación": "header-preconsultation-dropdown-item-0",
    "preconsulta dilatacion": "header-preconsultation-dropdown-item-0",
    "dilatación": "header-preconsultation-dropdown-item-0",
    "dilatacion": "header-preconsultation-dropdown-item-0",

    "preconsulta signos vitales": "header-preconsultation-dropdown-item-1",
    "signos vitales": "header-preconsultation-dropdown-item-1",

    "preconsulta tamizaje ocular": "header-preconsultation-dropdown-item-2",
    "tamizaje ocular": "header-preconsultation-dropdown-item-2",
    "tamizaje": "header-preconsultation-dropdown-item-2",

    "preconsulta conciliación medicamentosa": "header-preconsultation-dropdown-item-3",
    "preconsulta conciliacion medicamentosa": "header-preconsultation-dropdown-item-3",
    "conciliación medicamentosa": "header-preconsultation-dropdown-item-3",
    "conciliacion medicamentosa": "header-preconsultation-dropdown-item-3",

    "preconsulta ortoptica": "header-preconsultation-dropdown-item-4",
    "preconsulta ortóptica": "header-preconsultation-dropdown-item-4",
    "ortóptica": "header-preconsultation-dropdown-item-4",
    "ortoptica": "header-preconsultation-dropdown-item-4",
    "Ortóptica": "header-preconsultation-dropdown-item-4",

    # ============================================
    # Preconsulta - Tabs (dentro de pantalla preconsulta)
    # ============================================
    "tab dilatación": "preconsultation-tab-dilatation",
    "tab dilatacion": "preconsultation-tab-dilatation",

    "tab signos vitales": "preconsultation-tab-vitalSigns",

    "tab tamizaje ocular": "preconsultation-tab-eyescreening",
    "tab tamizaje": "preconsultation-tab-eyescreening",

    "tab conciliación medicamentosa": "preconsultation-tab-medicines",
    "tab conciliacion medicamentosa": "preconsultation-tab-medicines",
    "tab medicamentos": "preconsultation-tab-medicines",

    "clasificación del riesgo": "preconsultation-tab-fallRiskAssessment",
    "clasificacion del riesgo": "preconsultation-tab-fallRiskAssessment",
    "riesgo de caída": "preconsultation-tab-fallRiskAssessment",
    "riesgo de caida": "preconsultation-tab-fallRiskAssessment",
    "tab clasificación del riesgo": "preconsultation-tab-fallRiskAssessment",
    "tab clasificacion del riesgo": "preconsultation-tab-fallRiskAssessment",

    # ============================================
    # Clasificación del Riesgo - Radio buttons
    # ============================================
    # Caídas previas
    "caídas previas sí": "fall-risk-previousFalls-yes-radio",
    "caidas previas si": "fall-risk-previousFalls-yes-radio",
    "caídas previas no": "fall-risk-previousFalls-no-radio",
    "caidas previas no": "fall-risk-previousFalls-no-radio",

    # Déficit sensorial
    "déficit sensorial sí": "fall-risk-sensoryDeficit-yes-radio",
    "deficit sensorial si": "fall-risk-sensoryDeficit-yes-radio",
    "déficit sensorial no": "fall-risk-sensoryDeficit-no-radio",
    "deficit sensorial no": "fall-risk-sensoryDeficit-no-radio",

    # Estado mental
    "estado mental sí": "fall-risk-mentalState-yes-radio",
    "estado mental si": "fall-risk-mentalState-yes-radio",
    "estado mental no": "fall-risk-mentalState-no-radio",
    "estado mental no": "fall-risk-mentalState-no-radio",

    # Marcha actual
    "marcha actual sí": "fall-risk-gaitAndMobility-yes-radio",
    "marcha actual si": "fall-risk-gaitAndMobility-yes-radio",
    "marcha actual no": "fall-risk-gaitAndMobility-no-radio",
    "marcha actual no": "fall-risk-gaitAndMobility-no-radio",

    # Medicación actual
    "medicación actual sí": "fall-risk-medication-yes-radio",
    "medicacion actual si": "fall-risk-medication-yes-radio",
    "medicación actual no": "fall-risk-medication-no-radio",
    "medicacion actual no": "fall-risk-medication-no-radio",

    # Formas cortas (cuando el doctor omite calificador)
    "caídas sí": "fall-risk-previousFalls-yes-radio",
    "caidas si": "fall-risk-previousFalls-yes-radio",
    "caídas no": "fall-risk-previousFalls-no-radio",
    "caidas no": "fall-risk-previousFalls-no-radio",

    "sensorial sí": "fall-risk-sensoryDeficit-yes-radio",
    "sensorial si": "fall-risk-sensoryDeficit-yes-radio",
    "sensorial no": "fall-risk-sensoryDeficit-no-radio",
    "sensorial no": "fall-risk-sensoryDeficit-no-radio",

    # Deepgram transcribe "déficit" como "difícil"
    "difícil sensorial sí": "fall-risk-sensoryDeficit-yes-radio",
    "dificil sensorial si": "fall-risk-sensoryDeficit-yes-radio",
    "difícil sensorial no": "fall-risk-sensoryDeficit-no-radio",
    "dificil sensorial no": "fall-risk-sensoryDeficit-no-radio",

    "mental sí": "fall-risk-mentalState-yes-radio",
    "mental si": "fall-risk-mentalState-yes-radio",
    "mental no": "fall-risk-mentalState-no-radio",
    "mental no": "fall-risk-mentalState-no-radio",

    "marcha sí": "fall-risk-gaitAndMobility-yes-radio",
    "marcha si": "fall-risk-gaitAndMobility-yes-radio",
    "marcha no": "fall-risk-gaitAndMobility-no-radio",
    "marcha no": "fall-risk-gaitAndMobility-no-radio",

    "medicación sí": "fall-risk-medication-yes-radio",
    "medicacion si": "fall-risk-medication-yes-radio",
    "medicación no": "fall-risk-medication-no-radio",
    "medicacion no": "fall-risk-medication-no-radio",

    "tab ortopédica": "preconsultation-tab-orthoptic",
    "tab ortopedica": "preconsultation-tab-orthoptic",
    "tab ortóptica": "preconsultation-tab-orthoptic",
    "tab ortoptica": "preconsultation-tab-orthoptic",

    # Botón Atrás (volver a pantalla principal)
    "atrás": "preconsultation-back-button",
    "atras": "preconsultation-back-button",
    "volver": "preconsultation-back-button",

    # ============================================
    # Dilatación - Radio buttons y botón
    # ============================================
    "dilatación sí": "dilatation-requires-yes-radio",
    "dilatacion si": "dilatation-requires-yes-radio",
    "requiere dilatación": "dilatation-requires-yes-radio",

    "dilatación no": "dilatation-requires-no-radio",
    "dilatacion no": "dilatation-requires-no-radio",
    "no requiere dilatación": "dilatation-requires-no-radio",

    "agregar registro": "dilatation-add-record-button",
    "agregar dilatación": "dilatation-add-record-button",
    "agregar dilatacion": "dilatation-add-record-button",

    # Switch: Paciente dilatado
    "paciente dilatado": "dilatation-patient-dilated-switch",
    "ya dilatado": "dilatation-patient-dilated-switch",
    "dilatado": "dilatation-patient-dilated-switch",

    # ============================================
    # Oftalmología - OD Externo (Ojo Derecho Externo)
    # ============================================
    # Paso 1: Abrir panel de hallazgos OD Externo
    "ojo derecho externo": "oftalmology-external-od-justification-textfield",
    "od externo": "oftalmology-external-od-justification-textfield",
    "derecho externo": "oftalmology-external-od-justification-textfield",
    "externo derecho": "oftalmology-external-od-justification-textfield",
    "externo od": "oftalmology-external-od-justification-textfield",

    # OD Externo - Normal checkbox
    "externo normal ojo derecho": "oftalmology-external-od-normal-checkbox",
    "externo od normal": "oftalmology-external-od-normal-checkbox",
    "od externo normal": "oftalmology-external-od-normal-checkbox",
    "normal externo od": "oftalmology-external-od-normal-checkbox",
    "ojo derecho externo normal": "oftalmology-external-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Balance Muscular
    # ============================================
    "balance muscular ojo derecho": "oftalmology-muscle_balance-od-justification-textfield",
    "balance muscular od": "oftalmology-muscle_balance-od-justification-textfield",
    "od balance muscular": "oftalmology-muscle_balance-od-justification-textfield",
    "derecho balance muscular": "oftalmology-muscle_balance-od-justification-textfield",
    "muscular od": "oftalmology-muscle_balance-od-justification-textfield",
    "muscular ojo derecho": "oftalmology-muscle_balance-od-justification-textfield",
    # Normal
    "balance muscular normal ojo derecho": "oftalmology-muscle_balance-od-normal-checkbox",
    "balance muscular od normal": "oftalmology-muscle_balance-od-normal-checkbox",
    "od balance muscular normal": "oftalmology-muscle_balance-od-normal-checkbox",
    "normal balance muscular od": "oftalmology-muscle_balance-od-normal-checkbox",
    "muscular normal od": "oftalmology-muscle_balance-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD P/P/L (Párpados, Pestañas, Lagrimales)
    # ============================================
    "ppl ojo derecho": "oftalmology-ppl-od-justification-textfield",
    "ppl od": "oftalmology-ppl-od-justification-textfield",
    "od ppl": "oftalmology-ppl-od-justification-textfield",
    "pe pe ele ojo derecho": "oftalmology-ppl-od-justification-textfield",
    "pe pe ele od": "oftalmology-ppl-od-justification-textfield",
    "párpados pestañas lagrimales ojo derecho": "oftalmology-ppl-od-justification-textfield",
    "parpados pestañas lagrimales od": "oftalmology-ppl-od-justification-textfield",
    # Normal
    "ppl normal ojo derecho": "oftalmology-ppl-od-normal-checkbox",
    "ppl od normal": "oftalmology-ppl-od-normal-checkbox",
    "od ppl normal": "oftalmology-ppl-od-normal-checkbox",
    "normal ppl od": "oftalmology-ppl-od-normal-checkbox",
    "pe pe ele normal od": "oftalmology-ppl-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Conjuntiva Esclera
    # ============================================
    "conjuntiva esclera ojo derecho": "oftalmology-screra_conjunctiva-od-justification-textfield",
    "conjuntiva esclera od": "oftalmology-screra_conjunctiva-od-justification-textfield",
    "od conjuntiva esclera": "oftalmology-screra_conjunctiva-od-justification-textfield",
    "conjuntiva ojo derecho": "oftalmology-screra_conjunctiva-od-justification-textfield",
    "conjuntiva od": "oftalmology-screra_conjunctiva-od-justification-textfield",
    "esclera ojo derecho": "oftalmology-screra_conjunctiva-od-justification-textfield",
    "esclera od": "oftalmology-screra_conjunctiva-od-justification-textfield",
    # Normal
    "conjuntiva esclera normal ojo derecho": "oftalmology-screra_conjunctiva-od-normal-checkbox",
    "conjuntiva esclera od normal": "oftalmology-screra_conjunctiva-od-normal-checkbox",
    "od conjuntiva esclera normal": "oftalmology-screra_conjunctiva-od-normal-checkbox",
    "conjuntiva normal od": "oftalmology-screra_conjunctiva-od-normal-checkbox",
    "esclera normal od": "oftalmology-screra_conjunctiva-od-normal-checkbox",
    "normal conjuntiva od": "oftalmology-screra_conjunctiva-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Córnea
    # ============================================
    "córnea ojo derecho": "oftalmology-cornea-od-justification-textfield",
    "cornea ojo derecho": "oftalmology-cornea-od-justification-textfield",
    "córnea od": "oftalmology-cornea-od-justification-textfield",
    "cornea od": "oftalmology-cornea-od-justification-textfield",
    "od córnea": "oftalmology-cornea-od-justification-textfield",
    "od cornea": "oftalmology-cornea-od-justification-textfield",
    "derecho córnea": "oftalmology-cornea-od-justification-textfield",
    "derecho cornea": "oftalmology-cornea-od-justification-textfield",
    # Normal
    "córnea normal ojo derecho": "oftalmology-cornea-od-normal-checkbox",
    "cornea normal ojo derecho": "oftalmology-cornea-od-normal-checkbox",
    "córnea od normal": "oftalmology-cornea-od-normal-checkbox",
    "cornea od normal": "oftalmology-cornea-od-normal-checkbox",
    "od córnea normal": "oftalmology-cornea-od-normal-checkbox",
    "od cornea normal": "oftalmology-cornea-od-normal-checkbox",
    "normal córnea od": "oftalmology-cornea-od-normal-checkbox",
    "normal cornea od": "oftalmology-cornea-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Cámara Anterior
    # ============================================
    "cámara anterior ojo derecho": "oftalmology-previous_chamber-od-justification-textfield",
    "camara anterior ojo derecho": "oftalmology-previous_chamber-od-justification-textfield",
    "cámara anterior od": "oftalmology-previous_chamber-od-justification-textfield",
    "camara anterior od": "oftalmology-previous_chamber-od-justification-textfield",
    "od cámara anterior": "oftalmology-previous_chamber-od-justification-textfield",
    "od camara anterior": "oftalmology-previous_chamber-od-justification-textfield",
    "derecho cámara anterior": "oftalmology-previous_chamber-od-justification-textfield",
    "derecho camara anterior": "oftalmology-previous_chamber-od-justification-textfield",
    # Normal
    "cámara anterior normal ojo derecho": "oftalmology-previous_chamber-od-normal-checkbox",
    "camara anterior normal ojo derecho": "oftalmology-previous_chamber-od-normal-checkbox",
    "cámara anterior od normal": "oftalmology-previous_chamber-od-normal-checkbox",
    "camara anterior od normal": "oftalmology-previous_chamber-od-normal-checkbox",
    "od cámara anterior normal": "oftalmology-previous_chamber-od-normal-checkbox",
    "od camara anterior normal": "oftalmology-previous_chamber-od-normal-checkbox",
    "normal cámara anterior od": "oftalmology-previous_chamber-od-normal-checkbox",
    "normal camara anterior od": "oftalmology-previous_chamber-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Iris
    # ============================================
    "iris ojo derecho": "oftalmology-iris-od-justification-textfield",
    "iris od": "oftalmology-iris-od-justification-textfield",
    "od iris": "oftalmology-iris-od-justification-textfield",
    "derecho iris": "oftalmology-iris-od-justification-textfield",
    # Normal
    "iris normal ojo derecho": "oftalmology-iris-od-normal-checkbox",
    "iris od normal": "oftalmology-iris-od-normal-checkbox",
    "od iris normal": "oftalmology-iris-od-normal-checkbox",
    "normal iris od": "oftalmology-iris-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Cristalino
    # ============================================
    "cristalino ojo derecho": "oftalmology-crystalline-od-justification-textfield",
    "cristalino od": "oftalmology-crystalline-od-justification-textfield",
    "od cristalino": "oftalmology-crystalline-od-justification-textfield",
    "derecho cristalino": "oftalmology-crystalline-od-justification-textfield",
    # Normal
    "cristalino normal ojo derecho": "oftalmology-crystalline-od-normal-checkbox",
    "cristalino od normal": "oftalmology-crystalline-od-normal-checkbox",
    "od cristalino normal": "oftalmology-crystalline-od-normal-checkbox",
    "normal cristalino od": "oftalmology-crystalline-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Retina / Vítreo
    # ============================================
    "retina vítreo ojo derecho": "oftalmology-retina_vitreous-od-justification-textfield",
    "retina vitreo ojo derecho": "oftalmology-retina_vitreous-od-justification-textfield",
    "retina vítreo od": "oftalmology-retina_vitreous-od-justification-textfield",
    "retina vitreo od": "oftalmology-retina_vitreous-od-justification-textfield",
    "od retina vítreo": "oftalmology-retina_vitreous-od-justification-textfield",
    "od retina vitreo": "oftalmology-retina_vitreous-od-justification-textfield",
    "retina ojo derecho": "oftalmology-retina_vitreous-od-justification-textfield",
    "retina od": "oftalmology-retina_vitreous-od-justification-textfield",
    "vítreo ojo derecho": "oftalmology-retina_vitreous-od-justification-textfield",
    "vitreo ojo derecho": "oftalmology-retina_vitreous-od-justification-textfield",
    "vítreo od": "oftalmology-retina_vitreous-od-justification-textfield",
    "vitreo od": "oftalmology-retina_vitreous-od-justification-textfield",
    # Normal
    "retina vítreo normal ojo derecho": "oftalmology-retina_vitreous-od-normal-checkbox",
    "retina vitreo normal ojo derecho": "oftalmology-retina_vitreous-od-normal-checkbox",
    "retina vítreo od normal": "oftalmology-retina_vitreous-od-normal-checkbox",
    "retina vitreo od normal": "oftalmology-retina_vitreous-od-normal-checkbox",
    "od retina vítreo normal": "oftalmology-retina_vitreous-od-normal-checkbox",
    "od retina vitreo normal": "oftalmology-retina_vitreous-od-normal-checkbox",
    "retina normal od": "oftalmology-retina_vitreous-od-normal-checkbox",
    "normal retina od": "oftalmology-retina_vitreous-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Nervio Óptico
    # ============================================
    "nervio óptico ojo derecho": "oftalmology-optic_nerve-od-justification-textfield",
    "nervio optico ojo derecho": "oftalmology-optic_nerve-od-justification-textfield",
    "nervio óptico od": "oftalmology-optic_nerve-od-justification-textfield",
    "nervio optico od": "oftalmology-optic_nerve-od-justification-textfield",
    "od nervio óptico": "oftalmology-optic_nerve-od-justification-textfield",
    "od nervio optico": "oftalmology-optic_nerve-od-justification-textfield",
    "derecho nervio óptico": "oftalmology-optic_nerve-od-justification-textfield",
    "derecho nervio optico": "oftalmology-optic_nerve-od-justification-textfield",
    # Normal
    "nervio óptico normal ojo derecho": "oftalmology-optic_nerve-od-normal-checkbox",
    "nervio optico normal ojo derecho": "oftalmology-optic_nerve-od-normal-checkbox",
    "nervio óptico od normal": "oftalmology-optic_nerve-od-normal-checkbox",
    "nervio optico od normal": "oftalmology-optic_nerve-od-normal-checkbox",
    "od nervio óptico normal": "oftalmology-optic_nerve-od-normal-checkbox",
    "od nervio optico normal": "oftalmology-optic_nerve-od-normal-checkbox",
    "normal nervio óptico od": "oftalmology-optic_nerve-od-normal-checkbox",
    "normal nervio optico od": "oftalmology-optic_nerve-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Pupilometría
    # ============================================
    "pupilometría ojo derecho": "oftalmology-pupillometry-od-justification-textfield",
    "pupilometria ojo derecho": "oftalmology-pupillometry-od-justification-textfield",
    "pupilometría od": "oftalmology-pupillometry-od-justification-textfield",
    "pupilometria od": "oftalmology-pupillometry-od-justification-textfield",
    "od pupilometría": "oftalmology-pupillometry-od-justification-textfield",
    "od pupilometria": "oftalmology-pupillometry-od-justification-textfield",
    # Normal
    "pupilometría normal ojo derecho": "oftalmology-pupillometry-od-normal-checkbox",
    "pupilometria normal ojo derecho": "oftalmology-pupillometry-od-normal-checkbox",
    "pupilometría od normal": "oftalmology-pupillometry-od-normal-checkbox",
    "pupilometria od normal": "oftalmology-pupillometry-od-normal-checkbox",
    "od pupilometría normal": "oftalmology-pupillometry-od-normal-checkbox",
    "od pupilometria normal": "oftalmology-pupillometry-od-normal-checkbox",
    "normal pupilometría od": "oftalmology-pupillometry-od-normal-checkbox",
    "normal pupilometria od": "oftalmology-pupillometry-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Gonioscopía
    # ============================================
    "gonioscopía ojo derecho": "oftalmology-gonioscopy-od-justification-textfield",
    "gonioscopia ojo derecho": "oftalmology-gonioscopy-od-justification-textfield",
    "gonioscopía od": "oftalmology-gonioscopy-od-justification-textfield",
    "gonioscopia od": "oftalmology-gonioscopy-od-justification-textfield",
    "od gonioscopía": "oftalmology-gonioscopy-od-justification-textfield",
    "od gonioscopia": "oftalmology-gonioscopy-od-justification-textfield",
    # Normal
    "gonioscopía normal ojo derecho": "oftalmology-gonioscopy-od-normal-checkbox",
    "gonioscopia normal ojo derecho": "oftalmology-gonioscopy-od-normal-checkbox",
    "gonioscopía od normal": "oftalmology-gonioscopy-od-normal-checkbox",
    "gonioscopia od normal": "oftalmology-gonioscopy-od-normal-checkbox",
    "od gonioscopía normal": "oftalmology-gonioscopy-od-normal-checkbox",
    "od gonioscopia normal": "oftalmology-gonioscopy-od-normal-checkbox",
    "normal gonioscopía od": "oftalmology-gonioscopy-od-normal-checkbox",
    "normal gonioscopia od": "oftalmology-gonioscopy-od-normal-checkbox",

    # ============================================
    # Oftalmología - OD Campo Visual por Confrontación
    # ============================================
    "campo visual ojo derecho": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "campo visual od": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "od campo visual": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "campo visual por confrontación ojo derecho": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "campo visual por confrontacion ojo derecho": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "campo visual por confrontación od": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "campo visual por confrontacion od": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "confrontación ojo derecho": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "confrontacion ojo derecho": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "confrontación od": "oftalmology-confrontation_visual_field-od-justification-textfield",
    "confrontacion od": "oftalmology-confrontation_visual_field-od-justification-textfield",
    # Normal
    "campo visual normal ojo derecho": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "campo visual od normal": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "od campo visual normal": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "campo visual por confrontación normal od": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "campo visual por confrontacion normal od": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "confrontación normal od": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "confrontacion normal od": "oftalmology-confrontation_visual_field-od-normal-checkbox",
    "normal campo visual od": "oftalmology-confrontation_visual_field-od-normal-checkbox",

    # ============================================
    # Oftalmología - OI Externo (Ojo Izquierdo Externo)
    # ============================================
    "ojo izquierdo externo": "oftalmology-external-oi-justification-textfield",
    "oi externo": "oftalmology-external-oi-justification-textfield",
    "izquierdo externo": "oftalmology-external-oi-justification-textfield",
    "externo izquierdo": "oftalmology-external-oi-justification-textfield",
    "externo oi": "oftalmology-external-oi-justification-textfield",
    # Normal
    "externo normal ojo izquierdo": "oftalmology-external-oi-normal-checkbox",
    "externo oi normal": "oftalmology-external-oi-normal-checkbox",
    "oi externo normal": "oftalmology-external-oi-normal-checkbox",
    "normal externo oi": "oftalmology-external-oi-normal-checkbox",
    "ojo izquierdo externo normal": "oftalmology-external-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Balance Muscular
    # ============================================
    "balance muscular ojo izquierdo": "oftalmology-muscle_balance-oi-justification-textfield",
    "balance muscular oi": "oftalmology-muscle_balance-oi-justification-textfield",
    "oi balance muscular": "oftalmology-muscle_balance-oi-justification-textfield",
    "izquierdo balance muscular": "oftalmology-muscle_balance-oi-justification-textfield",
    "muscular oi": "oftalmology-muscle_balance-oi-justification-textfield",
    "muscular ojo izquierdo": "oftalmology-muscle_balance-oi-justification-textfield",
    # Normal
    "balance muscular normal ojo izquierdo": "oftalmology-muscle_balance-oi-normal-checkbox",
    "balance muscular oi normal": "oftalmology-muscle_balance-oi-normal-checkbox",
    "oi balance muscular normal": "oftalmology-muscle_balance-oi-normal-checkbox",
    "normal balance muscular oi": "oftalmology-muscle_balance-oi-normal-checkbox",
    "muscular normal oi": "oftalmology-muscle_balance-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI P/P/L
    # ============================================
    "ppl ojo izquierdo": "oftalmology-ppl-oi-justification-textfield",
    "ppl oi": "oftalmology-ppl-oi-justification-textfield",
    "oi ppl": "oftalmology-ppl-oi-justification-textfield",
    "pe pe ele ojo izquierdo": "oftalmology-ppl-oi-justification-textfield",
    "pe pe ele oi": "oftalmology-ppl-oi-justification-textfield",
    "párpados pestañas lagrimales ojo izquierdo": "oftalmology-ppl-oi-justification-textfield",
    "parpados pestañas lagrimales oi": "oftalmology-ppl-oi-justification-textfield",
    # Normal
    "ppl normal ojo izquierdo": "oftalmology-ppl-oi-normal-checkbox",
    "ppl oi normal": "oftalmology-ppl-oi-normal-checkbox",
    "oi ppl normal": "oftalmology-ppl-oi-normal-checkbox",
    "normal ppl oi": "oftalmology-ppl-oi-normal-checkbox",
    "pe pe ele normal oi": "oftalmology-ppl-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Conjuntiva Esclera
    # ============================================
    "conjuntiva esclera ojo izquierdo": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    "conjuntiva esclera oi": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    "oi conjuntiva esclera": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    "conjuntiva ojo izquierdo": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    "conjuntiva oi": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    "esclera ojo izquierdo": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    "esclera oi": "oftalmology-screra_conjunctiva-oi-justification-textfield",
    # Normal
    "conjuntiva esclera normal ojo izquierdo": "oftalmology-screra_conjunctiva-oi-normal-checkbox",
    "conjuntiva esclera oi normal": "oftalmology-screra_conjunctiva-oi-normal-checkbox",
    "oi conjuntiva esclera normal": "oftalmology-screra_conjunctiva-oi-normal-checkbox",
    "conjuntiva normal oi": "oftalmology-screra_conjunctiva-oi-normal-checkbox",
    "esclera normal oi": "oftalmology-screra_conjunctiva-oi-normal-checkbox",
    "normal conjuntiva oi": "oftalmology-screra_conjunctiva-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Córnea
    # ============================================
    "córnea ojo izquierdo": "oftalmology-cornea-oi-justification-textfield",
    "cornea ojo izquierdo": "oftalmology-cornea-oi-justification-textfield",
    "córnea oi": "oftalmology-cornea-oi-justification-textfield",
    "cornea oi": "oftalmology-cornea-oi-justification-textfield",
    "oi córnea": "oftalmology-cornea-oi-justification-textfield",
    "oi cornea": "oftalmology-cornea-oi-justification-textfield",
    "izquierdo córnea": "oftalmology-cornea-oi-justification-textfield",
    "izquierdo cornea": "oftalmology-cornea-oi-justification-textfield",
    # Normal
    "córnea normal ojo izquierdo": "oftalmology-cornea-oi-normal-checkbox",
    "cornea normal ojo izquierdo": "oftalmology-cornea-oi-normal-checkbox",
    "córnea oi normal": "oftalmology-cornea-oi-normal-checkbox",
    "cornea oi normal": "oftalmology-cornea-oi-normal-checkbox",
    "oi córnea normal": "oftalmology-cornea-oi-normal-checkbox",
    "oi cornea normal": "oftalmology-cornea-oi-normal-checkbox",
    "normal córnea oi": "oftalmology-cornea-oi-normal-checkbox",
    "normal cornea oi": "oftalmology-cornea-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Cámara Anterior
    # ============================================
    "cámara anterior ojo izquierdo": "oftalmology-previous_chamber-oi-justification-textfield",
    "camara anterior ojo izquierdo": "oftalmology-previous_chamber-oi-justification-textfield",
    "cámara anterior oi": "oftalmology-previous_chamber-oi-justification-textfield",
    "camara anterior oi": "oftalmology-previous_chamber-oi-justification-textfield",
    "oi cámara anterior": "oftalmology-previous_chamber-oi-justification-textfield",
    "oi camara anterior": "oftalmology-previous_chamber-oi-justification-textfield",
    "izquierdo cámara anterior": "oftalmology-previous_chamber-oi-justification-textfield",
    "izquierdo camara anterior": "oftalmology-previous_chamber-oi-justification-textfield",
    # Normal
    "cámara anterior normal ojo izquierdo": "oftalmology-previous_chamber-oi-normal-checkbox",
    "camara anterior normal ojo izquierdo": "oftalmology-previous_chamber-oi-normal-checkbox",
    "cámara anterior oi normal": "oftalmology-previous_chamber-oi-normal-checkbox",
    "camara anterior oi normal": "oftalmology-previous_chamber-oi-normal-checkbox",
    "oi cámara anterior normal": "oftalmology-previous_chamber-oi-normal-checkbox",
    "oi camara anterior normal": "oftalmology-previous_chamber-oi-normal-checkbox",
    "normal cámara anterior oi": "oftalmology-previous_chamber-oi-normal-checkbox",
    "normal camara anterior oi": "oftalmology-previous_chamber-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Iris
    # ============================================
    "iris ojo izquierdo": "oftalmology-iris-oi-justification-textfield",
    "iris oi": "oftalmology-iris-oi-justification-textfield",
    "oi iris": "oftalmology-iris-oi-justification-textfield",
    "izquierdo iris": "oftalmology-iris-oi-justification-textfield",
    # Normal
    "iris normal ojo izquierdo": "oftalmology-iris-oi-normal-checkbox",
    "iris oi normal": "oftalmology-iris-oi-normal-checkbox",
    "oi iris normal": "oftalmology-iris-oi-normal-checkbox",
    "normal iris oi": "oftalmology-iris-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Cristalino
    # ============================================
    "cristalino ojo izquierdo": "oftalmology-crystalline-oi-justification-textfield",
    "cristalino oi": "oftalmology-crystalline-oi-justification-textfield",
    "oi cristalino": "oftalmology-crystalline-oi-justification-textfield",
    "izquierdo cristalino": "oftalmology-crystalline-oi-justification-textfield",
    # Normal
    "cristalino normal ojo izquierdo": "oftalmology-crystalline-oi-normal-checkbox",
    "cristalino oi normal": "oftalmology-crystalline-oi-normal-checkbox",
    "oi cristalino normal": "oftalmology-crystalline-oi-normal-checkbox",
    "normal cristalino oi": "oftalmology-crystalline-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Retina / Vítreo
    # ============================================
    "retina vítreo ojo izquierdo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "retina vitreo ojo izquierdo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "retina vítreo oi": "oftalmology-retina_vitreous-oi-justification-textfield",
    "retina vitreo oi": "oftalmology-retina_vitreous-oi-justification-textfield",
    "oi retina vítreo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "oi retina vitreo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "retina ojo izquierdo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "retina oi": "oftalmology-retina_vitreous-oi-justification-textfield",
    "vítreo ojo izquierdo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "vitreo ojo izquierdo": "oftalmology-retina_vitreous-oi-justification-textfield",
    "vítreo oi": "oftalmology-retina_vitreous-oi-justification-textfield",
    "vitreo oi": "oftalmology-retina_vitreous-oi-justification-textfield",
    # Normal
    "retina vítreo normal ojo izquierdo": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "retina vitreo normal ojo izquierdo": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "retina vítreo oi normal": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "retina vitreo oi normal": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "oi retina vítreo normal": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "oi retina vitreo normal": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "retina normal oi": "oftalmology-retina_vitreous-oi-normal-checkbox",
    "normal retina oi": "oftalmology-retina_vitreous-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Nervio Óptico
    # ============================================
    "nervio óptico ojo izquierdo": "oftalmology-optic_nerve-oi-justification-textfield",
    "nervio optico ojo izquierdo": "oftalmology-optic_nerve-oi-justification-textfield",
    "nervio óptico oi": "oftalmology-optic_nerve-oi-justification-textfield",
    "nervio optico oi": "oftalmology-optic_nerve-oi-justification-textfield",
    "oi nervio óptico": "oftalmology-optic_nerve-oi-justification-textfield",
    "oi nervio optico": "oftalmology-optic_nerve-oi-justification-textfield",
    "izquierdo nervio óptico": "oftalmology-optic_nerve-oi-justification-textfield",
    "izquierdo nervio optico": "oftalmology-optic_nerve-oi-justification-textfield",
    # Normal
    "nervio óptico normal ojo izquierdo": "oftalmology-optic_nerve-oi-normal-checkbox",
    "nervio optico normal ojo izquierdo": "oftalmology-optic_nerve-oi-normal-checkbox",
    "nervio óptico oi normal": "oftalmology-optic_nerve-oi-normal-checkbox",
    "nervio optico oi normal": "oftalmology-optic_nerve-oi-normal-checkbox",
    "oi nervio óptico normal": "oftalmology-optic_nerve-oi-normal-checkbox",
    "oi nervio optico normal": "oftalmology-optic_nerve-oi-normal-checkbox",
    "normal nervio óptico oi": "oftalmology-optic_nerve-oi-normal-checkbox",
    "normal nervio optico oi": "oftalmology-optic_nerve-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Pupilometría
    # ============================================
    "pupilometría ojo izquierdo": "oftalmology-pupillometry-oi-justification-textfield",
    "pupilometria ojo izquierdo": "oftalmology-pupillometry-oi-justification-textfield",
    "pupilometría oi": "oftalmology-pupillometry-oi-justification-textfield",
    "pupilometria oi": "oftalmology-pupillometry-oi-justification-textfield",
    "oi pupilometría": "oftalmology-pupillometry-oi-justification-textfield",
    "oi pupilometria": "oftalmology-pupillometry-oi-justification-textfield",
    # Normal
    "pupilometría normal ojo izquierdo": "oftalmology-pupillometry-oi-normal-checkbox",
    "pupilometria normal ojo izquierdo": "oftalmology-pupillometry-oi-normal-checkbox",
    "pupilometría oi normal": "oftalmology-pupillometry-oi-normal-checkbox",
    "pupilometria oi normal": "oftalmology-pupillometry-oi-normal-checkbox",
    "oi pupilometría normal": "oftalmology-pupillometry-oi-normal-checkbox",
    "oi pupilometria normal": "oftalmology-pupillometry-oi-normal-checkbox",
    "normal pupilometría oi": "oftalmology-pupillometry-oi-normal-checkbox",
    "normal pupilometria oi": "oftalmology-pupillometry-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Gonioscopía
    # ============================================
    "gonioscopía ojo izquierdo": "oftalmology-gonioscopy-oi-justification-textfield",
    "gonioscopia ojo izquierdo": "oftalmology-gonioscopy-oi-justification-textfield",
    "gonioscopía oi": "oftalmology-gonioscopy-oi-justification-textfield",
    "gonioscopia oi": "oftalmology-gonioscopy-oi-justification-textfield",
    "oi gonioscopía": "oftalmology-gonioscopy-oi-justification-textfield",
    "oi gonioscopia": "oftalmology-gonioscopy-oi-justification-textfield",
    # Normal
    "gonioscopía normal ojo izquierdo": "oftalmology-gonioscopy-oi-normal-checkbox",
    "gonioscopia normal ojo izquierdo": "oftalmology-gonioscopy-oi-normal-checkbox",
    "gonioscopía oi normal": "oftalmology-gonioscopy-oi-normal-checkbox",
    "gonioscopia oi normal": "oftalmology-gonioscopy-oi-normal-checkbox",
    "oi gonioscopía normal": "oftalmology-gonioscopy-oi-normal-checkbox",
    "oi gonioscopia normal": "oftalmology-gonioscopy-oi-normal-checkbox",
    "normal gonioscopía oi": "oftalmology-gonioscopy-oi-normal-checkbox",
    "normal gonioscopia oi": "oftalmology-gonioscopy-oi-normal-checkbox",

    # ============================================
    # Oftalmología - OI Campo Visual por Confrontación
    # ============================================
    "campo visual ojo izquierdo": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "campo visual oi": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "oi campo visual": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "campo visual por confrontación ojo izquierdo": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "campo visual por confrontacion ojo izquierdo": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "campo visual por confrontación oi": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "campo visual por confrontacion oi": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "confrontación ojo izquierdo": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "confrontacion ojo izquierdo": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "confrontación oi": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    "confrontacion oi": "oftalmology-confrontation_visual_field-oi-justification-textfield",
    # Normal
    "campo visual normal ojo izquierdo": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "campo visual oi normal": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "oi campo visual normal": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "campo visual por confrontación normal oi": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "campo visual por confrontacion normal oi": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "confrontación normal oi": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "confrontacion normal oi": "oftalmology-confrontation_visual_field-oi-normal-checkbox",
    "normal campo visual oi": "oftalmology-confrontation_visual_field-oi-normal-checkbox",

    # Paso 2: Abrir dropdown de hallazgos (dentro del panel)
    "hallazgo": "text-config-findings-select",
    "hallazgos": "text-config-findings-select",
    "buscar hallazgo": "text-config-findings-select",
    "buscar hallazgos": "text-config-findings-select",
    "seleccionar hallazgo": "text-config-findings-select",

    # select-option-* se resuelven DINÁMICAMENTE en sync_with_biowel_fields()
    # (son testids genéricos reutilizados por diferentes dropdowns: hallazgos, diagnóstico, etc.)

    # Paso 3: Textarea de justificación (dentro del panel)
    "justificación": "text-config-justification-textarea",
    "justificacion": "text-config-justification-textarea",

    # Paso 4: Buscar texto predefinido (dentro del panel)
    "buscar texto": "text-config-search-field",
    "texto predefinido": "text-config-search-field",
    "texto no institucional": "text-config-search-field",

    # Paso 5: Guardar hallazgo
    "guardar hallazgo": "text-config-save-button",
    "guardar": "text-config-save-button",

    # ============================================
    # Antecedentes - Botón principal y acciones
    # ============================================
    "antecedentes": "header-antecedents-button",
    "antecedente": "header-antecedents-button",
    "abrir antecedentes": "header-antecedents-button",
    "ver antecedentes": "header-antecedents-button",
    "guardar antecedentes": "antecedents-save-button",
    "salvar antecedentes": "antecedents-save-button",
    "guardar cambios": "antecedents-save-button",
    "guardar cambios antecedentes": "antecedents-save-button",
    "guardar datos": "antecedents-save-button",
    "cancelar antecedentes": "antecedents-cancel-button",

}

# Mapeo de keywords de select → valor REAL que el select espera mostrar
# Esto resuelve el problema donde el usuario dice "url" pero el select espera "SOAT (Accidente de tránsito)"
KEYWORD_TO_SELECT_VALUE = {
    # Origen de la atención
    "general": "Enfermedad general",
    "enfermedad general": "Enfermedad general",
    "url": "Accidente de trabajo",
    "laboral": "Accidente de trabajo",
    "trabajo": "Accidente de trabajo",
    "accidente de trabajo": "Accidente de trabajo",
    "profesional": "Enfermedad profesional",
    "enfermedad profesional": "Enfermedad profesional",
    "soat": "SOAT (Accidente de tránsito)",
    "transito": "SOAT (Accidente de tránsito)",
    "tránsito": "SOAT (Accidente de tránsito)",
    "accidente de tránsito": "SOAT (Accidente de tránsito)",
    "accidente de transito": "SOAT (Accidente de tránsito)",
}

def get_select_value_for_keyword(keyword: str) -> str:
    """
    Obtiene el valor REAL que el select espera para una keyword dada.
    
    Ejemplo: 
        - keyword="url" → retorna "SOAT (Accidente de tránsito)"
        - keyword="general" → retorna "Enfermedad general"
        - keyword="desconocido" → retorna la keyword sin cambios (fallback)
    """
    kw_lower = keyword.lower().strip()
    return KEYWORD_TO_SELECT_VALUE.get(kw_lower, keyword)

# Mapa de keywords para DESMARCAR checkboxes específicos
# Cuando el usuario dice "borrar ojos normales", se envía "false" al checkbox
KEYWORD_TO_UNCHECK = {


    # Desmarcar "Examen normal en ambos ojos"
    "borrar ojos normales": "oftalmology-all-normal-checkbox",
    "desmarcar ojos normales": "oftalmology-all-normal-checkbox",
    "quitar ojos normales": "oftalmology-all-normal-checkbox",
    "borrar examen normal": "oftalmology-all-normal-checkbox",
    "desmarcar examen normal": "oftalmology-all-normal-checkbox",
    "quitar examen normal": "oftalmology-all-normal-checkbox",
    "borrar examen de ambos ojos": "oftalmology-all-normal-checkbox",
    "desmarcar examen de ambos ojos": "oftalmology-all-normal-checkbox",
    "quitar examen de ambos ojos": "oftalmology-all-normal-checkbox",
    "eliminar examen de ambos ojos": "oftalmology-all-normal-checkbox",
    "deshacer examen de ambos ojos": "oftalmology-all-normal-checkbox",
    "borrar ambos ojos normales": "oftalmology-all-normal-checkbox",
    "desmarcar ambos ojos normales": "oftalmology-all-normal-checkbox",
    "eliminar ambos ojos normales": "oftalmology-all-normal-checkbox",
    "deshacer ambos ojos normales": "oftalmology-all-normal-checkbox",
    "eliminar ojos normales": "oftalmology-all-normal-checkbox",
    "deshacer ojos normales": "oftalmology-all-normal-checkbox",
    "eliminar examen normal": "oftalmology-all-normal-checkbox",
    "deshacer examen normal": "oftalmology-all-normal-checkbox",
    "eliminar examen ocular": "oftalmology-all-normal-checkbox",
    "deshacer examen ocular": "oftalmology-all-normal-checkbox",
    "borrar examen ojos": "oftalmology-all-normal-checkbox",
    "borrar examen ocular": "oftalmology-all-normal-checkbox",
    "desmarcar examen ocular": "oftalmology-all-normal-checkbox",
    "quitar examen ocular": "oftalmology-all-normal-checkbox",
    "borrar todo normal": "oftalmology-all-normal-checkbox",
    "desmarcar todo normal": "oftalmology-all-normal-checkbox",
    # Desmarcar "Evento adverso"
    "borrar evento adverso": "attention-origin-adverse-event-checkbox",
    "desmarcar evento adverso": "attention-origin-adverse-event-checkbox",
    "quitar evento adverso": "attention-origin-adverse-event-checkbox",
    "borrar adverso": "attention-origin-adverse-event-checkbox",
    "desmarcar adverso": "attention-origin-adverse-event-checkbox",
    # Desmarcar "Paciente dilatado" (switch)
    "paciente no dilatado": "dilatation-patient-dilated-switch",
    "no dilatado": "dilatation-patient-dilated-switch",
    "borrar paciente dilatado": "dilatation-patient-dilated-switch",
    "desmarcar paciente dilatado": "dilatation-patient-dilated-switch",
    "quitar paciente dilatado": "dilatation-patient-dilated-switch",
    "borrar dilatado": "dilatation-patient-dilated-switch",
    "desmarcar dilatado": "dilatation-patient-dilated-switch",
}

# ============================================
# Antecedentes Checkboxes y Textareas — keywords de activación
# (Se mezclan con KEYWORD_TO_FIELD al final del módulo)
# ============================================
_ANTECEDENTES_KEYWORDS = {
    # Hipertensión arterial
    "antecedentes generales hipertensión arterial": "antecedents-arterialHypertension-checkbox",
    "antecedentes generales hipertension arterial": "antecedents-arterialHypertension-checkbox",
    "generales hipertensión arterial": "antecedents-arterialHypertension-checkbox",
    "generales hipertension arterial": "antecedents-arterialHypertension-checkbox",
    "hipertension arterial": "antecedents-arterialHypertension-checkbox",
    "hipertensión arterial": "antecedents-arterialHypertension-checkbox",
    # Diabetes
    "antecedentes generales diabetes": "antecedents-diabetesGeneral-checkbox",
    "generales diabetes": "antecedents-diabetesGeneral-checkbox",
    "diabetes": "antecedents-diabetesGeneral-checkbox",
    "diabetes general": "antecedents-diabetesGeneral-checkbox",
    # Asma
    "antecedentes generales asma": "antecedents-asthmaGeneral-checkbox",
    "generales asma": "antecedents-asthmaGeneral-checkbox",
    "asma": "antecedents-asthmaGeneral-checkbox",
    "asma general": "antecedents-asthmaGeneral-checkbox",
    # Cáncer
    "antecedentes generales cáncer": "antecedents-cancerGeneral-checkbox",
    "antecedentes generales cancer": "antecedents-cancerGeneral-checkbox",
    "generales cáncer": "antecedents-cancerGeneral-checkbox",
    "generales cancer": "antecedents-cancerGeneral-checkbox",
    "cancer": "antecedents-cancerGeneral-checkbox",
    "cáncer": "antecedents-cancerGeneral-checkbox",
    # Cardiopatía coronaria (Enfermedad coronaria)
    "antecedentes generales cardiopatía coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "antecedentes generales cardiopatia coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "antecedentes generales enfermedad coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "generales cardiopatía coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "generales cardiopatia coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "generales enfermedad coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "cardiopatía coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "cardiopatia coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "enfermedad coronaria": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "cardiopatía": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    "cardiopatia": "antecedents-coronaryHeartDiseaseGeneral-checkbox",
    # Tuberculosis
    "antecedentes generales tuberculosis": "antecedents-tuberculosisGeneral-checkbox",
    "generales tuberculosis": "antecedents-tuberculosisGeneral-checkbox",
    "tuberculosis": "antecedents-tuberculosisGeneral-checkbox",
    "tbc": "antecedents-tuberculosisGeneral-checkbox",
    # Artritis reumatoide (Artritis Reumatoidea)
    "antecedentes generales artritis reumatoide": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "antecedentes generales artritis reumatoidea": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "generales artritis reumatoide": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "generales artritis reumatoidea": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "generales artritis": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "artritis reumatoide": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "artritis reumatoidea": "antecedents-rheumatoidArthritisGeneral-checkbox",
    "artritis": "antecedents-rheumatoidArthritisGeneral-checkbox",
    # EPOC
    "antecedentes generales epoc": "antecedents-copdGeneral-checkbox",
    "generales epoc": "antecedents-copdGeneral-checkbox",
    "antecedentes generales enfermedad pulmonar obstructiva": "antecedents-copdGeneral-checkbox",
    "generales enfermedad pulmonar obstructiva": "antecedents-copdGeneral-checkbox",
    "epoc": "antecedents-copdGeneral-checkbox",
    "enfermedad pulmonar obstructiva": "antecedents-copdGeneral-checkbox",
    # Cirugías previas
    "antecedentes generales cirugías previas": "antecedents-previousSurgeriesGeneral-checkbox",
    "antecedentes generales cirugias previas": "antecedents-previousSurgeriesGeneral-checkbox",
    "generales cirugías previas": "antecedents-previousSurgeriesGeneral-checkbox",
    "generales cirugias previas": "antecedents-previousSurgeriesGeneral-checkbox",
    "cirugías previas": "antecedents-previousSurgeriesGeneral-checkbox",
    "cirugias previas": "antecedents-previousSurgeriesGeneral-checkbox",
    # Alergias
    "antecedentes generales alergias": "antecedents-allergiesGeneral-checkbox",
    "antecedentes generales alergia": "antecedents-allergiesGeneral-checkbox",
    "generales alergias": "antecedents-allergiesGeneral-checkbox",
    "generales alergia": "antecedents-allergiesGeneral-checkbox",
    "alergias": "antecedents-allergiesGeneral-checkbox",
    "alergia": "antecedents-allergiesGeneral-checkbox",
    "alérgico": "antecedents-allergiesGeneral-checkbox",
    "alergico": "antecedents-allergiesGeneral-checkbox",
    # ¿Usa medicamentos?
    "antecedentes generales uso de medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    "antecedentes generales medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    "generales uso de medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    "generales medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    "uso de medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    "medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    "usa medicamentos": "antecedents-useMedicationsGeneral-checkbox",
    # Otros
    "antecedentes generales otros": "antecedents-othersGeneral-checkbox",
    "otros generales": "antecedents-othersGeneral-checkbox",
    "otro general": "antecedents-othersGeneral-checkbox",
    "otros antecedentes generales": "antecedents-othersGeneral-checkbox",

    # Antecedentes Generales - Textarea notas
    "antecedentes generales nota": "antecedents-general-notes-textarea",
    "antecedentes generales notas": "antecedents-general-notes-textarea",
    "nota antecedentes generales": "antecedents-general-notes-textarea",
    "notas antecedentes generales": "antecedents-general-notes-textarea",
    "notas generales antecedentes": "antecedents-general-notes-textarea",

    # ============================================
    # Antecedentes Oculares - Checkboxes
    # ============================================
    # Glaucoma
    "antecedentes oculares glaucoma": "antecedents-glaucomaOcular-checkbox",
    "oculares glaucoma": "antecedents-glaucomaOcular-checkbox",
    "glaucoma": "antecedents-glaucomaOcular-checkbox",
    "glaucoma ocular": "antecedents-glaucomaOcular-checkbox",
    # ROP
    "antecedentes oculares rop": "antecedents-ropOcular-checkbox",
    "oculares rop": "antecedents-ropOcular-checkbox",
    "antecedentes oculares retinopatía del prematuro": "antecedents-ropOcular-checkbox",
    "oculares retinopatía del prematuro": "antecedents-ropOcular-checkbox",
    "oculares retinopatia del prematuro": "antecedents-ropOcular-checkbox",
    "rop": "antecedents-ropOcular-checkbox",
    "retinopatía del prematuro": "antecedents-ropOcular-checkbox",
    "retinopatia del prematuro": "antecedents-ropOcular-checkbox",
    # DMRE
    "antecedentes oculares dmre": "antecedents-dmreOcular-checkbox",
    "oculares dmre": "antecedents-dmreOcular-checkbox",
    "antecedentes oculares degeneración macular": "antecedents-dmreOcular-checkbox",
    "oculares degeneración macular": "antecedents-dmreOcular-checkbox",
    "oculares degeneracion macular": "antecedents-dmreOcular-checkbox",
    "dmre": "antecedents-dmreOcular-checkbox",
    "degeneración macular": "antecedents-dmreOcular-checkbox",
    "degeneracion macular": "antecedents-dmreOcular-checkbox",
    # Gafas
    "antecedentes oculares gafas": "antecedents-glassesOcular-checkbox",
    "oculares gafas": "antecedents-glassesOcular-checkbox",
    "antecedentes oculares uso de gafas": "antecedents-glassesOcular-checkbox",
    "oculares uso de gafas": "antecedents-glassesOcular-checkbox",
    "uso de gafas": "antecedents-glassesOcular-checkbox",
    "gafas": "antecedents-glassesOcular-checkbox",
    "usa gafas": "antecedents-glassesOcular-checkbox",
    "lentes": "antecedents-glassesOcular-checkbox",
    # Ojo seco
    "antecedentes oculares ojo seco": "antecedents-dryEyeOcular-checkbox",
    "oculares ojo seco": "antecedents-dryEyeOcular-checkbox",
    "ojo seco": "antecedents-dryEyeOcular-checkbox",
    "síndrome de ojo seco": "antecedents-dryEyeOcular-checkbox",
    "sindrome de ojo seco": "antecedents-dryEyeOcular-checkbox",
    # Retinopatía diabética
    "antecedentes oculares retinopatía diabética": "antecedents-diabeticRetinoPathyOcular-checkbox",
    "antecedentes oculares retinopatia diabetica": "antecedents-diabeticRetinoPathyOcular-checkbox",
    "oculares retinopatía diabética": "antecedents-diabeticRetinoPathyOcular-checkbox",
    "oculares retinopatia diabetica": "antecedents-diabeticRetinoPathyOcular-checkbox",
    "retinopatía diabética": "antecedents-diabeticRetinoPathyOcular-checkbox",
    "retinopatia diabetica": "antecedents-diabeticRetinoPathyOcular-checkbox",
    # Uveítis
    "antecedentes oculares uveítis": "antecedents-uveitisOcular-checkbox",
    "antecedentes oculares uveitis": "antecedents-uveitisOcular-checkbox",
    "oculares uveítis": "antecedents-uveitisOcular-checkbox",
    "oculares uveitis": "antecedents-uveitisOcular-checkbox",
    "uveítis": "antecedents-uveitisOcular-checkbox",
    "uveitis": "antecedents-uveitisOcular-checkbox",
    # Lentes de contacto
    "antecedentes oculares lentes de contacto": "antecedents-contactLensesOcular-checkbox",
    "oculares lentes de contacto": "antecedents-contactLensesOcular-checkbox",
    "lentes de contacto": "antecedents-contactLensesOcular-checkbox",
    "usa lentes de contacto": "antecedents-contactLensesOcular-checkbox",
    # Traumas
    "antecedentes oculares traumas": "antecedents-traumasOcular-checkbox",
    "antecedentes oculares trauma": "antecedents-traumasOcular-checkbox",
    "oculares traumas": "antecedents-traumasOcular-checkbox",
    "oculares trauma": "antecedents-traumasOcular-checkbox",
    "traumas oculares": "antecedents-traumasOcular-checkbox",
    "trauma ocular": "antecedents-traumasOcular-checkbox",
    # Cirugía
    "antecedentes oculares cirugía": "antecedents-surgeriesOcular-checkbox",
    "antecedentes oculares cirugia": "antecedents-surgeriesOcular-checkbox",
    "oculares cirugía": "antecedents-surgeriesOcular-checkbox",
    "oculares cirugia": "antecedents-surgeriesOcular-checkbox",
    "cirugías oculares": "antecedents-surgeriesOcular-checkbox",
    "cirugias oculares": "antecedents-surgeriesOcular-checkbox",
    "cirugía ocular": "antecedents-surgeriesOcular-checkbox",
    "cirugia ocular": "antecedents-surgeriesOcular-checkbox",
    # Alertas
    "antecedentes oculares alertas": "antecedents-alertsOcular-checkbox",
    "antecedentes oculares alerta": "antecedents-alertsOcular-checkbox",
    "oculares alertas": "antecedents-alertsOcular-checkbox",
    "oculares alerta": "antecedents-alertsOcular-checkbox",
    "alertas oculares": "antecedents-alertsOcular-checkbox",
    "alerta ocular": "antecedents-alertsOcular-checkbox",
    # Otros
    "antecedentes oculares otros": "antecedents-othersOcular-checkbox",
    "otros oculares": "antecedents-othersOcular-checkbox",
    "otro ocular": "antecedents-othersOcular-checkbox",
    "otros antecedentes oculares": "antecedents-othersOcular-checkbox",

    # Antecedentes Oculares - Textarea notas
    "antecedentes oculares nota": "antecedents-ocular-notes-textarea",
    "antecedentes oculares notas": "antecedents-ocular-notes-textarea",
    "nota antecedentes oculares": "antecedents-ocular-notes-textarea",
    "notas antecedentes oculares": "antecedents-ocular-notes-textarea",
    "notas oculares antecedentes": "antecedents-ocular-notes-textarea",

    # ============================================
    # Antecedentes Familiares - Checkboxes
    # ============================================
    # HTA
    "antecedentes familiares hipertensión": "antecedents-ahtFamiliar-checkbox",
    "antecedentes familiares hipertension": "antecedents-ahtFamiliar-checkbox",
    "antecedentes familiares hta": "antecedents-ahtFamiliar-checkbox",
    "familiares hipertensión": "antecedents-ahtFamiliar-checkbox",
    "familiares hipertension": "antecedents-ahtFamiliar-checkbox",
    "familiares hta": "antecedents-ahtFamiliar-checkbox",
    "hipertensión familiar": "antecedents-ahtFamiliar-checkbox",
    "hipertension familiar": "antecedents-ahtFamiliar-checkbox",
    "hta familiar": "antecedents-ahtFamiliar-checkbox",
    # Diabetes
    "antecedentes familiares diabetes": "antecedents-diabetesFamiliar-checkbox",
    "familiares diabetes": "antecedents-diabetesFamiliar-checkbox",
    "diabetes familiar": "antecedents-diabetesFamiliar-checkbox",
    # Asma
    "antecedentes familiares asma": "antecedents-asthmaFamiliar-checkbox",
    "familiares asma": "antecedents-asthmaFamiliar-checkbox",
    "asma familiar": "antecedents-asthmaFamiliar-checkbox",
    # Enfermedad coronaria
    "antecedentes familiares enfermedad coronaria": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "antecedentes familiares cardiopatía coronaria": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "antecedentes familiares cardiopatia coronaria": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "antecedentes familiares cardiopatía": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "antecedentes familiares cardiopatia": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "familiares enfermedad coronaria": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "familiares cardiopatía coronaria": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "familiares cardiopatia coronaria": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "familiares cardiopatía": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "familiares cardiopatia": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "cardiopatía familiar": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "cardiopatia familiar": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "cardiopatía coronaria familiar": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    "cardiopatia coronaria familiar": "antecedents-coronaryHeartDiseaseFamiliar-checkbox",
    # Enfermedad del colágeno
    "antecedentes familiares enfermedad del colágeno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "antecedentes familiares enfermedad del colageno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "antecedentes familiares colágeno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "antecedentes familiares colageno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "familiares enfermedad del colágeno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "familiares enfermedad del colageno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "familiares colágeno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "familiares colageno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "enfermedad del colágeno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "enfermedad del colageno": "antecedents-collagenDiseaseFamiliar-checkbox",
    "colágeno familiar": "antecedents-collagenDiseaseFamiliar-checkbox",
    "colageno familiar": "antecedents-collagenDiseaseFamiliar-checkbox",
    # Glaucoma
    "antecedentes familiares glaucoma": "antecedents-glaucomaFamiliar-checkbox",
    "familiares glaucoma": "antecedents-glaucomaFamiliar-checkbox",
    "glaucoma familiar": "antecedents-glaucomaFamiliar-checkbox",
    # Queratocono
    "antecedentes familiares queratocono": "antecedents-keratoconusFamiliar-checkbox",
    "antecedentes familiares keratocono": "antecedents-keratoconusFamiliar-checkbox",
    "familiares queratocono": "antecedents-keratoconusFamiliar-checkbox",
    "familiares keratocono": "antecedents-keratoconusFamiliar-checkbox",
    "queratocono familiar": "antecedents-keratoconusFamiliar-checkbox",
    "queratocono": "antecedents-keratoconusFamiliar-checkbox",
    "keratocono familiar": "antecedents-keratoconusFamiliar-checkbox",
    # Otros
    "antecedentes familiares otros": "antecedents-othersFamiliar-checkbox",
    "otros familiares": "antecedents-othersFamiliar-checkbox",
    "otro familiar": "antecedents-othersFamiliar-checkbox",
    "otros antecedentes familiares": "antecedents-othersFamiliar-checkbox",

    # Antecedentes Familiares - Textarea notas
    "antecedentes familiares nota": "antecedents-familiar-notes-textarea",
    "antecedentes familiares notas": "antecedents-familiar-notes-textarea",
    "nota antecedentes familiares": "antecedents-familiar-notes-textarea",
    "notas antecedentes familiares": "antecedents-familiar-notes-textarea",
    "notas familiares antecedentes": "antecedents-familiar-notes-textarea",
}

# Mezclar antecedentes keywords en KEYWORD_TO_FIELD
KEYWORD_TO_FIELD.update(_ANTECEDENTES_KEYWORDS)

COMMAND_KEYWORDS = {
    "listo": "cmd_stop",
    "confirmar": "cmd_stop",
    "terminar": "cmd_stop",
    "terminado": "cmd_stop",
    "finalizar": "cmd_stop",
    "finalizado": "cmd_stop",
    "borrar": "cmd_clear",
    "limpiar": "cmd_clear",
    "deshacer": "cmd_clear",
    "borrar todo": "cmd_clear",
    "limpiar todo": "cmd_clear",
    "borrar campo": "cmd_clear",
    "limpiar campo": "cmd_clear",
}

# Override explícito para campos cuyo data-testid engaña la heurística de tipo
# Se verifica PRIMERO en get_field_type() antes de la heurística por substring
FIELD_TYPE_OVERRIDES = {
    # Oftalmología - Textfields que abren panel de hallazgos (son botones, no inputs)
    "oftalmology-external-od-justification-textfield": "button",
    "oftalmology-muscle_balance-od-justification-textfield": "button",
    "oftalmology-ppl-od-justification-textfield": "button",
    "oftalmology-screra_conjunctiva-od-justification-textfield": "button",
    "oftalmology-cornea-od-justification-textfield": "button",
    "oftalmology-previous_chamber-od-justification-textfield": "button",
    "oftalmology-iris-od-justification-textfield": "button",
    "oftalmology-crystalline-od-justification-textfield": "button",
    "oftalmology-retina_vitreous-od-justification-textfield": "button",
    "oftalmology-optic_nerve-od-justification-textfield": "button",
    "oftalmology-pupillometry-od-justification-textfield": "button",
    "oftalmology-gonioscopy-od-justification-textfield": "button",
    "oftalmology-confrontation_visual_field-od-justification-textfield": "button",
    "oftalmology-external-oi-justification-textfield": "button",
    "oftalmology-muscle_balance-oi-justification-textfield": "button",
    "oftalmology-ppl-oi-justification-textfield": "button",
    "oftalmology-screra_conjunctiva-oi-justification-textfield": "button",
    "oftalmology-cornea-oi-justification-textfield": "button",
    "oftalmology-previous_chamber-oi-justification-textfield": "button",
    "oftalmology-iris-oi-justification-textfield": "button",
    "oftalmology-crystalline-oi-justification-textfield": "button",
    "oftalmology-retina_vitreous-oi-justification-textfield": "button",
    "oftalmology-optic_nerve-oi-justification-textfield": "button",
    "oftalmology-pupillometry-oi-justification-textfield": "button",
    "oftalmology-gonioscopy-oi-justification-textfield": "button",
    "oftalmology-confrontation_visual_field-oi-justification-textfield": "button",
    # Panel de hallazgos compartido
    "text-config-findings-select": "button",            # Click abre dropdown hallazgos
    "text-config-search-field": "button",               # Click enfoca búsqueda
    "diagnostic-impression-diagnosis-select": "button",   # Click abre dropdown categorías CIE-10
    "diagnostic-impression-eye-radio-0": "button",        # OD - click directo en input radio nativo
    "diagnostic-impression-eye-radio-1": "button",        # OI
    "diagnostic-impression-eye-radio-2": "button",        # AO
    "diagnostic-impression-eye-radio-3": "button",        # N/A
    # text-config-justification-textarea → "textarea" (se detecta con nueva regla)
    # text-config-save-button → "button" (ya se detecta correctamente)
}

# ============================================
# AMBIGUOUS_BUTTON_KEYWORDS: keywords de botones que son prefijos de keywords
# más largas de otros tipos de campo (checkbox, textarea, etc.).
# Estas NO deben activarse en parciales — Deepgram envía "Antecedentes" antes
# de que llegue "Antecedentes generales diabetes". Solo activar en finales.
# ============================================
def _build_ambiguous_button_keywords():
    """Construye set de keywords de botón que son prefijo de keywords de otros tipos."""
    _button_kw_to_testid = {}
    _non_button_keywords = set()
    for kw, testid in KEYWORD_TO_FIELD.items():
        ftype = FIELD_TYPE_OVERRIDES.get(testid, "")
        if ftype == "button" or testid.endswith("-button"):
            _button_kw_to_testid[kw.lower()] = testid
        else:
            _non_button_keywords.add(kw.lower())
    ambiguous = set()
    for btn_kw in _button_kw_to_testid:
        for non_btn_kw in _non_button_keywords:
            if non_btn_kw.startswith(btn_kw + " ") and non_btn_kw != btn_kw:
                ambiguous.add(btn_kw)
                break
    return ambiguous

AMBIGUOUS_BUTTON_KEYWORDS = _build_ambiguous_button_keywords()

# Campos que requieren flujo "exclusivo" (lock)
# Una vez activados, NO se debe cambiar a otro campo hasta que se diga "listo" o "terminar"
EXCLUSIVE_FIELDS = {
    "attention-origin-reason-for-consulting-badge-field",
    "attention-origin-current-disease-badge-field",
    "oftalmology-observations-textarea",
    "analysis-and-plan-textarea",
    "text-config-justification-textarea",  # Justificación hallazgo oftalmológico
    "antecedents-general-notes-textarea",   # Notas antecedentes generales
    "antecedents-ocular-notes-textarea",    # Notas antecedentes oculares
    "antecedents-familiar-notes-textarea",  # Notas antecedentes familiares
    ""
}

# ============================================
# Mapeo checkbox → input companion (flujo HYBRID)
# Cuando el doctor dice una keyword de antecedente:
#   1. Se marca el checkbox
#   2. Se activa el input companion para dictado
#   3. El doctor dicta el comentario hasta "listo"
# ============================================
CHECKBOX_WITH_INPUT = {
    # Generales (12)
    "antecedents-arterialHypertension-checkbox": "antecedents-arterialHypertensioninput",
    "antecedents-diabetesGeneral-checkbox": "antecedents-diabetesGeneralinput",
    "antecedents-asthmaGeneral-checkbox": "antecedents-asthmaGeneralinput",
    "antecedents-cancerGeneral-checkbox": "antecedents-cancerGeneralinput",
    "antecedents-coronaryHeartDiseaseGeneral-checkbox": "antecedents-coronaryHeartDiseaseGeneralinput",
    "antecedents-tuberculosisGeneral-checkbox": "antecedents-tuberculosisGeneralinput",
    "antecedents-rheumatoidArthritisGeneral-checkbox": "antecedents-rheumatoidArthritisGeneralinput",
    "antecedents-copdGeneral-checkbox": "antecedents-copdGeneralinput",
    "antecedents-previousSurgeriesGeneral-checkbox": "antecedents-previousSurgeriesGeneralinput",
    "antecedents-allergiesGeneral-checkbox": "antecedents-allergiesGeneralinput",
    "antecedents-useMedicationsGeneral-checkbox": "antecedents-useMedicationsGeneralinput",
    "antecedents-othersGeneral-checkbox": "antecedents-othersGeneralinput",
    # Oculares (12)
    "antecedents-glaucomaOcular-checkbox": "antecedents-glaucomaOcularinput",
    "antecedents-ropOcular-checkbox": "antecedents-ropOcularinput",
    "antecedents-dmreOcular-checkbox": "antecedents-dmreOcularinput",
    "antecedents-glassesOcular-checkbox": "antecedents-glassesOcularinput",
    "antecedents-dryEyeOcular-checkbox": "antecedents-dryEyeOcularinput",
    "antecedents-diabeticRetinoPathyOcular-checkbox": "antecedents-diabeticRetinoPathyOcularinput",
    "antecedents-uveitisOcular-checkbox": "antecedents-uveitisOcularinput",
    "antecedents-contactLensesOcular-checkbox": "antecedents-contactLensesOcularinput",
    "antecedents-traumasOcular-checkbox": "antecedents-traumasOcularinput",
    "antecedents-surgeriesOcular-checkbox": "antecedents-surgeriesOcularinput",
    "antecedents-alertsOcular-checkbox": "antecedents-alertsOcularinput",
    "antecedents-othersOcular-checkbox": "antecedents-othersOcularinput",
    # Familiares (8)
    "antecedents-ahtFamiliar-checkbox": "antecedents-ahtFamiliarinput",
    "antecedents-diabetesFamiliar-checkbox": "antecedents-diabetesFamiliarinput",
    "antecedents-asthmaFamiliar-checkbox": "antecedents-asthmaFamiliarinput",
    "antecedents-coronaryHeartDiseaseFamiliar-checkbox": "antecedents-coronaryHeartDiseaseFamiliarinput",
    "antecedents-collagenDiseaseFamiliar-checkbox": "antecedents-collagenDiseaseFamiliarinput",
    "antecedents-glaucomaFamiliar-checkbox": "antecedents-glaucomaFamiliarinput",
    "antecedents-keratoconusFamiliar-checkbox": "antecedents-keratoconusFamiliarinput",
    "antecedents-othersFamiliar-checkbox": "antecedents-othersFamiliarinput",
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
        self.last_keyword: str = ""  # última palabra clave detectada
        self.min_chars_to_send: int = 5  # mínimo de caracteres para enviar

        # Sistema de 2 capas para manejar utterances de Deepgram:
        # _confirmed_base: texto de utterances ANTERIORES ya confirmados (is_final=True)
        # _current_utterance: texto del utterance ACTUAL (parciales acumulativos)
        # accumulated_text = _confirmed_base + " " + _current_utterance
        self._confirmed_base: str = ""      # Texto confirmado de utterances previos
        self._current_utterance: str = ""    # Utterance actual (parciales sobrescriben aquí)

    @property
    def accumulated_text(self) -> str:
        """Texto completo = base confirmada + utterance actual."""
        base = self._confirmed_base.strip()
        current = self._current_utterance.strip()
        if base and current:
            return f"{base} {current}"
        return base or current

    @accumulated_text.setter
    def accumulated_text(self, value: str):
        """Setter para compatibilidad. Establece todo como base confirmada."""
        self._confirmed_base = value.strip()
        self._current_utterance = ""

    def activate_field(self, testid: str, keyword: str, initial_text: str = "") -> Optional[Tuple[str, str]]:
        """
        Activa un nuevo campo y retorna el contenido del campo anterior si existe.

        Args:
            testid: data-testid del campo a activar
            keyword: palabra clave que activó el campo
            initial_text: texto inicial para el campo (ej: valor previo de already_filled
                          para preservar contenido al re-entrar a un campo)
        """
        # Si es el MISMO campo que ya tenemos activo, no resetear acumulado
        if testid == self.active_field:
            self.last_keyword = keyword
            return None

        previous_data = None
        if self.active_field and self.accumulated_text.strip():
            previous_data = (self.active_field, self.accumulated_text.strip())
            logger.info(f"[ActiveField] Finalizando campo anterior '{self.active_field}'")

        self.active_field = testid
        self._confirmed_base = initial_text  # Preservar texto previo al re-entrar campo
        self._current_utterance = ""
        self.last_keyword = keyword
        self._last_sent_text = ""
        logger.info(f"[ActiveField] Nuevo campo activado: '{testid}' (keyword: '{keyword}', initial='{initial_text[:50]}')")
        return previous_data

    def set_partial(self, text: str) -> None:
        """
        Establece el texto del utterance ACTUAL (parciales de Deepgram).

        Los parciales son acumulativos: cada uno contiene TODO el texto del utterance.
        Solo sobrescribe _current_utterance, preserva _confirmed_base intacta.

        Ejemplo:
            base = "dolor de cabeza"  (utterance 1, ya confirmado)
            Parcial 1: "también tiene"      → current = "también tiene"
            Parcial 2: "también tiene fiebre" → current = "también tiene fiebre"
            accumulated = "dolor de cabeza también tiene fiebre"
        """
        if self.active_field:
            self._current_utterance = text.strip()
            logger.info(
                f"[ActiveField] set_partial: current='{self._current_utterance[:60]}' "
                f"| base='{self._confirmed_base[:60]}' "
                f"| full='{self.accumulated_text[:80]}'"
            )

    def confirm_utterance(self, final_text: str) -> None:
        """
        Confirma el utterance actual y lo mueve a la base confirmada.

        Se llama cuando llega is_final=True de Deepgram.
        El texto final es la versión más precisa del utterance → reemplaza _current_utterance
        y todo se fusiona en _confirmed_base.

        Ejemplo:
            base = "dolor de cabeza"
            current = "también tiene fiebre" (último parcial)
            confirm_utterance("también tiene fiebre")
            → base = "dolor de cabeza también tiene fiebre"
            → current = ""
        """
        if not self.active_field:
            return

        final_clean = final_text.strip()
        if not final_clean:
            return

        # Mover utterance actual a base confirmada
        base = self._confirmed_base.strip()
        if base:
            self._confirmed_base = f"{base} {final_clean}"
        else:
            self._confirmed_base = final_clean
        self._current_utterance = ""

        logger.info(
            f"[ActiveField] confirm_utterance: base='{self._confirmed_base[:80]}' "
            f"({len(self._confirmed_base)} chars)"
        )

    def clear(self) -> None:
        """Limpia el contenido del campo activo."""
        self._confirmed_base = ""
        self._current_utterance = ""

    def append_text(self, text: str) -> None:
        """Añade texto nuevo a la base confirmada (para nuevas oraciones tras pausa)."""
        if not self.active_field:
            return

        text_clean = text.strip()
        if not text_clean:
            return

        base = self._confirmed_base.strip()
        if base:
            # Evitar duplicación: verificar que el texto no esté ya contenido
            if text_clean.lower() in base.lower():
                logger.info(f"[ActiveField] append_text: ignorado (ya contenido en base)")
                return
            self._confirmed_base = f"{base} {text_clean}"
        else:
            self._confirmed_base = text_clean

        logger.info(f"[ActiveField] append_text: base='{self._confirmed_base[:80]}'")
    
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
        self._confirmed_base = ""
        self._current_utterance = ""
        self.last_keyword = ""

        return data

    def reset(self) -> None:
        """Reinicia completamente el estado del tracker."""
        self.active_field = None
        self._confirmed_base = ""
        self._current_utterance = ""
        self.last_keyword = ""
        self._last_sent_text = ""
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
    # Motivo de consulta
    # IMPOTANTE: Se elimina para que pase por el flujo "exclusivo" (lock)
    # y requiera "listo" para terminar.
    # ("attention-origin-reason-for-consulting-badge-field", "after", [ ... ]),

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


def _strip_accents(s: str) -> str:
    """Elimina acentos/tildes de una cadena: 'análisis' → 'analisis'."""
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


# Mapa inverso: testid → {todas las keywords que apuntan a ese testid}
# Se usa para limpiar TODAS las variantes de keyword del texto, no solo la que activó el campo
_TESTID_TO_KEYWORDS: dict[str, set[str]] = {}
for _kw, _tid in KEYWORD_TO_FIELD.items():
    _TESTID_TO_KEYWORDS.setdefault(_tid, set()).add(_kw)
    _TESTID_TO_KEYWORDS[_tid].add(_strip_accents(_kw))


def strip_keywords_and_commands(text: str, active_keyword: str = "", active_testid: str = "") -> str:
    """
    Limpia SOLO la keyword activadora del INICIO del texto y comandos de control.

    IMPORTANTE: NO elimina keywords del medio/final del texto para preservar
    el contenido completo del doctor. Si el doctor dice:
    "Motivo de consulta paciente tiene dolor y necesita tratamiento"
    Solo elimina "Motivo de consulta" del inicio, preserva todo lo demás intacto.

    Args:
        text: Texto a limpiar
        active_keyword: La keyword que activó el campo actual (se elimina del inicio)
        active_testid: El testid del campo activo. Si se proporciona, se intentan
                       TODAS las keywords que apuntan a ese testid (robustez ante
                       variantes de Deepgram: con/sin tildes, con/sin artículos).

    Returns:
        Texto con la keyword activadora removida del inicio
    """
    if not text:
        return text

    val = text.strip()

    # 1. Recopilar TODAS las variantes de keyword a intentar limpiar
    all_variants: set[str] = set()
    if active_keyword:
        all_variants.add(active_keyword)
        all_variants.add(_strip_accents(active_keyword))
    if active_testid and active_testid in _TESTID_TO_KEYWORDS:
        all_variants.update(_TESTID_TO_KEYWORDS[active_testid])

    # Ordenar de más larga a más corta: limpiar primero la variante más larga
    # para evitar dejar fragmentos (ej: "de la consulta" si solo limpiamos "consulta")
    #
    # PASO 1a: Intentar limpiar del INICIO del texto (caso normal)
    cleaned_from_start = False
    for kw_variant in sorted(all_variants, key=len, reverse=True):
        pattern = re.compile(
            r"^" + re.escape(kw_variant) + r"\b[.,;:\s]*",
            re.IGNORECASE
        )
        new_val = pattern.sub("", val).strip()
        if new_val != val:
            val = new_val
            cleaned_from_start = True
            break

    # PASO 1b: Si no encontramos la keyword al inicio, buscar en CUALQUIER posición
    # y tomar solo el contenido DESPUÉS de la keyword.
    # Esto maneja parciales acumulativos de Deepgram donde la keyword está en el medio:
    # "paciente tiene dolor motivo de consulta dolor de cabeza" → "dolor de cabeza"
    if not cleaned_from_start and all_variants:
        val_lower = val.lower()
        val_no_accent = _strip_accents(val_lower)
        best_end = -1
        for kw_variant in sorted(all_variants, key=len, reverse=True):
            kw_lower = kw_variant.lower()
            # Buscar en texto original y sin acentos
            for search_text in (val_lower, val_no_accent):
                idx = search_text.rfind(kw_lower)
                if idx != -1:
                    end_pos = idx + len(kw_lower)
                    if end_pos > best_end:
                        best_end = end_pos
        if best_end > 0:
            # Tomar solo lo que viene después de la keyword
            val = val[best_end:].strip()
            # Limpiar puntuación/conectores sobrantes al inicio
            val = re.sub(r"^[.,;:\s]+", "", val).strip()

    # 2. Eliminar SOLO comandos de control (listo, borrar, etc.) - estos nunca son contenido clínico
    for cmd in COMMAND_KEYWORDS:
        pattern = re.compile(r"\b" + re.escape(cmd) + r"\b[.,;:\s]*$", re.IGNORECASE)
        val = pattern.sub("", val).strip()

    # 3. Limpiar espacios múltiples
    val = re.sub(r"\s{2,}", " ", val).strip()

    return val

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
    r"origen|general|evento\s+adverso|soat|tránsito|transito|url|laboral|profesional|resultados|"
    r"padecimiento|cuadro\s+clínico|cuadro\s+clinico|"
    r"antecedente|alergia|medicamento|cirugía|cirugia|"
    r"evolución|evolucion|tiempo|cantidad|valor|unidad|"
    r"segundos?|minutos?|horas?|días?|dias?|semanas?|meses|mes|años?|anios?|"
    # Preconsulta - clasificación del riesgo
    r"clasificación|clasificacion|riesgo\s+de\s+caída|riesgo\s+de\s+caida|"
    # Clasificación del riesgo - campos
    r"caídas?\s+previas?|caidas?\s+previas?|déficit\s+sensorial|deficit\s+sensorial|"
    r"estado\s+mental|marcha\s+actual|medicación\s+actual|medicacion\s+actual|"
    # Clasificación del riesgo - formas cortas y variantes Deepgram
    r"difícil\s+sensorial|dificil\s+sensorial|sensorial|mental|marcha|caídas|caidas|medicación|medicacion|"
    # Preconsulta - navegación
    r"signos\s+vitales|tamizaje|conciliación|conciliacion|medicamentosa|dilatado|"
    r"ortopédica|ortopedica|ortóptica|ortoptica|preconsulta|"
    # Comandos de borrado (safety net)
    r"borrar|limpiar|deshacer|"
    # Oftalmología - hallazgos
    r"externo|hallazgo|hallazgos|justificación|justificacion|guardar|"
    r"texto\s+predefinido|buscar\s+texto|"
    # Opciones de hallazgo OD Externo
    r"párpados|parpados|simétricos|simetricos|edema\s+palpebral|"
    r"pestañas|pestanas|distribución|distribucion|uniformes?|"
    r"movimientos\s+oculares|conjugados|lesiones|lesión|lesion|rosácea|rosacea|"
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
        "URL": "Accidente de trabajo",
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
    # Eliminar comas y signos de interrogación para campos de texto
    val_clean = val_clean.replace(",", "").replace("?", "").replace("¿", "").replace("!", "").replace("¡", "")
    
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

    # Texto médico: capitalizar primera letra y eliminar puntuación
    if field_type in ("text", "textarea"):
        cleaned = value.strip().replace(",", "").replace("?", "").replace("¿", "").replace("!", "").replace("¡", "")
        return cleaned.capitalize() if cleaned else cleaned

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
        # Mapa dinámico generado a partir del escaneo del frontend
        # key: keyword variante (lowercase) -> value: data_testid
        self.dynamic_keyword_map: Dict[str, str] = {}
        # Seeds útiles (pueden añadirse más manualmente)
        # NOTA: Keywords genéricas como "observaciones", "observacion", "notas", "comentarios"
        # se eliminaron porque causaban activaciones falsas durante el dictado.

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
        # Guardar campos y construir mapeo dinámico de keywords
        self.biowel_fields = [BiowelFieldIdentifier(**f) for f in fields]
        logger.info(f"Campos Biowel cargados: {len(self.biowel_fields)}")
        try:
            self.sync_with_biowel_fields(fields)
        except Exception:
            logger.exception("Error generando dynamic keyword map desde Biowel fields")

    def set_already_filled(self, filled: Dict[str, str]) -> None:
        """Recibe campos ya llenos para no repetirlos."""
        self.already_filled = filled

    def sync_with_biowel_fields(self, fields: List[Dict]) -> None:
        """
        Construye `self.dynamic_keyword_map` a partir de los campos
        enviados por el frontend (scanner). Genera variantes y sinónimos
        útiles para detección por keyword.
        """
        self.dynamic_keyword_map = {}
        # Asegurar que biowel_fields también esté poblado con objetos
        self.biowel_fields = [BiowelFieldIdentifier(**f) for f in fields]

        for field in self.biowel_fields:
            label = (field.label or "").strip().lower()
            testid = field.data_testid
            if not label or not testid:
                continue

            # select-default-* siempre ignorar (placeholder text)
            if "select-default-" in testid:
                continue

            # select-option-*: registrar SOLO el label completo como keyword
            # (son testids genéricos reutilizados por diferentes dropdowns,
            #  generar sub-keywords causaría colisiones)
            if testid.startswith("select-option-"):
                if label not in self.dynamic_keyword_map:
                    self.dynamic_keyword_map[label] = testid
                continue

            keywords = self._generate_keywords_from_label(label)
            synonyms = self._get_synonyms(label)
            for kw in keywords + synonyms:
                kw_norm = kw.strip().lower()
                if len(kw_norm) < 2:
                    continue
                # No sobrescribir si ya existe un mapeo más específico
                if kw_norm in self.dynamic_keyword_map:
                    continue
                self.dynamic_keyword_map[kw_norm] = testid

        logger.info(f"Dynamic keyword map construido: {len(self.dynamic_keyword_map)} entradas")

    def add_manual_mappings(self, mappings: Dict[str, str]) -> None:
        """Permite añadir mapeos manuales al dynamic_keyword_map.

        mappings: dict donde key = keyword (str) y value = data_testid (str)
        """
        for k, v in mappings.items():
            if not k or not v:
                continue
            self.dynamic_keyword_map[k.strip().lower()] = v.strip()
        logger.info(f"Se agregaron {len(mappings)} mapeos manuales al dynamic_keyword_map")

    # Keywords demasiado genéricas que aparecen naturalmente en dictado clínico.
    # NO deben usarse como activadores de campos desde el dynamic_keyword_map.
    _DYNAMIC_KW_BLACKLIST = {
        "ambos ojos", "ambos", "ojos", "normal", "examen", "examen normal",
        "normal en", "en ambos", "en ambos ojos", "normal en ambos",
        "ojo", "derecho", "izquierdo", "ojo derecho", "ojo izquierdo",
        "bilateral", "los dos",
        # Preconsulta — solo frases completas deben activar estos botones
        "ocular", "preconsulta", "signos", "vitales", "signos vitales",
        "medicamentosa", "conciliación", "conciliacion",
        "ortopédica", "ortopedica",
        # "enfermedad" sola es substring de "enfermedades del aparato X" (diagnóstico)
        # La keyword correcta es "enfermedad actual" (estática en KEYWORD_TO_FIELD)
        "enfermedad", "enfermedades",
        # "actual" sola es demasiado genérica
        "actual",
        # Palabras genéricas que causan activaciones falsas de campos principales
        "observaciones", "observacion", "observación",
        "notas", "comentarios",
        "análisis", "analisis", "plan", "y plan", "analisis y", "análisis y",
        "consulta", "consulta por", "motivo", "de consulta", "motivo de",
        "cuadro", "cuadro clínico", "cuadro clinico",
        "padecimiento", "padecimiento actual",
        # Antecedentes — solo frases con categoría deben activar
        "generales", "general", "en general", "oculares", "familiares",
        "antecedentes", "antecedente",
    }

    def _generate_keywords_from_label(self, label: str) -> List[str]:
        """Genera variantes de keywords a partir de un label."""
        parts = label.split()
        keywords = set()
        # Frase completa
        keywords.add(label)
        # Palabras individuales (solo si tienen >= 3 caracteres)
        for p in parts:
            if len(p) >= 3:  # Evitar palabras muy cortas como "el", "la", "go", etc.
                keywords.add(p)
        # Combinaciones consecutivas (n-grams) - solo frases de 2+ palabras
        for i in range(len(parts)):
            for j in range(i + 1, len(parts) + 1):
                phrase = " ".join(parts[i:j])
                if len(phrase) >= 5:  # Solo n-gramas con 5+ caracteres
                    keywords.add(phrase)

        # Variantes sin acentos
        import unicodedata
        for kw in list(keywords):
            sin_acento = ''.join(c for c in unicodedata.normalize('NFD', kw) if unicodedata.category(c) != 'Mn')
            keywords.add(sin_acento)

        # Filtrar keywords genéricas que causan falsos positivos en dictado clínico
        keywords = {k for k in keywords if k.strip().lower() not in self._DYNAMIC_KW_BLACKLIST}

        # Filtrar muy cortitos: mínimo 3 caracteres para palabras aisladas, 5 para frases
        return [k for k in keywords if len(k.strip()) >= 3]

    def _get_synonyms(self, label: str) -> List[str]:
        """Retorna sinónimos médicamente relevantes según el label."""
        # Mapa simple de sinónimos; puede extenderse
        synonyms_map = {
            # NOTA: "motivo de consulta" y "enfermedad actual" ya no generan sinónimos cortos
            # para evitar activaciones falsas durante dictado
            "presión intraocular": ["pio", "tonometría", "tonometria"],
            "agudeza visual": ["agudeza", "av", "visual"],
            # NOTA: "observaciones" ya no genera sinónimos genéricos
            "refracción": ["refraccion", "refraction"],
            "córnea": ["cornea", "corneal"],
        }
        res = []
        for pattern, syns in synonyms_map.items():
            if pattern in label:
                res.extend(syns)
        return res

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
        """Detecta la palabra clave más específica (más larga) en el texto.
        
        Prioridad:
        1. Comandos (listo, borrar) GANAN si aparecen DESPUÉS de la última keyword de campo
           Esto permite cerrar campos: "motivo de consulta estrés listo" → cmd_stop
        2. Keyword MÁS LARGA siempre gana (más específica)
        3. Si misma longitud, posición más tardía (rfind)
        
        Esto evita que keywords cortas del mapa dinámico (ej: "normal")
        sobreescriban frases específicas (ej: "ojos normales", "examen normal").
        """
        text_lower = text.lower()
        # Strip puntuación que Deepgram smart_format agrega (comas, puntos, etc.)
        # Convierte "caídas previas, sí." → "caídas previas sí"
        text_lower = re.sub(r'[,.\!¿?\¡;:\-]+', ' ', text_lower)
        text_lower = re.sub(r'\s+', ' ', text_lower).strip()
        # Versión limpia del texto original (preserva mayúsculas) para content_after
        text_for_content = re.sub(r'[,.\!¿?\¡;:\-]+', ' ', text)
        text_for_content = re.sub(r'\s+', ' ', text_for_content).strip()
        best_match = None
        best_kw_len = -1
        best_idx = -1
        
        # Track del mejor comando y mejor keyword de campo por separado
        best_cmd_match = None
        best_cmd_idx = -1
        best_field_match = None
        best_field_idx = -1
        
        def _try_match(kw: str, testid: str, kw_for_return: str, is_command: bool = False):
            """Intenta matchear un keyword. Prioriza longitud > posición."""
            nonlocal best_match, best_kw_len, best_idx
            nonlocal best_cmd_match, best_cmd_idx, best_field_match, best_field_idx
            idx = text_lower.rfind(kw.lower())
            if idx == -1:
                return
            kw_len = len(kw)
            # Priorizar por longitud (más larga = más específica)
            # Solo usar posición como desempate si misma longitud
            if kw_len > best_kw_len or (kw_len == best_kw_len and idx > best_idx):
                best_kw_len = kw_len
                best_idx = idx
                content_after = text_for_content[idx + kw_len:].strip()
                best_match = (testid, kw_for_return, content_after)
            
            # Guardar mejor comando y mejor campo por separado
            if is_command:
                if idx > best_cmd_idx:
                    best_cmd_idx = idx
                    content_after = text_for_content[idx + kw_len:].strip()
                    best_cmd_match = (testid, kw_for_return, content_after)
            else:
                kw_end = idx + kw_len
                if kw_end > best_field_idx:
                    best_field_idx = kw_end
                    content_after = text_for_content[idx + kw_len:].strip()
                    best_field_match = (testid, kw_for_return, content_after)
        
        # 0. Buscar frases de DESMARCAR checkbox (ej: "borrar ojos normales")
        # Son las más largas y específicas, evaluarlas primero
        for phrase, testid in KEYWORD_TO_UNCHECK.items():
            _try_match(phrase, "cmd_uncheck::" + testid, phrase, is_command=True)

        # 1. Buscar comandos (listo, borrar, etc.)
        for cmd, testid in COMMAND_KEYWORDS.items():
            _try_match(cmd, testid, cmd, is_command=True)

        # 2. Buscar en KEYWORD_TO_FIELD estático
        # Evaluarlo ANTES del mapa dinámico para que keywords conocidas
        # (como "ojos normales" → checkbox) no sean sobreescritas
        for keyword, testid in KEYWORD_TO_FIELD.items():
            _try_match(keyword, testid, keyword, is_command=False)

        # 3. Buscar en mapa dinámico generado por el scanner
        # Este va último porque genera keywords automáticas que
        # pueden ser substrings de frases que ya están en KEYWORD_TO_FIELD
        if self.dynamic_keyword_map:
            for keyword, testid in self.dynamic_keyword_map.items():
                _try_match(keyword, testid, keyword, is_command=False)
        
        # REGLA ESPECIAL: Si un comando aparece DESPUÉS de la última keyword de campo,
        # el comando gana. Ej: "motivo de consulta estrés listo" → cmd_stop
        # best_cmd_idx = posición donde empieza el comando
        # best_field_idx = posición donde TERMINA la keyword de campo
        if best_cmd_match and best_field_match and best_cmd_idx >= best_field_idx:
            testid, keyword, content_after = best_cmd_match
            content_after = clean_captured_value(content_after)
            logger.info(f"[Keyword] Comando '{keyword}' gana (pos={best_cmd_idx}) sobre campo (end={best_field_idx})")
            return (testid, keyword, content_after)
        
        if best_match:
            testid, keyword, content_after = best_match
            content_after = clean_captured_value(content_after)
            logger.info(f"[Keyword] Match: '{keyword}' → '{testid}' (len={best_kw_len}, idx={best_idx})")
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

        # Override explícito — MÁXIMA prioridad (sobre biowel_fields y todo lo demás)
        # Necesario para campos como diagnostic-impression-diagnosis-select que el scanner
        # reporta como "select" pero que el backend necesita tratar como "button" (click)
        if unique_key in FIELD_TYPE_OVERRIDES:
            return FIELD_TYPE_OVERRIDES[unique_key]

        # Buscar en biowel_fields (si existe) - segunda prioridad
        # Esto garantiza que el scanner (frontend) está en control del tipo
        if self.biowel_fields:
            for field in self.biowel_fields:
                if getattr(field, 'unique_key', None) == unique_key or (isinstance(field, dict) and field.get('unique_key') == unique_key):
                    # Manejar tanto objetos como dicts
                    field_type = getattr(field, 'field_type', None) or (isinstance(field, dict) and field.get('field_type'))
                    if field_type:
                        return field_type

        # Opciones de dropdown (select-option-X) son clickeables, no selects
        if unique_key.startswith("select-option"):
            return "button"

        # Fallback para campos de producción conocidos si biowel_fields está vacío
        if "select" in unique_key:
            return "select"
        if "switch" in unique_key or "check" in unique_key:
            return "checkbox"
        if "evolution-time-input" in unique_key:
            return "number"
        if "badge-field" in unique_key or "history" in unique_key:
            return "textarea"
        if "textarea" in unique_key:
            return "textarea"
        if "radio" in unique_key:
            return "radio"
        if "button" in unique_key or "dropdown-item" in unique_key or unique_key.startswith("preconsultation-tab"):
            return "button"

        return "text"
