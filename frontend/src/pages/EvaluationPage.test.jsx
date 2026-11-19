import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvaluationPage } from './EvaluationPage'

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mockApi, errorMessage: vi.fn() }))

const people = Array.from({ length: 24 }, (_, index) => ({
  id: index + 1,
  first_name: `Persona${index + 1}`,
  last_name: 'Prueba',
  area: 'Sistemas',
}))

describe('EvaluationPage', () => {
  beforeEach(() => {
    mockApi.mockImplementation((path) => {
      if (path === '/questions/evaluations/?participant=1') return Promise.resolve([{
        id: 10, name: 'Evaluación de prueba', areas: null, rating_type: 'quantitative',
        random_selection: false, remaining: 30, closes_on: null,
      }])
      if (path.startsWith('/questions/form/')) return Promise.resolve([])
      if (path === '/users/collaborators/') return Promise.resolve(people)
      if (path.startsWith('/questions/quota/')) return Promise.resolve({ limit: 30, used: 0, personal: [], assigned: null })
      return Promise.resolve([])
    })
  })

  it('con una sola evaluación muestra primero la tarjeta y no entra directo al formulario', async () => {
    render(<EvaluationPage />)
    expect(await screen.findByRole('button', { name: /Evaluación de prueba/ })).toBeInTheDocument()
    expect(screen.getByText('30 por evaluar')).toBeInTheDocument()
    expect(screen.queryByText('Persona1 Prueba')).not.toBeInTheDocument()
  })

  it('muestra 23 colaboradores por página y conserva la navegación al resto', async () => {
    render(<EvaluationPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Evaluación de prueba/ }))
    await screen.findByText('Persona23 Prueba')
    expect(screen.queryByText('Persona24 Prueba')).not.toBeInTheDocument()
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await waitFor(() => expect(screen.getByText('Persona24 Prueba')).toBeInTheDocument())
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument()
  })
})
