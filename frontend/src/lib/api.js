// Cliente de la API. Las cookies httpOnly viajan solas (credentials) y las
// peticiones que modifican datos llevan el token CSRF de la cookie `csrftoken`.
// En producción la API usa el mismo origen del frontend (Vercel la reenvía a Render).
// Así las cookies httpOnly de sesión son first-party y no dependen de cookies de terceros.
const configuredApiOrigin = (import.meta.env.VITE_API_URL || '')
  .replace(/\/api\/v1\/?$/, '').replace(/\/$/, '')
const API_ORIGIN = import.meta.env.PROD ? '' : configuredApiOrigin
const BASE = `${API_ORIGIN}/api/v1`
let csrfTokenValue = ''

// Django exige el token CSRF en cabecera para métodos no seguros; se lee de la cookie que emite el backend.
function csrfToken() {
  const match = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : csrfTokenValue
}

async function ensureCsrfToken() {
  if (csrfToken()) return csrfToken()
  const response = await fetch(`${BASE}/auth/csrf/`, { credentials: 'include' })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.csrfToken) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, data })
  }
  csrfTokenValue = data.csrfToken
  return csrfTokenValue
}

// Convierte un error lanzado por `api` en texto para el usuario. Soporta el formato de DRF:
// { detail: '...' } o { campo: ['mensaje'] } (se toma el primer mensaje).
export function errorMessage(error, fallback = 'Ocurrió un error') {
  if (error?.code === 'SESSION_NOT_ESTABLISHED') {
    return 'El backend respondió al login, pero Vercel no conservó la sesión. Verifica que el último despliegue incluya el proxy de /api.'
  }
  // 502/503/504: el backend se está reiniciando o no responde; fetch sin status: no hay conexión.
  if (error?.status >= 502) return 'El servidor no está disponible en este momento. Intenta de nuevo en unos segundos.'
  if (error instanceof TypeError) return 'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.'
  const data = error?.data
  if (error?.status === 404) return 'El servidor no encontró esta ruta de la API. Verifica el despliegue y la ruta solicitada.'
  if (error?.status === 401) return 'Render rechazó el usuario o la contraseña. Verifica las credenciales de esta cuenta.'
  if (error?.status === 403) return 'Render bloqueó temporalmente el acceso o rechazó la solicitud. Si hubo varios intentos, espera a que expire el bloqueo de seguridad.'
  if (error?.status === 429) return 'Se alcanzó el límite de intentos. Espera antes de volver a iniciar sesión.'
  if (!data) return fallback
  if (typeof data.detail === 'string') return data.detail
  const first = Object.values(data).flat()[0]
  return typeof first === 'string' ? first : fallback
}

// Petición sin reintentos. Lanza Error con `status` y `data` (cuerpo JSON del error) para errorMessage.
// `body` puede ser objeto (se serializa a JSON) o FormData (subida de archivos).
async function send(path, { method = 'GET', body } = {}) {
  const headers = {}
  const isForm = body instanceof FormData // archivos: el navegador pone el Content-Type con su boundary
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['X-CSRFToken'] = await ensureCsrfToken()

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined || isForm ? body : JSON.stringify(body),
  })
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, data })
  return data
}

// Punto de entrada para llamar al backend; `path` es relativo a /api/v1. Devuelve el JSON (null en 204).
export async function api(path, options) {
  try {
    return await send(path, options)
  } catch (error) {
    // Access token vencido: intenta renovarlo una vez y repite la petición.
    if (error.status === 401 && !path.startsWith('/auth/')) {
      await send('/auth/refresh/', { method: 'POST' })
      return send(path, options)
    }
    throw error
  }
}
