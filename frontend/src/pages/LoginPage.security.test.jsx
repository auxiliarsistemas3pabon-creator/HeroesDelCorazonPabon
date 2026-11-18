// Pruebas funcionales y de seguridad del login. Las credenciales se generan al azar en cada ejecución
// (src/test/credentials.js): en este archivo no hay ningún usuario ni contraseña escritos.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogin = vi.fn()
let mockUser = null
const mockDetect = vi.fn()

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser, login: mockLogin }) }))
vi.mock('../lib/privateMode', () => ({ detectPrivateMode: () => mockDetect() }))

import { LoginPage } from './LoginPage'
import { randomCredentials } from '../test/credentials'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/evaluations" element={<div>EVALUATIONS</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const usernameField = () => screen.getByLabelText('Usuario')
const passwordField = () => screen.getByLabelText(/^Contraseña/)
const submitButton = () => screen.getByRole('button', { name: /Iniciar sesión|Ingresando/ })

async function fill(username, password) {
  await waitFor(() => expect(usernameField()).toBeEnabled())
  fireEvent.change(usernameField(), { target: { name: 'username', value: username } })
  fireEvent.change(passwordField(), { target: { name: 'password', value: password } })
}

async function submitWith(rejection) {
  const credentials = randomCredentials()
  mockLogin.mockRejectedValue(rejection)
  renderPage()
  await fill(credentials.username, credentials.password)
  fireEvent.click(submitButton())
  return { credentials, alert: await screen.findByRole('alert') }
}

beforeEach(() => {
  mockUser = null
  mockLogin.mockReset()
  mockDetect.mockReset()
  mockDetect.mockResolvedValue(false)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('Login: funcionamiento', () => {
  it('muestra usuario y contraseña con el autocompletado correcto', async () => {
    renderPage()
    await waitFor(() => expect(usernameField()).toBeEnabled())
    expect(usernameField()).toHaveAttribute('autocomplete', 'username')
    expect(passwordField()).toHaveAttribute('autocomplete', 'current-password')
    expect(usernameField()).toBeRequired()
    expect(passwordField()).toBeRequired()
  })

  it('la contraseña se oculta por defecto y el botón del ojo la muestra y la vuelve a ocultar', async () => {
    renderPage()
    await waitFor(() => expect(passwordField()).toBeEnabled())
    expect(passwordField()).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(passwordField()).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(passwordField()).toHaveAttribute('type', 'password')
  })

  it('quita los espacios del usuario pero no toca la contraseña', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockResolvedValue({ role: 'collaborator' })
    renderPage()
    await fill(`   ${username}\t`, ` ${password} `)
    fireEvent.click(submitButton())
    await screen.findByText('EVALUATIONS')
    expect(mockLogin).toHaveBeenCalledWith({ username, password: ` ${password} `, private_mode: false })
  })

  it('enviar con Enter también inicia sesión', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    await fill(username, password)
    fireEvent.submit(passwordField().closest('form'))
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
  })

  for (const [role, destination] of [['boss', 'DASHBOARD'], ['superadmin', 'DASHBOARD'], ['collaborator', 'EVALUATIONS']]) {
    it(`${role} entra a su página de inicio`, async () => {
      const { username, password } = randomCredentials()
      mockLogin.mockResolvedValue({ role })
      renderPage()
      await fill(username, password)
      fireEvent.click(submitButton())
      expect(await screen.findByText(destination)).toBeInTheDocument()
    })
  }

  it('mientras valida muestra "Ingresando..." y deshabilita el botón', async () => {
    let finish
    mockLogin.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { username, password } = randomCredentials()
    renderPage()
    await fill(username, password)
    fireEvent.click(submitButton())
    expect(await screen.findByRole('button', { name: /Ingresando/ })).toBeDisabled()
    finish({ role: 'boss' })
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
  })

  it('un nuevo intento borra el error anterior', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockRejectedValueOnce({ status: 401, data: { code: 'unauthorized_access' } }).mockResolvedValueOnce({ role: 'boss' })
    renderPage()
    await fill(username, password)
    fireEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(submitButton())
    await screen.findByText('DASHBOARD')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('con sesión ya iniciada no muestra el formulario: redirige', async () => {
    mockUser = { role: 'collaborator' }
    renderPage()
    expect(await screen.findByText('EVALUATIONS')).toBeInTheDocument()
    expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument()
  })
})

describe('Login: seguridad', () => {
  it('no envía dos logins a la vez aunque se pulse Enter varias veces', async () => {
    let finish
    mockLogin.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { username, password } = randomCredentials()
    renderPage()
    await fill(username, password)
    const form = passwordField().closest('form')
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(mockLogin).toHaveBeenCalledTimes(1)
    finish({ role: 'boss' })
    await screen.findByText('DASHBOARD')
  })

  it('mientras se verifica el navegador no se puede enviar nada', async () => {
    mockDetect.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(usernameField()).toBeDisabled()
    expect(passwordField()).toBeDisabled()
    fireEvent.submit(passwordField().closest('form'))
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('en una ventana privada no queda ningún campo donde escribir credenciales', async () => {
    mockDetect.mockResolvedValue(true)
    renderPage()
    await screen.findByRole('alert')
    expect(document.querySelectorAll('input').length).toBe(0)
    expect(document.querySelector('form')).toBeNull()
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('un navegador normal siempre declara private_mode=false', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    await fill(username, password)
    fireEvent.click(submitButton())
    await screen.findByText('DASHBOARD')
    expect(mockLogin.mock.calls[0][0].private_mode).toBe(false)
  })

  it('la contraseña nunca aparece como texto en la página', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockRejectedValue({ status: 401, data: { code: 'unauthorized_access' } })
    renderPage()
    await fill(username, password)
    fireEvent.click(submitButton())
    await screen.findByRole('alert')
    expect(document.body.textContent).not.toContain(password)
  })

  it('no guarda usuario ni contraseña en localStorage ni sessionStorage', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    await fill(username, password)
    fireEvent.click(submitButton())
    await screen.findByText('DASHBOARD')
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const stored = Object.keys(storage).map((key) => storage.getItem(key)).join('|')
      expect(stored).not.toContain(password)
      expect(stored).not.toContain(username)
    }
  })

  it('la contraseña no se escribe en la consola', async () => {
    const spies = ['log', 'info', 'error', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    const { credentials } = await submitWith({ status: 401, data: { code: 'unauthorized_access' } })
    for (const spy of [...spies, console.warn]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(credentials.password)
    }
  })

  it('clave incorrecta: mensaje genérico que no revela si falló el usuario o la contraseña', async () => {
    const { alert } = await submitWith({ status: 401, data: { code: 'unauthorized_access' } })
    expect(alert).toHaveTextContent('Acceso no autorizado.')
    expect(alert.textContent).not.toMatch(/contraseña incorrecta|password/i)
  })

  it('demasiados intentos (429): pide esperar', async () => {
    const { alert } = await submitWith({ status: 429, data: {} })
    expect(alert).toHaveTextContent(/límite de intentos/)
  })

  it('cuenta bloqueada temporalmente (403): muestra el aviso del servidor', async () => {
    const { alert } = await submitWith({ status: 403, data: { detail: 'Demasiados intentos fallidos. Intenta más tarde.' } })
    expect(alert).toHaveTextContent('Demasiados intentos fallidos')
  })

  it('un mensaje del servidor con HTML se muestra como texto (no se ejecuta)', async () => {
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>'
    const { alert } = await submitWith({ status: 403, data: { detail: payload } })
    expect(alert.textContent).toContain('<script>')
    expect(alert.querySelector('script, img')).toBeNull()
    expect(window.__xss).toBeUndefined()
  })

  it('un usuario con código malicioso se envía como texto y no se inserta en la página', async () => {
    const attack = '<script>window.__xss=1</script>'
    mockLogin.mockRejectedValue({ status: 403, data: { code: 'unauthorized_access' } })
    renderPage()
    await fill(attack, randomCredentials().password)
    fireEvent.click(submitButton())
    await screen.findByRole('alert')
    expect(mockLogin.mock.calls[0][0].username).toBe(attack)
    expect(document.querySelectorAll('script').length).toBe(0)
    expect(window.__xss).toBeUndefined()
  })

  it('sin conexión con el servidor: mensaje claro', async () => {
    const { alert } = await submitWith(new TypeError('Failed to fetch'))
    expect(alert).toHaveTextContent(/No hay conexión con el servidor/)
  })

  it('servidor caído (502): mensaje claro', async () => {
    const { alert } = await submitWith({ status: 502, data: null })
    expect(alert).toHaveTextContent(/no está disponible/)
  })

  it('tras un error se puede corregir y volver a intentar', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockRejectedValueOnce({ status: 401, data: { code: 'unauthorized_access' } }).mockResolvedValueOnce({ role: 'collaborator' })
    renderPage()
    await fill(username, randomCredentials().password)
    fireEvent.click(submitButton())
    await screen.findByRole('alert')
    expect(submitButton()).toBeEnabled()
    fireEvent.change(passwordField(), { target: { name: 'password', value: password } })
    fireEvent.click(submitButton())
    expect(await screen.findByText('EVALUATIONS')).toBeInTheDocument()
    expect(mockLogin).toHaveBeenLastCalledWith({ username, password, private_mode: false })
  })
})
