import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.fn()
vi.mock('./api', () => ({ api: (...args) => mockApi(...args) }))

import { useEvaluationForms } from './useEvaluationForms'

describe('useEvaluationForms', () => {
  beforeEach(() => mockApi.mockReset())

  it('sin items no pide nada', () => {
    const { result } = renderHook(() => useEvaluationForms(undefined))
    expect(result.current).toEqual({})
    expect(mockApi).not.toHaveBeenCalled()
  })

  it('pide un formulario por evaluación única y tolera fallos', async () => {
    mockApi.mockResolvedValueOnce([{ id: 1 }]).mockRejectedValueOnce(new Error('x'))
    const items = [{ evaluation: 1 }, { evaluation: 1 }, { evaluation: 2 }]
    const { result } = renderHook(() => useEvaluationForms(items))
    await waitFor(() => expect(result.current).toEqual({ 1: [{ id: 1 }], 2: [] }))
    expect(mockApi).toHaveBeenCalledTimes(2)
  })
})
