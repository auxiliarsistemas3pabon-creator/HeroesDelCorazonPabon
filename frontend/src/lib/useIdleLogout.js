import { useEffect, useRef } from 'react'

// Capa 20: cierre de sesión por inactividad. Un computador de la clínica (estación de enfermería, consultorio)
// que queda con la sesión abierta permitiría a cualquiera ver o calificar en nombre de otra persona.
// Minutos sin actividad antes de cerrar la sesión; configurable con VITE_IDLE_TIMEOUT_MINUTES (por defecto 15).
export const IDLE_MINUTES = Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES) || 15
const ACTIVITY_KEY = 'hdc:last-activity'
export const IDLE_REASON_KEY = 'hdc:logout-reason'
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']
const CHECK_EVERY_MS = 30_000
const WRITE_EVERY_MS = 5_000

// localStorage puede no existir o lanzar (ventana privada, almacenamiento bloqueado): ante eso se usa memoria.
let memoryActivity = Date.now()
function readActivity() {
  try {
    const stored = Number(window.localStorage.getItem(ACTIVITY_KEY))
    return Number.isFinite(stored) && stored > 0 ? Math.max(stored, memoryActivity) : memoryActivity
  } catch {
    return memoryActivity
  }
}
function writeActivity(now) {
  memoryActivity = now
  try { window.localStorage.setItem(ACTIVITY_KEY, String(now)) } catch { /* memoria basta */ }
}

/**
 * Cierra la sesión tras `minutes` sin actividad. La actividad se comparte entre pestañas (localStorage):
 * trabajar en una pestaña mantiene viva la sesión en las demás. `onIdle` debe cerrar la sesión en el servidor.
 */
export function useIdleLogout(enabled, onIdle, minutes = IDLE_MINUTES) {
  // Ref: si `onIdle` cambia en cada render, el efecto no se re-suscribe (eso reiniciaría el contador sin actividad real).
  const onIdleRef = useRef(onIdle)
  useEffect(() => { onIdleRef.current = onIdle }, [onIdle])

  useEffect(() => {
    if (!enabled) return undefined
    const limit = minutes * 60_000
    let lastWrite = 0
    writeActivity(Date.now())

    function markActive() {
      const now = Date.now()
      memoryActivity = now
      if (now - lastWrite >= WRITE_EVERY_MS) {
        lastWrite = now
        writeActivity(now)
      }
    }
    let fired = false
    function check() {
      // Una sola vez: mientras el logout responde no se envían más peticiones de cierre.
      if (fired || Date.now() - readActivity() < limit) return
      fired = true
      window.clearInterval(timer)
      try { window.sessionStorage.setItem(IDLE_REASON_KEY, 'idle') } catch { /* el aviso es opcional */ }
      onIdleRef.current()
    }

    EVENTS.forEach((name) => window.addEventListener(name, markActive, { passive: true }))
    // Al volver a la pestaña (o despertar el equipo) se revisa enseguida, sin esperar al siguiente intervalo.
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => {
      EVENTS.forEach((name) => window.removeEventListener(name, markActive))
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(timer)
    }
  }, [enabled, minutes])
}

// Lee (y borra) el motivo del último cierre automático, para avisarlo una vez en el login.
export function takeLogoutReason() {
  try {
    const reason = window.sessionStorage.getItem(IDLE_REASON_KEY)
    window.sessionStorage.removeItem(IDLE_REASON_KEY)
    return reason
  } catch {
    return null
  }
}
