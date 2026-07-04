import { useEffect, useState } from 'react'
import {
  Star, Trophy, ListChecks, TrendingUp, CircleCheck, Circle,
  Sparkles, MessageSquare, Flag,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'
import {
  band, attendanceBand, statusFor, trendSeries, salesForPeriod, periodLabel, CUR_PERIOD,
} from '../lib/performance.js'

// Staff self-view — "My Progress". The signed-in person's OWN goals, score,
// KPI ratings, achievements and monthly history. Everything here is REAL: it
// comes from manager-entered locked monthly reviews, the live manager score and
// real sales. Nothing is sampled or invented — any section with no data yet
// shows an honest "not set yet" state instead of placeholder numbers.
//
// Deliberately NO ranking / leaderboard / team comparison (Adama, 29 Jun 2026):
// the employee view is about improving yourself, not comparing to others. Those
// analytics stay on the manager Performance page where they belong.

function Stars({ score, size = 18 }) {
  if (score == null) return null
  const filled = Math.max(0, Math.min(5, Math.round(score / 20)))
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={size} className={i < filled ? 'fill-amber-400 text-amber-400' : 'text-[var(--color-line)]'} />
      ))}
    </span>
  )
}

function Bar({ pct, tone = 'bg-emerald-500' }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }} />
    </div>
  )
}

function Sparkline({ series }) {
  if (!series || series.length < 2) return null
  const w = 132, h = 36, pad = 3
  const vals = series.map((s) => s.v)
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const pts = series.map((s, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2)
    const y = h - pad - ((s.v - min) / span) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Empty({ children }) {
  return <Card className="p-6 text-center text-sm text-[var(--color-ink-faint)]">{children}</Card>
}

// One automatic status sentence — the employee's "headline" for the month.
// Built only from real signals (score, goal %, improving streak); never invents.
function statusLine({ score, goalPct, series }) {
  if (series && series.length >= 3) {
    let run = 1
    for (let i = series.length - 1; i > 0; i--) { if (series[i].v > series[i - 1].v) run++; else break }
    if (run >= 3) return { tone: 'blue', text: `Great work — your score has improved ${run - 1} months in a row.` }
  }
  if (goalPct != null) {
    if (goalPct >= 70) return { tone: 'green', text: `You're having a strong month — you've completed ${goalPct}% of your goals.` }
    if (goalPct < 40) return { tone: 'amber', text: `You're behind on your goals — ${goalPct}% done. Push to finish them this month.` }
    return { tone: 'amber', text: `You're making progress — ${goalPct}% of your goals done. Keep going.` }
  }
  if (score != null) {
    if (score >= 70) return { tone: 'green', text: `You're on track this month. Keep it up.` }
    return { tone: 'amber', text: `There's room to improve this month — talk to your manager about your goals.` }
  }
  return { tone: 'blue', text: `Your score builds here as your KPIs connect and your monthly reviews are locked.` }
}

const TONE = {
  green: { dot: '🟢', bg: 'bg-emerald-50', text: 'text-emerald-800', ring: 'border-emerald-200' },
  amber: { dot: '🟡', bg: 'bg-amber-50', text: 'text-amber-800', ring: 'border-amber-200' },
  blue: { dot: '🔵', bg: 'bg-blue-50', text: 'text-blue-800', ring: 'border-blue-200' },
  red: { dot: '🔴', bg: 'bg-red-50', text: 'text-red-800', ring: 'border-red-200' },
}

export default function MyProgress() {
  const [data, setData] = useState(null)

  useEffect(() => {
    api('/my/progress')
      .then(setData)
      .catch(() => setData({ reviews: [], sales: null }))
  }, [])

  if (!data) {
    return <div className="flex justify-center py-24"><Spinner size={28} /></div>
  }

  const reviews = data.reviews || []
  const latest = reviews.length ? reviews[reviews.length - 1] : null
  const currentReview = reviews.find((r) => r.period === CUR_PERIOD) || null

  // Real sales progress for the current month (if this person has sales data).
  const liveSales = salesForPeriod(data.sales, { kind: 'current', period: CUR_PERIOD })

  // Headline score: live manager score wins; else the latest locked review; else
  // — for a sales role — real current-month sales attainment. Null if none exist.
  let score = data.liveScore
  if (score == null && latest) score = latest.score
  if (score == null && liveSales && liveSales.target) {
    score = Math.min(100, Math.round((liveSales.sales / liveSales.target) * 100))
  }

  const b = band(score)
  const st = data.liveStatus || latest?.status || statusFor(score).label

  // Goals mirror the scorecard (server-derived — Adama 2 Jul: "if you have the
  // KPIs you have the goals"). The locked review's checklist rides along as the
  // manager's own additions; the live sales row stays for people with sales
  // data but no scorecard.
  const derivedGoals = data.goals || []
  const kpiGoals = (latest?.kpis || []).map((k) => ({ label: k.label, done: !!k.done }))
  const salesGoal = (liveSales && liveSales.target && !derivedGoals.some((g) => g.key === 'sales'))
    ? { label: data.kpi || `Close ${liveSales.target} tracker sales`, value: liveSales.sales, target: liveSales.target }
    : null

  // Goal completion % for the status row — measurable derived goals first,
  // then the checklist, then sales. Unmeasurable (Connecting) never counts.
  let goalPct = null, goalText = null
  const measurable = derivedGoals.filter((g) => g.done != null)
  if (measurable.length) {
    const done = measurable.filter((g) => g.done).length
    goalPct = Math.round((done / measurable.length) * 100)
    goalText = `${done}/${measurable.length}`
  } else if (kpiGoals.length) {
    const done = kpiGoals.filter((g) => g.done).length
    goalPct = Math.round((done / kpiGoals.length) * 100)
    goalText = `${done}/${kpiGoals.length}`
  } else if (salesGoal) {
    goalPct = Math.min(100, Math.round((salesGoal.value / salesGoal.target) * 100))
    goalText = `${salesGoal.value}/${salesGoal.target}`
  }

  const series = trendSeries(reviews, data.liveScore)
  const ratings = latest?.ratings || {}
  const ratingKeys = Object.keys(ratings)
  const achievements = latest?.achievements || []
  const feedback = (latest?.notes || data.liveNote || '').trim()

  // Scorecard — the role's weighted KPIs. Actuals arrive from Admin; until then
  // only the live ones (sales) render a number, the rest show "Connecting".
  const scKpis = data.scorecard?.kpis || []
  const scLive = scKpis.filter((k) => k.actual != null).length

  // Next actions: the manager's listed actions plus the obvious live gaps.
  const actions = [...(latest?.actions || [])]
  if (salesGoal && salesGoal.value < salesGoal.target) actions.push(`Close ${salesGoal.target - salesGoal.value} more tracker sales`)
  if (!currentReview) actions.push(`Complete your ${periodLabel(CUR_PERIOD)} review with your manager`)

  const line = statusLine({ score, goalPct, series })
  const tone = TONE[line.tone]

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-ink)] md:text-3xl">My Progress</h1>
        <p className="mt-1 text-[var(--color-ink-faint)]">{periodLabel(CUR_PERIOD)} · your goals, score and how you're doing.</p>
      </div>

      {/* Auto status sentence — the employee's headline for the month */}
      <div className={`flex items-start gap-3 rounded-2xl border ${tone.ring} ${tone.bg} px-4 py-3.5`}>
        <span className="text-lg leading-none">{tone.dot}</span>
        <p className={`text-sm font-semibold ${tone.text}`}>{line.text}</p>
      </div>

      {/* Overall progress hero + this-month row */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Overall progress</div>
            <div className="mt-1 flex items-end gap-3">
              <span className={`text-5xl font-extrabold tracking-tight ${b.text}`}>{score == null ? '—' : `${score}%`}</span>
              <div className="pb-1">
                <Stars score={score} />
                <div className="mt-1"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusFor(score).tone}`}>{st}</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-[var(--color-line-soft)] pt-5 sm:grid-cols-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Goal completion</div>
            {goalText ? (
              <>
                <div className="mt-1 text-2xl font-bold text-[var(--color-ink)]">{goalText}</div>
                <div className="mt-2"><Bar pct={goalPct} tone={b.bar} /></div>
              </>
            ) : <div className="mt-1 text-sm text-[var(--color-ink-faint)]">No goals set yet</div>}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Current score</div>
            <div className="mt-1 text-2xl font-bold text-[var(--color-ink)]">{score == null ? '—' : `${score}%`}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Manager review</div>
            <div className="mt-1">
              {currentReview
                ? <Pill tone="good" dot>Reviewed</Pill>
                : <Pill tone="rest" dot>Pending</Pill>}
            </div>
            {latest && <div className="mt-1.5 text-xs text-[var(--color-ink-faint)]">Last reviewed {periodLabel(latest.period)}</div>}
          </div>
        </div>
      </Card>

      {/* My Goals checklist */}
      <div>
        <SectionTitle>My goals</SectionTitle>
        {(derivedGoals.length || kpiGoals.length || salesGoal) ? (
          <div className="space-y-2.5">
            {derivedGoals.map((g) => (
              <Card key={g.key} className="flex items-center gap-3 p-4">
                {g.done === true
                  ? <CircleCheck size={20} className="shrink-0 text-emerald-500" />
                  : <Circle size={20} className={`shrink-0 ${g.done === false ? 'text-amber-500' : 'text-[var(--color-ink-faint)]'}`} />}
                <span className={`flex-1 text-sm font-semibold ${g.done === true ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{g.text}</span>
                {g.done === true && <Pill tone="good">Done</Pill>}
                {g.done === false && (
                  <span className="shrink-0 text-sm font-bold text-[var(--color-ink)]">
                    {g.actual}{g.unit === '%' ? '%' : ''} / {g.target}{g.unit === '%' ? '%' : ''}
                  </span>
                )}
                {g.done == null && <Pill tone="rest" dot>Connecting to Admin</Pill>}
              </Card>
            ))}
            {kpiGoals.length > 0 && derivedGoals.length > 0 && (
              <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">Added by your manager</p>
            )}
            {salesGoal && (
              <Card className="flex items-center gap-3 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}><TrendingUp size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--color-ink)]">{salesGoal.label}</div>
                  <div className="mt-1.5"><Bar pct={Math.min(100, Math.round((salesGoal.value / salesGoal.target) * 100))} tone="bg-[var(--color-brand)]" /></div>
                </div>
                <span className="shrink-0 text-sm font-bold text-[var(--color-ink)]">{salesGoal.value}/{salesGoal.target}</span>
              </Card>
            )}
            {kpiGoals.map((g, i) => (
              <Card key={i} className="flex items-center gap-3 p-4">
                {g.done
                  ? <CircleCheck size={20} className="shrink-0 text-emerald-500" />
                  : <Circle size={20} className="shrink-0 text-[var(--color-ink-faint)]" />}
                <span className={`flex-1 text-sm font-semibold ${g.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{g.label}</span>
                {g.done && <Pill tone="good">Done</Pill>}
              </Card>
            ))}
          </div>
        ) : (
          <Empty>Your goals come from your role's KPIs and will appear here.</Empty>
        )}
        {data.weeklyTarget && <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Weekly focus: {data.weeklyTarget}</p>}
      </div>

      {/* Scorecard — the role's weighted KPIs (real targets; actuals from Admin) */}
      {scKpis.length > 0 && (
        <div>
          <SectionTitle>My KPIs</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scKpis.map((k) => {
              const a = k.actual == null ? null : Math.min(100, Math.round((k.actual / k.target) * 100))
              // Attendance KPI colours by absolute % (green ≥95 / amber 80–94 / red <80);
              // every other KPI keeps the attainment-vs-target band.
              const isAttendance = (k.key || '').includes('attendance')
              const kb = isAttendance ? attendanceBand(k.actual) : band(a)
              return (
                <Card key={k.key} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--color-ink)]">{k.label}</span>
                    <span className="rounded-full bg-[var(--color-line-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink-faint)]">weight {k.weight}%</span>
                  </div>
                  {k.actual == null ? (
                    <div className="mt-2">
                      <Pill tone="rest" dot>Connecting to Admin</Pill>
                      <div className="mt-1.5 text-xs text-[var(--color-ink-faint)]">Target {k.kind === 'percent' ? `≥ ${k.target}%` : `${k.target} ${k.unit}`}</div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 flex items-end justify-between">
                        <span className={`text-2xl font-extrabold ${kb.text}`}>{k.kind === 'percent' ? `${k.actual}%` : `${k.actual}/${k.target}`}</span>
                        <span className="text-xs text-[var(--color-ink-faint)]">target {k.kind === 'percent' ? `≥ ${k.target}%` : k.target}</span>
                      </div>
                      <div className="mt-2"><Bar pct={a} tone={kb.bar} /></div>
                    </>
                  )}
                </Card>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
            {scLive === scKpis.length
              ? 'Your KPIs, weighted into your overall score.'
              : 'Sales is live now. Online trackers, retention and Google reviews switch on once Admin is connected.'}
          </p>
        </div>
      )}

      {/* Manager ratings — subjective 0–100 ratings entered in a review */}
      <div>
        <SectionTitle>Manager ratings</SectionTitle>
        {ratingKeys.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {ratingKeys.map((k) => {
              const v = Number(ratings[k]) || 0
              const kb = band(v)
              return (
                <Card key={k} className="p-4">
                  <div className="text-xs font-semibold text-[var(--color-ink-faint)]">{k}</div>
                  <div className={`mt-1 text-2xl font-extrabold ${kb.text}`}>{v}%</div>
                  <div className="mt-2"><Bar pct={v} tone={kb.bar} /></div>
                </Card>
              )
            })}
          </div>
        ) : (
          <Empty>Your KPI scores show here once your manager rates them in a review.</Empty>
        )}
      </div>

      {/* Progress history */}
      <div>
        <SectionTitle>Progress history</SectionTitle>
        {series.length >= 1 ? (
          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {series.map((s) => (
                <div key={s.period} className="text-center">
                  <div className="text-xs text-[var(--color-ink-faint)]">{periodLabel(s.period).split(' ')[0]}</div>
                  <div className="text-base font-bold text-[var(--color-ink)]">{s.v}%</div>
                </div>
              ))}
            </div>
            <Sparkline series={series} />
          </Card>
        ) : (
          <Empty>Your monthly score history builds up as reviews are completed.</Empty>
        )}
      </div>

      {/* Recognition */}
      <div>
        <SectionTitle>Recognition</SectionTitle>
        {achievements.length ? (
          <div className="flex flex-wrap gap-2">
            {achievements.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700">
                <Trophy size={14} />{a}
              </span>
            ))}
          </div>
        ) : (
          <Empty>Achievements your manager awards you will appear here.</Empty>
        )}
      </div>

      {/* Manager feedback */}
      <div>
        <SectionTitle>Manager feedback</SectionTitle>
        {feedback ? (
          <Card className="flex items-start gap-3 p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}><MessageSquare size={18} /></span>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-soft)]">{feedback}</p>
          </Card>
        ) : (
          <Empty>No feedback shared yet.</Empty>
        )}
      </div>

      {/* Next actions */}
      {actions.length > 0 && (
        <div>
          <SectionTitle>This month — still to do</SectionTitle>
          <Card className="p-5">
            <ul className="space-y-2.5">
              {actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
                  <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--color-brand)]" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  )
}
