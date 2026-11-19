/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { connectRealtime } from '../lib/realtime'

// Sesión por cookies httpOnly: el front nunca ve los tokens, solo pregunta quién es el usuario.
const AuthContext = createContext(null)

// `user` es null sin sesión; `loading` es true hasta resolver el primer /auth/me/ (las rutas protegidas deben esperarlo).
// El objeto de usuario incluye `role` ('boss' | 'collaborator') y `password_change_required`.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [realtimeStatus, setRealtimeStatus] = useState('disconnected')
  const [realtimeEvent, setRealtimeEvent] = useState(null)
  const [realtimeNotice, setRealtimeNotice] = useState('')
  const authOperation = useRef(0)

  useEffect(() => {
    let active = true
    const operationAtStart = authOperation.current
    const updateUser = (nextUser) => {
      if (active && operationAtStart === authOperation.current) setUser(nextUser)
    }

    async function restoreSession() {
      try {
        updateUser(await api('/auth/me/'))
      } catch (error) {
        // An expired access cookie can still have a valid refresh cookie.
        // Restore it once before treating the browser as signed out.
        if (error.status === 401) {
          try {
            await api('/auth/refresh/', { method: 'POST' })
            updateUser(await api('/auth/me/'))
          } catch {
            updateUser(null)
          }
        } else {
          updateUser(null)
        }
      } finally {
        if (active && operationAtStart === authOperation.current) setLoading(false)
      }
    }

    restoreSession()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (loading || !user) return undefined
    // Render Nginx reenvía /ws al backend en el mismo origen, así que la cookie
    // httpOnly de acceso viaja junto con la conexión WebSocket.
    let noticeTimer
    const disconnect = connectRealtime({
      onStatus: setRealtimeStatus,
      onEvent: (event) => {
        setRealtimeEvent(event)
        const messages = {
          'questions.submitted': 'Se recibió una nueva evaluación.',
          'evaluations.updated': 'La programación de evaluaciones cambió.',
          'staff.updated': 'Se actualizó el personal.',
        }
        setRealtimeNotice(messages[event.type] || 'Hay una actualización en tiempo real.')
        window.clearTimeout(noticeTimer)
        noticeTimer = window.setTimeout(() => setRealtimeNotice(''), 5000)
      },
      refreshSession: async () => {
        try {
          await api('/auth/refresh/', { method: 'POST' })
          return true
        } catch {
          setUser(null)
          return false
        }
      },
    })
    return () => {
      disconnect()
      window.clearTimeout(noticeTimer)
    }
  }, [loading, user])

  async function login(credentials) {
    const operation = ++authOperation.current
    setLoading(true)
    setUser(null)
    try {
      // Login ya devuelve el perfil autenticado y fija las cookies httpOnly:
      // reutilizarlo evita una ida y vuelta extra antes de abrir la aplicación.
      let authenticatedUser = await api('/auth/login/', { method: 'POST', body: credentials })
      if (!authenticatedUser) {
        // /auth/me/ uses 200 + null for an absent/invalid access cookie.
        // Try the refresh cookie once before reporting a session transport issue.
        try {
          await api('/auth/refresh/', { method: 'POST' })
        } catch (cause) {
          throw Object.assign(new Error('El backend aceptó el login, pero no se pudo establecer la sesión.'), {
            code: 'SESSION_NOT_ESTABLISHED',
            cause,
          })
        }
        authenticatedUser = await api('/auth/me/')
      }
      if (!authenticatedUser) {
        throw Object.assign(new Error('El backend aceptó el login, pero no se pudo establecer la sesión.'), {
          code: 'SESSION_NOT_ESTABLISHED',
        })
      }
      if (operation === authOperation.current) setUser(authenticatedUser)
      return authenticatedUser
    } catch (error) {
      if (operation === authOperation.current) setUser(null)
      throw error
    } finally {
      if (operation === authOperation.current) setLoading(false)
    }
  }

  async function logout() {
    authOperation.current += 1
    await api('/auth/logout/', { method: 'POST' })
    setUser(null)
  }

  return (
    <AuthContext.Provider
      // updateUser: reemplaza el perfil de sesión (p. ej. tras cambiar la clave, que levanta password_change_required).
      value={{ user, loading, login, logout, updateUser: setUser, realtimeStatus, realtimeEvent, realtimeNotice }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// Solo funciona dentro de <AuthProvider>; fuera devuelve null y desestructurar fallaría.
export function useAuth() {
  return useContext(AuthContext)
}
