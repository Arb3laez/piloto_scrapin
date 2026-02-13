export class DOMManipulator {
    constructor(scanner) {
        this.scanner = scanner;
        this.filledFields = new Map();
    }

    applyAutofill(items) {
        const filled = [];
        for (const item of items) {
            const success = this.fillField(item.unique_key, item.value);
            if (success) {
                filled.push(item.unique_key);
                this.filledFields.set(item.unique_key, item.value);
            }
        }
        return filled;
    }

    fillField(uniqueKey, value) {
        let el = null;
        console.log(`[BVA-DOM] === fillField("${uniqueKey}", "${String(value).substring(0, 60)}") ===`);

        const keyLower = uniqueKey.toLowerCase();
        if (keyLower.includes('-button') || keyLower.includes('-btn') ||
            keyLower.includes('-link') || keyLower.includes('-load-previous')) {
            console.warn(`[BVA-DOM] RECHAZADO: "${uniqueKey}" parece ser un botón/link, no un campo llenable`);
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
                if (tag === 'textarea' || tag === 'select' || tag === 'input') {
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

        if (!el) return false;

        const finalTag = el.tagName.toLowerCase();
        if (finalTag !== 'textarea' && finalTag !== 'input' && finalTag !== 'select') {
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
        const textareas = container.querySelectorAll('textarea');
        for (const ta of textareas) if (ta.offsetParent !== null || ta.offsetHeight > 0) return ta;
        if (textareas.length > 0) return textareas[0];

        const textInputs = container.querySelectorAll('input[type="text"], input:not([type])');
        for (const inp of textInputs) if (inp.offsetParent !== null || inp.offsetHeight > 0) return inp;
        if (textInputs.length > 0) return textInputs[0];

        return container.querySelector('input[type="number"]') ||
            container.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])') ||
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
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));

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
        const checkbox = el instanceof HTMLInputElement ? el : el.querySelector('input');
        const role = el.getAttribute('role');
        const isSwitch = role === 'switch' || role === 'checkbox' || el.tagName.toLowerCase() === 'button';
        const boolVal = (value === true || value === 'true' || value === '1' || value === 'si' || value === 'sí');

        if (checkbox) {
            if (checkbox.checked !== boolVal) {
                checkbox.click();
                this._highlight(el);
            }
            return true;
        } else if (isSwitch) {
            const currentChecked = el.getAttribute('aria-checked') === 'true';
            if (currentChecked !== boolVal) {
                el.click();
                this._highlight(el);
            }
            return true;
        }
        return false;
    }

    _setRadioValue(el, value) {
        const name = el.name || el.querySelector('input')?.name;
        if (!name) return false;
        const target = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (target) {
            target.click();
            this._highlight(target);
            return true;
        }
        return false;
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
