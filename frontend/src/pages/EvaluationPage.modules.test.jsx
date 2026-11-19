// Colaborador: dos módulos separados, «Evaluar» (grupales) y «Autoevaluación» (individuales).
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mockApi, errorMessage: vi.fn() }))
const me = { id: 7, first_name: 'Yo', last_name: 'Mismo', area: 'Enfermería' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: me }) }))

import { EvaluationPage } from './EvaluationPage'

const base = { areas: null, rating_type: 'quantitative', random_selection: false, closes_on: null, categories: 1, criteria: 1 }
const EVALUATIONS = [
  { ...base, id: 1, name: 'Grupal de desempeño', kind: 'group', remaining: 3 },
  { ...base, id: 2, name: 'Antigua sin tipo', remaining: 2 }, // anterior al cambio: cuenta como grupal
  { ...base, id: 3, name: 'Mi autoevaluación', kind: 'self', remaining: 1 },
]
const colleagues = [{ id: 20, first_name: 'Compañera', last_name: 'Área', area: 'Enfermería' }]

describe('EvaluationPage: módulos del colaborador', () => {
  beforeEach(() => {
    mockApi.mockImplementation((path) => {
      if (path === '/questions/evaluations/?participant=1') return Promise.resolve(EVALUATIONS)
      if (path.startsWith('/questions/form/')) return Promise.resolve([{ name: 'C', criteria: [{ code: 'c1', name: 'Pregunta' }] }])
      if (path === '/users/collaborators/') return Promise.resolve(colleagues)
      if (path.startsWith('/questions/quota/')) return Promise.resolve({ limit: 1, used: 0, personal: [], assigned: null })
      return Promise.resolve([])
    })
  })

  it('Evaluar muestra solo las grupales', async () => {
    render(<EvaluationPage kind="group" />)
    expect(await screen.findByText('ESCALA DE VALORACIÓN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Grupal de desempeño/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Antigua sin tipo/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mi autoevaluación/ })).not.toBeInTheDocument()
  })

  it('Autoevaluación muestra solo las individuales', async () => {
    render(<EvaluationPage kind="self" />)
    expect(await screen.findByText('AUTOEVALUACIÓN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mi autoevaluación/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Grupal de desempeño/ })).not.toBeInTheDocument()
  })

  it('en la autoevaluación la única persona a evaluar es el propio colaborador', async () => {
    render(<EvaluationPage kind="self" />)
    fireEvent.click(await screen.findByRole('button', { name: /Mi autoevaluación/ }))
    expect(await screen.findByText(/Autoevaluación: califícate a ti mismo/)).toBeInTheDocument()
    // No hay a quién elegir: no aparece "Usuarios a evaluar" ni los contadores, solo su tabla de calificación.
    expect(await screen.findByText('Tu autoevaluación')).toBeInTheDocument()
    expect(screen.queryByText(/Usuarios a evaluar/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Seleccionados/)).not.toBeInTheDocument()
    expect(screen.queryByText('Compañera Área')).not.toBeInTheDocument()
  })

  it('autoevaluación ya respondida: solo el aviso de realizada', async () => {
    mockApi.mockImplementation((path) => {
      if (path === '/questions/evaluations/?participant=1') return Promise.resolve(EVALUATIONS)
      if (path.startsWith('/questions/form/')) return Promise.resolve([{ name: 'C', criteria: [{ code: 'c1', name: 'Pregunta' }] }])
      if (path.startsWith('/questions/quota/')) return Promise.resolve({ limit: 1, used: 1, personal: [me.id], assigned: null })
      return Promise.resolve([])
    })
    render(<EvaluationPage kind="self" />)
    fireEvent.click(await screen.findByRole('button', { name: /Mi autoevaluación/ }))
    expect(await screen.findByText('Autoevaluación realizada con éxito.')).toBeInTheDocument()
    expect(screen.queryByText(/Usuarios a evaluar/)).not.toBeInTheDocument()
    expect(screen.queryByText('Tu autoevaluación')).not.toBeInTheDocument()
  })

  it('en las grupales sigue apareciendo "Usuarios a evaluar"', async () => {
    render(<EvaluationPage kind="group" />)
    fireEvent.click(await screen.findByRole('button', { name: /Grupal de desempeño/ }))
    expect(await screen.findByText(/Usuarios a evaluar/)).toBeInTheDocument()
  })

  it('sin individuales abiertas avisa en su propio módulo', async () => {
    mockApi.mockImplementation((path) => Promise.resolve(path === '/questions/evaluations/?participant=1' ? [EVALUATIONS[0]] : []))
    render(<EvaluationPage kind="self" />)
    expect(await screen.findByText('No hay autoevaluaciones abiertas en este momento.')).toBeInTheDocument()
  })
})
