
import { Component, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LoginPage } from './pages/LoginPage'

// Cargar solo el login en la primera visita. Las páginas protegidas y sus dependencias
// pesadas (gráficas, Excel) se descargan cuando el usuario entra a ellas.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const EvaluationPage = lazy(() => import('./pages/EvaluationPage').then((module) => ({ default: module.EvaluationPage })))
const EvaluationsListPage = lazy(() => import('./pages/EvaluationsListPage').then((module) => ({ default: module.EvaluationsListPage })))
const FormCreatePage = lazy(() => import('./pages/FormCreatePage').then((module) => ({ default: module.FormCreatePage })))
const FormProgramPage = lazy(() => import('./pages/FormProgramPage').then((module) => ({ default: module.FormProgramPage })))
const ResultsPage = lazy(() => import('./pages/ResultsPage').then((module) => ({ default: module.ResultsPage })))
const StaffImportPage = lazy(() => import('./pages/StaffImportPage').then((module) => ({ default: module.StaffImportPage })))
const UsersAdminPage = lazy(() => import('./pages/UsersAdminPage').then((module) => ({ default: module.UsersAdminPage })))

class PageLoadBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <main className="m-auto max-w-lg p-6 text-center text-app">
        <h1 className="text-lg font-semibold">No se pudo cargar esta página</h1>
        <p className="mt-2 text-sm text-app-muted">Comprueba tu conexión e inténtalo de nuevo.</p>
        <button type="button" className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()}>Recargar</button>
      </main>
    }
    return this.props.children
  }
}

const MANAGERS = ['boss', 'superadmin']
const SUPERADMIN = ['superadmin']
const COLLABORATORS = ['collaborator']

// Inicio de cada rol: jefe/superadmin -> dashboard; colaborador -> evaluar; otro rol -> sin acceso (null).
function homeFor(role) {
  if (MANAGERS.includes(role)) return '/dashboard'
  if (COLLABORATORS.includes(role)) return '/evaluations'
  return null
}

// Un rol sin páginas propias (p. ej. `personal`, que nunca debería iniciar sesión) no se redirige: evita un bucle.
function NoAccess() {
  return <p role="alert" className="text-sm text-app-muted">Tu cuenta no tiene acceso a esta aplicación.</p>
}

// Guardia por rol: si alguien escribe o pega a mano una URL que no le corresponde, se le saca automáticamente
// a su inicio (sin mostrar la página ni un instante). La sesión ya la exige <Layout>; el backend sigue validando.
function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  if (roles.includes(user.role)) return children
  const home = homeFor(user.role)
  return home ? <Navigate to={home} replace /> : <NoAccess />
}

// Cualquier ruta desconocida (/index.html, rutas inventadas...) vuelve al inicio de su rol.
function HomeRedirect() {
  const { user } = useAuth()
  const home = homeFor(user.role)
  return home ? <Navigate to={home} replace /> : <NoAccess />
}

// /login va fuera de <Layout>; las demás rutas autenticadas usan Layout y exigen sesión.
// y define el menú por rol. Ocultar un enlace NO protege la ruta: los permisos reales los aplica el backend.
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* AuthProvider dentro del Router para poder usar navegación; consulta /auth/me/ al iniciar */}
        <Suspense fallback={<main className="p-6 text-sm text-app-muted" role="status">Cargando…</main>}>
        <PageLoadBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<RoleRoute roles={MANAGERS}><DashboardPage /></RoleRoute>} />
            {/* Colaborador: Evaluar (grupales) y Autoevaluación (individuales). */}
            <Route path="/evaluations" element={<RoleRoute roles={COLLABORATORS}><EvaluationPage key="group" kind="group" /></RoleRoute>} />
            <Route path="/self-evaluation" element={<RoleRoute roles={COLLABORATORS}><EvaluationPage key="self" kind="self" /></RoleRoute>} />
            <Route path="/results" element={<RoleRoute roles={MANAGERS}><ResultsPage /></RoleRoute>} />
            <Route path="/evaluations-list" element={<RoleRoute roles={MANAGERS}><EvaluationsListPage /></RoleRoute>} />
            <Route path="/create" element={<RoleRoute roles={MANAGERS}><FormCreatePage /></RoleRoute>} />
            {/* Programar evaluación: Grupales (la de siempre) e Individuales (autoevaluación). */}
            <Route path="/program" element={<RoleRoute roles={MANAGERS}><FormProgramPage key="group" kind="group" /></RoleRoute>} />
            <Route path="/program/individual" element={<RoleRoute roles={MANAGERS}><FormProgramPage key="self" kind="self" /></RoleRoute>} />
            {/* Solo el superadmin carga datos y administra usuarios; el backend lo exige igualmente */}
            <Route path="/staff" element={<RoleRoute roles={SUPERADMIN}><StaffImportPage /></RoleRoute>} />
            <Route path="/users" element={<RoleRoute roles={SUPERADMIN}><UsersAdminPage /></RoleRoute>} />
            <Route path="*" element={<HomeRedirect />} />
          </Route>
        </Routes>
        </PageLoadBoundary>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
