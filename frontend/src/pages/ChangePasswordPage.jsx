import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ALERT_ERROR, ALERT_OK, FIELD, LABEL, PAGE_SUBTITLE, PAGE_TITLE } from '../components/ui/styles'
import { useAuth } from '../context/AuthContext'
import { api, errorMessage } from '../lib/api'

const EMPTY = { current_password: '', new_password: '', confirmation: '' }

// Formulario para cambiar la propia clave (POST /auth/password-change/). `forced`: la cuenta tiene la clave inicial
// y no puede usar la app hasta cambiarla (el backend bloquea el resto de la API con password_change_required).
export function ChangePasswordForm({ forced = false }) {
  const { updateUser } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const field = (name) => ({
    className: `${FIELD} pr-10`,
    name,
    type: show ? 'text' : 'password',
    required: true,
    value: form[name],
    onChange: (event) => setForm((current) => ({ ...current, [name]: event.target.value })),
  })

  async function submit(event) {
    event.preventDefault()
    setError(''); setNotice('')
    if (form.new_password !== form.confirmation) { setError('Las contraseñas nuevas no coinciden.'); return }
    setSaving(true)
    try {
      const user = await api('/auth/password-change/', {
        method: 'POST',
        body: { current_password: form.current_password, new_password: form.new_password },
      })
      setForm(EMPTY)
      setNotice('Contraseña actualizada.')
      // Con la clave inicial cambiada, el perfil llega sin password_change_required y se abre la app.
      updateUser(user)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <form className="space-y-4" onSubmit={submit}>
        {forced && (
          <p className="text-sm text-app-muted">
            Tu cuenta tiene la contraseña inicial, que conocen todos. Por seguridad, elige una propia para continuar.
          </p>
        )}
        {error && <div role="alert" className={ALERT_ERROR}>{error}</div>}
        {notice && <div role="status" className={ALERT_OK}>{notice}</div>}
        <label className={LABEL}>
          {forced ? 'Contraseña inicial' : 'Contraseña actual'}
          <input {...field('current_password')} autoComplete="current-password" />
        </label>
        <label className={LABEL}>
          Nueva contraseña
          <div className="relative">
            <input {...field('new_password')} autoComplete="new-password" minLength={8} />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex items-center px-3 text-app-muted hover:text-app"
              aria-label={show ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
              onClick={() => setShow((current) => !current)}
            >
              {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
          <span className="text-xs font-normal text-app-muted">Mínimo 8 caracteres; no puede ser solo números, muy común ni la contraseña inicial.</span>
        </label>
        <label className={LABEL}>
          Confirmar nueva contraseña
          <input {...field('confirmation')} autoComplete="new-password" minLength={8} />
        </label>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            <KeyRound size={16} aria-hidden="true" /> Cambiar contraseña
          </Button>
        </div>
      </form>
    </Card>
  )
}

// Página "Cambiar contraseña" (cualquier usuario con sesión).
export function ChangePasswordPage() {
  return (
    <section className="space-y-5">
      <div>
        <h1 className={PAGE_TITLE}>Cambiar contraseña</h1>
        <p className={PAGE_SUBTITLE}>Para cambiarla necesitas tu contraseña actual.</p>
      </div>
      <ChangePasswordForm />
    </section>
  )
}
