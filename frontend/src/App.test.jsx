
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import App from './App'

// =====================================================
// MOCK DEL CONTEXTO DE AUTENTICACIÓN
// =====================================================

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}))

vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: mockUseAuth,
}))

// =====================================================
// MOCK DE LAS PÁGINAS
// Conservamos Layout.jsx REAL
// =====================================================

vi.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <div>DashboardPage</div>,
}))

vi.mock('./pages/EvaluationPage', () => ({
  EvaluationPage: () => <div>EvaluationPage</div>,
}))

vi.mock('./pages/EvaluationsListPage', () => ({
  EvaluationsListPage: () => <div>EvaluationsListPage</div>,
}))

vi.mock('./pages/FormCreatePage', () => ({
  FormCreatePage: () => <div>FormCreatePage</div>,
}))

vi.mock('./pages/FormProgramPage', () => ({
  FormProgramPage: () => <div>FormProgramPage</div>,
}))

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div>LoginPage</div>,
}))

vi.mock('./pages/ResultsPage', () => ({
  ResultsPage: () => <div>ResultsPage</div>,
}))

vi.mock('./pages/StaffImportPage', () => ({
  StaffImportPage: () => <div>StaffImportPage</div>,
}))

vi.mock('./pages/UsersAdminPage', () => ({
  UsersAdminPage: () => <div>UsersAdminPage</div>,
}))

// =====================================================
// PRUEBAS DE APP
// =====================================================

describe('App.jsx - Rutas, autenticación y permisos', () => {

  const usuario = {
    first_name: 'Usuario',
    last_name: 'Prueba',
    role: 'collaborator',
    password_change_required: false,
  }

  beforeEach(() => {
    cleanup()

    mockUseAuth.mockReturnValue({
      user: usuario,
      loading: false,
      logout: vi.fn(),
      realtimeStatus: 'disconnected',
      realtimeNotice: '',
    })
  })

  afterEach(() => {
    cleanup()
  })

  // Función para navegar a una ruta
  const renderApp = (path = '/') => {
    window.history.pushState({}, '', path)
    return render(<App />)
  }

  // ===================================================
  // 1. RUTAS PÚBLICAS
  // ===================================================

  it('debe mostrar Login', () => {
    renderApp('/login')

    expect(screen.getByText('LoginPage')).toBeInTheDocument()
  })

  it('debe mostrar Login en la ruta raíz', () => {
    renderApp('/')

    expect(screen.getByText('LoginPage')).toBeInTheDocument()
  })

  // ===================================================
  // 2. AUTENTICACIÓN DEL LAYOUT
  // ===================================================

  it('no debe mostrar contenido mientras carga la sesión', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
    })

    renderApp('/results')

    expect(screen.queryByText('ResultsPage')).not.toBeInTheDocument()
    expect(screen.queryByText('LoginPage')).not.toBeInTheDocument()
  })

  it('debe redirigir a Login cuando no existe usuario', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    })

    renderApp('/results')

    expect(screen.getByText('LoginPage')).toBeInTheDocument()
  })

  // ===================================================
  // 3. DASHBOARD SEGÚN ROL
  // ===================================================

  it.each(['boss', 'superadmin'])(
    'debe mostrar Dashboard para el rol %s',
    async (role) => {
      mockUseAuth.mockReturnValue({
        user: { ...usuario, role },
        loading: false,
        logout: vi.fn(),
        realtimeStatus: 'disconnected',
        realtimeNotice: '',
      })

      renderApp('/dashboard')

      expect(await screen.findByText('DashboardPage')).toBeInTheDocument()
    }
  )

  it('debe redirigir collaborator a evaluaciones', async () => {
    renderApp('/dashboard')

    expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
  })

  // ===================================================
  // 4. PROTECCIÓN DE STAFF
  // ===================================================

  it('debe permitir Staff a superadmin', async () => {
    mockUseAuth.mockReturnValue({
      user: { ...usuario, role: 'superadmin' },
      loading: false,
      logout: vi.fn(),
      realtimeStatus: 'disconnected',
      realtimeNotice: '',
    })

    renderApp('/staff')

    expect(await screen.findByText('StaffImportPage')).toBeInTheDocument()
  })

  it.each(['boss', 'collaborator'])(
    'debe impedir acceso a Staff para %s',
    async (role) => {
      mockUseAuth.mockReturnValue({
        user: { ...usuario, role },
        loading: false,
        logout: vi.fn(),
        realtimeStatus: 'disconnected',
        realtimeNotice: '',
      })

      renderApp('/staff')

      expect(screen.queryByText('StaffImportPage')).not.toBeInTheDocument()

      if (role === 'boss') {
        expect(await screen.findByText('DashboardPage')).toBeInTheDocument()
      } else {
        expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
      }
    }
  )

  // ===================================================
  // 5. RUTAS INTERNAS
  // ===================================================

  const asRole = (role) => mockUseAuth.mockReturnValue({
    user: { ...usuario, role },
    loading: false,
    logout: vi.fn(),
    realtimeStatus: 'disconnected',
    realtimeNotice: '',
  })

  it('debe mostrar Evaluar al colaborador', async () => {
    renderApp('/evaluations')

    expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
  })

  it.each([
    ['/results', 'ResultsPage'],
    ['/evaluations-list', 'EvaluationsListPage'],
    ['/create', 'FormCreatePage'],
    ['/program', 'FormProgramPage'],
  ])('debe mostrar %s al jefe', async (path, page) => {
    asRole('boss')
    renderApp(path)

    expect(await screen.findByText(page)).toBeInTheDocument()
  })

  // ===================================================
  // 5b. URL ESCRITA A MANO SIN PERMISO: SACA AL INICIO DEL ROL
  // ===================================================

  it.each([
    ['/results', 'ResultsPage'],
    ['/evaluations-list', 'EvaluationsListPage'],
    ['/create', 'FormCreatePage'],
    ['/program', 'FormProgramPage'],
    ['/users', 'UsersAdminPage'],
  ])('debe sacar al colaborador de %s y llevarlo a Evaluar', async (path, page) => {
    renderApp(path)

    expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
    expect(screen.queryByText(page)).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/evaluations')
  })

  it('debe sacar al superadmin de /evaluations y llevarlo al Dashboard (no participa en evaluaciones)', async () => {
    asRole('superadmin')
    renderApp('/evaluations')

    expect(await screen.findByText('DashboardPage')).toBeInTheDocument()
    expect(screen.queryByText('EvaluationPage')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard')
  })

  it.each(['/evaluations', '/self-evaluation'])('el coordinador (boss) también evalúa: puede abrir %s', async (path) => {
    asRole('boss')
    renderApp(path)

    expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
    expect(window.location.pathname).toBe(path)
  })

  it('debe sacar /index.html escrito a mano al inicio del rol', async () => {
    renderApp('/index.html')

    expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/evaluations')
  })

  it('no debe entrar en bucle con un rol sin páginas propias', async () => {
    asRole('personal')
    renderApp('/create')

    expect(await screen.findByText('Tu cuenta no tiene acceso a esta aplicación.')).toBeInTheDocument()
    expect(screen.queryByText('FormCreatePage')).not.toBeInTheDocument()
  })

  // ===================================================
  // 6. RUTA DESCONOCIDA
  // ===================================================

  it('debe redirigir una ruta desconocida según el rol', async () => {
    renderApp('/ruta-inexistente')

    expect(await screen.findByText('EvaluationPage')).toBeInTheDocument()
  })

  it('debe redirigir una ruta desconocida al Dashboard para boss', async () => {
    mockUseAuth.mockReturnValue({
      user: { ...usuario, role: 'boss' },
      loading: false,
      logout: vi.fn(),
      realtimeStatus: 'disconnected',
      realtimeNotice: '',
    })

    renderApp('/ruta-inexistente')

    expect(await screen.findByText('DashboardPage')).toBeInTheDocument()
  })

})
