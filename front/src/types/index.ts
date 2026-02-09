// ============================================
// Tipos basados en los modelos Pydantic del backend
// ============================================

// Opciones de campos select/radio
export interface FormFieldOption {
  value: string
  text: string
}

// Estructura de un campo del formulario
export interface FormField {
  name: string
  id?: string
  label: string
  type: string
  required: boolean
  selector: string
  options?: FormFieldOption[]
}

// Estructura completa del formulario
export interface FormStructure {
  form_id: string
  fields: FormField[]
}

// Mapeo de campo extraído por el LLM
export interface FieldMapping {
  field_name: string
  value: string | number | boolean
  confidence: number
}

// Resultado de validación
export interface ValidationResult {
  is_valid: boolean
  missing_fields: string[]
  filled_fields: string[]
  errors: string[]
}

// ============================================
// Mensajes WebSocket
// ============================================

// Tipos de mensajes que envía el cliente
export type ClientMessageType =
  | 'form_structure'
  | 'audio_chunk'
  | 'end_stream'

// Tipos de mensajes que envía el servidor
export type ServerMessageType =
  | 'transcription'
  | 'field_mapped'
  | 'validation_result'
  | 'autofill_data'
  | 'tts_audio'
  | 'error'
  | 'info'

// Mensaje base del cliente
export interface ClientMessage<T extends ClientMessageType, D = unknown> {
  type: T
  data?: D
}

// Mensajes específicos del cliente
export type FormStructureMessage = ClientMessage<'form_structure', FormStructure>
export type AudioChunkMessage = ClientMessage<'audio_chunk', string>
export type EndStreamMessage = ClientMessage<'end_stream'>

// Mensajes del servidor
export interface TranscriptionMessage {
  type: 'transcription'
  text: string
}

export interface FieldMappedMessage {
  type: 'field_mapped'
  field_name: string
}

export interface ValidationResultMessage {
  type: 'validation_result'
  is_valid: boolean
  missing_fields: string[]
  errors: string[]
}

export interface AutofillDataMessage {
  type: 'autofill_data'
  data: Record<string, string | number | boolean>
}

export interface TTSAudioMessage {
  type: 'tts_audio'
  audio_base64: string
  text: string
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

export interface InfoMessage {
  type: 'info'
  message: string
}

// Unión de todos los mensajes del servidor
export type ServerMessage =
  | TranscriptionMessage
  | FieldMappedMessage
  | ValidationResultMessage
  | AutofillDataMessage
  | TTSAudioMessage
  | ErrorMessage
  | InfoMessage

// ============================================
// Tipos del Recorder
// ============================================

export type AudioChunkCallback = (audioBlob: Blob) => void

export interface RecorderState {
  isRecording: boolean
  stream: MediaStream | null
  mediaRecorder: MediaRecorder | null
}

// ============================================
// Tipos de notificaciones
// ============================================

export type NotificationType = 'success' | 'warning' | 'error'
