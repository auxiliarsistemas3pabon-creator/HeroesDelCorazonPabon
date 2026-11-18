import { afterEach, describe, expect, it, vi } from 'vitest'
import { chromiumVerdict, classifyMedians, detectPrivateMode, isLongKnownBrowser } from './privateMode'

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
    window.localStorage.clear()
  })

  it('navegador desconocido no se bloquea', async () => {
    setUA(UA.other)
    expect(await detectPrivateMode()).toBe(false)
  })

  describe('Chromium: decisión con varias mediciones (nunca una sola)', () => {
    it('alguna mediana claramente normal => normal', () => {
      expect(classifyMedians([2.7])).toBe('normal')
      expect(classifyMedians([1.0, 1.1, 3.2])).toBe('normal')
    })
    it('solo es privado si las 3 medianas son claramente bajas', () => {
      expect(classifyMedians([0.98, 1.0, 1.07])).toBe('private')
      expect(classifyMedians([0.98, 1.0])).toBe('unknown') // menos de 3 mediciones: no bloquea
    })
    it('resultado dudoso o inválido => no se bloquea', () => {
      expect(classifyMedians([1.0, 1.4, 1.0])).toBe('unknown')
      expect(classifyMedians([1.0, Number.NaN, 1.0])).toBe('unknown')
      expect(classifyMedians([])).toBe('unknown')
    })
    it('una medición claramente normal termina antes (no hace esperar al usuario normal)', async () => {
      const run = vi.fn().mockResolvedValue(3.1)
      expect(await chromiumVerdict(run)).toBe('normal')
      expect(run).toHaveBeenCalledTimes(1)
    })
    it('incógnito: 3 mediciones bajas => privado', async () => {
      const run = vi.fn().mockResolvedValue(1.0)
      expect(await chromiumVerdict(run)).toBe('private')
      expect(run).toHaveBeenCalledTimes(3)
    })
    it('mediciones mezcladas => dudoso', async () => {
      const run = vi.fn().mockResolvedValueOnce(1.0).mockResolvedValueOnce(1.45).mockResolvedValueOnce(1.0)
      expect(await chromiumVerdict(run)).toBe('unknown')
    })
  })

  describe('Chromium: salvaguardas', () => {
    it('navegador conocido desde hace más de 24 h => normal sin medir', async () => {
      window.localStorage.setItem('hdc_browser_seen_at', String(Date.now() - 25 * 3600 * 1000))
      expect(isLongKnownBrowser()).toBe(true)
      const open = vi.fn()
      vi.stubGlobal('navigator', { userAgent: UA.chrome })
      Object.defineProperty(window, 'indexedDB', { value: { open }, configurable: true })
      expect(await detectPrivateMode()).toBe(false)
      expect(open).not.toHaveBeenCalled()
    })
    it('marca reciente o inexistente no cuenta como prueba', () => {
      expect(isLongKnownBrowser()).toBe(false)
      window.localStorage.setItem('hdc_browser_seen_at', String(Date.now() - 3600 * 1000))
      expect(isLongKnownBrowser()).toBe(false)
    })
    it('la primera visita deja la marca para el día siguiente', async () => {
      setUA(UA.other)
      await detectPrivateMode()
      expect(Number(window.localStorage.getItem('hdc_browser_seen_at'))).toBeGreaterThan(0)
    })
    it('sin IndexedDB, error al abrirla o sin soporte de durabilidad => no bloquea', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.chrome })
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
      expect(await detectPrivateMode()).toBe(false)

      const failing = { open: () => { const r = {}; setTimeout(() => { r.error = new Error('x'); r.onerror() }, 0); return r }, deleteDatabase: vi.fn() }
      Object.defineProperty(window, 'indexedDB', { value: failing, configurable: true })
      expect(await detectPrivateMode()).toBe(false)

      const db = { transaction: () => ({ durability: undefined, abort: vi.fn() }), close: vi.fn() }
      const noDurability = { open: () => { const r = { result: db }; setTimeout(() => r.onsuccess(), 0); return r }, deleteDatabase: vi.fn() }
      Object.defineProperty(window, 'indexedDB', { value: noDurability, configurable: true })
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
    it('IndexedDB con InvalidStateError (Firefox antiguo privado) = privado', async () => {
      setUA(UA.firefox)
      open((r) => { r.error = { name: 'InvalidStateError' }; r.onerror({ preventDefault: vi.fn() }) })
      expect(await detectPrivateMode()).toBe(true)
    })
    it('otro error de IndexedDB (perfil dañado, disco lleno) NO bloquea', async () => {
      setUA(UA.firefox)
      open((r) => { r.error = { name: 'UnknownError' }; r.onerror() })
      expect(await detectPrivateMode()).toBe(false)
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
    it('excepción inesperada al abrir NO bloquea; sin indexedDB = normal', async () => {
      setUA(UA.firefox)
      const idb = { open: () => { throw new Error('x') } }
      Object.defineProperty(window, 'indexedDB', { value: idb, configurable: true })
      expect(await detectPrivateMode()).toBe(false)
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
      expect(await detectPrivateMode()).toBe(false)
    })
  })

  describe('Safari', () => {
    it('localStorage con QuotaExceededError (Safari antiguo privado) = privado', async () => {
      setUA(UA.safari)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
      expect(await detectPrivateMode()).toBe(true)
    })
    it('localStorage con SecurityError (cookies bloqueadas en ventana normal) NO bloquea', async () => {
      setUA(UA.safari)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('localStorage disponible = normal', async () => {
      setUA(UA.safari)
      expect(await detectPrivateMode()).toBe(false)
    })
  })

  describe('OPFS (Firefox >= 115 y Safari recientes)', () => {
    const storage = (error) => ({ getDirectory: error ? async () => { throw error } : async () => ({}) })
    it('Firefox privado: getDirectory rechazado con Security error', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.firefox, storage: storage(new DOMException('Security error when calling GetDirectory', 'SecurityError')) })
      expect(await detectPrivateMode()).toBe(true)
    })
    it('Firefox normal: getDirectory disponible', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.firefox, storage: storage(null) })
      expect(await detectPrivateMode()).toBe(false)
    })
    it('Safari privado: unknown transient reason', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.safari, storage: storage(new DOMException('The operation failed for an unknown transient reason', 'UnknownError')) })
      expect(await detectPrivateMode()).toBe(true)
    })
    it('otro error de OPFS no se considera privado', async () => {
      vi.stubGlobal('navigator', { userAgent: UA.firefox, storage: storage(new Error('quota exceeded')) })
      expect(await detectPrivateMode()).toBe(false)
    })
  })

})
