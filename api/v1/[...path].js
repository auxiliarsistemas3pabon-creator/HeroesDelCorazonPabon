const { Readable } = require('node:stream')

const BACKEND_ORIGIN = 'https://heroesdelcorazon-pabon.onrender.com'
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
])

async function handler(request, response) {
  try {
    const incomingUrl = new URL(request.url, 'https://vercel.invalid')
    const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, BACKEND_ORIGIN)
    const headers = new Headers()

    for (const [name, value] of Object.entries(request.headers)) {
      if (value == null || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }

    const hasBody = !['GET', 'HEAD'].includes(request.method)
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody ? Readable.toWeb(request) : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      cache: 'no-store',
    })

    response.statusCode = upstream.status
    for (const [name, value] of upstream.headers) {
      if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === 'set-cookie') continue
      response.setHeader(name, value)
    }
    const cookies = upstream.headers.getSetCookie?.() ?? []
    if (cookies.length) response.setHeader('Set-Cookie', cookies)
    response.setHeader('Cache-Control', 'private, no-store')

    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response)
    else response.end()
  } catch {
    response.statusCode = 502
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ detail: 'No se pudo conectar con el backend.' }))
  }
}

module.exports = handler
module.exports.config = { api: { bodyParser: false } }
