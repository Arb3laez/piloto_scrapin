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
    MIN_DATA_TESTID_COUNT: 3
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
      const name = el.name || el.querySelector('input[type="radio"]')?.name;
      console.log(`[BVA-DOM] Radio name=${name}`);
      if (name) {
        const target = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (target) {
          target.click();
          target.dispatchEvent(new Event("change", { bubbles: true }));
          this._highlight(target);
          console.log(`[BVA-DOM] Radio (standard name/value) clicked`);
          return true;
        }
      }
      const innerRadio = el.querySelector('input[type="radio"]');
      console.log(`[BVA-DOM] innerRadio found:`, innerRadio, innerRadio?.checked);
      if (innerRadio) {
        if (!innerRadio.checked) {
          innerRadio.click();
          innerRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
        this._highlight(innerRadio.closest("[data-testid]") || innerRadio);
        console.log(`[BVA-DOM] Radio (inner input) clicked, now checked=${innerRadio.checked}`);
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
     */
    _clickButton(uniqueKey) {
      const el = document.querySelector(`[data-testid="${uniqueKey}"]`);
      if (!el) {
        console.warn(`[BVA-DOM] _clickButton: elemento '${uniqueKey}' NO encontrado en DOM`);
        return false;
      }
      console.log(`[BVA-DOM] _clickButton: clicking '${uniqueKey}' (tag=${el.tagName})`);
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
        let chunkCount = 0;
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
        this.muteNode = this.audioContext.createGain();
        this.muteNode.gain.value = 0;
        this.processorNode.connect(this.muteNode);
        this.muteNode.connect(this.audioContext.destination);
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
        this.muteNode?.disconnect();
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
      this.muteNode = null;
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
    const fields = scanner.scan();
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
    function showFieldsModal() {
      let html = `<table class="bva-fields-table"><thead><tr><th>#</th><th>data-testid</th><th>Label</th><th>Tipo</th><th>Ojo</th><th>Sección</th><th>Opciones</th></tr></thead><tbody>`;
      fields.forEach((f, i) => {
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
  }
  waitForBiowelPage();
})();
