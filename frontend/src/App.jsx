
import { lazy, Suspense } from 'react'
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
const PasswordChangePage = lazy(() => import('./pages/PasswordChangePage').then((module) => ({ default: module.PasswordChangePage })))
const ResultsPage = lazy(() => import('./pages/ResultsPage').then((module) => ({ default: module.ResultsPage })))
const StaffImportPage = lazy(() => import('./pages/StaffImportPage').then((module) => ({ default: module.StaffImportPage })))
const UsersAdminPage = lazy(() => import('./pages/UsersAdminPage').then((module) => ({ default: module.UsersAdminPage })))

// Destino de "/": roles `boss`/`superadmin` -> dashboard; los demás -> evaluar.
// El dashboard es solo del jefe; el colaborador entra directo a evaluar.
function Home() {
  const { user } = useAuth()
  return user.role === 'boss' || user.role === 'superadmin' ? <DashboardPage /> : <Navigate to="/evaluations" replace />
}

function StaffRoute() {
  const { user } = useAuth()
  return user.role === 'superadmin' ? <StaffImportPage /> : <Navigate to="/dashboard" replace />
}

function UsersRoute() {
  const { user } = useAuth()
  return user.role === 'superadmin' ? <UsersAdminPage /> : <Navigate to="/dashboard" replace />
}

// Rutas: /login y /change-password van fuera de <Layout>; el resto se renderiza dentro de Layout, que exige sesión
// y define el menú por rol. Ocultar un enlace NO protege la ruta: los permisos reales los aplica el backend.
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* AuthProvider dentro del Router para poder usar navegación; consulta /auth/me/ al iniciar */}
        <Suspense fallback={<main className="p-6 text-sm text-app-muted" role="status">Cargando…</main>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<LoginPage />} />
          <Route path="/change-password" element={<PasswordChangePage />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Home />} />
            <Route path="/evaluations" element={<EvaluationPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/evaluations-list" element={<EvaluationsListPage />} />
            <Route path="/create" element={<FormCreatePage />} />
            <Route path="/program" element={<FormProgramPage/>} />
            {/* Solo el superadmin carga datos; el backend lo exige igualmente */}
            <Route path="/staff" element={<StaffRoute />} />
            <Route path="/users" element={<UsersRoute />} />
            {/* Cualquier ruta desconocida vuelve al destino autenticado por rol */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
