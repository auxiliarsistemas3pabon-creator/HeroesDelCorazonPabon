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

// Los campos se habilitan cuando termina la verificación del navegador.
async function fill(username, password) {
  await waitFor(() => expect(screen.getByLabelText('Usuario')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { name: 'username', value: username } })
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { name: 'password', value: password } })
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockUser = null
    mockDetect.mockResolvedValue(false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('un jefe va al dashboard y envía private_mode=false', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    await fill(`  ${username}  `, password)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
    // El usuario se envía sin los espacios de alrededor.
    expect(mockLogin).toHaveBeenCalledWith({ username, password, private_mode: false })
  })

  it('un colaborador va a evaluaciones', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockResolvedValue({ role: 'collaborator' })
    renderPage()
    await fill(username, password)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('EVALUATIONS')).toBeInTheDocument()
  })

  it('usuario no encontrado', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockRejectedValue({ status: 401, data: { code: 'user_not_found' } })
    renderPage()
    await fill(username, password)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario no encontrado.')
  })

  it('clave incorrecta muestra acceso no autorizado', async () => {
    const { username, password } = randomCredentials()
    mockLogin.mockRejectedValue({ status: 401, data: { code: 'unauthorized_access' } })
    renderPage()
    await fill(username, password)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Acceso no autorizado.')
    expect(console.warn).toHaveBeenCalledWith('Permiso no autorizado')
  })

  it('mientras se verifica el navegador no se puede escribir', async () => {
    let finish
    mockDetect.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Verificando navegador')
    expect(screen.getByLabelText('Usuario')).toBeDisabled()
    expect(screen.getByLabelText(/^Contraseña/)).toBeDisabled()
    finish(false)
    await waitFor(() => expect(screen.getByLabelText('Usuario')).toBeEnabled())
    expect(screen.getByLabelText(/^Contraseña/)).toBeEnabled()
  })

  it('ventana privada: solo muestra el aviso, nada del login', async () => {
    mockDetect.mockResolvedValue(true)
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/ventana privada o de incógnito/)
    expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Contraseña/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument()
    expect(screen.queryByText('Plataforma interna de evaluación del personal.')).not.toBeInTheDocument()
    expect(mockLogin).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('Permiso no autorizado')
  })

  it('si el detector falla, el formulario se habilita (nunca bloquea por error)', async () => {
    mockDetect.mockRejectedValue(new Error('x'))
    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Usuario')).toBeEnabled())
    expect(screen.queryByText(/ventana privada/)).not.toBeInTheDocument()
  })

  it('con sesión activa redirige', async () => {
    mockUser = { role: 'superadmin' }
    renderPage()
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
    await waitFor(() => expect(mockLogin).not.toHaveBeenCalled())
  })

  it('con sesión de colaborador redirige a evaluaciones', async () => {
    mockUser = { role: 'collaborator' }
    renderPage()
    expect(await screen.findByText('EVALUATIONS')).toBeInTheDocument()
  })
})
