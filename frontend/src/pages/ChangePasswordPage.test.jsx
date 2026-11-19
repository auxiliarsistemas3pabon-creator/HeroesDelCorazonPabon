import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
const mockUpdateUser = vi.fn()
vi.mock('../lib/api', () => ({ api: (...args) => mockApi(...args), errorMessage: (e) => e.message }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ updateUser: mockUpdateUser }) }))

import { ChangePasswordForm } from './ChangePasswordPage'

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockUpdateUser.mockReset()
  })

  it('envía la clave actual y la nueva, y actualiza la sesión', async () => {
    const user = { id: 1, password_change_required: false }
    mockApi.mockResolvedValue(user)
    render(<ChangePasswordForm forced />)
    fill('Contraseña inicial', 'Pabon2026*')
    fill(/^Nueva contraseña/, 'Corazon-Nuevo-2026!')
    fill('Confirmar nueva contraseña', 'Corazon-Nuevo-2026!')
    fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada.')
    expect(mockApi).toHaveBeenCalledWith('/auth/password-change/', {
      method: 'POST', body: { current_password: 'Pabon2026*', new_password: 'Corazon-Nuevo-2026!' },
    })
    expect(mockUpdateUser).toHaveBeenCalledWith(user)
  })

  it('no envía nada si la confirmación no coincide', () => {
    render(<ChangePasswordForm />)
    fill('Contraseña actual', 'Actual-123456')
    fill(/^Nueva contraseña/, 'Corazon-Nuevo-2026!')
    fill('Confirmar nueva contraseña', 'otra-cosa-2026')
    fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden')
    expect(mockApi).not.toHaveBeenCalled()
  })

  it('muestra el error del backend (p. ej. clave actual incorrecta)', async () => {
    mockApi.mockRejectedValue(new Error('La contraseña actual es incorrecta.'))
    render(<ChangePasswordForm />)
    fill('Contraseña actual', 'mal-123456')
    fill(/^Nueva contraseña/, 'Corazon-Nuevo-2026!')
    fill('Confirmar nueva contraseña', 'Corazon-Nuevo-2026!')
    fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrecta')
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })
})
