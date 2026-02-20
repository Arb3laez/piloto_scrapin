export function createWidget() {
    const container = document.createElement('div');
    container.id = 'biowel-voice-widget';
    container.innerHTML = `
    <style>
      #biowel-voice-widget {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .bva-panel {
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        padding: 16px;
        width: 340px;
        border: 1px solid #e5e7eb;
        transition: all 0.3s;
      }
      .bva-panel.recording {
        border-color: #ef4444;
        box-shadow: 0 8px 32px rgba(239,68,68,0.2);
      }
      .bva-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .bva-title { font-size: 14px; font-weight: 600; color: #1f2937; }
      .bva-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b7280; }
      .bva-dot { width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; transition: background 0.3s; }
      .bva-dot.connected { background: #22c55e; }
      .bva-dot.recording { background: #ef4444; animation: bva-pulse 1.5s ease-in-out infinite; }
      @keyframes bva-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      .bva-transcript {
        background: #f9fafb; border-radius: 8px; padding: 10px;
        min-height: 40px; max-height: 100px; overflow-y: auto;
        font-size: 13px; color: #374151; margin-bottom: 8px;
        border: 1px solid #e5e7eb; line-height: 1.5;
      }
      .bva-transcript:empty::before { content: 'La transcripción aparecerá aquí...'; color: #9ca3af; font-style: italic; }
      .bva-log {
        background: #f9fafb; border-radius: 8px; padding: 6px;
        max-height: 100px; overflow-y: auto; font-size: 11px;
        margin-bottom: 8px; border: 1px solid #e5e7eb;
      }
      .bva-log-title { font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
      .bva-actions { display: flex; gap: 8px; }
      .bva-btn {
        flex: 1; padding: 10px 16px; border-radius: 10px; font-size: 13px;
        font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .bva-btn:hover { transform: translateY(-1px); }
      .bva-btn-start { background: #3b82f6; color: white; }
      .bva-btn-start:hover { background: #2563eb; }
      .bva-btn-stop { background: #ef4444; color: white; display: none; }
      .bva-btn-stop:hover { background: #dc2626; }
      .bva-minimize {
        position: absolute; top: 8px; right: 8px; width: 24px; height: 24px;
        border-radius: 50%; border: none; background: transparent; cursor: pointer;
        color: #9ca3af; font-size: 16px; display: flex; align-items: center; justify-content: center;
      }
      .bva-minimize:hover { background: #f3f4f6; color: #374151; }
      .bva-fab {
        width: 56px; height: 56px; border-radius: 50%; background: #3b82f6; color: white;
        border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(59,130,246,0.4);
        font-size: 24px; display: none; align-items: center; justify-content: center;
      }
      .bva-fab:hover { transform: scale(1.1); }
      .bva-fab.visible { display: flex; }
      .bva-panel.minimized { display: none; }
      .bva-fields-count { font-size: 11px; color: #9ca3af; margin-bottom: 8px; cursor: pointer; }
      .bva-fields-count:hover { color: #3b82f6; text-decoration: underline; }
      .bva-btn-export {
        background: #f3f4f6; color: #374151; font-size: 11px; padding: 4px 10px;
        border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; margin-bottom: 8px;
      }
      .bva-btn-export:hover { background: #e5e7eb; }
      .bva-fields-modal {
        display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 999999; background: white; border-radius: 12px; padding: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 800px; width: 90vw; max-height: 80vh;
        overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .bva-fields-modal.visible { display: block; }
      .bva-fields-overlay {
        display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 999998;
      }
      .bva-fields-overlay.visible { display: block; }
      .bva-fields-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .bva-fields-table th { background: #f3f4f6; padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db; position: sticky; top: 0; }
      .bva-fields-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
      .bva-fields-table tr:hover { background: #f0f9ff; }
      .bva-fields-table .testid { font-family: monospace; font-size: 11px; color: #7c3aed; }
      .bva-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .bva-modal-title { font-size: 16px; font-weight: 600; }
      .bva-modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #6b7280; }
      .bva-modal-close:hover { color: #111; }
      .bva-modal-actions { display: flex; gap: 8px; margin-bottom: 12px; }
      .bva-modal-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; border: 1px solid #d1d5db; background: #fff; }
      .bva-modal-btn:hover { background: #f3f4f6; }
      .bva-modal-btn-primary { background: #3b82f6; color: white; border-color: #3b82f6; }
      .bva-modal-btn-primary:hover { background: #2563eb; }
    </style>

    <div class="bva-fields-overlay" id="bvaFieldsOverlay"></div>
    <div class="bva-fields-modal" id="bvaFieldsModal">
      <div class="bva-modal-header">
        <span class="bva-modal-title">Campos Detectados</span>
        <button class="bva-modal-close" id="bvaModalClose">&times;</button>
      </div>
      <div class="bva-modal-actions">
        <button class="bva-modal-btn bva-modal-btn-primary" id="bvaCopyFields">Copiar JSON</button>
        <button class="bva-modal-btn" id="bvaCopyCSV">Copiar CSV</button>
        <button class="bva-modal-btn" id="bvaDownloadFields">Descargar JSON</button>
      </div>
      <div id="bvaFieldsTableContainer"></div>
    </div>

    <div class="bva-panel" id="bvaPanel">
      <div class="bva-header">
        <span class="bva-title">Streaming Bio</span>
        <div class="bva-status"> 
          <div class="bva-dot" id="bvaDot"></div>
          <span id="bvaStatusText">Desconectado</span>
        </div>
      </div>
      <div class="bva-fields-count" id="bvaFieldsCount"></div>
      <button class="bva-btn-export" id="bvaExportFields">Ver campos detectados</button>
      <div class="bva-transcript" id="bvaTranscript"></div>
      <div class="bva-log-title">Log de actividad</div>
      <div class="bva-log" id="bvaLog"></div>
      <div class="bva-actions">
        <button class="bva-btn bva-btn-start" id="bvaStartBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          Iniciar 
        </button>
        <button class="bva-btn bva-btn-stop" id="bvaStopBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          Detener
        </button>
      </div>
      <button class="bva-minimize" id="bvaMinimize" title="Minimizar">&minus;</button>
    </div>

    <button class="bva-fab" id="bvaFab" title="Abrir dictado">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
  `;
    return container;
}
