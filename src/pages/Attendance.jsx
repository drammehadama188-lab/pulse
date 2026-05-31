import { useEffect, useState } from 'react'
import { Clock, LogIn, LogOut, CheckCircle2, MapPin, ChevronLeft, ChevronRight, CalendarCog } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getLocation, mapsUrl } from '../lib/geo.js'
import { Avatar, Button, Card, Modal, Pill, Select, SectionTitle, Spinner } from '../components/ui.jsx'
import { timeShort, dateLong } from '../lib/format.js'
import { DAY_FULL, WEEK_ORDER, weekDays, ymd } from '../lib/schedule.js'

// Hours page. Staff see their own check-in + weekly shifts; managers see the whole
// team's weekly shift grid (times + status per day), can log worked/off/sick/leave
// on any day, and set each person's weekly schedule.
export default function Attendance() {
  const { isManager } = useAuth()
  return isManager ? <ManagerHours /> : <MyHours />
}

// Shift-block tones: a defined card with a solid colour left-accent bar so blocks
// are clearly visible on any background (the faint-tint version washed out).
const TONE = {
  scheduled: 'border-l-[var(--color-brand)] bg-[var(--color-surface)]',
  worked: 'border-l-[var(--color-good)] bg-[var(--color-good-bg)]',
  late: 'border-l-[var(--color-warn)] bg-[var(--color-warn-bg)]',
  absent: 'border-l-[var(--color-line)] bg-[var(--color-fill)]',
  sick: 'border-l-[var(--color-rest)] bg-[var(--color-rest-bg)]',
  leave: 'border-l-[var(--color-brand)] bg-[var(--color-brand-50)]',
  offex: 'border-l-[var(--color-ink-faint)] bg-[var(--color-fill)]',
}
const TONE_DOT = {
  scheduled: 'var(--color-brand)',
  worked: 'var(--color-good)',
  late: 'var(--color-warn)',
  sick: 'var(--color-rest)',
  leave: 'var(--color-brand)',
}

// what a day cell renders: a shift block, an absence label, or nothing (rest day)
function cellView(cell, dept) {
  if (!cell) return null
  if (cell.leaveType) {
    const t = cell.leaveType.toLowerCase()
    if (t === 'sick') return { tone: 'sick', primary: 'Sick', secondary: cell.note }
    if (t === 'off') return { tone: 'offex', primary: 'Off', secondary: cell.note }
    return { tone: 'leave', primary: 'Leave', secondary: cell.note }
  }
  if (!cell.shift) return null // rest day
  const time = `${cell.shift.start}–${cell.shift.end}`
  if (cell.status === 'worked') return { tone: 'worked', primary: cell.checkIn && cell.checkOut ? `${timeShort(cell.checkIn)}–${timeShort(cell.checkOut)}` : time, secondary: 'Worked' }
  if (cell.status === 'late') return { tone: 'late', primary: time, secondary: 'Late in' }
  if (cell.status === 'absent') return { tone: 'absent', primary: time, secondary: 'No record' }
  return { tone: 'scheduled', primary: time, secondary: dept } // planned (today / upcoming)
}

function hoursOf(shift) {
  if (!shift) return 0
  const [sh, sm] = shift.start.split(':').map(Number)
  const [eh, em] = shift.end.split(':').map(Number)
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60)
}

// ───────────────────────── self check-in (shared logic) ─────────────────────────
function useSelfDay() {
  const [today, setToday] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)

  async function load() {
    try {
      const t = await api('/attendance/today')
      setToday(t.record)
    } catch (e) {
      console.error('attendance/today failed', e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function act(kind) {
    setBusy(true)
    setLocating(true)
    const loc = await getLocation()
    setLocating(false)
    try {
      const r = await api(`/attendance/${kind}`, { method: 'POST', body: loc || {} })
      setToday(r.record)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }
  return { today, loading, busy, locating, act }
}

// ───────────────────────── weekly shift data (shared) ───────────────────────────
function useWeekGrid() {
  const [start, setStart] = useState(() => ymd(weekDays()[0]))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load(s) {
    setLoading(true)
    try {
      const d = await api(`/attendance/week?start=${s}`)
      setData(d)
      setStart(d.start)
    } catch (e) {
      console.error('attendance/week failed', e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load(ymd(weekDays()[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function shift(delta) {
    const base = new Date(`${start}T00:00:00Z`)
    base.setUTCDate(base.getUTCDate() + delta * 7)
    load(base.toISOString().slice(0, 10))
  }
  const isThis = start === ymd(weekDays()[0])
  return { start, data, loading, shift, reload: () => load(start), isThis }
}

function WeekNav({ days, isThis, onPrev, onNext }) {
  let label = ''
  if (days?.length) {
    const a = new Date(`${days[0]}T00:00:00Z`)
    const b = new Date(`${days[6]}T00:00:00Z`)
    const sameMonth = a.getUTCMonth() === b.getUTCMonth()
    const mon = (d) => d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    label = `${a.getUTCDate()}${sameMonth ? '' : ' ' + mon(a)} – ${b.getUTCDate()} ${mon(b)}`
  }
  return (
    <div className="flex items-center gap-1">
      <button onClick={onPrev} className="rounded-lg p-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]" aria-label="Previous week"><ChevronLeft size={18} /></button>
      <span className="min-w-[132px] text-center text-sm font-semibold text-[var(--color-ink)]">{isThis ? 'This week' : label}</span>
      <button onClick={onNext} className="rounded-lg p-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]" aria-label="Next week"><ChevronRight size={18} /></button>
    </div>
  )
}

function LegendDot({ tone, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: TONE_DOT[tone] }} />
      {label}
    </span>
  )
}

// Weekly shift grid — rows = people, columns = days. Cells show shift times, tinted
// by status; week hours per person; day totals at the foot. (Zoho-Shifts style.)
function WeekSchedule({ people, days, today, onCellClick }) {
  const clickable = !!onCellClick
  const cols = `12rem repeat(${days.length}, minmax(94px, 1fr))`
  const totals = days.map((k) => {
    let hours = 0
    let on = 0
    for (const p of people) {
      const c = p.byDate?.[k]
      if (c?.shift && !c.leaveType) { on++; hours += hoursOf(c.shift) }
    }
    return { hours, on }
  })

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          {/* header */}
          <div className="grid border-b border-[var(--color-line)] bg-[var(--color-surface)]" style={{ gridTemplateColumns: cols }}>
            <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Staff</div>
            {days.map((k) => {
              const d = new Date(`${k}T00:00:00Z`)
              const dow = d.getUTCDay()
              const weekend = dow === 0 || dow === 6
              const isToday = k === today
              return (
                <div key={k} className="px-2 py-2 text-center">
                  <div className="text-[11px] font-medium text-[var(--color-ink-faint)]">{DAY_FULL[dow].slice(0, 3)}</div>
                  <div className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums ${isToday ? 'bg-[var(--color-brand)] text-white' : weekend ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>{d.getUTCDate()}</div>
                </div>
              )
            })}
          </div>

          {/* rows */}
          <div className="divide-y divide-[var(--color-line-soft)]">
            {people.map((p) => (
              <div key={p.username} className="grid items-stretch" style={{ gridTemplateColumns: cols }}>
                <div className="flex items-center gap-2.5 px-4 py-2.5">
                  <Avatar name={p.name} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight text-[var(--color-ink)]">{p.name}</div>
                    <div className="truncate text-[11px] text-[var(--color-ink-faint)]">{Math.round(p.weekHours)}h · {p.department}</div>
                  </div>
                </div>
                {days.map((k) => {
                  const cell = p.byDate?.[k]
                  const isToday = k === today
                  const view = cellView(cell, p.department)
                  return (
                    <div key={k} className={`border-l border-[var(--color-line-soft)] p-1.5 ${isToday ? 'bg-[var(--color-brand-50)]' : ''}`}>
                      <button
                        disabled={!clickable}
                        onClick={() => onCellClick?.(p, k, cell || { status: 'off' })}
                        title={`${p.name} · ${new Date(`${k}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                        className={`block h-full w-full text-left ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        {view ? (
                          <div className={`rounded-md border border-[var(--color-line-soft)] border-l-[3px] px-2 py-1.5 ${TONE[view.tone]} ${clickable ? 'transition-shadow hover:shadow-sm' : ''}`}>
                            <div className="text-[11px] font-bold leading-tight tabular-nums text-[var(--color-ink)]">{view.primary}</div>
                            {view.secondary && <div className={`truncate text-[10px] font-medium ${view.tone === 'absent' ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink-soft)]'}`}>{view.secondary}</div>}
                          </div>
                        ) : (
                          <div className={`flex h-full min-h-[42px] items-center justify-center rounded-lg text-[15px] text-[var(--color-line)] ${clickable ? 'hover:bg-[var(--color-paper)]' : ''}`}>{clickable ? '+' : ''}</div>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* day totals */}
          <div className="grid border-t border-[var(--color-line)] bg-[var(--color-surface)]" style={{ gridTemplateColumns: cols }}>
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Totals</div>
            {totals.map((t, i) => (
              <div key={i} className="border-l border-[var(--color-line-soft)] px-2 py-2 text-center">
                <div className="text-[12px] font-bold tabular-nums text-[var(--color-ink)]">{Math.round(t.hours)}h</div>
                <div className="text-[10px] text-[var(--color-ink-faint)]">{t.on} on</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-line-soft)] px-4 py-2.5 text-[11px] text-[var(--color-ink-soft)]">
        <LegendDot tone="scheduled" label="scheduled" />
        <LegendDot tone="worked" label="worked" />
        <LegendDot tone="late" label="late" />
        <LegendDot tone="sick" label="sick" />
        <LegendDot tone="leave" label="leave" />
        {clickable && <span className="ml-auto text-[var(--color-ink-faint)]">Click a shift to log worked · off · sick · leave</span>}
      </div>
    </Card>
  )
}

const STATUS_OPTIONS = [
  { key: 'worked', label: 'Worked' },
  { key: 'off', label: 'Off (excused)' },
  { key: 'sick', label: 'Sick' },
  { key: 'leave', label: 'Annual leave' },
]

function DayDetailModal({ person, dateKey, cell, onClose, onSaved }) {
  const known = ['worked', 'off', 'sick', 'leave']
  const [status, setStatus] = useState(cell.status === 'late' ? 'worked' : known.includes(cell.status) ? cell.status : 'worked')
  const [note, setNote] = useState(cell.note || '')
  const [saving, setSaving] = useState(false)
  const dateLabel = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

  async function save() {
    setSaving(true)
    try {
      await api('/attendance/day', { method: 'PUT', body: { username: person.username, date: dateKey, status, note } })
      onSaved()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={person.name}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : 'Save'}</Button>
        </>
      }
    >
      <p className="text-sm font-semibold text-[var(--color-ink)]">{dateLabel}</p>
      {(cell.checkIn || cell.leaveType || cell.shift) && (
        <p className="mb-3 mt-0.5 text-sm text-[var(--color-ink-soft)]">
          Currently:{' '}
          {cell.checkIn
            ? `worked ${timeShort(cell.checkIn)}${cell.checkOut ? ' – ' + timeShort(cell.checkOut) : ''}`
            : cell.leaveType
              ? `${cell.leaveType}${cell.note ? ' · ' + cell.note : ''}`
              : cell.shift
                ? `scheduled ${cell.shift.start}–${cell.shift.end}`
                : 'rest day'}
        </p>
      )}
      <div className="mt-3 space-y-2">
        {STATUS_OPTIONS.map((o) => (
          <label key={o.key} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${status === o.key ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)]' : 'border-[var(--color-line)]'}`}>
            <input type="radio" name="day-status" checked={status === o.key} onChange={() => setStatus(o.key)} className="accent-[var(--color-brand)]" />
            <span className="font-semibold text-[var(--color-ink)]">{o.label}</span>
          </label>
        ))}
      </div>
      {status !== 'worked' && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional note (e.g. called in, fever)"
          className="focus-ring mt-3 w-full resize-none rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none"
        />
      )}
    </Modal>
  )
}

// ───────────────────────────── staff / agent view ───────────────────────────────
function MyHours() {
  const { isViewAs } = useAuth()
  const { today, loading, busy, locating, act } = useSelfDay()
  const w = useWeekGrid()

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const checkedIn = !!today?.checkIn && !today?.checkOut
  const done = !!today?.checkOut

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">My hours</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{dateLong()}</p>
      </div>

      {/* today hero */}
      <Card className="overflow-hidden">
        <div
          className="flex flex-col items-center gap-4 p-8 text-center"
          style={{ background: done || checkedIn ? 'linear-gradient(160deg, var(--color-good-bg), var(--color-surface) 70%)' : 'linear-gradient(160deg, var(--color-brand-50), var(--color-surface) 70%)' }}
        >
          <span className={`flex h-16 w-16 items-center justify-center rounded-2xl text-white ${done || checkedIn ? 'bg-[var(--color-good)]' : 'bg-[var(--color-brand)]'}`}>
            {done ? <CheckCircle2 size={30} /> : <Clock size={30} />}
          </span>

          {done ? (
            <div>
              <div className="text-2xl font-extrabold">Day complete</div>
              <div className="mt-1 text-[var(--color-ink-soft)]">{timeShort(today.checkIn)} – {timeShort(today.checkOut)}</div>
            </div>
          ) : checkedIn ? (
            <div>
              <div className="flex items-center justify-center gap-2 text-2xl font-extrabold">Checked in {today.late && <Pill tone="warn">Late</Pill>}</div>
              <div className="mt-1 text-[var(--color-ink-soft)]">since {timeShort(today.checkIn)}</div>
            </div>
          ) : (
            <div>
              <div className="text-2xl font-extrabold">Ready to start?</div>
              <div className="mt-1 text-[var(--color-ink-soft)]">You haven't checked in today.</div>
            </div>
          )}

          {(today?.checkInLoc || today?.checkOutLoc) && (
            <div className="flex flex-wrap justify-center gap-3 text-sm">
              {today.checkInLoc && (
                <a href={mapsUrl(today.checkInLoc)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--color-brand)]">
                  <MapPin size={14} /> In location
                </a>
              )}
              {today.checkOutLoc && (
                <a href={mapsUrl(today.checkOutLoc)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--color-brand)]">
                  <MapPin size={14} /> Out location
                </a>
              )}
            </div>
          )}

          {!done && !isViewAs && (
            <Button size="lg" onClick={() => act(checkedIn ? 'check-out' : 'check-in')} disabled={busy} variant={checkedIn ? 'outline' : 'primary'} icon={busy ? undefined : checkedIn ? LogOut : LogIn}>
              {busy ? <Spinner size={18} /> : checkedIn ? 'Check out' : 'Check in'}
            </Button>
          )}
          {locating && <div className="text-xs text-[var(--color-ink-faint)]">Getting your location…</div>}
          {isViewAs && <span className="text-sm font-medium text-[var(--color-ink-faint)]">Read-only view</span>}
        </div>
      </Card>

      {/* my week (read-only — set by the manager) */}
      <div>
        <SectionTitle action={<WeekNav days={w.data?.days} isThis={w.isThis} onPrev={() => w.shift(-1)} onNext={() => w.shift(1)} />}>My week</SectionTitle>
        {w.loading || !w.data ? (
          <Card className="flex justify-center py-12"><Spinner size={24} /></Card>
        ) : (
          <WeekSchedule people={w.data.people} days={w.data.days} today={w.data.today} />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────── manager week view ─────────────────────────────────
function ManagerHours() {
  const { realUser } = useAuth()
  // The CEO doesn't clock in. A future people-manager role will — keep the card, gate it.
  const isCeo = realUser?.username === 'adama'
  const self = useSelfDay()
  const w = useWeekGrid()
  const [editorOpen, setEditorOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [detail, setDetail] = useState(null) // { person, dateKey, cell }

  const people = w.data?.people || []
  const shown = filter === 'all' ? people : people.filter((p) => p.username === filter)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Schedule</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">Team shifts, attendance &amp; leave</p>
        </div>
        <Button icon={CalendarCog} onClick={() => setEditorOpen(true)} disabled={!people.length}>Edit schedules</Button>
      </div>

      {!isCeo && <SelfCheckInCompact {...self} />}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-[220px]">
            <option value="all">All staff</option>
            {people.map((p) => (
              <option key={p.username} value={p.username}>{p.name}</option>
            ))}
          </Select>
          <WeekNav days={w.data?.days} isThis={w.isThis} onPrev={() => w.shift(-1)} onNext={() => w.shift(1)} />
        </div>

        {w.loading || !w.data ? (
          <Card className="flex justify-center py-12"><Spinner size={24} /></Card>
        ) : !shown.length ? (
          <Card className="px-5 py-10 text-center text-[var(--color-ink-faint)]">No staff yet.</Card>
        ) : (
          <WeekSchedule
            people={shown}
            days={w.data.days}
            today={w.data.today}
            onCellClick={(person, dateKey, cell) => setDetail({ person, dateKey, cell })}
          />
        )}
      </div>

      {editorOpen && (
        <TeamScheduleEditor
          people={people}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); w.reload() }}
        />
      )}
      {detail && (
        <DayDetailModal
          person={detail.person}
          dateKey={detail.dateKey}
          cell={detail.cell}
          onClose={() => setDetail(null)}
          onSaved={() => { setDetail(null); w.reload() }}
        />
      )}
    </div>
  )
}

function SelfCheckInCompact({ today, loading, busy, act }) {
  if (loading) return null
  const checkedIn = !!today?.checkIn && !today?.checkOut
  const done = !!today?.checkOut
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${done || checkedIn ? 'bg-[var(--color-good)]' : 'bg-[var(--color-brand)]'}`}>
        {done ? <CheckCircle2 size={22} /> : <Clock size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-bold text-[var(--color-ink)]">
          {done ? 'You: day complete' : checkedIn ? 'You: checked in' : 'You: not checked in'}
          {today?.late && <Pill tone="warn">Late</Pill>}
        </div>
        <div className="text-xs text-[var(--color-ink-soft)]">
          {done ? `${timeShort(today.checkIn)} – ${timeShort(today.checkOut)}` : checkedIn ? `since ${timeShort(today.checkIn)}` : dateLong()}
        </div>
      </div>
      {!done && (
        <Button size="sm" onClick={() => act(checkedIn ? 'check-out' : 'check-in')} disabled={busy} variant={checkedIn ? 'outline' : 'primary'} icon={busy ? undefined : checkedIn ? LogOut : LogIn}>
          {busy ? <Spinner size={16} /> : checkedIn ? 'Check out' : 'Check in'}
        </Button>
      )}
    </Card>
  )
}

// One editor, everyone in it. Each person keeps their own days-off + hours.
function TeamScheduleEditor({ people, onClose, onSaved }) {
  const [rows, setRows] = useState(() =>
    people.map((p) => {
      const days = {}
      let start = '09:00'
      let end = '17:00'
      let gotHours = false
      for (const dow of WEEK_ORDER) {
        const s = p.schedule?.[dow]
        days[dow] = !!s
        if (s && !gotHours) {
          start = s.start
          end = s.end
          gotHours = true
        }
      }
      return { username: p.username, name: p.name, department: p.department, days, start, end }
    })
  )
  const [saving, setSaving] = useState(false)

  function toggleDay(i, dow) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, days: { ...r.days, [dow]: !r.days[dow] } } : r)))
  }
  function setField(i, field, value) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  async function save() {
    setSaving(true)
    try {
      const schedules = {}
      for (const r of rows) {
        const days = {}
        for (const dow of WEEK_ORDER) days[dow] = r.days[dow] ? { start: r.start, end: r.end } : null
        schedules[r.username] = { days }
      }
      await api('/schedules', { method: 'PUT', body: { schedules } })
      onSaved()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-2xl"
      title="Team schedule"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : 'Save schedules'}</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-[var(--color-ink-soft)]">Everyone in one place. Tap a day to turn it on or off for that person; set their hours on the right. Off days are rest days.</p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.username} className="rounded-xl border border-[var(--color-line-soft)] p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <Avatar name={r.name} size={26} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{r.name}</div>
                <div className="truncate text-[11px] text-[var(--color-ink-faint)]">{r.department}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {WEEK_ORDER.map((dow) => {
                  const on = r.days[dow]
                  return (
                    <button
                      key={dow}
                      onClick={() => toggleDay(i, dow)}
                      title={DAY_FULL[dow]}
                      aria-label={`${r.name} ${DAY_FULL[dow]} ${on ? 'working' : 'off'}`}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border text-[11px] font-bold transition-colors ${on ? 'border-[var(--color-good)] bg-[var(--color-good-bg)] text-[var(--color-good)]' : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]'}`}
                    >
                      {DAY_FULL[dow].slice(0, 2)}
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-1.5 text-sm">
                <input type="time" value={r.start} onChange={(e) => setField(i, 'start', e.target.value)} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1" />
                <span className="text-[var(--color-ink-faint)]">–</span>
                <input type="time" value={r.end} onChange={(e) => setField(i, 'end', e.target.value)} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
