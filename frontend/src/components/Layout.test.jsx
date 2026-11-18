import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

let mockRole = 'boss'
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: mockRole, first_name: 'Demo', last_name: 'Ficticio' },
    loading: false, logout: vi.fn(), realtimeStatus: 'connected', realtimeNotice: '',
  }),
}))

import { Layout } from './Layout'

function renderMenu(role) {
  mockRole = role
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
})
