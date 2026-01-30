document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ autofill.js cargado');

    const startBtn = document.getElementById('startVoiceBtn');
    const stopBtn = document.getElementById('stopVoiceBtn');

    if (!startBtn || !stopBtn) {
        console.error('❌ No se encontraron los botones de voz');
        return;
    }

    console.log('✅ Botones encontrados');

    startBtn.addEventListener('click', async () => {
        console.log('🎬 Click en "Iniciar Dictado"');

        try {
            // Iniciar captura de voz
            const success = await window.voiceWS.startVoiceInput();

            if (success !== false) {
                console.log('✅ Captura de voz iniciada');

                // Cambiar botones
                startBtn.classList.add('hidden');
                stopBtn.classList.remove('hidden');

                console.log('🔄 Botones actualizados');
            } else {
                console.error('❌ No se pudo iniciar la captura');
            }

        } catch (error) {
            console.error('❌ Error al iniciar dictado:', error);
            alert('Error al iniciar el dictado: ' + error.message);
        }
    });

    stopBtn.addEventListener('click', () => {
        console.log('⏹️ Click en "Detener"');

        try {
            window.voiceWS.stopVoiceInput();

            // Cambiar botones
            stopBtn.classList.add('hidden');
            startBtn.classList.remove('hidden');

            console.log('✅ Grabación detenida');

        } catch (error) {
            console.error('❌ Error al detener:', error);
        }
    });

    // Mostrar/ocultar registro según selección
    document.querySelectorAll('input[name="requiere_dilatacion"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const section = document.getElementById('registroSection');
            if (e.target.value === 'si') {
                section.classList.remove('hidden');
                console.log('✅ Sección de registro mostrada');
            } else {
                section.classList.add('hidden');
                console.log('ℹ️ Sección de registro ocultada');
            }
        });
    });

    // Contador de palabras
    const transcriptionText = document.getElementById('transcriptionText');
    if (transcriptionText) {
        const observer = new MutationObserver(() => {
            const text = transcriptionText.textContent.trim();
            const wordCount = text ? text.split(/\s+/).length : 0;
            const wordCountEl = document.getElementById('wordCount');
            if (wordCountEl) {
                wordCountEl.textContent = wordCount;
            }
        });

        observer.observe(transcriptionText, {
            characterData: true,
            childList: true,
            subtree: true
        });
    }

    // Contador de campos completados
    const form = document.getElementById('dilatacionForm');
    if (form) {
        form.addEventListener('input', () => {
            const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
            const filled = Array.from(inputs).filter(input => {
                if (input.type === 'radio') {
                    return form.querySelector(`input[name="${input.name}"]:checked`) !== null;
                }
                return input.value.trim() !== '';
            }).length;

            const fieldsFilledEl = document.getElementById('fieldsFilled');
            if (fieldsFilledEl) {
                fieldsFilledEl.textContent = `${filled}/${inputs.length}`;
            }
        });

        // Prevenir submit
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('📋 Formulario enviado');

            const formData = new FormData(form);
            const data = Object.fromEntries(formData);

            console.log('📊 Datos del formulario:', data);
            alert('✅ ¡Registro guardado exitosamente!\n\nRevisa la consola para ver los datos.');
        });
    }

    console.log('✅ Event listeners configurados');
});