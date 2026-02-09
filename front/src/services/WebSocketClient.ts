import type {
  FormField,
  FormFieldOption,
  FormStructure,
  ServerMessage,
  NotificationType,
} from '@/types'
import { VoiceRecorder } from './VoiceRecorder'

export class VoiceWebSocket {
  private ws: WebSocket | null = null
  private recorder: VoiceRecorder
  private isConnected = false

  constructor() {
    this.recorder = new VoiceRecorder()
    console.log('VoiceWebSocket instanciado')
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Conectando a WebSocket...')

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.hostname}:8000/ws/voice-stream`

      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('WebSocket conectado')
        this.isConnected = true
        this.updateConnectionStatus(true)
        resolve()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data) as ServerMessage
        this.handleMessage(message)
      }

      this.ws.onerror = (error) => {
        console.error('Error WebSocket:', error)
        this.updateConnectionStatus(false)
        reject(error)
      }

      this.ws.onclose = () => {
        console.log('WebSocket desconectado')
        this.isConnected = false
        this.updateConnectionStatus(false)
      }
    })
  }

  async startVoiceInput(): Promise<boolean> {
    try {
      console.log('Iniciando captura de voz...')

      if (!this.isConnected) {
        await this.connect()
      }

      this.sendFormStructure()

      const success = await this.recorder.start((audioBlob) => {
        this.sendAudioChunk(audioBlob)
      })

      if (success) {
        console.log('Captura de voz iniciada correctamente')
        return true
      }

      throw new Error('No se pudo iniciar la grabación')
    } catch (error) {
      console.error('Error al iniciar voz:', error)
      alert(`Error al iniciar el dictado: ${(error as Error).message}`)
      return false
    }
  }

  stopVoiceInput(): void {
    console.log('Deteniendo captura de voz...')

    this.recorder.stop()

    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify({ type: 'end_stream' }))
      console.log('Señal de fin enviada al servidor')
    }
  }

  private sendFormStructure(): void {
    const structure = this.extractFormStructure()

    console.log('[DEBUG] Estructura extraída:', structure)
    console.log('[DEBUG] fields count:', structure.fields.length)

    const message = {
      type: 'form_structure',
      data: structure,
    }

    this.ws?.send(JSON.stringify(message))
    console.log('Estructura del formulario enviada')
  }

  private extractFormStructure(): FormStructure {
    const form = document.getElementById('dilatacionForm') as HTMLFormElement | null

    if (!form) {
      console.error('Formulario no encontrado')
      return { form_id: 'dilatacionForm', fields: [] }
    }

    const fields: FormField[] = []
    const processedRadioGroups = new Set<string>()

    const elements = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea'
    )

    elements.forEach((element) => {
      if (!element.name && !element.id) return

      // Evitar duplicados de radio buttons
      if (element instanceof HTMLInputElement && element.type === 'radio') {
        if (processedRadioGroups.has(element.name)) return
        processedRadioGroups.add(element.name)
      }

      const label = this.getFieldLabel(element)

      const field: FormField = {
        name: element.name || element.id,
        id: element.id || undefined,
        label,
        type: element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase(),
        required: element.required,
        selector: element.name ? `[name="${element.name}"]` : `#${element.id}`,
      }

      // Extraer opciones de select
      if (element instanceof HTMLSelectElement) {
        field.options = Array.from(element.options)
          .filter((opt) => opt.value)
          .map((opt): FormFieldOption => ({
            value: opt.value,
            text: opt.textContent?.trim() || '',
          }))
      }

      // Extraer opciones de radio buttons
      if (element instanceof HTMLInputElement && element.type === 'radio') {
        const radioGroup = form.querySelectorAll<HTMLInputElement>(`input[name="${element.name}"]`)
        field.options = Array.from(radioGroup).map((radio): FormFieldOption => ({
          value: radio.value,
          text: this.getFieldLabel(radio),
        }))

        // Obtener label del grupo
        const fieldset = element.closest('div')
        const groupLabel = fieldset?.querySelector('label:not([for])')
        if (groupLabel) {
          field.label = groupLabel.textContent?.trim() || field.label
        }
      }

      fields.push(field)
    })

    console.log('[DEBUG] Campos extraídos:', fields.length)

    return {
      form_id: 'dilatacionForm',
      fields,
    }
  }

  private getFieldLabel(element: HTMLElement): string {
    // Buscar label asociado
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      const labelFor = element.labels?.[0] || document.querySelector(`label[for="${element.id}"]`)
      if (labelFor) {
        return labelFor.textContent?.trim().replace('*', '').trim() || ''
      }
    }

    // Buscar label padre
    const parentLabel = element.closest('label')
    if (parentLabel) {
      return parentLabel.textContent?.trim().replace('*', '').trim() || ''
    }

    // Buscar label en contenedor
    const container = element.closest('div')
    const containerLabel = container?.querySelector('label')
    if (containerLabel) {
      return containerLabel.textContent?.trim().replace('*', '').trim() || ''
    }

    return (element as HTMLInputElement).name || element.id || 'Sin etiqueta'
  }

  private sendAudioChunk(audioBlob: Blob): void {
    console.log('[WS] Preparando envío de chunk - size:', audioBlob.size)

    const reader = new FileReader()

    reader.onloadend = () => {
      const result = reader.result as string
      const base64Audio = result.split(',')[1]

      console.log('[WS] Base64 generado:', base64Audio.length, 'caracteres')

      if (this.ws && this.isConnected) {
        this.ws.send(
          JSON.stringify({
            type: 'audio_chunk',
            data: base64Audio,
          })
        )
        console.log('[WS] Chunk enviado correctamente')
      } else {
        console.error('[WS] WebSocket NO conectado')
      }
    }

    reader.onerror = (error) => {
      console.error('[WS] Error leyendo blob:', error)
    }

    reader.readAsDataURL(audioBlob)
  }

  private handleMessage(message: ServerMessage): void {
    console.log('Mensaje recibido del servidor:', message)

    switch (message.type) {
      case 'transcription':
        this.updateTranscription(message.text)
        break

      case 'field_mapped':
        this.highlightField(message.field_name)
        break

      case 'validation_result':
        this.handleValidation(message)
        break

      case 'autofill_data':
        this.autofillForm(message.data)
        break

      case 'tts_audio':
        this.playTTSAudio(message.audio_base64)
        break

      case 'error':
        console.error('Error del servidor:', message.message)
        this.showError(message.message)
        break

      case 'info':
        console.log('Info del servidor:', message.message)
        break
    }
  }

  private updateTranscription(text: string): void {
    const panel = document.getElementById('transcriptionPanel')
    const textElement = document.getElementById('transcriptionText')

    if (panel && textElement) {
      panel.classList.remove('hidden')
      textElement.textContent = text
      console.log('Transcripción actualizada:', text)
    }
  }

  private highlightField(fieldName: string): void {
    const field = document.querySelector(`[name="${fieldName}"]`) as HTMLElement | null

    if (field) {
      field.classList.add('field-highlight')
      setTimeout(() => {
        field.classList.remove('field-highlight')
      }, 2000)
    }
  }

  private handleValidation(validation: { is_valid: boolean; missing_fields: string[] }): void {
    if (validation.is_valid) {
      this.showSuccess('Formulario completado correctamente')
    } else {
      const missing = validation.missing_fields.join(', ')
      this.showWarning(`Campos faltantes: ${missing}`)
    }
  }

  private autofillForm(data: Record<string, string | number | boolean>): void {
    console.log('Auto-llenando formulario:', data)

    Object.entries(data).forEach(([fieldName, value]) => {
      console.log(`Buscando campo: ${fieldName} = ${value}`)

      const field = document.querySelector(`[name="${fieldName}"]`) as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null

      if (!field) {
        console.warn(`Campo no encontrado: ${fieldName}`)
        return
      }

      console.log(`Campo encontrado: ${fieldName} (${field.type || field.tagName})`)

      try {
        if (field instanceof HTMLInputElement && field.type === 'radio') {
          const radio = document.querySelector(
            `[name="${fieldName}"][value="${value}"]`
          ) as HTMLInputElement | null

          if (radio) {
            radio.checked = true
            radio.dispatchEvent(new Event('change', { bubbles: true }))
            console.log(`Radio marcado: ${fieldName} = ${value}`)
          } else {
            console.warn(`Radio value no encontrado: ${value}`)
          }
        } else if (field instanceof HTMLInputElement && field.type === 'checkbox') {
          field.checked = Boolean(value)
          field.dispatchEvent(new Event('change', { bubbles: true }))
        } else if (field instanceof HTMLSelectElement) {
          const valueStr = String(value).toLowerCase()

          let option = Array.from(field.options).find(
            (opt) => opt.value.toLowerCase() === valueStr
          )

          if (!option) {
            option = Array.from(field.options).find((opt) =>
              opt.textContent?.toLowerCase().includes(valueStr)
            )
          }

          if (option) {
            field.value = option.value
            field.dispatchEvent(new Event('change', { bubbles: true }))
            console.log(`Select cambiado: ${fieldName} = ${option.value}`)
          } else {
            console.warn(`Opción no encontrada en select para: ${value}`)
          }
        } else {
          field.value = String(value)
          field.dispatchEvent(new Event('input', { bubbles: true }))
          field.dispatchEvent(new Event('change', { bubbles: true }))
          console.log(`Campo actualizado: ${fieldName} = ${value}`)
        }

        // Highlight
        field.classList.add('field-highlight')
        setTimeout(() => {
          field.classList.remove('field-highlight')
        }, 2000)
      } catch (error) {
        console.error(`Error llenando campo ${fieldName}:`, error)
      }
    })

    this.showSuccess('Formulario actualizado automáticamente')
    console.log('Auto-fill completado')
  }

  private async playTTSAudio(base64Audio: string): Promise<void> {
    try {
      const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`)
      await audio.play()
      console.log('Audio TTS reproducido')
    } catch (error) {
      console.error('Error reproduciendo audio TTS:', error)
    }
  }

  private updateConnectionStatus(connected: boolean): void {
    const statusEl = document.getElementById('connectionStatus')

    if (statusEl) {
      const dot = statusEl.querySelector('div')
      const text = statusEl.querySelector('span')

      if (connected) {
        dot?.classList.remove('bg-red-400')
        dot?.classList.add('bg-green-400')
        if (text) text.textContent = 'Sistema Activo'
      } else {
        dot?.classList.remove('bg-green-400')
        dot?.classList.add('bg-red-400')
        if (text) text.textContent = 'Desconectado'
      }
    }
  }

  private showSuccess(message: string): void {
    this.showNotification(message, 'success')
  }

  private showWarning(message: string): void {
    this.showNotification(message, 'warning')
  }

  private showError(message: string): void {
    this.showNotification(message, 'error')
  }

  private showNotification(message: string, type: NotificationType): void {
    const colors: Record<NotificationType, string> = {
      success: 'bg-green-100 border-green-500 text-green-900',
      warning: 'bg-yellow-100 border-yellow-500 text-yellow-900',
      error: 'bg-red-100 border-red-500 text-red-900',
    }

    const notification = document.createElement('div')
    notification.className = `fixed top-4 right-4 p-4 rounded-lg border-l-4 ${colors[type]} shadow-lg z-50 animate-slideIn`
    notification.textContent = message

    document.body.appendChild(notification)

    setTimeout(() => {
      notification.remove()
    }, 5000)
  }

  disconnect(): void {
    this.ws?.close()
  }
}
