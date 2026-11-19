import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, errorMessage } from './api'

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  }
}

describe('errorMessage', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))

  it('la respuesta única de seguridad se muestra igual en cualquier código y avisa en consola', () => {
    const body = { detail: 'Acceso no autorizado.', code: 'unauthorized_access' }
    for (const status of [400, 401, 403, 404, 405, 429]) {
      expect(errorMessage({ status, data: body })).toBe('Acceso no autorizado.')
    }
    expect(console.warn).toHaveBeenCalledWith('Permiso no autorizado')
  })
  it('sesión no establecida', () => {
    expect(errorMessage({ code: 'SESSION_NOT_ESTABLISHED' })).toMatch(/cookie/)
  })
  it('errores de red y servidor', () => {
    expect(errorMessage({ status: 503 })).toMatch(/no está disponible/)
    expect(errorMessage(new TypeError('x'))).toMatch(/conexión/)
  })
  it('códigos HTTP', () => {
    expect(errorMessage({ status: 404 })).toMatch(/no encontró/)
    expect(errorMessage({ status: 401 })).toMatch(/rechazó/)
    expect(errorMessage({ status: 403, data: { detail: 'Prohibido' } })).toBe('Prohibido')
    expect(errorMessage({ status: 403, data: {} })).toMatch(/no tiene permiso/)
    expect(errorMessage({ status: 429 })).toMatch(/límite/)
  })
  it('formatos de DRF y respaldo', () => {
    expect(errorMessage({ status: 400 }, 'fallback')).toBe('fallback')
    expect(errorMessage({ status: 400, data: { detail: 'Detalle' } })).toBe('Detalle')
    expect(errorMessage({ status: 400, data: { campo: ['Primero'] } })).toBe('Primero')
    expect(errorMessage({ status: 400, data: { campo: [5] } }, 'fb')).toBe('fb')
    expect(errorMessage(undefined)).toBe('Ocurrió un error')
  })
})

describe('api', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'cookie', { value: 'csrftoken=abc%20123', configurable: true })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('GET devuelve el JSON y no envía CSRF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await api('/x/')).toEqual({ ok: 1 })
    expect(fetchMock.mock.calls[0][1].headers['X-CSRFToken']).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })
  it('POST serializa JSON con token CSRF y 204 devuelve null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204))
    vi.stubGlobal('fetch', fetchMock)
    expect(await api('/x/', { method: 'POST', body: { a: 1 } })).toBeNull()
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['X-CSRFToken']).toBe('abc 123')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
  })
  it('FormData no fuerza Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const form = new FormData()
    await api('/x/', { method: 'POST', body: form })
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].body).toBe(form)
  })
  it('lanza error con status y data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { detail: 'mal' })))
    await expect(api('/x/')).rejects.toMatchObject({ status: 400, data: { detail: 'mal' } })
  })
  it('respuesta de error sin cuerpo JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500)))
    await expect(api('/x/')).rejects.toMatchObject({ status: 500, data: null })
  })
  it('renueva el access token y repite en 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { detail: 'ok' }))
      .mockResolvedValueOnce(jsonResponse(200, { final: true }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await api('/datos/')).toEqual({ final: true })
    expect(fetchMock.mock.calls[1][0]).toContain('/auth/refresh/')
  })
  it('no renueva cuando la ruta es de auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    await expect(api('/auth/login/', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401 })
  })
  it('refresca el CSRF y reintenta cuando el token es rechazado', async () => {
    Object.defineProperty(document, 'cookie', { value: '', configurable: true })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 't1' }))
      // El backend ya no dice "CSRF Failed": todo 403 trae el mismo cuerpo genérico.
      .mockResolvedValueOnce(jsonResponse(403, { detail: 'Acceso no autorizado.', code: 'unauthorized_access' }))
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 't2' }))
      .mockResolvedValueOnce(jsonResponse(200, { saved: true }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await api('/x/', { method: 'POST', body: {} })).toEqual({ saved: true })
    expect(fetchMock.mock.calls[3][1].headers['X-CSRFToken']).toBe('t2')
  })
  it('un 403 repetido no reintenta más de una vez', async () => {
    const forbidden = () => jsonResponse(403, { detail: 'Acceso no autorizado.', code: 'unauthorized_access' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(forbidden())
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 't2' }))
      .mockResolvedValueOnce(forbidden())
    vi.stubGlobal('fetch', fetchMock)
    await expect(api('/x/', { method: 'DELETE' })).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it('no reintenta el login ni las lecturas con 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { detail: 'Acceso no autorizado.', code: 'unauthorized_access' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api('/auth/login/', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403 })
    await expect(api('/users/admin/')).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('falla si no se puede obtener el CSRF', async () => {
    Object.defineProperty(document, 'cookie', { value: '', configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    await expect(api('/x/', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 500 })
  })
})
