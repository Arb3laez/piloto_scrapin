import { VoiceWebSocket } from './WebSocketClient'

export class FormController {
  private voiceWS: VoiceWebSocket

  constructor() {
    this.voiceWS = new VoiceWebSocket()
    console.log('FormController instanciado')
  }

  init(): void {
    console.log('Inicializando FormController...')

    this.setupVoiceButtons()
    this.setupDilationToggle()
    this.setupWordCounter()
    this.setupFieldCounter()
    this.setupFormSubmit()

    console.log('Event listeners configurados')
  }

  private setupVoiceButtons(): void {
    const startBtn = document.getElementById('startVoiceBtn') as HTMLButtonElement | null
    const stopBtn = document.getElementById('stopVoiceBtn') as HTMLButtonElement | null

    if (!startBtn || !stopBtn) {
      console.error('No se encontraron los botones de voz')
      return
    }

    console.log('Botones de voz encontrados')

    startBtn.addEventListener('click', async () => {
      console.log('Click en "Iniciar Dictado"')

      try {
        const success = await this.voiceWS.startVoiceInput()

        if (success) {
          console.log('Captura de voz iniciada')
          startBtn.classList.add('hidden')
          stopBtn.classList.remove('hidden')
        } else {
          console.error('No se pudo iniciar la captura')
        }
      } catch (error) {
        console.error('Error al iniciar dictado:', error)
        alert(`Error al iniciar el dictado: ${(error as Error).message}`)
      }
    })

    stopBtn.addEventListener('click', () => {
      console.log('Click en "Detener"')

      try {
        this.voiceWS.stopVoiceInput()
        stopBtn.classList.add('hidden')
        startBtn.classList.remove('hidden')
        console.log('Grabación detenida')
      } catch (error) {
        console.error('Error al detener:', error)
      }
    })
  }

  private setupDilationToggle(): void {
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="requiere_dilatacion"]')

    radios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        const registroSection = document.getElementById('registroSection')
        const motivoSection = document.getElementById('motivoNoDialatacionSection')
        const motivoTextarea = document.getElementById('motivo_no_dilatacion') as HTMLTextAreaElement | null

        if (!registroSection || !motivoSection || !motivoTextarea) return

        if (target.value === 'si') {
          // Sí requiere dilatación
          registroSection.classList.remove('hidden')
          motivoSection.classList.add('hidden')
          motivoTextarea.required = false
          motivoTextarea.value = ''
          console.log('Sección de registro mostrada')
        } else {
          // No requiere dilatación
          registroSection.classList.add('hidden')
          motivoSection.classList.remove('hidden')
          motivoTextarea.required = true
          console.log('Sección de motivo mostrada')
        }
      })
    })
  }

  private setupWordCounter(): void {
    const transcriptionText = document.getElementById('transcriptionText')

    if (!transcriptionText) return

    const observer = new MutationObserver(() => {
      const text = transcriptionText.textContent?.trim() || ''
      const wordCount = text ? text.split(/\s+/).length : 0
      const wordCountEl = document.getElementById('wordCount')

      if (wordCountEl) {
        wordCountEl.textContent = String(wordCount)
      }
    })

    observer.observe(transcriptionText, {
      characterData: true,
      childList: true,
      subtree: true,
    })
  }

  private setupFieldCounter(): void {
    const form = document.getElementById('dilatacionForm') as HTMLFormElement | null

    if (!form) return

    form.addEventListener('input', () => {
      const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input[required], select[required], textarea[required]'
      )

      const filled = Array.from(inputs).filter((input) => {
        if (input instanceof HTMLInputElement && input.type === 'radio') {
          return form.querySelector(`input[name="${input.name}"]:checked`) !== null
        }
        return input.value.trim() !== ''
      }).length

      const fieldsFilledEl = document.getElementById('fieldsFilled')

      if (fieldsFilledEl) {
        fieldsFilledEl.textContent = `${filled}/${inputs.length}`
      }
    })
  }

  private setupFormSubmit(): void {
    const form = document.getElementById('dilatacionForm') as HTMLFormElement | null

    if (!form) return

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      console.log('Formulario enviado')

      const formData = new FormData(form)
      const data = Object.fromEntries(formData)

      console.log('Datos del formulario:', data)
      alert('¡Registro guardado exitosamente!\n\nRevisa la consola para ver los datos.')
    })
  }

  getVoiceWS(): VoiceWebSocket {
    return this.voiceWS
  }
}
