import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

let mockRole = 'boss'
let mockMustChange = false
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: mockRole, first_name: 'Demo', last_name: 'Ficticio', password_change_required: mockMustChange },
    loading: false, logout: vi.fn(), updateUser: vi.fn(), realtimeStatus: 'connected', realtimeNotice: '',
  }),
}))

import { Layout } from './Layout'

function renderMenu(role, mustChange = false) {
  mockRole = role
  mockMustChange = mustChange
  render(<MemoryRouter initialEntries={['/program/individual']}><Layout /></MemoryRouter>)
}

describe('Layout: submenú de Programar evaluación', () => {
  for (const role of ['boss', 'superadmin']) {
    it(`${role}: Programar evaluación tiene Grupales e Individuales`, () => {
      renderMenu(role)
      const group = screen.getByRole('group', { name: 'Programar evaluación' })
      expect(within(group).getByRole('link', { name: 'Grupales' })).toHaveAttribute('href', '/program')
      const individual = within(group).getByRole('link', { name: 'Individuales' })
      expect(individual).toHaveAttribute('href', '/program/individual')
      expect(individual).toHaveAttribute('aria-current', 'page')
    })
  }

  it('el colaborador no ve el submenú y tiene sus dos módulos: Evaluar y Autoevaluación', () => {
    renderMenu('collaborator')
    expect(screen.queryByRole('group', { name: 'Programar evaluación' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Evaluar' })).toHaveAttribute('href', '/evaluations')
    expect(screen.getByRole('link', { name: 'Autoevaluación' })).toHaveAttribute('href', '/self-evaluation')
  })

  it('el coordinador también tiene Evaluar y Autoevaluación; el superadmin no', () => {
    renderMenu('boss')
    expect(screen.getByRole('link', { name: 'Evaluar' })).toHaveAttribute('href', '/evaluations')
    expect(screen.getByRole('link', { name: 'Autoevaluación' })).toHaveAttribute('href', '/self-evaluation')
  })

  it('el superadmin no tiene los módulos de colaborador y sí el submenú Usuarios', () => {
    renderMenu('superadmin')
    expect(screen.queryByRole('link', { name: 'Evaluar' })).not.toBeInTheDocument()
    const users = screen.getByRole('group', { name: 'Usuarios' })
    expect(within(users).getByRole('link', { name: 'Crear usuario' })).toHaveAttribute('href', '/users/create')
  })
})

describe('Layout: cabecera y contraseña', () => {
  it('el superadmin se muestra como Superadministrador y todos tienen Cambiar contraseña', () => {
    renderMenu('superadmin')
    expect(screen.getByText('Superadministrador')).toBeInTheDocument()
    expect(screen.queryByText('Administrador')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cambiar contraseña' })).toHaveAttribute('href', '/account/password')
  })

  it('con la contraseña inicial solo se muestra el cambio obligatorio, sin menú', () => {
    renderMenu('collaborator', true)
    expect(screen.getByRole('heading', { name: 'Cambia tu contraseña' })).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña inicial')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Evaluar' })).not.toBeInTheDocument()
  })
})
