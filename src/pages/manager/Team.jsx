import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, UserPlus, CheckCircle2, Archive, RotateCcw, KeyRound } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Avatar, Button, Card, Pill, SectionTitle, Spinner, Modal, Field, Input, Select, Textarea } from '../../components/ui.jsx'
import { timeShort } from '../../lib/format.js'

const COACH_TYPES = [
  ['coaching', 'Coaching'],
  ['flag', 'Flag'],
  ['meeting', 'Meeting'],
]

export default function Team() {
  const { enterViewAs, hasRealPower, realUser } = useAuth()
  const navigate = useNavigate()
  const [presence, setPresence] = useState(null)
  const [team, setTeam] = useState([])
  const [users, setUsers] = useState([])
  const [coachTarget, setCoachTarget] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [accessTarget, setAccessTarget] = useState(null)
  const [pastAgents, setPastAgents] = useState([])

  function load() {
    Promise.all([api('/attendance'), api('/team'), api('/users'), api('/past-agents')]).then(([p, t, u, pa]) => {
      setPresence(p.presence)
      setTeam(t.team)
      setUsers(u.users)
      setPastAgents(pa.pastAgents)
    })
  }
  useEffect(() => {
    load()
  }, [])

  async function restore(username) {
    await api(`/staff/${username}/restore`, { method: 'POST' })
    load()
  }

  function viewAs(u) {
    enterViewAs(u)
    navigate('/')
  }

  if (!presence) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const present = presence.filter((p) => p.record?.checkIn)
  const out = presence.filter((p) => !p.record?.checkIn)
  const perfTone = (p) => (p == null ? 'neutral' : p >= 80 ? 'good' : p >= 50 ? 'warn' : 'bad')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Team</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Presence, performance and coaching.</p>
      </div>

      {/* team members: view-as + add coaching/flag/meeting */}
      <div>
        <SectionTitle
          action={
            <Button size="sm" icon={UserPlus} onClick={() => setAddOpen(true)}>
              Add staff
            </Button>
          }
        >
          Team members
        </SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {users.map((u) => (
            <div key={u.username} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Avatar name={u.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{u.name}</div>
                <div className="truncate text-xs text-[var(--color-ink-faint)]">{u.title}</div>
              </div>
              {u.role === 'manager' && <Pill tone="good">Manager</Pill>}
              {(u.powers || []).length > 0 && <Pill tone="neutral">{(u.powers || []).length} powers</Pill>}
              {hasRealPower('grant') && (
                <button
                  onClick={() => setAccessTarget(u)}
                  title="Access — grant or take powers"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                >
                  <KeyRound size={15} />
                </button>
              )}
              <button
                onClick={() => setCoachTarget(u)}
                title="Add coaching, flag or meeting"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => setArchiveTarget(u)}
                title="Archive — they left the team"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-faint)] transition-colors hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
              >
                <Archive size={15} />
              </button>
              {hasRealPower('viewas') && (
                <button
                  onClick={() => viewAs(u)}
                  title="Open their view"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand)] transition-colors hover:bg-[var(--color-brand-100)]"
                >
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          ))}
        </Card>
      </div>

      {/* presence */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>In today <Pill tone="good">{present.length}</Pill></SectionTitle>
          <div className="space-y-3">
            {present.length === 0 && <p className="text-sm text-[var(--color-ink-faint)]">No one checked in yet.</p>}
            {present.map((p) => (
              <div key={p.username} className="flex items-center gap-3">
                <Avatar name={p.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{p.name}</div>
                  <div className="text-xs text-[var(--color-ink-faint)]">in at {timeShort(p.record.checkIn)}</div>
                </div>
                {p.record.late && <Pill tone="warn">Late</Pill>}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle>Not in <Pill tone="neutral">{out.length}</Pill></SectionTitle>
          <div className="space-y-3">
            {out.map((p) => (
              <div key={p.username} className="flex items-center gap-3 opacity-70">
                <Avatar name={p.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{p.name}</div>
                  <div className="text-xs text-[var(--color-ink-faint)]">{p.department}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* performance */}
      <div>
        <SectionTitle>Performance</SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {team.map((p) => (
            <div key={p.name} className="flex items-center gap-4 px-5 py-3.5">
              <Avatar name={p.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[var(--color-ink)]">{p.name}</div>
                <div className="text-sm text-[var(--color-ink-faint)]">{p.role}</div>
              </div>
              {p.target > 0 ? (
                <div className="flex items-center gap-3">
                  <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-[var(--color-line)] sm:block">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, p.performance || 0)}%`, background: (p.performance || 0) >= 80 ? 'var(--color-good)' : (p.performance || 0) >= 50 ? 'var(--color-warn)' : 'var(--color-bad)' }} />
                  </div>
                  <Pill tone={perfTone(p.performance)}>{p.sales ?? 0}/{p.target}</Pill>
                </div>
              ) : (
                <Pill tone="neutral">{p.type}</Pill>
              )}
            </div>
          ))}
        </Card>
      </div>

      {/* past agents — people who left; records kept */}
      {pastAgents.length > 0 && (
        <div>
          <SectionTitle>Past agents <Pill tone="neutral">{pastAgents.length}</Pill></SectionTitle>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {pastAgents.map((p, i) => (
              <div key={p.username || `${p.name}-${i}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar name={p.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{p.name}</div>
                  <div className="truncate text-xs text-[var(--color-ink-faint)]">
                    {p.role}{p.reason ? ` · ${p.reason}` : ''}{p.date ? ` · ${p.date}` : ''}
                  </div>
                </div>
                {p.restorable ? (
                  <button
                    onClick={() => restore(p.username)}
                    title="Restore — bring them back"
                    className="flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                ) : (
                  <Pill tone="neutral">Left</Pill>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {coachTarget && <CoachingForm target={coachTarget} onClose={() => setCoachTarget(null)} />}
      {addOpen && <AddStaffForm onClose={() => setAddOpen(false)} onCreated={load} />}
      {accessTarget && (
        <AccessForm
          target={accessTarget}
          isCeo={realUser?.username === 'adama'}
          onClose={() => setAccessTarget(null)}
          onSaved={() => {
            setAccessTarget(null)
            load()
          }}
        />
      )}
      {archiveTarget && (
        <ArchiveDialog
          target={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onDone={() => {
            setArchiveTarget(null)
            load()
          }}
        />
      )}
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
        <p className="text-sm text-[var(--color-ink-soft)]">
          They’ll move to <span className="font-semibold text-[var(--color-ink)]">Past agents</span>, can no longer log in,
          and drop out of the active team and targets. Their record and history are kept — you can restore them anytime.
        </p>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Resigned, contract ended, let go" />
        </Field>
        {error && <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}

function AddStaffForm({ onClose, onCreated }) {
  const [v, setV] = useState({ type: 'agent', name: '', email: '', title: 'Sales Agent', salary: '', target: '5', contractMonths: '3' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const isMgr = v.type === 'manager'
  const pickType = (t) => setV((p) => ({ ...p, type: t, title: t === 'manager' ? 'Manager' : 'Sales Agent' }))

  async function save() {
    if (!v.name.trim()) return setError('Enter their full name')
    if (!/^\S+@\S+\.\S+$/.test(v.email)) return setError('Enter a valid email')
    setBusy(true)
    setError('')
    try {
      const r = await api('/staff', {
        method: 'POST',
        body: {
          type: v.type,
          name: v.name,
          email: v.email,
          title: v.title,
          salary: v.salary,
          target: v.target,
          contractMonths: v.contractMonths,
        },
      })
      setCreated(r.staff)
      onCreated()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Staff account created"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-good-bg)] text-[var(--color-good)]">
            <CheckCircle2 size={30} />
          </div>
          <div>
            <div className="text-lg font-bold text-[var(--color-ink)]">{created.name} is set up</div>
            <div className="mt-1 text-[var(--color-ink-soft)]">
              Username: <span className="font-bold text-[var(--color-ink)]">{created.username}</span>
            </div>
          </div>
          <p className="rounded-xl bg-[var(--color-fill)] px-4 py-3 text-left text-sm text-[var(--color-ink-soft)]">
            They can log in now with that username (no password yet). The invite email with the login link
            comes in the next step.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isMgr ? 'Add manager' : 'Add sales staff'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={16} /> : 'Create account'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {[['agent', 'Sales agent'], ['manager', 'Manager']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => pickType(k)}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${v.type === k ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="Full name"><Input value={v.name} onChange={set('name')} placeholder="e.g. Modou Njie" /></Field>
        <Field label="Email"><Input type="email" value={v.email} onChange={set('email')} placeholder="name@example.com" /></Field>
        <Field label="Title">
          <Select value={v.title} onChange={set('title')} options={isMgr ? ['Manager', 'Operations Manager', 'General Manager', 'Team Lead'] : ['Sales Agent', 'Sales Intern', 'Senior Sales Agent']} />
        </Field>
        <div className={isMgr ? '' : 'grid grid-cols-2 gap-3'}>
          <Field label="Monthly salary (D)"><Input type="number" min="0" value={v.salary} onChange={set('salary')} placeholder="e.g. 6000" /></Field>
          {!isMgr && <Field label="Monthly target (sales)"><Input type="number" min="0" value={v.target} onChange={set('target')} /></Field>}
        </div>
        <Field label="Contract length">
          <Select value={v.contractMonths} onChange={set('contractMonths')}>
            <option value="1">1 month</option>
            <option value="2">2 months</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="0">Indefinite</option>
          </Select>
        </Field>
        <p className="text-xs text-[var(--color-ink-faint)]">
          {isMgr
            ? 'Role is Manager — they clock in and get the management view (team schedule, approvals, attendance override). Cross-department goals are set separately.'
            : 'Salary is visible to managers only. Role is Sales — they get an empty pipeline of their own.'}
        </p>
        {error && <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}

// Access toggles — grant or take powers for one person. CEO can toggle
// everything; other granters cannot touch the 'grant' power (server
// enforces both rules again on save).
function AccessForm({ target, isCeo, onClose, onSaved }) {
  const [catalogue, setCatalogue] = useState(null)
  const [selected, setSelected] = useState(new Set(target.powers || []))
  const [canSignIn, setCanSignIn] = useState(!target.suspended)
  const [email, setEmail] = useState(target.email || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
      await api(`/staff/${target.username}/access`, { method: 'POST', body })
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
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
      {!catalogue && !error && <div className="flex justify-center py-8"><Spinner size={22} /></div>}
      {catalogue && (
        <div className="space-y-2">
          {/* Master switch — pause their Pulse sign-in entirely (reversible). */}
          <button
            onClick={() => setCanSignIn((v) => !v)}
            className={`mb-1 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
              canSignIn ? 'border-[var(--color-good)] bg-[var(--color-good-bg)]' : 'border-[var(--color-bad)] bg-[var(--color-bad-bg)]'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--color-ink)]">
                {canSignIn ? 'Can sign in to Pulse' : 'Sign-in paused'}
              </span>
              <span className="block text-xs text-[var(--color-ink-faint)]">
                {canSignIn ? 'Switch off to pause their access instantly (reversible).' : 'They cannot log in until you switch this back on.'}
              </span>
            </span>
            <Pill tone={canSignIn ? 'good' : 'bad'}>{canSignIn ? 'On' : 'Paused'}</Pill>
          </button>
          <Field label="Email (for their invite & login link)">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@damiatracker.com" />
          </Field>
          <p className="text-sm text-[var(--color-ink-soft)]">
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
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
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
                  <span className="block text-sm font-semibold text-[var(--color-ink)]">
                    {p.label}
                    {locked && <span className="ml-2 text-xs font-medium text-[var(--color-ink-faint)]">CEO only</span>}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-ink-faint)]">{p.detail}</span>
                </span>
              </button>
            )
          })}
          {error && <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
        </div>
      )}
      {!catalogue && error && (
        <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>
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
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${v.type === k ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}
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
        {error && <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}
