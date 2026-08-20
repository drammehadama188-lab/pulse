import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Flag, CalendarClock, CheckCircle2, Plus, Pencil, Trash2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar, Button, Card, Field, Input, Pill, Select, SectionTitle, Spinner, Textarea } from '../components/ui.jsx'
import { dateLong } from '../lib/format.js'

// MY TEAM · one team member. The lead sees the member's KPI SCORECARD (so they
// know WHAT to coach on — the weak KPIs stand out), plus a "Log coaching /
// check-in" action that feeds the lead's weekly-check-in KPI, and the full
// coaching history. Real KPI actuals only: sales from the sheet, the rest fill
// in from the Admin feed later ("Connecting to Admin" until then).

const TYPES = [
  { key: 'coaching', label: 'Coaching / check-in', icon: MessageSquare },
  { key: 'flag', label: 'Flag / concern', icon: Flag },
  { key: 'meeting', label: 'Meeting', icon: CalendarClock },
]

function kpiTone(pct) {
  if (pct == null) return 'neutral'
  if (pct >= 100) return 'good'
  if (pct >= 60) return 'warn'
  return 'bad'
}
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default function TeamMember() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { user, isViewAs } = useAuth()
  // Edit and delete are separate permissions (Team → sub-toggles; CEO always)
  // — logging stays a lead's built-in right. Follows the VIEWED user under
  // view-as (faithful rule); the server refuses read-only impersonated writes.
  const canEditCoaching = !!user?.canCoachingEdit
  const canDeleteCoaching = !!user?.canCoachingDelete
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // coaching record id being edited
  const [confirmDel, setConfirmDel] = useState(null) // record id waiting for delete confirm
  const [delBusy, setDelBusy] = useState(false)

  async function removeCoaching(id) {
    setDelBusy(true)
    try { await api(`/coaching/${id}`, { method: 'DELETE' }); setConfirmDel(null); await load() }
    catch (e) { setError(e.message) }
    finally { setDelBusy(false) }
  }

  async function load() {
    try { setData(await api(`/team/member/${username}`)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [username])

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>
  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-your-team-member' ? "This person isn't on your team." : `Couldn't load — ${error}`}</Card>

  const kpis = data.scorecard?.kpis || []

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/team-dashboard')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-brand)]">
        <ArrowLeft size={16} /> Team Dashboard
      </button>

      {/* header */}
      <div className="flex items-center gap-4">
        <Avatar name={data.name} size={56} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="text-[var(--color-ink-soft)]">{data.title} · {data.department}</p>
        </div>
        <div className="ml-auto text-right">
          {data.coachingCurrent
            ? <Pill tone="good"><CheckCircle2 size={13} /> Check-in up to date</Pill>
            : <Pill tone="warn">Check-in due</Pill>}
          <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
            {data.lastCoachedAt ? `Last: ${fmtDay(data.lastCoachedAt)}` : 'No check-in yet'}
            {data.nextCoachingDue ? ` · Next due: ${fmtDay(data.nextCoachingDue)}` : ''}
          </div>
        </div>
      </div>

      {/* KPI scorecard — WHAT to coach on */}
      <div>
        <SectionTitle>{data.scorecard?.role || 'Scorecard'} · this month</SectionTitle>
        {kpis.length === 0 ? (
          <Card className="p-6 text-center text-sm text-[var(--color-ink-faint)]">No scorecard for this role yet.</Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
            {kpis.map((k) => {
              const pct = k.actual == null ? null : Math.min(100, Math.round((k.actual / k.target) * 100))
              const tone = kpiTone(pct)
              return (
                <div key={k.key} className="px-4 py-3.5 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--color-ink)]">{k.label}<span className="ml-2 text-xs font-medium text-[var(--color-ink-faint)]">weight {k.weight}%</span></div>
                    <div className="text-sm font-bold tabular-nums text-[var(--color-ink)]">
                      {k.actual == null
                        ? <span className="text-[var(--color-ink-faint)]">— <span className="text-xs font-medium">Connecting to Admin</span></span>
                        : <>{k.actual}{k.kind === 'percent' ? '%' : ''} <span className="text-xs font-medium text-[var(--color-ink-faint)]">/ {k.target}{k.kind === 'percent' ? '%' : ` ${k.unit}`}</span></>}
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-fill)]">
                    <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: `var(--color-${tone === 'neutral' ? 'line' : tone})` }} />
                  </div>
                </div>
              )
            })}
          </Card>
        )}
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Weak KPIs (below target) are where a check-in helps most. Actuals fill in as the Admin feed connects and reviews are locked.</p>
      </div>

      {/* Log a check-in */}
      <div>
        <SectionTitle>Log coaching / check-in</SectionTitle>
        <p className="mb-3 -mt-1 text-xs text-[var(--color-ink-faint)]">
          Cadence: every {data.coachingIntervalDays ? `${data.coachingIntervalDays / 7} weeks` : '2 weeks'}.{' '}
          {data.coachingCurrent
            ? `Up to date — next due ${data.nextCoachingDue ? fmtDay(data.nextCoachingDue) : ''}.`
            : data.lastCoachedAt ? `Overdue — last check-in ${fmtDay(data.lastCoachedAt)}.` : 'No check-in logged yet.'}
        </p>
        {isViewAs
          ? <Card className="p-5 text-sm font-medium text-[var(--color-ink-faint)]">Read-only view — logging is disabled while viewing as someone else.</Card>
          : <CoachingForm username={data.username} name={data.name} onSaved={load} />}
      </div>

      {/* History */}
      <div>
        <SectionTitle>History</SectionTitle>
        {data.coaching.length === 0 ? (
          <Card className="p-6 text-center text-sm text-[var(--color-ink-faint)]">No check-ins logged yet.</Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
            {data.coaching.map((c) => {
              const T = TYPES.find((t) => t.key === c.type) || TYPES[0]
              const Icon = T.icon
              if (editing === c.id) {
                return (
                  <div key={c.id} className="px-4 py-3.5 sm:px-5">
                    <CoachingForm
                      username={data.username}
                      name={data.name}
                      record={c}
                      onSaved={async () => { setEditing(null); await load() }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )
              }
              return (
                <div key={c.id} className="flex gap-3 px-4 py-3.5 sm:px-5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand)]"><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--color-ink)]">{c.title || T.label}</div>
                    {c.note && <div className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{c.note}</div>}
                    <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
                      {new Date(c.datetime || c.createdAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {c.createdBy}{c.editedBy ? ` · edited by ${c.editedBy}` : ''}
                    </div>
                  </div>
                  {(canEditCoaching || canDeleteCoaching) && (
                    <div className="flex shrink-0 items-start gap-1">
                      {canEditCoaching && (
                        <button onClick={() => { setEditing(c.id); setConfirmDel(null) }} title="Edit" className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)]"><Pencil size={14} /></button>
                      )}
                      {canDeleteCoaching && (confirmDel === c.id ? (
                        <button onClick={() => removeCoaching(c.id)} disabled={delBusy} className="rounded-lg bg-[var(--color-bad)] px-2 py-1 text-xs font-bold text-white disabled:opacity-60">{delBusy ? 'Deleting…' : 'Delete?'}</button>
                      ) : (
                        <button onClick={() => setConfirmDel(c.id)} title="Delete" className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-paper)] hover:text-[var(--color-bad)]"><Trash2 size={14} /></button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </Card>
        )}
      </div>
    </div>
  )
}

function CoachingForm({ username, name, record = null, onSaved, onCancel }) {
  // With a record this same form edits it in place (PUT); without, it logs a new one.
  const [v, setV] = useState(record
    ? { type: record.type || 'coaching', title: record.title || '', note: record.note || '', datetime: record.datetime || '' }
    : { type: 'coaching', title: '', note: '', datetime: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }))

  async function submit() {
    setError('')
    if (v.type === 'meeting' && !v.datetime) return setError('Pick a date & time for the meeting')
    setBusy(true)
    try {
      if (record) {
        await api(`/coaching/${record.id}`, { method: 'PUT', body: v })
      } else {
        await api('/coaching', { method: 'POST', body: { targetUsername: username, ...v } })
        setV({ type: 'coaching', title: '', note: '', datetime: '' })
      }
      await onSaved()
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select value={v.type} onChange={set('type')}>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </Field>
        {v.type === 'meeting' && (
          <Field label="When"><Input type="datetime-local" value={v.datetime} onChange={set('datetime')} /></Field>
        )}
      </div>
      <Field label="Title"><Input value={v.title} onChange={set('title')} placeholder={v.type === 'meeting' ? 'e.g. Weekly 1:1' : v.type === 'flag' ? 'e.g. Missed Saturday shift' : `e.g. Coached ${name.split(' ')[0]} on pipeline`} /></Field>
      <Field label="Note"><Textarea rows={3} value={v.note} onChange={set('note')} placeholder="What did you discuss / agree?" /></Field>
      {error && <div className="text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={busy} icon={busy || record ? undefined : Plus}>{busy ? <Spinner size={18} /> : record ? 'Save changes' : 'Log check-in'}</Button>
        {record && <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </Card>
  )
}
