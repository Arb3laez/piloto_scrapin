(function () {
  'use strict'

  // ============================================
  // Configuración
  // ============================================
  const CONFIG = {
    BACKEND_WS: 'ws://localhost:8000/ws/voice-stream',
    MIN_DATA_TESTID_COUNT: 3, // Mínimo de data-testid para considerar Biowel
    HIGHLIGHT_COLOR: '#6e22c5', // Verde para feedback visual
    HIGHLIGHT_DURATION: 1000,   // 1 segundo
  }

  // ============================================
  // Utilidades
  // ============================================
  /** Escapa HTML para prevenir XSS al insertar en innerHTML */
  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  // ============================================
  // Detección de página Biowel
  // ============================================
  function isBiowelPage() {
    const testIdCount = document.querySelectorAll('[data-testid]').length
    return testIdCount >= CONFIG.MIN_DATA_TESTID_COUNT
  }

  // Esperar a que el DOM esté completo (para SPAs que cargan lento)
  function waitForBiowelPage(maxAttempts = 10) {
    let attempts = 0
    const check = () => {
      attempts++
      if (isBiowelPage()) {
        console.log(`[BVA] Página Biowel detectada (${document.querySelectorAll('[data-testid]').length} data-testid)`)
        init()
      } else if (attempts < maxAttempts) {
        setTimeout(check, 1500)
      } else {
        console.log('[BVA] No es una página Biowel, script inactivo')
      }
    }
    check()
  }

  // ============================================
  // DOMScanner - Escanea campos data-testid
  // ============================================
  class DOMScanner {
    constructor() {
      this.fields = []
      this.elementMap = new Map() // unique_key → contenedor con data-testid
      this.inputMap = new Map()   // unique_key → input/textarea/select real
    }

    scan() {
      this.fields = []
      this.elementMap = new Map()
      this.inputMap = new Map()

      // data-testid genéricos de Biowel que se repiten — los ignoramos como identificadores
      const GENERIC_TESTIDS = new Set([
        'badge-text-field-textarea',
        'badge-text-field-input',
        'badge-checkbox',
        'badge-select',
        'badge-radio',
      ])

      const elements = document.querySelectorAll('[data-testid]')
      const seenKeys = new Set()

      elements.forEach(el => {
        const testId = el.getAttribute('data-testid')
        if (!testId) return

        // Si es genérico, buscamos el contenedor padre con data-testid único
        let containerTestId = testId
        let container = el
        let inputEl = null

        if (GENERIC_TESTIDS.has(testId)) {
          // Buscar ancestro con data-testid único
          const parent = el.closest('[data-testid]:not([data-testid="' + testId + '"])')
          if (parent) {
            containerTestId = parent.getAttribute('data-testid')
            container = parent
            inputEl = el // el genérico ES el input
          } else {
            return // No tiene contenedor identificable, skipear
          }
        } else {
          // El data-testid es del contenedor, buscar input dentro o cerca
          inputEl = this._findNearbyInput(el) || el
        }

        // Evitar duplicados
        if (seenKeys.has(containerTestId)) return
        seenKeys.add(containerTestId)

        const field = {
          data_testid: containerTestId,
          unique_key: containerTestId,
          label: this._extractLabel(container, inputEl),
          field_type: this._detectFieldType(inputEl || container),
          eye: this._detectEye(containerTestId, container),
          section: this._detectSection(containerTestId),
          options: this._extractOptions(container),
          tag: (inputEl || container).tagName.toLowerCase(),
        }

        this.fields.push(field)
        this.elementMap.set(containerTestId, container)
        this.inputMap.set(containerTestId, inputEl || container)
      })

      console.log(`[BVA-Scanner] ${this.fields.length} campos únicos escaneados`)
      return this.fields
    }

    getElement(uniqueKey) {
      return this.elementMap.get(uniqueKey) || null
    }

    getInput(uniqueKey) {
      return this.inputMap.get(uniqueKey) || this.getElement(uniqueKey)
    }

    findByKey(uniqueKey) {
      return this.fields.find(f => f.unique_key === uniqueKey) || null
    }

    _extractLabel(container, inputEl) {
      // Strategy 1: label.text-label en el mismo col
      const col = container.closest('[class*="col"]')
      if (col) {
        const label = col.querySelector('label, .text-label')
        if (label) return label.textContent.trim()
      }

      // Strategy 2: aria-label del input
      if (inputEl) {
        const ariaLabel = inputEl.getAttribute('aria-label')
        if (ariaLabel) return ariaLabel
      }

      // Strategy 3: placeholder
      if (inputEl?.placeholder) return inputEl.placeholder

      // Strategy 4: label dentro del contenedor
      const innerLabel = container.querySelector('label, .text-label')
      if (innerLabel) return innerLabel.textContent.trim()

      // Strategy 5: texto del contenedor padre cercano
      const parent = container.parentElement
      if (parent) {
        const label = parent.querySelector('label, .text-label')
        if (label) return label.textContent.trim()
      }

      // Strategy 6: aria-labelledby
      const labelledBy = (inputEl || container).getAttribute('aria-labelledby')
      if (labelledBy) {
        const refEl = document.getElementById(labelledBy)
        if (refEl) return refEl.textContent.trim()
      }

      // Fallback: convertir data-testid a nombre legible
      return container.getAttribute('data-testid')
        ?.replace(/-/g, ' ')
        ?.replace(/badge|field/g, '')
        ?.trim() || 'Sin etiqueta'
    }

    _detectFieldType(el) {
      if (!el) return 'text'
      const tag = el.tagName.toLowerCase()
      if (tag === 'select') return 'select'
      if (tag === 'textarea') return 'textarea'
      if (tag === 'input') {
        const type = el.type?.toLowerCase()
        if (type === 'checkbox') return 'checkbox'
        if (type === 'radio') return 'radio'
        if (type === 'number') return 'number'
        return 'text'
      }
      const role = el.getAttribute('role')
      if (role === 'combobox' || role === 'listbox') return 'select'
      if (role === 'checkbox' || role === 'switch') return 'checkbox'
      if (role === 'radio') return 'radio'

      const innerInput = el.querySelector('input, textarea, select')
      if (innerInput) return this._detectFieldType(innerInput)

      return 'text'
    }

    _detectEye(testId, el) {
      const text = (testId + ' ' + (el.textContent || '')).toLowerCase()
      if (/\b(od|ojo.?derecho|right.?eye)\b/i.test(text)) return 'OD'
      if (/\b(oi|ojo.?izquierdo|left.?eye)\b/i.test(text)) return 'OI'
      if (/\b(ao|ambos.?ojos|both.?eyes)\b/i.test(text)) return 'AO'
      return null
    }

    _detectSection(testId) {
      const id = testId.toLowerCase()
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
        if (pattern.test(id)) return section
      }
      return null
    }

    /**
     * Busca el input/textarea/select más cercano a un contenedor con data-testid.
     * En Biowel, el textarea puede ser hermano o primo del contenedor, no hijo.
     * Estructura real:
     *   div.col-6
     *     ├─ div data-testid="unique-field" (contenedor identificador)
     *     └─ div.autocomplete-wrapper
     *         └─ textarea (el input real)
     */
    _findNearbyInput(container) {
      const INPUT_SELECTOR = 'textarea, input:not([type="hidden"]), select'

      // 1. Hijo directo (caso estándar)
      let input = container.querySelector(INPUT_SELECTOR)
      if (input) return input

      // 2. Hermano: buscar en el padre inmediato del contenedor
      const parent = container.parentElement
      if (parent) {
        // Buscar en wrappers hermanos (autocomplete-wrapper, textfield-modal, etc.)
        input = parent.querySelector(INPUT_SELECTOR)
        if (input) {
          console.log(`[BVA-Scanner] NEARBY: Encontrado en padre → <${input.tagName.toLowerCase()}>`)
          return input
        }
      }

      // 3. Subir al contenedor de columna (col-6, col-*) y buscar ahí
      const col = container.closest('[class*="col"]')
      if (col) {
        input = col.querySelector(INPUT_SELECTOR)
        if (input) {
          console.log(`[BVA-Scanner] NEARBY: Encontrado en col → <${input.tagName.toLowerCase()}>`)
          return input
        }
      }

      return null
    }

    _extractOptions(el) {
      if (el.tagName.toLowerCase() === 'select') {
        return Array.from(el.options)
          .filter(opt => opt.value)
          .map(opt => opt.textContent.trim())
      }
      const select = el.querySelector('select')
      if (select) {
        return Array.from(select.options)
          .filter(opt => opt.value)
          .map(opt => opt.textContent.trim())
      }
      const listbox = el.querySelector('[role="listbox"]')
      if (listbox) {
        return Array.from(listbox.querySelectorAll('[role="option"]'))
          .map(opt => opt.textContent.trim())
      }
      return []
    }
  }

  // ============================================
  // DOMManipulator - Llena campos por data-testid
  // ============================================
  class DOMManipulator {
    constructor(scanner) {
      this.scanner = scanner
      this.filledFields = new Map()
    }

    applyAutofill(items) {
      const filled = []
      for (const item of items) {
        const success = this.fillField(item.unique_key, item.value)
        if (success) {
          filled.push(item.unique_key)
          this.filledFields.set(item.unique_key, item.value)
        }
      }
      return filled
    }

    fillField(uniqueKey, value) {
      let el = null

      console.log(`[BVA-DOM] === fillField("${uniqueKey}", "${String(value).substring(0, 60)}") ===`)

      // Protección: rechazar campos que son botones, links, o elementos no-llenables
      // Esto previene que el LLM/regex mapeen texto a botones por error
      const keyLower = uniqueKey.toLowerCase()
      if (keyLower.includes('-button') || keyLower.includes('-btn') ||
        keyLower.includes('-link') || keyLower.includes('-load-previous')) {
        console.warn(`[BVA-DOM] RECHAZADO: "${uniqueKey}" parece ser un botón/link, no un campo llenable`)
        return false
      }

      // Estrategia 1: Usar scanner.inputMap (ya mapeado durante scan)
      // Este es el más confiable porque el scanner ya identificó el input correcto
      el = this.scanner.getInput(uniqueKey)
      if (el) {
        const elTag = el.tagName.toLowerCase()
        console.log(`[BVA-DOM] SCANNER-MAP: "${uniqueKey}" → <${elTag}> testid="${el.getAttribute('data-testid') || 'none'}"`)
        // Si el scanner retornó un div/contenedor, buscar input dentro
        if (elTag === 'div' || elTag === 'span' || elTag === 'section') {
          const innerInput = this._findBestInput(el)
          if (innerInput) {
            console.log(`[BVA-DOM] SCANNER-MAP redirigido a <${innerInput.tagName.toLowerCase()}>`)
            el = innerInput
          }
        }
      }

      // Estrategia 2: Buscar contenedor por data-testid y el input CORRECTO dentro
      if (!el || el.tagName.toLowerCase() === 'div') {
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`)
        if (container) {
          const tag = container.tagName.toLowerCase()

          // Si el contenedor ya ES un input/textarea/select, usarlo directo
          if (tag === 'textarea' || tag === 'select' || tag === 'input') {
            el = container
            console.log(`[BVA-DOM] CONTAINER-IS-INPUT: "${uniqueKey}" → <${tag}>`)
          } else {
            // Buscar el mejor input dentro del contenedor
            const bestInput = this._findBestInput(container)
            if (bestInput) {
              el = bestInput
              console.log(`[BVA-DOM] CONTAINER-CHILD: "${uniqueKey}" → <${bestInput.tagName.toLowerCase()}> testid="${bestInput.getAttribute('data-testid') || 'none'}"`)
            } else {
              console.warn(`[BVA-DOM] Container "${uniqueKey}" no tiene inputs útiles`)
            }
          }
        }
      }

      // Estrategia 3: Buscar por data-testid parcial (sin -badge-field suffix)
      if (!el) {
        const baseName = uniqueKey.replace(/-badge-field$/, '').replace(/-badge$/, '')
        const allEls = document.querySelectorAll(`[data-testid*="${baseName}"]`)
        for (const candidate of allEls) {
          const candidateTag = candidate.tagName.toLowerCase()
          if (candidateTag === 'textarea' || candidateTag === 'input') {
            el = candidate
            console.log(`[BVA-DOM] PARTIAL-MATCH: "${uniqueKey}" → <${candidateTag}> testid="${candidate.getAttribute('data-testid')}"`)
            break
          }
          // Check inside the candidate
          const inner = this._findBestInput(candidate)
          if (inner) {
            el = inner
            console.log(`[BVA-DOM] PARTIAL-MATCH-INNER: "${uniqueKey}" → <${inner.tagName.toLowerCase()}>`)
            break
          }
        }
      }

      // Estrategia 4: Búsqueda por proximidad (hermanos/primos)
      // En Biowel el data-testid único puede estar en un div hermano del textarea
      if (!el) {
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`)
        if (container) {
          const nearby = this._findNearbyInput(container)
          if (nearby) {
            el = nearby
            console.log(`[BVA-DOM] NEARBY-SEARCH: "${uniqueKey}" → <${nearby.tagName.toLowerCase()}>`)
          }
        }
      }

      if (!el) {
        console.warn(`[BVA-DOM] NO ENCONTRADO: "${uniqueKey}"`)
        return false
      }

      // Verificación final: asegurar que es un elemento escribible
      const finalTag = el.tagName.toLowerCase()
      if (finalTag !== 'textarea' && finalTag !== 'input' && finalTag !== 'select') {
        const innerInput = this._findBestInput(el)
        if (innerInput) {
          console.log(`[BVA-DOM] Final redirect: <${finalTag}> → <${innerInput.tagName.toLowerCase()}>`)
          el = innerInput
        } else {
          console.warn(`[BVA-DOM] Elemento final no escribible: <${finalTag}> para "${uniqueKey}"`)
          return false
        }
      }

      console.log(`[BVA-DOM] ESCRIBIENDO: "${uniqueKey}" → <${el.tagName.toLowerCase()}> testid="${el.getAttribute('data-testid') || 'none'}" value="${String(value).substring(0, 60)}"`)

      // Detectar si es un select buscable (combobox con búsqueda async)
      // Criterios: el data-testid termina en "-select" Y el contenedor tiene
      // clase "select" con un input de búsqueda dentro
      const isSearchableSelect = this._isSearchableSelect(uniqueKey, el)
      if (isSearchableSelect) {
        console.log(`[BVA-DOM] Detectado searchable select para "${uniqueKey}"`)
        const container = document.querySelector(`[data-testid="${uniqueKey}"]`) || el.closest('.select, [class*="select"]') || el.parentElement
        try {
          return this._setSearchableSelectValue(container, el, String(value))
        } catch (error) {
          console.error(`[BVA-DOM] Error en searchable select ${uniqueKey}:`, error)
          return false
        }
      }

      const fieldType = this._inferType(el)

      try {
        switch (fieldType) {
          case 'select':
            return this._setSelectValue(el, String(value))
          case 'checkbox':
            return this._setCheckboxValue(el, value)
          case 'radio':
            return this._setRadioValue(el, String(value))
          default:
            return this._setInputValue(el, String(value))
        }
      } catch (error) {
        console.error(`[BVA-DOM] Error llenando ${uniqueKey}:`, error)
        return false
      }
    }

    /**
     * Encuentra el mejor input/textarea/select dentro de un contenedor.
     * Prioridad: textarea visible > input[type=text] visible > input no hidden > select
     * Excluye checkboxes, radios, hidden inputs.
     */
    _findBestInput(container) {
      if (!container) return null

      // Prioridad 1: textarea (más común para campos de texto largo)
      const textareas = container.querySelectorAll('textarea')
      for (const ta of textareas) {
        if (ta.offsetParent !== null || ta.offsetHeight > 0) return ta // visible
      }
      if (textareas.length > 0) return textareas[0] // fallback first textarea

      // Prioridad 2: input[type=text] o input sin type (default text)
      const textInputs = container.querySelectorAll('input[type="text"], input:not([type])')
      for (const inp of textInputs) {
        if (inp.offsetParent !== null || inp.offsetHeight > 0) return inp
      }
      if (textInputs.length > 0) return textInputs[0]

      // Prioridad 3: input numérico
      const numInputs = container.querySelectorAll('input[type="number"]')
      if (numInputs.length > 0) return numInputs[0]

      // Prioridad 4: cualquier input que no sea checkbox/radio/hidden
      const otherInputs = container.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')
      if (otherInputs.length > 0) return otherInputs[0]

      // Prioridad 5: select
      const selects = container.querySelectorAll('select')
      if (selects.length > 0) return selects[0]

      return null
    }

    /**
     * Detecta si un campo es un select buscable (combobox con búsqueda async).
     * Ej: CIE-10 diagnosis select → <div class="select"><input class="select-input"></div>
     *
     * Criterios:
     * 1. El data-testid termina en "-select"
     * 2. El contenedor o un ancestro tiene class "select"
     * 3. El elemento actual es un input (no textarea ni select nativo)
     */
    _isSearchableSelect(uniqueKey, el) {
      // Criterio 1: data-testid termina en "-select"
      if (!uniqueKey.endsWith('-select')) return false

      // Criterio 2: el elemento es un input text (no textarea, no select nativo)
      const tag = el.tagName.toLowerCase()
      if (tag !== 'input') return false

      // Criterio 3: tiene un contenedor con clase "select" o similar
      const container = document.querySelector(`[data-testid="${uniqueKey}"]`)
      if (container) {
        const classList = (container.className || '').toLowerCase()
        if (classList.includes('select')) return true
      }

      // Fallback: ancestro con clase select
      const selectParent = el.closest('.select, [class*="select-"]')
      if (selectParent) return true

      return false
    }

    _inferType(el) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'textarea') return 'textarea'
      if (tag === 'select') return 'select'
      if (tag === 'input') {
        if (el.type === 'checkbox') return 'checkbox'
        if (el.type === 'radio') return 'radio'
        if (el.type === 'number') return 'number'
      }
      return 'text'
    }

    getFilledFields() {
      return Object.fromEntries(this.filledFields)
    }

    _setInputValue(el, value) {
      // Si el elemento ya es un input/textarea, usarlo directamente
      let input = el
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
        input = this._findInput(el)
      }
      if (!input) {
        console.warn(`[BVA-DOM] No se encontró input dentro de`, el)
        return false
      }

      console.log(`[BVA-DOM] Escribiendo en: <${input.tagName.toLowerCase()}> data-testid="${input.getAttribute('data-testid') || 'none'}"`)

      const setter = input.tagName.toLowerCase() === 'textarea'
        ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

      if (setter) {
        setter.call(input, value)
      } else {
        input.value = value
      }

      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      this._highlight(input)
      return true
    }

    _setSelectValue(el, value) {
      if (el.tagName.toLowerCase() === 'select') {
        const option = Array.from(el.options).find(
          opt => opt.value.toLowerCase() === value.toLowerCase() ||
            opt.textContent.toLowerCase().includes(value.toLowerCase())
        )
        if (option) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
          if (setter) setter.call(el, option.value)
          else el.value = option.value
          el.dispatchEvent(new Event('change', { bubbles: true }))
          this._highlight(el)
          return true
        }
      }

      // MUI Select
      const selectInput = el.querySelector('input[role="combobox"], input') || el
      if (selectInput instanceof HTMLInputElement) {
        return this._setInputValue(selectInput, value)
      }

      return false
    }

    /**
     * Handler especial para selects buscables (combobox con búsqueda async).
     * Ej: CIE-10 diagnosis select en Biowel.
     *
     * Flujo:
     * 1. Escribe el texto de búsqueda en el input
     * 2. Dispara eventos input/change para activar la búsqueda
     * 3. Espera a que aparezcan opciones en el dropdown
     * 4. Selecciona la primera opción que matchee (click)
     *
     * Si no encuentra opciones tras esperar, deja el texto escrito
     * para que el usuario seleccione manualmente.
     */
    _setSearchableSelectValue(container, inputEl, value) {
      console.log(`[BVA-DOM] SearchableSelect: escribiendo "${value}" para buscar opciones...`)

      // Paso 1: Focus en el input para abrir el dropdown
      inputEl.focus()
      inputEl.dispatchEvent(new Event('focus', { bubbles: true }))

      // Paso 2: Escribir el valor de búsqueda
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setter) {
        setter.call(inputEl, value)
      } else {
        inputEl.value = value
      }

      // Paso 3: Disparar eventos para activar la búsqueda del framework
      inputEl.dispatchEvent(new Event('input', { bubbles: true }))
      inputEl.dispatchEvent(new Event('change', { bubbles: true }))
      // KeyUp simula typing real que muchos frameworks necesitan
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }))
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }))

      this._highlight(inputEl)

      // Paso 4: Esperar a que aparezcan opciones y seleccionar la primera
      // Usamos múltiples intentos con delay creciente para dar tiempo a la API
      const maxAttempts = 5
      const delays = [200, 400, 600, 1000, 1500] // ms

      const trySelectOption = (attempt) => {
        if (attempt >= maxAttempts) {
          console.warn(`[BVA-DOM] SearchableSelect: no se encontraron opciones tras ${maxAttempts} intentos. Texto dejado en input para selección manual.`)
          return
        }

        setTimeout(() => {
          // Buscar opciones dentro del contenedor o en un dropdown/portal global
          let options = container.querySelectorAll('.select-option, [role="option"], li[class*="option"]')

          // Si no hay dentro del contenedor, buscar en portals/dropdowns globales
          if (!options.length) {
            options = document.querySelectorAll(
              '.select-dropdown [role="option"], ' +
              '.select-menu [role="option"], ' +
              '[class*="select"] [role="option"], ' +
              '[class*="dropdown"] li, ' +
              '[class*="listbox"] [role="option"], ' +
              '.select-option'
            )
          }

          // Filtrar opciones visibles que NO sean "Seleccionar..." o placeholders
          const validOptions = Array.from(options).filter(opt => {
            const text = (opt.textContent || '').trim().toLowerCase()
            const isVisible = opt.offsetParent !== null || opt.offsetHeight > 0
            const isPlaceholder = text === 'seleccionar...' || text === 'seleccionar' || text === ''
            return isVisible && !isPlaceholder
          })

          if (validOptions.length > 0) {
            // Buscar la que mejor matchee con el valor
            const bestMatch = validOptions.find(opt =>
              (opt.textContent || '').toLowerCase().includes(value.toLowerCase())
            ) || validOptions[0] // fallback: primera opción válida

            console.log(`[BVA-DOM] SearchableSelect: seleccionando opción "${(bestMatch.textContent || '').trim()}"`)
            bestMatch.click()
            bestMatch.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            bestMatch.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
            this._highlight(container)
            return
          }

          // Reintentar
          console.log(`[BVA-DOM] SearchableSelect: intento ${attempt + 1}/${maxAttempts}, no hay opciones aún...`)
          trySelectOption(attempt + 1)
        }, delays[attempt])
      }

      trySelectOption(0)
      return true
    }

    _setCheckboxValue(el, value) {
      // 1. Intentar encontrar un input real
      const checkbox = this._findInput(el)

      // 2. Si no hay input, ver si el elemento mismo tiene roles de toggle
      const role = el.getAttribute('role')
      const isSwitch = role === 'switch' || role === 'checkbox' || el.tagName.toLowerCase() === 'button'

      // Convertir value a booleano robusto
      const boolVal = (value === true || value === 'true' || value === '1' || value === 'si' || value === 'sí')

      if (checkbox) {
        console.log(`[BVA-DOM] Checkbox: current=${checkbox.checked}, target=${boolVal}`)
        if (checkbox.checked !== boolVal) {
          checkbox.click()
          this._highlight(el)
        }
        return true
      } else if (isSwitch) {
        // Para componentes tipo MUI/headless UI que usan aria-checked
        const currentChecked = el.getAttribute('aria-checked') === 'true'
        console.log(`[BVA-DOM] Switch component: current=${currentChecked}, target=${boolVal}`)
        if (currentChecked !== boolVal) {
          el.click()
          this._highlight(el)
        }
        return true
      }
      return false
    }

    _setRadioValue(el, value) {
      const name = el.name || el.querySelector('input')?.name
      if (!name) return false
      const target = document.querySelector(`input[name="${name}"][value="${value}"]`)
      if (target) {
        target.click()
        this._highlight(target)
        return true
      }
      return false
    }

    _findInput(el) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el
      return el.querySelector('input, textarea')
    }

    /**
     * Busca un input/textarea/select cerca de un contenedor (hermanos, primos).
     * Misma lógica que DOMScanner._findNearbyInput.
     */
    _findNearbyInput(container) {
      const INPUT_SELECTOR = 'textarea, input:not([type="hidden"]), select'

      // 1. Hijo directo
      let input = container.querySelector(INPUT_SELECTOR)
      if (input) return input

      // 2. Buscar en el padre inmediato (hermanos del contenedor)
      const parent = container.parentElement
      if (parent) {
        input = parent.querySelector(INPUT_SELECTOR)
        if (input) return input
      }

      // 3. Subir al contenedor de columna y buscar
      const col = container.closest('[class*="col"]')
      if (col) {
        input = col.querySelector(INPUT_SELECTOR)
        if (input) return input
      }

      return null
    }

    _highlight(el) {
      const target = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        ? el : (el.querySelector('input, select, textarea') || el)

      // Asegurar que el campo sea visible y tenga foco
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.focus()
      } catch (e) {
        console.warn('[BVA-DOM] Error al enfocar/scroll:', e)
      }

      target.style.transition = 'box-shadow 0.3s, border-color 0.3s'
      target.style.boxShadow = `0 0 0 4px rgba(59, 130, 246, 0.5)` // Azul más visible para "selección"
      target.style.borderColor = '#3b82f6'

      setTimeout(() => {
        target.style.boxShadow = ''
        target.style.borderColor = ''
      }, 2000)
    }

    _setInputValue(el, value) {
      // ... anterior logic ...
      let input = el
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
        input = this._findInput(el)
      }
      if (!input) return false

      // ENFOCAR antes de escribir
      input.focus()

      const setter = input.tagName.toLowerCase() === 'textarea'
        ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

      if (setter) {
        setter.call(input, value)
      } else {
        input.value = value
      }

      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('blur', { bubbles: true })) // Blur ayuda a cerrar dropdowns reactivos

      this._highlight(input)
      return true
    }
  }

  // ============================================
  // VoiceRecorder - Captura micrófono como PCM16
  // Envía audio raw linear16 a 16kHz para Deepgram
  // Incluye resampling si el navegador no soporta 16kHz nativo
  // ============================================
  const TARGET_SAMPLE_RATE = 16000

  class VoiceRecorder {
    constructor() {
      this.stream = null
      this.audioContext = null
      this.sourceNode = null
      this.processorNode = null
      this.isRecording = false
    }

    async start(onDataAvailable) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
        })

        // NO forzar sampleRate — usar tasa nativa del sistema para máxima compatibilidad
        // En Edge forzar 16kHz causa que onaudioprocess no se dispare
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()

        const actualRate = this.audioContext.sampleRate
        // Siempre calcular ratio de resample (nativo → 16kHz)
        const resampleRatio = actualRate / TARGET_SAMPLE_RATE

        console.log(`[BVA-Recorder] AudioContext nativo: ${actualRate}Hz → resample a ${TARGET_SAMPLE_RATE}Hz (ratio ${resampleRatio.toFixed(2)})`)

        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)

        // Buffer 2048 = ~42ms a 48kHz (menor latencia que 4096)
        const bufferSize = 2048
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

        let processCount = 0
        this.processorNode.onaudioprocess = (event) => {
          if (!this.isRecording) return

          processCount++
          const float32Input = event.inputBuffer.getChannelData(0)

          // Log para verificar que onaudioprocess funciona
          if (processCount <= 3 || processCount % 50 === 0) {
            const maxVal = Math.max(...Array.from(float32Input.slice(0, 100)).map(Math.abs))
            console.log(`[BVA-Recorder] audioprocess #${processCount}, samples: ${float32Input.length}, maxAmp: ${maxVal.toFixed(4)}`)
          }

          // Downsample de tasa nativa → 16kHz
          let float32
          if (resampleRatio > 1) {
            const outputLength = Math.floor(float32Input.length / resampleRatio)
            float32 = new Float32Array(outputLength)
            for (let i = 0; i < outputLength; i++) {
              float32[i] = float32Input[Math.floor(i * resampleRatio)]
            }
          } else {
            float32 = float32Input
          }

          // Float32 → Int16 (PCM linear16)
          const pcm16 = new Int16Array(float32.length)
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]))
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
          }

          const blob = new Blob([pcm16.buffer], { type: 'application/octet-stream' })
          onDataAvailable(blob)
        }

        this.sourceNode.connect(this.processorNode)
        this.processorNode.connect(this.audioContext.destination)

        this.isRecording = true
        console.log(`[BVA-Recorder] Grabación iniciada (${actualRate}Hz nativo → ${TARGET_SAMPLE_RATE}Hz PCM16)`)
        return true
      } catch (error) {
        console.error('[BVA-Recorder] Error:', error)
        alert(`Error micrófono: ${error.message}`)
        return false
      }
    }

    stop() {
      this.isRecording = false
      try { this.processorNode?.disconnect() } catch (e) { }
      try { this.sourceNode?.disconnect() } catch (e) { }
      try { this.audioContext?.close() } catch (e) { }
      this.stream?.getTracks().forEach(t => t.stop())
      this.processorNode = null
      this.sourceNode = null
      this.audioContext = null
      this.stream = null
    }
  }

  // ============================================
  // Widget UI - Interfaz flotante
  // ============================================
  function createWidget() {
    const container = document.createElement('div')
    container.id = 'biowel-voice-widget'
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
          <span class="bva-title">Dictado Medico</span>
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
            Iniciar Dictado
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
    `
    return container
  }

  // ============================================
  // Core - Motor principal
  // ============================================
  function init() {
    // Evitar inicialización múltiple
    if (document.getElementById('biowel-voice-widget')) {
      console.log('[BVA] Widget ya existe, evitando duplicado')
      return
    }

    const scanner = new DOMScanner()
    const manipulator = new DOMManipulator(scanner)
    const recorder = new VoiceRecorder()
    let ws = null
    let accumulatedText = ''

    // Escanear campos
    const fields = scanner.scan()

    // Crear e inyectar widget
    const widget = createWidget()
    document.body.appendChild(widget)

    // Referencias UI
    const panel = widget.querySelector('#bvaPanel')
    const startBtn = widget.querySelector('#bvaStartBtn')
    const stopBtn = widget.querySelector('#bvaStopBtn')
    const minimizeBtn = widget.querySelector('#bvaMinimize')
    const fab = widget.querySelector('#bvaFab')
    const transcript = widget.querySelector('#bvaTranscript')
    const logContainer = widget.querySelector('#bvaLog')
    const dot = widget.querySelector('#bvaDot')
    const statusText = widget.querySelector('#bvaStatusText')
    const fieldsCount = widget.querySelector('#bvaFieldsCount')

    fieldsCount.textContent = `${fields.length} campos detectados con data-testid`

    // ---- Modal de campos ----
    const exportBtn = widget.querySelector('#bvaExportFields')
    const fieldsModal = widget.querySelector('#bvaFieldsModal')
    const fieldsOverlay = widget.querySelector('#bvaFieldsOverlay')
    const modalClose = widget.querySelector('#bvaModalClose')
    const copyFieldsBtn = widget.querySelector('#bvaCopyFields')
    const copyCSVBtn = widget.querySelector('#bvaCopyCSV')
    const downloadBtn = widget.querySelector('#bvaDownloadFields')
    const tableContainer = widget.querySelector('#bvaFieldsTableContainer')

    function showFieldsModal() {
      // Generar tabla
      let html = `<table class="bva-fields-table">
        <thead><tr>
          <th>#</th>
          <th>data-testid</th>
          <th>Label</th>
          <th>Tipo</th>
          <th>Ojo</th>
          <th>Sección</th>
          <th>Opciones</th>
        </tr></thead><tbody>`

      fields.forEach((f, i) => {
        html += `<tr>
          <td>${i + 1}</td>
          <td class="testid">${escapeHtml(f.data_testid)}</td>
          <td>${escapeHtml(f.label || '-')}</td>
          <td>${escapeHtml(f.field_type)}</td>
          <td>${escapeHtml(f.eye || '-')}</td>
          <td>${escapeHtml(f.section || '-')}</td>
          <td>${f.options?.length ? escapeHtml(f.options.join(', ')) : '-'}</td>
        </tr>`
      })
      html += '</tbody></table>'
      tableContainer.innerHTML = html

      fieldsModal.classList.add('visible')
      fieldsOverlay.classList.add('visible')
    }

    function hideFieldsModal() {
      fieldsModal.classList.remove('visible')
      fieldsOverlay.classList.remove('visible')
    }

    exportBtn.addEventListener('click', showFieldsModal)
    fieldsCount.addEventListener('click', showFieldsModal)
    modalClose.addEventListener('click', hideFieldsModal)
    fieldsOverlay.addEventListener('click', hideFieldsModal)

    copyFieldsBtn.addEventListener('click', () => {
      const json = JSON.stringify(fields, null, 2)
      navigator.clipboard.writeText(json).then(() => {
        copyFieldsBtn.textContent = 'Copiado!'
        setTimeout(() => copyFieldsBtn.textContent = 'Copiar JSON', 2000)
      })
    })

    copyCSVBtn.addEventListener('click', () => {
      const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`
      let csv = 'data_testid,label,field_type,eye,section,options\n'
      fields.forEach(f => {
        csv += `${esc(f.data_testid)},${esc(f.label)},${esc(f.field_type)},${esc(f.eye)},${esc(f.section)},${esc(f.options?.join('; '))}\n`
      })
      navigator.clipboard.writeText(csv).then(() => {
        copyCSVBtn.textContent = 'Copiado!'
        setTimeout(() => copyCSVBtn.textContent = 'Copiar CSV', 2000)
      })
    })

    downloadBtn.addEventListener('click', () => {
      const json = JSON.stringify(fields, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `biowel-fields-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    })

    // ---- Funciones de UI ----
    function setDot(state) {
      dot.classList.remove('connected', 'recording')
      if (state === 'connected') { dot.classList.add('connected'); statusText.textContent = 'Conectado' }
      else if (state === 'recording') { dot.classList.add('recording'); statusText.textContent = 'Grabando...' }
      else { statusText.textContent = 'Desconectado' }
    }

    function addLog(type, message) {
      const colors = { transcript: '#6b7280', decision: '#3b82f6', fill: '#22c55e', ignore: '#f59e0b' }
      const icons = { transcript: '', decision: '', fill: '', ignore: '⏭' }
      const entry = document.createElement('div')
      entry.style.cssText = `font-size:11px;padding:3px 6px;border-left:3px solid ${colors[type] || '#6b7280'};margin-bottom:2px;color:#374151;background:${type === 'fill' ? '#f0fdf4' : 'transparent'};border-radius:0 4px 4px 0;`
      entry.textContent = `${icons[type] || '•'} ${message}`
      logContainer.appendChild(entry)
      logContainer.scrollTop = logContainer.scrollHeight
      while (logContainer.children.length > 50) logContainer.removeChild(logContainer.firstChild)
    }

    function setTranscript(content) {
      transcript.textContent = content
      transcript.scrollTop = transcript.scrollHeight
    }

    // ---- WebSocket ----
    function connectWS() {
      return new Promise((resolve, reject) => {
        ws = new WebSocket(CONFIG.BACKEND_WS)
        ws.onopen = () => { setDot('connected'); addLog('decision', 'Conectado al backend'); resolve() }
        ws.onerror = (e) => { setDot('disconnected'); reject(e) }
        ws.onclose = () => { setDot('disconnected'); addLog('decision', 'Desconectado') }
        ws.onmessage = (event) => {
          try { handleMessage(JSON.parse(event.data)) }
          catch (e) { console.error('[BVA] Error parseando mensaje WS:', e) }
        }
      })
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'partial_transcription':
          transcript.innerHTML = `<span>${escapeHtml(accumulatedText)}</span><span style="color:#9ca3af;font-style:italic"> ${escapeHtml(msg.text || '')}</span>`
          break

        case 'final_segment':
          accumulatedText += (accumulatedText ? ' ' : '') + msg.text
          setTranscript(accumulatedText)
          addLog('transcript', msg.text)
          break

        case 'transcription':
          setTranscript(msg.text)
          break

        case 'partial_autofill':
          if (msg.items?.length) {
            console.log('[BVA-Autofill] partial_autofill recibido:', JSON.stringify(msg.items))
            for (const item of msg.items) {
              console.log(`[BVA-Autofill] → key="${item.unique_key}" value="${String(item.value).substring(0, 80)}" conf=${item.confidence}`)
            }
            const filled = manipulator.applyAutofill(msg.items)
            if (filled.length > 0) {
              const sourceSnippet = (msg.source_text || '').substring(0, 40)
              addLog('fill', `${filled.join(', ')} ← "${sourceSnippet}"`)
            } else {
              console.warn('[BVA-Autofill] Ningún campo fue llenado de:', msg.items.map(i => i.unique_key))
              addLog('ignore', `Campos no encontrados: ${msg.items.map(i => i.unique_key).join(', ')}`)
            }
          }
          break

        case 'autofill_data':
          if (msg.data) {
            console.log('[BVA-Autofill] autofill_data recibido:', JSON.stringify(msg.data))
            const items = Object.entries(msg.data).map(([key, value]) => ({
              unique_key: key, value, confidence: 0.9
            }))
            const filled = manipulator.applyAutofill(items)
            if (filled.length > 0) {
              addLog('fill', `LLM final: ${filled.join(', ')}`)
            } else {
              console.warn('[BVA-Autofill] LLM final: ningún campo llenado de:', Object.keys(msg.data))
            }
          }
          break

        case 'info':
          if (msg.message?.includes('casual')) {
            addLog('ignore', msg.message)
          } else {
            addLog('decision', msg.message)
          }
          break

        case 'error':
          addLog('decision', `Error: ${msg.message}`)
          console.error('[BVA] Error:', msg.message)
          break
      }
    }

    let audioChunkCount = 0
    let totalBytesSent = 0

    function sendAudioChunk(blob) {
      if (audioChunkCount < 3) {
        console.log(`[BVA-Audio] sendAudioChunk llamado, blob size: ${blob.size}, ws state: ${ws?.readyState}, OPEN=${WebSocket.OPEN}`)
      }
      blob.arrayBuffer().then(buffer => {
        if (ws?.readyState !== WebSocket.OPEN) {
          if (audioChunkCount < 3) console.warn(`[BVA-Audio] WS no abierto (state: ${ws?.readyState})`)
          return
        }

        const bytes = new Uint8Array(buffer)
        // Convertir a base64
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)

        ws.send(JSON.stringify({ type: 'audio_chunk', data: base64 }))

        audioChunkCount++
        totalBytesSent += bytes.length
        if (audioChunkCount % 20 === 0) {
          console.log(`[BVA-Audio] ${audioChunkCount} chunks enviados, ${(totalBytesSent / 1024).toFixed(1)}KB total, último: ${bytes.length} bytes`)
        }
      }).catch(err => {
        console.error('[BVA-Audio] Error procesando chunk:', err)
      })
    }

    // ---- Botones ----
    startBtn.addEventListener('click', async () => {
      try {
        accumulatedText = ''
        setTranscript('')
        audioChunkCount = 0
        totalBytesSent = 0

        if (!ws || ws.readyState !== WebSocket.OPEN) {
          await connectWS()
        }

        // Re-escanear campos (por si la página cambió)
        const freshFields = scanner.scan()
        fieldsCount.textContent = `${freshFields.length} campos detectados con data-testid`

        // Enviar estructura de campos al backend
        ws.send(JSON.stringify({
          type: 'biowel_form_structure',
          fields: freshFields,
          already_filled: manipulator.getFilledFields(),
        }))

        // Iniciar grabación
        const success = await recorder.start(sendAudioChunk)
        if (success) {
          startBtn.style.display = 'none'
          stopBtn.style.display = 'flex'
          panel.classList.add('recording')
          setDot('recording')
          addLog('decision', 'Dictado iniciado')
        }
      } catch (error) {
        console.error('[BVA] Error al iniciar:', error)
        addLog('decision', `Error: ${error.message}`)
      }
    })

    stopBtn.addEventListener('click', () => {
      recorder.stop()
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end_stream' }))
      }
      stopBtn.style.display = 'none'
      startBtn.style.display = 'flex'
      panel.classList.remove('recording')
      setDot('connected')
      addLog('decision', 'Dictado detenido')
    })

    minimizeBtn.addEventListener('click', () => {
      panel.classList.add('minimized')
      fab.classList.add('visible')
    })

    fab.addEventListener('click', () => {
      panel.classList.remove('minimized')
      fab.classList.remove('visible')
    })

    console.log('[BVA] Biowel Voice Assistant inicializado')
  }

  // ============================================
  // Arranque
  // ============================================
  waitForBiowelPage()

})()
