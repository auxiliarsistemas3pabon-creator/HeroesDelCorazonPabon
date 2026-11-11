import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectRealtime } from './realtime'

class MockWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close() {}
}

describe('connectRealtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    MockWebSocket.instances = []
  })

  it('conecta al backend configurado usando WSS en producción', () => {
    vi.stubEnv('VITE_API_URL', 'https://heroesdelcorazon-pabon.onrender.com')
    vi.stubGlobal('WebSocket', MockWebSocket)

    const disconnect = connectRealtime({
      onStatus: vi.fn(),
      onEvent: vi.fn(),
      refreshSession: vi.fn(),
    })

    expect(MockWebSocket.instances[0].url).toBe(
      'wss://heroesdelcorazon-pabon.onrender.com/ws/events/',
    )
    disconnect()
  })

  it('usa el origen actual cuando VITE_API_URL está vacía', () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubGlobal('WebSocket', MockWebSocket)

    const disconnect = connectRealtime({
      onStatus: vi.fn(),
      onEvent: vi.fn(),
      refreshSession: vi.fn(),
    })

    expect(MockWebSocket.instances[0].url).toBe(
      `${window.location.origin.replace(/^http/, 'ws')}/ws/events/`,
    )
    disconnect()
  })
})
