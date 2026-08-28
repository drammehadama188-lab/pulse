import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus, ShieldCheck, Users } from 'lucide-react'
import { api } from '../../lib/api.js'
import { timeShort } from '../../lib/format.js'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { PageSkeleton } from '../../components/ui/Skeleton.jsx'

// Team & access — Members, Roles and Activity, in the arrangement Adama liked
// in admin (27 Aug). 🔒 The tab lives in the URL, so Back returns you to the
// tab you were on rather than to Members every time.
//
// 🔑 The members list is deliberately plain: who they are, their role, whether
// they can sign in. No performance numbers — that is what Performance is for,
// and an access page that also grades people invites the wrong decision.
const TABS = [
  ['members', 'Members', Users],
  ['roles', 'Roles', ShieldCheck],
  ['activity', 'Activity', null],
]
const dayLabel = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function TeamAccess() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'members'
  const [users, setUsers] = useState(null)
  const [roles, setRoles] = useState(null)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([api('/users'), api('/roles')])
      .then(([u, r]) => {
        if (!live) return
        setUsers(u.users || [])
        setRoles(r.roles || [])
      })
      .catch((e) => live && setError(e.message || 'Could not load team access'))
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (tab !== 'activity' || activity) return
    api('/access-activity').then((r) => setActivity(r.activity || [])).catch(() => setActivity([]))
  }, [tab, activity])

  const roleName = useMemo(
    () => Object.fromEntries((roles || []).map((r) => [r.id, r.name])),
    [roles],
  )

  if (error) return <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>
  if (!users || !roles) return <PageSkeleton tiles={0} rows={6} />

  const people = users.filter((u) => !u.archived && u.username !== 'adama')

  return (
    <div className="space-y-6">
      <div>
        <nav className="flex items-center gap-2 text-[13px] text-[var(--color-ink-faint)]">
          <Link to="/settings" className="hover:text-[var(--color-ink)]">Settings</Link>
          <ChevronRight size={14} />
          <span className="text-[var(--color-ink)]">Team &amp; access</span>
        </nav>
        <h1 className="t-page mt-2">Team &amp; access</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          A role decides what someone can do. Who they look after stays on the person.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setParams({ tab: key })}
            className={`-mb-px border-b-2 px-3.5 pb-3 pt-1 text-[13px] font-medium ${tab === key
              ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
              : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'members' && (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                {['Name', 'Role', 'Sign-in', ''].map((h, i) => <th key={i} className="h-[46px] px-5">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((u) => (
                <tr key={u.username} className="border-b border-[var(--color-line-soft)] last:border-0 hover:bg-[var(--color-row-hover)]">
                  <td className="px-5 py-4">
                    <Link to={`/settings/team/member/${u.username}`} className="font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]">
                      {u.name}
                    </Link>
                    <span className="block text-[12px] text-[var(--color-ink-faint)]">{u.title || u.department || ''}</span>
                  </td>
                  <td className="px-5 py-4 text-[var(--color-ink-soft)]">
                    {roleName[u.roleId] || <span className="text-[var(--color-ink-ghost)]">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center rounded-[6px] px-2 py-1 text-[12px] font-medium"
                      style={u.suspended
                        ? { color: 'var(--color-pill-leave)', background: 'var(--color-pill-leave-bg)' }
                        : { color: 'var(--color-pill-active)', background: 'var(--color-pill-active-bg)' }}>
                      {u.suspended ? 'Paused' : 'Allowed'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link to={`/settings/team/member/${u.username}`} className="text-[13px] font-medium text-[var(--color-brand)] hover:underline">Access</Link>
                  </td>
                </tr>
              ))}
              {people.length === 0 && (
                <tr><td colSpan={4}>
                  <EmptyState title="Nobody here yet" line="Staff added in Employees appear here with a role." />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'roles' && (
        <div className="space-y-3">
          <div className="card divide-y divide-[var(--color-line-soft)]">
            {roles.map((r) => (
              <Link key={r.id} to={`/settings/team/roles/${r.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--color-soft)]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--color-ink)]">{r.name}</span>
                  <span className="block text-[12.5px] text-[var(--color-ink-soft)]">{r.description || 'No description'}</span>
                </span>
                <span className="shrink-0 text-[12.5px] text-[var(--color-ink-faint)]">
                  {r.powers?.length || 0} {r.powers?.length === 1 ? 'permission' : 'permissions'} · {r.members} {r.members === 1 ? 'person' : 'people'}
                </span>
                <ChevronRight size={16} className="shrink-0 text-[var(--color-ink-faint)]" />
              </Link>
            ))}
          </div>
          <Link to="/settings/team/roles/new" className="btn-secondary inline-flex items-center gap-2">
            <Plus size={15} /> New role
          </Link>
        </div>
      )}

      {tab === 'activity' && (
        <div className="card overflow-hidden">
          {!activity ? <PageSkeleton tiles={0} rows={4} /> : activity.length === 0 ? (
            <EmptyState title="No access changes yet" line="Every change to someone's permissions is recorded here — who changed it, and when." />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                  {['When', 'Who', 'Change', 'By'].map((h) => <th key={h} className="h-[46px] px-5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {activity.map((a, i) => (
                  <tr key={i} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">
                      {dayLabel(a.at)} <span className="text-[var(--color-ink-faint)]">{timeShort(a.at)}</span>
                    </td>
                    <td className="px-5 py-4 font-medium text-[var(--color-ink)]">{a.who}</td>
                    <td className="px-5 py-4 text-[var(--color-ink-soft)]">
                      {a.roleAssigned && <span className="mr-2">Role set to <b className="font-medium text-[var(--color-ink)]">{roleName[a.roleAssigned] || a.roleAssigned}</b></span>}
                      {a.roleEdit && <span className="mr-2">Followed a change to <b className="font-medium text-[var(--color-ink)]">{roleName[a.roleEdit] || a.roleEdit}</b></span>}
                      {a.gained?.length > 0 && <span className="mr-2" style={{ color: 'var(--color-pill-active)' }}>+ {a.gained.join(', ')}</span>}
                      {a.lost?.length > 0 && <span className="mr-2" style={{ color: 'var(--color-stage-out)' }}>− {a.lost.join(', ')}</span>}
                      {a.signIn && <span className="text-[var(--color-ink-faint)]">sign-in {a.signIn}</span>}
                      {!a.roleAssigned && !a.roleEdit && !a.gained?.length && !a.lost?.length && !a.signIn && (
                        <span className="text-[var(--color-ink-ghost)]">no change to permissions</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[var(--color-ink-soft)]">{a.by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
