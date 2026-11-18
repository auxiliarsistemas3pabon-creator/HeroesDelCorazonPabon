import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogin = vi.fn()
const mockVerify = vi.fn()
let mockUser = null
const mockDetect = vi.fn()

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser, login: mockLogin, verifyMfa: mockVerify }) }))
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:image/png;base64,QR') } }))
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

  it('un jefe va al dashboard y envía private_mode=false', async () => {
    mockLogin.mockResolvedValue({ role: 'boss' })
    renderPage()
    fill('  ana  ', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument()
    expect(mockLogin).toHaveBeenCalledWith({ username: 'ana', password: 'clave', private_mode: false })
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

  it('ventana privada bloquea el formulario', async () => {
    mockDetect.mockResolvedValue(true)
    renderPage()
    expect(await screen.findByText(/ventana privada o de incógnito/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Iniciar sesión' }).closest('form'))
    expect(mockLogin).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('Permiso no autorizado')
  })

  it('primer login: muestra el QR y entra al confirmar el código', async () => {
    mockLogin.mockResolvedValue({ mfa_required: true, mfa_token: 'tok', enrollment: { secret: 'ABCDEF', otpauth_uri: 'otpauth://totp/x' } })
    mockVerify.mockResolvedValue({ role: 'collaborator' })
    renderPage()
    fill('luis', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('Activa la doble autenticación')).toBeInTheDocument()
    expect(await screen.findByAltText(/Código QR/)).toHaveAttribute('src', 'data:image/png;base64,QR')
    expect(screen.getByText('ABCDEF')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código de verificación'), { target: { value: '12a3456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }))
    expect(await screen.findByText('EVALUATIONS')).toBeInTheDocument()
    expect(mockVerify).toHaveBeenCalledWith('tok', '123456')
  })

  it('navegador no reconocido: pide solo el código y muestra el error si es incorrecto', async () => {
    mockLogin.mockResolvedValue({ mfa_required: true, mfa_token: 'tok' })
    mockVerify.mockRejectedValue({ status: 401, data: { code: 'mfa_invalid' } })
    renderPage()
    fill('ana', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('Verificación en dos pasos')).toBeInTheDocument()
    expect(screen.queryByAltText(/Código QR/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código de verificación'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto')
  })

  it('desafío vencido vuelve al formulario de contraseña', async () => {
    mockLogin.mockResolvedValue({ mfa_required: true, mfa_token: 'tok' })
    mockVerify.mockRejectedValue({ status: 401, data: { code: 'mfa_expired' } })
    renderPage()
    fill('ana', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    fireEvent.change(await screen.findByLabelText('Código de verificación'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('venció')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('volver cancela el segundo paso', async () => {
    mockLogin.mockResolvedValue({ mfa_required: true, mfa_token: 'tok' })
    renderPage()
    fill('ana', 'clave')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Volver al inicio de sesión' }))
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
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
