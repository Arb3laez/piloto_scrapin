import { FormController, testMicrophone, checkDevices } from '@/services'

// ============================================
// Inicialización de la aplicación
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('='.repeat(50))
  console.log('Medical Voice Form - TypeScript')
  console.log('='.repeat(50))

  const app = new FormController()
  app.init()

  // Exponer instancia globalmente para debugging
  ;(window as Window & { app?: FormController }).app = app

  console.log('Aplicación inicializada correctamente')
})

// ============================================
// Funciones de testing expuestas globalmente
// ============================================

declare global {
  interface Window {
    testMicrophone: typeof testMicrophone
    checkDevices: typeof checkDevices
  }
}

window.testMicrophone = testMicrophone
window.checkDevices = checkDevices

console.log('Funciones de test disponibles:')
console.log('  - testMicrophone() → Prueba el micrófono por 5 segundos')
console.log('  - checkDevices()   → Lista todos los dispositivos de audio')
