// ==UserScript==
// @name              biowel-voice-assistant
// @version           2.0.0
// @description       Voice assistant for Biowel EHR
// @author            Diego Arbeláez
// @namespace         http://tampermonkey.net/
// @match             https://*.biowel.com/*
// @grant             none
// ==/UserScript==

(function() {
  "use strict";
  ;
  const CONFIG = {
    BACKEND_WS: "ws://localhost:8000/ws/voice-stream",
    BACKEND_HTTP: "http://localhost:8000",
    BATCH_ENDPOINT: "/api/biowel/audio/process",
    MIN_DATA_TESTID_COUNT: 3,
    HIGHLIGHT_COLOR: "#6e22c5",
    HIGHLIGHT_DURATION: 1e3
  };
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  const REGISTERED_FIELDS = {
    "attention-origin-reason-for-consulting-badge-field": {
      label: "Motivo de consulta",
      section: "motivo_consulta",
      fieldType: "textarea",
      keywords: ["motivo de consulta", "motivo", "consulta por"]
    },
    "attention-origin-current-disease-badge-field": {
      label: "Enfermedad actual",
      section: "enfermedad_actual",
      fieldType: "textarea",
      keywords: ["enfermedad actual", "padecimiento actual", "cuadro clínico"]
    },
    "attention-origin-select": {
      label: "Origen de la atención",
      section: "motivo_consulta",
      fieldType: "select",
      keywords: ["origen de la atención", "origen de atención", "general", "soat", "laboral", "profesional"]
    },
    "attention-origin-adverse-event-checkbox": {
      label: "Evento adverso",
      section: "motivo_consulta",
      fieldType: "checkbox",
      keywords: ["evento adverso", "adverso"]
    },
    "oftalmology-all-normal-checkbox": {
      label: "Examen normal en ambos ojos",
      section: "biomicroscopia",
      fieldType: "checkbox",
      keywords: ["ojos normales", "examen normal", "todo normal", "ambos ojos normales"]
    },
    "diagnostic-impression-diagnosis-select": {
      label: "Impresión diagnóstica",
      section: "diagnostico",
      fieldType: "select",
      keywords: ["impresión diagnóstica", "diagnóstico"]
    },
    "attention-origin-evolution-time-input": {
      label: "Tiempo de evolución (cantidad)",
      section: "motivo_consulta",
      fieldType: "number",
      keywords: ["cantidad", "valor"]
    },
    "attention-origin-evolution-time-unit-select": {
      label: "Tiempo de evolución (unidad)",
      section: "motivo_consulta",
      fieldType: "select",
      keywords: ["tiempo", "unidad"]
    },
    "oftalmology-observations-textarea": {
      label: "Observaciones",
      section: "biomicroscopia",
      fieldType: "textarea",
      keywords: ["observaciones", "observación", "notas", "comentarios"]
    },
    "analysis-and-plan-textarea": {
      label: "Análisis y plan",
      section: "diagnostico",
      fieldType: "textarea",
      keywords: ["análisis y plan", "analisis y plan", "análisis", "analisis", "plan"]
    },
    "diagnostic-impression-type-cie10-radio": {
      label: "IDX (CIE-10)",
      section: "diagnostico",
      fieldType: "radio",
      keywords: ["diagnóstico", "diagnostico", "idx"]
    },
    "diagnostic-impression-type-extended-radio": {
      label: "IDX Ampliada",
      section: "diagnostico",
      fieldType: "radio",
      keywords: ["diagnóstico ampliado", "diagnostico ampliado", "idx ampliada", "ampliada"]
    },
    // ============================================
    // Preconsulta - Dropdown items (botones clickeables)
    // ============================================
    "header-preconsultation-dropdown-item-0": {
      label: "Preconsulta Dilatación",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["preconsulta dilatación", "preconsulta dilatacion", "dilatación", "dilatacion"]
    },
    "header-preconsultation-dropdown-item-1": {
      label: "Preconsulta Signos vitales",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["preconsulta signos vitales", "signos vitales"]
    },
    "header-preconsultation-dropdown-item-2": {
      label: "Preconsulta Tamizaje ocular",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["preconsulta tamizaje ocular", "tamizaje ocular", "tamizaje"]
    },
    "header-preconsultation-dropdown-item-3": {
      label: "Preconsulta Conciliación medicamentosa",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["preconsulta conciliación medicamentosa", "preconsulta conciliacion medicamentosa", "conciliación medicamentosa", "conciliacion medicamentosa"]
    },
    "header-preconsultation-dropdown-item-4": {
      label: "Preconsulta Ortopédica",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["preconsulta ortopédica", "preconsulta ortopedica", "ortopédica", "ortopedica"]
    },
    // Preconsulta - Botón Atrás
    "preconsultation-back-button": {
      label: "Atrás (preconsulta)",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["atrás", "atras", "volver"]
    },
    // ============================================
    // Preconsulta - Tabs (dentro de pantalla preconsulta)
    // ============================================
    "preconsultation-tab-dilatation": {
      label: "Tab Dilatación",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["tab dilatación", "tab dilatacion"]
    },
    "preconsultation-tab-vitalSigns": {
      label: "Tab Signos Vitales",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["tab signos vitales"]
    },
    "preconsultation-tab-eyescreening": {
      label: "Tab Tamizaje Ocular",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["tab tamizaje ocular", "tab tamizaje"]
    },
    "preconsultation-tab-medicines": {
      label: "Tab Conciliación Medicamentosa",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["tab conciliación medicamentosa", "tab conciliacion medicamentosa", "tab medicamentos"]
    },
    "preconsultation-tab-fallRiskAssessment": {
      label: "Clasificación del Riesgo",
      section: "preconsulta",
      fieldType: "button",
      keywords: [
        "clasificación del riesgo",
        "clasificacion del riesgo",
        "clasificacion de riego",
        "clasificación de riego",
        "clasificacion riesgo",
        "clasificación riesgo",
        "del riesgo",
        "riesgo de caída",
        "riesgo de caida"
      ]
    },
    // ============================================
    // Clasificación del Riesgo - Radio buttons
    // ============================================
    "fall-risk-previousFalls-yes-radio": {
      label: "Caídas previas Sí",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["caídas previas sí", "caidas previas si"]
    },
    "fall-risk-previousFalls-no-radio": {
      label: "Caídas previas No",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["caídas previas no", "caidas previas no"]
    },
    "fall-risk-sensoryDeficit-yes-radio": {
      label: "Déficit sensorial Sí",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["déficit sensorial sí", "deficit sensorial si"]
    },
    "fall-risk-sensoryDeficit-no-radio": {
      label: "Déficit sensorial No",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["déficit sensorial no", "deficit sensorial no"]
    },
    "fall-risk-mentalState-yes-radio": {
      label: "Estado mental Sí",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["estado mental sí", "estado mental si"]
    },
    "fall-risk-mentalState-no-radio": {
      label: "Estado mental No",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["estado mental no", "estado mental no"]
    },
    "fall-risk-gaitAndMobility-yes-radio": {
      label: "Marcha actual Sí",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["marcha actual sí", "marcha actual si", "marcha y movilidad"]
    },
    "fall-risk-gaitAndMobility-no-radio": {
      label: "Marcha actual No",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["marcha actual no", "marcha actual no"]
    },
    "fall-risk-medication-yes-radio": {
      label: "Medicación actual Sí",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["medicación actual sí", "medicacion actual si"]
    },
    "fall-risk-medication-no-radio": {
      label: "Medicación actual No",
      section: "clasificacion_riesgo",
      fieldType: "radio",
      keywords: ["medicación actual no", "medicacion actual no"]
    },
    "preconsultation-tab-orthoptic": {
      label: "Tab Ortóptica",
      section: "preconsulta",
      fieldType: "button",
      keywords: ["tab ortopédica", "tab ortopedica", "tab ortóptica", "tab ortoptica"]
    },
    // ============================================
    // Dilatación - Radio buttons y botón
    // ============================================
    "dilatation-requires-yes-radio": {
      label: "Dilatación Sí",
      section: "dilatacion",
      fieldType: "radio",
      keywords: ["dilatación sí", "dilatacion si", "requiere dilatación"]
    },
    "dilatation-requires-no-radio": {
      label: "Dilatación No",
      section: "dilatacion",
      fieldType: "radio",
      keywords: ["dilatación no", "dilatacion no", "no requiere dilatación"]
    },
    "dilatation-add-record-button": {
      label: "Agregar registro dilatación",
      section: "dilatacion",
      fieldType: "button",
      keywords: ["agregar registro", "agregar dilatación", "agregar dilatacion"]
    },
    "dilatation-patient-dilated-switch": {
      label: "Paciente dilatado",
      section: "dilatacion",
      fieldType: "checkbox",
      keywords: ["paciente dilatado", "ya dilatado", "dilatado"]
    },
    // ============================================
    // Oftalmología - OD Externo (Ojo Derecho Externo)
    // ============================================
    "oftalmology-external-od-justification-textfield": {
      label: "OD Externo (abrir panel)",
      section: "oftalmologia_externo",
      fieldType: "button",
      keywords: ["ojo derecho externo", "od externo", "derecho externo"]
    },
    "text-config-findings-select": {
      label: "Hallazgos (dropdown)",
      section: "oftalmologia_externo",
      fieldType: "button",
      keywords: ["hallazgo", "hallazgos", "buscar hallazgo"]
    },
    "text-config-justification-textarea": {
      label: "Justificación hallazgo",
      section: "oftalmologia_externo",
      fieldType: "textarea",
      keywords: ["justificación", "justificacion"]
    },
    "text-config-search-field": {
      label: "Buscar texto predefinido",
      section: "oftalmologia_externo",
      fieldType: "button",
      keywords: ["buscar texto", "texto predefinido"]
    },
    "text-config-save-button": {
      label: "Guardar hallazgo",
      section: "oftalmologia_externo",
      fieldType: "button",
      keywords: ["guardar hallazgo", "guardar"]
    },
    // OD Externo - Normal checkbox
    "oftalmology-external-od-normal-checkbox": {
      label: "OD Externo Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["externo normal od", "od externo normal", "externo normal ojo derecho"]
    },
    // ============================================
    // Oftalmología - OD Balance Muscular
    // ============================================
    "oftalmology-muscle_balance-od-justification-textfield": {
      label: "OD Balance Muscular (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["balance muscular ojo derecho", "balance muscular od", "od balance muscular"]
    },
    "oftalmology-muscle_balance-od-normal-checkbox": {
      label: "OD Balance Muscular Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["balance muscular normal od", "od balance muscular normal", "muscular normal od"]
    },
    // ============================================
    // Oftalmología - OD P/P/L
    // ============================================
    "oftalmology-ppl-od-justification-textfield": {
      label: "OD P/P/L (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["ppl ojo derecho", "ppl od", "od ppl", "pe pe ele od"]
    },
    "oftalmology-ppl-od-normal-checkbox": {
      label: "OD P/P/L Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["ppl normal od", "od ppl normal", "ppl normal ojo derecho"]
    },
    // ============================================
    // Oftalmología - OD Conjuntiva Esclera
    // ============================================
    "oftalmology-screra_conjunctiva-od-justification-textfield": {
      label: "OD Conjuntiva Esclera (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["conjuntiva esclera ojo derecho", "conjuntiva esclera od", "conjuntiva od", "esclera od"]
    },
    "oftalmology-screra_conjunctiva-od-normal-checkbox": {
      label: "OD Conjuntiva Esclera Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["conjuntiva esclera normal od", "conjuntiva normal od", "esclera normal od"]
    },
    // ============================================
    // Oftalmología - OD Córnea
    // ============================================
    "oftalmology-cornea-od-justification-textfield": {
      label: "OD Córnea (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["córnea ojo derecho", "cornea ojo derecho", "córnea od", "cornea od"]
    },
    "oftalmology-cornea-od-normal-checkbox": {
      label: "OD Córnea Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["córnea normal od", "cornea normal od", "córnea od normal", "cornea od normal"]
    },
    // ============================================
    // Oftalmología - OD Cámara Anterior
    // ============================================
    "oftalmology-previous_chamber-od-justification-textfield": {
      label: "OD Cámara Anterior (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["cámara anterior ojo derecho", "camara anterior od", "cámara anterior od"]
    },
    "oftalmology-previous_chamber-od-normal-checkbox": {
      label: "OD Cámara Anterior Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["cámara anterior normal od", "camara anterior normal od", "cámara anterior od normal"]
    },
    // ============================================
    // Oftalmología - OD Iris
    // ============================================
    "oftalmology-iris-od-justification-textfield": {
      label: "OD Iris (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["iris ojo derecho", "iris od", "od iris"]
    },
    "oftalmology-iris-od-normal-checkbox": {
      label: "OD Iris Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["iris normal od", "od iris normal", "iris od normal"]
    },
    // ============================================
    // Oftalmología - OD Cristalino
    // ============================================
    "oftalmology-crystalline-od-justification-textfield": {
      label: "OD Cristalino (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["cristalino ojo derecho", "cristalino od", "od cristalino"]
    },
    "oftalmology-crystalline-od-normal-checkbox": {
      label: "OD Cristalino Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["cristalino normal od", "od cristalino normal", "cristalino od normal"]
    },
    // ============================================
    // Oftalmología - OD Retina / Vítreo
    // ============================================
    "oftalmology-retina_vitreous-od-justification-textfield": {
      label: "OD Retina/Vítreo (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["retina vítreo ojo derecho", "retina vitreo od", "retina od", "vítreo od"]
    },
    "oftalmology-retina_vitreous-od-normal-checkbox": {
      label: "OD Retina/Vítreo Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["retina vítreo normal od", "retina vitreo normal od", "retina normal od"]
    },
    // ============================================
    // Oftalmología - OD Nervio Óptico
    // ============================================
    "oftalmology-optic_nerve-od-justification-textfield": {
      label: "OD Nervio Óptico (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["nervio óptico ojo derecho", "nervio optico od", "nervio óptico od"]
    },
    "oftalmology-optic_nerve-od-normal-checkbox": {
      label: "OD Nervio Óptico Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["nervio óptico normal od", "nervio optico normal od", "nervio óptico od normal"]
    },
    // ============================================
    // Oftalmología - OD Pupilometría
    // ============================================
    "oftalmology-pupillometry-od-justification-textfield": {
      label: "OD Pupilometría (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["pupilometría ojo derecho", "pupilometria od", "pupilometría od"]
    },
    "oftalmology-pupillometry-od-normal-checkbox": {
      label: "OD Pupilometría Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["pupilometría normal od", "pupilometria normal od", "pupilometría od normal"]
    },
    // ============================================
    // Oftalmología - OD Gonioscopía
    // ============================================
    "oftalmology-gonioscopy-od-justification-textfield": {
      label: "OD Gonioscopía (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["gonioscopía ojo derecho", "gonioscopia od", "gonioscopía od"]
    },
    "oftalmology-gonioscopy-od-normal-checkbox": {
      label: "OD Gonioscopía Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["gonioscopía normal od", "gonioscopia normal od", "gonioscopía od normal"]
    },
    // ============================================
    // Oftalmología - OD Campo Visual por Confrontación
    // ============================================
    "oftalmology-confrontation_visual_field-od-justification-textfield": {
      label: "OD Campo Visual Confrontación (abrir panel)",
      section: "oftalmologia_od",
      fieldType: "button",
      keywords: ["campo visual ojo derecho", "campo visual od", "confrontación od"]
    },
    "oftalmology-confrontation_visual_field-od-normal-checkbox": {
      label: "OD Campo Visual Confrontación Normal",
      section: "oftalmologia_od",
      fieldType: "checkbox",
      keywords: ["campo visual normal od", "campo visual od normal", "confrontación normal od"]
    },
    // ============================================
    // Oftalmología - OI Externo (Ojo Izquierdo Externo)
    // ============================================
    "oftalmology-external-oi-justification-textfield": {
      label: "OI Externo (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["ojo izquierdo externo", "oi externo", "izquierdo externo"]
    },
    "oftalmology-external-oi-normal-checkbox": {
      label: "OI Externo Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["externo normal oi", "oi externo normal", "externo normal ojo izquierdo"]
    },
    // ============================================
    // Oftalmología - OI Balance Muscular
    // ============================================
    "oftalmology-muscle_balance-oi-justification-textfield": {
      label: "OI Balance Muscular (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["balance muscular ojo izquierdo", "balance muscular oi", "oi balance muscular"]
    },
    "oftalmology-muscle_balance-oi-normal-checkbox": {
      label: "OI Balance Muscular Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["balance muscular normal oi", "oi balance muscular normal", "muscular normal oi"]
    },
    // ============================================
    // Oftalmología - OI P/P/L
    // ============================================
    "oftalmology-ppl-oi-justification-textfield": {
      label: "OI P/P/L (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["ppl ojo izquierdo", "ppl oi", "oi ppl", "pe pe ele oi"]
    },
    "oftalmology-ppl-oi-normal-checkbox": {
      label: "OI P/P/L Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["ppl normal oi", "oi ppl normal", "ppl normal ojo izquierdo"]
    },
    // ============================================
    // Oftalmología - OI Conjuntiva Esclera
    // ============================================
    "oftalmology-screra_conjunctiva-oi-justification-textfield": {
      label: "OI Conjuntiva Esclera (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["conjuntiva esclera ojo izquierdo", "conjuntiva esclera oi", "conjuntiva oi", "esclera oi"]
    },
    "oftalmology-screra_conjunctiva-oi-normal-checkbox": {
      label: "OI Conjuntiva Esclera Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["conjuntiva esclera normal oi", "conjuntiva normal oi", "esclera normal oi"]
    },
    // ============================================
    // Oftalmología - OI Córnea
    // ============================================
    "oftalmology-cornea-oi-justification-textfield": {
      label: "OI Córnea (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["córnea ojo izquierdo", "cornea ojo izquierdo", "córnea oi", "cornea oi"]
    },
    "oftalmology-cornea-oi-normal-checkbox": {
      label: "OI Córnea Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["córnea normal oi", "cornea normal oi", "córnea oi normal", "cornea oi normal"]
    },
    // ============================================
    // Oftalmología - OI Cámara Anterior
    // ============================================
    "oftalmology-previous_chamber-oi-justification-textfield": {
      label: "OI Cámara Anterior (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["cámara anterior ojo izquierdo", "camara anterior oi", "cámara anterior oi"]
    },
    "oftalmology-previous_chamber-oi-normal-checkbox": {
      label: "OI Cámara Anterior Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["cámara anterior normal oi", "camara anterior normal oi", "cámara anterior oi normal"]
    },
    // ============================================
    // Oftalmología - OI Iris
    // ============================================
    "oftalmology-iris-oi-justification-textfield": {
      label: "OI Iris (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["iris ojo izquierdo", "iris oi", "oi iris"]
    },
    "oftalmology-iris-oi-normal-checkbox": {
      label: "OI Iris Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["iris normal oi", "oi iris normal", "iris oi normal"]
    },
    // ============================================
    // Oftalmología - OI Cristalino
    // ============================================
    "oftalmology-crystalline-oi-justification-textfield": {
      label: "OI Cristalino (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["cristalino ojo izquierdo", "cristalino oi", "oi cristalino"]
    },
    "oftalmology-crystalline-oi-normal-checkbox": {
      label: "OI Cristalino Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["cristalino normal oi", "oi cristalino normal", "cristalino oi normal"]
    },
    // ============================================
    // Oftalmología - OI Retina / Vítreo
    // ============================================
    "oftalmology-retina_vitreous-oi-justification-textfield": {
      label: "OI Retina/Vítreo (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["retina vítreo ojo izquierdo", "retina vitreo oi", "retina oi", "vítreo oi"]
    },
    "oftalmology-retina_vitreous-oi-normal-checkbox": {
      label: "OI Retina/Vítreo Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["retina vítreo normal oi", "retina vitreo normal oi", "retina normal oi"]
    },
    // ============================================
    // Oftalmología - OI Nervio Óptico
    // ============================================
    "oftalmology-optic_nerve-oi-justification-textfield": {
      label: "OI Nervio Óptico (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["nervio óptico ojo izquierdo", "nervio optico oi", "nervio óptico oi"]
    },
    "oftalmology-optic_nerve-oi-normal-checkbox": {
      label: "OI Nervio Óptico Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["nervio óptico normal oi", "nervio optico normal oi", "nervio óptico oi normal"]
    },
    // ============================================
    // Oftalmología - OI Pupilometría
    // ============================================
    "oftalmology-pupillometry-oi-justification-textfield": {
      label: "OI Pupilometría (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["pupilometría ojo izquierdo", "pupilometria oi", "pupilometría oi"]
    },
    "oftalmology-pupillometry-oi-normal-checkbox": {
      label: "OI Pupilometría Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["pupilometría normal oi", "pupilometria normal oi", "pupilometría oi normal"]
    },
    // ============================================
    // Oftalmología - OI Gonioscopía
    // ============================================
    "oftalmology-gonioscopy-oi-justification-textfield": {
      label: "OI Gonioscopía (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["gonioscopía ojo izquierdo", "gonioscopia oi", "gonioscopía oi"]
    },
    "oftalmology-gonioscopy-oi-normal-checkbox": {
      label: "OI Gonioscopía Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["gonioscopía normal oi", "gonioscopia normal oi", "gonioscopía oi normal"]
    },
    // ============================================
    // Oftalmología - OI Campo Visual por Confrontación
    // ============================================
    "oftalmology-confrontation_visual_field-oi-justification-textfield": {
      label: "OI Campo Visual Confrontación (abrir panel)",
      section: "oftalmologia_oi",
      fieldType: "button",
      keywords: ["campo visual ojo izquierdo", "campo visual oi", "confrontación oi"]
    },
    "oftalmology-confrontation_visual_field-oi-normal-checkbox": {
      label: "OI Campo Visual Confrontación Normal",
      section: "oftalmologia_oi",
      fieldType: "checkbox",
      keywords: ["campo visual normal oi", "campo visual oi normal", "confrontación normal oi"]
    },
    // select-option-* se escanean DINÁMICAMENTE en scan()
    // (son testids genéricos reutilizados por diferentes dropdowns)
    // ============================================
    // Antecedentes - Botón principal
    // ============================================
    "header-antecedents-button": {
      label: "Antecedentes",
      section: "antecedentes",
      fieldType: "button",
      keywords: ["antecedentes", "abrir antecedentes", "ver antecedentes"]
    },
    // ============================================
    // Antecedentes Generales - Checkboxes + Inputs
    // ============================================
    "antecedents-arterialHypertension-checkbox": {
      label: "Hipertensión arterial",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["hipertensión arterial", "hipertension arterial"]
    },
    "antecedents-arterialHypertensioninput": {
      label: "Comentario Hipertensión arterial",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-diabetesGeneral-checkbox": {
      label: "Diabetes",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["diabetes", "diabetes general"]
    },
    "antecedents-diabetesGeneralinput": {
      label: "Comentario Diabetes",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-asthmaGeneral-checkbox": {
      label: "Asma",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["asma", "asma general"]
    },
    "antecedents-asthmaGeneralinput": {
      label: "Comentario Asma",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-cancerGeneral-checkbox": {
      label: "Cáncer",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["cáncer", "cancer"]
    },
    "antecedents-cancerGeneralinput": {
      label: "Comentario Cáncer",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-coronaryHeartDiseaseGeneral-checkbox": {
      label: "Cardiopatía coronaria",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["cardiopatía coronaria", "cardiopatia coronaria", "cardiopatía", "cardiopatia"]
    },
    "antecedents-coronaryHeartDiseaseGeneralinput": {
      label: "Comentario Cardiopatía coronaria",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-tuberculosisGeneral-checkbox": {
      label: "Tuberculosis",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["tuberculosis", "tbc"]
    },
    "antecedents-tuberculosisGeneralinput": {
      label: "Comentario Tuberculosis",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-rheumatoidArthritisGeneral-checkbox": {
      label: "Artritis reumatoide",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["artritis reumatoide", "artritis"]
    },
    "antecedents-rheumatoidArthritisGeneralinput": {
      label: "Comentario Artritis reumatoide",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-copdGeneral-checkbox": {
      label: "EPOC",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["epoc", "enfermedad pulmonar obstructiva"]
    },
    "antecedents-copdGeneralinput": {
      label: "Comentario EPOC",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-previousSurgeriesGeneral-checkbox": {
      label: "Cirugías previas",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["cirugías previas", "cirugias previas", "cirugías", "cirugias"]
    },
    "antecedents-previousSurgeriesGeneralinput": {
      label: "Comentario Cirugías previas",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-allergiesGeneral-checkbox": {
      label: "Alergias",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["alergias", "alergia", "alérgico", "alergico"]
    },
    "antecedents-allergiesGeneralinput": {
      label: "Comentario Alergias",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-useMedicationsGeneral-checkbox": {
      label: "Uso de medicamentos",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["uso de medicamentos", "medicamentos", "usa medicamentos"]
    },
    "antecedents-useMedicationsGeneralinput": {
      label: "Comentario Uso de medicamentos",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-othersGeneral-checkbox": {
      label: "Otros (Generales)",
      section: "antecedentes_generales",
      fieldType: "checkbox",
      keywords: ["otros generales", "otro general", "otros antecedentes generales"]
    },
    "antecedents-othersGeneralinput": {
      label: "Comentario Otros (Generales)",
      section: "antecedentes_generales",
      fieldType: "text",
      keywords: []
    },
    "antecedents-general-notes-textarea": {
      label: "Notas generales antecedentes",
      section: "antecedentes_generales",
      fieldType: "textarea",
      keywords: ["antecedentes generales nota", "antecedentes generales notas", "notas generales", "nota general", "notas antecedentes generales"]
    },
    // ============================================
    // Antecedentes Oculares - Checkboxes + Inputs
    // ============================================
    "antecedents-glaucomaOcular-checkbox": {
      label: "Glaucoma",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["glaucoma", "glaucoma ocular"]
    },
    "antecedents-glaucomaOcularinput": {
      label: "Comentario Glaucoma",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-ropOcular-checkbox": {
      label: "ROP",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["rop", "retinopatía del prematuro", "retinopatia del prematuro"]
    },
    "antecedents-ropOcularinput": {
      label: "Comentario ROP",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-dmreOcular-checkbox": {
      label: "DMRE",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["dmre", "degeneración macular", "degeneracion macular"]
    },
    "antecedents-dmreOcularinput": {
      label: "Comentario DMRE",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-glassesOcular-checkbox": {
      label: "Uso de gafas",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["uso de gafas", "gafas", "usa gafas", "lentes"]
    },
    "antecedents-glassesOcularinput": {
      label: "Comentario Uso de gafas",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-dryEyeOcular-checkbox": {
      label: "Ojo seco",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["ojo seco", "síndrome de ojo seco", "sindrome de ojo seco"]
    },
    "antecedents-dryEyeOcularinput": {
      label: "Comentario Ojo seco",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-diabeticRetinoPathyOcular-checkbox": {
      label: "Retinopatía diabética",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["retinopatía diabética", "retinopatia diabetica"]
    },
    "antecedents-diabeticRetinoPathyOcularinput": {
      label: "Comentario Retinopatía diabética",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-uveitisOcular-checkbox": {
      label: "Uveítis",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["uveítis", "uveitis"]
    },
    "antecedents-uveitisOcularinput": {
      label: "Comentario Uveítis",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-contactLensesOcular-checkbox": {
      label: "Lentes de contacto",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["lentes de contacto", "usa lentes de contacto"]
    },
    "antecedents-contactLensesOcularinput": {
      label: "Comentario Lentes de contacto",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-traumasOcular-checkbox": {
      label: "Traumas oculares",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["traumas oculares", "trauma ocular", "traumas"]
    },
    "antecedents-traumasOcularinput": {
      label: "Comentario Traumas oculares",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-surgeriesOcular-checkbox": {
      label: "Cirugías oculares",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["cirugías oculares", "cirugias oculares", "cirugía ocular", "cirugia ocular"]
    },
    "antecedents-surgeriesOcularinput": {
      label: "Comentario Cirugías oculares",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-alertsOcular-checkbox": {
      label: "Alertas oculares",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["alertas oculares", "alerta ocular", "alertas"]
    },
    "antecedents-alertsOcularinput": {
      label: "Comentario Alertas oculares",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-othersOcular-checkbox": {
      label: "Otros (Oculares)",
      section: "antecedentes_oculares",
      fieldType: "checkbox",
      keywords: ["otros oculares", "otro ocular", "otros antecedentes oculares"]
    },
    "antecedents-othersOcularinput": {
      label: "Comentario Otros (Oculares)",
      section: "antecedentes_oculares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-ocular-notes-textarea": {
      label: "Notas oculares antecedentes",
      section: "antecedentes_oculares",
      fieldType: "textarea",
      keywords: ["antecedentes oculares nota", "antecedentes oculares notas", "notas oculares", "nota ocular", "notas antecedentes oculares"]
    },
    // ============================================
    // Antecedentes Familiares - Checkboxes + Inputs
    // ============================================
    "antecedents-ahtFamiliar-checkbox": {
      label: "HTA familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["hipertensión familiar", "hipertension familiar", "hta familiar"]
    },
    "antecedents-ahtFamiliarinput": {
      label: "Comentario HTA familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-diabetesFamiliar-checkbox": {
      label: "Diabetes familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["diabetes familiar"]
    },
    "antecedents-diabetesFamiliarinput": {
      label: "Comentario Diabetes familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-asthmaFamiliar-checkbox": {
      label: "Asma familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["asma familiar"]
    },
    "antecedents-asthmaFamiliarinput": {
      label: "Comentario Asma familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-coronaryHeartDiseaseFamiliar-checkbox": {
      label: "Cardiopatía coronaria familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["cardiopatía familiar", "cardiopatia familiar", "cardiopatía coronaria familiar", "cardiopatia coronaria familiar"]
    },
    "antecedents-coronaryHeartDiseaseFamiliarinput": {
      label: "Comentario Cardiopatía coronaria familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-collagenDiseaseFamiliar-checkbox": {
      label: "Enfermedad del colágeno familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["enfermedad del colágeno", "enfermedad del colageno", "colágeno familiar", "colageno familiar"]
    },
    "antecedents-collagenDiseaseFamiliarinput": {
      label: "Comentario Enfermedad del colágeno familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-glaucomaFamiliar-checkbox": {
      label: "Glaucoma familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["glaucoma familiar"]
    },
    "antecedents-glaucomaFamiliarinput": {
      label: "Comentario Glaucoma familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-keratoconusFamiliar-checkbox": {
      label: "Queratocono familiar",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["queratocono familiar", "queratocono", "keratocono familiar"]
    },
    "antecedents-keratoconusFamiliarinput": {
      label: "Comentario Queratocono familiar",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-othersFamiliar-checkbox": {
      label: "Otros (Familiares)",
      section: "antecedentes_familiares",
      fieldType: "checkbox",
      keywords: ["otros familiares", "otro familiar", "otros antecedentes familiares"]
    },
    "antecedents-othersFamiliarinput": {
      label: "Comentario Otros (Familiares)",
      section: "antecedentes_familiares",
      fieldType: "text",
      keywords: []
    },
    "antecedents-familiar-notes-textarea": {
      label: "Notas familiares antecedentes",
      section: "antecedentes_familiares",
      fieldType: "textarea",
      keywords: ["antecedentes familiares nota", "antecedentes familiares notas", "notas familiares", "nota familiar", "notas antecedentes familiares"]
    },
    // ============================================
    // Antecedentes - Botones guardar/cancelar
    // ============================================
    "antecedents-save-button": {
      label: "Guardar antecedentes",
      section: "antecedentes",
      fieldType: "button",
      keywords: ["guardar antecedentes", "salvar antecedentes"]
    },
    "antecedents-cancel-button": {
      label: "Cancelar antecedentes",
      section: "antecedentes",
      fieldType: "button",
      keywords: ["cancelar antecedentes"]
    }
  };
  class DOMScanner {
    constructor() {
      this.fields = [];
      this.elementMap = /* @__PURE__ */ new Map();
      this.inputMap = /* @__PURE__ */ new Map();
      this._registry = { ...REGISTERED_FIELDS };
    }
    /**
     * Escanea SOLO los campos registrados en el DOM.
     * Busca cada data-testid del registro y construye la lista de campos encontrados.
     */
    scan() {
      this.fields = [];
      this.elementMap = /* @__PURE__ */ new Map();
      this.inputMap = /* @__PURE__ */ new Map();
      for (const [testId, meta] of Object.entries(this._registry)) {
        const result = this._scanOneField(testId, meta);
        if (result) {
          this.fields.push(result.field);
          this.elementMap.set(testId, result.container);
          this.inputMap.set(testId, result.inputEl);
        }
      }
      const dynamicOptions = document.querySelectorAll('[data-testid^="select-option-"]');
      for (const el of dynamicOptions) {
        const testId = el.getAttribute("data-testid");
        if (!testId || this.elementMap.has(testId)) continue;
        const label = (el.textContent || "").trim();
        if (!label) continue;
        const field = {
          data_testid: testId,
          unique_key: testId,
          label,
          field_type: "button",
          eye: null,
          section: "dynamic_option",
          options: [],
          keywords: [],
          tag: el.tagName.toLowerCase()
        };
        this.fields.push(field);
        this.elementMap.set(testId, el);
        this.inputMap.set(testId, el);
      }
      console.log(`[BVA-Scanner] ${this.fields.length} campos encontrados en DOM (${dynamicOptions.length} select-option dinámicos)`);
      return this.fields;
    }
    /**
     * Escanea UN solo campo por su data-testid bajo demanda.
     * Si el campo ya fue escaneado, lo actualiza.
     * @param {string} testId - El data-testid del campo a escanear
     * @returns {object|null} - El campo encontrado o null
     */
    scanField(testId) {
      const meta = this._registry[testId];
      if (!meta) {
        console.warn(`[BVA-Scanner] Campo '${testId}' no está registrado`);
        return null;
      }
      const result = this._scanOneField(testId, meta);
      if (!result) {
        console.warn(`[BVA-Scanner] Campo '${testId}' registrado pero no encontrado en DOM`);
        return null;
      }
      const existingIdx = this.fields.findIndex((f) => f.unique_key === testId);
      if (existingIdx >= 0) {
        this.fields[existingIdx] = result.field;
      } else {
        this.fields.push(result.field);
      }
      this.elementMap.set(testId, result.container);
      this.inputMap.set(testId, result.inputEl);
      console.log(`[BVA-Scanner] Campo '${testId}' escaneado bajo demanda`);
      return result.field;
    }
    /**
     * Registra un campo nuevo en runtime sin modificar el código fuente.
     * @param {string} testId - El data-testid del campo
     * @param {object} meta - Metadatos: { label, section, fieldType, keywords }
     */
    registerField(testId, meta) {
      if (!testId || !meta) {
        console.warn("[BVA-Scanner] registerField requiere testId y meta");
        return;
      }
      this._registry[testId] = {
        label: meta.label || testId,
        section: meta.section || null,
        fieldType: meta.fieldType || "text",
        keywords: meta.keywords || []
      };
      console.log(`[BVA-Scanner] Campo '${testId}' registrado (total: ${Object.keys(this._registry).length})`);
    }
    /**
     * Retorna la lista de data-testids registrados.
     */
    getRegisteredIds() {
      return Object.keys(this._registry);
    }
    /**
     * Retorna los keywords asociados a un data-testid.
     */
    getKeywords(testId) {
      return this._registry[testId]?.keywords || [];
    }
    // ============================================
    // Escaneo interno de un campo individual
    // ============================================
    _scanOneField(testId, meta) {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (!el) return null;
      let container = el;
      let inputEl = this._findNearbyInput(el) || el;
      const detectedType = this._detectFieldType(inputEl || container);
      const field = {
        data_testid: testId,
        unique_key: testId,
        label: meta.label || this._extractLabel(container, inputEl),
        field_type: meta.fieldType || detectedType,
        eye: this._detectEye(testId, container),
        section: meta.section || this._detectSection(testId),
        options: this._extractOptions(container),
        keywords: meta.keywords || [],
        tag: (inputEl || container).tagName.toLowerCase()
      };
      return { field, container, inputEl };
    }
    // ============================================
    // Métodos de acceso (sin cambios)
    // ============================================
    getElement(uniqueKey) {
      return this.elementMap.get(uniqueKey) || null;
    }
    getInput(uniqueKey) {
      return this.inputMap.get(uniqueKey) || this.getElement(uniqueKey);
    }
    findByKey(uniqueKey) {
      return this.fields.find((f) => f.unique_key === uniqueKey) || null;
    }
    // ============================================
    // Helpers de detección (sin cambios)
    // ============================================
    _extractLabel(container, inputEl) {
      const col = container.closest('[class*="col"]');
      if (col) {
        const label = col.querySelector("label, .text-label");
        if (label) return label.textContent.trim();
      }
      if (inputEl) {
        const ariaLabel = inputEl.getAttribute("aria-label");
        if (ariaLabel) return ariaLabel;
      }
      if (inputEl?.placeholder) return inputEl.placeholder;
      const innerLabel = container.querySelector("label, .text-label");
      if (innerLabel) return innerLabel.textContent.trim();
      const parent = container.parentElement;
      if (parent) {
        const label = parent.querySelector("label, .text-label");
        if (label) return label.textContent.trim();
      }
      const labelledBy = (inputEl || container).getAttribute("aria-labelledby");
      if (labelledBy) {
        const refEl = document.getElementById(labelledBy);
        if (refEl) return refEl.textContent.trim();
      }
      return container.getAttribute("data-testid")?.replace(/-/g, " ")?.replace(/badge|field/g, "")?.trim() || "Sin etiqueta";
    }
    _detectFieldType(el) {
      if (!el) return "text";
      const tag = el.tagName.toLowerCase();
      if (tag === "select") return "select";
      if (tag === "textarea") return "textarea";
      if (tag === "input") {
        const type = el.type?.toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "number") return "number";
        return "text";
      }
      const role = el.getAttribute("role");
      if (role === "combobox" || role === "listbox") return "select";
      if (role === "checkbox" || role === "switch") return "checkbox";
      if (role === "radio") return "radio";
      const innerInput = el.querySelector("input, textarea, select");
      if (innerInput) return this._detectFieldType(innerInput);
      return "text";
    }
    _detectEye(testId, el) {
      const text = (testId + " " + (el.textContent || "")).toLowerCase();
      if (/\b(od|ojo.?derecho|right.?eye)\b/i.test(text)) return "OD";
      if (/\b(oi|ojo.?izquierdo|left.?eye)\b/i.test(text)) return "OI";
      if (/\b(ao|ambos.?ojos|both.?eyes)\b/i.test(text)) return "AO";
      return null;
    }
    _detectSection(testId) {
      const id = testId.toLowerCase();
      const sections = {
        motivo_consulta: /reason-for-consulting|motivo/,
        enfermedad_actual: /current-disease|enfermedad/,
        antecedentes: /background|antecedente/,
        presion: /presion|pio|tonometria|intraocular/,
        agudeza: /agudeza|visual-acuity|av-/,
        refraccion: /refraccion|refraction/,
        biomicroscopia: /biomicroscop|lampara|slit-lamp/,
        cornea: /cornea/,
        conjuntiva: /conjuntiva/,
        iris: /iris/,
        pupila: /pupila/,
        cristalino: /cristalino|lens/,
        retina: /retina/,
        vitreo: /vitreo/,
        nervio: /nervio|optic-nerve/,
        macula: /macula/,
        parpado: /parpado|eyelid/,
        fondo: /fondo|fundus/,
        diagnostico: /diagnostic|diagnos/,
        plan: /plan|treatment/,
        externo: /externo|external/,
        balance: /balance|muscular/,
        pupilometria: /pupilometria/,
        gonioscopia: /gonioscopia/
      };
      for (const [section, pattern] of Object.entries(sections)) {
        if (pattern.test(id)) return section;
      }
      return null;
    }
    _findNearbyInput(container) {
      const INPUT_SELECTOR = 'textarea, input:not([type="hidden"]), select';
      let input = container.querySelector(INPUT_SELECTOR);
      if (input) return input;
      const parent = container.parentElement;
      if (parent) {
        input = parent.querySelector(INPUT_SELECTOR);
        if (input) return input;
      }
      const col = container.closest('[class*="col"]');
      if (col) {
        input = col.querySelector(INPUT_SELECTOR);
        if (input) return input;
      }
      return null;
    }
    _extractOptions(el) {
      if (el.tagName.toLowerCase() === "select") {
        return Array.from(el.options).filter((opt) => opt.value).map((opt) => opt.textContent.trim());
      }
      const select = el.querySelector("select");
      if (select) {
        return Array.from(select.options).filter((opt) => opt.value).map((opt) => opt.textContent.trim());
      }
      const listbox = el.querySelector('[role="listbox"]');
      if (listbox) {
        return Array.from(listbox.querySelectorAll('[role="option"]')).map((opt) => opt.textContent.trim());
      }
      return [];
    }
  }
  class DOMManipulator {
    constructor(scanner) {
      this.scanner = scanner;
      this.filledFields = /* @__PURE__ */ new Map();
      this._initSwal2Observer();
    }
    /**
     * Polling que auto-cierra popups SweetAlert2 ("Aceptar").
     * Busca el botón .swal2-confirm O cualquier botón visible "Aceptar" dentro de un dialog.
     * Usa getBoundingClientRect para visibilidad (offsetParent falla con position:fixed).
     */
    _initSwal2Observer() {
      setInterval(() => {
        let btn = document.querySelector(".swal2-confirm");
        if (!btn) {
          const candidates = document.querySelectorAll('[role="dialog"] button, .swal2-actions button, .modal-content button');
          for (const b of candidates) {
            if (b.textContent.trim() === "Aceptar") {
              btn = b;
              break;
            }
          }
        }
        if (!btn) {
          const allBtns = document.querySelectorAll("button");
          for (const b of allBtns) {
            if (b.textContent.trim() === "Aceptar") {
              const r = b.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                btn = b;
                break;
              }
            }
          }
        }
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        console.log(`[BVA-DOM] >>> Swal2 auto-dismiss: "${btn.textContent.trim()}" class="${btn.className}"`);
        btn.click();
      }, 400);
      console.log(`[BVA-DOM] >>> Swal2 auto-dismiss polling ACTIVE`);
    }
    /**
     * Retorna un objeto plano con los campos ya llenados.
     * Se usa al iniciar dictado para informar al backend qué campos ya tienen valor.
     */
    getFilledFields() {
      const result = {};
      for (const [key, value] of this.filledFields) {
        result[key] = value;
      }
      return result;
    }
    applyAutofill(items) {
      const filled = [];
      console.log(`[BVA-DOM] applyAutofill called with ${items.length} items:`, JSON.stringify(items));
      for (const item of items) {
        console.log(`[BVA-DOM] Applying: key='${item.unique_key}', value='${item.value}'`);
        const success = this.fillField(item.unique_key, item.value);
        console.log(`[BVA-DOM] Result for '${item.unique_key}': ${success}`);
        if (success) {
          filled.push(item.unique_key);
          this.filledFields.set(item.unique_key, item.value);
        }
      }
      return filled;
    }
    fillField(uniqueKey, value) {
      let el = null;
      console.log(`[BVA-DOM] === fillField("${uniqueKey}", "${String(value).substring(0, 200)}") ===`);
      const keyLower = uniqueKey.toLowerCase();
      if (value === "click") {
        return this._clickButton(uniqueKey);
      }
      if (keyLower.includes("-link") || keyLower.includes("-load-previous")) {
        console.warn(`[BVA-DOM] RECHAZADO: "${uniqueKey}" parece ser un link, no un campo llenable`);
        return false;
      }
      if (uniqueKey.endsWith("-radio")) {
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`);
        if (container) {
          console.log(`[BVA-DOM] Radio fast-path: key='${uniqueKey}', container=`, container?.tagName, container?.outerHTML?.substring(0, 200));
          const result = this._setRadioValue(container, String(value));
          console.log(`[BVA-DOM] Radio result: ${result}`);
          return result;
        }
        console.warn(`[BVA-DOM] Radio fast-path: container NOT found for '${uniqueKey}'`);
        return false;
      }
      el = this.scanner.getInput(uniqueKey);
      if (el) {
        const elTag = el.tagName.toLowerCase();
        if (elTag === "div" || elTag === "span" || elTag === "section") {
          const innerInput = this._findBestInput(el);
          if (innerInput) el = innerInput;
        }
      }
      if (!el || el.tagName.toLowerCase() === "div") {
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`);
        if (container) {
          const tag = container.tagName.toLowerCase();
          const containerRole = container.getAttribute("role");
          if (tag === "textarea" || tag === "select" || tag === "input") {
            el = container;
          } else if (tag === "button" && (containerRole === "switch" || containerRole === "checkbox")) {
            el = container;
          } else {
            const bestInput = this._findBestInput(container);
            if (bestInput) el = bestInput;
          }
        }
      }
      if (!el) {
        const baseName = uniqueKey.replace(/-badge-field$/, "").replace(/-badge$/, "");
        const allEls = document.querySelectorAll(`[data-testid*="${baseName}"]`);
        for (const candidate of allEls) {
          const candidateTag = candidate.tagName.toLowerCase();
          if (candidateTag === "textarea" || candidateTag === "input") {
            el = candidate;
            break;
          }
          const inner = this._findBestInput(candidate);
          if (inner) {
            el = inner;
            break;
          }
        }
      }
      if (!el) {
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`);
        if (container) {
          const nearby = this._findNearbyInput(container);
          if (nearby) el = nearby;
        }
      }
      if (!el) {
        console.warn(`[BVA-DOM] fillField: NO se encontró elemento para '${uniqueKey}'`);
        return false;
      }
      const finalTag = el.tagName.toLowerCase();
      if (finalTag !== "textarea" && finalTag !== "input" && finalTag !== "select" && finalTag !== "button") {
        const innerInput = this._findBestInput(el);
        if (innerInput) el = innerInput;
        else return false;
      }
      const isSearchableSelect = this._isSearchableSelect(uniqueKey, el);
      if (isSearchableSelect) {
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`) || el.closest('.select, [class*="select"]') || el.parentElement;
        return this._setSearchableSelectValue(container, el, String(value));
      }
      const fieldType = this._inferType(el);
      try {
        switch (fieldType) {
          case "select":
            return this._setSelectValue(el, String(value));
          case "checkbox":
            return this._setCheckboxValue(el, value);
          case "radio":
            return this._setRadioValue(el, String(value));
          default:
            return this._setInputValue(el, String(value));
        }
      } catch (error) {
        console.error(`[BVA-DOM] Error llenando ${uniqueKey}:`, error);
        return false;
      }
    }
    _findBestInput(container) {
      if (!container) return null;
      const testId = container.getAttribute("data-testid") || "";
      if (testId.includes("checkbox") || testId.includes("switch")) {
        const cb = container.querySelector('input[type="checkbox"]');
        if (cb) return cb;
        const sw = container.querySelector('button[role="switch"], [role="checkbox"]');
        if (sw) return sw;
      }
      const textareas = container.querySelectorAll("textarea");
      for (const ta of textareas) if (ta.offsetParent !== null || ta.offsetHeight > 0) return ta;
      if (textareas.length > 0) return textareas[0];
      const textInputs = container.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of textInputs) if (inp.offsetParent !== null || inp.offsetHeight > 0) return inp;
      if (textInputs.length > 0) return textInputs[0];
      return container.querySelector('input[type="number"]') || container.querySelector('input[type="checkbox"]') || container.querySelector('input:not([type="radio"]):not([type="hidden"])') || container.querySelector('button[role="switch"]') || container.querySelector("select");
    }
    _isSearchableSelect(uniqueKey, el) {
      if (!uniqueKey.endsWith("-select")) return false;
      if (el.tagName.toLowerCase() !== "input") return false;
      const container = document.querySelector(`[data-testid="${uniqueKey}"]`);
      if (container && (container.className || "").toLowerCase().includes("select")) return true;
      return !!el.closest('.select, [class*="select-"]');
    }
    _inferType(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === "textarea") return "textarea";
      if (tag === "select") return "select";
      if (tag === "button") {
        const role = el.getAttribute("role");
        if (role === "switch" || role === "checkbox") return "checkbox";
      }
      if (tag === "input") {
        if (el.type === "checkbox") return "checkbox";
        if (el.type === "radio") return "radio";
        if (el.type === "number") return "number";
      }
      return "text";
    }
    _setInputValue(el, value) {
      let input = el;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
        input = el.querySelector("input, textarea");
      }
      if (!input) return false;
      const setter = input.tagName.toLowerCase() === "textarea" ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      this._highlight(input);
      return true;
    }
    _setSelectValue(el, value) {
      if (el.tagName.toLowerCase() === "select") {
        const option = Array.from(el.options).find(
          (opt) => opt.value.toLowerCase() === value.toLowerCase() || opt.textContent.toLowerCase().includes(value.toLowerCase())
        );
        if (option) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
          if (setter) setter.call(el, option.value);
          else el.value = option.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          this._highlight(el);
          return true;
        }
      }
      const selectInput = el.querySelector('input[role="combobox"], input') || el;
      if (selectInput instanceof HTMLInputElement) return this._setInputValue(selectInput, value);
      return false;
    }
    _setSearchableSelectValue(container, inputEl, value) {
      inputEl.focus();
      inputEl.dispatchEvent(new Event("focus", { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(inputEl, value);
      else inputEl.value = value;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      if (value.length > 0) {
        inputEl.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value[0] }));
        inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value[0] }));
      }
      this._highlight(inputEl);
      const maxAttempts = 5;
      const delays = [200, 400, 600, 1e3, 1500];
      const trySelectOption = (attempt) => {
        if (attempt >= maxAttempts) return;
        setTimeout(() => {
          let options = container.querySelectorAll('.select-option, [role="option"], li[class*="option"]');
          if (!options.length) {
            options = document.querySelectorAll('.select-dropdown [role="option"], .select-menu [role="option"], [class*="select"] [role="option"], [class*="dropdown"] li, [class*="listbox"] [role="option"], .select-option');
          }
          const validOptions = Array.from(options).filter((opt) => {
            const text = (opt.textContent || "").trim().toLowerCase();
            const isVisible = opt.offsetParent !== null || opt.offsetHeight > 0;
            return isVisible && text !== "seleccionar..." && text !== "seleccionar" && text !== "";
          });
          if (validOptions.length > 0) {
            const bestMatch = validOptions.find((opt) => (opt.textContent || "").toLowerCase().includes(value.toLowerCase())) || validOptions[0];
            bestMatch.click();
            bestMatch.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            bestMatch.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            this._highlight(container);
            return;
          }
          trySelectOption(attempt + 1);
        }, delays[attempt]);
      };
      trySelectOption(0);
      return true;
    }
    _setCheckboxValue(el, value) {
      const boolVal = value === true || value === "true" || value === "1" || value === "si" || value === "sí";
      console.log(`[BVA-DOM] _setCheckboxValue: tag=${el.tagName}, role=${el.getAttribute("role")}, target=${boolVal}`);
      let checkbox = null;
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        checkbox = el;
      } else {
        checkbox = el.querySelector('input[type="checkbox"]');
      }
      if (!checkbox && el.parentElement) {
        checkbox = el.parentElement.querySelector('input[type="checkbox"]');
      }
      if (checkbox) {
        console.log(`[BVA-DOM] Checkbox encontrado: checked=${checkbox.checked}, target=${boolVal}`);
        if (checkbox.checked !== boolVal) {
          checkbox.click();
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
          this._highlight(checkbox.closest("[data-testid]") || checkbox);
        }
        return true;
      }
      const role = el.getAttribute("role");
      const isSwitch = role === "switch" || role === "checkbox" || el.tagName.toLowerCase() === "button";
      if (isSwitch) {
        const currentChecked = el.getAttribute("aria-checked") === "true";
        console.log(`[BVA-DOM] Switch/toggle: aria-checked=${currentChecked}, target=${boolVal}`);
        if (currentChecked !== boolVal) {
          el.click();
          this._highlight(el);
        }
        return true;
      }
      console.warn(`[BVA-DOM] No se encontró checkbox ni switch en el elemento`);
      return false;
    }
    _setRadioValue(el, value) {
      console.log(`[BVA-DOM] _setRadioValue called: tag=${el?.tagName}, value='${value}', outerHTML=${el?.outerHTML?.substring(0, 300)}`);
      let radioInput = null;
      if (el.tagName === "INPUT" && el.type === "radio") {
        radioInput = el;
      } else {
        radioInput = el.querySelector('input[type="radio"]');
      }
      if (radioInput) {
        console.log(`[BVA-DOM] Radio input found: name=${radioInput.name}, checked=${radioInput.checked}`);
        const parentLabel = radioInput.closest("label");
        if (parentLabel) {
          console.log(`[BVA-DOM] Clicking parent label`);
          parentLabel.click();
        }
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "checked"
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(radioInput, true);
          console.log(`[BVA-DOM] Native setter applied, checked=${radioInput.checked}`);
        } else {
          radioInput.checked = true;
        }
        radioInput.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        radioInput.dispatchEvent(new Event("input", { bubbles: true }));
        radioInput.dispatchEvent(new Event("change", { bubbles: true }));
        this._highlight(radioInput.closest("[data-testid]") || radioInput);
        console.log(`[BVA-DOM] Radio activated, final checked=${radioInput.checked}`);
        return true;
      }
      const tag = el.tagName.toLowerCase();
      console.log(`[BVA-DOM] Radio fallback: tag=${tag}`);
      if (tag === "div" || tag === "span" || tag === "label" || tag === "button") {
        el.click();
        el.dispatchEvent(new Event("change", { bubbles: true }));
        this._highlight(el);
        console.log(`[BVA-DOM] Radio (container click) activated`);
        return true;
      }
      console.warn(`[BVA-DOM] _setRadioValue: no se pudo activar el radio`);
      return false;
    }
    /**
     * Hace click directo en un botón/dropdown item por su data-testid.
     * Usado para preconsulta dropdown items, botón atrás, agregar registro, etc.
     * Incluye fallback bidireccional dropdown ↔ tab para preconsulta.
     */
    _clickButton(uniqueKey) {
      const PRECONSULTA_FALLBACK = {
        // Dropdown → Tab (para cuando estamos EN la pantalla de preconsulta)
        "header-preconsultation-dropdown-item-0": "preconsultation-tab-dilatation",
        "header-preconsultation-dropdown-item-1": "preconsultation-tab-vitalSigns",
        "header-preconsultation-dropdown-item-2": "preconsultation-tab-eyescreening",
        "header-preconsultation-dropdown-item-3": "preconsultation-tab-medicines",
        "header-preconsultation-dropdown-item-4": "preconsultation-tab-orthoptic",
        // Tab → Dropdown (para cuando estamos EN la pantalla principal)
        "preconsultation-tab-dilatation": "header-preconsultation-dropdown-item-0",
        "preconsultation-tab-vitalSigns": "header-preconsultation-dropdown-item-1",
        "preconsultation-tab-eyescreening": "header-preconsultation-dropdown-item-2",
        "preconsultation-tab-medicines": "header-preconsultation-dropdown-item-3",
        "preconsultation-tab-orthoptic": "header-preconsultation-dropdown-item-4"
      };
      let el = document.querySelector(`[data-testid="${uniqueKey}"]`);
      if (!el && PRECONSULTA_FALLBACK[uniqueKey]) {
        const fallbackKey = PRECONSULTA_FALLBACK[uniqueKey];
        el = document.querySelector(`[data-testid="${fallbackKey}"]`);
        if (el) {
          console.log(`[BVA-DOM] _clickButton: fallback '${uniqueKey}' → '${fallbackKey}'`);
        }
      }
      if (!el) {
        console.warn(`[BVA-DOM] _clickButton: elemento '${uniqueKey}' NO encontrado en DOM`);
        return false;
      }
      console.log(`[BVA-DOM] _clickButton: clicking '${uniqueKey}' (tag=${el.tagName}, html=${el.outerHTML?.substring(0, 200)})`);
      let clickable;
      if (uniqueKey.endsWith("-select")) {
        clickable = el.querySelector('[data-testid="select-toggle-button"]') || el.querySelector('button, a, [role="button"], [role="menuitem"]') || el;
      } else if (el.tagName === "INPUT" && el.type === "radio") {
        const parentLabel = el.closest("label");
        if (parentLabel) {
          parentLabel.click();
        } else {
          el.click();
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        this._highlight(el);
        console.log(`[BVA-DOM] _clickButton: radio nativo '${uniqueKey}' clicked`);
        return true;
      } else {
        clickable = el.querySelector('button, a, [role="button"], [role="menuitem"]') || el;
      }
      if (typeof clickable.click === "function") {
        clickable.click();
      } else {
        let clicked = false;
        try {
          const fiberKey = Object.keys(clickable).find((k) => k.startsWith("__reactFiber$"));
          if (fiberKey) {
            let fiber = clickable[fiberKey];
            for (let i = 0; i < 10 && fiber; i++) {
              if (typeof fiber.memoizedProps?.onClick === "function") {
                console.log(`[BVA-DOM] SVG click: React fiber onClick found at level ${i}`);
                fiber.memoizedProps.onClick();
                clicked = true;
                break;
              }
              fiber = fiber.return;
            }
          }
        } catch (err) {
          console.warn(`[BVA-DOM] React fiber click failed:`, err);
        }
        if (!clicked) {
          console.log(`[BVA-DOM] SVG click: dispatching MouseEvent fallback`);
          clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        }
      }
      this._highlight(el);
      console.log(`[BVA-DOM] _clickButton: '${uniqueKey}' clicked successfully`);
      return true;
    }
    _findNearbyInput(container) {
      const INPUT_SELECTOR = 'textarea, input:not([type="hidden"]), select';
      let input = container.querySelector(INPUT_SELECTOR);
      if (input) return input;
      const parent = container.parentElement;
      if (parent) {
        input = parent.querySelector(INPUT_SELECTOR);
        if (input) return input;
      }
      const col = container.closest('[class*="col"]');
      if (col) {
        input = col.querySelector(INPUT_SELECTOR);
        if (input) return input;
      }
      return null;
    }
    _highlight(el) {
      const target = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : el.querySelector("input, select, textarea") || el;
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus();
      } catch (e) {
      }
      target.style.transition = "box-shadow 0.3s, border-color 0.3s";
      target.style.boxShadow = `0 0 0 4px rgba(59, 130, 246, 0.5)`;
      target.style.borderColor = "#3b82f6";
      setTimeout(() => {
        target.style.boxShadow = "";
        target.style.borderColor = "";
      }, 2e3);
    }
  }
  const TARGET_SAMPLE_RATE = 16e3;
  class VoiceRecorder {
    constructor() {
      this.stream = null;
      this.audioContext = null;
      this.sourceNode = null;
      this.processorNode = null;
      this.worklet = null;
      this.isRecording = false;
      this.onDataAvailable = null;
    }
    async start(onDataAvailable) {
      try {
        this.onDataAvailable = onDataAvailable;
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const actualRate = this.audioContext.sampleRate;
        const resampleRatio = actualRate / TARGET_SAMPLE_RATE;
        console.log(`[BVA-Recorder] AudioContext: ${actualRate}Hz → ${TARGET_SAMPLE_RATE}Hz (ratio: ${resampleRatio.toFixed(2)})`);
        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
        const bufferSize = 4096;
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        this.processorNode.onaudioprocess = (event) => {
          if (!this.isRecording) return;
          const float32Input = event.inputBuffer.getChannelData(0);
          let float32;
          if (Math.abs(resampleRatio - 1) > 0.01) {
            const outputLength = Math.floor(float32Input.length / resampleRatio);
            float32 = new Float32Array(outputLength);
            for (let i = 0; i < outputLength; i++) {
              float32[i] = float32Input[Math.floor(i * resampleRatio)];
            }
          } else {
            float32 = float32Input;
          }
          const pcm16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            pcm16[i] = s < 0 ? s * 32768 : s * 32767;
          }
          const blob = new Blob([pcm16.buffer], { type: "application/octet-stream" });
          console.debug(`[BVA-Recorder] Chunk enviado: ${pcm16.length} samples (${blob.size} bytes)`);
          this.onDataAvailable(blob);
        };
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);
        this.isRecording = true;
        console.log("[BVA-Recorder] Grabación iniciada");
        return true;
      } catch (error) {
        console.error("[BVA-Recorder] Error al iniciar:", error);
        alert(`Error micrófono: ${error.message}`);
        return false;
      }
    }
    stop() {
      this.isRecording = false;
      console.log("[BVA-Recorder] Grabación detenida");
      try {
        this.processorNode?.disconnect();
      } catch (e) {
        console.debug(e);
      }
      try {
        this.processorNode?.disconnect();
      } catch (e) {
        console.debug(e);
      }
      try {
        this.sourceNode?.disconnect();
      } catch (e) {
        console.debug(e);
      }
      try {
        this.audioContext?.close();
      } catch (e) {
        console.debug(e);
      }
      try {
        this.stream?.getTracks().forEach((t) => t.stop());
      } catch (e) {
        console.debug(e);
      }
      this.processorNode = null;
      this.sourceNode = null;
      this.audioContext = null;
      this.stream = null;
    }
  }
  function createWidget() {
    const container = document.createElement("div");
    container.id = "biowel-voice-widget";
    container.innerHTML = `
    <style>
      #biowel-voice-widget {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .bva-panel {
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        padding: 16px;
        width: 340px;
        border: 1px solid #e5e7eb;
        transition: all 0.3s;
      }
      .bva-panel.recording {
        border-color: #ef4444;
        box-shadow: 0 8px 32px rgba(239,68,68,0.2);
      }
      .bva-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .bva-title { font-size: 14px; font-weight: 600; color: #1f2937; }
      .bva-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b7280; }
      .bva-dot { width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; transition: background 0.3s; }
      .bva-dot.connected { background: #22c55e; }
      .bva-dot.recording { background: #ef4444; animation: bva-pulse 1.5s ease-in-out infinite; }
      @keyframes bva-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      .bva-transcript {
        background: #f9fafb; border-radius: 8px; padding: 10px;
        min-height: 40px; max-height: 100px; overflow-y: auto;
        font-size: 13px; color: #374151; margin-bottom: 8px;
        border: 1px solid #e5e7eb; line-height: 1.5;
      }
      .bva-transcript:empty::before { content: 'La transcripción aparecerá aquí...'; color: #9ca3af; font-style: italic; }
      .bva-log {
        background: #f9fafb; border-radius: 8px; padding: 6px;
        max-height: 100px; overflow-y: auto; font-size: 11px;
        margin-bottom: 8px; border: 1px solid #e5e7eb;
      }
      .bva-log-title { font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
      .bva-actions { display: flex; gap: 8px; }
      .bva-btn {
        flex: 1; padding: 10px 16px; border-radius: 10px; font-size: 13px;
        font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .bva-btn:hover { transform: translateY(-1px); }
      .bva-btn-start { background: #3b82f6; color: white; }
      .bva-btn-start:hover { background: #2563eb; }
      .bva-btn-stop { background: #ef4444; color: white; display: none; }
      .bva-btn-stop:hover { background: #dc2626; }
      .bva-minimize {
        position: absolute; top: 8px; right: 8px; width: 24px; height: 24px;
        border-radius: 50%; border: none; background: transparent; cursor: pointer;
        color: #9ca3af; font-size: 16px; display: flex; align-items: center; justify-content: center;
      }
      .bva-minimize:hover { background: #f3f4f6; color: #374151; }
      .bva-fab {
        width: 56px; height: 56px; border-radius: 50%; background: #3b82f6; color: white;
        border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(59,130,246,0.4);
        font-size: 24px; display: none; align-items: center; justify-content: center;
      }
      .bva-fab:hover { transform: scale(1.1); }
      .bva-fab.visible { display: flex; }
      .bva-panel.minimized { display: none; }
      .bva-fields-count { font-size: 11px; color: #9ca3af; margin-bottom: 8px; cursor: pointer; }
      .bva-fields-count:hover { color: #3b82f6; text-decoration: underline; }
      .bva-btn-export {
        background: #f3f4f6; color: #374151; font-size: 11px; padding: 4px 10px;
        border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; margin-bottom: 8px;
      }
      .bva-btn-export:hover { background: #e5e7eb; }
      .bva-fields-modal {
        display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 999999; background: white; border-radius: 12px; padding: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 800px; width: 90vw; max-height: 80vh;
        overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .bva-fields-modal.visible { display: block; }
      .bva-fields-overlay {
        display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 999998;
      }
      .bva-fields-overlay.visible { display: block; }
      .bva-fields-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .bva-fields-table th { background: #f3f4f6; padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db; position: sticky; top: 0; }
      .bva-fields-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
      .bva-fields-table tr:hover { background: #f0f9ff; }
      .bva-fields-table .testid { font-family: monospace; font-size: 11px; color: #7c3aed; }
      .bva-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .bva-modal-title { font-size: 16px; font-weight: 600; }
      .bva-modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #6b7280; }
      .bva-modal-close:hover { color: #111; }
      .bva-modal-actions { display: flex; gap: 8px; margin-bottom: 12px; }
      .bva-modal-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; border: 1px solid #d1d5db; background: #fff; }
      .bva-modal-btn:hover { background: #f3f4f6; }
      .bva-modal-btn-primary { background: #3b82f6; color: white; border-color: #3b82f6; }
      .bva-modal-btn-primary:hover { background: #2563eb; }

      /* Batch mode styles */
      .bva-separator { border: none; border-top: 1px solid #e5e7eb; margin: 10px 0; }
      .bva-batch-title { font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 8px; }
      .bva-batch-row { display: flex; gap: 6px; margin-bottom: 6px; }
      .bva-batch-btn {
        flex: 1; padding: 7px 10px; border-radius: 8px; font-size: 12px;
        font-weight: 500; cursor: pointer; border: 1px solid #d1d5db;
        background: #f9fafb; color: #374151; transition: all 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 4px;
      }
      .bva-batch-btn:hover { background: #f3f4f6; border-color: #9ca3af; }
      .bva-batch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .bva-batch-btn-process { background: #10b981; color: white; border-color: #10b981; }
      .bva-batch-btn-process:hover { background: #059669; }
      .bva-batch-btn-process:disabled { background: #6ee7b7; border-color: #6ee7b7; }
      .bva-batch-btn-record { background: #f59e0b; color: white; border-color: #f59e0b; }
      .bva-batch-btn-record:hover { background: #d97706; }
      .bva-batch-btn-record.recording { background: #ef4444; border-color: #ef4444; animation: bva-pulse 1.5s ease-in-out infinite; }
      .bva-batch-file-name {
        font-size: 11px; color: #6b7280; margin-bottom: 6px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .bva-batch-status {
        font-size: 11px; padding: 6px 10px; border-radius: 6px;
        background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;
        display: none; margin-bottom: 6px;
      }
      .bva-batch-status.error { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
      .bva-batch-status.visible { display: block; }
    </style>

    <div class="bva-fields-overlay" id="bvaFieldsOverlay"></div>
    <div class="bva-fields-modal" id="bvaFieldsModal">
      <div class="bva-modal-header">
        <span class="bva-modal-title">Campos Detectados</span>
        <button class="bva-modal-close" id="bvaModalClose">&times;</button>
      </div>
      <div class="bva-modal-actions">
        <button class="bva-modal-btn bva-modal-btn-primary" id="bvaCopyFields">Copiar JSON</button>
        <button class="bva-modal-btn" id="bvaCopyCSV">Copiar CSV</button>
        <button class="bva-modal-btn" id="bvaDownloadFields">Descargar JSON</button>
      </div>
      <div id="bvaFieldsTableContainer"></div>
    </div>

    <div class="bva-panel" id="bvaPanel">
      <div class="bva-header">
        <span class="bva-title">Streaming Bio</span>
        <div class="bva-status"> 
          <div class="bva-dot" id="bvaDot"></div>
          <span id="bvaStatusText">Desconectado</span>
        </div>
      </div>
      <div class="bva-fields-count" id="bvaFieldsCount"></div>
      <button class="bva-btn-export" id="bvaExportFields">Ver campos detectados</button>
      <div class="bva-transcript" id="bvaTranscript"></div>
      <div class="bva-log-title">Log de actividad</div>
      <div class="bva-log" id="bvaLog"></div>
      <div class="bva-actions">
        <button class="bva-btn bva-btn-start" id="bvaStartBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          Iniciar 
        </button>
        <button class="bva-btn bva-btn-stop" id="bvaStopBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          Detener
        </button>
      </div>
      <hr class="bva-separator">
      <div class="bva-batch-title">Modo Batch (audio completo)</div>
      <input type="file" id="bvaBatchFileInput" accept=".wav,.flac,.mp3,.m4a,.ogg,.webm" style="display:none">
      <div class="bva-batch-row">
        <button class="bva-batch-btn" id="bvaBatchUploadBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Agregar audio
        </button>
        <button class="bva-batch-btn bva-batch-btn-record" id="bvaBatchRecordBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>
          Grabar
        </button>
      </div>
      <div class="bva-batch-file-name" id="bvaBatchFileName" style="display:none"></div>
      <button class="bva-batch-btn bva-batch-btn-process" id="bvaBatchProcessBtn" disabled style="width:100%;margin-bottom:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Procesar
      </button>
      <div class="bva-batch-status" id="bvaBatchStatus"></div>
      <button class="bva-minimize" id="bvaMinimize" title="Minimizar">&minus;</button>
    </div>

    <button class="bva-fab" id="bvaFab" title="Abrir dictado">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
  `;
    return container;
  }
  function isBiowelPage() {
    const testIdCount = document.querySelectorAll("[data-testid]").length;
    return testIdCount >= CONFIG.MIN_DATA_TESTID_COUNT;
  }
  function waitForBiowelPage(maxAttempts = 10) {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (isBiowelPage()) {
        console.log(`[BVA] Página Biowel detectada (${document.querySelectorAll("[data-testid]").length} data-testid)`);
        init();
      } else if (attempts < maxAttempts) {
        setTimeout(check, 1500);
      } else {
        console.log("[BVA] No es una página Biowel, script inactivo");
      }
    };
    check();
  }
  function init() {
    if (document.getElementById("biowel-voice-widget")) return;
    const scanner = new DOMScanner();
    const manipulator = new DOMManipulator(scanner);
    const recorder = new VoiceRecorder();
    let ws = null;
    let accumulatedText = "";
    let fields = scanner.scan();
    const widget = createWidget();
    document.body.appendChild(widget);
    const panel = widget.querySelector("#bvaPanel");
    const startBtn = widget.querySelector("#bvaStartBtn");
    const stopBtn = widget.querySelector("#bvaStopBtn");
    const minimizeBtn = widget.querySelector("#bvaMinimize");
    const fab = widget.querySelector("#bvaFab");
    const transcript = widget.querySelector("#bvaTranscript");
    const logContainer = widget.querySelector("#bvaLog");
    const dot = widget.querySelector("#bvaDot");
    const statusText = widget.querySelector("#bvaStatusText");
    const fieldsCount = widget.querySelector("#bvaFieldsCount");
    const exportBtn = widget.querySelector("#bvaExportFields");
    const fieldsModal = widget.querySelector("#bvaFieldsModal");
    const fieldsOverlay = widget.querySelector("#bvaFieldsOverlay");
    const modalClose = widget.querySelector("#bvaModalClose");
    widget.querySelector("#bvaCopyFields");
    widget.querySelector("#bvaCopyCSV");
    widget.querySelector("#bvaDownloadFields");
    const tableContainer = widget.querySelector("#bvaFieldsTableContainer");
    fieldsCount.textContent = `${fields.length} campos detectados con data-testid`;
    function rescanFields() {
      const newFields = scanner.scan();
      if (newFields.length !== fields.length) {
        const diff = newFields.length - fields.length;
        fields = newFields;
        fieldsCount.textContent = `${fields.length} campos detectados con data-testid`;
        addLog("decision", `Re-escaneo: ${fields.length} campos (${diff > 0 ? "+" : ""}${diff})`);
        console.log(`[BVA] Re-scan: ${fields.length} campos detectados`);
      }
      return fields;
    }
    let rescanTimer = null;
    const observer = new MutationObserver((mutations) => {
      let hasNewTestIds = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.hasAttribute?.("data-testid") || node.querySelector?.("[data-testid]")) {
              hasNewTestIds = true;
              break;
            }
          }
        }
        if (hasNewTestIds) break;
      }
      if (hasNewTestIds) {
        if (rescanTimer) clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => rescanFields(), 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    function showFieldsModal() {
      const currentFields = rescanFields();
      let html = `<table class="bva-fields-table"><thead><tr><th>#</th><th>data-testid</th><th>Label</th><th>Tipo</th><th>Ojo</th><th>Sección</th><th>Opciones</th></tr></thead><tbody>`;
      currentFields.forEach((f, i) => {
        html += `<tr><td>${i + 1}</td><td class="testid">${escapeHtml(f.data_testid)}</td><td>${escapeHtml(f.label || "-")}</td><td>${escapeHtml(f.field_type)}</td><td>${escapeHtml(f.eye || "-")}</td><td>${escapeHtml(f.section || "-")}</td><td>${f.options?.length ? escapeHtml(f.options.join(", ")) : "-"}</td></tr>`;
      });
      html += "</tbody></table>";
      tableContainer.innerHTML = html;
      fieldsModal.classList.add("visible");
      fieldsOverlay.classList.add("visible");
    }
    exportBtn.addEventListener("click", showFieldsModal);
    fieldsCount.addEventListener("click", showFieldsModal);
    modalClose.addEventListener("click", () => {
      fieldsModal.classList.remove("visible");
      fieldsOverlay.classList.remove("visible");
    });
    function setDot(state) {
      dot.classList.remove("connected", "recording");
      if (state === "connected") {
        dot.classList.add("connected");
        statusText.textContent = "Conectado";
      } else if (state === "recording") {
        dot.classList.add("recording");
        statusText.textContent = "Grabando...";
      } else {
        statusText.textContent = "Desconectado";
      }
    }
    function addLog(type, message) {
      const colors = { transcript: "#6b7280", decision: "#3b82f6", fill: "#22c55e", ignore: "#f59e0b" };
      const entry = document.createElement("div");
      entry.style.cssText = `font-size:11px;padding:3px 6px;border-left:3px solid ${colors[type] || "#6b7280"};margin-bottom:2px;color:#374151;background:${type === "fill" ? "#f0fdf4" : "transparent"};border-radius:0 4px 4px 0;`;
      entry.textContent = `• ${message}`;
      logContainer.appendChild(entry);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
    function connectWS() {
      return new Promise((resolve, reject) => {
        ws = new WebSocket(CONFIG.BACKEND_WS);
        ws.onopen = () => {
          setDot("connected");
          addLog("decision", "Conectado al backend");
          resolve();
        };
        ws.onerror = (e) => {
          setDot("disconnected");
          reject(e);
        };
        ws.onclose = () => {
          setDot("disconnected");
          addLog("decision", "Desconectado");
        };
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        };
      });
    }
    function handleMessage(msg) {
      switch (msg.type) {
        case "partial_transcription":
          transcript.innerHTML = `<span>${escapeHtml(accumulatedText)}</span><span style="color:#9ca3af;font-style:italic"> ${escapeHtml(msg.text || "")}</span>`;
          break;
        case "final_segment":
          accumulatedText += (accumulatedText ? " " : "") + msg.text;
          transcript.textContent = accumulatedText;
          addLog("transcript", msg.text);
          break;
        case "transcription":
          transcript.textContent = msg.text;
          break;
        case "partial_autofill":
          if (msg.items?.length) {
            const filled = manipulator.applyAutofill(msg.items);
            if (filled.length > 0) addLog("fill", `${filled.join(", ")} ← "${(msg.source_text || "").substring(0, 100)}"`);
          }
          break;
        case "autofill_data":
          if (msg.data) {
            const items = Object.entries(msg.data).map(([key, value]) => ({ unique_key: key, value, confidence: 0.9 }));
            const filled = manipulator.applyAutofill(items);
            if (filled.length > 0) addLog("fill", `LLM final: ${filled.join(", ")}`);
          }
          break;
        case "info":
          addLog("decision", msg.message || "Info del servidor");
          break;
        case "error":
          addLog("ignore", `⚠ Error: ${msg.message || "Error desconocido"}`);
          console.error("[BVA] Error del backend:", msg.message);
          break;
      }
    }
    function sendAudioChunk(blob) {
      blob.arrayBuffer().then((buffer) => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        ws.send(JSON.stringify({ type: "audio_chunk", data: btoa(binary) }));
      });
    }
    startBtn.addEventListener("click", async () => {
      try {
        if (!ws || ws.readyState !== WebSocket.OPEN) await connectWS();
        const freshFields = scanner.scan();
        accumulatedText = "";
        transcript.textContent = "";
        const ready = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            addLog("ignore", "⚠ Timeout esperando backend (5s)");
            resolve(false);
          }, 5e3);
          const origHandler = ws.onmessage;
          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === "info" || msg.type === "error") {
              clearTimeout(timeout);
              ws.onmessage = origHandler;
              handleMessage(msg);
              resolve(msg.type === "info");
            } else {
              handleMessage(msg);
            }
          };
          ws.send(JSON.stringify({ type: "biowel_form_structure", fields: freshFields, already_filled: manipulator.getFilledFields() }));
        });
        if (!ready) {
          addLog("ignore", "⚠ No se pudo iniciar el streaming");
          return;
        }
        if (await recorder.start(sendAudioChunk)) {
          startBtn.style.display = "none";
          stopBtn.style.display = "flex";
          panel.classList.add("recording");
          setDot("recording");
        }
      } catch (err) {
        console.error("[BVA] Error iniciando:", err);
        addLog("ignore", `⚠ Error: ${err.message}`);
        setDot("disconnected");
      }
    });
    stopBtn.addEventListener("click", () => {
      recorder.stop();
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end_stream" }));
      stopBtn.style.display = "none";
      startBtn.style.display = "flex";
      panel.classList.remove("recording");
      setDot("connected");
    });
    minimizeBtn.addEventListener("click", () => {
      panel.classList.add("minimized");
      fab.classList.add("visible");
    });
    fab.addEventListener("click", () => {
      panel.classList.remove("minimized");
      fab.classList.remove("visible");
    });
    const batchFileInput = document.createElement("input");
    batchFileInput.type = "file";
    batchFileInput.accept = ".wav,.flac,.mp3,.m4a,.ogg,.webm,.mp4,.aac";
    batchFileInput.style.display = "none";
    document.body.appendChild(batchFileInput);
    const batchUploadBtn = widget.querySelector("#bvaBatchUploadBtn");
    const batchRecordBtn = widget.querySelector("#bvaBatchRecordBtn");
    const batchProcessBtn = widget.querySelector("#bvaBatchProcessBtn");
    const batchFileName = widget.querySelector("#bvaBatchFileName");
    const batchStatus = widget.querySelector("#bvaBatchStatus");
    let batchSelectedFile = null;
    let batchMediaRecorder = null;
    let batchRecordedChunks = [];
    let batchIsRecording = false;
    function setBatchStatus(text, isError = false) {
      batchStatus.textContent = text;
      batchStatus.classList.toggle("error", isError);
      batchStatus.classList.add("visible");
    }
    function clearBatchStatus() {
      batchStatus.classList.remove("visible", "error");
      batchStatus.textContent = "";
    }
    function setBatchFile(file) {
      batchSelectedFile = file;
      if (file) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        batchFileName.textContent = `${file.name} (${sizeMB} MB)`;
        batchFileName.style.display = "block";
        batchProcessBtn.disabled = false;
      } else {
        batchFileName.style.display = "none";
        batchProcessBtn.disabled = true;
      }
    }
    batchUploadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => batchFileInput.click(), 100);
    });
    batchFileInput.addEventListener("change", (e) => {
      console.log("[BVA-Batch] File input change event, files:", e.target.files?.length);
      const file = e.target.files?.[0];
      if (file) {
        console.log("[BVA-Batch] File selected:", file.name, file.size, file.type);
        clearBatchStatus();
        setBatchFile(file);
        addLog("decision", `Audio cargado: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      }
      batchFileInput.value = "";
    });
    batchRecordBtn.addEventListener("click", async () => {
      if (batchIsRecording) {
        if (batchMediaRecorder && batchMediaRecorder.state !== "inactive") {
          batchMediaRecorder.stop();
        }
        batchRecordBtn.classList.remove("recording");
        batchRecordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg> Grabar`;
        batchIsRecording = false;
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        batchRecordedChunks = [];
        batchMediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        batchMediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) batchRecordedChunks.push(e.data);
        };
        batchMediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (batchRecordedChunks.length > 0) {
            const blob = new Blob(batchRecordedChunks, { type: "audio/webm" });
            const file = new File([blob], "grabacion.webm", { type: "audio/webm" });
            setBatchFile(file);
            addLog("decision", `Grabación completada: ${(file.size / 1024).toFixed(0)} KB`);
          }
        };
        batchMediaRecorder.start();
        batchIsRecording = true;
        batchRecordBtn.classList.add("recording");
        batchRecordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener`;
        clearBatchStatus();
        addLog("decision", "Grabando audio...");
      } catch (err) {
        console.error("[BVA-Batch] Error accediendo al micrófono:", err);
        setBatchStatus("Error: no se pudo acceder al micrófono", true);
      }
    });
    batchProcessBtn.addEventListener("click", async () => {
      if (!batchSelectedFile) {
        setBatchStatus("Selecciona o graba un audio primero", true);
        return;
      }
      batchProcessBtn.disabled = true;
      clearBatchStatus();
      try {
        setBatchStatus("Escaneando campos...");
        const freshFields = rescanFields();
        const filledFields = manipulator.getFilledFields();
        setBatchStatus("Subiendo audio...");
        const formData = new FormData();
        formData.append("audio_file", batchSelectedFile);
        formData.append("fields", JSON.stringify(freshFields));
        formData.append("already_filled", JSON.stringify(filledFields));
        addLog("decision", `Batch: enviando ${freshFields.length} campos + audio`);
        setBatchStatus("Transcribiendo...");
        const url = CONFIG.BACKEND_HTTP + CONFIG.BATCH_ENDPOINT;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6e5);
        let response;
        try {
          response = await fetch(url, {
            method: "POST",
            body: formData,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!response.ok) {
          let errMsg = `Error HTTP ${response.status}`;
          try {
            const errBody = await response.json();
            errMsg = errBody.detail || errMsg;
          } catch (e) {
          }
          throw new Error(errMsg);
        }
        setBatchStatus("Mapeando campos...");
        const result = await response.json();
        const { transcript: batchTranscript, filled_fields, stats } = result;
        if (batchTranscript) {
          transcript.textContent = batchTranscript;
          addLog("transcript", batchTranscript.substring(0, 200));
        }
        const entries = Object.entries(filled_fields || {});
        const clickItems = entries.filter(([_, v]) => v === "click");
        const dataItems = entries.filter(([_, v]) => v !== "click");
        if (entries.length === 0) {
          setBatchStatus("No se encontraron campos para llenar en el audio");
        } else {
          let totalApplied = 0;
          if (clickItems.length > 0) {
            setBatchStatus(`Ejecutando ${clickItems.length} acciones...`);
            addLog("fill", `Batch: ${clickItems.length} clicks + ${dataItems.length} campos`);
            for (const [key, value] of clickItems) {
              console.log(`[BVA-Batch] Click secuencial: ${key}`);
              const success = manipulator.fillField(key, value);
              if (success) {
                totalApplied++;
                manipulator.filledFields.set(key, value);
              }
              await new Promise((r) => setTimeout(r, 800));
              rescanFields();
            }
          }
          if (dataItems.length > 0) {
            const items = dataItems.map(([key, value]) => ({ unique_key: key, value, confidence: 1 }));
            const applied = manipulator.applyAutofill(items);
            totalApplied += applied.length;
          }
          addLog("fill", `Batch: ${totalApplied} campos aplicados`);
          setBatchStatus(
            `Listo: ${totalApplied} campos aplicados` + (stats?.skipped_already_filled_count ? `, ${stats.skipped_already_filled_count} ya estaban llenos` : "")
          );
        }
        console.log("[BVA-Batch] Resultado:", result);
      } catch (err) {
        console.error("[BVA-Batch] Error procesando:", err);
        setBatchStatus(`Error: ${err.message}`, true);
        addLog("ignore", `⚠ Batch error: ${err.message}`);
      } finally {
        batchProcessBtn.disabled = false;
      }
    });
  }
  waitForBiowelPage();
})();
