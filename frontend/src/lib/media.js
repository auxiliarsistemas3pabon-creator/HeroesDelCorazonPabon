const BACKEND_ORIGIN = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? window.location.origin : 'https://heroesdelcorazon-pabon.onrender.com')

export function mediaUrl(filename) {
  return `${BACKEND_ORIGIN.replace(/\/$/, '')}/static/branding/${filename}`
}
