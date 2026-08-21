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
        <Star key={i} size={size} className={i < filled ? 'fill-[var(--color-warn)] text-[var(--color-warn)]' : 'text-[var(--color-line)]'} />
      ))}
    </span>
  )
}

function Bar({ pct, tone = 'bg-[var(--color-good-bg)]0' }) {
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
  return <Card className="p-5 text-center text-[13px] text-[var(--color-ink-faint)]">{children}</Card>
}

// One automatic status sentence — the employee's "headline" for the month.
// Built only from real signals (score, goal %, improving streak); never invents.
// Early in the month a low % is normal, not a failure — no nagging before a
// third of the month is gone (Adama 4 Jul: "behind, push!" on the 4th is noise).
function statusLine({ score, goalPct, series, monthElapsedPct, daysLeft, daysSinceJoined, firstName }) {
  // A brand-new joiner is never "behind" — welcome them for their first two weeks.
  if (daysSinceJoined != null && daysSinceJoined >= 0 && daysSinceJoined <= 14) {
    return { tone: 'blue', text: `Welcome to the team${firstName ? `, ${firstName}` : ''}! Your goals for the month are below. Your score builds as you close your first sales.` }
  }
  if (series && series.length >= 3) {
    let run = 1
    for (let i = series.length - 1; i > 0; i--) { if (series[i].v > series[i - 1].v) run++; else break }
    if (run >= 3) return { tone: 'blue', text: `Great work. Your score has improved ${run - 1} months in a row.` }
  }
  if (goalPct != null) {
    if (goalPct >= 70) return { tone: 'green', text: `You're having a strong month with ${goalPct}% of your goals completed.` }
    if (goalPct < 40 && monthElapsedPct != null && monthElapsedPct <= 33) {
      return { tone: 'blue', text: `The month is young. ${daysLeft} days to hit your goals.` }
    }
    if (goalPct < 40) return { tone: 'amber', text: `You're behind on your goals at ${goalPct}% done. Push to finish them this month.` }
    return { tone: 'amber', text: `You're making progress with ${goalPct}% of your goals done. Keep going.` }
  }
  if (score != null) {
    if (score >= 70) return { tone: 'green', text: `You're on track this month. Keep it up.` }
    return { tone: 'amber', text: `There's room to improve this month. Talk to your manager about your goals.` }
  }
  return { tone: 'blue', text: `Your score builds here as your KPIs connect and your monthly reviews are locked.` }
}

const TONE = {
  green: { dot: '🟢', bg: 'bg-[var(--color-good-bg)]', text: 'text-[var(--color-good)]', ring: 'border-[var(--color-good-bg)]' },
  amber: { dot: '🟡', bg: 'bg-[var(--color-warn-bg)]', text: 'text-[var(--color-warn)]', ring: 'border-[var(--color-warn-bg)]' },
  blue: { dot: '🔵', bg: 'bg-[var(--color-brand-50)]', text: 'text-[var(--color-brand-700)]', ring: 'border-[var(--color-brand-50)]' },
  red: { dot: '🔴', bg: 'bg-[var(--color-bad-bg)]', text: 'text-[var(--color-bad)]', ring: 'border-[var(--color-bad-bg)]' },
}

export default function MyProgress() {
  const [data, setData] = useState(null)
  // Two tabs (Adama 4 Jul: "5 different things all in one page" — split it):
  // THIS MONTH = the live push (banner, score, KPI cards, still-to-do);
  // MY RECORD = the past (history, ratings, recognition, feedback).
  const [tab, setTab] = useState('now')

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

  // How far into the month we are — lets the headline stay calm early on.
  const nowD = new Date()
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate()
  const monthElapsedPct = Math.round((nowD.getDate() / daysInMonth) * 100)
  const daysLeft = daysInMonth - nowD.getDate()

  const daysSinceJoined = data.joined ? Math.floor((nowD - new Date(data.joined)) / 86400000) : null
  const firstName = (data.name || '').split(' ')[0]

  const line = statusLine({ score, goalPct, series, monthElapsedPct, daysLeft, daysSinceJoined, firstName })
  const tone = TONE[line.tone]

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="t-page">My Progress</h1>
        <p className="mt-1 text-[var(--color-ink-faint)]">{periodLabel(CUR_PERIOD)} · this month's goals, and your record before.</p>
      </div>

      {/* Now vs before — the page's two halves as tabs */}
      <div className="flex w-fit gap-1 rounded-full bg-[var(--color-fill)] p-1">
        {[{ id: 'now', label: 'This month' }, { id: 'record', label: 'My record' }].map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${tab === tb.id ? 'bg-white text-[var(--color-ink)]' : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink-soft)]'}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'now' && (<>
      {/* Auto status sentence — the employee's headline for the month */}
      <div className={`flex items-start gap-3 rounded-lg border ${tone.ring} ${tone.bg} px-4 py-3.5`}>
        <span className="text-[15px] leading-none">{tone.dot}</span>
        <p className={`text-[13px] font-semibold ${tone.text}`}>{line.text}</p>
      </div>

      {/* Overall progress hero + this-month row */}
      <Card className="p-5 sm:p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Overall progress</div>
            <div className="mt-1 flex items-end gap-3">
              <span className={`text-5xl font-semibold tracking-tight ${b.text}`}>{score == null ? '' : `${score}%`}</span>
              <div className="pb-1">
                <Stars score={score} />
                <div className="mt-1"><span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${statusFor(score).tone}`}>{st}</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-[var(--color-line-soft)] pt-5 sm:grid-cols-3">
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Goal completion</div>
            {goalText ? (
              <>
                <div className="mt-1 text-[22px] font-semibold text-[var(--color-ink)]">{goalText}</div>
                <div className="mt-2"><Bar pct={goalPct} tone={b.bar} /></div>
              </>
            ) : <div className="mt-1 text-[13px] text-[var(--color-ink-faint)]">No goals set yet</div>}
          </div>
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Current score</div>
            <div className="mt-1 text-[22px] font-semibold text-[var(--color-ink)]">{score == null ? 'Not scored' : `${score}%`}</div>
          </div>
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Manager review</div>
            <div className="mt-1">
              {currentReview
                ? <Pill tone="good" dot>Reviewed</Pill>
                : <Pill tone="rest" dot>Pending</Pill>}
            </div>
            {latest && <div className="mt-1.5 text-[11.5px] text-[var(--color-ink-faint)]">Last reviewed {periodLabel(latest.period)}</div>}
          </div>
        </div>
      </Card>

      {/* THIS MONTH — one card per KPI: the goal sentence, the live number,
          the bar and the weight, said ONCE (Adama 4 Jul: "My goals" and "My
          KPIs" were the same four things twice — merged; the record moved to
          My history below). Manager-added checklist items keep their rows. */}
      <div>
        <SectionTitle>This month</SectionTitle>
        {(scKpis.length || kpiGoals.length || salesGoal) ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scKpis.map((k) => {
              const g = derivedGoals.find((x) => x.key === k.key)
              // Null target = not set yet (team reviews until Adama picks one):
              // show the real count, but no attainment %, no bar, never "Done".
              const a = k.actual == null || k.target == null ? null : Math.min(100, Math.round((k.actual / k.target) * 100))
              // Attendance KPI colours by absolute % (green ≥95 / amber 80–94 / red <80);
              // every other KPI keeps the attainment-vs-target band.
              const isAttendance = (k.key || '').includes('attendance')
              const kb = isAttendance ? attendanceBand(k.actual) : band(a)
              const met = k.actual != null && k.target != null && k.actual >= k.target
              return (
                <Card key={k.key} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[var(--color-ink)]">{g?.text || k.label}</span>
                    <span className="shrink-0 rounded-full bg-[var(--color-line-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink-faint)]">weight {k.weight}%</span>
                  </div>
                  {k.actual == null ? (
                    <div className="mt-2.5">
                      <Pill tone="rest" dot>Connecting to Admin</Pill>
                      <div className="mt-1.5 text-[11.5px] text-[var(--color-ink-faint)]">Target {k.kind === 'percent' ? `≥ ${k.target}%` : `${k.target} ${k.unit}`}</div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 flex items-end justify-between">
                        <span className={`text-[22px] font-semibold ${kb.text}`}>{k.kind === 'percent' ? `${k.actual}%` : k.target == null ? `${k.actual}` : `${k.actual}/${k.target}`}</span>
                        {met
                          ? <Pill tone="good">Done</Pill>
                          : <span className="text-[11.5px] text-[var(--color-ink-faint)]">{k.target == null ? 'no target yet' : `target ${k.kind === 'percent' ? `≥ ${k.target}%` : k.target}`}</span>}
                      </div>
                      {/* The counts behind the % (Adama 4 Jul: numbers, not
                          only percentage) — e.g. "1 on time of 6 · 5 open past SLA". */}
                      {k.detail && (
                        <div className="mt-1 text-[11.5px] font-medium text-[var(--color-ink-soft)]">{k.detail}</div>
                      )}
                      {a != null && <div className="mt-2"><Bar pct={a} tone={kb.bar} /></div>}
                    </>
                  )}
                </Card>
              )
            })}
          </div>
        ) : (
          <Empty>Your goals come from your role's KPIs and will appear here.</Empty>
        )}
        {(kpiGoals.length > 0 || salesGoal) && (
          <div className="mt-3 space-y-2.5">
            {kpiGoals.length > 0 && (
              <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Added by your manager</p>
            )}
            {salesGoal && (
              <Card className="flex items-center gap-3 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}><TrendingUp size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[var(--color-ink)]">{salesGoal.label}</div>
                  <div className="mt-1.5"><Bar pct={Math.min(100, Math.round((salesGoal.value / salesGoal.target) * 100))} tone="bg-[var(--color-brand)]" /></div>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-[var(--color-ink)]">{salesGoal.value}/{salesGoal.target}</span>
              </Card>
            )}
            {kpiGoals.map((g, i) => (
              <Card key={i} className="flex items-center gap-3 p-4">
                {g.done
                  ? <CircleCheck size={20} className="shrink-0 text-[var(--color-good)]" />
                  : <Circle size={20} className="shrink-0 text-[var(--color-ink-faint)]" />}
                <span className={`flex-1 text-[13px] font-semibold ${g.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{g.label}</span>
                {g.done && <Pill tone="good">Done</Pill>}
              </Card>
            ))}
          </div>
        )}
        {scKpis.length > 0 && (
          <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">
            {scLive === scKpis.length
              ? 'Your KPIs, weighted into your overall score.'
              : 'Sales is live now. Online trackers, retention and Google reviews switch on once Admin is connected.'}
          </p>
        )}
        {data.weeklyTarget && <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">Weekly focus: {data.weeklyTarget}</p>}
      </div>
      </>)}

      {tab === 'record' && (<>
      {/* MY HISTORY — the record, month by month (Adama 4 Jul: the page only
          talked about "now"; performance means now AND before). Sales come
          from Ya Fatou's sheet before Jul 2026 and from Admin after — the
          same cutover as the live number. Review scores join as managers
          lock monthly reviews. */}
      <div>
        <SectionTitle>My history</SectionTitle>
        {(data.history?.length || series.length >= 1) ? (
          <div className="space-y-3">
            {data.history?.length > 0 && (
              <Card className="divide-y divide-[var(--color-line-soft)] p-0">
                {data.history.map((h) => {
                  const met = h.sales != null && h.sales >= h.target
                  return (
                    <div key={h.month} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-24 shrink-0 text-[13px] font-semibold text-[var(--color-ink)]">{periodLabel(h.month)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[13px] font-semibold ${h.sales == null ? 'text-[var(--color-ink-faint)]' : met ? 'text-[var(--color-good)]' : 'text-[var(--color-ink)]'}`}>
                            {h.sales == null ? (h.pending ? 'not entered yet' : '—') : `${h.sales} of ${h.target} sales`}
                          </span>
                          {met && <Pill tone="good">Goal met</Pill>}
                        </div>
                        {h.customers?.length > 0 && (
                          <div className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink-faint)]" title={h.customers.join(' · ')}>{h.customers.join(' · ')}</div>
                        )}
                      </div>
                      {h.reviewScore != null && <span className="shrink-0 text-[13px] font-semibold text-[var(--color-ink)]">{h.reviewScore}%</span>}
                    </div>
                  )
                })}
              </Card>
            )}
            {series.length >= 1 && (
              <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {series.map((s) => (
                    <div key={s.period} className="text-center">
                      <div className="text-[11.5px] text-[var(--color-ink-faint)]">{periodLabel(s.period).split(' ')[0]}</div>
                      <div className="text-base font-semibold text-[var(--color-ink)]">{s.v}%</div>
                    </div>
                  ))}
                </div>
                <Sparkline series={series} />
              </Card>
            )}
          </div>
        ) : (
          <Empty>Your record builds here month by month: sales, scores and reviews.</Empty>
        )}
      </div>

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
                  <div className="text-[11.5px] font-semibold text-[var(--color-ink-faint)]">{k}</div>
                  <div className={`mt-1 text-[22px] font-semibold ${kb.text}`}>{v}%</div>
                  <div className="mt-2"><Bar pct={v} tone={kb.bar} /></div>
                </Card>
              )
            })}
          </div>
        ) : (
          <Empty>Your KPI scores show here once your manager rates them in a review.</Empty>
        )}
      </div>

      {/* Recognition */}
      <div>
        <SectionTitle>Recognition</SectionTitle>
        {achievements.length ? (
          <div className="flex flex-wrap gap-2">
            {achievements.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-warn-bg)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-warn)]">
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
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}><MessageSquare size={18} /></span>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink-soft)]">{feedback}</p>
          </Card>
        ) : (
          <Empty>No feedback shared yet.</Empty>
        )}
      </div>
      </>)}

      {/* Next actions */}
      {tab === 'now' && actions.length > 0 && (
        <div>
          <SectionTitle>Still to do this month</SectionTitle>
          <Card className="p-5">
            <ul className="space-y-2.5">
              {actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-[var(--color-ink)]">
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
