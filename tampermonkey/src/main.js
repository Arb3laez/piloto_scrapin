import { CONFIG } from './config';
import { escapeHtml } from './utils';
import { DOMScanner } from './scanner';
import { DOMManipulator } from './manipulator';
import { VoiceRecorder } from './recorder';
import { createWidget } from './ui';

function isBiowelPage() {
    const testIdCount = document.querySelectorAll('[data-testid]').length;
    return testIdCount >= CONFIG.MIN_DATA_TESTID_COUNT;
}

function waitForBiowelPage(maxAttempts = 10) {
    let attempts = 0;
    const check = () => {
        attempts++;
        if (isBiowelPage()) {
            console.log(`[BVA] Página Biowel detectada (${document.querySelectorAll('[data-testid]').length} data-testid)`);
            init();
        } else if (attempts < maxAttempts) {
            setTimeout(check, 1500);
        } else {
            console.log('[BVA] No es una página Biowel, script inactivo');
        }
    };
    check();
}

function init() {
    if (document.getElementById('biowel-voice-widget')) return;

    const scanner = new DOMScanner();
    const manipulator = new DOMManipulator(scanner);
    const recorder = new VoiceRecorder();
    let ws = null;
    let accumulatedText = '';

    let fields = scanner.scan();
    const widget = createWidget();
    document.body.appendChild(widget);

    // References
    const panel = widget.querySelector('#bvaPanel');
    const startBtn = widget.querySelector('#bvaStartBtn');
    const stopBtn = widget.querySelector('#bvaStopBtn');
    const minimizeBtn = widget.querySelector('#bvaMinimize');
    const fab = widget.querySelector('#bvaFab');
    const transcript = widget.querySelector('#bvaTranscript');
    const logContainer = widget.querySelector('#bvaLog');
    const dot = widget.querySelector('#bvaDot');
    const statusText = widget.querySelector('#bvaStatusText');
    const fieldsCount = widget.querySelector('#bvaFieldsCount');
    const exportBtn = widget.querySelector('#bvaExportFields');
    const fieldsModal = widget.querySelector('#bvaFieldsModal');
    const fieldsOverlay = widget.querySelector('#bvaFieldsOverlay');
    const modalClose = widget.querySelector('#bvaModalClose');
    const copyFieldsBtn = widget.querySelector('#bvaCopyFields');
    const copyCSVBtn = widget.querySelector('#bvaCopyCSV');
    const downloadBtn = widget.querySelector('#bvaDownloadFields');
    const tableContainer = widget.querySelector('#bvaFieldsTableContainer');

    fieldsCount.textContent = `${fields.length} campos detectados con data-testid`;

    // =============================================
    // Re-escaneo dinámico: detecta modales/secciones nuevas en el DOM
    // =============================================
    function rescanFields() {
        const newFields = scanner.scan();
        if (newFields.length !== fields.length) {
            const diff = newFields.length - fields.length;
            fields = newFields;
            fieldsCount.textContent = `${fields.length} campos detectados con data-testid`;
            addLog('decision', `Re-escaneo: ${fields.length} campos (${diff > 0 ? '+' : ''}${diff})`);
            console.log(`[BVA] Re-scan: ${fields.length} campos detectados`);
        }
        return fields;
    }

    // MutationObserver: detecta cuando aparecen nuevos elementos con data-testid
    // (ej: modal de Antecedentes, secciones dinámicas)
    let rescanTimer = null;
    const observer = new MutationObserver((mutations) => {
        let hasNewTestIds = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.hasAttribute?.('data-testid') || node.querySelector?.('[data-testid]')) {
                        hasNewTestIds = true;
                        break;
                    }
                }
            }
            if (hasNewTestIds) break;
        }
        if (hasNewTestIds) {
            // Debounce: esperar 500ms para que el DOM se estabilice
            if (rescanTimer) clearTimeout(rescanTimer);
            rescanTimer = setTimeout(() => rescanFields(), 500);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function showFieldsModal() {
        const currentFields = rescanFields();
        let html = `<table class="bva-fields-table"><thead><tr><th>#</th><th>data-testid</th><th>Label</th><th>Tipo</th><th>Ojo</th><th>Sección</th><th>Opciones</th></tr></thead><tbody>`;
        currentFields.forEach((f, i) => {
            html += `<tr><td>${i + 1}</td><td class="testid">${escapeHtml(f.data_testid)}</td><td>${escapeHtml(f.label || '-')}</td><td>${escapeHtml(f.field_type)}</td><td>${escapeHtml(f.eye || '-')}</td><td>${escapeHtml(f.section || '-')}</td><td>${f.options?.length ? escapeHtml(f.options.join(', ')) : '-'}</td></tr>`;
        });
        html += '</tbody></table>';
        tableContainer.innerHTML = html;
        fieldsModal.classList.add('visible');
        fieldsOverlay.classList.add('visible');
    }

    exportBtn.addEventListener('click', showFieldsModal);
    fieldsCount.addEventListener('click', showFieldsModal);
    modalClose.addEventListener('click', () => { fieldsModal.classList.remove('visible'); fieldsOverlay.classList.remove('visible'); });

    function setDot(state) {
        dot.classList.remove('connected', 'recording');
        if (state === 'connected') { dot.classList.add('connected'); statusText.textContent = 'Conectado'; }
        else if (state === 'recording') { dot.classList.add('recording'); statusText.textContent = 'Grabando...'; }
        else { statusText.textContent = 'Desconectado'; }
    }

    function addLog(type, message) {
        const colors = { transcript: '#6b7280', decision: '#3b82f6', fill: '#22c55e', ignore: '#f59e0b' };
        const entry = document.createElement('div');
        entry.style.cssText = `font-size:11px;padding:3px 6px;border-left:3px solid ${colors[type] || '#6b7280'};margin-bottom:2px;color:#374151;background:${type === 'fill' ? '#f0fdf4' : 'transparent'};border-radius:0 4px 4px 0;`;
        entry.textContent = `• ${message}`;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function connectWS() {
        return new Promise((resolve, reject) => {
            ws = new WebSocket(CONFIG.BACKEND_WS);
            ws.onopen = () => { setDot('connected'); addLog('decision', 'Conectado al backend'); resolve(); };
            ws.onerror = (e) => { setDot('disconnected'); reject(e); };
            ws.onclose = () => { setDot('disconnected'); addLog('decision', 'Desconectado'); };
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            };
        });
    }

    function handleMessage(msg) {
        switch (msg.type) {
            case 'partial_transcription':
                transcript.innerHTML = `<span>${escapeHtml(accumulatedText)}</span><span style="color:#9ca3af;font-style:italic"> ${escapeHtml(msg.text || '')}</span>`;
                break;
            case 'final_segment':
                accumulatedText += (accumulatedText ? ' ' : '') + msg.text;
                transcript.textContent = accumulatedText;
                addLog('transcript', msg.text);
                break;
            case 'transcription':
                transcript.textContent = msg.text;
                break;
            case 'partial_autofill':
                if (msg.items?.length) {
                    const filled = manipulator.applyAutofill(msg.items);
                    if (filled.length > 0) addLog('fill', `${filled.join(', ')} ← "${(msg.source_text || '').substring(0, 100)}"`);
                }
                break;
            case 'autofill_data':
                if (msg.data) {
                    const items = Object.entries(msg.data).map(([key, value]) => ({ unique_key: key, value, confidence: 0.9 }));
                    const filled = manipulator.applyAutofill(items);
                    if (filled.length > 0) addLog('fill', `LLM final: ${filled.join(', ')}`);
                }
                break;
            case 'info':
                addLog('decision', msg.message || 'Info del servidor');
                break;
            case 'error':
                addLog('ignore', `⚠ Error: ${msg.message || 'Error desconocido'}`);
                console.error('[BVA] Error del backend:', msg.message);
                break;
        }
    }

    function sendAudioChunk(blob) {
        blob.arrayBuffer().then(buffer => {
            if (ws?.readyState !== WebSocket.OPEN) return;
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            ws.send(JSON.stringify({ type: 'audio_chunk', data: btoa(binary) }));
        });
    }

    startBtn.addEventListener('click', async () => {
        try {
            if (!ws || ws.readyState !== WebSocket.OPEN) await connectWS();
            const freshFields = scanner.scan();
            accumulatedText = '';
            transcript.textContent = '';

            // Esperar confirmación del backend antes de iniciar grabación
            const ready = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    addLog('ignore', '⚠ Timeout esperando backend (5s)');
                    resolve(false);
                }, 5000);
                const origHandler = ws.onmessage;
                ws.onmessage = (event) => {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'info' || msg.type === 'error') {
                        clearTimeout(timeout);
                        ws.onmessage = origHandler;
                        handleMessage(msg);
                        resolve(msg.type === 'info');
                    } else {
                        handleMessage(msg);
                    }
                };
                ws.send(JSON.stringify({ type: 'biowel_form_structure', fields: freshFields, already_filled: manipulator.getFilledFields() }));
            });

            if (!ready) {
                addLog('ignore', '⚠ No se pudo iniciar el streaming');
                return;
            }

            if (await recorder.start(sendAudioChunk)) {
                startBtn.style.display = 'none'; stopBtn.style.display = 'flex';
                panel.classList.add('recording'); setDot('recording');
            }
        } catch (err) {
            console.error('[BVA] Error iniciando:', err);
            addLog('ignore', `⚠ Error: ${err.message}`);
            setDot('disconnected');
        }
    });

    stopBtn.addEventListener('click', () => {
        recorder.stop();
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end_stream' }));
        stopBtn.style.display = 'none'; startBtn.style.display = 'flex';
        panel.classList.remove('recording'); setDot('connected');
    });

    minimizeBtn.addEventListener('click', () => { panel.classList.add('minimized'); fab.classList.add('visible'); });
    fab.addEventListener('click', () => { panel.classList.remove('minimized'); fab.classList.remove('visible'); });

    // =============================================
    // BATCH MODE: Upload / Record → Transcribe → Fill
    // =============================================
    // Input file creado en document.body para compatibilidad con Tampermonkey
    const batchFileInput = document.createElement('input');
    batchFileInput.type = 'file';
    batchFileInput.accept = '.wav,.flac,.mp3,.m4a,.ogg,.webm,.mp4,.aac';
    batchFileInput.style.display = 'none';
    document.body.appendChild(batchFileInput);
    const batchUploadBtn = widget.querySelector('#bvaBatchUploadBtn');
    const batchRecordBtn = widget.querySelector('#bvaBatchRecordBtn');
    const batchProcessBtn = widget.querySelector('#bvaBatchProcessBtn');
    const batchFileName = widget.querySelector('#bvaBatchFileName');
    const batchStatus = widget.querySelector('#bvaBatchStatus');

    let batchSelectedFile = null;
    let batchMediaRecorder = null;
    let batchRecordedChunks = [];
    let batchIsRecording = false;

    function setBatchStatus(text, isError = false) {
        batchStatus.textContent = text;
        batchStatus.classList.toggle('error', isError);
        batchStatus.classList.add('visible');
    }

    function clearBatchStatus() {
        batchStatus.classList.remove('visible', 'error');
        batchStatus.textContent = '';
    }

    function setBatchFile(file) {
        batchSelectedFile = file;
        if (file) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(1);
            batchFileName.textContent = `${file.name} (${sizeMB} MB)`;
            batchFileName.style.display = 'block';
            batchProcessBtn.disabled = false;
        } else {
            batchFileName.style.display = 'none';
            batchProcessBtn.disabled = true;
        }
    }

    // Upload button — usa setTimeout para evitar que el click sea bloqueado
    batchUploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => batchFileInput.click(), 100);
    });

    batchFileInput.addEventListener('change', (e) => {
        console.log('[BVA-Batch] File input change event, files:', e.target.files?.length);
        const file = e.target.files?.[0];
        if (file) {
            console.log('[BVA-Batch] File selected:', file.name, file.size, file.type);
            clearBatchStatus();
            setBatchFile(file);
            addLog('decision', `Audio cargado: ${file.name} (${(file.size/1024/1024).toFixed(1)} MB)`);
        }
        batchFileInput.value = '';
    });

    // Record button (optional)
    batchRecordBtn.addEventListener('click', async () => {
        if (batchIsRecording) {
            // Stop recording
            if (batchMediaRecorder && batchMediaRecorder.state !== 'inactive') {
                batchMediaRecorder.stop();
            }
            batchRecordBtn.classList.remove('recording');
            batchRecordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg> Grabar`;
            batchIsRecording = false;
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            batchRecordedChunks = [];
            batchMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

            batchMediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) batchRecordedChunks.push(e.data);
            };

            batchMediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                if (batchRecordedChunks.length > 0) {
                    const blob = new Blob(batchRecordedChunks, { type: 'audio/webm' });
                    const file = new File([blob], 'grabacion.webm', { type: 'audio/webm' });
                    setBatchFile(file);
                    addLog('decision', `Grabación completada: ${(file.size / 1024).toFixed(0)} KB`);
                }
            };

            batchMediaRecorder.start();
            batchIsRecording = true;
            batchRecordBtn.classList.add('recording');
            batchRecordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener`;
            clearBatchStatus();
            addLog('decision', 'Grabando audio...');
        } catch (err) {
            console.error('[BVA-Batch] Error accediendo al micrófono:', err);
            setBatchStatus('Error: no se pudo acceder al micrófono', true);
        }
    });

    // Process button
    batchProcessBtn.addEventListener('click', async () => {
        if (!batchSelectedFile) {
            setBatchStatus('Selecciona o graba un audio primero', true);
            return;
        }

        batchProcessBtn.disabled = true;
        clearBatchStatus();

        try {
            // 1. Scan fields fresh (re-escaneo para capturar modales abiertos)
            setBatchStatus('Escaneando campos...');
            const freshFields = rescanFields();
            const filledFields = manipulator.getFilledFields();

            // 2. Build FormData
            setBatchStatus('Subiendo audio...');
            const formData = new FormData();
            formData.append('audio_file', batchSelectedFile);
            formData.append('fields', JSON.stringify(freshFields));
            formData.append('already_filled', JSON.stringify(filledFields));

            addLog('decision', `Batch: enviando ${freshFields.length} campos + audio`);

            // 3. POST to batch endpoint (timeout 10 min para audios largos)
            setBatchStatus('Transcribiendo...');
            const url = CONFIG.BACKEND_HTTP + CONFIG.BATCH_ENDPOINT;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 600000);
            let response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                let errMsg = `Error HTTP ${response.status}`;
                try {
                    const errBody = await response.json();
                    errMsg = errBody.detail || errMsg;
                } catch (e) { /* ignore parse error */ }
                throw new Error(errMsg);
            }

            // 4. Parse response
            setBatchStatus('Mapeando campos...');
            const result = await response.json();
            const { transcript: batchTranscript, filled_fields, stats } = result;

            // Show transcript
            if (batchTranscript) {
                transcript.textContent = batchTranscript;
                addLog('transcript', batchTranscript.substring(0, 200));
            }

            // 5. Apply filled fields to DOM
            // Separar clicks (botones secuenciales) de datos (campos llenables)
            const entries = Object.entries(filled_fields || {});
            const clickItems = entries.filter(([_, v]) => v === 'click');
            const dataItems = entries.filter(([_, v]) => v !== 'click');

            if (entries.length === 0) {
                setBatchStatus('No se encontraron campos para llenar en el audio');
            } else {
                let totalApplied = 0;

                // 5a. Ejecutar clicks secuencialmente con delays
                // (cada click puede abrir un modal/dropdown que tarda en renderizar)
                if (clickItems.length > 0) {
                    setBatchStatus(`Ejecutando ${clickItems.length} acciones...`);
                    addLog('fill', `Batch: ${clickItems.length} clicks + ${dataItems.length} campos`);
                    for (const [key, value] of clickItems) {
                        console.log(`[BVA-Batch] Click secuencial: ${key}`);
                        const success = manipulator.fillField(key, value);
                        if (success) {
                            totalApplied++;
                            manipulator.filledFields.set(key, value);
                        }
                        // Esperar para que el DOM se actualice (modal/dropdown abra)
                        await new Promise(r => setTimeout(r, 800));
                        // Re-escanear por si aparecieron nuevos elementos
                        rescanFields();
                    }
                }

                // 5b. Aplicar campos de datos normalmente
                if (dataItems.length > 0) {
                    const items = dataItems.map(([key, value]) => ({ unique_key: key, value, confidence: 1.0 }));
                    const applied = manipulator.applyAutofill(items);
                    totalApplied += applied.length;
                }

                addLog('fill', `Batch: ${totalApplied} campos aplicados`);
                setBatchStatus(
                    `Listo: ${totalApplied} campos aplicados` +
                    (stats?.skipped_already_filled_count ? `, ${stats.skipped_already_filled_count} ya estaban llenos` : '')
                );
            }

            console.log('[BVA-Batch] Resultado:', result);

        } catch (err) {
            console.error('[BVA-Batch] Error procesando:', err);
            setBatchStatus(`Error: ${err.message}`, true);
            addLog('ignore', `⚠ Batch error: ${err.message}`);
        } finally {
            batchProcessBtn.disabled = false;
        }
    });
}

waitForBiowelPage();
