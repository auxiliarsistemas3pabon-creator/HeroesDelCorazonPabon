import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PasswordInput } from '../components/PasswordInput'
import { Button } from '../components/ui/Button'
import { ALERT_ERROR, FIELD, LABEL } from '../components/ui/styles'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../lib/api'
import { mediaUrl } from '../lib/media'
import { detectPrivateMode } from '../lib/privateMode'

// Textos de marketing del panel izquierdo. Mantenerlos alineados con las reglas reales (escala, cierre).
const FEATURES = [
  { title: 'Evaluaciones del personal', desc: 'Cada colaborador califica a sus compañeros de área, con notas de 1 a 5.' },
  { title: 'Formularios a la medida', desc: 'El jefe crea las categorías y preguntas de cada evaluación.' },
  { title: 'Resultados y promedios', desc: 'Promedio por categoría y por persona, filtrado por evaluación, área o persona.' },
  { title: 'Cierre automático', desc: 'Cada evaluación se cierra sola al terminar el mes.' },
]

// El usuario ingresa con su identificador; puede cambiar la contraseña voluntariamente desde el menú.
export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [privateMode, setPrivateMode] = useState(false)
  // Los campos se habilitan solo cuando termina la verificación del navegador (unos segundos en Chromium).
  const [checking, setChecking] = useState(true)

  // Ventanas privadas/incógnito: si hay evidencia suficiente, no se permite escribir usuario ni contraseña.
  // Ante duda o error el detector devuelve false y el formulario se habilita con normalidad.
  useEffect(() => {
    let active = true
    // Tope de espera: aunque el equipo esté muy cargado, el formulario se habilita como máximo en 5 s.
    const fallback = window.setTimeout(() => { if (active) setChecking(false) }, 5000)
    detectPrivateMode()
      .then((isPrivate) => {
        if (active && isPrivate) {
          console.warn('Permiso no autorizado')
          setPrivateMode(true)
        }
      })
      // Si el detector falla, nunca se bloquea: el formulario se habilita como en un navegador normal.
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(fallback)
        if (active) setChecking(false)
      })
    return () => {
      active = false
      window.clearTimeout(fallback)
    }
  }, [])
  const locked = checking || privateMode

  if (user) return <Navigate to={user.role === 'boss' || user.role === 'superadmin' ? '/dashboard' : '/evaluations'} replace />

  const onChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    // Un solo intento a la vez: Enter repetido mientras se valida no envía otra petición de login.
    if (locked || loading) return
    setError(null)
    setLoading(true)
    try {
      // login devuelve el usuario para decidir el destino sin esperar a que el contexto se actualice.
      const authenticatedUser = await login({ ...form, username: form.username.trim(), private_mode: privateMode })
      navigate(authenticatedUser.role === 'boss' || authenticatedUser.role === 'superadmin' ? '/dashboard' : '/evaluations', { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'Credenciales inválidas'))
    } finally {
      setLoading(false)
    }
  }

  // Ventana privada/incógnito: no se muestra nada del login (ni el panel ni el formulario), solo el aviso,
  // igual que el backend al abrir sus endpoints en una ventana privada.
  if (privateMode) {
    return (
      <main className="min-h-dvh w-full bg-[#fffaf8] p-4">
        <div role="alert" className={`${ALERT_ERROR} max-w-md`}>
          No se permite el acceso desde una ventana privada o de incógnito. Usa una ventana normal del navegador.
        </div>
      </main>
    )
  }

  return (
    <div className="grid min-h-dvh w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative flex min-h-dvh min-w-0 flex-col bg-gradient-to-br from-[#c02645] via-[#a71932] to-[#70182b] px-6 py-5 text-white">
        <div className="inline-flex w-fit items-center gap-2 rounded-lg bg-white px-2 py-1.5 shadow-md">
          <img className="h-8 w-auto" src={mediaUrl('logo-clinica.png')} alt="Clínica Pabón" />
          <img className="h-8 w-auto" src={mediaUrl('logo-centro-pabon.png')} alt="Centro de Cuidados Cardioneurovasculares Pabón" />
        </div>
        <div className="relative z-10 mt-5 max-w-lg">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/80">Evaluación de desempeño</h2>
          <p className="mt-1.5 text-xl font-bold italic leading-snug tracking-tight">Plataforma interna de evaluación del personal.</p>
          <ul className="mt-4 space-y-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-2.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 text-[10px] font-medium">✓</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-white/80">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <img
          className="pointer-events-none absolute bottom-0 right-0 z-0 h-52 w-auto max-w-[46%] object-contain object-bottom drop-shadow-2xl"
          src={mediaUrl('paboncito.png')}
          fetchPriority="high"
          alt=""
          aria-hidden
        />
      </aside>

      <main className="flex min-h-dvh min-w-0 items-center justify-center bg-[#fffaf8] px-8 py-6">
        <div className="w-full max-w-sm">
          <div className="mb-4">
            <h1 className="text-xl font-bold text-[#25151a]">Iniciar sesión</h1>
            <p className="mt-0.5 text-xs text-app-muted">Ingresa tus credenciales para continuar.</p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
            {checking && <p role="status" className="text-xs text-app-muted">Verificando navegador…</p>}
            {error && <div role="alert" className={ALERT_ERROR}>{error}</div>}
            <label className={LABEL}>
              Usuario
              <input className={FIELD} name="username" autoComplete="username" value={form.username} onChange={onChange} disabled={locked} required />
            </label>
            <label className={LABEL}>
              Contraseña
              <PasswordInput name="password" autoComplete="current-password" value={form.password} onChange={onChange} disabled={locked} required />
            </label>
            <Button type="submit" loading={loading} disabled={locked} fullWidth className="mt-1 !bg-[#c02645] hover:!bg-[#a71932] focus-visible:!ring-[#c02645]/50">
              {loading ? 'Ingresando...' : 'Iniciar sesión'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
