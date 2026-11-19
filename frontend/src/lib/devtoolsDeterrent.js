// DISUASIÓN, no protección: bloquea los atajos habituales para abrir las herramientas de desarrollo
// (F12, Ctrl+Shift+I/J/C, Ctrl+U) y el menú del clic derecho fuera de los campos de texto.
//
// Ningún sitio web puede impedir de verdad que se inspeccione: el navegador es del usuario y las herramientas se
// abren también desde su menú, con otro programa o copiando la petición a Postman. La protección real está en el
// servidor: sin sesión válida la API responde "Acceso no autorizado." y no envía datos (ver PRUEBAS_MANUALES_SEGURIDAD).

const BLOCKED_WITH_CTRL_SHIFT = new Set(['I', 'J', 'C', 'K'])

function isEditable(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'))
}

export function blockedShortcut(event) {
  const key = (event.key || '').toUpperCase()
  if (key === 'F12') return true
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && event.shiftKey && BLOCKED_WITH_CTRL_SHIFT.has(key)) return true
  if (ctrl && !event.shiftKey && key === 'U') return true // ver código fuente
  if (event.metaKey && event.altKey && ['I', 'J', 'C', 'U'].includes(key)) return true // macOS
  return false
}

export function installDevtoolsDeterrent(target = window) {
  const onKeyDown = (event) => {
    if (!blockedShortcut(event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  // En campos de texto se deja el menú: copiar y pegar siguen funcionando.
  const onContextMenu = (event) => {
    if (!isEditable(event.target)) event.preventDefault()
  }
  target.addEventListener('keydown', onKeyDown, true)
  target.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    target.removeEventListener('keydown', onKeyDown, true)
    target.removeEventListener('contextmenu', onContextMenu, true)
  }
}
