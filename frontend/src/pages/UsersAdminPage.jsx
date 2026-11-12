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
  const [passwords, setPasswords] = useState({})
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
      if (data.new_password) setPasswords((current) => ({ ...current, [id]: '' }))
      setNotice(data.new_password
        ? 'Contraseña restablecida. El usuario puede iniciar sesión con la nueva clave; el estado de la cuenta no se modificó.'
        : `Cuenta ${updated.is_active ? 'habilitada' : 'inhabilitada'}.`)
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
      <table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-app-muted text-app-muted"><tr>{['Usuario','Nombre','Área','Rol','Estado','Nueva contraseña','Acciones'].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{pageUsers.map((user) => <tr key={user.id} className="border-t border-app">
          <td className="px-4 py-3 font-medium">{user.username}</td><td className="px-4 py-3">{user.first_name} {user.last_name}</td><td className="px-4 py-3">{user.area || '—'}</td>
          <td className="px-4 py-3"><select aria-label={`Rol de ${user.username}`} className="rounded-md border border-app bg-surface px-2 py-2" value={user.role} onChange={(e) => update(user.id, { role: e.target.value })}>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
          <td className="px-4 py-3"><Button size="sm" variant={user.is_active ? 'danger' : 'secondary'} onClick={() => update(user.id, { is_active: !user.is_active })}>{user.is_active ? 'Inhabilitar' : 'Habilitar'}</Button></td>
          <td className="px-4 py-3"><input aria-label={`Nueva contraseña de ${user.username}`} name={`admin-password-reset-${user.id}`} autoComplete="new-password" type="password" minLength="8" className="w-44 rounded-md border border-app bg-surface px-2 py-2" value={passwords[user.id] || ''} onChange={(e) => setPasswords((current) => ({ ...current, [user.id]: e.target.value }))} placeholder="Mínimo 8 caracteres" /></td>
          <td className="px-4 py-3"><Button size="sm" disabled={(passwords[user.id] || '').length < 8} onClick={() => update(user.id, { new_password: passwords[user.id] })}>Restablecer</Button></td>
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
  </section>
}
