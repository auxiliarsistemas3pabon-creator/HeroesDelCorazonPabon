import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
vi.mock('./api', () => ({ api: (...args) => mockApi(...args), errorMessage: (e) => e?.message ?? 'error' }))

import { today } from './dates'
import { largestGroupMinusOne, useEvaluationProgram } from './useEvaluationProgram'

describe('máximo de usuarios por grupo', () => {
  const people = (area, n) => Array.from({ length: n }, () => ({ area }))

  it('es el número de personas del grupo menos 1', () => {
    expect(largestGroupMinusOne(people('Enfermería', 8))).toBe(7)
  })
  it('con varias áreas manda la más grande', () => {
    expect(largestGroupMinusOne([...people('Enfermería', 8), ...people('Urgencias', 3)])).toBe(7)
  })
  it('tope de 30 y 0 si el grupo no tiene a quién evaluar', () => {
    expect(largestGroupMinusOne(people('Grande', 50))).toBe(30)
    expect(largestGroupMinusOne(people('Solo', 1))).toBe(0)
    expect(largestGroupMinusOne([])).toBe(0)
  })
})

const PAST = '2000-01-01'

function editHook(evaluation) {
  const staff = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, area: 'Enfermería' }))
  return renderHook(() => useEvaluationProgram({ evaluation, staff, onSaved: vi.fn() }))
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

  it('no deja pasar más usuarios que las personas del grupo menos 1', async () => {
    const { result } = editHook({ id: 7, name: 'Desempeño', areas: null, closes_on: today(), evaluator_ids: [] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.maxLimit).toBe(5)
    act(() => result.current.setValue('6'))
    expect(result.current.validLimit).toBe(false)
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toMatch(/entre 1 y 5 \(las personas del grupo menos 1\)/)
    act(() => result.current.setValue('5'))
    expect(result.current.validLimit).toBe(true)
  })

  it('individual: crea la autoevaluación sin cantidad ni modo', async () => {
    mockApi.mockImplementation((path) => Promise.resolve(path.includes('/programs/') ? { id: 99, name: 'Desempeño' } : []))
    const { result } = renderHook(() => useEvaluationProgram({
      evaluation: { id: 7, name: 'Desempeño' }, staff: [{ id: 1, area: 'Enfermería' }], onSaved: vi.fn(),
      createNew: true, kind: 'self',
    }))
    expect(result.current.isSelf).toBe(true)
    expect(result.current.validLimit).toBe(true) // aunque el grupo sea de 1 persona: no hay cantidad
    act(() => result.current.setCloseDate(today()))
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toBe(null)
    const body = mockApi.mock.calls.find(([path]) => path.includes('/programs/'))[1].body
    expect(body.kind).toBe('self')
    expect(body).not.toHaveProperty('monthly_limit')
    expect(body).not.toHaveProperty('random_selection')
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
