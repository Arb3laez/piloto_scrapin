/** Escapa HTML para prevenir XSS al insertar en innerHTML */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
