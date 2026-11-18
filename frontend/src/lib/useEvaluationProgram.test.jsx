import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
vi.mock('./api', () => ({ api: (...args) => mockApi(...args), errorMessage: (e) => e?.message ?? 'error' }))

import { today } from './dates'
import { useEvaluationProgram } from './useEvaluationProgram'

const PAST = '2000-01-01'

function editHook(evaluation) {
  return renderHook(() => useEvaluationProgram({ evaluation, staff: [{ area: 'Enfermería' }], onSaved: vi.fn() }))
}

describe('useEvaluationProgram: fecha de cierre', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockApi.mockImplementation((path) => Promise.resolve(path.startsWith('/questions/settings/') ? { monthly_limit: 3 } : []))
  })

  it('al editar, el calendario siempre empieza hoy aunque la fecha guardada sea anterior', async () => {
    const { result } = editHook({ id: 7, name: 'Desempeño', areas: null, closes_on: PAST, evaluator_ids: [] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.minCloseDate).toBe(today())
  })

  it('no guarda una programación con fecha anterior a hoy, aunque no se haya cambiado', async () => {
    const { result } = editHook({ id: 7, name: 'Desempeño', areas: null, closes_on: PAST, evaluator_ids: [] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.setRandomSelection(true))
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toBe('La fecha de cierre debe ser igual o posterior a la fecha actual.')
    expect(mockApi).not.toHaveBeenCalledWith('/questions/evaluations/7/', expect.anything())
  })

  it('con la fecha de hoy sí guarda', async () => {
    const { result } = editHook({ id: 7, name: 'Desempeño', areas: null, closes_on: PAST, evaluator_ids: [] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.setCloseDate(today()))
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toBe(null)
    expect(mockApi).toHaveBeenCalledWith('/questions/evaluations/7/', expect.objectContaining({ method: 'PATCH' }))
  })
})
