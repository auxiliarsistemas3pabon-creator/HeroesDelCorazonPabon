import { ClipboardList, KeyRound, List, ListPlus, LayoutDashboard, LogOut, Menu, Trophy, User, UserCheck, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/cn'
import { useIdleLogout } from '../lib/useIdleLogout'
import { Button } from './ui/Button'
import { mediaUrl } from '../lib/media'
import { ChangePasswordForm } from '../pages/ChangePasswordPage'
import { PAGE_TITLE } from './ui/styles'
 
// Menú lateral por rol (`user.role`: 'boss' | 'superadmin' | 'collaborator'). Es solo navegación: el control
// real de acceso lo hace el backend; ocultar un enlace aquí no protege la ruta.
const BOSS_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/results', label: 'Resultados', icon: Trophy },
  { to: '/create', label: 'Crear Evaluacion', icon: ListPlus },
  // Submenú: Grupales (la programación de siempre) e Individuales (autoevaluación).
  {
    label: 'Programar evaluación',
    icon: ListPlus,
    children: [
      { to: '/program', label: 'Grupales', end: true },
      { to: '/program/individual', label: 'Individuales' },
    ],
  },
  { to: '/evaluations-list', label: 'Lista de evaluaciones', icon: List },
]

const COLLABORATOR_LINKS = [
  { to: '/evaluations', label: 'Evaluar', icon: ClipboardList },
  { to: '/self-evaluation', label: 'Autoevaluación', icon: UserCheck },
]

const LINKS = {
  // El coordinador administra y además participa como colaborador (evalúa y se autoevalúa).
  boss: [...BOSS_LINKS, ...COLLABORATOR_LINKS],
  // El superadmin hace todo lo del jefe y además carga datos (personal y evaluaciones).
  superadmin: [
    ...BOSS_LINKS,
    // Submenú: administrar cuentas existentes y crear nuevas.
    {
      label: 'Usuarios',
      icon: Users,
      children: [
        { to: '/users', label: 'Administrar usuarios', end: true },
        { to: '/users/create', label: 'Crear usuario' },
      ],
    },
    { to: '/staff', label: 'Cargar datos', icon: Users },
  ],
  collaborator: COLLABORATOR_LINKS,
}

const ROLE_LABELS = { boss: 'Coordinador', superadmin: 'Superadministrador', collaborator: 'Colaborador' }

// Layout de todas las páginas autenticadas: cabecera, menú lateral y <Outlet/> con la página activa.
// Actúa también de guardia de sesión (ver redirecciones abajo).
export function Layout() {
  const { user, loading, logout, updateUser, realtimeStatus, realtimeNotice } = useAuth()
  const [open, setOpen] = useState(false)
  const realtimeConnected = realtimeStatus === 'connected'
  const realtimeUnavailable = realtimeStatus === 'unavailable'
  // Capa 20: sin actividad se cierra la sesión en el servidor; si esa llamada falla, igual se sale en el cliente.
  useIdleLogout(Boolean(user), () => { logout().catch(() => updateUser(null)) })

  // Mientras AuthContext consulta /auth/me/ no se redirige: evitaría un rebote a /login en cada recarga.
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  // Clave inicial (Cargar personal / Crear usuario): hasta cambiarla solo se muestra el formulario. El backend también
  // bloquea el resto de la API, así que esto no es la protección, solo evita pantallas que fallarían.
  if (user.password_change_required) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-app px-4 py-8">
        <div className="w-full max-w-md">
          <h1 className={PAGE_TITLE}>Cambia tu contraseña</h1>
          <p className="mt-1 text-sm text-app-muted">Hola, {user.first_name}. Es tu primer ingreso.</p>
        </div>
        <ChangePasswordForm forced />
        <Button type="button" variant="secondary" size="sm" onClick={logout} leftIcon={<LogOut size={16} />}>
          Salir
        </Button>
      </main>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="sticky top-0 z-30 border-b border-app bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-app hover:bg-app-muted lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu size={20} />
            </button>
            <Link to="/" className="flex items-center gap-2">
              <div className="rounded-md bg-white p-1 shadow-sm">
                <img src={mediaUrl('logo-clinica.png')} alt="Clínica Pabón" className="h-9 w-auto" />
              </div>
              <div className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-semibold text-app">Clínica Pabón</span>
                <span className="text-xs text-app-muted">Héroes del Corazón</span>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span
              className="hidden items-center gap-1.5 text-xs text-app-muted sm:flex"
              role="status"
              aria-label={realtimeConnected
                ? 'WebSocket conectado'
                : realtimeUnavailable
                  ? 'Actualizaciones en tiempo real no disponibles'
                  : 'WebSocket reconectando'}
            >
              <span className={cn(
                'h-2 w-2 rounded-full',
                realtimeConnected ? 'bg-green-500' : realtimeUnavailable ? 'bg-gray-400' : 'bg-amber-500',
              )} />
              {realtimeConnected
                ? 'En vivo'
                : realtimeUnavailable
                  ? 'Tiempo real no disponible'
                  : 'Reconectando'}
            </span>
            <div className="hidden items-center gap-2 rounded-lg border border-app bg-app-muted px-3 py-2 sm:flex">
              <User size={16} className="text-app-muted" />
              <span className="text-sm font-medium text-app">{user.first_name} {user.last_name}</span>
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {ROLE_LABELS[user.role]}
              </span>
            </div>
            <Link
              to="/account/password"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app text-app-muted hover:bg-app-muted hover:text-app"
              aria-label="Cambiar contraseña"
              title="Cambiar contraseña"
            >
              <KeyRound size={16} aria-hidden="true" />
            </Link>
            <Button type="button" variant="secondary" size="sm" onClick={logout} leftIcon={<LogOut size={16} />}>
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-1">
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
        <aside
          className={cn(
            'z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-app bg-surface',
            'fixed inset-y-0 left-0 transition-transform lg:sticky lg:top-16 lg:max-h-[calc(100dvh-4rem)] lg:translate-x-0 lg:self-start',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-app px-4 py-3 lg:hidden">
            <span className="text-sm font-semibold text-app">Menú</span>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-app hover:bg-app-muted"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
            >
              <X size={18} />
            </button>
          </div>
          <nav className="flex flex-col gap-1 p-3">
            {(LINKS[user.role] ?? []).map(({ to, label, icon: Icon, end, children }) => children ? (
              // Entrada con submenú: el título agrupa y cada hija es un enlace propio.
              <div key={label} role="group" aria-label={label}>
                <div className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-app">
                  <Icon size={18} />
                  <span>{label}</span>
                </div>
                <div className="ml-6 flex flex-col gap-1 border-l border-app pl-3">
                  {children.map((child) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      end={child.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'rounded-lg px-3 py-2 text-sm font-medium transition',
                          isActive ? 'bg-primary/10 text-primary' : 'text-app hover:bg-app-muted',
                        )
                      }
                    >
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                    isActive ? 'bg-primary/10 text-primary' : 'text-app hover:bg-app-muted',
                  )
                }
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      {realtimeNotice && (
        <div
          className="toast-enter fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-app bg-surface px-4 py-3 text-sm text-app shadow-lg"
          role="status"
          aria-live="polite"
        >
          {realtimeNotice}
        </div>
      )}
    </div>
  )
}
