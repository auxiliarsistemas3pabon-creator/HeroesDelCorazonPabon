import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
vi.mock('../lib/api', () => ({ api: (...args) => mockApi(...args), errorMessage: () => 'error' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'boss' } }) }))

import { EvaluationsListPage } from './EvaluationsListPage'

const base = { name: 'Desempeño', areas: ['Enfermería'], closes_on: '2099-12-31', status: 'available', pending_evaluators: [] }
const EVALUATIONS = [
  { ...base, id: 1, name: 'Completa', evaluations_total: 4, evaluations_done: 4, evaluations_pending: 0 },
  { ...base, id: 2, name: 'En curso', evaluations_total: 4, evaluations_done: 1, evaluations_pending: 3 },
  { ...base, id: 3, name: 'Sin asignados', evaluations_total: 0, evaluations_done: 0, evaluations_pending: 0 },
]

function editButton(name) {
  const row = screen.getByText(name).closest('tr')
  return within(row).getByRole('button', { name: 'Editar programación' })
}

describe('EvaluationsListPage: edición según evaluaciones pendientes', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockApi.mockImplementation((path) => Promise.resolve(path.startsWith('/questions/evaluations/') ? EVALUATIONS : []))
  })

  it('con 0 pendientes la edición queda bloqueada automáticamente', async () => {
    render(<EvaluationsListPage />)
    await screen.findByText('Completa')
    expect(editButton('Completa')).toBeDisabled()
    expect(editButton('Completa')).toHaveAttribute('title', expect.stringMatching(/ya no se puede editar/))
  })

  it('con evaluaciones pendientes se puede editar', async () => {
    render(<EvaluationsListPage />)
    await screen.findByText('En curso')
    expect(editButton('En curso')).toBeEnabled()
  })

  it('una programación sin evaluaciones asignadas no se bloquea (hay que poder corregirla)', async () => {
    render(<EvaluationsListPage />)
    await screen.findByText('Sin asignados')
    expect(editButton('Sin asignados')).toBeEnabled()
  })
})
