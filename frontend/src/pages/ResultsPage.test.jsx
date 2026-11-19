import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
vi.mock('../lib/api', () => ({ api: (...args) => mockApi(...args), errorMessage: () => 'error' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ realtimeEvent: null }) }))

import { ResultsPage } from './ResultsPage'

const EVALUATIONS = [
  { id: 1, name: 'Desempeño grupal', kind: 'group', closes_on: '2099-12-31' },
  { id: 2, name: 'Autoevaluación', kind: 'self', closes_on: '2099-12-31' },
]
const summary = (evaluation, name) => ({
  evaluation,
  categories: [],
  rows: [{ personal: evaluation.id, name, area: 'Enfermería', position: '', by_category: {}, average: '4.0', performed_at: '2026-11-19' }],
})

describe('ResultsPage: tipo de programación', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockApi.mockImplementation((path) => {
      if (path.startsWith('/questions/evaluations/')) return Promise.resolve(EVALUATIONS)
      return Promise.resolve(path.includes('kind=self')
        ? summary(EVALUATIONS[1], 'Persona individual')
        : summary(EVALUATIONS[0], 'Persona grupal'))
    })
  })

  it('por defecto muestra las grupales y al elegir Individual pide solo autoevaluaciones', async () => {
    render(<ResultsPage />)
    expect(await screen.findByText('Persona grupal')).toBeInTheDocument()
    expect(mockApi).toHaveBeenCalledWith(expect.stringMatching(/results-summary\/\?kind=group/))

    fireEvent.click(screen.getByRole('combobox', { name: /Tipo de programación/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Individual (autoevaluación)' }))

    expect(await screen.findByText('Persona individual')).toBeInTheDocument()
    await waitFor(() => expect(mockApi).toHaveBeenLastCalledWith(expect.stringMatching(/kind=self/)))
    // El selector de evaluación solo lista las del tipo elegido.
    fireEvent.click(screen.getByRole('combobox', { name: /^Evaluación/ }))
    expect(screen.getByRole('option', { name: 'Autoevaluación' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Desempeño grupal' })).not.toBeInTheDocument()
  })

  it('Limpiar filtros vuelve a grupales, sin fechas, y queda deshabilitado', async () => {
    render(<ResultsPage />)
    await screen.findByText('Persona grupal')
    const clear = screen.getByRole('button', { name: /Limpiar filtros/ })
    expect(clear).toBeDisabled()

    fireEvent.click(screen.getByRole('combobox', { name: /Tipo de programación/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Individual (autoevaluación)' }))
    await screen.findByText('Persona individual')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(mockApi).toHaveBeenLastCalledWith(expect.stringMatching(/kind=self.*date_from=2026-11-01/)))
    expect(clear).toBeEnabled()

    fireEvent.click(clear)
    expect(await screen.findByText('Persona grupal')).toBeInTheDocument()
    await waitFor(() => expect(mockApi).toHaveBeenLastCalledWith(expect.not.stringMatching(/date_from|kind=self/)))
    expect(screen.getByLabelText('Desde')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Limpiar filtros/ })).toBeDisabled()
  })

  it('en escalas cualitativas muestra el resultado (Bueno) junto al promedio', async () => {
    const descriptive = { id: 3, name: 'Cualitativa', kind: 'group', rating_type: 'descriptive', closes_on: '2099-12-31' }
    mockApi.mockImplementation((path) => Promise.resolve(path.startsWith('/questions/evaluations/')
      ? [descriptive]
      : {
          evaluation: descriptive,
          categories: [{ code: 'a', name: 'Actitud' }],
          rows: [{ personal: 9, name: 'Daniela', area: 'Enfermería', position: '', by_category: { a: '2.8' }, average: '4.6', performed_at: '2026-11-19' }],
        }))
    render(<ResultsPage />)
    expect(await screen.findByText('Bueno')).toBeInTheDocument()
    expect(screen.getByText('2.8')).toBeInTheDocument()
    expect(screen.getByText('Excelente')).toBeInTheDocument()
    expect(screen.getByText('4.6')).toBeInTheDocument()
  })
})
