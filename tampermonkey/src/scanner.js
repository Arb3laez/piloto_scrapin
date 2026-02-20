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
