import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PasswordInput } from '../components/PasswordInput'
import { Button } from '../components/ui/Button'
import { ALERT_ERROR, LABEL, PAGE_SUBTITLE, PAGE_TITLE } from '../components/ui/styles'
import { useAuth } from '../context/AuthContext'
import { api, errorMessage } from '../lib/api'

// Cambio voluntario de contraseña, disponible para toda cuenta autenticada.
export function PasswordChangePage() {
  const { user, loading, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ current_password: '', new_password: '', confirmation: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Esperar a /auth/me/ antes de redirigir; si no, un usuario con sesión sería enviado a /login por error.
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  function onChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)
    // La confirmación solo se valida en cliente; el backend recibe únicamente la contraseña nueva (y valida su política).
    if (form.new_password !== form.confirmation) {
      setError('Las contraseñas nuevas no coinciden.')
      return
    }

    setBusy(true)
    try {
      await api('/auth/password-change/', {
        method: 'POST',
        body: { current_password: form.current_password, new_password: form.new_password },
      })
      // Se actualiza el perfil tras guardar el cambio de contraseña.
      await refreshUser()
      navigate('/', { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app px-4 py-8">
      <section className="w-full max-w-md rounded-xl border border-app bg-surface p-6 shadow-sm">
        <h1 className={PAGE_TITLE}>Cambiar contraseña</h1>
        <p className={PAGE_SUBTITLE}>
          Ingresa tu contraseña actual y elige una nueva. Este cambio es voluntario.
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          {error && <div role="alert" className={ALERT_ERROR}>{error}</div>}
          <label className={LABEL}>
            Contraseña temporal
            <PasswordInput
              name="current_password"
              autoComplete="current-password"
              value={form.current_password}
              onChange={onChange}
              required
            />
          </label>
          <label className={LABEL}>
            Nueva contraseña
            <PasswordInput
              name="new_password"
              autoComplete="new-password"
              value={form.new_password}
              onChange={onChange}
              minLength={8}
              required
            />
          </label>
          <label className={LABEL}>
            Confirma la nueva contraseña
            <PasswordInput
              name="confirmation"
              autoComplete="new-password"
              value={form.confirmation}
              onChange={onChange}
              minLength={8}
              required
            />
          </label>
          <Button type="submit" loading={busy} fullWidth>
            Actualizar contraseña
          </Button>
        </form>
      </section>
    </main>
  )
}
