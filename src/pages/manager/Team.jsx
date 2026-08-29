import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, UserPlus, CheckCircle2, Archive, KeyRound, Users, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Avatar, Button, Card, Pill, SectionTitle, Spinner, Modal, Field, Input, Textarea } from '../../components/ui.jsx'
import { PageSkeleton } from '../../components/ui/Skeleton.jsx'
import AddStaffForm from '../../components/AddStaffForm.jsx'

// Staff — roles, permissions and accounts. The team-admin hub: invite staff,
// grant/revoke powers (shown inline so access is visible at a glance), reset
// passwords, view-as and archive. Presence + performance + past-agents used to
// live here but were duplicates of Attendance / Performance / Employees &
// Records, so they were removed (28 Jun 2026, Adama).

const COACH_TYPES = [
  ['coaching', 'Coaching'],
  ['flag', 'Flag'],
  ['meeting', 'Meeting'],
]

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{label}</p>
        {Icon && <Icon size={15} className="text-[var(--color-ink-faint)]" />}
      </div>
      <p className="mt-1 text-[22px] font-semibold text-[var(--color-ink)]">{value}</p>
    </Card>
  )
}

function IconBtn({ title, onClick, danger, brand, children }) {
  const tone = danger
    ? 'border-[var(--color-line)] text-[var(--color-ink-faint)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]'
    : brand
      ? 'bg-[var(--color-brand-50)] text-[var(--color-brand)] hover:bg-[var(--color-brand-100)] border-transparent'
      : 'border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]'
  return (
    <button onClick={onClick} title={title} className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${tone}`}>
      {children}
    </button>
  )
}

export default function Team() {
  const { enterViewAs, hasRealPower, realUser } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState(null)
  const [pastCount, setPastCount] = useState(0)
  const [labels, setLabels] = useState({})
  const [coachTarget, setCoachTarget] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  const [loadError, setLoadError] = useState('')
  function load() {
    setLoadError('')
    Promise.all([api('/users'), api('/past-agents'), api('/powers')]).then(([u, pa, pw]) => {
      setUsers(u.users)
      setPastCount((pa.pastAgents || []).length)
      const map = {}
      ;(pw.powers || []).forEach((p) => { map[p.key] = p.label })
      setLabels(map)
    }).catch((e) => setLoadError(e.message || 'Could not load staff')) // never spin forever
  }
  useEffect(() => {
    load()
  }, [])

  if (!users && loadError) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <p className="text-[13px] font-medium text-[var(--color-bad)]">Couldn't load the staff list — {loadError}</p>
        <button onClick={load} className="mt-3 rounded-lg bg-[var(--color-ink)] px-4 py-2 text-[13px] font-semibold text-white">Try again</button>
      </div>
    )
  }
  if (!users) return <PageSkeleton tiles={4} rows={6} />

  const withAccess = users.filter((u) => (u.powers || []).length > 0).length
  const managers = users.filter((u) => u.role === 'manager').length

  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-page">Staff</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Roles, permissions and accounts.</p>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} label="Team members" value={users.length} />
        <StatCard icon={ShieldCheck} label="With access" value={withAccess} />
        <StatCard icon={UserPlus} label="Managers" value={managers} />
        <StatCard icon={Archive} label="Past staff" value={pastCount} />
      </div>

      {/* team members — a clean table with access shown inline (admin-style) */}
      <div>
        <SectionTitle
          action={hasRealPower('staffadmin') ? <Button size="sm" icon={UserPlus} onClick={() => setAddOpen(true)}>Add staff</Button> : null}
        >
          Team members
        </SectionTitle>
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-fill)] px-4 py-2.5 sm:px-5">
            <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Member &amp; access</span>
          </div>
          <div className="divide-y divide-[var(--color-line-soft)]">
            {users.map((u) => {
              const powers = u.powers || []
              return (
                <div key={u.username} className="px-4 py-3 sm:px-5">
                  <div onClick={() => navigate(`/staff/${u.username}`)} className="flex min-w-0 items-center gap-3 cursor-pointer group">
                    <Avatar name={u.name} size={38} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[var(--color-ink)] group-hover:underline">{u.name}</span>
                        {u.role === 'manager' && <Pill tone="good">Manager</Pill>}
                      </div>
                      <div className="truncate text-[11.5px] text-[var(--color-ink-faint)]">{u.title}{u.department ? ` · ${u.department}` : ''}</div>
                      {/* Access shown inline so permissions are visible at a glance */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {u.suspended && <span className="rounded-full bg-[var(--color-bad-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-bad)]">Sign-in paused</span>}
                        {powers.length === 0 && !u.suspended && <span className="text-[11px] text-[var(--color-ink-faint)]">No admin access</span>}
                        {powers.map((p) => (
                          <span key={p} className="rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-brand)]">{labels[p] || p}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
        <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">Former staff and their pay records live in <button onClick={() => navigate('/people?tab=past')} className="font-semibold text-[var(--color-brand)] hover:underline">Employees &amp; Records → Past Staff</button>.</p>
      </div>

      {coachTarget && <CoachingForm target={coachTarget} onClose={() => setCoachTarget(null)} />}
      {addOpen && <AddStaffForm onClose={() => setAddOpen(false)} onCreated={load} />}
    </div>
  )
}

function ArchiveDialog({ target, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await api(`/staff/${target.username}/archive`, { method: 'POST', body: { reason } })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Archive ${target.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={confirm} disabled={busy}>{busy ? <Spinner size={16} /> : 'Archive'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-ink-soft)]">
          They’ll move to <span className="font-semibold text-[var(--color-ink)]">Past Staff</span>, can no longer log in,
          and drop out of the active team and targets. Their record and history are kept — you can restore them from Past Staff anytime.
        </p>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Resigned, contract ended, let go" />
        </Field>
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}

// Access — grant or take powers, pause sign-in, set the login email, and reset
// the password for one person. CEO can toggle everything; other granters cannot
// touch the 'grant' power (server enforces both rules again on save).
function AccessForm({ target, isCeo, onClose, onSaved }) {
  const [catalogue, setCatalogue] = useState(null)
  const [selected, setSelected] = useState(new Set(target.powers || []))
  const [canSignIn, setCanSignIn] = useState(!target.suspended)
  const [email, setEmail] = useState(target.email || '')
  const [personalEmail, setPersonalEmail] = useState(target.personalEmail || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Reset-password sub-state
  const [pwBusy, setPwBusy] = useState(false)
  const [pwDone, setPwDone] = useState('')
  const [pwError, setPwError] = useState('')

  useEffect(() => {
    api('/powers').then((d) => setCatalogue(d.powers)).catch((e) => setError(e.message))
  }, [])

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const body = { powers: [...selected], canSignIn }
      if (email.trim() && email.trim().toLowerCase() !== (target.email || '')) body.email = email.trim()
      if (personalEmail.trim().toLowerCase() !== (target.personalEmail || '')) body.personalEmail = personalEmail.trim()
      await api(`/staff/${target.username}/access`, { method: 'POST', body })
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  // Email-first reset, same as the profile page: one-time 60-min link, they
  // choose their own password. No temp passwords passed around.
  async function resetPassword() {
    setPwBusy(true); setPwError(''); setPwDone('')
    try {
      const r = await api(`/staff/${target.username}/send-password-link`, { method: 'POST' })
      setPwDone(r.blocked
        ? `Email sending is switched off on this machine (test mode) — nothing was sent. On the live server the link goes to ${r.email}.`
        : `Done. ${target.name.split(' ')[0]} got an email at ${r.email} with a link to choose a new password. The link works for 60 minutes.`)
    } catch (e) {
      setPwError(e.message)
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Access — ${target.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !catalogue}>{busy ? <Spinner size={16} /> : 'Save access'}</Button>
        </>
      }
    >
      {!catalogue && !error && <PageSkeleton tiles={4} rows={6} />}
      {catalogue && (
        <div className="space-y-2">
          {/* Master switch — pause their Pulse sign-in entirely (reversible). */}
          <button
            onClick={() => setCanSignIn((v) => !v)}
            className={`mb-1 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
              canSignIn ? 'border-[var(--color-good)] bg-[var(--color-good-bg)]' : 'border-[var(--color-bad)] bg-[var(--color-bad-bg)]'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-[var(--color-ink)]">
                {canSignIn ? 'Can sign in to Pulse' : 'Sign-in paused'}
              </span>
              <span className="block text-[11.5px] text-[var(--color-ink-faint)]">
                {canSignIn ? 'Switch off to pause their access instantly (reversible).' : 'They cannot log in until you switch this back on.'}
              </span>
            </span>
            <Pill tone={canSignIn ? 'good' : 'bad'}>{canSignIn ? 'On' : 'Paused'}</Pill>
          </button>
          <Field label="Work email (for their invite & login link)">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@damiatracker.com" />
          </Field>
          <Field label="Personal email">
            <Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} placeholder="name@gmail.com" />
          </Field>

          {/* Reset password — email-first, matches the profile page dialog */}
          <div className="rounded-lg border border-[var(--color-line)] px-4 py-3">
            <div className="text-[13px] font-semibold text-[var(--color-ink)]">Reset password</div>
            <p className="mb-2 text-[11.5px] text-[var(--color-ink-faint)]">Emails {target.name.split(' ')[0]} a link to choose a new password. Works for 60 minutes, one use.</p>
            <Button variant="outline" onClick={resetPassword} disabled={pwBusy}>{pwBusy ? <Spinner size={16} /> : 'Send reset email'}</Button>
            {pwDone && <div className="mt-2 rounded-lg bg-[var(--color-good-bg)] px-3 py-2 text-[11.5px] font-medium text-[var(--color-good)]">{pwDone}</div>}
            {pwError && <div className="mt-2 rounded-lg bg-[var(--color-bad-bg)] px-3 py-2 text-[11.5px] font-medium text-[var(--color-bad)]">{pwError}</div>}
          </div>

          <p className="text-[13px] text-[var(--color-ink-soft)]">
            Tick a power to open it for {target.name.split(' ')[0]}. Changes apply on their next page load.
          </p>
          {catalogue.map((p) => {
            const locked = p.key === 'grant' && !isCeo
            const on = selected.has(p.key)
            return (
              <button
                key={p.key}
                onClick={() => !locked && toggle(p.key)}
                disabled={locked}
                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                  on ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)]' : 'border-[var(--color-line)]'
                } ${locked ? 'opacity-50' : ''}`}
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-white ${
                    on ? 'border-[var(--color-brand)] bg-[var(--color-brand)]' : 'border-[var(--color-line)]'
                  }`}
                >
                  {on ? <CheckCircle2 size={14} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--color-ink)]">
                    {p.label}
                    {locked && <span className="ml-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">CEO only</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-[var(--color-ink-faint)]">{p.detail}</span>
                </span>
              </button>
            )
          })}
          {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
        </div>
      )}
      {!catalogue && error && (
        <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>
      )}
    </Modal>
  )
}

function CoachingForm({ target, onClose }) {
  const [v, setV] = useState({ type: 'coaching', title: '', note: '', datetime: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  async function save() {
    if (!v.title.trim() && !v.note.trim()) return setError('Add a title or note')
    if (v.type === 'meeting' && !v.datetime) return setError('Pick a meeting date & time')
    setBusy(true)
    try {
      await api('/coaching', { method: 'POST', body: { targetUsername: target.username, ...v } })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`For ${target.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={16} /> : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {COACH_TYPES.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setV({ ...v, type: k })}
              className={`flex-1 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors ${v.type === k ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="Title"><Input value={v.title} onChange={set('title')} placeholder={v.type === 'meeting' ? 'e.g. Weekly 1:1' : v.type === 'flag' ? 'e.g. Missed Saturday shift' : 'e.g. Pipeline coaching'} /></Field>
        {v.type === 'meeting' && (
          <Field label="When"><Input type="datetime-local" value={v.datetime} onChange={set('datetime')} /></Field>
        )}
        <Field label="Note"><Textarea rows={3} value={v.note} onChange={set('note')} /></Field>
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}
