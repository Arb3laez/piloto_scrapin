import { CONFIG } from './config';

export class DOMScanner {
    constructor() {
        this.fields = [];
        this.elementMap = new Map(); // unique_key → contenedor con data-testid
        this.inputMap = new Map();   // unique_key → input/textarea/select real
    }

    scan() {
        this.fields = [];
        this.elementMap = new Map();
        this.inputMap = new Map();

        const GENERIC_TESTIDS = new Set([
            'badge-text-field-textarea',
            'badge-text-field-input',
            'badge-checkbox',
            'badge-select',
            'badge-radio',
        ]);

        const elements = document.querySelectorAll('[data-testid]');
        const seenKeys = new Set();

        elements.forEach(el => {
            const testId = el.getAttribute('data-testid');
            if (!testId) return;

            let containerTestId = testId;
            let container = el;
            let inputEl = null;

            if (GENERIC_TESTIDS.has(testId)) {
                const parent = el.closest('[data-testid]:not([data-testid="' + testId + '"])');
                if (parent) {
                    containerTestId = parent.getAttribute('data-testid');
                    container = parent;
                    inputEl = el;
                } else {
                    return;
                }
            } else {
                inputEl = this._findNearbyInput(el) || el;
            }

            if (seenKeys.has(containerTestId)) return;
            seenKeys.add(containerTestId);

            const field = {
                data_testid: containerTestId,
                unique_key: containerTestId,
                label: this._extractLabel(container, inputEl),
                field_type: this._detectFieldType(inputEl || container),
                eye: this._detectEye(containerTestId, container),
                section: this._detectSection(containerTestId),
                options: this._extractOptions(container),
                tag: (inputEl || container).tagName.toLowerCase(),
            };

            this.fields.push(field);
            this.elementMap.set(containerTestId, container);
            this.inputMap.set(containerTestId, inputEl || container);
        });

        console.log(`[BVA-Scanner] ${this.fields.length} campos únicos escaneados`);
        return this.fields;
    }

    getElement(uniqueKey) {
        return this.elementMap.get(uniqueKey) || null;
    }

    getInput(uniqueKey) {
        return this.inputMap.get(uniqueKey) || this.getElement(uniqueKey);
    }

    findByKey(uniqueKey) {
        return this.fields.find(f => f.unique_key === uniqueKey) || null;
    }

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
