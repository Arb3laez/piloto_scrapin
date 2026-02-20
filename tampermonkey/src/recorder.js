const TARGET_SAMPLE_RATE = 16000;

export class VoiceRecorder {
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
            
            // Solicitar micrófono con configuración simple
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            // Crear contexto de audio
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const actualRate = this.audioContext.sampleRate;
            const resampleRatio = actualRate / TARGET_SAMPLE_RATE;

            console.log(`[BVA-Recorder] AudioContext: ${actualRate}Hz → ${TARGET_SAMPLE_RATE}Hz (ratio: ${resampleRatio.toFixed(2)})`);

            // Crear nodo fuente del micrófono
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
            
            // Usar ScriptProcessor para capturar audio (aunque está deprecado, funciona mejor que nada)
            const bufferSize = 4096;
            this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            // Handler para procesar audio capturado
            let chunkCount = 0;
            this.processorNode.onaudioprocess = (event) => {
                if (!this.isRecording) return;

                const float32Input = event.inputBuffer.getChannelData(0);

                // Remuestrear si es necesario
                let float32;
                if (Math.abs(resampleRatio - 1.0) > 0.01) {
                    // Necesita remuestreo
                    const outputLength = Math.floor(float32Input.length / resampleRatio);
                    float32 = new Float32Array(outputLength);
                    for (let i = 0; i < outputLength; i++) {
                        float32[i] = float32Input[Math.floor(i * resampleRatio)];
                    }
                } else {
                    // Ya está al sample rate correcto
                    float32 = float32Input;
                }

                // Convertir Float32 a PCM16
                const pcm16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    const s = Math.max(-1, Math.min(1, float32[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Enviar como blob
                const blob = new Blob([pcm16.buffer], { type: 'application/octet-stream' });
                console.debug(`[BVA-Recorder] Chunk enviado: ${pcm16.length} samples (${blob.size} bytes)`);
                this.onDataAvailable(blob);
            };

            // Conectar: micrófono → procesador → silenciador → destination
            // ScriptProcessorNode REQUIERE conexión a destination para que onaudioprocess se dispare
            // GainNode con gain=0 evita que el audio se reproduzca por los altavoces (sin eco)
            this.sourceNode.connect(this.processorNode);
            this.muteNode = this.audioContext.createGain();
            this.muteNode.gain.value = 0;
            this.processorNode.connect(this.muteNode);
            this.muteNode.connect(this.audioContext.destination);
            
            this.isRecording = true;
            console.log('[BVA-Recorder] Grabación iniciada');
            return true;

        } catch (error) {
            console.error('[BVA-Recorder] Error al iniciar:', error);
            alert(`Error micrófono: ${error.message}`);
            return false;
        }
    }

    stop() {
        this.isRecording = false;
        console.log('[BVA-Recorder] Grabación detenida');
        
        try { this.processorNode?.disconnect(); } catch (e) { console.debug(e); }
        try { this.muteNode?.disconnect(); } catch (e) { console.debug(e); }
        try { this.sourceNode?.disconnect(); } catch (e) { console.debug(e); }
        try { this.audioContext?.close(); } catch (e) { console.debug(e); }
        try { this.stream?.getTracks().forEach(t => t.stop()); } catch (e) { console.debug(e); }
        
        this.processorNode = null;
        this.muteNode = null;
        this.sourceNode = null;
        this.audioContext = null;
        this.stream = null;
    }
}
