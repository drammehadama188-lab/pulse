import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '../../lib/api.js'
import { PageSkeleton } from '../../components/ui/Skeleton.jsx'

// One role, and everything it can do. Saving pushes the change to everyone on
// the role — that is the point of roles, and the page says so out loud before
// you press it rather than after.
//
// 🔑 A person's deliberate exceptions survive a role edit (the server keeps
// their custom keys). Assigning a role is the opposite: it resets them. Two
// different actions, and the copy on each says which is which.
export default function RoleEditor() {
  const { roleId } = useParams()
  const navigate = useNavigate()
  const isNew = roleId === 'new'
  const [catalogue, setCatalogue] = useState(null)
  const [role, setRole] = useState(null)
  const [members, setMembers] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let live = true
    api('/roles').then((r) => {
      if (!live) return
      setCatalogue(r.powers || [])
      if (isNew) {
        setRole({ name: '', description: '', powers: [], subs: {} })
      } else {
        const found = (r.roles || []).find((x) => x.id === roleId)
        if (!found) return setError('No such role')
        setRole({ ...found, subs: { ...(found.subs || {}) } })
        setMembers(found.members || 0)
      }
    }).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [roleId, isNew])

  const has = (k) => (role?.powers || []).includes(k)
  const hasSub = (p, s) => {
    const list = role?.subs?.[p]
    // No stored list means every capability inside that power — the same rule
    // the server uses, so the screen cannot imply a narrower grant than exists.
    return !Array.isArray(list) || list.includes(s)
  }
  const togglePower = (k) => setRole((r) => ({
    ...r,
    powers: has(k) ? r.powers.filter((x) => x !== k) : [...r.powers, k],
  }))
  const toggleSub = (power, sub, allSubs) => setRole((r) => {
    const current = Array.isArray(r.subs?.[power]) ? r.subs[power] : allSubs.map((s) => s.key)
    const next = current.includes(sub) ? current.filter((x) => x !== sub) : [...current, sub]
    return { ...r, subs: { ...r.subs, [power]: next } }
  })

  async function save() {
    setSaving(true)
    setError('')
    try {
      const body = { name: role.name, description: role.description, powers: role.powers, subs: role.subs }
      if (isNew) await api('/roles', { method: 'POST', body })
      else await api(`/roles/${roleId}`, { method: 'PUT', body })
      navigate('/settings/team?tab=roles')
    } catch (e) {
      setError(e.message || 'Could not save')
      setSaving(false)
    }
  }
  async function remove() {
    setSaving(true)
    setError('')
    try {
      await api(`/roles/${roleId}`, { method: 'DELETE' })
      navigate('/settings/team?tab=roles')
    } catch (e) {
      setError(e.message || 'Could not delete')
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  if (error && !role) return <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>
  if (!role || !catalogue) return <PageSkeleton tiles={0} rows={6} />
  const locked = role.id === 'owner'

  return (
    <div className="space-y-6">
      <div>
        <nav className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-ink-faint)]">
          <Link to="/settings" className="hover:text-[var(--color-ink)]">Settings</Link>
          <ChevronRight size={14} />
          <Link to="/settings/team?tab=roles" className="hover:text-[var(--color-ink)]">Roles</Link>
          <ChevronRight size={14} />
          <span className="text-[var(--color-ink)]">{isNew ? 'New role' : role.name}</span>
        </nav>
        <h1 className="t-page mt-2">{isNew ? 'New role' : role.name}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          {locked
            ? 'The Owner role holds everything and cannot be changed.'
            : members > 0
              ? `Saving updates ${members} ${members === 1 ? 'person' : 'people'} on this role. Anyone given an exception keeps it.`
              : 'Nobody is on this role yet.'}
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <label className="block">
          <span className="text-[12px] text-[var(--color-ink-faint)]">Name</span>
          <input className="field mt-1 w-full" value={role.name} disabled={locked}
            onChange={(e) => setRole((r) => ({ ...r, name: e.target.value }))} placeholder="Sales supervisor" />
        </label>
        <label className="block">
          <span className="text-[12px] text-[var(--color-ink-faint)]">What this role is for</span>
          <input className="field mt-1 w-full" value={role.description || ''} disabled={locked}
            onChange={(e) => setRole((r) => ({ ...r, description: e.target.value }))}
            placeholder="Runs the sales team day to day" />
        </label>
      </div>

      <div className="space-y-3">
        <h2 className="text-[12.5px] font-semibold text-[var(--color-ink-soft)]">Permissions</h2>
        <div className="card divide-y divide-[var(--color-line-soft)]">
          {catalogue.map((p) => (
            <div key={p.key} className="px-5 py-4">
              <div className="flex items-start gap-4">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--color-ink)]">{p.label}</span>
                  <span className="block text-[12.5px] text-[var(--color-ink-soft)]">{p.detail}</span>
                </span>
                <button type="button" onClick={() => !locked && togglePower(p.key)} disabled={locked}
                  aria-pressed={has(p.key)}
                  className={`h-7 shrink-0 rounded-[8px] px-3 text-[12px] font-medium disabled:opacity-50 ${has(p.key)
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'border border-[var(--color-line-control)] text-[var(--color-ink-soft)]'}`}>
                  {has(p.key) ? 'On' : 'Off'}
                </button>
              </div>
              {/* The capabilities inside a power only matter once the power is
                  on — showing them otherwise implies a grant that is not there. */}
              {has(p.key) && p.subs.length > 0 && (
                <div className="mt-3 space-y-2 border-l border-[var(--color-line)] pl-4">
                  {p.subs.map((s) => (
                    <div key={s.key} className="flex items-start gap-3">
                      <button type="button" onClick={() => !locked && toggleSub(p.key, s.key, p.subs)} disabled={locked}
                        aria-pressed={hasSub(p.key, s.key)}
                        className={`mt-0.5 h-5 w-5 shrink-0 rounded-[5px] border text-[11px] font-semibold disabled:opacity-50 ${hasSub(p.key, s.key)
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                          : 'border-[var(--color-line-control)] text-transparent'}`}>✓</button>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] text-[var(--color-ink)]">{s.label}</span>
                        <span className="block text-[12px] text-[var(--color-ink-faint)]">{s.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>}

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={saving || !role.name.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : isNew ? 'Create role' : `Save${members ? ` and update ${members}` : ''}`}
          </button>
          <Link to="/settings/team?tab=roles" className="btn-secondary">Cancel</Link>
          {!isNew && !role.builtin && (
            <span className="ml-auto flex items-center gap-3">
              {confirmDelete ? (
                <>
                  <span className="text-[12.5px] text-[var(--color-ink-soft)]">Delete this role?</span>
                  <button onClick={remove} disabled={saving}
                    className="text-[12.5px] font-medium text-[var(--color-stage-out)] hover:underline disabled:opacity-50">Yes, delete</button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="text-[12.5px] font-medium text-[var(--color-ink-soft)] hover:underline">Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="text-[12.5px] font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]">Delete role</button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
