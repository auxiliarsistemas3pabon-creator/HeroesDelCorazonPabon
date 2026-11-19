import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
vi.mock('../lib/api', () => ({ api: (...args) => mockApi(...args), errorMessage: (e) => e.message }))

import { CreateUserPage } from './CreateUserPage'

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })
}

function fillForm() {
  fill('Documento', '1098765432')
  fill('Nombres', 'Daniela')
  fill('Apellidos', 'Ortiz')
  fill('Cargo', 'Enfermera profesional')
  fireEvent.change(screen.getByRole('combobox', { name: /Área/ }), { target: { value: 'Enfermería' } })
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'Clave-segura-2026' } })
  fill('Confirmar contraseña', 'Clave-segura-2026')
}

describe('CreateUserPage', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockApi.mockImplementation((path) => {
      if (path === '/users/areas/') return Promise.resolve(['Enfermería'])
      if (path === '/users/register/') return Promise.resolve({ id: 7, username: '1098765432' })
      return Promise.resolve({ id: 7, role: 'boss' })
    })
  })

  it('crea un colaborador sin enviar el rol al registro', async () => {
    render(<MemoryRouter><CreateUserPage /></MemoryRouter>)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /Crear usuario/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('creado como Colaborador')
    const [, options] = mockApi.mock.calls.find(([path]) => path === '/users/register/')
    expect(options.body).toEqual({
      username: '1098765432', first_name: 'Daniela', last_name: 'Ortiz', area: 'Enfermería', position: 'Enfermera profesional', password: 'Clave-segura-2026',
    })
    expect(mockApi.mock.calls.some(([path]) => path.startsWith('/users/admin/'))).toBe(false)
  })

  it('con otro rol lo asigna después del registro', async () => {
    render(<MemoryRouter><CreateUserPage /></MemoryRouter>)
    fillForm()
    fireEvent.click(screen.getByRole('combobox', { name: /Rol/ }))
    fireEvent.click(screen.getByRole('option', { name: /^Coordinador/ }))
    fireEvent.click(screen.getByRole('button', { name: /Crear usuario/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('creado como Coordinador')
    expect(mockApi).toHaveBeenCalledWith('/users/admin/7/', { method: 'PATCH', body: { role: 'boss' } })
  })

  it('no envía nada si las contraseñas no coinciden', () => {
    render(<MemoryRouter><CreateUserPage /></MemoryRouter>)
    fillForm()
    fill('Confirmar contraseña', 'otra-clave-123')
    fireEvent.click(screen.getByRole('button', { name: /Crear usuario/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden')
    expect(mockApi.mock.calls.some(([path]) => path === '/users/register/')).toBe(false)
  })
})
