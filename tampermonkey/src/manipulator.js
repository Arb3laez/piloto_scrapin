export class DOMManipulator {
    constructor(scanner) {
        this.scanner = scanner;
        this.filledFields = new Map();
        this._initSwal2Observer();
    }

    /**
     * Polling que auto-cierra popups SweetAlert2 ("Aceptar").
     * Busca el botón .swal2-confirm O cualquier botón visible "Aceptar" dentro de un dialog.
     * Usa getBoundingClientRect para visibilidad (offsetParent falla con position:fixed).
     */
    _initSwal2Observer() {
        setInterval(() => {
            // Estrategia 1: buscar por clase swal2
            let btn = document.querySelector('.swal2-confirm');
            // Estrategia 2: buscar botón "Aceptar" en dialogs/modals
            if (!btn) {
                const candidates = document.querySelectorAll('[role="dialog"] button, .swal2-actions button, .modal-content button');
                for (const b of candidates) {
                    if (b.textContent.trim() === 'Aceptar') { btn = b; break; }
                }
            }
            // Estrategia 3: buscar cualquier botón visible con texto "Aceptar"
            if (!btn) {
                const allBtns = document.querySelectorAll('button');
                for (const b of allBtns) {
                    if (b.textContent.trim() === 'Aceptar') {
                        const r = b.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) { btn = b; break; }
                    }
                }
            }
            if (!btn) return;
            // Verificar visibilidad con getBoundingClientRect (funciona con position:fixed)
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

        // Fast-path para BOTONES clickeables (preconsulta dropdown items, atrás, agregar registro)
        // Valor "click" indica que el backend quiere hacer click directo en el elemento
        if (value === 'click') {
            return this._clickButton(uniqueKey);
        }

        // Rechazar botones/links NO registrados (que no vengan con value="click")
        if (keyLower.includes('-link') || keyLower.includes('-load-previous')) {
            console.warn(`[BVA-DOM] RECHAZADO: "${uniqueKey}" parece ser un link, no un campo llenable`);
            return false;
        }

        // Fast-path para radio buttons: no necesitan buscar un input estándar,
        // solo el contenedor con data-testid (Biowel usa divs clickeables)
        if (uniqueKey.endsWith('-radio')) {
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
            if (elTag === 'div' || elTag === 'span' || elTag === 'section') {
                const innerInput = this._findBestInput(el);
                if (innerInput) el = innerInput;
            }
        }

        if (!el || el.tagName.toLowerCase() === 'div') {
            const container = document.querySelector(`[data-testid="${uniqueKey}"]`);
            if (container) {
                const tag = container.tagName.toLowerCase();
                const containerRole = container.getAttribute('role');
                if (tag === 'textarea' || tag === 'select' || tag === 'input') {
                    el = container;
                } else if (tag === 'button' && (containerRole === 'switch' || containerRole === 'checkbox')) {
                    // Biowel uses button[role="switch"] for toggle checkboxes
                    el = container;
                } else {
                    const bestInput = this._findBestInput(container);
                    if (bestInput) el = bestInput;
                }
            }
        }

        if (!el) {
            const baseName = uniqueKey.replace(/-badge-field$/, '').replace(/-badge$/, '');
            const allEls = document.querySelectorAll(`[data-testid*="${baseName}"]`);
            for (const candidate of allEls) {
                const candidateTag = candidate.tagName.toLowerCase();
                if (candidateTag === 'textarea' || candidateTag === 'input') {
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
        if (finalTag !== 'textarea' && finalTag !== 'input' && finalTag !== 'select' && finalTag !== 'button') {
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
                case 'select': return this._setSelectValue(el, String(value));
                case 'checkbox': return this._setCheckboxValue(el, value);
                case 'radio': return this._setRadioValue(el, String(value));
                default: return this._setInputValue(el, String(value));
            }
        } catch (error) {
            console.error(`[BVA-DOM] Error llenando ${uniqueKey}:`, error);
            return false;
        }
    }

    _findBestInput(container) {
        if (!container) return null;

        // Si el container tiene data-testid con "checkbox" o "switch", buscar checkbox/switch primero
        const testId = container.getAttribute('data-testid') || '';
        if (testId.includes('checkbox') || testId.includes('switch')) {
            const cb = container.querySelector('input[type="checkbox"]');
            if (cb) return cb;
            const sw = container.querySelector('button[role="switch"], [role="checkbox"]');
            if (sw) return sw;
        }

        const textareas = container.querySelectorAll('textarea');
        for (const ta of textareas) if (ta.offsetParent !== null || ta.offsetHeight > 0) return ta;
        if (textareas.length > 0) return textareas[0];

        const textInputs = container.querySelectorAll('input[type="text"], input:not([type])');
        for (const inp of textInputs) if (inp.offsetParent !== null || inp.offsetHeight > 0) return inp;
        if (textInputs.length > 0) return textInputs[0];

        return container.querySelector('input[type="number"]') ||
            container.querySelector('input[type="checkbox"]') ||
            container.querySelector('input:not([type="radio"]):not([type="hidden"])') ||
            container.querySelector('button[role="switch"]') ||
            container.querySelector('select');
    }

    _isSearchableSelect(uniqueKey, el) {
        if (!uniqueKey.endsWith('-select')) return false;
        if (el.tagName.toLowerCase() !== 'input') return false;
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`);
        if (container && (container.className || '').toLowerCase().includes('select')) return true;
        return !!el.closest('.select, [class*="select-"]');
    }

    _inferType(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'textarea') return 'textarea';
        if (tag === 'select') return 'select';
        if (tag === 'button') {
            const role = el.getAttribute('role');
            if (role === 'switch' || role === 'checkbox') return 'checkbox';
        }
        if (tag === 'input') {
            if (el.type === 'checkbox') return 'checkbox';
            if (el.type === 'radio') return 'radio';
            if (el.type === 'number') return 'number';
        }
        return 'text';
    }

    _setInputValue(el, value) {
        let input = el;
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
            input = el.querySelector('input, textarea');
        }
        if (!input) return false;

        const setter = input.tagName.toLowerCase() === 'textarea'
            ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
            : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

        if (setter) setter.call(input, value);
        else input.value = value;

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        this._highlight(input);
        return true;
    }

    _setSelectValue(el, value) {
        if (el.tagName.toLowerCase() === 'select') {
            const option = Array.from(el.options).find(
                opt => opt.value.toLowerCase() === value.toLowerCase() ||
                    opt.textContent.toLowerCase().includes(value.toLowerCase())
            );
            if (option) {
                const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                if (setter) setter.call(el, option.value);
                else el.value = option.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
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
        inputEl.dispatchEvent(new Event('focus', { bubbles: true }));
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inputEl, value);
        else inputEl.value = value;

        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        // Eliminado slice(-1) que causaba corte de texto largo
        if (value.length > 0) {
            inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value[0] }));
            inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value[0] }));
        }

        this._highlight(inputEl);

        const maxAttempts = 5;
        const delays = [200, 400, 600, 1000, 1500];

        const trySelectOption = (attempt) => {
            if (attempt >= maxAttempts) return;
            setTimeout(() => {
                let options = container.querySelectorAll('.select-option, [role="option"], li[class*="option"]');
                if (!options.length) {
                    options = document.querySelectorAll('.select-dropdown [role="option"], .select-menu [role="option"], [class*="select"] [role="option"], [class*="dropdown"] li, [class*="listbox"] [role="option"], .select-option');
                }
                const validOptions = Array.from(options).filter(opt => {
                    const text = (opt.textContent || '').trim().toLowerCase();
                    const isVisible = opt.offsetParent !== null || opt.offsetHeight > 0;
                    return isVisible && text !== 'seleccionar...' && text !== 'seleccionar' && text !== '';
                });

                if (validOptions.length > 0) {
                    const bestMatch = validOptions.find(opt => (opt.textContent || '').toLowerCase().includes(value.toLowerCase())) || validOptions[0];
                    bestMatch.click();
                    bestMatch.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    bestMatch.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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
        const boolVal = (value === true || value === 'true' || value === '1' || value === 'si' || value === 'sí');
        console.log(`[BVA-DOM] _setCheckboxValue: tag=${el.tagName}, role=${el.getAttribute('role')}, target=${boolVal}`);

        // 1. Buscar input[type=checkbox] dentro del elemento o en su contenedor padre
        let checkbox = null;
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
            checkbox = el;
        } else {
            checkbox = el.querySelector('input[type="checkbox"]');
        }
        // Si no encontramos checkbox, buscar en el contenedor padre (label > input pattern)
        if (!checkbox && el.parentElement) {
            checkbox = el.parentElement.querySelector('input[type="checkbox"]');
        }

        if (checkbox) {
            console.log(`[BVA-DOM] Checkbox encontrado: checked=${checkbox.checked}, target=${boolVal}`);
            if (checkbox.checked !== boolVal) {
                checkbox.click();
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                this._highlight(checkbox.closest('[data-testid]') || checkbox);
            }
            return true;
        }

        // 2. Manejar button[role=switch] o [role=checkbox] (Biowel toggle components)
        const role = el.getAttribute('role');
        const isSwitch = role === 'switch' || role === 'checkbox' || el.tagName.toLowerCase() === 'button';
        if (isSwitch) {
            const currentChecked = el.getAttribute('aria-checked') === 'true';
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

        // Resolver el input radio real (puede ser el elemento directo o estar dentro de un contenedor)
        let radioInput = null;
        if (el.tagName === 'INPUT' && el.type === 'radio') {
            radioInput = el;
        } else {
            radioInput = el.querySelector('input[type="radio"]');
        }

        if (radioInput) {
            console.log(`[BVA-DOM] Radio input found: name=${radioInput.name}, checked=${radioInput.checked}`);

            // Estrategia 1: Click en el label padre (la forma más natural y compatible con React)
            const parentLabel = radioInput.closest('label');
            if (parentLabel) {
                console.log(`[BVA-DOM] Clicking parent label`);
                parentLabel.click();
            }

            // Estrategia 2: Native setter de React (fuerza el estado interno)
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'checked'
            )?.set;
            if (nativeSetter) {
                nativeSetter.call(radioInput, true);
                console.log(`[BVA-DOM] Native setter applied, checked=${radioInput.checked}`);
            } else {
                radioInput.checked = true;
            }

            // Estrategia 3: Dispatch eventos completos para React
            radioInput.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            radioInput.dispatchEvent(new Event('input', { bubbles: true }));
            radioInput.dispatchEvent(new Event('change', { bubbles: true }));

            this._highlight(radioInput.closest('[data-testid]') || radioInput);
            console.log(`[BVA-DOM] Radio activated, final checked=${radioInput.checked}`);
            return true;
        }

        // Fallback: el contenedor mismo es clickeable (componente custom estilo botón)
        const tag = el.tagName.toLowerCase();
        console.log(`[BVA-DOM] Radio fallback: tag=${tag}`);
        if (tag === 'div' || tag === 'span' || tag === 'label' || tag === 'button') {
            el.click();
            el.dispatchEvent(new Event('change', { bubbles: true }));
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
        // Mapa de fallback: dropdown ↔ tab (misma pantalla, diferente contexto)
        const PRECONSULTA_FALLBACK = {
            // Dropdown → Tab (para cuando estamos EN la pantalla de preconsulta)
            'header-preconsultation-dropdown-item-0': 'preconsultation-tab-dilatation',
            'header-preconsultation-dropdown-item-1': 'preconsultation-tab-vitalSigns',
            'header-preconsultation-dropdown-item-2': 'preconsultation-tab-eyescreening',
            'header-preconsultation-dropdown-item-3': 'preconsultation-tab-medicines',
            'header-preconsultation-dropdown-item-4': 'preconsultation-tab-orthoptic',
            // Tab → Dropdown (para cuando estamos EN la pantalla principal)
            'preconsultation-tab-dilatation': 'header-preconsultation-dropdown-item-0',
            'preconsultation-tab-vitalSigns': 'header-preconsultation-dropdown-item-1',
            'preconsultation-tab-eyescreening': 'header-preconsultation-dropdown-item-2',
            'preconsultation-tab-medicines': 'header-preconsultation-dropdown-item-3',
            'preconsultation-tab-orthoptic': 'header-preconsultation-dropdown-item-4',
        };

        let el = document.querySelector(`[data-testid="${uniqueKey}"]`);

        // Fallback: si no se encontró, buscar equivalente dropdown↔tab
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

        console.log(`[BVA-DOM] _clickButton: clicking '${uniqueKey}' (tag=${el.tagName})`);

        // Buscar el elemento clickeable: puede ser el propio, un botón interno, o un anchor
        const clickable = el.querySelector('button, a, [role="button"], [role="menuitem"]') || el;
        clickable.click();
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
        const target = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? el : (el.querySelector('input, select, textarea') || el);
        try {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.focus();
        } catch (e) { }
        target.style.transition = 'box-shadow 0.3s, border-color 0.3s';
        target.style.boxShadow = `0 0 0 4px rgba(59, 130, 246, 0.5)`;
        target.style.borderColor = '#3b82f6';
        setTimeout(() => {
            target.style.boxShadow = '';
            target.style.borderColor = '';
        }, 2000);
    }
}
