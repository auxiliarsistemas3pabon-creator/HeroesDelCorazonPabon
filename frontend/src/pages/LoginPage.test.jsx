import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogin = vi.fn()
let mockUser = null
const mockDetect = vi.fn()

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser, login: mockLogin }) }))
vi.mock('../lib/privateMode', () => ({ detectPrivateMode: () => mockDetect() }))

import { LoginPage } from './LoginPage'

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

function fill(username, password) {
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { name: 'username', value: username } })
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { name: 'password', value: password } })
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockUser = null
    mockDetect.mockResolvedValue(false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('un jefe va al dashboard', async () => {
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    fill('  ana  ', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
    expect(mockLogin).toHaveBeenCalledWith({ username: 'ana', password: 'clave' })
  })

  it('un colaborador va a evaluaciones', async () => {
    mockLogin.mockResolvedValue({ role: 'collaborator' })
    renderPage()
    fill('luis', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('EVALUATIONS')).toBeInTheDocument()
  })

  it('usuario no encontrado', async () => {
    mockLogin.mockRejectedValue({ status: 401, data: { code: 'user_not_found' } })
    renderPage()
    fill('nadie', 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario no encontrado.')
  })

  it('clave incorrecta muestra acceso no autorizado', async () => {
    mockLogin.mockRejectedValue({ status: 401, data: { code: 'unauthorized_access' } })
    renderPage()
    fill('ana', 'mala')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Acceso no autorizado.')
    expect(console.warn).toHaveBeenCalledWith('Permiso no autorizado')
  })

  it('almacenamiento restringido solo avisa y no bloquea el inicio de sesión', async () => {
    mockDetect.mockResolvedValue(true)
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    expect(await screen.findByRole('status')).toHaveTextContent(/navegador habitual/)
    expect(screen.queryByText(/incógnito/)).not.toBeInTheDocument()
    fill('ana', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
  })

  it('cuenta vinculada a otro navegador', async () => {
    mockLogin.mockRejectedValue({ status: 403, data: { code: 'device_not_registered' } })
    renderPage()
    fill('ana', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/vinculada a otro navegador/)
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
