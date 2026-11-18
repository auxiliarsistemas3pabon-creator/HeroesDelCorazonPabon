// Detección de ventanas privadas. Regla de oro: ante cualquier duda, error o falta de soporte
// devuelve false; es preferible dejar pasar que bloquear a un usuario legítimo.
//   - Chrome / Edge (Chromium): tiempos de IndexedDB con durabilidad `strict` frente a `relaxed`.
//     En una ventana normal `strict` espera la escritura a disco (fsync) y es claramente más lenta;
//     en incógnito/InPrivate el almacenamiento vive en memoria y ambas tardan casi lo mismo.
//     Medido en Chrome 157 y Edge (mediana de 15 rondas, 5 repeticiones): normal 2.5-11.7 (con o sin
//     carga de CPU/disco), privado 0.6-1.6. La cuota de almacenamiento ya NO sirve: desde Chrome ~152
//     es la misma constante en ventana normal e incógnito.
//     Salvaguardas: 3 mediciones y solo se bloquea si las 3 son claramente privadas; cualquier
//     medición claramente normal o dudosa deja pasar; y un navegador con una marca de más de 24 h
//     (el incógnito borra su almacenamiento al cerrarse) es normal sin medir nada.
//   - Firefox privado: OPFS rechazado con "Security error".
//   - Safari privado: OPFS rechazado con "unknown transient reason".
// No es una garantía: es una heurística conservadora. El servidor revalida el aviso `private_mode`.

function isFirefox() {
  return typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)
}

function isChromium() {
  return typeof navigator !== 'undefined' && /chrome|chromium|crios|edg\//i.test(navigator.userAgent)
}

function isSafari() {
  return (
    typeof navigator !== 'undefined' &&
    /safari/i.test(navigator.userAgent) &&
    !/chrome|chromium|crios|android/i.test(navigator.userAgent)
  )
}

// --- Marca de antigüedad: prueba positiva de navegador normal ------------------------------
const SEEN_KEY = 'hdc_browser_seen_at'
const TRUSTED_AGE_MS = 24 * 60 * 60 * 1000

function seenAt() {
  try {
    const value = Number(window.localStorage.getItem(SEEN_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

// Se guarda siempre (también si se bloquea): un PC normal mal clasificado queda libre al día siguiente,
// mientras que una ventana de incógnito pierde la marca al cerrarse.
function rememberBrowser() {
  try {
    if (!seenAt()) window.localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* almacenamiento no disponible: sin marca */
  }
}

export function isLongKnownBrowser(now = Date.now()) {
  const first = seenAt()
  return first !== null && now - first >= TRUSTED_AGE_MS
}

// --- Tiempos de IndexedDB (Chromium) ------------------------------------------------------------
export const PRIVATE_BELOW = 1.25 // todas las medianas por debajo: privado
export const NORMAL_ABOVE = 1.6 //   alguna mediana por encima: normal
const RUNS = 3
const ROUNDS = 15
const WRITES = 15
// Presupuesto total de medición; si se agota (equipo muy cargado) el detector se abstiene.
const TIME_LIMIT_MS = 4000

/** Clasifica las medianas de varias mediciones: 'private' | 'normal' | 'unknown' (dudoso = no bloquear). */
export function classifyMedians(medians) {
  if (!medians.length || medians.some((m) => !Number.isFinite(m))) return 'unknown'
  if (medians.some((m) => m > NORMAL_ABOVE)) return 'normal'
  if (medians.length >= RUNS && medians.every((m) => m < PRIVATE_BELOW)) return 'private'
  return 'unknown'
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

function openProbeDb(name) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('s')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Mide una medición: mediana de ROUNDS rondas de (tiempo strict / tiempo relaxed).
// El límite se comprueba con el reloj en cada escritura (un temporizador se retrasa si la CPU está saturada).
async function measureRun(db, deadline) {
  const payload = new Uint8Array(16384)
  const batch = (durability) => new Promise((resolve, reject) => {
    const start = performance.now()
    let i = 0
    const next = () => {
      if (performance.now() > deadline) return reject(new Error('detector timeout'))
      if (i === WRITES) return resolve(performance.now() - start)
      const tx = db.transaction('s', 'readwrite', { durability })
      tx.objectStore('s').put(payload, i++)
      tx.oncomplete = next
      tx.onerror = tx.onabort = () => reject(tx.error)
    }
    next()
  })
  await batch('relaxed') // calentamiento
  await batch('strict')
  const ratios = []
  for (let k = 0; k < ROUNDS; k++) {
    const relaxed = await batch('relaxed')
    const strict = await batch('strict')
    if (relaxed > 0) ratios.push(strict / relaxed)
  }
  return ratios.length ? median(ratios) : NaN
}

/** Veredicto Chromium; `runMeasurement` es inyectable para las pruebas. */
export async function chromiumVerdict(runMeasurement) {
  const medians = []
  for (let i = 0; i < RUNS; i++) {
    medians.push(await runMeasurement())
    const verdict = classifyMedians(medians)
    if (verdict === 'normal') return verdict // una medición claramente normal basta para dejar pasar
  }
  return classifyMedians(medians)
}

async function chromiumIsPrivate() {
  if (!window.indexedDB) return false
  const name = `__hdc_probe_${Math.random().toString(36).slice(2)}`
  let db
  try {
    db = await openProbeDb(name)
    // Sin soporte real de durabilidad no hay señal: no se bloquea.
    const probe = db.transaction('s', 'readwrite', { durability: 'strict' })
    const supported = probe.durability === 'strict'
    probe.abort()
    if (!supported) return false
    const deadline = performance.now() + TIME_LIMIT_MS
    return (await chromiumVerdict(() => measureRun(db, deadline))) === 'private'
  } catch {
    return false
  } finally {
    try {
      db?.close()
      window.indexedDB.deleteDatabase(name)
    } catch {
      /* sin efecto */
    }
  }
}

// Firefox (>= 115) y Safari recientes rechazan el sistema de archivos privado del origen (OPFS) en
// navegación privada con un error concreto. Devuelve null si la API no existe (navegador antiguo).
async function opfsRejectedWith(pattern) {
  if (!navigator.storage?.getDirectory) return null
  try {
    await navigator.storage.getDirectory()
    return false
  } catch (error) {
    return pattern.test(String(error?.message ?? error))
  }
}

// Firefox antiguo (sin OPFS): en privado IndexedDB fallaba con InvalidStateError. Cualquier otro
// error (perfil dañado, disco lleno, IndexedDB deshabilitado) NO es prueba de navegación privada.
function firefoxLegacyIsPrivate() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(false)
    try {
      const request = window.indexedDB.open('__private_mode_probe__')
      request.onerror = (event) => {
        event?.preventDefault?.()
        resolve(request.error?.name === 'InvalidStateError')
      }
      request.onsuccess = () => {
        try {
          request.result.close()
          window.indexedDB.deleteDatabase('__private_mode_probe__')
        } catch {
          /* sin efecto */
        }
        resolve(false)
      }
    } catch {
      resolve(false)
    }
  })
}

async function firefoxIsPrivate() {
  const opfs = await opfsRejectedWith(/security error/i)
  return opfs ?? firefoxLegacyIsPrivate()
}

// Safari antiguo (sin OPFS): en privado localStorage tenía cuota 0 y lanzaba QuotaExceededError.
// Un SecurityError (p. ej. "Bloquear todas las cookies" en una ventana normal) NO es navegación privada.
function safariLegacyIsPrivate() {
  try {
    window.localStorage.setItem('__private_mode_probe__', '1')
    window.localStorage.removeItem('__private_mode_probe__')
    return false
  } catch (error) {
    return error?.name === 'QuotaExceededError'
  }
}

async function safariIsPrivate() {
  const opfs = await opfsRejectedWith(/unknown transient reason/i)
  return opfs ?? safariLegacyIsPrivate()
}

export async function detectPrivateMode() {
  try {
    // Navegador conocido desde hace más de 24 h: normal con certeza, no se mide nada.
    if (isLongKnownBrowser()) return false
    rememberBrowser()
    if (isFirefox()) return await firefoxIsPrivate()
    if (isSafari()) return await safariIsPrivate()
    if (isChromium()) return await chromiumIsPrivate()
  } catch {
    /* no se puede determinar */
  }
  return false
}
