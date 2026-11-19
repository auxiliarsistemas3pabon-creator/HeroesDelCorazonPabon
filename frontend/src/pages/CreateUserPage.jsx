import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { AutocompleteSelect } from '../components/ui/AutocompleteSelect'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ALERT_ERROR, ALERT_OK, FIELD, LABEL, PAGE_SUBTITLE, PAGE_TITLE } from '../components/ui/styles'
import { api, errorMessage } from '../lib/api'

const ROLES = [
  { value: 'collaborator', label: 'Colaborador' },
  { value: 'boss', label: 'Coordinador (también evalúa y es evaluado)' },
  { value: 'superadmin', label: 'Superadministrador' },
]
const EMPTY = { username: '', first_name: '', last_name: '', area: '', position: '', role: 'collaborator' }

// Crear usuario (solo superadmin).
// POST /users/register/ crea siempre un colaborador: por seguridad ese endpoint no acepta el rol (ver users/tests.py).
// Si se elige otro rol, se asigna después con PATCH /users/admin/<id>/, el mismo que usa "Administrar usuarios".
export function CreateUserPage() {
  const [form, setForm] = useState(EMPTY)
  const [areas, setAreas] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    api('/users/areas/').then(setAreas).catch(() => setAreas([]))
  }, [])

  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const setInput = (field) => (event) => set(field)(event.target.value)

  async function submit(event) {
    event.preventDefault()
    setError(''); setNotice('')
    setSaving(true)
    let created = null
    try {
      const { username, first_name, last_name, area, position, role } = form
      created = await api('/users/register/', { method: 'POST', body: { username, first_name, last_name, area, position } })
      if (role !== 'collaborator') await api(`/users/admin/${created.id}/`, { method: 'PATCH', body: { role } })
      const roleLabel = ROLES.find((item) => item.value === role).label
      setNotice(`Usuario ${created.username} creado como ${roleLabel}. Inicia sesión con su documento y la contraseña inicial; en su primer ingreso deberá cambiarla.`)
      setForm(EMPTY)
      if (form.area && !areas.includes(form.area)) setAreas((current) => [...current, form.area].sort())
    } catch (e) {
      // La cuenta pudo crearse aunque falle la asignación del rol: se avisa para corregirlo en "Administrar usuarios".
      setError(created
        ? `El usuario ${created.username} se creó como Colaborador, pero no se pudo asignar el rol: ${errorMessage(e)}`
        : errorMessage(e))
      if (created) setForm(EMPTY)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className={PAGE_TITLE}>Crear usuario</h1>
        <p className={PAGE_SUBTITLE}>
          Registra una cuenta nueva con la contraseña inicial: la persona deberá cambiarla en su primer ingreso. Para cambiar el rol, inhabilitar o restablecer la contraseña de cuentas existentes usa{' '}
          <Link to="/users" className="font-medium text-primary hover:underline">Administrar usuarios</Link>.
        </p>
      </div>

      {error && <div role="alert" className={ALERT_ERROR}>{error}</div>}
      {notice && <div role="status" className={ALERT_OK}>{notice}</div>}

      <Card className="max-w-3xl">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <label className={LABEL}>
            Documento (usuario)
            <input className={FIELD} name="username" inputMode="numeric" autoComplete="off" required value={form.username} onChange={setInput('username')} placeholder="Ej. 1098765432" />
            <span className="text-xs font-normal text-app-muted">Con este número inicia sesión.</span>
          </label>
          <label className={LABEL}>
            Rol
            <AutocompleteSelect value={form.role} onChange={(value) => value && set('role')(value)} options={ROLES} />
          </label>
          <label className={LABEL}>
            Nombres
            <input className={FIELD} name="first_name" autoComplete="off" required value={form.first_name} onChange={setInput('first_name')} />
          </label>
          <label className={LABEL}>
            Apellidos
            <input className={FIELD} name="last_name" autoComplete="off" required value={form.last_name} onChange={setInput('last_name')} />
          </label>
          <label className={LABEL}>
            Área
            <AutocompleteSelect
              value={form.area}
              allowCustom
              onChange={set('area')}
              placeholder="Elige o escribe un área"
              options={areas.map((area) => ({ value: area, label: area }))}
            />
          </label>
          <label className={LABEL}>
            Cargo
            <input className={FIELD} name="position" autoComplete="off" required value={form.position} onChange={setInput('position')} placeholder="Ej. Enfermera profesional" />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { setForm(EMPTY); setError(''); setNotice('') }}>
              Limpiar
            </Button>
            <Button type="submit" loading={saving} disabled={!form.area.trim()}>
              <UserPlus size={16} aria-hidden="true" /> Crear usuario
            </Button>
          </div>
        </form>
      </Card>
    </section>
  )
}
