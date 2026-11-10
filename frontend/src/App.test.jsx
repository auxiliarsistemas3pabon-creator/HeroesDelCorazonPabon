
import React from 'react'
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

vi.mock('./pages/PasswordChangePage', () => ({
  PasswordChangePage: () => <div>PasswordChangePage</div>,
}))

vi.mock('./pages/ResultsPage', () => ({
  ResultsPage: () => <div>ResultsPage</div>,
}))

vi.mock('./pages/StaffImportPage', () => ({
  StaffImportPage: () => <div>StaffImportPage</div>,
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

  it('debe mostrar cambio de contraseña', () => {
    renderApp('/change-password')

    expect(screen.getByText('PasswordChangePage')).toBeInTheDocument()
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

  it('debe redirigir a cambio de contraseña si es obligatorio', () => {
    mockUseAuth.mockReturnValue({
      user: {
        ...usuario,
        password_change_required: true,
      },
      loading: false,
    })

    renderApp('/results')

    expect(screen.getByText('PasswordChangePage')).toBeInTheDocument()
  })

  // ===================================================
  // 3. DASHBOARD SEGÚN ROL
  // ===================================================

  it.each(['boss', 'superadmin'])(
    'debe mostrar Dashboard para el rol %s',
    (role) => {
      mockUseAuth.mockReturnValue({
        user: { ...usuario, role },
        loading: false,
        logout: vi.fn(),
        realtimeStatus: 'disconnected',
        realtimeNotice: '',
      })

      renderApp('/')

      expect(screen.getByText('DashboardPage')).toBeInTheDocument()
    }
  )

  it('debe redirigir collaborator a evaluaciones', () => {
    renderApp('/')

    expect(screen.getByText('EvaluationPage')).toBeInTheDocument()
  })

  // ===================================================
  // 4. PROTECCIÓN DE STAFF
  // ===================================================

  it('debe permitir Staff a superadmin', () => {
    mockUseAuth.mockReturnValue({
      user: { ...usuario, role: 'superadmin' },
      loading: false,
      logout: vi.fn(),
      realtimeStatus: 'disconnected',
      realtimeNotice: '',
    })

    renderApp('/staff')

    expect(screen.getByText('StaffImportPage')).toBeInTheDocument()
  })

  it.each(['boss', 'collaborator'])(
    'debe impedir acceso a Staff para %s',
    (role) => {
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
        expect(screen.getByText('DashboardPage')).toBeInTheDocument()
      } else {
        expect(screen.getByText('EvaluationPage')).toBeInTheDocument()
      }
    }
  )

  // ===================================================
  // 5. RUTAS INTERNAS
  // ===================================================

  it.each([
    ['/evaluations', 'EvaluationPage'],
    ['/results', 'ResultsPage'],
    ['/evaluations-list', 'EvaluationsListPage'],
    ['/create', 'FormCreatePage'],
    ['/program', 'FormProgramPage'],
  ])('debe mostrar la página correspondiente a %s', (path, page) => {
    renderApp(path)

    expect(screen.getByText(page)).toBeInTheDocument()
  })

  // ===================================================
  // 6. RUTA DESCONOCIDA
  // ===================================================

  it('debe redirigir una ruta desconocida según el rol', () => {
    renderApp('/ruta-inexistente')

    expect(screen.getByText('EvaluationPage')).toBeInTheDocument()
  })

  it('debe redirigir una ruta desconocida al Dashboard para boss', () => {
    mockUseAuth.mockReturnValue({
      user: { ...usuario, role: 'boss' },
      loading: false,
      logout: vi.fn(),
      realtimeStatus: 'disconnected',
      realtimeNotice: '',
    })

    renderApp('/ruta-inexistente')

    expect(screen.getByText('DashboardPage')).toBeInTheDocument()
  })

})
