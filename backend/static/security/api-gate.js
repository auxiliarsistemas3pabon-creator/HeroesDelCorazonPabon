// Página intermedia de los endpoints del backend cuando se abren directamente en el navegador.
// Verifica la ventana con el mismo detector (private-window.js) y solo en una ventana normal pide el
// contenido real (fetch, que el servidor responde con el JSON de siempre) y lo muestra.
// En una ventana privada no se pide ni se muestra nada.
(function () {
  'use strict'

  function show(text, className) {
    var output = document.getElementById('api-output')
    output.className = className || ''
    output.textContent = text
  }

  function loadContent() {
    window.fetch(window.location.href, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (response) {
        return response.text().then(function (body) {
          var pretty = body
          try {
            pretty = JSON.stringify(JSON.parse(body), null, 2)
          } catch (e) { /* no es JSON: se muestra tal cual */ }
          var status = document.getElementById('api-status')
          status.textContent = 'HTTP ' + response.status
          show(pretty, 'content')
        })
      })
      .catch(function () {
        show('No se pudo cargar el contenido.', 'error')
      })
  }

  function start() {
    if (typeof window.hdcDetectPrivateWindow !== 'function') {
      // Sin detector (no debería pasar): no se bloquea a un navegador normal.
      return loadContent()
    }
    window.hdcDetectPrivateWindow().then(function (isPrivate) {
      if (isPrivate) {
        show(window.hdcPrivateWindowMessage, 'error')
        if (window.console) console.warn('Permiso no autorizado')
        return
      }
      loadContent()
    }, loadContent)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
