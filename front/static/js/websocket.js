class VoiceWebSocket {
    constructor() {
        this.ws = null;
        this.recorder = new VoiceRecorder();
        this.isConnected = false;
        this.formStructure = null;
        console.log('🌐 VoiceWebSocket instanciado');
    }

    connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 Conectando a WebSocket...');
            this.ws = new WebSocket('ws://localhost:8000/ws/voice-stream');

            this.ws.onopen = () => {
                console.log('✅ WebSocket conectado');
                this.isConnected = true;
                this.updateConnectionStatus(true);
                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onerror = (error) => {
                console.error('❌ Error WebSocket:', error);
                this.updateConnectionStatus(false);
                reject(error);
            };

            this.ws.onclose = () => {
                console.log('🔌 WebSocket desconectado');
                this.isConnected = false;
                this.updateConnectionStatus(false);
            };
        });
    }

    async startVoiceInput() {
        try {
            console.log('🎬 Iniciando captura de voz...');

            if (!this.isConnected) {
                await this.connect();
            }

            await this.sendFormStructure();

            const success = await this.recorder.start((audioBlob) => {
                this.sendAudioChunk(audioBlob);
            });

            if (success) {
                console.log('✅ Captura de voz iniciada correctamente');
                return true;
            } else {
                throw new Error('No se pudo iniciar la grabación');
            }

        } catch (error) {
            console.error('❌ Error al iniciar voz:', error);
            alert('Error al iniciar el dictado: ' + error.message);
            return false;
        }
    }

    stopVoiceInput() {
        console.log('⏹️ Deteniendo captura de voz...');

        this.recorder.stop();

        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify({ type: 'end_stream' }));
            console.log('📤 Señal de fin enviada al servidor');
        }
    }

    async sendFormStructure() {
        const structure = this.extractFormStructure();
        this.formStructure = structure;

        console.log('📋 [DEBUG] Estructura extraída:', structure);
        console.log('📋 [DEBUG] form_id:', structure.form_id);
        console.log('📋 [DEBUG] fields count:', structure.fields.length);
        console.log('📋 [DEBUG] Primera field:', structure.fields[0]);

        const message = {
            type: 'form_structure',
            data: structure
        };

        console.log('📤 [DEBUG] Mensaje a enviar:', JSON.stringify(message, null, 2));

        this.ws.send(JSON.stringify(message));

        console.log('✅ Estructura del formulario enviada');
    }

    extractFormStructure() {
        const form = document.getElementById('dilatacionForm');
        const fields = [];
        const processedRadioGroups = new Set();

        form.querySelectorAll('input, select, textarea').forEach(element => {
            if (!element.name && !element.id) {
                return;
            }

            if (element.type === 'radio' && processedRadioGroups.has(element.name)) {
                return;
            }

            const label = this.getFieldLabel(element);
            const field = {
                name: element.name || element.id,
                id: element.id || '',
                label: label,
                type: element.type || element.tagName.toLowerCase(),
                required: element.required,
                selector: element.name ? `[name="${element.name}"]` : `#${element.id}`
            };

            if (element.tagName === 'SELECT') {
                field.options = Array.from(element.options)
                    .filter(opt => opt.value)
                    .map(opt => ({
                        value: opt.value,
                        text: opt.textContent.trim()
                    }));
            }

            if (element.type === 'radio') {
                processedRadioGroups.add(element.name);

                const radioGroup = form.querySelectorAll(`input[name="${element.name}"]`);
                field.options = Array.from(radioGroup).map(radio => {
                    const radioLabel = this.getFieldLabel(radio);
                    return {
                        value: radio.value,
                        text: radioLabel
                    };
                });

                const fieldset = element.closest('div');
                const groupLabel = fieldset?.querySelector('label:not([for])');
                if (groupLabel) {
                    field.label = groupLabel.textContent.trim();
                }
            }

            fields.push(field);
        });

        console.log('📋 [DEBUG] Campos extraídos:', fields.length);
        console.log('📋 [DEBUG] Primer campo:', fields[0]);

        return {
            form_id: 'dilatacionForm',
            fields: fields
        };
    }

    getFieldLabel(element) {
        const label = element.labels?.[0] ||
            document.querySelector(`label[for="${element.id}"]`);

        if (label) {
            return label.textContent.trim().replace('*', '').trim();
        }

        const parentLabel = element.closest('label');
        if (parentLabel) {
            return parentLabel.textContent.trim().replace('*', '').trim();
        }

        const container = element.closest('div');
        const containerLabel = container?.querySelector('label');
        if (containerLabel) {
            return containerLabel.textContent.trim().replace('*', '').trim();
        }

        return element.name || element.id || 'Sin etiqueta';
    }

    async sendAudioChunk(audioBlob) {
        try {
            console.log('📤 [WS] Preparando envío de chunk...');
            console.log('📊 [WS] Blob size:', audioBlob.size);

            const reader = new FileReader();

            reader.onloadend = () => {
                const base64Audio = reader.result.split(',')[1];

                console.log('📊 [WS] Base64 generado:', base64Audio.length, 'caracteres');

                if (this.ws && this.isConnected) {
                    this.ws.send(JSON.stringify({
                        type: 'audio_chunk',
                        data: base64Audio
                    }));
                    console.log('✅ [WS] Chunk enviado correctamente');
                } else {
                    console.error('❌ [WS] WebSocket NO conectado');
                }
            };

            reader.onerror = (error) => {
                console.error('❌ [WS] Error leyendo blob:', error);
            };

            reader.readAsDataURL(audioBlob);

        } catch (error) {
            console.error('❌ [WS] Error en sendAudioChunk:', error);
        }
    }

    handleMessage(message) {
        console.log('📨 Mensaje recibido del servidor:', message);

        switch (message.type) {
            case 'transcription':
                this.updateTranscription(message.text);
                break;

            case 'field_mapped':
                this.highlightField(message.field_name);
                break;

            case 'validation_result':
                this.handleValidation(message);
                break;

            case 'autofill_data':
                this.autofillForm(message.data);
                break;

            case 'tts_audio':
                this.playTTSAudio(message.audio_base64);
                break;

            case 'error':
                console.error('❌ Error del servidor:', message.message);
                this.showError(message.message);
                break;

            case 'info':
                console.log('ℹ️ Info del servidor:', message.message);
                break;
        }
    }

    updateTranscription(text) {
        const panel = document.getElementById('transcriptionPanel');
        const textElement = document.getElementById('transcriptionText');

        panel.classList.remove('hidden');
        textElement.textContent = text;

        console.log('📝 Transcripción actualizada:', text);
    }

    highlightField(fieldName) {
        const field = document.querySelector(`[name="${fieldName}"]`);
        if (field) {
            field.classList.add('field-highlight');
            setTimeout(() => {
                field.classList.remove('field-highlight');
            }, 2000);
        }
    }

    handleValidation(validation) {
        if (validation.is_valid) {
            this.showSuccess('✅ Formulario completado correctamente');
        } else {
            const missing = validation.missing_fields.join(', ');
            this.showWarning(`⚠️ Campos faltantes: ${missing}`);
        }
    }

    autofillForm(data) {
        console.log('📝 Auto-llenando formulario:', data);

        Object.entries(data).forEach(([fieldName, value]) => {
            console.log(`🔍 Buscando campo: ${fieldName} = ${value}`);

            const field = document.querySelector(`[name="${fieldName}"]`);

            if (!field) {
                console.warn(`⚠️ Campo no encontrado: ${fieldName}`);
                return;
            }

            console.log(`✅ Campo encontrado: ${fieldName} (${field.type})`);

            try {
                if (field.type === 'radio') {
                    const radio = document.querySelector(`[name="${fieldName}"][value="${value}"]`);
                    if (radio) {
                        radio.checked = true;
                        radio.dispatchEvent(new Event('change', { bubbles: true }));
                        console.log(`✅ Radio marcado: ${fieldName} = ${value}`);
                    } else {
                        console.warn(`⚠️ Radio value no encontrado: ${value}`);
                    }
                } else if (field.type === 'checkbox') {
                    field.checked = Boolean(value);
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log(`✅ Checkbox: ${fieldName} = ${value}`);
                } else if (field.tagName === 'SELECT') {
                    console.log(`🔽 Select con opciones:`, Array.from(field.options).map(o => o.value));

                    let option = Array.from(field.options).find(opt =>
                        opt.value.toLowerCase() === value.toLowerCase()
                    );

                    if (!option) {
                        option = Array.from(field.options).find(opt =>
                            opt.textContent.toLowerCase().includes(value.toLowerCase())
                        );
                    }

                    if (option) {
                        field.value = option.value;
                        field.dispatchEvent(new Event('change', { bubbles: true }));
                        console.log(`✅ Select cambiado: ${fieldName} = ${option.value}`);
                    } else {
                        console.warn(`⚠️ Opción no encontrada en select para: ${value}`);
                    }
                } else {
                    field.value = value;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log(`✅ Campo actualizado: ${fieldName} = ${value}`);
                }

                field.classList.add('field-highlight');
                setTimeout(() => {
                    field.classList.remove('field-highlight');
                }, 2000);

            } catch (error) {
                console.error(`❌ Error llenando campo ${fieldName}:`, error);
            }
        });

        this.showSuccess('✅ Formulario actualizado automáticamente');
        console.log('✅ Auto-fill completado');
    }

    async playTTSAudio(base64Audio) {
        try {
            const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
            await audio.play();
            console.log('🔊 Audio TTS reproducido');
        } catch (error) {
            console.error('❌ Error reproduciendo audio TTS:', error);
        }
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
            const dot = statusEl.querySelector('div');
            const text = statusEl.querySelector('span');

            if (connected) {
                dot.classList.remove('bg-red-400');
                dot.classList.add('bg-green-400');
                text.textContent = 'Sistema Activo';
            } else {
                dot.classList.remove('bg-green-400');
                dot.classList.add('bg-red-400');
                text.textContent = 'Desconectado';
            }
        }
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showWarning(message) {
        this.showNotification(message, 'warning');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        const colors = {
            success: 'bg-green-100 border-green-500 text-green-900',
            warning: 'bg-yellow-100 border-yellow-500 text-yellow-900',
            error: 'bg-red-100 border-red-500 text-red-900'
        };

        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg border-l-4 ${colors[type]} shadow-lg z-50 animate-slideIn`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

window.voiceWS = new VoiceWebSocket();
console.log('✅ VoiceWebSocket cargado correctamente');