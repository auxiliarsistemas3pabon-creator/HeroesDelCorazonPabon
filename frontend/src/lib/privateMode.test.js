import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectPrivateMode } from './privateMode'

const UA = {
  firefox: 'Mozilla/5.0 Gecko/20100101 Firefox/120.0',
  chrome: 'Mozilla/5.0 Chrome/120.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15',
  other: 'CustomBrowser/1.0',
}

function setUA(ua) {
  vi.stubGlobal('navigator', { ...navigator, userAgent: ua, storage: navigator.storage })
}

describe('detectPrivateMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('navegador desconocido no se bloquea', async () => {
    setUA(UA.other)
    expect(await detectPrivateMode()).toBe(false)
  })

  describe('Chromium', () => {
    it('cuota pequeña = incógnito', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.chrome, storage: { estimate: async () => ({ quota: 1000 }) } })
      expect(await detectPrivateMode()).toBe(true)
    })
    it('cuota grande = ventana normal', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.chrome, storage: { estimate: async () => ({ quota: 5e12 }) } })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('sin API de almacenamiento o cuota no numérica deja pasar', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.chrome })
      expect(await detectPrivateMode()).toBe(false)
      vi.stubGlobal('navigator', { userAgent: UA.chrome, storage: { estimate: async () => ({}) } })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('usa la cuota webkit cuando existe (incógnito actual: < 2x heap)', async () => {
      const webkit = (quota) => ({ queryUsageAndQuota: (ok) => ok(0, quota) })
      vi.stubGlobal('navigator', { userAgent: UA.chrome, webkitTemporaryStorage: webkit(1.5 * 1073741824) })
      expect(await detectPrivateMode()).toBe(true)
      vi.stubGlobal('navigator', { userAgent: UA.chrome, webkitTemporaryStorage: webkit(80e9) })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('si estimate falla deja pasar', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.chrome, storage: { estimate: async () => { throw new Error('x') } } })
      expect(await detectPrivateMode()).toBe(false)
    })
  })

  describe('Firefox', () => {
    const open = (behaviour) => {
      const idb = {
        open: () => {
          const request = {}
          setTimeout(() => behaviour(request), 0)
          return request
        },
        deleteDatabase: vi.fn(),
      }
      vi.stubGlobal('indexedDB', idb)
      Object.defineProperty(window, 'indexedDB', { value: idb, configurable: true })
    }
    it('error al abrir IndexedDB = privado', async () => {
      setUA(UA.firefox)
      open((r) => r.onerror())
      expect(await detectPrivateMode()).toBe(true)
    })
    it('apertura correcta = normal', async () => {
      setUA(UA.firefox)
      open((r) => { r.result = { close: vi.fn() }; r.onsuccess() })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('fallo al cerrar no rompe', async () => {
      setUA(UA.firefox)
      open((r) => { r.result = { close() { throw new Error('x') } }; r.onsuccess() })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('excepción al abrir = privado; sin indexedDB = normal', async () => {
      setUA(UA.firefox)
      const idb = { open: () => { throw new Error('x') } }
      Object.defineProperty(window, 'indexedDB', { value: idb, configurable: true })
      expect(await detectPrivateMode()).toBe(true)
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
      expect(await detectPrivateMode()).toBe(false)
    })
  })

  describe('Safari', () => {
    it('localStorage bloqueado = privado', async () => {
      setUA(UA.safari)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
      expect(await detectPrivateMode()).toBe(true)
    })
    it('openDatabase que falla = privado', async () => {
      setUA(UA.safari)
      window.openDatabase = () => { throw new Error('x') }
      expect(await detectPrivateMode()).toBe(true)
      delete window.openDatabase
    })
    it('openDatabase correcto o ausente = normal', async () => {
      setUA(UA.safari)
      window.openDatabase = () => ({})
      expect(await detectPrivateMode()).toBe(false)
      delete window.openDatabase
      expect(await detectPrivateMode()).toBe(false)
    })
  })

  describe('OPFS (Firefox/Safari recientes)', () => {
    it('getDirectory rechazado por seguridad = privado', async () => {
      const storage = { getDirectory: async () => { throw new DOMException('The operation is insecure.', 'SecurityError') } }
      vi.stubGlobal('navigator', { userAgent: UA.firefox, storage })
      expect(await detectPrivateMode()).toBe(true)
      vi.stubGlobal('navigator', { userAgent: UA.safari, storage })
      expect(await detectPrivateMode()).toBe(true)
    })
  })
})
