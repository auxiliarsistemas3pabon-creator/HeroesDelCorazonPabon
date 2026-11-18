// Detección (mejor esfuerzo) de ventanas privadas/incógnito. Ante cualquier duda
// devuelve false: es preferible dejar pasar que bloquear a un usuario legítimo.
// El servidor vuelve a validar el aviso `private_mode` en /auth/login/ y además
// liga la sesión a un dispositivo registrado mediante una cookie httpOnly.

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

// Cuota de almacenamiento temporal: la API webkit es la que refleja el límite de incógnito en Chromium.
function chromiumQuota() {
  const legacy = navigator.webkitTemporaryStorage
  if (legacy?.queryUsageAndQuota) {
    return new Promise((resolve) => legacy.queryUsageAndQuota((_usage, quota) => resolve(quota), () => resolve(undefined)))
  }
  if (!navigator.storage?.estimate) return Promise.resolve(undefined)
  return navigator.storage.estimate().then(({ quota }) => quota)
}

async function chromiumIsPrivate() {
  const quota = await chromiumQuota()
  if (typeof quota !== 'number') return false
  const heapLimit = performance?.memory?.jsHeapSizeLimit ?? 1073741824
  // En incógnito Chromium limita la cuota a una fracción de la memoria (< 2x el heap de JS);
  // una ventana normal recibe un porcentaje del disco (decenas o cientos de GB).
  return quota < heapLimit * 2
}

// Firefox y Safari recientes rechazan el sistema de archivos privado del origen (OPFS) en modo privado.
async function opfsRejected() {
  if (!navigator.storage?.getDirectory) return false
  try {
    await navigator.storage.getDirectory()
    return false
  } catch (error) {
    return /security|transient|not allowed|insecure/i.test(`${error?.name} ${error?.message}`)
  }
}

function firefoxIsPrivate() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(false)
    try {
      const request = window.indexedDB.open('__private_mode_probe__')
      request.onerror = () => resolve(true)
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
      resolve(true)
    }
  })
}

async function safariIsPrivate() {
  try {
    window.localStorage.setItem('__private_mode_probe__', '1')
    window.localStorage.removeItem('__private_mode_probe__')
  } catch {
    return true
  }
  try {
    if (typeof window.openDatabase === 'function') window.openDatabase(null, null, null, null)
  } catch {
    return true
  }
  return false
}

export async function detectPrivateMode() {
  try {
    if (isFirefox()) return (await opfsRejected()) || (await firefoxIsPrivate())
    if (isSafari()) return (await opfsRejected()) || (await safariIsPrivate())
    if (isChromium()) return await chromiumIsPrivate()
  } catch {
    /* no se puede determinar */
  }
  return false
}
