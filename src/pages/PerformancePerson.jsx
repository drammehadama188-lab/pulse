import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, CalendarCheck, ClipboardList, TrendingUp, ShieldCheck, Lightbulb } from 'lucide-react'
import { api } from '../lib/api.js'
import EmptyState from '../components/ui/EmptyState.jsx'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'
import {
  PERF_WEIGHTS, PERF_STATUS, SCORE_GUIDE, RATING_AXES, kpiAttainment,
} from '../../lib/performance-model.js'
import { SOURCE_TONE, GRADE_TONE, StatusChip, Meter, Ring, Stars, initials, gradeTone } from '../components/performance.jsx'

// One person's performance record — Adama's 29 Aug design.
//
// 🔒 Nothing on this page is typed by hand except the manager's assessment, and
// that is a QUARTER of the score. The rest is read from Admin and from Pulse
// attendance and shown with its source named, so somebody being judged can see
// exactly which system produced which number.
//
// Same endpoint family as the board, so the row you clicked and the page you
// land on cannot say two different things.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m) => { const [y, mo] = String(m).split('-'); return `${MONTHS[Number(mo) - 1] || '?'} ${y}` }
const dayLabel = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
function monthOptions() {
  const now = new Date()
  const out = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
const CUR_MONTH = monthOptions()[0]

const TABS = [
  ['overview', 'Overview'],
  ['kpis', 'KPIs (Admin data)'],
  ['attendance', 'Attendance (Pulse)'],
  ['review', 'Manager review'],
  ['history', 'Reviews history'],
  ['notes', 'Notes & actions'],
]

export default function PerformancePerson({ embeddedFor = null }) {
  const { slug } = useParams()
  const navigate = useNavigate()
  const username = embeddedFor?.username || slug
  const [month, setMonth] = useState(CUR_MONTH)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('overview')

  const load = () => {
    setError(null)
    api(`/performance/person/${encodeURIComponent(username)}?month=${month}`).then(setData).catch((e) => setError(e.message))
  }
  useEffect(() => { setData(null); load() }, [username, month])

  if (error) {
    return (
      <div className="card">
        <EmptyState title="That performance record could not be opened" line={error}
          action={<Link to="/performance" className="text-[13px] font-semibold text-[var(--color-brand)]">Back to performance</Link>} />
      </div>
    )
  }
  if (!data) return <PageSkeleton tiles={3} rows={6} />

  const { person, performance: p, points, previous } = data
  const reviewedThisMonth = p.manager.reviewed

  return (
    <div>
      {!embeddedFor && (
        <button onClick={() => navigate('/performance')}
          className="mb-4 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
          <ArrowLeft size={15} /> Back to performance
        </button>
      )}

      <div className="card flex flex-wrap items-center justify-between gap-6 p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold text-white"
            style={{ background: p.overall == null ? 'var(--color-pill-inactive)' : gradeTone(p.overall) }}>
            {initials(person.name)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-ink)]">{person.name}</h1>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">{person.title || '—'} · {person.department || '—'}</p>
            <Link to={`/people/${person.username}`} className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">
              View full employee profile <ExternalLink size={12} />
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-8">
          <Fact label="Overall performance" hint={`Work KPIs ${PERF_WEIGHTS.work}% + attendance ${PERF_WEIGHTS.attendance}% + manager ${PERF_WEIGHTS.manager}%, over the sources that have a number.`}>
            <span className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: gradeTone(p.overall) }}>
              {p.overall == null ? '—' : `${p.overall}%`}
            </span>
          </Fact>
          <Fact label="Status"><StatusChip status={p.status} /></Fact>
          <Fact label="Review">
            <span className="block text-[15px] font-semibold text-[var(--color-ink)]">{reviewedThisMonth ? 'Reviewed' : 'Not reviewed'}</span>
            <span className="mt-1 block text-[12px]" style={{ color: reviewedThisMonth ? 'var(--color-ink-faint)' : 'var(--color-pill-leave)' }}>
              {reviewedThisMonth ? dayLabel(p.manager.at) : p.overall == null ? 'Not due yet' : `Due this ${month === CUR_MONTH ? 'month' : monthLabel(month)}`}
            </span>
          </Fact>
          <Fact label="Period">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="field" aria-label="Month">
              {monthOptions().map((m) => <option key={m} value={m}>{m === CUR_MONTH ? 'This month' : monthLabel(m)}</option>)}
            </select>
          </Fact>
        </div>
      </div>

      <div className="mb-5 mt-5 flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium ${tab === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} month={month} previous={previous} points={points} />}
      {tab === 'kpis' && <KpiTab work={p.work} month={month} />}
      {tab === 'attendance' && <AttendanceTab month={data.attendanceMonth} label={monthLabel(month)} />}
      {tab === 'review' && <ReviewTab data={data} month={month} onSaved={() => { setData(null); load() }} />}
      {tab === 'history' && <HistoryTab reviews={data.reviews} />}
      {tab === 'notes' && <NotesTab coaching={data.coaching} warnings={data.warnings} />}
    </div>
  )
}

function Fact({ label, children, hint }) {
  return (
    <div className="border-l border-[var(--color-line)] pl-6 first:border-0 first:pl-0">
      <p className="text-[12px] font-medium text-[var(--color-ink-faint)]" title={hint || undefined}>{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

// ---------- Overview ----------
// Exported so the record page can be rendered and looked at with real-shaped
// data without a login (and so the render test covers it, not just the shell).
export function Overview({ data, month, previous, points }) {
  const p = data.performance
  const insight = useMemo(() => keyInsight(data, month), [data, month])
  const actions = recommendedActions(data)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="card p-5 lg:col-span-1">
        <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Performance summary</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
          Overall score is calculated from work KPIs, attendance and manager assessment.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-6">
          <Donut points={points} overall={p.overall} />
          <div className="min-w-[190px] flex-1 space-y-3">
            {points.map((pt) => (
              <div key={pt.key} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE_TONE[pt.key] }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-[var(--color-ink-soft)]">{pt.label}</span>
                  <span className="mt-0.5 block text-[12px] text-[var(--color-ink-faint)]">
                    {pt.earned == null
                      ? `Not scored — of ${pt.weight} points`
                      : `${pt.earned} of ${pt.weight} points`}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: pt.pct == null ? 'var(--color-ink-faint)' : 'var(--color-ink)' }}>
                  {pt.weight}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line-soft)] pt-4 text-[11.5px] text-[var(--color-ink-faint)]">
          <span>Score guide:</span>
          {SCORE_GUIDE.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: GRADE_TONE[g.id] }} />
              {g.id === 'excellent' ? '90%+' : g.id === 'good' ? '70 – 89%' : g.id === 'attention' ? '50 – 69%' : 'Below 50%'} {g.label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">What&rsquo;s driving this score?</h2>
            <span className="text-[11.5px] text-[var(--color-ink-faint)]">vs {monthLabel(previous.month)}</span>
          </div>
          <div className="mt-3.5 divide-y divide-[var(--color-line-soft)]">
            {points.map((pt) => (
              <div key={pt.key} className="flex items-center justify-between gap-3 py-3">
                <span className="text-[13px] text-[var(--color-ink-soft)]">{pt.label.replace(/ \(.*\)$/, '')}</span>
                <span className="flex items-center gap-4">
                  <span className="text-[13px] font-semibold tabular-nums" style={{ color: pt.pct == null ? 'var(--color-ink-faint)' : 'var(--color-ink)' }}>
                    {pt.pct == null ? '—' : `${pt.pct}%`}
                  </span>
                  <span className="w-[52px] text-right text-[12.5px] font-semibold tabular-nums"
                    style={{ color: pt.delta == null ? 'var(--color-ink-faint)' : pt.delta > 0 ? 'var(--color-pill-active)' : pt.delta < 0 ? 'var(--color-stage-out)' : 'var(--color-ink-faint)' }}>
                    {pt.delta == null ? '—' : `${pt.delta > 0 ? '↑' : pt.delta < 0 ? '↓' : ''}${Math.abs(pt.delta)}%`}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {insight && (
          <div className="card flex items-start gap-3 p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--color-stage-new-bg)', color: 'var(--color-stage-new)' }}>
              <Lightbulb size={16} />
            </span>
            <span>
              <span className="block text-[13px] font-semibold text-[var(--color-ink)]">Key insight</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">{insight}</span>
            </span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Recommended actions</h2>
          <div className="mt-3.5 space-y-2">
            {actions.map((a) => (
              <Link key={a.label} to={a.to}
                className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-[12.5px] font-semibold transition-colors hover:opacity-90"
                style={{ background: a.tint, color: a.ink }}>
                <a.icon size={14} /> {a.label}
              </Link>
            ))}
          </div>
          <p className="mt-3.5 text-[11.5px] text-[var(--color-ink-faint)]">Based on this month&rsquo;s KPIs, attendance and review status.</p>
        </div>

        <div className="card flex items-start gap-3 p-4"
          style={{ background: 'var(--color-stage-new-bg)', borderColor: 'var(--color-stage-new-bg)' }}>
          <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-stage-new)' }} />
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--color-stage-new)' }}>
            Scores are calculated automatically from Admin and Pulse data. Managers provide assessment and feedback — they do not override factual results.
          </p>
        </div>
      </div>
    </div>
  )
}

// The donut is the score AND its make-up: one arc per source, sized by the
// points that source actually earned. 🔒 A source with no number draws no arc —
// the gap in the ring is the missing review, not a zero.
function Donut({ points, overall, size = 150, stroke = 16 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  const arcs = points.map((pt) => {
    const len = ((pt.earned || 0) / 100) * c
    const arc = { key: pt.key, len, offset }
    offset += len
    return arc
  })
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fill)" strokeWidth={stroke} />
        {arcs.filter((a) => a.len > 0).map((a) => (
          <circle key={a.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SOURCE_TONE[a.key]} strokeWidth={stroke}
            strokeDasharray={`${a.len} ${c - a.len}`} strokeDashoffset={-a.offset} />
        ))}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-semibold leading-none tabular-nums" style={{ color: gradeTone(overall) }}>
          {overall == null ? '—' : `${overall}%`}
        </span>
        <span className="mt-1 text-[11px] text-[var(--color-ink-faint)]">Overall score</span>
      </span>
    </span>
  )
}

// 🔒 Derived from the numbers on the page, never invented. If nothing stands
// out, the card is not shown at all rather than filled with something bland.
function keyInsight(data, month) {
  const p = data.performance
  const w = p.work
  if (w && w.measured === 0 && w.total > 0) return `No work KPI can be measured yet for ${monthLabel(month)}, so the score rests on attendance and the manager's review alone.`
  if (w && w.measured && w.met < w.measured) {
    const missed = w.kpis.filter((k) => kpiAttainment(k) != null && Number(k.actual) < Number(k.target))
    const worst = missed.sort((a, b) => kpiAttainment(a) - kpiAttainment(b))[0]
    if (worst) return `${worst.label} is the biggest gap: ${worst.actual} against a target of ${worst.target}. ${w.met} of ${w.measured} targets met this month.`
  }
  if (p.attendance.pct != null && p.attendance.pct < 90) return `Attendance is ${p.attendance.pct}% — ${p.attendance.absent} day${p.attendance.absent === 1 ? '' : 's'} absent and ${p.attendance.late} late this month.`
  if (!p.manager.reviewed && p.overall != null) return `The manager's assessment is ${data.weights.manager}% of the score and has not been written for ${monthLabel(month)}.`
  if (w && w.measured && w.met === w.measured) return `Every measurable target was met this month (${w.met} of ${w.measured}).`
  return null
}

function recommendedActions(data) {
  const p = data.performance
  const out = []
  if (!p.manager.reviewed) out.push({ label: 'Write this month’s review', to: '#review', icon: ClipboardList, tint: 'var(--color-stage-interview-bg)', ink: 'var(--color-stage-interview)' })
  if (p.status === 'needs-attention') out.push({ label: 'Schedule a 1:1', to: '/reviews', icon: CalendarCheck, tint: 'var(--color-stage-new-bg)', ink: 'var(--color-stage-new)' })
  if (p.work && p.work.measured && p.work.met < p.work.measured) out.push({ label: 'Review the KPI targets', to: '/kpi-targets', icon: TrendingUp, tint: 'var(--color-stage-offer-bg)', ink: 'var(--color-stage-offer)' })
  if (p.attendance.pct != null && p.attendance.pct < 90) out.push({ label: 'Check the attendance record', to: '/attendance', icon: CalendarCheck, tint: 'var(--color-stage-out-bg)', ink: 'var(--color-stage-out)' })
  if (!out.length) out.push({ label: 'Log a coaching note', to: '/reviews', icon: ClipboardList, tint: 'var(--color-fill)', ink: 'var(--color-ink-soft)' })
  return out
}

// ---------- KPIs ----------
function KpiTab({ work, month }) {
  if (!work || !work.kpis?.length) {
    return <div className="card"><EmptyState title="No KPI scorecard for this role" line="Work KPIs are set per role on the KPI Targets page. A role with no scorecard is scored on attendance and the manager's review." /></div>
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
            <th className="h-[46px] rounded-tl-[10px] px-5">KPI</th>
            <th className="h-[46px] px-5">Target</th>
            <th className="h-[46px] px-5">Actual</th>
            <th className="h-[46px] px-5">Attainment</th>
            <th className="h-[46px] px-5">Weight</th>
            <th className="h-[46px] px-5">Result</th>
          </tr>
        </thead>
        <tbody>
          {work.kpis.map((k) => {
            const at = kpiAttainment(k)
            const met = at != null && Number(k.actual) >= Number(k.target)
            return (
              <tr key={k.key} className="border-b border-[var(--color-line-soft)] last:border-0">
                <td className="h-[68px] px-5 py-3">
                  <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{k.label}</span>
                  {k.detail && <span className="mt-0.5 block text-[12px] text-[var(--color-ink-faint)]">{k.detail}</span>}
                </td>
                <td className="h-[68px] px-5 py-3 text-[var(--color-ink-soft)] tabular-nums">{k.target ?? '—'}{k.unit === '%' ? '%' : ''}</td>
                <td className="h-[68px] px-5 py-3 tabular-nums">
                  {k.actual == null
                    ? <span className="text-[var(--color-ink-faint)]">Not measured</span>
                    : <span className="font-semibold text-[var(--color-ink)]">{k.actual}{k.unit === '%' ? '%' : ''}</span>}
                </td>
                <td className="h-[68px] px-5 py-3"><Meter pct={at} tone={SOURCE_TONE.work} width={100} /></td>
                <td className="h-[68px] px-5 py-3 text-[var(--color-ink-soft)] tabular-nums">{k.weight ?? '—'}%</td>
                <td className="h-[68px] px-5 py-3">
                  {at == null
                    ? <span className="text-[12px] text-[var(--color-ink-faint)]">Not counted</span>
                    : <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                        style={met
                          ? { background: 'var(--color-pill-active-bg)', color: 'var(--color-pill-active)' }
                          : { background: 'var(--color-pill-leave-bg)', color: 'var(--color-pill-leave)' }}>
                        {met ? 'Target met' : 'Below target'}
                      </span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {work.unmeasured?.length > 0 && (
        <p className="border-t border-[var(--color-line-soft)] px-5 py-3.5 text-[12px] text-[var(--color-ink-faint)]">
          {work.measured} of {work.total} KPIs are measured for {monthLabel(month)}. Admin has no figure yet for {work.unmeasured.join(', ')}, so {work.unmeasured.length === 1 ? 'it is' : 'they are'} left out of the score rather than counted as a miss.
        </p>
      )}
    </div>
  )
}

// ---------- Attendance ----------
function AttendanceTab({ month, label }) {
  const s = month?.summary
  if (!s) return <div className="card"><EmptyState title="No attendance for this month" line="Nothing has been recorded yet." /></div>
  if (!month.keepsSchedule) {
    return <div className="card"><EmptyState title="This person keeps no schedule" line="Contractors do not clock in, so attendance is not part of their score." /></div>
  }
  const cells = [
    ['Attendance rate', s.ratePct == null ? '—' : `${s.ratePct}%`, SOURCE_TONE.attendance],
    ['Days present', `${s.present} of ${s.scheduledDays}`, 'var(--color-ink)'],
    ['Late', String(s.late), s.late ? 'var(--color-pill-leave)' : 'var(--color-ink)'],
    ['Absent', String(s.absent), s.absent ? 'var(--color-stage-out)' : 'var(--color-ink)'],
    ['On leave', String(s.leave), 'var(--color-ink)'],
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cells.map(([k, v, tone]) => (
          <div key={k} className="card p-5">
            <p className="text-[12px] font-medium text-[var(--color-ink-faint)]">{k}</p>
            <p className="mt-2.5 text-[24px] font-semibold leading-none tabular-nums" style={{ color: tone }}>{v}</p>
          </div>
        ))}
      </div>
      <div className="card p-5">
        <h3 className="mb-3.5 text-[13px] font-semibold text-[var(--color-ink)]">{label}</h3>
        <div className="flex flex-wrap gap-1.5">
          {month.days.map((d) => (
            <span key={d.date} title={`${d.date} · ${d.status}`}
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[11px] font-medium"
              style={dayTone(d.status)}>
              {Number(d.date.slice(-2))}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
const dayTone = (status) => ({
  worked: { background: 'var(--color-pill-active-bg)', color: 'var(--color-pill-active)' },
  late: { background: 'var(--color-pill-leave-bg)', color: 'var(--color-pill-leave)' },
  absent: { background: 'var(--color-stage-out-bg)', color: 'var(--color-stage-out)' },
  leave: { background: 'var(--color-stage-new-bg)', color: 'var(--color-stage-new)' },
  sick: { background: 'var(--color-stage-screening-bg)', color: 'var(--color-stage-screening)' },
}[status] || { background: 'var(--color-fill)', color: 'var(--color-ink-faint)' })

// ---------- Manager review ----------
// 🔒 This is the ONLY number on the page a person types, and it is worth
// PERF_WEIGHTS.manager of the score. It cannot replace the factual half.
function ReviewTab({ data, month, onSaved }) {
  const existing = data.reviews.find((r) => r.period === month)
  const [ratings, setRatings] = useState(() => Object.fromEntries(RATING_AXES.map((a) => [a, ''])))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  if (existing) {
    return (
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Review for {monthLabel(month)}</h2>
          <span className="text-[12px] text-[var(--color-ink-faint)]">Locked {dayLabel(existing.completedAt)} by {existing.manager || '—'}</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {RATING_AXES.map((a) => (
            <div key={a} className="flex items-center gap-4">
              <span className="w-40 shrink-0 text-[13px] text-[var(--color-ink-soft)]">{a}</span>
              <Meter pct={existing.ratings?.[a] == null || existing.ratings[a] === '' ? null : Number(existing.ratings[a])} tone={SOURCE_TONE.manager} width={160} />
            </div>
          ))}
        </div>
        {existing.notes && <p className="mt-4 whitespace-pre-wrap rounded-[8px] bg-[var(--color-fill)] p-3.5 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">{existing.notes}</p>}
      </div>
    )
  }

  const submit = async () => {
    setSaving(true)
    setErr('')
    try {
      await api('/reviews', { method: 'POST', body: {
        name: data.person.name,
        period: month,
        ratings: Object.fromEntries(Object.entries(ratings).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        notes,
      } })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const any = Object.values(ratings).some((v) => v !== '')

  return (
    <div className="card max-w-[640px] p-5">
      <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Assessment for {monthLabel(month)}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
        Rate each area out of 100. This is {data.weights.manager}% of the overall score; the other {100 - data.weights.manager}% is measured, not rated.
      </p>
      <div className="mt-4 space-y-2.5">
        {RATING_AXES.map((a) => (
          <label key={a} className="flex items-center gap-4">
            <span className="w-40 shrink-0 text-[13px] text-[var(--color-ink-soft)]">{a}</span>
            <input type="number" min="0" max="100" value={ratings[a]} placeholder="—"
              onChange={(e) => setRatings((r) => ({ ...r, [a]: e.target.value }))}
              className="field w-24" />
            <span className="text-[12px] text-[var(--color-ink-faint)]">%</span>
            <Stars count={ratings[a] === '' ? null : Math.round(Number(ratings[a]) / 20)} />
          </label>
        ))}
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
        placeholder="What went well, what to work on next month…" className="field mt-4 w-full" />
      {err && <p className="mt-3 text-[12.5px] text-[var(--color-stage-out)]">{err}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} disabled={!any || saving} className="btn-primary disabled:opacity-50">
          {saving ? 'Saving…' : 'Lock this review'}
        </button>
        <span className="text-[12px] text-[var(--color-ink-faint)]">A locked review cannot be edited.</span>
      </div>
    </div>
  )
}

// ---------- Reviews history ----------
function HistoryTab({ reviews }) {
  if (!reviews.length) return <div className="card"><EmptyState title="No reviews yet" line="Once a month is reviewed it is locked and appears here." /></div>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
            <th className="h-[46px] rounded-tl-[10px] px-5">Month</th>
            <th className="h-[46px] px-5">Assessment</th>
            <th className="h-[46px] px-5">Manager</th>
            <th className="h-[46px] px-5">Locked</th>
            <th className="h-[46px] px-5">Notes</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((r) => {
            const axes = RATING_AXES.map((a) => Number(r.ratings?.[a])).filter((n) => Number.isFinite(n) && n > 0)
            const pct = axes.length ? Math.round(axes.reduce((s, n) => s + n, 0) / axes.length) : (r.score == null ? null : Number(r.score))
            return (
              <tr key={r.id} className="border-b border-[var(--color-line-soft)] last:border-0">
                <td className="h-[64px] px-5 py-3 font-semibold text-[var(--color-ink)]">{monthLabel(r.period)}</td>
                <td className="h-[64px] px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <Stars count={pct == null ? null : Math.round(pct / 20)} />
                    <span className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">{pct == null ? '—' : `${pct}%`}</span>
                  </span>
                </td>
                <td className="h-[64px] px-5 py-3 text-[var(--color-ink-soft)]">{r.manager || '—'}</td>
                <td className="h-[64px] whitespace-nowrap px-5 py-3 text-[var(--color-ink-soft)]">{dayLabel(r.completedAt)}</td>
                <td className="h-[64px] max-w-[360px] truncate px-5 py-3 text-[var(--color-ink-faint)]">{r.notes || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Notes & actions ----------
function NotesTab({ coaching, warnings }) {
  const items = [
    ...warnings.map((w) => ({ id: `w${w.id}`, kind: `${(w.type || 'Verbal').replace(/^./, (c) => c.toUpperCase())} warning`, when: w.date, text: w.reason || '', tone: 'var(--color-stage-out)' })),
    ...coaching.map((c) => ({ id: `c${c.id}`, kind: c.type === 'flag' ? 'Flag' : 'Coaching', when: c.date || c.createdAt, text: c.note || c.body || '', tone: 'var(--color-stage-new)' })),
  ].sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')))

  if (!items.length) return <div className="card"><EmptyState title="Nothing logged" line="Warnings and coaching notes for this person appear here as they are written." /></div>
  return (
    <div className="card divide-y divide-[var(--color-line-soft)]">
      {items.map((i) => (
        <div key={i.id} className="flex items-start gap-3.5 p-5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: i.tone }} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-ink)]">{i.kind}</span>
              <span className="text-[12px] text-[var(--color-ink-faint)]">{dayLabel(i.when)}</span>
            </span>
            <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">{i.text || '—'}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
