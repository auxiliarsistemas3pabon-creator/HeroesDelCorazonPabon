import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_REASON_KEY, takeLogoutReason, useIdleLogout } from './useIdleLogout'

describe('useIdleLogout (capa 20)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('cierra la sesión tras los minutos sin actividad y deja el aviso para el login', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(true, onIdle, 1))
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(onIdle).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(31_000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(IDLE_REASON_KEY)).toBe('idle')
    expect(takeLogoutReason()).toBe('idle')
    expect(takeLogoutReason()).toBeNull() // se avisa una sola vez
  })

  it('la actividad reinicia el contador', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(true, onIdle, 1))
    for (let step = 0; step < 4; step += 1) {
      act(() => { vi.advanceTimersByTime(30_000) })
      act(() => { window.dispatchEvent(new Event('keydown')) })
    }
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('un nuevo onIdle en cada render no reinicia el contador', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(({ cb }) => useIdleLogout(true, cb, 1), { initialProps: { cb: () => onIdle() } })
    for (let step = 0; step < 3; step += 1) {
      act(() => { vi.advanceTimersByTime(30_000) })
      rerender({ cb: () => onIdle() })
    }
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('sin sesión no hace nada', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(false, onIdle, 1))
    act(() => { vi.advanceTimersByTime(5 * 60_000) })
    expect(onIdle).not.toHaveBeenCalled()
  })
})
