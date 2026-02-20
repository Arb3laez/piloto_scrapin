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

    const fields = scanner.scan();
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

    function showFieldsModal() {
        let html = `<table class="bva-fields-table"><thead><tr><th>#</th><th>data-testid</th><th>Label</th><th>Tipo</th><th>Ojo</th><th>Sección</th><th>Opciones</th></tr></thead><tbody>`;
        fields.forEach((f, i) => {
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
}

waitForBiowelPage();
