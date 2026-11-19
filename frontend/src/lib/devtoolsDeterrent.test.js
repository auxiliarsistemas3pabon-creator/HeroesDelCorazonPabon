import { afterEach, describe, expect, it } from 'vitest'
import { blockedShortcut, installDevtoolsDeterrent } from './devtoolsDeterrent'

describe('devtoolsDeterrent (disuasión)', () => {
  let uninstall = () => {}
  afterEach(() => { uninstall(); document.body.innerHTML = '' })

  it('reconoce los atajos de las herramientas de desarrollo', () => {
    expect(blockedShortcut({ key: 'F12' })).toBe(true)
    expect(blockedShortcut({ key: 'i', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(blockedShortcut({ key: 'J', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(blockedShortcut({ key: 'u', ctrlKey: true })).toBe(true)
    // Atajos normales siguen funcionando: copiar, pegar, buscar.
    expect(blockedShortcut({ key: 'c', ctrlKey: true })).toBe(false)
    expect(blockedShortcut({ key: 'v', ctrlKey: true })).toBe(false)
    expect(blockedShortcut({ key: 'f', ctrlKey: true })).toBe(false)
  })

  it('cancela F12 y el clic derecho fuera de los campos, pero no dentro de ellos', () => {
    uninstall = installDevtoolsDeterrent(window)
    const f12 = new KeyboardEvent('keydown', { key: 'F12', cancelable: true })
    window.dispatchEvent(f12)
    expect(f12.defaultPrevented).toBe(true)

    document.body.innerHTML = '<p id="text">texto</p><input id="field" />'
    const outside = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.getElementById('text').dispatchEvent(outside)
    expect(outside.defaultPrevented).toBe(true)
    const inField = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.getElementById('field').dispatchEvent(inField)
    expect(inField.defaultPrevented).toBe(false)
  })
})
