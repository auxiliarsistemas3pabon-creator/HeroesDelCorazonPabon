import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Render solo permite los orígenes del frontend principal. Las URLs efímeras
// de preview de Vercel cambian en cada despliegue y no deben iniciar la app
// contra la API de producción; llevarlas al dominio principal autorizado.
const VERCEL_PREVIEW_PREFIX = 'heroes-del-corazon-pabon-'
const PRODUCTION_FRONTEND_URL = 'https://heroes-del-corazon-pabon.vercel.app'
const hostname = window.location.hostname
const isProjectPreview = hostname.startsWith(VERCEL_PREVIEW_PREFIX)
  && hostname.endsWith('.vercel.app')

if (isProjectPreview) {
  window.location.replace(
    `${PRODUCTION_FRONTEND_URL}${window.location.pathname}${window.location.search}${window.location.hash}`,
  )
} else {
  // StrictMode ejecuta los efectos dos veces en desarrollo (solo dev): los useEffect con fetch deben tolerar peticiones duplicadas.
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
