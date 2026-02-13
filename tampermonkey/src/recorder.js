const TARGET_SAMPLE_RATE = 16000;

export class VoiceRecorder {
    constructor() {
        this.stream = null;
        this.audioContext = null;
        this.sourceNode = null;
        this.processorNode = null;
        this.isRecording = false;
    }

    async start(onDataAvailable) {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const actualRate = this.audioContext.sampleRate;
            const resampleRatio = actualRate / TARGET_SAMPLE_RATE;

            console.log(`[BVA-Recorder] AudioContext nativo: ${actualRate}Hz → resample a ${TARGET_SAMPLE_RATE}Hz`);

            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
            const bufferSize = 2048;
            this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            this.processorNode.onaudioprocess = (event) => {
                if (!this.isRecording) return;

                const float32Input = event.inputBuffer.getChannelData(0);
                let float32;
                if (resampleRatio > 1) {
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
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                const blob = new Blob([pcm16.buffer], { type: 'application/octet-stream' });
                onDataAvailable(blob);
            };

            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            this.isRecording = true;
            return true;
        } catch (error) {
            console.error('[BVA-Recorder] Error:', error);
            alert(`Error micrófono: ${error.message}`);
            return false;
        }
    }

    stop() {
        this.isRecording = false;
        try { this.processorNode?.disconnect() } catch (e) { }
        try { this.sourceNode?.disconnect() } catch (e) { }
        try { this.audioContext?.close() } catch (e) { }
        this.stream?.getTracks().forEach(t => t.stop());
        this.processorNode = null;
        this.sourceNode = null;
        this.audioContext = null;
        this.stream = null;
    }
}
