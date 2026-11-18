import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
let realtimeOptions
const disconnect = vi.fn()

vi.mock('../lib/api', () => ({ api: (...args) => mockApi(...args) }))
vi.mock('../lib/realtime', () => ({
  connectRealtime: (options) => {
    realtimeOptions = options
    return disconnect
  },
}))

import { AuthProvider, useAuth } from './AuthContext'
import { randomCredentials } from '../test/credentials'

let ctx
function Probe() {
  ctx = useAuth()
  return <div data-testid="state">{ctx.loading ? 'loading' : ctx.user ? ctx.user.username : 'anon'}</div>
}

const renderProvider = () => render(<AuthProvider><Probe /></AuthProvider>)
// Usuario y contraseña generados al azar en cada ejecución (ninguna credencial escrita en el test).
const credentials = randomCredentials()
const user = { id: 1, username: credentials.username, role: 'boss' }

describe('AuthProvider', () => {
  beforeEach(() => { realtimeOptions = undefined })
  afterEach(() => vi.useRealTimers())

  it('restaura la sesión con /auth/me/', async () => {
    mockApi.mockResolvedValue(user)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(user.username))
    expect(realtimeOptions).toBeDefined()
  })

  it('sin sesión (me = null) queda anónimo', async () => {
    mockApi.mockResolvedValue(null)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
  })

  it('error distinto de 401 queda anónimo', async () => {
    mockApi.mockRejectedValue({ status: 500 })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
  })

  it('401 renueva con refresh y reintenta', async () => {
    mockApi
      .mockRejectedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ detail: 'ok' })
      .mockResolvedValueOnce(user)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(user.username))
  })

  it('401 y refresh fallido queda anónimo', async () => {
    mockApi.mockRejectedValueOnce({ status: 401 }).mockRejectedValueOnce({ status: 401 })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
  })

  it('login devuelve el perfil y fija el usuario', async () => {
    mockApi.mockResolvedValueOnce(null).mockResolvedValueOnce(user)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
    let result
    await act(async () => { result = await ctx.login(credentials) })
    expect(result).toEqual(user)
    expect(screen.getByTestId('state')).toHaveTextContent(user.username)
  })

  it('login sin perfil intenta refresh y /me', async () => {
    mockApi.mockResolvedValueOnce(null) // me inicial
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
    mockApi
      .mockResolvedValueOnce(null) // login sin cuerpo
      .mockResolvedValueOnce({ detail: 'ok' }) // refresh
      .mockResolvedValueOnce(user) // me
    await act(async () => { await ctx.login(credentials) })
    expect(screen.getByTestId('state')).toHaveTextContent(user.username)
  })

  it('login falla si el refresh no establece la sesión', async () => {
    mockApi.mockResolvedValueOnce(null)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
    mockApi.mockResolvedValueOnce(null).mockRejectedValueOnce({ status: 401 })
    await act(async () => {
      await expect(ctx.login({})).rejects.toMatchObject({ code: 'SESSION_NOT_ESTABLISHED' })
    })
  })

  it('login falla si /me sigue vacío', async () => {
    mockApi.mockResolvedValueOnce(null)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
    mockApi.mockResolvedValueOnce(null).mockResolvedValueOnce({}).mockResolvedValueOnce(null)
    await act(async () => {
      await expect(ctx.login({})).rejects.toMatchObject({ code: 'SESSION_NOT_ESTABLISHED' })
    })
  })

  it('login con credenciales inválidas propaga el error', async () => {
    mockApi.mockResolvedValueOnce(null)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon'))
    mockApi.mockRejectedValueOnce({ status: 401, data: { code: 'unauthorized_access' } })
    await act(async () => {
      await expect(ctx.login({})).rejects.toMatchObject({ status: 401 })
    })
    expect(screen.getByTestId('state')).toHaveTextContent('anon')
  })

  it('logout limpia el usuario', async () => {
    mockApi.mockResolvedValueOnce(user)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(user.username))
    mockApi.mockResolvedValueOnce(null)
    await act(async () => { await ctx.logout() })
    expect(screen.getByTestId('state')).toHaveTextContent('anon')
  })

  it('eventos en tiempo real generan avisos que expiran', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi.mockResolvedValue(user)
    renderProvider()
    await waitFor(() => expect(realtimeOptions).toBeDefined())
    act(() => realtimeOptions.onStatus('connected'))
    expect(ctx.realtimeStatus).toBe('connected')
    act(() => realtimeOptions.onEvent({ type: 'questions.submitted' }))
    expect(ctx.realtimeNotice).toBe('Se recibió una nueva evaluación.')
    act(() => realtimeOptions.onEvent({ type: 'evaluations.updated' }))
    expect(ctx.realtimeNotice).toBe('La programación de evaluaciones cambió.')
    act(() => realtimeOptions.onEvent({ type: 'staff.updated' }))
    expect(ctx.realtimeNotice).toBe('Se actualizó el personal.')
    act(() => realtimeOptions.onEvent({ type: 'otro' }))
    expect(ctx.realtimeNotice).toBe('Hay una actualización en tiempo real.')
    expect(ctx.realtimeEvent.type).toBe('otro')
    act(() => { vi.advanceTimersByTime(5100) })
    expect(ctx.realtimeNotice).toBe('')
  })

  it('refreshSession del realtime devuelve true o cierra la sesión', async () => {
    mockApi.mockResolvedValue(user)
    renderProvider()
    await waitFor(() => expect(realtimeOptions).toBeDefined())
    mockApi.mockResolvedValueOnce({ detail: 'ok' })
    expect(await realtimeOptions.refreshSession()).toBe(true)
    mockApi.mockRejectedValueOnce({ status: 401 })
    let refreshed
    await act(async () => { refreshed = await realtimeOptions.refreshSession() })
    expect(refreshed).toBe(false)
    expect(screen.getByTestId('state')).toHaveTextContent('anon')
  })

  it('desmontar desconecta el tiempo real', async () => {
    mockApi.mockResolvedValue(user)
    const { unmount } = renderProvider()
    await waitFor(() => expect(realtimeOptions).toBeDefined())
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
