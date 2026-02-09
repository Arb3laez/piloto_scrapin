import type { AudioChunkCallback } from '@/types'

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private stream: MediaStream | null = null
  private isRecording = false

  constructor() {
    console.log('VoiceRecorder instanciado')
  }

  async start(onDataAvailable: AudioChunkCallback): Promise<boolean> {
    try {
      console.log('[START] Solicitando acceso al micrófono...')

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Tu navegador no soporta getUserMedia')
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      console.log('[START] Acceso al micrófono concedido')
      console.log('[START] Audio tracks:', this.stream.getAudioTracks().length)

      this.mediaRecorder = new MediaRecorder(this.stream)

      console.log('[START] MediaRecorder creado')
      console.log('[START] MIME type:', this.mediaRecorder.mimeType)

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        console.log('[EVENT] ondataavailable - size:', event.data.size)

        if (event.data?.size > 0) {
          this.audioChunks.push(event.data)

          try {
            onDataAvailable(event.data)
            console.log('[CALLBACK] Chunk enviado correctamente')
          } catch (error) {
            console.error('[CALLBACK] Error en callback:', error)
          }
        }
      }

      this.mediaRecorder.onstart = () => {
        console.log('[EVENT] MediaRecorder iniciado')
      }

      this.mediaRecorder.onstop = () => {
        console.log('[EVENT] MediaRecorder detenido')
      }

      this.mediaRecorder.onerror = (event) => {
        console.error('[EVENT] Error en MediaRecorder:', event)
      }

      // Iniciar grabación con chunks cada 1000ms
      this.mediaRecorder.start(1000)
      this.isRecording = true

      console.log('[START] Grabación iniciada - Estado:', this.mediaRecorder.state)

      return true
    } catch (error) {
      console.error('[START] Error al iniciar grabación:', error)
      this.handleRecordingError(error as Error)
      return false
    }
  }

  stop(): void {
    console.log('[STOP] Deteniendo grabación...')

    if (this.mediaRecorder && this.isRecording) {
      console.log('[STOP] Estado antes de stop:', this.mediaRecorder.state)

      this.mediaRecorder.stop()

      if (this.stream) {
        this.stream.getTracks().forEach((track) => {
          track.stop()
          console.log('[STOP] Track detenido:', track.kind)
        })
      }

      this.isRecording = false
      console.log('[STOP] Grabación detenida completamente')
    } else {
      console.warn('[STOP] No hay grabación activa')
    }
  }

  reset(): void {
    console.log('[RESET] Reiniciando buffer de audio')
    this.audioChunks = []
  }

  isActive(): boolean {
    return this.isRecording
  }

  private handleRecordingError(error: Error): void {
    const errorMessages: Record<string, string> = {
      NotAllowedError: 'Permiso denegado. Permite el acceso al micrófono.',
      NotFoundError: 'No se encontró ningún micrófono.',
      NotReadableError: 'El micrófono está siendo usado por otra aplicación.',
    }

    const message = errorMessages[error.name] || `Error: ${error.message}`
    alert(message)
  }
}

// ============================================
// Funciones de utilidad para testing
// ============================================

export async function testMicrophone(): Promise<void> {
  console.log('========================================')
  console.log('INICIANDO TEST DE MICRÓFONO')
  console.log('========================================')

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    console.log('Acceso concedido')

    const audioTrack = stream.getAudioTracks()[0]
    console.log('Track settings:', audioTrack.getSettings())

    const recorder = new MediaRecorder(stream)
    let chunkCount = 0
    let totalBytes = 0

    recorder.ondataavailable = (event) => {
      chunkCount++
      totalBytes += event.data.size
      console.log(`CHUNK #${chunkCount}: ${event.data.size} bytes`)
    }

    recorder.onstart = () => {
      console.log('¡GRABACIÓN INICIADA! Habla durante 5 segundos...')
    }

    recorder.start(1000)

    setTimeout(() => {
      recorder.stop()
      stream.getTracks().forEach((track) => track.stop())

      console.log('========================================')
      console.log('RESULTADO:')
      console.log(`Total chunks: ${chunkCount}`)
      console.log(`Total bytes: ${totalBytes}`)

      if (chunkCount === 0) {
        console.error('FALLO: No se recibieron chunks')
      } else if (totalBytes < 1000) {
        console.warn('ADVERTENCIA: Muy pocos datos')
      } else {
        console.log('ÉXITO: Micrófono funcionando')
      }
    }, 5000)
  } catch (error) {
    console.error('ERROR EN TEST:', error)
  }
}

export async function checkDevices(): Promise<void> {
  console.log('Verificando dispositivos...')

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = devices.filter((d) => d.kind === 'audioinput')

    console.log('Micrófonos detectados:', audioInputs.length)
    audioInputs.forEach((device, i) => {
      console.log(`  ${i + 1}. ${device.label || 'Micrófono sin nombre'}`)
    })

    if (audioInputs.length === 0) {
      console.error('NO SE DETECTARON MICRÓFONOS')
    }
  } catch (error) {
    console.error('Error verificando dispositivos:', error)
  }
}
