import { describe, expect, it, vi } from 'vitest'
import { DateGrain } from './date'
import { formatDay, today } from './dates'
import { mediaUrl } from './media'
import { cn } from './cn'
import { RATING_SCALES, averageLabel, ratingLabel, ratingScale } from './ratingScales'

describe('utilidades', () => {
  it('DateGrain es inmutable', () => {
    expect(DateGrain).toEqual(['day', 'month', 'year'])
    expect(Object.isFrozen(DateGrain)).toBe(true)
  })
  it('today devuelve YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('formatDay formatea y tolera vacío', () => {
    expect(formatDay('')).toBe('')
    expect(formatDay('2026-10-31')).toContain('2026')
  })
  it('mediaUrl convierte png en webp', () => {
    expect(mediaUrl('logo.png')).toBe('/branding/logo.webp')
    expect(mediaUrl('foto.JPG')).toBe('/branding/foto.JPG')
  })
  it('cn descarta valores vacíos', () => {
    expect(cn('a', false, null, 'b')).toBe('a b')
  })
  it('ratingScale cae a cuantitativa si el tipo no existe', () => {
    expect(ratingScale()).toBe(RATING_SCALES.quantitative)
    expect(ratingScale('xx')).toBe(RATING_SCALES.quantitative)
    expect(ratingScale('descriptive').max).toBe(5)
  })
  it('ratingLabel devuelve etiqueta o la nota tal cual', () => {
    expect(ratingLabel('descriptive', 5)).toBe('Excelente')
    expect(ratingLabel('descriptive_compliance', 0)).toBe('No aplica')
    expect(ratingLabel('quantitative', 9)).toBe(9)
  })

  it('averageLabel redondea el promedio al nivel cualitativo más cercano', () => {
    expect(averageLabel('descriptive', '2.8')).toBe('Bueno')
    expect(averageLabel('descriptive_performance', 4.5)).toBe('Excelente')
    expect(averageLabel('descriptive_compliance', 0.4)).toBe('No cumple')
    expect(averageLabel('quantitative', 4)).toBeNull()
    expect(averageLabel('descriptive', null)).toBeNull()
  })
  it('vi disponible', () => expect(vi).toBeDefined())
})
