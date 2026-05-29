import { useEffect, useMemo, useState } from 'react'
import { Clock, LogIn, LogOut, CheckCircle2, MapPin } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getLocation, mapsUrl } from '../lib/geo.js'
import { Button, Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'
import { timeShort, dateLong } from '../lib/format.js'
import { DAY_SHORT, DAY_FULL, WEEK_ORDER, shiftFor, isWorkday, weekDays, ymd } from '../lib/schedule.js'

export default function Attendance() {
  const { isViewAs } = useAuth()
  const [today, setToday] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)

  async function load() {
    const [t, m] = await Promise.all([api('/attendance/today'), api('/attendance/mine')])
    setToday(t.record)
    setRecords(m.records)
    setLoading(false)
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

  const week = useMemo(() => {
    const todayKey = ymd(new Date())
    const days = weekDays().map((d) => {
      const key = ymd(d)
      const rec = records.find((r) => r.date === key)
      const work = isWorkday(d.getDay())
      const isToday = key === todayKey
      const isFuture = key > todayKey
      let state
      if (!work) state = 'off'
      else if (rec?.checkIn) state = rec.late ? 'late' : 'present'
      else if (isToday) state = 'today'
      else if (isFuture) state = 'future'
      else state = 'absent'
      return { d, key, rec, state, isToday }
    })
    const present = days.filter((x) => x.state === 'present' || x.state === 'late').length
    const expected = days.filter((x) => x.state !== 'off' && x.state !== 'future').length
    return { days, present, expected }
  }, [records])

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const checkedIn = !!today?.checkIn && !today?.checkOut
  const done = !!today?.checkOut
  const hoursFor = (rec) => {
    if (!rec?.checkIn || !rec?.checkOut) return null
    return ((new Date(rec.checkOut) - new Date(rec.checkIn)) / 3600000).toFixed(1) + 'h'
  }

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
              <div className="mt-1 text-[var(--color-ink-soft)]">{timeShort(today.checkIn)} – {timeShort(today.checkOut)} · {hoursFor(today)}</div>
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

          {/* today's locations */}
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

      {/* this week */}
      <div>
        <SectionTitle action={<Pill tone={week.present >= week.expected && week.expected > 0 ? 'good' : 'warn'}>{week.present}/{week.expected} days in</Pill>}>
          This week
        </SectionTitle>
        <Card className="p-4 sm:p-5">
          <div className="flex justify-between gap-1.5">
            {week.days.map((x) => (
              <DayChip key={x.key} day={x} />
            ))}
          </div>
        </Card>
      </div>

      {/* my schedule (Mon–Sun roster) */}
      <div>
        <SectionTitle>My schedule</SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          <div className="bg-[var(--color-paper)] px-5 py-2.5 text-xs text-[var(--color-ink-soft)]">
            Normal week Mon–Fri · up to 6 days may be required (at least 1 rest day).
          </div>
          {WEEK_ORDER.map((dow) => {
            const shift = shiftFor(dow)
            const isToday = new Date().getDay() === dow
            return (
              <div key={dow} className={`flex items-center gap-4 px-5 py-3 ${isToday ? 'bg-[var(--color-brand-50)]' : ''}`}>
                <div className="flex w-32 shrink-0 items-center gap-2">
                  <span className="font-semibold text-[var(--color-ink)]">{DAY_FULL[dow]}</span>
                  {isToday && <Pill tone="brand">Today</Pill>}
                </div>
                {shift ? (
                  <span className="text-sm font-semibold text-[var(--color-ink-soft)]">{shift.start} – {shift.end}</span>
                ) : (
                  <span className="text-sm font-medium text-[var(--color-ink-faint)]">Off</span>
                )}
              </div>
            )
          })}
        </Card>
      </div>

      {/* history */}
      <div>
        <SectionTitle>Recent days</SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {records.length === 0 && <div className="px-5 py-8 text-center text-[var(--color-ink-faint)]">No attendance recorded yet.</div>}
          {records.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="w-28 shrink-0 font-semibold text-[var(--color-ink)]">
                {new Date(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
              <div className="flex flex-1 items-center gap-2 text-sm text-[var(--color-ink-soft)]">
                {timeShort(r.checkIn)} – {r.checkOut ? timeShort(r.checkOut) : '…'}
                {r.checkInLoc && (
                  <a href={mapsUrl(r.checkInLoc)} target="_blank" rel="noreferrer" className="text-[var(--color-brand)]">
                    <MapPin size={13} />
                  </a>
                )}
              </div>
              {r.late && <Pill tone="warn">Late</Pill>}
              <div className="w-14 text-right text-sm font-semibold text-[var(--color-ink)]">{hoursFor(r) || ''}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

const CHIP = {
  present: { ring: 'border-[var(--color-good)] bg-[var(--color-good-bg)] text-[var(--color-good)]', label: '✓' },
  late: { ring: 'border-[var(--color-warn)] bg-[var(--color-warn-bg)] text-[var(--color-warn)]', label: '!' },
  absent: { ring: 'border-[var(--color-bad)] bg-[var(--color-bad-bg)] text-[var(--color-bad)]', label: '–' },
  today: { ring: 'border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand)]', label: '•' },
  future: { ring: 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]', label: '' },
  off: { ring: 'border-[var(--color-line)] bg-[var(--color-line-soft)] text-[var(--color-ink-faint)]', label: '' },
}

function DayChip({ day }) {
  const c = CHIP[day.state]
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <span className="text-xs font-semibold text-[var(--color-ink-faint)]">{DAY_SHORT[day.d.getDay()]}</span>
      <span className={`flex h-10 w-full max-w-[44px] items-center justify-center rounded-xl border text-base font-bold ${c.ring}`}>
        {c.label}
      </span>
      <span className="text-[11px] text-[var(--color-ink-faint)]">{day.d.getDate()}</span>
    </div>
  )
}
