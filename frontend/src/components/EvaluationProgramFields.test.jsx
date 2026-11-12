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
      toggleEvaluator: vi.fn(), evaluatorsInvalid: false, validLimit: true,
      hasChanges: true, loading: false, busy: false, error: null, message: null,
      submit: vi.fn(),
    }

    const { rerender } = render(<EvaluationProgramFields program={program} createNew />)
    const countInput = screen.getByRole('spinbutton', { name: /Usuarios/ })
    fireEvent.change(countInput, { target: { value: '12' } })

    expect(setValue).toHaveBeenCalledWith('12')
    expect(countInput).toHaveAttribute('min', '1')
    expect(countInput).toHaveAttribute('max', '30')
    expect(countInput).toHaveAccessibleName(/Usuarios/)

    setValue.mockClear()
    program.randomSelection = true
    rerender(<EvaluationProgramFields program={program} createNew />)
    fireEvent.change(screen.getByRole('spinbutton', { name: /Usuarios/ }), { target: { value: '7' } })
    expect(setValue).toHaveBeenCalledWith('7')
  })
})
