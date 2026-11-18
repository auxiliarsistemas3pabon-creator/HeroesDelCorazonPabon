// Bloqueo de ventanas privadas/incógnito en las páginas del backend: login del admin (/admin/) y
// apertura directa de los endpoints de la API en el navegador (api-gate.js).
// Misma lógica que frontend/src/lib/privateMode.js: los campos se habilitan solo cuando termina la
// verificación y quedan bloqueados únicamente si hay evidencia suficiente de navegación privada.
// Ante duda, error o falta de soporte NO se bloquea (un navegador normal siempre puede entrar).
(function () {
  'use strict'

  var SEEN_KEY = 'hdc_browser_seen_at'
  var TRUSTED_AGE_MS = 24 * 60 * 60 * 1000
  var PRIVATE_BELOW = 1.25
  var NORMAL_ABOVE = 1.6
  // Privado solo con RUNS mediciones seguidas claramente privadas; hasta MAX_RUNS si alguna sale dudosa.
  var RUNS = 3
  var MAX_RUNS = 5
  var ROUNDS = 15
  var WRITES = 15
  var TIME_LIMIT_MS = 4000
  var FALLBACK_MS = 5000
  var MESSAGE = 'No se permite el acceso desde una ventana privada o de incógnito. Usa una ventana normal del navegador.'

  var ua = navigator.userAgent || ''
  var isFirefox = /firefox/i.test(ua)
  var isChromium = /chrome|chromium|crios|edg\//i.test(ua)
  var isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua)

  // Marca de antigüedad: un navegador normal la conserva; el incógnito la pierde al cerrarse.
  function seenAt() {
    try {
      var value = Number(window.localStorage.getItem(SEEN_KEY))
      return isFinite(value) && value > 0 ? value : null
    } catch (e) {
      return null
    }
  }
  function rememberBrowser() {
    try {
      if (!seenAt()) window.localStorage.setItem(SEEN_KEY, String(Date.now()))
    } catch (e) { /* sin almacenamiento: sin marca */ }
  }
  function longKnown() {
    var first = seenAt()
    return first !== null && Date.now() - first >= TRUSTED_AGE_MS
  }

  function classify(medians) {
    var i
    for (i = 0; i < medians.length; i++) if (!isFinite(medians[i])) return 'unknown'
    for (i = 0; i < medians.length; i++) if (medians[i] > NORMAL_ABOVE) return 'normal'
    if (medians.length < RUNS) return 'unknown'
    for (i = medians.length - RUNS; i < medians.length; i++) if (!(medians[i] < PRIVATE_BELOW)) return 'unknown'
    return 'private'
  }

  // Chromium: tiempos de IndexedDB con durabilidad strict frente a relaxed (en incógnito ambas cuestan lo mismo).
  function chromiumIsPrivate() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(false)
      var name = '__hdc_probe_' + Math.random().toString(36).slice(2)
      var deadline = performance.now() + TIME_LIMIT_MS
      var payload = new Uint8Array(16384)
      var db
      function finish(result) {
        try { if (db) db.close(); window.indexedDB.deleteDatabase(name) } catch (e) { /* sin efecto */ }
        resolve(result)
      }
      function batch(durability) {
        return new Promise(function (ok, ko) {
          var start = performance.now()
          var i = 0
          function next() {
            if (performance.now() > deadline) return ko(new Error('timeout'))
            if (i === WRITES) return ok(performance.now() - start)
            var tx = db.transaction('s', 'readwrite', { durability: durability })
            tx.objectStore('s').put(payload, i++)
            tx.oncomplete = next
            tx.onerror = tx.onabort = function () { ko(tx.error) }
          }
          next()
        })
      }
      function measureRun() {
        var ratios = []
        var k = 0
        function round() {
          if (k === ROUNDS) {
            ratios.sort(function (a, b) { return a - b })
            return Promise.resolve(ratios.length ? ratios[ratios.length >> 1] : NaN)
          }
          k++
          return batch('relaxed').then(function (relaxed) {
            return batch('strict').then(function (strict) {
              if (relaxed > 0) ratios.push(strict / relaxed)
              return round()
            })
          })
        }
        return batch('relaxed').then(function () { return batch('strict') }).then(round)
      }
      try {
        var request = window.indexedDB.open(name, 1)
        request.onupgradeneeded = function () { request.result.createObjectStore('s') }
        request.onerror = function () { finish(false) }
        request.onsuccess = function () {
          db = request.result
          try {
            var probe = db.transaction('s', 'readwrite', { durability: 'strict' })
            var supported = probe.durability === 'strict'
            probe.abort()
            if (!supported) return finish(false)
          } catch (e) {
            return finish(false)
          }
          var medians = []
          function step() {
            if (medians.length === MAX_RUNS) return finish(false) // sin veredicto claro: no se bloquea
            return measureRun().then(function (median) {
              if (!isFinite(median)) return finish(false)
              medians.push(median)
              var verdict = classify(medians)
              // Una medición claramente normal deja pasar al instante; privado exige RUNS seguidas.
              if (verdict !== 'unknown') return finish(verdict === 'private')
              return step()
            })
          }
          step().catch(function () { finish(false) })
        }
      } catch (e) {
        finish(false)
      }
    })
  }

  // Firefox y Safari recientes rechazan OPFS en navegación privada con un error concreto.
  function opfsRejectedWith(pattern) {
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(false)
    return navigator.storage.getDirectory().then(
      function () { return false },
      function (error) { return pattern.test(String((error && error.message) || error)) }
    )
  }

  function detectPrivate() {
    try {
      if (longKnown()) return Promise.resolve(false)
      rememberBrowser()
      if (isFirefox) return opfsRejectedWith(/security error/i)
      if (isSafari) return opfsRejectedWith(/unknown transient reason/i)
      if (isChromium) return chromiumIsPrivate()
    } catch (e) { /* no se puede determinar */ }
    return Promise.resolve(false)
  }

  function setLocked(form, locked) {
    var fields = form.querySelectorAll('input, button')
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].type !== 'hidden') fields[i].disabled = locked
    }
  }

  function start() {
    var form = document.getElementById('login-form')
    if (!form) return
    var status = document.createElement('p')
    status.className = 'help'
    status.textContent = 'Verificando navegador…'
    form.parentNode.insertBefore(status, form)
    setLocked(form, true)
    var blocked = false
    var done = false
    form.addEventListener('submit', function (event) { if (blocked || !done) event.preventDefault() })

    function release() {
      if (done) return
      done = true
      status.remove()
      setLocked(form, false)
    }
    var fallback = window.setTimeout(release, FALLBACK_MS)

    window.hdcDetectPrivateWindow().then(function (isPrivate) {
      window.clearTimeout(fallback)
      if (!isPrivate) return release()
      blocked = true
      done = true
      setLocked(form, true)
      // Ventana privada: no queda nada del login (ni encabezado ni formulario), solo el aviso,
      // igual que el login del frontend y los endpoints de la API.
      var notice = document.createElement('p')
      notice.className = 'errornote hdc-private-notice'
      notice.setAttribute('role', 'alert')
      notice.textContent = MESSAGE
      document.body.replaceChildren(notice)
      if (window.console) console.warn('Permiso no autorizado')
    }, function () {
      window.clearTimeout(fallback)
      release()
    })
  }

  // Reutilizable por otras páginas del backend (ver api-gate.js): una sola detección por carga.
  var detection = null
  window.hdcDetectPrivateWindow = function () {
    if (!detection) detection = detectPrivate()
    return detection
  }
  window.hdcPrivateWindowMessage = MESSAGE

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
