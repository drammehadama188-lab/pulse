import { useEffect, useState } from 'react'
import { Clock, LogIn, LogOut, CheckCircle2, MapPin, ChevronLeft, ChevronRight, CalendarCog, Building2, AlertTriangle, Wrench } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getLocation, mapsUrl } from '../lib/geo.js'
import { Avatar, Button, Card, ConfirmDialog, Field, Input, Modal, Pill, Select, SectionTitle, Spinner } from '../components/ui.jsx'
import { timeShort, dateLong } from '../lib/format.js'
import { DAY_FULL, WEEK_ORDER, weekDays, ymd } from '../lib/schedule.js'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'

// Hours page. Staff see their own check-in + weekly shifts; managers see the whole
// team's weekly shift grid (times + status per day), can log worked/off/sick/leave
// on any day, and set each person's weekly schedule.
export default function Attendance({ scope }) {
  const { hasPower } = useAuth()
  if (scope === 'team') return <TeamHours />
  // MY WORK stays personal: the company-wide grid belongs to the HR control
  // centre (Attendance under PEOPLE). Holding the Team power alone no longer
  // turns "My Hours" into a manager page — leads manage via MY TEAM instead.
  return hasPower('hr') ? <ManagerHours /> : <MyHours />
}

// Shift-block tones: a defined card with a solid colour left-accent bar so blocks
// are clearly visible on any background (the faint-tint version washed out).
const TONE = {
  scheduled: 'border-l-[var(--color-brand)] bg-[var(--color-surface)]',
  worked: 'border-l-[var(--color-good)] bg-[var(--color-good-bg)]',
  late: 'border-l-[var(--color-warn)] bg-[var(--color-warn-bg)]',
  absent: 'border-l-[var(--color-bad)] bg-[var(--color-bad-bg)]',
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
  absent: 'var(--color-bad)',
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
  // Lean cells: clock times + one word. A finished day shows the real span
  // (in–out) so "who started when" reads without opening the day (Adama 7 Jul).
  const span = cell.checkIn && cell.checkOut ? `${timeShort(cell.checkIn)}–${timeShort(cell.checkOut)}` : null
  if (cell.status === 'worked') {
    return cell.checkOut
      ? { tone: 'worked', primary: span || timeShort(cell.checkOut), secondary: 'Completed' }
      : { tone: 'worked', primary: cell.checkIn ? timeShort(cell.checkIn) : time, secondary: 'Working' }
  }
  if (cell.status === 'late') return { tone: 'late', primary: span || (cell.checkIn ? timeShort(cell.checkIn) : time), secondary: 'Late' }
  if (cell.status === 'absent') return { tone: 'absent', primary: time, secondary: 'No clock in' }
  return { tone: 'scheduled', primary: time, secondary: null } // planned — time only, no extra text
}

function hoursOf(shift) {
  if (!shift) return 0
  const [sh, sm] = shift.start.split(':').map(Number)
  const [eh, em] = shift.end.split(':').map(Number)
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60)
}

// ── Real derived attendance metrics (no made-up numbers) ──────────────────
// Minutes actually worked = check-out − check-in.
function workedMins(cell) {
  if (!cell?.checkIn || !cell?.checkOut) return null
  const m = (new Date(cell.checkOut) - new Date(cell.checkIn)) / 60000
  return m > 0 ? m : null
}
// Minutes late = check-in clock time − shift start. Company clock = Gambia =
// GMT, so use UTC parts — the viewer's own timezone (e.g. Adama in the US)
// must never change the math.
function lateMins(cell) {
  if (!cell?.checkIn || !cell?.shift || !cell.late) return 0
  const ci = new Date(cell.checkIn)
  const [sh, sm] = cell.shift.start.split(':').map(Number)
  return Math.max(0, ci.getUTCHours() * 60 + ci.getUTCMinutes() - (sh * 60 + sm))
}
const fmtMins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`)

// Live "right now" status for an employee — drives the status chip + today cards.
const CHIP = {
  working: { label: 'Working', cls: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', dot: 'var(--color-good)' },
  late: { label: 'Late', cls: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]', dot: 'var(--color-warn)' },
  done: { label: 'Shift done', cls: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', dot: 'var(--color-good)' },
  leave: { label: 'On leave', cls: 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]', dot: 'var(--color-brand)' },
  sick: { label: 'Sick', cls: 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]', dot: 'var(--color-rest)' },
  notin: { label: 'Not in yet', cls: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]', dot: 'var(--color-ink-faint)' },
  absent: { label: 'Absent', cls: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]', dot: 'var(--color-bad)' },
  off: { label: 'Off', cls: 'bg-[var(--color-fill)] text-[var(--color-ink-faint)]', dot: 'var(--color-ink-faint)' },
}
function liveStatusKey(cell, nowMin) {
  if (!cell) return 'off'
  if (cell.leaveType) { const t = cell.leaveType.toLowerCase(); return t === 'sick' ? 'sick' : t === 'off' ? 'off' : 'leave' }
  if (!cell.shift) return 'off'
  if (cell.checkIn && !cell.checkOut) return cell.late ? 'late' : 'working'
  if (cell.checkOut) return 'done'
  // scheduled, no check-in: absent once the shift end has passed today, else not-in-yet
  if (nowMin != null) { const [eh, em] = cell.shift.end.split(':').map(Number); if (nowMin > eh * 60 + em) return 'absent' }
  return 'notin'
}

// Today's team health — real counts from the today column. Splits absent (shift
// ended, never showed) from not-started (still within/before the shift).
function todayStats(people, today) {
  const isToday = today === new Date().toISOString().slice(0, 10)
  const nowMin = isToday ? new Date().getUTCHours() * 60 + new Date().getUTCMinutes() : null
  const s = { scheduled: 0, present: 0, late: 0, leave: 0, notStarted: 0, absent: 0 }
  for (const p of people) {
    const c = p.byDate?.[today]; if (!c) continue
    if (c.leaveType) { s.leave++; continue }
    if (!c.shift) continue
    s.scheduled++
    if (c.checkIn) { s.present++; if (c.late) s.late++; continue }
    if (liveStatusKey(c, nowMin) === 'absent') s.absent++; else s.notStarted++
  }
  return s
}
// Week health — attendance rate over elapsed scheduled days, late count, overtime, leave.
function weekStats(people, days, today) {
  let sched = 0, present = 0, late = 0, leaveDays = 0, otMin = 0
  for (const p of people) for (const k of days) {
    const c = p.byDate?.[k]; if (!c) continue
    if (c.leaveType) { leaveDays++; continue }
    if (!c.shift || k > today) continue
    sched++
    if (c.checkIn) {
      present++; if (c.late) late++
      const w = workedMins(c); if (w != null) { const ot = w - hoursOf(c.shift) * 60; if (ot > 0) otMin += ot }
    }
  }
  return { rate: sched ? Math.round((present / sched) * 100) : null, late, otHours: Math.round(otMin / 60), leaveDays }
}

const STAT_TONE = {
  good: { text: 'text-[var(--color-good)]', dot: 'var(--color-good)', soft: 'bg-[var(--color-good-bg)]' },
  warn: { text: 'text-[var(--color-warn)]', dot: 'var(--color-warn)', soft: 'bg-[var(--color-warn-bg)]' },
  bad: { text: 'text-[var(--color-bad)]', dot: 'var(--color-bad)', soft: 'bg-[var(--color-bad-bg)]' },
  blue: { text: 'text-[var(--color-brand-700)]', dot: 'var(--color-brand)', soft: 'bg-[var(--color-brand-50)]' },
  rest: { text: 'text-[var(--color-rest)]', dot: 'var(--color-rest)', soft: 'bg-[var(--color-rest-bg)]' },
  ink: { text: 'text-[var(--color-ink)]', dot: 'var(--color-ink-faint)', soft: 'bg-[var(--color-fill)]' },
}

// Hero tile — big number, small label, status dot. Built to scan in <2s.
function HeroStat({ label, value, tone }) {
  const c = STAT_TONE[tone] || STAT_TONE.ink
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-1.5">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${c.soft}`}><i className="h-2 w-2 rounded-full" style={{ background: c.dot }} /></span>
        <span className="text-[12px] font-semibold text-[var(--color-ink-soft)]">{label}</span>
      </div>
      <p className={`mt-1.5 text-[34px] font-semibold leading-none tabular-nums ${c.text}`}>{value}</p>
    </div>
  )
}

// Smaller week metric.
function WeekStat({ label, value, tone }) {
  const c = STAT_TONE[tone] || STAT_TONE.ink
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{label}</p>
      <p className={`mt-0.5 text-[22px] font-semibold tabular-nums ${c.text}`}>{value}</p>
    </div>
  )
}

function AttendanceSummary({ people, days, today }) {
  const t = todayStats(people, today)
  const w = weekStats(people, days, today)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <HeroStat label="Present" value={`${t.present}/${t.scheduled}`} tone="good" />
        <HeroStat label="Late" value={t.late} tone="warn" />
        <HeroStat label="Absent" value={t.absent} tone={t.absent ? 'bad' : 'ink'} />
        <HeroStat label="On leave" value={t.leave} tone="blue" />
        <HeroStat label="Not started" value={t.notStarted} tone="ink" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <WeekStat label="Attendance rate" value={w.rate == null ? '—' : `${w.rate}%`} tone={w.rate == null ? 'ink' : w.rate >= 90 ? 'good' : 'warn'} />
        <WeekStat label="Late arrivals" value={w.late} tone={w.late ? 'warn' : 'ink'} />
        <WeekStat label="Overtime hours" value={`${w.otHours}h`} tone="ink" />
        <WeekStat label="Leave days" value={w.leaveDays} tone="blue" />
      </div>
    </div>
  )
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
  async function undo() {
    setBusy(true)
    try {
      await api('/attendance/undo-checkin', { method: 'POST' })
      setToday(null)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }
  return { today, loading, busy, locating, act, undo }
}

// ───────────────────────── weekly shift data (shared) ───────────────────────────
function useWeekGrid(scope) {
  const [start, setStart] = useState(() => ymd(weekDays()[0]))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const scopeQ = scope ? `&scope=${scope}` : ''

  async function load(s) {
    setLoading(true)
    try {
      const d = await api(`/attendance/week?start=${s}${scopeQ}`)
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
  // Jump straight to the week containing a date (e.g. "show me the week the
  // new schedule starts"). Aligns to that week's Monday.
  function go(dateKey) {
    const d = new Date(`${dateKey}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    load(d.toISOString().slice(0, 10))
  }
  const isThis = start === ymd(weekDays()[0])
  return { start, data, loading, shift, go, reload: () => load(start), isThis }
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
      <span className="min-w-[132px] text-center text-[13px] font-semibold text-[var(--color-ink)]">{isThis ? 'This week' : label}</span>
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
  // Minutes-into-day now (Gambia=GMT), so the live status chip can tell
  // "Absent" (shift ended, never came) from "Not in yet". Null off the current week.
  const nowMin = today === new Date().toISOString().slice(0, 10) ? new Date().getUTCHours() * 60 + new Date().getUTCMinutes() : null
  const cols = `14rem repeat(${days.length}, minmax(96px, 1fr))`
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
            <div className="sticky left-0 z-20 bg-[var(--color-surface)] px-4 py-3 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Staff</div>
            {days.map((k) => {
              const d = new Date(`${k}T00:00:00Z`)
              const dow = d.getUTCDay()
              const weekend = dow === 0 || dow === 6
              const isToday = k === today
              return (
                <div key={k} className={`px-2 py-2 text-center ${isToday ? 'bg-[var(--color-good-bg)] border-x-2 border-[var(--color-good)]' : weekend ? 'bg-[var(--color-fill)]/60' : ''}`}>
                  <div className={`text-[11px] font-semibold ${isToday ? 'text-[var(--color-good)]' : 'text-[var(--color-ink-faint)]'}`}>{isToday ? 'TODAY' : DAY_FULL[dow].slice(0, 3)}</div>
                  <div className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${isToday ? 'bg-[var(--color-good)] text-white' : weekend ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>{d.getUTCDate()}</div>
                </div>
              )
            })}
          </div>

          {/* rows */}
          <div className="divide-y divide-[var(--color-line-soft)]">
            {people.map((p) => (
              <div key={p.username} className="grid items-stretch" style={{ gridTemplateColumns: cols }}>
                <div className="sticky left-0 z-10 flex items-center gap-2.5 bg-[var(--color-surface)] px-4 py-3.5">
                  <Avatar name={p.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold leading-tight text-[var(--color-ink)]">{p.name}</div>
                    <div className="truncate text-[11px] text-[var(--color-ink-soft)]">{p.department}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {(() => { const c = CHIP[liveStatusKey(p.byDate?.[today], nowMin)]; return (
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.cls}`} title="Status right now">
                          <i className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />{c.label}
                        </span>
                      ) })()}
                      <span className="text-[10px] font-medium text-[var(--color-ink-faint)]">{Math.round(p.weekHours)}h/wk</span>
                    </div>
                  </div>
                </div>
                {days.map((k) => {
                  const cell = p.byDate?.[k]
                  const isToday = k === today
                  const dowK = new Date(`${k}T00:00:00Z`).getUTCDay()
                  const weekendK = dowK === 0 || dowK === 6
                  const view = cellView(cell, p.department)
                  return (
                    <div key={k} className={`p-1.5 ${isToday ? 'bg-[var(--color-good-bg)]/50 border-x-2 border-[var(--color-good)]' : weekendK ? 'border-l border-[var(--color-line-soft)] bg-[var(--color-fill)]/50' : 'border-l border-[var(--color-line-soft)]'}`}>
                      <button
                        disabled={!clickable}
                        onClick={(e) => onCellClick?.(p, k, cell || { status: 'off' }, e.currentTarget.getBoundingClientRect())}
                        title={`${p.name} · ${new Date(`${k}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                        className={`block h-full w-full text-left ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        {view ? (
                          <div className={`rounded-md border border-[var(--color-line-soft)] border-l-[3px] px-2 py-1.5 ${TONE[view.tone]} ${clickable ? 'transition-shadow' : ''}`}>
                            <div className="flex items-center justify-between gap-1">
                              <div className="text-[11px] font-semibold leading-tight tabular-nums text-[var(--color-ink)]">{view.primary}</div>
                              {cell?.onOfficeNetwork === false && <span title="Checked in off the office network" className="shrink-0 text-[var(--color-bad)]"><AlertTriangle size={11} /></span>}
                              {cell?.fixedBy && <span title={`Time fixed by ${cell.fixedBy}: ${cell.fixReason || ''}`} className="shrink-0 text-[var(--color-ink-faint)]"><Wrench size={11} /></span>}
                            </div>
                            {view.secondary && <div className={`truncate text-[10px] font-medium ${view.tone === 'absent' ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink-soft)]'}`}>{view.secondary}</div>}
                          </div>
                        ) : (
                          <div className={`flex h-full min-h-[50px] items-center justify-center rounded-lg text-[15px] text-[var(--color-line)] ${clickable ? 'hover:bg-[var(--color-paper)]' : ''}`}>{clickable ? '+' : ''}</div>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* day totals — darker bar so weekly hours read instantly */}
          <div className="grid border-t border-[var(--color-line)] bg-[var(--color-fill)]" style={{ gridTemplateColumns: cols }}>
            <div className="sticky left-0 z-10 bg-[var(--color-fill)] px-4 py-2.5 text-[11.5px] font-medium text-[var(--color-ink-soft)]">Totals</div>
            {totals.map((t, i) => {
              const isToday = days[i] === today
              return (
                <div key={i} className={`border-l border-[var(--color-line-soft)] px-2 py-2.5 text-center ${isToday ? 'bg-[var(--color-good-bg)]/60' : ''}`}>
                  <div className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">{Math.round(t.hours)}h</div>
                  <div className="text-[10px] font-medium text-[var(--color-ink-faint)]">{t.on} on</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-line-soft)] px-4 py-2.5 text-[11px] text-[var(--color-ink-soft)]">
        <LegendDot tone="scheduled" label="scheduled" />
        <LegendDot tone="worked" label="worked" />
        <LegendDot tone="late" label="late" />
        <LegendDot tone="sick" label="sick" />
        <LegendDot tone="leave" label="annual leave" />
        <LegendDot tone="absent" label="absent" />
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
  { key: 'clear', label: 'Clear · no record (undo)' },
]
const hhmm = (iso) => (iso ? iso.slice(11, 16) : '')

// Marking a day off used to be: click the cell, read a modal, choose a radio,
// press Save. Four steps for one word. The statuses that need nothing else
// typed now save on one click, right at the cell (Adama 21 Aug — quick editing:
// change a small thing where it is shown). Worked still opens the full sheet,
// because it needs times; the note field lives there too.
const QUICK_STATUSES = [
  { key: 'off', label: 'Off (excused)', tone: 'var(--color-ink-soft)' },
  { key: 'sick', label: 'Sick', tone: 'var(--color-warn)' },
  { key: 'leave', label: 'Annual leave', tone: 'var(--color-brand)' },
]

function QuickStatusMenu({ person, dateKey, cell, anchorRect, onClose, onSaved, onOpenFull }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    const away = (e) => { if (!e.target.closest('[data-quickmenu]')) onClose() }
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])

  async function mark(status) {
    setBusy(status)
    setErr(null)
    try {
      await api('/attendance/day', { method: 'PUT', body: { username: person.username, date: dateKey, status, note: '' } })
      onSaved()
    } catch (e) {
      // Inline, at the menu — a toast would vanish before it was read, and the
      // person would not know whether the day changed.
      setErr(e.message)
      setBusy(null)
    }
  }

  // Anchored to the cell, kept inside the window.
  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 250)
  const left = Math.min(anchorRect.left, window.innerWidth - 232)
  return (
    <div
      data-quickmenu
      style={{ position: 'fixed', top, left, zIndex: 60, width: 216 }}
      className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-card)]"
    >
      <p className="px-2.5 pb-1.5 pt-1 text-[11.5px] text-[var(--color-ink-faint)]">
        {person.name.split(' ')[0]} · {new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
      </p>
      {QUICK_STATUSES.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={!!busy}
          onClick={() => mark(o.key)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-fill)] disabled:opacity-50"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.tone }} />
          {o.label}
          {busy === o.key && <Spinner size={13} className="ml-auto" />}
        </button>
      ))}
      <div className="my-1 h-px bg-[var(--color-line-soft)]" />
      <button
        type="button"
        onClick={onOpenFull}
        className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-fill)]"
      >
        Worked, or add a note…
      </button>
      {cell?.status && cell.status !== 'off' && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => mark('clear')}
          className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)] disabled:opacity-50"
        >
          Clear the record
        </button>
      )}
      {err && <p className="px-2.5 py-1.5 text-[11.5px] text-[var(--color-bad)]">{err}</p>}
    </div>
  )
}

function DayDetailModal({ person, dateKey, cell, onClose, onSaved }) {
  const known = ['worked', 'off', 'sick', 'leave']
  const [status, setStatus] = useState(cell.status === 'late' ? 'worked' : known.includes(cell.status) ? cell.status : 'worked')
  const [note, setNote] = useState(cell.note || '')
  const [checkIn, setCheckIn] = useState(hhmm(cell.checkIn) || (cell.shift?.start ?? '09:00'))
  const [checkOut, setCheckOut] = useState(hhmm(cell.checkOut) || (cell.shift?.end ?? '17:00'))
  const [saving, setSaving] = useState(false)
  const dateLabel = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

  async function save() {
    setSaving(true)
    try {
      const body = { username: person.username, date: dateKey, status, note }
      if (status === 'worked') { body.checkIn = checkIn; body.checkOut = checkOut }
      await api('/attendance/day', { method: 'PUT', body })
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
      <p className="text-[13px] font-semibold text-[var(--color-ink)]">{dateLabel}</p>
      {(cell.checkIn || cell.leaveType || cell.shift) && (
        <p className="mb-3 mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
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
          <label key={o.key} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${status === o.key ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)]' : 'border-[var(--color-line)]'}`}>
            <input type="radio" name="day-status" checked={status === o.key} onChange={() => setStatus(o.key)} className="accent-[var(--color-brand)]" />
            <span className="font-semibold text-[var(--color-ink)]">{o.label}</span>
          </label>
        ))}
      </div>
      {status === 'worked' && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[11.5px] font-semibold text-[var(--color-ink-soft)]">Checked in</label>
            <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2" />
          </div>
          <span className="mt-5 text-[var(--color-ink-faint)]">–</span>
          <div className="flex-1">
            <label className="mb-1 block text-[11.5px] font-semibold text-[var(--color-ink-soft)]">Checked out</label>
            <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2" />
          </div>
        </div>
      )}
      {status === 'clear' && (
        <p className="mt-3 rounded-lg bg-[var(--color-fill)] px-4 py-3 text-[13px] text-[var(--color-ink-soft)]">
          Removes any check-in, worked, sick or leave record for this day — back to a blank scheduled day.
        </p>
      )}
      {(status === 'sick' || status === 'leave' || status === 'off') && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional note (e.g. called in, fever)"
          className="focus-ring mt-3 w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px] outline-none"
        />
      )}
    </Modal>
  )
}

// ───────────────────────────── staff / agent view ───────────────────────────────
function useMyHistory() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api('/attendance/mine').then((d) => setRecords(d.records || [])).catch(() => setRecords([])).finally(() => setLoading(false))
  }, [])
  return { records, loading }
}

function MyHours() {
  const { isViewAs } = useAuth()
  const { today, loading, busy, locating, act, undo } = useSelfDay()
  // 'self': My Hours is personal — always just your own week, even for a team
  // lead with the Team power (Adama 6 Jul). The team's week = Team Schedule.
  const w = useWeekGrid('self')
  const hist = useMyHistory()
  const [undoOpen, setUndoOpen] = useState(false)

  if (loading) return <PageSkeleton tiles={0} rows={6} />

  const checkedIn = !!today?.checkIn && !today?.checkOut
  const done = !!today?.checkOut

  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-page">My hours</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{dateLong()}</p>
      </div>

      {/* today hero */}
      <Card className="overflow-hidden">
        <div
          className="flex flex-col items-center gap-4 p-8 text-center"
          style={{ background: done || checkedIn ? 'linear-gradient(160deg, var(--color-good-bg), var(--color-surface) 70%)' : 'linear-gradient(160deg, var(--color-brand-50), var(--color-surface) 70%)' }}
        >
          <span className={`flex h-16 w-16 items-center justify-center rounded-lg text-white ${done || checkedIn ? 'bg-[var(--color-good)]' : 'bg-[var(--color-brand)]'}`}>
            {done ? <CheckCircle2 size={30} /> : <Clock size={30} />}
          </span>

          {done ? (
            <div>
              <div className="text-[22px] font-semibold">Day complete</div>
              <div className="mt-1 text-[var(--color-ink-soft)]">{timeShort(today.checkIn)} – {timeShort(today.checkOut)}</div>
            </div>
          ) : checkedIn ? (
            <div>
              <div className="flex items-center justify-center gap-2 text-[22px] font-semibold">Checked in {today.late && <Pill tone="warn">Late</Pill>}</div>
              <div className="mt-1 text-[var(--color-ink-soft)]">since {timeShort(today.checkIn)}</div>
            </div>
          ) : (
            <div>
              <div className="text-[22px] font-semibold">Ready to start?</div>
              <div className="mt-1 text-[var(--color-ink-soft)]">You haven't checked in today.</div>
            </div>
          )}

          {today?.checkIn && today?.onOfficeNetwork != null && (
            today.onOfficeNetwork
              ? <Pill tone="good"><Building2 size={13} /> Checked in at office</Pill>
              : <Pill tone="bad"><AlertTriangle size={13} /> Off the office network</Pill>
          )}

          {(today?.checkInLoc || today?.checkOutLoc) && (
            <div className="flex flex-wrap justify-center gap-3 text-[13px]">
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
          {checkedIn && !isViewAs && (
            <button onClick={() => setUndoOpen(true)} disabled={busy} className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-brand)]">
              Checked in by mistake? Undo
            </button>
          )}
          {locating && <div className="text-[11.5px] text-[var(--color-ink-faint)]">Getting your location…</div>}
          {isViewAs && <span className="text-[13px] font-medium text-[var(--color-ink-faint)]">Read-only view</span>}
        </div>
      </Card>

      <ConfirmDialog
        open={undoOpen}
        onCancel={() => setUndoOpen(false)}
        onConfirm={async () => { await undo(); setUndoOpen(false) }}
        busy={busy}
        title="Undo check-in?"
        message="This removes today's check-in so you can start again. Your hours for today reset."
        confirmLabel="Undo check-in"
      />

      {/* my week (read-only — set by the manager) */}
      <div>
        <SectionTitle action={<WeekNav days={w.data?.days} isThis={w.isThis} onPrev={() => w.shift(-1)} onNext={() => w.shift(1)} />}>My week</SectionTitle>
        {w.loading || !w.data ? (
          <Card className="flex justify-center py-12"><Spinner size={24} /></Card>
        ) : (
          <WeekSchedule people={w.data.people} days={w.data.days} today={w.data.today} />
        )}
      </div>

      {/* history — my past attendance (real records only) */}
      <div>
        <SectionTitle>Recent days</SectionTitle>
        {hist.loading ? (
          <Card className="flex justify-center py-10"><Spinner size={22} /></Card>
        ) : hist.records.length === 0 ? (
          <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">No attendance recorded yet.</Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {hist.records.map((r) => {
              const mins = r.checkIn && r.checkOut ? Math.max(0, (new Date(r.checkOut) - new Date(r.checkIn)) / 60000) : null
              return (
                <div key={r.date} className="flex items-center justify-between px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[var(--color-ink)]">{new Date(`${r.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    <div className="text-[11.5px] text-[var(--color-ink-faint)]">{r.checkIn ? timeShort(r.checkIn) : '—'}{r.checkOut ? ` – ${timeShort(r.checkOut)}` : ''}</div>
                    {r.fixReason && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[var(--color-ink-faint)]">
                        <Wrench size={11} /> Time fixed by {r.fixedByName || r.fixedBy} — {r.fixReason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.onOfficeNetwork === false && <Pill tone="bad"><AlertTriangle size={12} /> Off-site</Pill>}
                    {r.onOfficeNetwork === true && <span title="Checked in on the office network" className="text-[var(--color-good)]"><Building2 size={15} /></span>}
                    {r.late && <Pill tone="warn">Late</Pill>}
                    <span className="text-[13px] font-semibold text-[var(--color-ink)]">{fmtMins(mins)}</span>
                  </div>
                </div>
              )
            })}
          </Card>
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
  // The one-click menu at the cell; the modal above is the long way round.
  const [quick, setQuick] = useState(null) // { person, dateKey, cell, rect }

  const people = w.data?.people || []
  const today = w.data?.today
  const nowMin = today === new Date().toISOString().slice(0, 10) ? new Date().getUTCHours() * 60 + new Date().getUTCMinutes() : null
  const departments = [...new Set(people.map((p) => p.department).filter(Boolean))]
  // Urgent statuses first, departments after (Adama 28 Jun).
  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'late', label: 'Late today' },
    { id: 'absent', label: 'Absent' },
    { id: 'leave', label: 'On leave' },
    ...departments.map((d) => ({ id: `dept:${d}`, label: d })),
  ]
  const shown = people.filter((p) => {
    if (filter === 'all') return true
    if (filter.startsWith('dept:')) return p.department === filter.slice(5)
    const key = liveStatusKey(p.byDate?.[today], nowMin)
    if (filter === 'late') return key === 'late'
    if (filter === 'notin') return key === 'notin'
    if (filter === 'absent') return key === 'absent'
    if (filter === 'leave') return key === 'leave' || key === 'sick'
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="t-page">Schedule</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">Team shifts, attendance &amp; leave</p>
        </div>
        <Button icon={CalendarCog} onClick={() => setEditorOpen(true)} disabled={!people.length}>Edit schedules</Button>
      </div>

      {!isCeo && <SelfCheckInCompact {...self} />}

      {w.data && people.length > 0 && <AttendanceSummary people={people} days={w.data.days} today={today} />}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${filter === f.id ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'}`}>{f.label}</button>
            ))}
          </div>
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
            onCellClick={(person, dateKey, cell, rect) => setQuick({ person, dateKey, cell, rect })}
          />
        )}
      </div>

      {editorOpen && (
        <TeamScheduleEditor
          people={people}
          onClose={() => setEditorOpen(false)}
          onSaved={(gotoDate) => { setEditorOpen(false); gotoDate ? w.go(gotoDate) : w.reload() }}
        />
      )}
      {quick && (
        <QuickStatusMenu
          person={quick.person}
          dateKey={quick.dateKey}
          cell={quick.cell}
          anchorRect={quick.rect}
          onClose={() => setQuick(null)}
          onSaved={() => { setQuick(null); w.reload() }}
          onOpenFull={() => { setDetail({ person: quick.person, dateKey: quick.dateKey, cell: quick.cell }); setQuick(null) }}
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

// ─────────────────────── MY TEAM · team schedule ─────────────────────────────
// A team lead's scoped view of their own team's week — shifts, attendance and
// leave. Editing is team-scoped too (PUT /api/team/schedules — the lead lane,
// like Team Requests deciding leave), so no company-wide power is needed; the
// "Edit schedules" button and cells don't open the editor. Reuses the same
// summary + week grid as the manager view; data comes from ?scope=team.
function TeamHours() {
  const w = useWeekGrid('team')
  const people = w.data?.people || []
  const today = w.data?.today
  const [editorOpen, setEditorOpen] = useState(false)
  const [fixOpen, setFixOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="t-page">Team Schedule</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">Your team's shifts, attendance &amp; leave</p>
        </div>
        <div className="flex items-center gap-2">
          <WeekNav days={w.data?.days} isThis={w.isThis} onPrev={() => w.shift(-1)} onNext={() => w.shift(1)} />
          <Button variant="outline" icon={Wrench} onClick={() => setFixOpen(true)} disabled={!people.length}>Fix a check-in</Button>
          <Button icon={CalendarCog} onClick={() => setEditorOpen(true)} disabled={!people.length}>Edit schedules</Button>
        </div>
      </div>

      {editorOpen && (
        <TeamScheduleEditor
          people={people}
          endpoint="/team/schedules"
          onClose={() => setEditorOpen(false)}
          onSaved={(gotoDate) => { setEditorOpen(false); gotoDate ? w.go(gotoDate) : w.reload() }}
        />
      )}

      {fixOpen && (
        <FixCheckInDialog
          people={people}
          onClose={() => setFixOpen(false)}
          onSaved={() => { setFixOpen(false); w.reload() }}
        />
      )}

      {w.data && people.length > 0 && <AttendanceSummary people={people} days={w.data.days} today={today} />}

      {w.loading || !w.data ? (
        <Card className="flex justify-center py-12"><Spinner size={24} /></Card>
      ) : !people.length ? (
        <Card className="px-5 py-10 text-center text-[var(--color-ink-faint)]">No one on your team yet.</Card>
      ) : (
        <WeekSchedule people={people} days={w.data.days} today={w.data.today} />
      )}
    </div>
  )
}

// Fix a check-in (Adama 6 Jul): lives on the schedule pages, not the profile.
// The lead sets the true time + a required reason; the server keeps the
// original time on the record and stamps who fixed it and when.
function FixCheckInDialog({ people, onClose, onSaved }) {
  const todayYmd = new Date().toISOString().slice(0, 10)
  const [v, setV] = useState({ username: people[0]?.username || '', date: todayYmd, checkIn: '09:00', checkOut: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const first = (people.find((p) => p.username === v.username)?.name || '').split(' ')[0]

  async function save() {
    if (!v.reason.trim()) { setError('Say why — the reason shows on the record'); return }
    setBusy(true); setError('')
    try {
      await api('/team/attendance-fix', { method: 'POST', body: { username: v.username, date: v.date, checkIn: v.checkIn, checkOut: v.checkOut || undefined, reason: v.reason.trim() } })
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const inputCls = 'focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none'
  return (
    <Modal open onClose={onClose} title="Fix a check-in" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner size={16} /> : 'Save fix'}</Button></>}>
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-ink-soft)]">
          For when someone was at work but couldn't check in, or was wrongly marked late. The real time counts everywhere; the record keeps who fixed it and why.
        </p>
        <Field label="Who">
          <Select value={v.username} onChange={set('username')}>
            {people.map((p) => <option key={p.username} value={p.username}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Day"><input type="date" max={todayYmd} value={v.date} onChange={set('date')} className={inputCls} /></Field>
          <Field label="Checked in at"><input type="time" value={v.checkIn} onChange={set('checkIn')} className={inputCls} /></Field>
          <Field label="Out (optional)"><input type="time" value={v.checkOut} onChange={set('checkOut')} className={inputCls} /></Field>
        </div>
        <Field label={`Why couldn't ${first || 'they'} check in?`}>
          <Input value={v.reason} onChange={set('reason')} placeholder="e.g. office network was down, phone broken" />
        </Field>
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}

function SelfCheckInCompact({ today, loading, busy, act, undo }) {
  const [undoOpen, setUndoOpen] = useState(false)
  if (loading) return null
  const checkedIn = !!today?.checkIn && !today?.checkOut
  const done = !!today?.checkOut
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white ${done || checkedIn ? 'bg-[var(--color-good)]' : 'bg-[var(--color-brand)]'}`}>
        {done ? <CheckCircle2 size={22} /> : <Clock size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
          {done ? 'You: day complete' : checkedIn ? 'You: checked in' : 'You: not checked in'}
          {today?.late && <Pill tone="warn">Late</Pill>}
        </div>
        <div className="text-[11.5px] text-[var(--color-ink-soft)]">
          {done ? `${timeShort(today.checkIn)} – ${timeShort(today.checkOut)}` : checkedIn ? `since ${timeShort(today.checkIn)}` : dateLong()}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {!done && (
          <Button size="sm" onClick={() => act(checkedIn ? 'check-out' : 'check-in')} disabled={busy} variant={checkedIn ? 'outline' : 'primary'} icon={busy ? undefined : checkedIn ? LogOut : LogIn}>
            {busy ? <Spinner size={16} /> : checkedIn ? 'Check out' : 'Check in'}
          </Button>
        )}
        {checkedIn && (
          <button onClick={() => setUndoOpen(true)} disabled={busy} className="text-[11px] font-semibold text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-brand)]">
            Undo
          </button>
        )}
      </div>
      <ConfirmDialog
        open={undoOpen}
        onCancel={() => setUndoOpen(false)}
        onConfirm={async () => { await undo(); setUndoOpen(false) }}
        busy={busy}
        title="Undo check-in?"
        message="This removes today's check-in so you can start again."
        confirmLabel="Undo check-in"
      />
    </Card>
  )
}

// Define a schedule ONCE, then assign it to many (Adama 28 Jun) — stops the
// manager re-typing the same hours per person. Per-person edits still work:
// select just that person and assign. Existing schedules of unselected people
// are untouched (the PUT merges by username).
const TIME_PRESETS = [['09:00', '17:00', '9–5'], ['08:00', '16:00', '8–4'], ['10:00', '18:00', '10–6'], ['08:30', '17:30', '8:30–5:30']]
function fmtDays(schedule) {
  const on = WEEK_ORDER.filter((d) => schedule?.[d])
  if (!on.length) return null
  const set = new Set(on)
  if (on.length === 7) return 'Every day'
  if (on.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Mon–Fri'
  if (on.length === 6 && !set.has(0)) return 'Mon–Sat'
  return on.map((d) => DAY_FULL[d].slice(0, 3)).join(', ')
}
function summarizeSchedule(schedule) {
  const days = fmtDays(schedule)
  if (!days) return 'No schedule yet'
  const first = schedule[WEEK_ORDER.find((d) => schedule?.[d])]
  return `${days} • ${first.start}–${first.end}`
}

function TeamScheduleEditor({ people, endpoint = '/schedules', onClose, onSaved }) {
  // Rebuilt to the mockup Adama sent (28 Aug): people FIRST, then the pattern,
  // then when it starts — and a preview line that reads back the whole change
  // in one sentence before it is saved.
  const [days, setDays] = useState({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false })
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [breakMinutes, setBreakMinutes] = useState(0)
  const [selected, setSelected] = useState(() => new Set())
  const [dept, setDept] = useState('all')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [oneWeek, setOneWeek] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)

  const byDept = {}
  for (const p of people) (byDept[p.department || 'Other'] ||= []).push(p)
  const shown = dept === 'all' ? people : (byDept[dept] || [])

  const toggleDay = (dow) => setDays((d) => ({ ...d, [dow]: !d[dow] }))
  const togglePerson = (u) => setSelected((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n })
  // "Select all" acts on what is in front of you, not on people a department
  // filter is hiding — otherwise the count and the list disagree.
  const shownAllPicked = shown.length > 0 && shown.every((p) => selected.has(p.username))
  const toggleShown = () => setSelected((s) => {
    const n = new Set(s)
    shown.forEach((p) => (shownAllPicked ? n.delete(p.username) : n.add(p.username)))
    return n
  })

  const prettyDate = (v) => new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const daysLabel = fmtDays(Object.fromEntries(WEEK_ORDER.map((d) => [d, days[d] ? { start, end } : null]))) || 'No working days'
  const noDays = !WEEK_ORDER.some((d) => days[d])
  const badHours = !(start && end) || start >= end

  async function save() {
    if (!selected.size || noDays || badHours) return
    setSaving(true)
    setError('')
    try {
      const dayMap = {}
      for (const dow of WEEK_ORDER) dayMap[dow] = days[dow] ? { start, end, breakMinutes } : null
      const schedules = {}
      for (const u of selected) schedules[u] = { from: startDate, days: dayMap, oneWeek }
      const r = await api(endpoint, { method: 'PUT', body: { schedules } })
      setSaved({ count: selected.size, from: startDate, until: r?.until || null })
    } catch (e) {
      setError(e.message || 'Could not save the schedule')
    } finally {
      setSaving(false)
    }
  }

  // Confirmation — say exactly what was saved and offer to go and look at it.
  if (saved) {
    return (
      <Modal open onClose={() => onSaved()} title="Edit team schedules"
        footer={<><Button variant="ghost" onClick={() => onSaved()}>Close</Button><Button onClick={() => onSaved(saved.from)}>Show that week</Button></>}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-good-bg)] text-[var(--color-good)]">
            <CheckCircle2 size={30} />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-ink)]">Schedule saved</div>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
              {daysLabel} · {start}–{end} for {saved.count === 1 ? '1 person' : `${saved.count} people`}, starting {prettyDate(saved.from)}.
              {saved.until ? ` It runs for one week and the old pattern returns on ${prettyDate(saved.until)}.` : ' Earlier weeks stay as they are.'}
            </p>
          </div>
        </div>
      </Modal>
    )
  }

  const stepHead = (n, text) => (
    <div className="flex items-baseline gap-2.5">
      <span className="text-[13px] font-semibold text-[var(--color-ink-faint)]">{n}</span>
      <h4 className="text-[15px] font-semibold text-[var(--color-ink)]">{text}</h4>
    </div>
  )
  const pill = (on) => `rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${on ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white' : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:bg-[var(--color-soft)]'}`
  const dayBtn = (on) => `h-11 flex-1 min-w-[64px] rounded-lg border text-[13px] font-medium transition-colors ${on ? 'border-[var(--color-good)] bg-[var(--color-good-bg)] text-[var(--color-good)]' : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)] hover:bg-[var(--color-soft)]'}`
  const preset = 'rounded-full border border-[var(--color-line)] bg-[var(--color-fill)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-soft)]'

  return (
    <Modal open onClose={onClose} maxWidth="max-w-3xl" title="Edit team schedules"
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-[var(--color-ink-faint)]">Schedules control expected work times. Attendance records remain separate.</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !selected.size || noDays || badHours}>{saving ? <Spinner size={16} /> : 'Save schedule'}</Button>
          </div>
        </div>
      }>
      <p className="-mt-1 mb-6 text-[13px] text-[var(--color-ink-soft)]">Set the normal working pattern for one person, a team, or everyone.</p>

      {/* 1 — who */}
      {stepHead('1', 'Who does this apply to?')}
      <p className="mt-1.5 text-[12px] text-[var(--color-ink-faint)]">Choose employees first. Their current schedules stay visible so you know what you are changing.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={pill(dept === 'all')} onClick={() => setDept('all')}>All staff {people.length}</button>
        {Object.keys(byDept).sort().map((d) => (
          <button key={d} type="button" className={pill(dept === d)} onClick={() => setDept(d)}>{d} {byDept[d].length}</button>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-[var(--color-line)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line-soft)] px-4 py-2.5">
          {/* Sentence case, not the mockup's caps: shouty table headings are
              banned by the design check (DESIGN.md, 21 Aug). */}
          <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Employee · current schedule</span>
          <button type="button" onClick={toggleShown} className="text-[12px] font-medium text-[var(--color-brand)] hover:underline">
            {shownAllPicked ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="grid gap-x-6 p-3 sm:grid-cols-2">
          {shown.map((p) => {
            const on = selected.has(p.username)
            return (
              <label key={p.username} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[var(--color-soft)]">
                <input type="checkbox" checked={on} onChange={() => togglePerson(p.username)} className="accent-[var(--color-brand)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-ink)]">{p.name}</span>
                <span className="shrink-0 text-[12px] text-[var(--color-ink-faint)]">{summarizeSchedule(p.schedule)}</span>
              </label>
            )
          })}
          {shown.length === 0 && <p className="px-2 py-4 text-[13px] text-[var(--color-ink-soft)]">Nobody in this department yet.</p>}
        </div>
      </div>

      {/* 2 — the pattern */}
      <div className="mt-8">{stepHead('2', 'New working pattern')}</div>
      <p className="mb-2 mt-3 text-[12px] font-medium text-[var(--color-ink-faint)]">Working days</p>
      <div className="flex flex-wrap gap-2">
        {WEEK_ORDER.map((dow) => (
          <button key={dow} type="button" onClick={() => toggleDay(dow)} className={dayBtn(days[dow])}>{DAY_FULL[dow].slice(0, 3)}</button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--color-ink-faint)]">Working hours</p>
          <div className="flex items-center gap-2">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="field" />
            <span className="text-[var(--color-ink-faint)]">→</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="field" />
          </div>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--color-ink-faint)]">Break</p>
          <select value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))} className="field">
            <option value={0}>No fixed break</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>1 hour</option>
            <option value={90}>1 hour 30</option>
          </select>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--color-ink-faint)]">Quick presets</p>
          <div className="flex flex-wrap gap-2">
            {TIME_PRESETS.map(([s0, e0, label]) => (
              <button key={label} type="button" className={preset} onClick={() => { setStart(s0); setEnd(e0) }}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {badHours && <p className="mt-2 text-[12px] text-[var(--color-bad)]">The finish time has to be after the start time.</p>}
      {noDays && <p className="mt-2 text-[12px] text-[var(--color-bad)]">Pick at least one working day.</p>}

      {/* 3 — when */}
      <div className="mt-8">{stepHead('3', 'When should it take effect?')}</div>
      <div className="mt-3 flex flex-wrap items-start gap-8">
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--color-ink-faint)]">Effective from</p>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field" />
        </div>
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--color-ink-faint)]">How to apply it</p>
          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" checked={!oneWeek} onChange={() => setOneWeek(false)} className="mt-0.5 accent-[var(--color-brand)]" />
              <span>
                <span className="block text-[13px] font-medium text-[var(--color-ink)]">From this date forward</span>
                <span className="block text-[12px] text-[var(--color-ink-faint)]">Past attendance is untouched.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" checked={oneWeek} onChange={() => setOneWeek(true)} className="mt-0.5 accent-[var(--color-brand)]" />
              <span>
                <span className="block text-[13px] font-medium text-[var(--color-ink)]">Only for one week</span>
                <span className="block text-[12px] text-[var(--color-ink-faint)]">Use for a temporary schedule.</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* the whole change, read back in one line, before it is saved */}
      <div className="mt-6 rounded-lg bg-[var(--color-soft)] p-4">
        <p className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--color-brand)]">Change preview</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="font-semibold text-[var(--color-ink)]">{selected.size === 1 ? '1 employee' : `${selected.size} employees`} selected</span>
          <span className="text-[var(--color-ink-soft)]">{daysLabel} · {start}–{end}{breakMinutes ? ` · ${breakMinutes} min break` : ''}</span>
          <span className="text-[var(--color-ink-soft)]">Starting {prettyDate(startDate)}</span>
          <span className="font-medium text-[var(--color-good)]">
            {oneWeek ? 'Runs for one week, then the old pattern returns' : 'Existing history will not change'}
          </span>
        </div>
      </div>
      {error && <p className="mt-3 text-[13px] text-[var(--color-bad)]">{error}</p>}
    </Modal>
  )
}
