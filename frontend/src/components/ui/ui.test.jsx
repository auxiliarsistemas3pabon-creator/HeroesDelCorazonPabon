import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AutocompleteSelect } from './AutocompleteSelect'
import { Badge } from './Badge'
import { Card, CardHeader } from './Card'
import { DateRangeFilter } from './DateRangeFilter'
import { EvaluationSelect } from './EvaluationSelect'
import { PasswordInput } from '../PasswordInput'

const options = [
  { value: 'a', label: 'Ángel' },
  { value: 'b', label: 'Beatriz' },
]

describe('Badge y Card', () => {
  it('renderiza tonos', () => {
    render(<><Badge tone="success">ok</Badge><Badge>neutro</Badge></>)
    expect(screen.getByText('ok').className).toContain('emerald')
    expect(screen.getByText('neutro')).toBeInTheDocument()
  })
  it('Card y CardHeader', () => {
    render(<Card padding="sm" data-testid="c"><CardHeader title="T" subtitle="S" action={<b>x</b>} /></Card>)
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.getByTestId('c').className).toContain('p-4')
    render(<CardHeader title="Solo" />)
    expect(screen.getByText('Solo')).toBeInTheDocument()
  })
})

describe('PasswordInput', () => {
  it('alterna la visibilidad', () => {
    render(<PasswordInput aria-label="clave" defaultValue="x" />)
    const input = screen.getByLabelText('clave')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(input).toHaveAttribute('type', 'password')
  })
})

describe('DateRangeFilter', () => {
  it('propaga cambios y limita el rango', () => {
    const onChange = vi.fn()
    render(<DateRangeFilter from="2026-01-01" to="2026-02-01" onChange={onChange} />)
    const [from, to] = screen.getAllByDisplayValue(/2026/)
    expect(from).toHaveAttribute('max', '2026-02-01')
    expect(to).toHaveAttribute('min', '2026-01-01')
    fireEvent.change(from, { target: { value: '2026-01-05' } })
    fireEvent.change(to, { target: { value: '2026-02-10' } })
    expect(onChange).toHaveBeenNthCalledWith(1, { from: '2026-01-05', to: '2026-02-01' })
    expect(onChange).toHaveBeenNthCalledWith(2, { from: '2026-01-01', to: '2026-02-10' })
  })
  it('sin valores no pone límites', () => {
    render(<DateRangeFilter from="" to="" onChange={() => {}} />)
    expect(screen.getByLabelText('Desde')).not.toHaveAttribute('max')
  })
})

describe('AutocompleteSelect', () => {
  it('filtra sin tildes y elige con clic', () => {
    const onChange = vi.fn()
    render(<AutocompleteSelect options={options} value="" onChange={onChange} placeholder="Elige" />)
    const input = screen.getByPlaceholderText('Elige')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'angel' } })
    expect(screen.queryByText('Beatriz')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Ángel' }))
    expect(onChange).toHaveBeenCalledWith('a')
  })
  it('muestra sin coincidencias', () => {
    render(<AutocompleteSelect options={options} value="" onChange={() => {}} placeholder="Elige" />)
    const input = screen.getByPlaceholderText('Elige')
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText('Sin coincidencias.')).toBeInTheDocument()
  })
  it('navega con teclado y cierra con Escape', () => {
    const onChange = vi.fn()
    render(<AutocompleteSelect options={options} value="" onChange={onChange} placeholder="Elige" />)
    const input = screen.getByPlaceholderText('Elige')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('Enter sin lista abierta no hace nada y mouseEnter marca activo', () => {
    const onChange = vi.fn()
    render(<AutocompleteSelect options={options} value="" onChange={onChange} placeholder="Elige" />)
    const input = screen.getByPlaceholderText('Elige')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(input)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Beatriz' }))
    expect(screen.getByRole('option', { name: 'Beatriz' }).className).toContain('bg-primary')
  })
  it('cierra al hacer clic fuera', () => {
    render(<div><AutocompleteSelect options={options} value="" onChange={() => {}} placeholder="Elige" /><p>fuera</p></div>)
    fireEvent.click(screen.getByPlaceholderText('Elige'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByPlaceholderText('Elige'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('fuera'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('con valor elegido muestra un botón y reabre al hacer clic', () => {
    render(<AutocompleteSelect options={options} value="b" onChange={() => {}} />)
    const button = screen.getByRole('combobox')
    expect(button).toHaveTextContent('Beatriz')
    fireEvent.click(button)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
  it('allowCustom propaga el texto escrito', () => {
    const onChange = vi.fn()
    render(<AutocompleteSelect options={options} value="Libre" onChange={onChange} allowCustom />)
    const input = screen.getByRole('combobox')
    expect(input).toHaveValue('Libre')
    fireEvent.change(input, { target: { value: 'Nuevo' } })
    expect(onChange).toHaveBeenCalledWith('Nuevo')
  })
  it('usa key explícita', () => {
    render(<AutocompleteSelect options={[{ value: 'x', label: 'X', key: 'k1' }]} value="" onChange={() => {}} placeholder="P" />)
    fireEvent.click(screen.getByPlaceholderText('P'))
    expect(screen.getByRole('option', { name: 'X' })).toBeInTheDocument()
  })
})

describe('EvaluationSelect', () => {
  const evaluations = [
    { id: 1, name: 'Anual', closes_on: '2026-03-31' },
    { id: 2, name: 'anual ', closes_on: null },
    { id: 3, name: 'Semestral', closes_on: '2026-06-30' },
  ]
  it('agrupa por nombre y elige la más reciente', () => {
    const onChange = vi.fn()
    render(<EvaluationSelect evaluations={evaluations} value="" onChange={onChange} />)
    fireEvent.click(screen.getByPlaceholderText('Selecciona evaluación'))
    fireEvent.click(screen.getByRole('option', { name: 'anual' }))
    expect(onChange).toHaveBeenCalledWith('2')
  })
  it('muestra segundo selector con versiones y fechas', () => {
    render(<EvaluationSelect evaluations={evaluations} value="2" onChange={() => {}} showDate />)
    expect(screen.getByText(/elige una/)).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Sin fecha')
  })
  it('una sola versión no muestra segundo selector', () => {
    render(<EvaluationSelect evaluations={[evaluations[2]]} value="3" onChange={() => {}} showDate />)
    expect(screen.queryByText(/elige una/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('Cierra')
  })
})
