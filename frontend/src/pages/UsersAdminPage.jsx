import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { PAGE_TITLE } from '../components/ui/styles'
import { api, errorMessage } from '../lib/api'

const ROLES = [
  ['superadmin', 'Superadministrador'],
  ['boss', 'Coordinador'],
  ['collaborator', 'Colaborador'],
  ['personal', 'Personal'],
]
const PAGE_SIZE = 10

export function UsersAdminPage() {
  const [users, setUsers] = useState([])
  const [passwordUser, setPasswordUser] = useState(null)
  const [passwordForm, setPasswordForm] = useState({ new_password: '', confirmation: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try { setUsers(await api('/users/admin/')); setError('') }
    catch (e) { setError(errorMessage(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function update(id, data) {
    setError(''); setNotice('')
    try {
      const updated = await api(`/users/admin/${id}/`, { method: 'PATCH', body: data })
      setUsers((current) => current.map((user) => user.id === id ? updated : user))
      setNotice(data.new_password
        ? 'Contraseña restablecida. El usuario puede iniciar sesión con la nueva clave; el estado de la cuenta no se modificó.'
        : data.is_active === false ? 'Cuenta inhabilitada.' : 'Rol actualizado.')
    } catch (e) { setError(errorMessage(e)) }
  }

  async function savePassword(event) {
    event.preventDefault()
    if (passwordForm.new_password !== passwordForm.confirmation) { setError('Las contraseñas no coinciden.'); return }
    setSavingPassword(true)
    setError('')
    try {
      const updated = await api(`/users/admin/${passwordUser.id}/`, { method: 'PATCH', body: { new_password: passwordForm.new_password } })
      setUsers((current) => current.map((user) => user.id === updated.id ? updated : user))
      setNotice('Contraseña actualizada. El estado de la cuenta no se modificó.')
      setPasswordUser(null)
      setPasswordForm({ new_password: '', confirmation: '' })
    } catch (e) { setError(errorMessage(e)) }
    finally { setSavingPassword(false) }
  }

  // Dispositivo fijo: liberar permite que la cuenta inicie sesión en otro navegador (el actual pierde la sesión).
  async function releaseDevice(user) {
    if (!window.confirm(`¿Liberar el navegador vinculado a ${user.username}? Su sesión actual se cerrará y el próximo navegador donde inicie sesión quedará vinculado.`)) return
    setError(''); setNotice('')
    try {
      await api(`/users/admin/${user.id}/release-device/`, { method: 'POST' })
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, has_device: false } : item))
      setNotice(`Dispositivo liberado para ${user.username}.`)
    } catch (e) { setError(errorMessage(e)) }
  }

  const filtered = users.filter((user) => !query.trim() || `${user.username} ${user.first_name} ${user.last_name} ${user.area}`.toLowerCase().includes(query.trim().toLowerCase()))
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const pageUsers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className={PAGE_TITLE}>Administrar usuarios</h1><p className="mt-1 text-sm text-app-muted">{users.length} cuentas registradas</p></div>
      <input type="search" name="user-directory-filter" autoComplete="off" aria-label="Buscar usuarios" className="h-10 rounded-lg border border-app bg-surface px-3 text-sm" placeholder="Buscar por nombre o documento" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {loading ? <p role="status">Cargando usuarios…</p> : <div className="overflow-x-auto rounded-xl border border-app bg-surface">
      <table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-app-muted text-app-muted"><tr>{['Usuario','Nombre','Área','Rol','Estado','Dispositivo','Acciones'].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{pageUsers.map((user) => <tr key={user.id} className="border-t border-app">
          <td className="px-4 py-3 font-medium">{user.username}</td><td className="px-4 py-3">{user.first_name} {user.last_name}</td><td className="px-4 py-3">{user.area || '—'}</td>
          <td className="px-4 py-3"><select aria-label={`Rol de ${user.username}`} className="rounded-md border border-app bg-surface px-2 py-2" value={user.role} onChange={(e) => update(user.id, { role: e.target.value })}>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
          <td className="px-4 py-3">{user.is_active
            ? <Button size="sm" variant="danger" onClick={() => update(user.id, { is_active: false })}>Inhabilitar</Button>
            : <span className="text-app-muted">Inhabilitado</span>}</td>
          <td className="px-4 py-3">{user.has_device
            ? <div className="flex items-center gap-2"><span className="whitespace-nowrap text-app">Vinculado</span><Button size="sm" variant="secondary" onClick={() => releaseDevice(user)}>Liberar</Button></div>
            : <span className="whitespace-nowrap text-app-muted">Sin vincular</span>}</td>
          <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => { setError(''); setPasswordUser(user); setPasswordForm({ new_password: '', confirmation: '' }) }}>Cambiar contraseña</Button></td>
        </tr>)}</tbody></table>
      {!filtered.length && <p className="p-6 text-center text-app-muted">No hay usuarios que coincidan.</p>}
    </div>}
    {!loading && pageCount > 1 && <nav aria-label="Paginación de usuarios" className="flex items-center justify-between gap-3 text-sm">
      <span className="text-app-muted">Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
        <span className="flex items-center px-2" aria-live="polite">Página {page} de {pageCount}</span>
        <Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
      </div>
    </nav>}
    {passwordUser && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setPasswordUser(null) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="password-modal-title" className="w-full max-w-md rounded-xl border border-app bg-surface p-6 shadow-xl">
        <h2 id="password-modal-title" className="text-lg font-semibold text-app">Cambiar contraseña</h2>
        <p className="mt-1 text-sm text-app-muted">Cuenta: {passwordUser.username}. El estado de la cuenta no cambiará.</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <form className="mt-5 space-y-4" onSubmit={savePassword}>
          <label className="block space-y-1 text-sm font-medium">Nueva contraseña
            <input autoFocus autoComplete="new-password" type="password" minLength="8" required className="w-full rounded-lg border border-app bg-surface px-3 py-2" value={passwordForm.new_password} onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))} />
          </label>
          <label className="block space-y-1 text-sm font-medium">Confirmar contraseña
            <input autoComplete="new-password" type="password" minLength="8" required className="w-full rounded-lg border border-app bg-surface px-3 py-2" value={passwordForm.confirmation} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmation: event.target.value }))} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPasswordUser(null)}>Cancelar</Button>
            <Button type="submit" loading={savingPassword}>Guardar contraseña</Button>
          </div>
        </form>
      </section>
    </div>}
  </section>
}
