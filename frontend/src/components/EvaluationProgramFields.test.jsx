import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EvaluationProgramFields } from './EvaluationProgramFields'

describe('EvaluationProgramFields', () => {
  it('permite editar la cantidad en selección manual y aleatoria', () => {
    const setValue = vi.fn()
    const program = {
      availableAreas: [], value: '3', setValue,
      randomSelection: false, setRandomSelection: vi.fn(),
      closeDate: '', setCloseDate: vi.fn(), selectedAreas: null,
      toggleArea: vi.fn(), selectAllAreas: vi.fn(), scopedStaff: [], scopedEvaluators: [],
      allAreasSelected: true, evaluatorIds: null, setAllEvaluators: vi.fn(),
      toggleEvaluator: vi.fn(), evaluatorsInvalid: false, validLimit: true, maxLimit: 12,
      hasChanges: true, loading: false, busy: false, error: null, message: null,
      submit: vi.fn(),
    }

    const { rerender } = render(<EvaluationProgramFields program={program} createNew />)
    const countInput = screen.getByRole('spinbutton', { name: /Usuarios/ })
    fireEvent.change(countInput, { target: { value: '12' } })

    expect(setValue).toHaveBeenCalledWith('12')
    expect(countInput).toHaveAttribute('min', '1')
    // El máximo es el del grupo seleccionado (personas menos 1), no un 30 fijo.
    expect(countInput).toHaveAttribute('max', '12')
    expect(screen.getByText(/Máximo 12: las personas del grupo seleccionado menos 1/)).toBeInTheDocument()
    expect(countInput).toHaveAccessibleName(/Usuarios/)

    setValue.mockClear()
    program.randomSelection = true
    rerender(<EvaluationProgramFields program={program} createNew />)
    fireEvent.change(screen.getByRole('spinbutton', { name: /Usuarios/ }), { target: { value: '7' } })
    expect(setValue).toHaveBeenCalledWith('7')
  })

  it('individual (autoevaluación): el formulario solo llega hasta la fecha de cierre', () => {
    const program = {
      availableAreas: ['Enfermería'], value: '', setValue: vi.fn(),
      randomSelection: false, setRandomSelection: vi.fn(),
      closeDate: '', setCloseDate: vi.fn(), selectedAreas: null,
      toggleArea: vi.fn(), selectAllAreas: vi.fn(), scopedStaff: [], scopedEvaluators: [],
      allAreasSelected: true, evaluatorIds: null, setAllEvaluators: vi.fn(),
      toggleEvaluator: vi.fn(), evaluatorsInvalid: false, validLimit: true, maxLimit: 0, isSelf: true,
      hasChanges: true, loading: false, busy: false, error: null, message: null,
      submit: vi.fn(),
    }
    render(<EvaluationProgramFields program={program} createNew />)
    expect(screen.getByText('Fecha de cierre')).toBeInTheDocument()
    expect(screen.getByText(/Autoevaluación: cada colaborador/)).toBeInTheDocument()
    expect(screen.queryByText('Selección de usuarios')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Usuarios/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear evaluación programada' })).toBeEnabled()
  })
})
