class VoiceRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.isRecording = false;
        console.log('🎙️ VoiceRecorder instanciado');
    }

    async start(onDataAvailable) {
        try {
            console.log('🎤 [START] Solicitando acceso al micrófono...');

            // Verificar soporte del navegador
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Tu navegador no soporta getUserMedia');
            }

            // Solicitar acceso al micrófono (configuración simple)
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: true  // Sin restricciones para mayor compatibilidad
            });

            console.log('✅ [START] Acceso al micrófono concedido');
            console.log('📊 [START] Stream:', this.stream);
            console.log('📊 [START] Audio tracks:', this.stream.getAudioTracks().length);

            // Crear MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.stream);

            console.log('✅ [START] MediaRecorder creado');
            console.log('📊 [START] MIME type:', this.mediaRecorder.mimeType);
            console.log('📊 [START] Estado inicial:', this.mediaRecorder.state);

            // Configurar eventos ANTES de iniciar
            this.mediaRecorder.ondataavailable = (event) => {
                console.log('🎵 [EVENT] ondataavailable disparado');
                console.log('📊 [EVENT] event.data:', event.data);
                console.log('📊 [EVENT] event.data.size:', event.data.size);
                console.log('📊 [EVENT] event.data.type:', event.data.type);

                if (event.data && event.data.size > 0) {
                    console.log('📦 [CHUNK] Chunk recibido:', event.data.size, 'bytes');
                    this.audioChunks.push(event.data);

                    if (onDataAvailable) {
                        console.log('📤 [CALLBACK] Llamando callback con chunk...');
                        try {
                            onDataAvailable(event.data);
                            console.log('✅ [CALLBACK] Callback ejecutado correctamente');
                        } catch (error) {
                            console.error('❌ [CALLBACK] Error en callback:', error);
                        }
                    } else {
                        console.warn('⚠️ [CALLBACK] No hay callback definido');
                    }
                } else {
                    console.warn('⚠️ [CHUNK] Chunk vacío o sin datos');
                }
            };

            this.mediaRecorder.onstart = () => {
                console.log('🎙️ [EVENT] MediaRecorder iniciado (onstart)');
            };

            this.mediaRecorder.onstop = () => {
                console.log('🛑 [EVENT] MediaRecorder detenido (onstop)');
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('❌ [EVENT] Error en MediaRecorder:', event);
                console.error('❌ [EVENT] Error.error:', event.error);
            };

            this.mediaRecorder.onpause = () => {
                console.log('⏸️ [EVENT] MediaRecorder pausado');
            };

            this.mediaRecorder.onresume = () => {
                console.log('▶️ [EVENT] MediaRecorder reanudado');
            };

            // Iniciar grabación (chunks cada 1000ms)
            console.log('▶️ [START] Llamando a mediaRecorder.start(1000)...');
            this.mediaRecorder.start(1000);

            this.isRecording = true;

            console.log('✅ [START] mediaRecorder.start() ejecutado');
            console.log('📊 [START] Estado después de start():', this.mediaRecorder.state);
            console.log('📊 [START] isRecording:', this.isRecording);

            return true;

        } catch (error) {
            console.error('❌ [START] Error al iniciar grabación');
            console.error('❌ [START] Error.name:', error.name);
            console.error('❌ [START] Error.message:', error.message);
            console.error('❌ [START] Error completo:', error);

            if (error.name === 'NotAllowedError') {
                alert('⚠️ Permiso denegado. Permite el acceso al micrófono.');
            } else if (error.name === 'NotFoundError') {
                alert('⚠️ No se encontró ningún micrófono.');
            } else if (error.name === 'NotReadableError') {
                alert('⚠️ El micrófono está siendo usado por otra aplicación.');
            } else {
                alert('⚠️ Error: ' + error.message);
            }

            return false;
        }
    }

    stop() {
        console.log('🛑 [STOP] Intentando detener grabación...');

        if (this.mediaRecorder && this.isRecording) {
            console.log('🛑 [STOP] MediaRecorder existe y está grabando');
            console.log('📊 [STOP] Estado antes de stop():', this.mediaRecorder.state);

            this.mediaRecorder.stop();
            console.log('✅ [STOP] mediaRecorder.stop() ejecutado');

            if (this.stream) {
                console.log('🛑 [STOP] Deteniendo tracks del stream...');
                this.stream.getTracks().forEach(track => {
                    track.stop();
                    console.log('🔇 [STOP] Track detenido:', track.kind);
                });
            }

            this.isRecording = false;
            console.log('✅ [STOP] Grabación completamente detenida');
        } else {
            console.warn('⚠️ [STOP] No hay grabación activa para detener');
        }
    }

    reset() {
        console.log('🔄 [RESET] Reiniciando buffer de audio');
        this.audioChunks = [];
        console.log('✅ [RESET] Buffer reiniciado');
    }

    isActive() {
        return this.isRecording;
    }
}

// Exportar globalmente
window.VoiceRecorder = VoiceRecorder;
console.log('✅ VoiceRecorder cargado correctamente');


// ============================================
// FUNCIÓN DE TEST DEL MICRÓFONO
// ============================================
window.testMicrophone = async function () {
    console.log('🧪 ========================================');
    console.log('🧪 INICIANDO TEST DE MICRÓFONO');
    console.log('🧪 ========================================');

    try {
        console.log('🎤 Solicitando acceso al micrófono...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('✅ Acceso concedido');
        console.log('🎤 Stream:', stream);
        console.log('🔊 Audio tracks:', stream.getAudioTracks());

        const audioTrack = stream.getAudioTracks()[0];
        console.log('📊 Track settings:', audioTrack.getSettings());
        console.log('📊 Track state:', audioTrack.readyState);
        console.log('📊 Track enabled:', audioTrack.enabled);

        console.log('\n🎙️ Creando MediaRecorder...');
        const recorder = new MediaRecorder(stream);
        console.log('✅ MediaRecorder creado');
        console.log('📊 Estado inicial:', recorder.state);
        console.log('📊 MIME type:', recorder.mimeType);

        let chunkCount = 0;
        let totalBytes = 0;

        recorder.ondataavailable = (event) => {
            chunkCount++;
            totalBytes += event.data.size;
            console.log(`\n📦 CHUNK #${chunkCount}:`);
            console.log('   Tamaño:', event.data.size, 'bytes');
            console.log('   Tipo:', event.data.type);
            console.log('   Total acumulado:', totalBytes, 'bytes');
        };

        recorder.onstart = () => {
            console.log('\n🎙️ ¡GRABACIÓN INICIADA!');
            console.log('💬 HABLA AHORA durante 5 segundos...');
        };

        recorder.onstop = () => {
            console.log('\n🛑 Grabación detenida');
        };

        recorder.onerror = (event) => {
            console.error('❌ Error en MediaRecorder:', event.error);
        };

        recorder.start(1000);

        setTimeout(() => {
            console.log('\n⏰ Tiempo agotado, deteniendo...');
            recorder.stop();
            stream.getTracks().forEach(track => track.stop());

            console.log('\n🧪 ========================================');
            console.log('🧪 RESULTADO DEL TEST:');
            console.log('🧪 ========================================');
            console.log(`📊 Total chunks recibidos: ${chunkCount}`);
            console.log(`📊 Total bytes capturados: ${totalBytes}`);

            if (chunkCount === 0) {
                console.error('\n❌ FALLO: NO SE RECIBIERON CHUNKS');
                console.error('El micrófono NO está capturando audio');
            } else if (totalBytes < 1000) {
                console.warn('\n⚠️ ADVERTENCIA: Muy pocos datos capturados');
            } else {
                console.log('\n✅ ÉXITO: El micrófono está funcionando correctamente');
            }
        }, 5000);

    } catch (error) {
        console.error('\n❌ ERROR EN TEST:', error);
    }
};

window.checkDevices = async function () {
    console.log('🔍 Verificando dispositivos...\n');
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        console.log('🎤 Micrófonos detectados:', audioInputs.length);
        audioInputs.forEach((device, i) => {
            console.log(`  ${i + 1}. ${device.label || 'Micrófono sin nombre'}`);
        });

        if (audioInputs.length === 0) {
            console.error('\n❌ NO SE DETECTARON MICRÓFONOS');
        }
    } catch (error) {
        console.error('❌ Error verificando dispositivos:', error);
    }
};

console.log('\n✅ Funciones de test cargadas:');
console.log('  - testMicrophone()  → Prueba el micrófono por 5 segundos');
console.log('  - checkDevices()    → Lista todos los dispositivos de audio');