import { CONFIG } from './config';

// ============================================
// Registro de campos conocidos con clave
// Solo estos campos serán escaneados en el DOM
// ============================================
const REGISTERED_FIELDS = {
    'attention-origin-reason-for-consulting-badge-field': {
        label: 'Motivo de consulta',
        section: 'motivo_consulta',
        fieldType: 'textarea',
        keywords: ['motivo de consulta', 'motivo', 'consulta por'],
    },
    'attention-origin-current-disease-badge-field': {
        label: 'Enfermedad actual',   
        section: 'enfermedad_actual',
        fieldType: 'textarea',
        keywords: ['enfermedad actual', 'padecimiento actual', 'cuadro clínico'],
    },
    'attention-origin-select': {
        label: 'Origen de la atención',
        section: 'motivo_consulta',
        fieldType: 'select',
        keywords: ['origen de la atención', 'origen de atención', 'general', 'soat', 'laboral', 'profesional'],
    },
    'attention-origin-adverse-event-checkbox': {
        label: 'Evento adverso',
        section: 'motivo_consulta',
        fieldType: 'checkbox',
        keywords: ['evento adverso', 'adverso'],
    },
    'oftalmology-all-normal-checkbox': {
        label: 'Examen normal en ambos ojos',
        section: 'biomicroscopia',
        fieldType: 'checkbox',
        keywords: ['ojos normales', 'examen normal', 'todo normal', 'ambos ojos normales'],
    },
    'diagnostic-impression-diagnosis-select': {
        label: 'Impresión diagnóstica',
        section: 'diagnostico',
        fieldType: 'select',
        keywords: ['impresión diagnóstica', 'diagnóstico'],
    },
    'attention-origin-evolution-time-input': {
        label: 'Tiempo de evolución (cantidad)',
        section: 'motivo_consulta',
        fieldType: 'number',
        keywords: ['cantidad', 'valor'],
    },
    'attention-origin-evolution-time-unit-select': {
        label: 'Tiempo de evolución (unidad)',
        section: 'motivo_consulta',
        fieldType: 'select',
        keywords: ['tiempo', 'unidad'],
    },
    'oftalmology-observations-textarea': {
        label: 'Observaciones',
        section: 'biomicroscopia',
        fieldType: 'textarea',
        keywords: ['observaciones', 'observación', 'notas', 'comentarios'],
    },
    'analysis-and-plan-textarea': {
        label: 'Análisis y plan',
        section: 'diagnostico',
        fieldType: 'textarea',
        keywords: ['análisis y plan', 'analisis y plan', 'análisis', 'analisis', 'plan'],
    },
    'diagnostic-impression-type-cie10-radio': {
        label: 'IDX (CIE-10)',
        section: 'diagnostico',
        fieldType: 'radio',
        keywords: ['diagnóstico', 'diagnostico', 'idx'],
    },
    'diagnostic-impression-type-extended-radio': {
        label: 'IDX Ampliada',
        section: 'diagnostico',
        fieldType: 'radio',
        keywords: ['diagnóstico ampliado', 'diagnostico ampliado', 'idx ampliada', 'ampliada'],
    },

    // ============================================
    // Preconsulta - Dropdown items (botones clickeables)
    // ============================================
    'header-preconsultation-dropdown-item-0': {
        label: 'Preconsulta Dilatación',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['preconsulta dilatación', 'preconsulta dilatacion', 'dilatación', 'dilatacion'],
    },
    'header-preconsultation-dropdown-item-1': {
        label: 'Preconsulta Signos vitales',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['preconsulta signos vitales', 'signos vitales'],
    },
    'header-preconsultation-dropdown-item-2': {
        label: 'Preconsulta Tamizaje ocular',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['preconsulta tamizaje ocular', 'tamizaje ocular', 'tamizaje'],
    },
    'header-preconsultation-dropdown-item-3': {
        label: 'Preconsulta Conciliación medicamentosa',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['preconsulta conciliación medicamentosa', 'preconsulta conciliacion medicamentosa', 'conciliación medicamentosa', 'conciliacion medicamentosa'],
    },
    'header-preconsultation-dropdown-item-4': {
        label: 'Preconsulta Ortopédica',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['preconsulta ortopédica', 'preconsulta ortopedica', 'ortopédica', 'ortopedica'],
    },

    // Preconsulta - Botón Atrás
    'preconsultation-back-button': {
        label: 'Atrás (preconsulta)',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['atrás', 'atras', 'volver'],
    },

    // ============================================
    // Preconsulta - Tabs (dentro de pantalla preconsulta)
    // ============================================
    'preconsultation-tab-dilatation': {
        label: 'Tab Dilatación',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['tab dilatación', 'tab dilatacion'],
    },
    'preconsultation-tab-vitalSigns': {
        label: 'Tab Signos Vitales',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['tab signos vitales'],
    },
    'preconsultation-tab-eyescreening': {
        label: 'Tab Tamizaje Ocular',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['tab tamizaje ocular', 'tab tamizaje'],
    },
    'preconsultation-tab-medicines': {
        label: 'Tab Conciliación Medicamentosa',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['tab conciliación medicamentosa', 'tab conciliacion medicamentosa', 'tab medicamentos'],
    },
    'preconsultation-tab-fallRiskAssessment': {
        label: 'Clasificación del Riesgo',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: [
            'clasificación del riesgo',
            'clasificacion del riesgo',
            'clasificacion de riego',
            'clasificación de riego',
            'clasificacion riesgo',
            'clasificación riesgo',
            'del riesgo',
            'riesgo de caída',
            'riesgo de caida'
        ],
    },
    // ============================================
    // Clasificación del Riesgo - Radio buttons
    // ============================================
    'fall-risk-previousFalls-yes-radio': {
        label: 'Caídas previas Sí',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['caídas previas sí', 'caidas previas si'],
    },
    'fall-risk-previousFalls-no-radio': {
        label: 'Caídas previas No',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['caídas previas no', 'caidas previas no'],
    },
    'fall-risk-sensoryDeficit-yes-radio': {
        label: 'Déficit sensorial Sí',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['déficit sensorial sí', 'deficit sensorial si'],
    },
    'fall-risk-sensoryDeficit-no-radio': {
        label: 'Déficit sensorial No',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['déficit sensorial no', 'deficit sensorial no'],
    },
    'fall-risk-mentalState-yes-radio': {
        label: 'Estado mental Sí',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['estado mental sí', 'estado mental si'],
    },
    'fall-risk-mentalState-no-radio': {
        label: 'Estado mental No',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['estado mental no', 'estado mental no'],
    },
    'fall-risk-gaitAndMobility-yes-radio': {
        label: 'Marcha actual Sí',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['marcha actual sí', 'marcha actual si', 'marcha y movilidad'],
    },
    'fall-risk-gaitAndMobility-no-radio': {
        label: 'Marcha actual No',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['marcha actual no', 'marcha actual no'],
    },
    'fall-risk-medication-yes-radio': {
        label: 'Medicación actual Sí',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['medicación actual sí', 'medicacion actual si'],
    },
    'fall-risk-medication-no-radio': {
        label: 'Medicación actual No',
        section: 'clasificacion_riesgo',
        fieldType: 'radio',
        keywords: ['medicación actual no', 'medicacion actual no'],
    },

    'preconsultation-tab-orthoptic': {
        label: 'Tab Ortóptica',
        section: 'preconsulta',
        fieldType: 'button',
        keywords: ['tab ortopédica', 'tab ortopedica', 'tab ortóptica', 'tab ortoptica'],
    },

    // ============================================
    // Dilatación - Radio buttons y botón
    // ============================================
    'dilatation-requires-yes-radio': {
        label: 'Dilatación Sí',
        section: 'dilatacion',
        fieldType: 'radio',
        keywords: ['dilatación sí', 'dilatacion si', 'requiere dilatación'],
    },
    'dilatation-requires-no-radio': {
        label: 'Dilatación No',
        section: 'dilatacion',
        fieldType: 'radio',
        keywords: ['dilatación no', 'dilatacion no', 'no requiere dilatación'],
    },
    'dilatation-add-record-button': {
        label: 'Agregar registro dilatación',
        section: 'dilatacion',
        fieldType: 'button',
        keywords: ['agregar registro', 'agregar dilatación', 'agregar dilatacion'],
    },
    'dilatation-patient-dilated-switch': {
        label: 'Paciente dilatado',
        section: 'dilatacion',
        fieldType: 'checkbox',
        keywords: ['paciente dilatado', 'ya dilatado', 'dilatado'],
    },

    // ============================================
    // Oftalmología - OD Externo (Ojo Derecho Externo)
    // ============================================
    'ophtalmology-justification-textfield': {
        label: 'OD Externo (abrir panel)',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['ojo derecho externo', 'od externo', 'derecho externo'],
    },
    'text-config-findings-select': {
        label: 'Hallazgos (dropdown)',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['hallazgo', 'hallazgos', 'buscar hallazgo'],
    },
    'text-config-justification-textarea': {
        label: 'Justificación hallazgo',
        section: 'oftalmologia_externo',
        fieldType: 'textarea',
        keywords: ['justificación', 'justificacion'],
    },
    'text-config-search-field': {
        label: 'Buscar texto predefinido',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['buscar texto', 'texto predefinido'],
    },
    'text-config-save-button': {
        label: 'Guardar hallazgo',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['guardar hallazgo', 'guardar'],
    },

    // Opciones del dropdown de hallazgos OD Externo
    'select-option-0': {
        label: 'Párpados simétricos',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['párpados simétricos', 'parpados simetricos', 'párpados'],
    },
    'select-option-1': {
        label: 'Ausencia de edema palpebral',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['ausencia de edema', 'sin edema palpebral', 'ausencia edema'],
    },
    'select-option-2': {
        label: 'Distribución uniforme de las pestañas',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['distribución uniforme', 'pestañas uniformes', 'pestañas'],
    },
    'select-option-3': {
        label: 'Movimientos oculares conjugados y simétricos',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['movimientos oculares', 'movimientos conjugados'],
    },
    'select-option-4': {
        label: 'Lesiones',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['lesiones', 'lesión', 'lesion'],
    },
    'select-option-5': {
        label: 'Rosácea',
        section: 'oftalmologia_externo',
        fieldType: 'button',
        keywords: ['rosácea', 'rosacea'],
    },

    // ============================================
    // Antecedentes - Botón principal
    // ============================================
    'header-antecedents-button': {
        label: 'Antecedentes',
        section: 'antecedentes',
        fieldType: 'button',
        keywords: ['antecedentes', 'abrir antecedentes', 'ver antecedentes'],
    },

    // ============================================
    // Antecedentes Generales - Checkboxes + Inputs
    // ============================================
    'antecedents-arterialHypertension-checkbox': {
        label: 'Hipertensión arterial',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['hipertensión arterial', 'hipertension arterial'],
    },
    'antecedents-arterialHypertensioninput': {
        label: 'Comentario Hipertensión arterial',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-diabetesGeneral-checkbox': {
        label: 'Diabetes',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['diabetes', 'diabetes general'],
    },
    'antecedents-diabetesGeneralinput': {
        label: 'Comentario Diabetes',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-asthmaGeneral-checkbox': {
        label: 'Asma',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['asma', 'asma general'],
    },
    'antecedents-asthmaGeneralinput': {
        label: 'Comentario Asma',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-cancerGeneral-checkbox': {
        label: 'Cáncer',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['cáncer', 'cancer'],
    },
    'antecedents-cancerGeneralinput': {
        label: 'Comentario Cáncer',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-coronaryHeartDiseaseGeneral-checkbox': {
        label: 'Cardiopatía coronaria',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['cardiopatía coronaria', 'cardiopatia coronaria', 'cardiopatía', 'cardiopatia'],
    },
    'antecedents-coronaryHeartDiseaseGeneralinput': {
        label: 'Comentario Cardiopatía coronaria',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-tuberculosisGeneral-checkbox': {
        label: 'Tuberculosis',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['tuberculosis', 'tbc'],
    },
    'antecedents-tuberculosisGeneralinput': {
        label: 'Comentario Tuberculosis',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-rheumatoidArthritisGeneral-checkbox': {
        label: 'Artritis reumatoide',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['artritis reumatoide', 'artritis'],
    },
    'antecedents-rheumatoidArthritisGeneralinput': {
        label: 'Comentario Artritis reumatoide',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-copdGeneral-checkbox': {
        label: 'EPOC',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['epoc', 'enfermedad pulmonar obstructiva'],
    },
    'antecedents-copdGeneralinput': {
        label: 'Comentario EPOC',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-previousSurgeriesGeneral-checkbox': {
        label: 'Cirugías previas',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['cirugías previas', 'cirugias previas', 'cirugías', 'cirugias'],
    },
    'antecedents-previousSurgeriesGeneralinput': {
        label: 'Comentario Cirugías previas',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-allergiesGeneral-checkbox': {
        label: 'Alergias',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['alergias', 'alergia', 'alérgico', 'alergico'],
    },
    'antecedents-allergiesGeneralinput': {
        label: 'Comentario Alergias',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-useMedicationsGeneral-checkbox': {
        label: 'Uso de medicamentos',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['uso de medicamentos', 'medicamentos', 'usa medicamentos'],
    },
    'antecedents-useMedicationsGeneralinput': {
        label: 'Comentario Uso de medicamentos',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-othersGeneral-checkbox': {
        label: 'Otros (Generales)',
        section: 'antecedentes_generales',
        fieldType: 'checkbox',
        keywords: ['otros generales', 'otro general', 'otros antecedentes generales'],
    },
    'antecedents-othersGeneralinput': {
        label: 'Comentario Otros (Generales)',
        section: 'antecedentes_generales',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-generalNotes-textarea': {
        label: 'Notas generales antecedentes',
        section: 'antecedentes_generales',
        fieldType: 'textarea',
        keywords: ['notas generales', 'notas antecedentes generales'],
    },

    // ============================================
    // Antecedentes Oculares - Checkboxes + Inputs
    // ============================================
    'antecedents-glaucomaOcular-checkbox': {
        label: 'Glaucoma',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['glaucoma', 'glaucoma ocular'],
    },
    'antecedents-glaucomaOcularinput': {
        label: 'Comentario Glaucoma',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-ropOcular-checkbox': {
        label: 'ROP',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['rop', 'retinopatía del prematuro', 'retinopatia del prematuro'],
    },
    'antecedents-ropOcularinput': {
        label: 'Comentario ROP',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-dmreOcular-checkbox': {
        label: 'DMRE',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['dmre', 'degeneración macular', 'degeneracion macular'],
    },
    'antecedents-dmreOcularinput': {
        label: 'Comentario DMRE',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-glassesOcular-checkbox': {
        label: 'Uso de gafas',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['uso de gafas', 'gafas', 'usa gafas', 'lentes'],
    },
    'antecedents-glassesOcularinput': {
        label: 'Comentario Uso de gafas',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-dryEyeOcular-checkbox': {
        label: 'Ojo seco',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['ojo seco', 'síndrome de ojo seco', 'sindrome de ojo seco'],
    },
    'antecedents-dryEyeOcularinput': {
        label: 'Comentario Ojo seco',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-diabeticRetinoPathyOcular-checkbox': {
        label: 'Retinopatía diabética',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['retinopatía diabética', 'retinopatia diabetica'],
    },
    'antecedents-diabeticRetinoPathyOcularinput': {
        label: 'Comentario Retinopatía diabética',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-uveitisOcular-checkbox': {
        label: 'Uveítis',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['uveítis', 'uveitis'],
    },
    'antecedents-uveitisOcularinput': {
        label: 'Comentario Uveítis',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-contactLensesOcular-checkbox': {
        label: 'Lentes de contacto',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['lentes de contacto', 'usa lentes de contacto'],
    },
    'antecedents-contactLensesOcularinput': {
        label: 'Comentario Lentes de contacto',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-traumasOcular-checkbox': {
        label: 'Traumas oculares',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['traumas oculares', 'trauma ocular', 'traumas'],
    },
    'antecedents-traumasOcularinput': {
        label: 'Comentario Traumas oculares',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-surgeriesOcular-checkbox': {
        label: 'Cirugías oculares',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['cirugías oculares', 'cirugias oculares', 'cirugía ocular', 'cirugia ocular'],
    },
    'antecedents-surgeriesOcularinput': {
        label: 'Comentario Cirugías oculares',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-alertsOcular-checkbox': {
        label: 'Alertas oculares',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['alertas oculares', 'alerta ocular', 'alertas'],
    },
    'antecedents-alertsOcularinput': {
        label: 'Comentario Alertas oculares',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-othersOcular-checkbox': {
        label: 'Otros (Oculares)',
        section: 'antecedentes_oculares',
        fieldType: 'checkbox',
        keywords: ['otros oculares', 'otro ocular', 'otros antecedentes oculares'],
    },
    'antecedents-othersOcularinput': {
        label: 'Comentario Otros (Oculares)',
        section: 'antecedentes_oculares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-ocularNotes-textarea': {
        label: 'Notas oculares antecedentes',
        section: 'antecedentes_oculares',
        fieldType: 'textarea',
        keywords: ['notas oculares', 'notas antecedentes oculares'],
    },

    // ============================================
    // Antecedentes Familiares - Checkboxes + Inputs
    // ============================================
    'antecedents-ahtFamiliar-checkbox': {
        label: 'HTA familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['hipertensión familiar', 'hipertension familiar', 'hta familiar'],
    },
    'antecedents-ahtFamiliarinput': {
        label: 'Comentario HTA familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-diabetesFamiliar-checkbox': {
        label: 'Diabetes familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['diabetes familiar'],
    },
    'antecedents-diabetesFamiliarinput': {
        label: 'Comentario Diabetes familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-asthmaFamiliar-checkbox': {
        label: 'Asma familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['asma familiar'],
    },
    'antecedents-asthmaFamiliarinput': {
        label: 'Comentario Asma familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-coronaryHeartDiseaseFamiliar-checkbox': {
        label: 'Cardiopatía coronaria familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['cardiopatía familiar', 'cardiopatia familiar', 'cardiopatía coronaria familiar', 'cardiopatia coronaria familiar'],
    },
    'antecedents-coronaryHeartDiseaseFamiliarinput': {
        label: 'Comentario Cardiopatía coronaria familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-collagenDiseaseFamiliar-checkbox': {
        label: 'Enfermedad del colágeno familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['enfermedad del colágeno', 'enfermedad del colageno', 'colágeno familiar', 'colageno familiar'],
    },
    'antecedents-collagenDiseaseFamiliarinput': {
        label: 'Comentario Enfermedad del colágeno familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-glaucomaFamiliar-checkbox': {
        label: 'Glaucoma familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['glaucoma familiar'],
    },
    'antecedents-glaucomaFamiliarinput': {
        label: 'Comentario Glaucoma familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-keratoconusFamiliar-checkbox': {
        label: 'Queratocono familiar',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['queratocono familiar', 'queratocono', 'keratocono familiar'],
    },
    'antecedents-keratoconusFamiliarinput': {
        label: 'Comentario Queratocono familiar',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-othersFamiliar-checkbox': {
        label: 'Otros (Familiares)',
        section: 'antecedentes_familiares',
        fieldType: 'checkbox',
        keywords: ['otros familiares', 'otro familiar', 'otros antecedentes familiares'],
    },
    'antecedents-othersFamiliarinput': {
        label: 'Comentario Otros (Familiares)',
        section: 'antecedentes_familiares',
        fieldType: 'text',
        keywords: [],
    },
    'antecedents-familiarNotes-textarea': {
        label: 'Notas familiares antecedentes',
        section: 'antecedentes_familiares',
        fieldType: 'textarea',
        keywords: ['notas familiares', 'notas antecedentes familiares'],
    },

    // ============================================
    // Antecedentes - Botones guardar/cancelar
    // ============================================
    'antecedents-save-button': {
        label: 'Guardar antecedentes',
        section: 'antecedentes',
        fieldType: 'button',
        keywords: ['guardar antecedentes', 'salvar antecedentes'],
    },
    'antecedents-cancel-button': {
        label: 'Cancelar antecedentes',
        section: 'antecedentes',
        fieldType: 'button',
        keywords: ['cancelar antecedentes'],
    },

};

export class DOMScanner {
    constructor() {
        this.fields = [];
        this.elementMap = new Map(); // unique_key → contenedor con data-testid
        this.inputMap = new Map();   // unique_key → input/textarea/select real
        // Copia mutable del registro (para registerField en runtime)
        this._registry = { ...REGISTERED_FIELDS };
    }

    /**
     * Escanea SOLO los campos registrados en el DOM.
     * Busca cada data-testid del registro y construye la lista de campos encontrados.
     */
    scan() {
        this.fields = [];
        this.elementMap = new Map();
        this.inputMap = new Map();

        for (const [testId, meta] of Object.entries(this._registry)) {
            const result = this._scanOneField(testId, meta);
            if (result) {
                this.fields.push(result.field);
                this.elementMap.set(testId, result.container);
                this.inputMap.set(testId, result.inputEl);
            }
        }

        console.log(`[BVA-Scanner] ${this.fields.length} campos registrados encontrados en DOM`);
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

        // Actualizar o agregar en las colecciones
        const existingIdx = this.fields.findIndex(f => f.unique_key === testId);
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
            console.warn('[BVA-Scanner] registerField requiere testId y meta');
            return;
        }
        this._registry[testId] = {
            label: meta.label || testId,
            section: meta.section || null,
            fieldType: meta.fieldType || 'text',
            keywords: meta.keywords || [],
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

        // Detectar tipo real del DOM (puede diferir del registrado)
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
            tag: (inputEl || container).tagName.toLowerCase(),
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
        return this.fields.find(f => f.unique_key === uniqueKey) || null;
    }

    // ============================================
    // Helpers de detección (sin cambios)
    // ============================================

    _extractLabel(container, inputEl) {
        const col = container.closest('[class*="col"]');
        if (col) {
            const label = col.querySelector('label, .text-label');
            if (label) return label.textContent.trim();
        }
        if (inputEl) {
            const ariaLabel = inputEl.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;
        }
        if (inputEl?.placeholder) return inputEl.placeholder;
        const innerLabel = container.querySelector('label, .text-label');
        if (innerLabel) return innerLabel.textContent.trim();
        const parent = container.parentElement;
        if (parent) {
            const label = parent.querySelector('label, .text-label');
            if (label) return label.textContent.trim();
        }
        const labelledBy = (inputEl || container).getAttribute('aria-labelledby');
        if (labelledBy) {
            const refEl = document.getElementById(labelledBy);
            if (refEl) return refEl.textContent.trim();
        }
        return container.getAttribute('data-testid')
            ?.replace(/-/g, ' ')
            ?.replace(/badge|field/g, '')
            ?.trim() || 'Sin etiqueta';
    }

    _detectFieldType(el) {
        if (!el) return 'text';
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') return 'select';
        if (tag === 'textarea') return 'textarea';
        if (tag === 'input') {
            const type = el.type?.toLowerCase();
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'number') return 'number';
            return 'text';
        }
        const role = el.getAttribute('role');
        if (role === 'combobox' || role === 'listbox') return 'select';
        if (role === 'checkbox' || role === 'switch') return 'checkbox';
        if (role === 'radio') return 'radio';
        const innerInput = el.querySelector('input, textarea, select');
        if (innerInput) return this._detectFieldType(innerInput);
        return 'text';
    }

    _detectEye(testId, el) {
        const text = (testId + ' ' + (el.textContent || '')).toLowerCase();
        if (/\b(od|ojo.?derecho|right.?eye)\b/i.test(text)) return 'OD';
        if (/\b(oi|ojo.?izquierdo|left.?eye)\b/i.test(text)) return 'OI';
        if (/\b(ao|ambos.?ojos|both.?eyes)\b/i.test(text)) return 'AO';
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
            gonioscopia: /gonioscopia/,
        }
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
        if (el.tagName.toLowerCase() === 'select') {
            return Array.from(el.options)
                .filter(opt => opt.value)
                .map(opt => opt.textContent.trim());
        }
        const select = el.querySelector('select');
        if (select) {
            return Array.from(select.options)
                .filter(opt => opt.value)
                .map(opt => opt.textContent.trim());
        }
        const listbox = el.querySelector('[role="listbox"]');
        if (listbox) {
            return Array.from(listbox.querySelectorAll('[role="option"]'))
                .map(opt => opt.textContent.trim());
        }
        return [];
    }
}
