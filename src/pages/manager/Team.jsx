import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
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
  const { enterViewAs } = useAuth()
  const navigate = useNavigate()
  const [presence, setPresence] = useState(null)
  const [team, setTeam] = useState([])
  const [users, setUsers] = useState([])
  const [coachTarget, setCoachTarget] = useState(null)

  useEffect(() => {
    Promise.all([api('/attendance'), api('/team'), api('/users')]).then(([p, t, u]) => {
      setPresence(p.presence)
      setTeam(t.team)
      setUsers(u.users)
    })
  }, [])

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
        <SectionTitle>Team members</SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {users.map((u) => (
            <div key={u.username} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Avatar name={u.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{u.name}</div>
                <div className="truncate text-xs text-[var(--color-ink-faint)]">{u.title}</div>
              </div>
              {u.role === 'manager' && <Pill tone="good">Manager</Pill>}
              <button
                onClick={() => setCoachTarget(u)}
                title="Add coaching, flag or meeting"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => viewAs(u)}
                title="Open their view"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand)] transition-colors hover:bg-[var(--color-brand-100)]"
              >
                <ArrowRight size={16} />
              </button>
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

      {coachTarget && <CoachingForm target={coachTarget} onClose={() => setCoachTarget(null)} />}
    </div>
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
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${v.type === k ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-line-soft)] text-[var(--color-ink-soft)]'}`}
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
