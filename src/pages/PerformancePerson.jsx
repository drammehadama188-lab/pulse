import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Trophy, TrendingUp, TrendingDown, Minus, AlertTriangle, X, Check,
  Star, Gift, Target, CalendarClock, ClipboardList, ArrowUpRight, Lightbulb, Lock, Plus, ExternalLink,
} from 'lucide-react'
import { team } from '../data/team'
import { api } from '../lib/api.js'
import PeriodPicker from '../components/PeriodPicker.jsx'
import {
  CUR_PERIOD, MONTH_NAMES, periodLabel, fmtDateY, slugify, RATING_AXES, ACTION_OPTIONS,
  band, statusFor, defaultPeriod, scoreForPeriod, salesForPeriod, insightsFor, trendSeries,
  effectiveScore, salesTrendDelta,
} from '../lib/performance.js'

const TABS = [['overview', 'Overview'], ['kpis', 'KPIs'], ['trend', 'Trend'], ['reviews', 'Reviews']]

export default function PerformancePerson() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const person = useMemo(() => team.find((t) => slugify(t.name) === slug), [slug])

  const [tab, setTab] = useState('overview')
  const [period, setPeriod] = useState(defaultPeriod)

  const [live, setLive] = useState({ score: null, note: '', nextReview: '' })
  const [reviews, setReviews] = useState([])
  const [sales, setSales] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [reviewing, setReviewing] = useState(false)
  const [openReview, setOpenReview] = useState(null)

  // Editable live score + note (current period only).
  const [draft, setDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (!person) return
    const n = encodeURIComponent(person.name)
    api(`/employee-profile?name=${n}`).then((d) => {
      const p = d.profile || {}; const raw = p.performanceScore
      const sc = raw === '' || raw == null ? null : Number(raw)
      setLive({ score: sc, note: p.performanceNote || '', nextReview: p.nextReview || '' })
      setDraft(sc == null ? '' : String(sc)); setNoteDraft(p.performanceNote || '')
    }).catch(() => {})
    api(`/reviews?name=${n}`).then((d) => setReviews(d.reviews || [])).catch(() => setReviews([]))
    api(`/agent-sales?name=${n}`).then((d) => setSales(d.sales || null)).catch(() => setSales(null))
    api(`/warnings?agent=${n}`).then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]))
  }, [person?.name])

  if (!person) return <div className="p-8 text-sm text-gray-500">Employee not found. <button onClick={() => navigate('/performance')} className="font-semibold text-[var(--color-brand)] underline">Back to Performance</button></div>

  const liveMap = { [person.name]: live }
  const reviewsMap = { [person.name]: reviews }
  const editable = period.kind === 'current'
  const score = scoreForPeriod(person.name, period, liveMap, reviewsMap)
  // Manual review/live score (what the manager set, if anything).
  const manualScore = editable ? (draft === '' ? null : Number(draft)) : score
  // Headline score: manual wins; a sales role falls back to real sales attainment.
  const { score: effScore, source: effSource } = effectiveScore(manualScore, person, sales, period)
  const b = band(effScore)
  const periodReview = period.kind === 'month' ? reviews.find((r) => r.period === period.period) : null
  const periodStatus = periodReview?.status || statusFor(effScore).label
  const periodSales = salesForPeriod(sales, period)
  const insights = insightsFor(person.name, liveMap, reviewsMap, sales)
  const series = trendSeries(reviews, live.score)
  const target = person.target || sales?.monthlyTarget || null
  const hasCurrentReview = reviews.some((r) => r.period === CUR_PERIOD)
  const initials = person.name.split(' ').map((w) => w[0]).slice(0, 2).join('')

  const prevScore = series.length >= 2 ? series[series.length - 2].v : null
  const delta = effSource === 'sales'
    ? salesTrendDelta(sales, period)
    : (manualScore != null && prevScore != null && period.kind === 'current' ? manualScore - prevScore : null)

  async function saveScore() {
    setSaving(true)
    try {
      await api('/employee-profile', { method: 'PUT', body: { name: person.name, fields: { performanceScore: draft === '' ? '' : String(draft), performanceNote: noteDraft || '' } } })
      setLive((l) => ({ ...l, score: draft === '' ? null : Number(draft), note: noteDraft }))
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800)
    } catch { /* ignore */ }
    setSaving(false)
  }
  function reloadReviews() { api(`/reviews?name=${encodeURIComponent(person.name)}`).then((d) => setReviews(d.reviews || [])).catch(() => {}) }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <button onClick={() => navigate('/performance')} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"><ArrowLeft size={16} /> Back to Performance</button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--color-line)] bg-white p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-xl font-bold text-white">{initials}</div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">{person.name}</h1>
            <p className="text-sm text-gray-500">{person.role} · {person.type}</p>
            <button onClick={() => navigate(`/agents/${slugify(person.name)}`)} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-800"><ExternalLink size={12} /> Full employee profile</button>
          </div>
        </div>
        {/* Period switcher */}
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Score" value={effScore == null ? '—' : `${effScore}%`} accent={b.text}
          sub={<span className="flex items-center gap-1.5"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${b.chip}`}>{b.label}</span>{effSource === 'sales' && <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">from sales</span>}</span>} big />
        <SummaryCard label="Revenue" value={periodSales ? `D${periodSales.revenue.toLocaleString()}` : '—'} accent="text-gray-800" sub={periodSales ? `${periodSales.sales}/${periodSales.target} sales` : 'no sales data'} />
        <SummaryCard label="Status" value={periodStatus} accent={b.text} small />
        <SummaryCard label="Trend" value={delta == null ? '—' : <span className={`inline-flex items-center gap-0.5 ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>{delta > 0 ? <TrendingUp size={20} /> : delta < 0 ? <TrendingDown size={20} /> : <Minus size={20} />}{delta > 0 ? `+${delta}` : delta}</span>} accent="text-gray-800" sub="vs last month" />
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--color-line)]">
        <div className="flex gap-6">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`relative -mb-px border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${tab === id ? 'border-[var(--color-brand)] text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {label}{id === 'reviews' && reviews.length ? <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">{reviews.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Headline score: sales attainment for sales roles, or the manager's
                review/live score. A manual score (slider below) always overrides. */}
            <Card title={`Performance · ${period.label}`}>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">{effSource === 'sales' ? 'Sales score · target attainment' : period.kind === 'range' ? 'Average score' : period.kind === 'current' ? 'Score' : 'Locked score'}</p>
                  <p className={`text-6xl font-extrabold leading-none ${b.text}`}>{effScore == null ? '—' : `${effScore}%`}</p>
                  {effSource === 'sales' && periodSales && <p className="mt-1 text-[11px] text-gray-400">{periodSales.sales}/{periodSales.target} sales · D{periodSales.revenue.toLocaleString()}</p>}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusFor(effScore).tone}`}>{periodStatus}</span>
              </div>
              {editable && (
                <div className="mt-4 border-t border-[var(--color-line-soft)] pt-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Manager score {effSource === 'sales' && <span className="font-normal normal-case text-gray-400">— set to override the sales score</span>}</p>
                  <input type="range" min="0" max="100" value={draft === '' ? 0 : draft} onChange={(e) => setDraft(e.target.value)} className="w-full accent-[var(--color-brand)]" />
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">{draft === '' ? 'No manual score — using the sales score above.' : `Manual score: ${draft}%`}</span>
                    <div className="flex-1" />
                    <input type="number" min="0" max="100" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="—" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" />
                    <button onClick={() => setDraft('')} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Clear</button>
                  </div>
                </div>
              )}
            </Card>

            {/* Real monthly sales + customers — the substance of the page */}
            {sales && <Card title={`Sales by month · ${period.label}`} icon={Trophy}><SalesBreakdown sales={sales} period={period} /></Card>}

            {/* Insights */}
            <Card title="Performance insights" icon={Lightbulb}>
              <ul className="space-y-2">{insights.map((it, i) => <li key={i} className="flex items-start gap-2.5 text-sm"><span className={`mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full ${it.tone === 'good' ? 'bg-emerald-500' : it.tone === 'bad' ? 'bg-red-400' : 'bg-gray-300'}`} /><span className="leading-snug text-gray-700">{it.text}</span></li>)}</ul>
            </Card>

            {/* Manager notes */}
            <Card title="Manager notes">
              {editable ? (
                <>
                  <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="e.g. Strong month — candidate for promotion." className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-gray-400 focus:outline-none" />
                  <div className="mt-3 flex items-center gap-3">
                    <button onClick={saveScore} disabled={saving} className="rounded-full bg-[var(--color-brand)] px-5 py-2.5 text-sm font-bold text-white hover:brightness-95 disabled:opacity-50">{saving ? 'Saving…' : 'Save score & notes'}</button>
                    {savedFlash && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check size={15} /> Saved</span>}
                  </div>
                </>
              ) : <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{periodReview?.notes || 'No notes recorded for this period.'}</p>}
            </Card>
          </div>

          {/* Right rail: actions + warnings */}
          <div className="space-y-6">
            <RecommendedActions score={effScore} warnings={warnings} />
            <Card title="Warnings">
              {warnings.length === 0 ? <p className="text-sm text-gray-500">No active warnings.</p>
                : <div className="space-y-2">{warnings.map((w, i) => <div key={i} className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{w.reason || w.note || 'Warning'}</span></div>)}</div>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'kpis' && (
        <div className="max-w-2xl space-y-4">
          {periodSales && periodSales.target != null && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5">
              <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><Trophy size={15} /> Sales</span><span className="text-lg font-extrabold text-gray-900">{periodSales.sales}/{periodSales.target}</span></div>
              <div className="h-3 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(periodSales.target ? (periodSales.sales / periodSales.target) * 100 : 0, 100)}%` }} /></div>
              <p className="mt-2 text-xs text-gray-500">D{periodSales.revenue.toLocaleString()} revenue{periodSales.pending ? ' · not entered yet' : ''}</p>
            </div>
          )}
          {sales && <Card title={`Sales by month · ${period.label}`} icon={Trophy}><SalesBreakdown sales={sales} period={period} /></Card>}
          <Card title={periodReview ? `Reviewed KPIs · ${period.label}` : 'Current KPI'}>
            {periodReview?.kpis?.length > 0 ? (
              <div className="space-y-2">{periodReview.kpis.map((k, i) => <div key={i} className="flex items-center gap-2.5 text-sm">{k.done ? <Check size={16} className="text-emerald-500" /> : <X size={16} className="text-red-400" />}<span className={k.done ? 'text-gray-800' : 'text-gray-400'}>{k.label}</span></div>)}</div>
            ) : (
              <div>
                <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{person.kpi || person.coreResponsibility || 'No KPI set.'}</p>
                {period.kind === 'current' && <p className="mt-2 text-xs text-gray-400">Tick off KPIs as done when you complete this month's review (Reviews tab).</p>}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'trend' && (
        <Card title="Performance trend">
          {series.length >= 2 ? <BigTrend series={series} />
            : <div className="py-8 text-center"><p className="text-sm text-gray-500">Not enough history yet.</p><p className="mt-1 text-xs text-gray-400">The trend builds as you complete and lock monthly reviews. {series.length === 1 ? `So far: ${series[0].v}% in ${periodLabel(series[0].period)}.` : ''}</p></div>}
        </Card>
      )}

      {tab === 'reviews' && (
        <ReviewsTab person={person} reviews={reviews} hasCurrent={hasCurrentReview} draft={draft} noteDraft={noteDraft} warningsCount={warnings.length}
          onComplete={() => setReviewing(true)} onOpen={setOpenReview} />
      )}

      {reviewing && <ReviewForm person={person} defaultScore={draft} defaultNotes={noteDraft} warningsCount={warnings.length} onClose={() => setReviewing(false)} onSaved={() => { setReviewing(false); reloadReviews() }} />}
      {openReview && <ReviewDetail review={openReview} onClose={() => setOpenReview(null)} />}
    </div>
  )
}

// Real month-by-month sales for the active period — counts, revenue and the
// actual customers closed. This is the substance of a sales rep's performance.
function SalesBreakdown({ sales, period }) {
  if (!sales || !sales.months) return null
  const target = sales.monthlyTarget || 0
  const all = Object.keys(sales.months)
  let months = period.kind === 'current' || period.kind === 'month' ? [period.period]
    : period.kind === 'all' ? all : (period.months || [])
  months = months.filter((m) => sales.months[m]).sort()
  if (!months.length) return <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-500">No sales recorded for this period.</p>
  const live = months.filter((m) => !sales.months[m].pending)
  const totSales = live.reduce((s, m) => s + (sales.months[m].sales || 0), 0)
  const totRev = live.reduce((s, m) => s + (sales.months[m].revenue || 0), 0)
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-800">{totSales} sale{totSales === 1 ? '' : 's'}</span>
        <span className="text-sm font-bold text-gray-900">D{totRev.toLocaleString()} <span className="font-normal text-gray-400">revenue</span></span>
      </div>
      <div className="space-y-2.5">
        {months.map((m) => {
          const r = sales.months[m]
          const pct = target ? Math.min((r.sales / target) * 100, 100) : 0
          const custs = r.customers || []
          return (
            <div key={m} className="rounded-xl border border-[var(--color-line)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">{periodLabel(m)}</span>
                <span className="text-sm font-bold text-gray-700">{r.pending ? <span className="text-[11px] font-medium text-amber-500">not entered yet</span> : `${r.sales}/${target}`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {custs.length ? custs.map((c, i) => <span key={i} className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{c}</span>)
                    : <span className="text-[11px] text-gray-400">{r.pending ? '—' : 'No sales this month'}</span>}
                </div>
                <span className="shrink-0 text-xs font-semibold text-gray-700">D{(r.revenue || 0).toLocaleString()}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, accent = 'text-gray-900', big, small }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 truncate font-extrabold ${big ? 'text-3xl' : small ? 'text-base' : 'text-2xl'} ${accent}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-gray-500">{sub}</p> : <p className="mt-1 text-xs">&nbsp;</p>}
    </div>
  )
}

function Card({ title, icon: Icon, children }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
      <div className="mb-3 flex items-center gap-2">{Icon && <Icon size={15} className="text-gray-400" />}<h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">{title}</h3></div>
      {children}
    </div>
  )
}

function RecommendedActions({ score, warnings }) {
  const s = score
  const recs = []
  if (s == null) recs.push({ icon: ClipboardList, label: 'Set a score', tone: 'gray' })
  if (s != null && s >= 95) { recs.push({ icon: Star, label: 'Public recognition', tone: 'emerald' }); recs.push({ icon: Gift, label: 'Recommend bonus', tone: 'emerald' }); recs.push({ icon: ArrowUpRight, label: 'Promotion candidate', tone: 'blue' }) }
  else if (s != null && s >= 85) recs.push({ icon: Gift, label: 'Bonus candidate', tone: 'blue' })
  if (s != null && s < 55) { recs.push({ icon: CalendarClock, label: 'Schedule coaching', tone: 'amber' }); recs.push({ icon: Target, label: 'Weekly check-in', tone: 'amber' }); recs.push({ icon: AlertTriangle, label: 'Performance improvement plan', tone: 'red' }) }
  else if (s != null && s < 70) recs.push({ icon: Target, label: 'Set clearer goals', tone: 'amber' })
  if (warnings.length) recs.push({ icon: AlertTriangle, label: 'Address warnings', tone: 'red' })
  const RTONE = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700', gray: 'bg-gray-100 text-gray-600' }
  return (
    <Card title="Recommended actions">
      <div className="flex flex-wrap gap-2">{recs.map((r, i) => <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${RTONE[r.tone]}`}><r.icon size={13} />{r.label}</span>)}</div>
      <p className="mt-2 text-[11px] text-gray-400">Suggested from score + warnings.</p>
    </Card>
  )
}

// Larger trend chart for the dedicated Trend tab.
function BigTrend({ series }) {
  const W = 640, H = 220, padX = 32, padY = 24
  const vals = series.map((s) => s.v)
  const min = Math.max(0, Math.min(...vals) - 6), max = Math.min(100, Math.max(...vals) + 6)
  const x = (i) => padX + (i * (W - padX * 2)) / Math.max(series.length - 1, 1)
  const y = (v) => H - padY - ((v - min) / (max - min || 1)) * (H - padY * 2)
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ')
  const area = `${d} L${x(series.length - 1)},${H - padY} L${x(0)},${H - padY} Z`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
        {[0, 0.5, 1].map((g) => { const yy = padY + g * (H - padY * 2); return <line key={g} x1={padX} x2={W - padX} y1={yy} y2={yy} stroke="#eef0f4" strokeWidth="1" /> })}
        <path d={area} fill="rgba(214,41,79,0.08)" />
        <path d={d} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((s, i) => <g key={i}><circle cx={x(i)} cy={y(s.v)} r="4" fill="var(--color-brand)" /><text x={x(i)} y={y(s.v) - 10} textAnchor="middle" className="fill-gray-700 text-[12px] font-semibold">{s.v}</text><text x={x(i)} y={H - 6} textAnchor="middle" className="fill-gray-400 text-[11px]">{MONTH_NAMES[Number(String(s.period).split('-')[1]) - 1]}</text></g>)}
      </svg>
    </div>
  )
}

function ReviewsTab({ reviews, hasCurrent, onComplete, onOpen }) {
  const yr = new Date().getFullYear()
  const pad2 = (n) => String(n).padStart(2, '0')
  const reviewed = new Set((reviews || []).map((r) => r.period))
  const curMonth = new Date().getMonth()
  return (
    <div className="max-w-3xl space-y-6">
      <Card title={`Review schedule · ${yr}`}>
        <div className="grid grid-cols-6 gap-2">
          {MONTH_NAMES.map((m, i) => {
            const p = `${yr}-${pad2(i + 1)}`
            const done = reviewed.has(p), isCur = p === CUR_PERIOD, future = i > curMonth
            return <div key={m} className={`rounded-lg py-2 text-center text-xs font-medium ${done ? 'bg-emerald-100 text-emerald-700' : isCur ? 'bg-amber-100 text-amber-700' : future ? 'bg-gray-50 text-gray-300' : 'bg-red-50 text-red-500'}`} title={done ? 'Reviewed' : isCur ? 'Due now' : future ? 'Upcoming' : 'Missing'}>{m}{done ? ' ✓' : ''}</div>
          })}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Green = completed · amber = due now · red = missing.</p>
      </Card>

      {!hasCurrent
        ? <button onClick={onComplete} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-4 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50"><Plus size={16} /> Complete {periodLabel(CUR_PERIOD)} review</button>
        : <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><Check size={16} />{periodLabel(CUR_PERIOD)} review is locked.</div>}

      <div>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-gray-500">Review history</p>
        {reviews.length === 0 ? <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No reviews yet. Completing a monthly review creates a permanent, locked record here — your audit trail.</p>
          : <div className="space-y-2">{reviews.slice().sort((a, b) => (b.period || '').localeCompare(a.period || '')).map((r) => { const st = statusFor(r.score); const bb = band(r.score); return (
            <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-white px-4 py-3 text-left hover:border-gray-300">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-sm font-bold text-gray-900">{periodLabel(r.period)}</span><Lock size={11} className="text-gray-300" /></div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400"><span className={`rounded-full px-2 py-0.5 font-medium ${st.tone}`}>{r.status || st.label}</span><span>· {r.manager}</span><span>· {fmtDateY(r.completedAt)}</span></div>
              </div>
              <span className={`text-xl font-extrabold ${bb.text}`}>{r.score == null ? '—' : `${r.score}%`}</span>
            </button>
          ) })}</div>}
      </div>
    </div>
  )
}

function ReviewDetail({ review: r, onClose }) {
  const st = statusFor(r.score), bb = band(r.score)
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-4"><button onClick={onClose} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ArrowLeft size={18} /></button><h3 className="font-semibold text-gray-900">{periodLabel(r.period)} review</h3><span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"><Lock size={11} /> Locked</span></div>
        <div className="space-y-6 p-5">
          <div className="flex items-end justify-between">
            <div><p className="text-xs uppercase tracking-wide text-gray-400">Overall score</p><p className={`text-5xl font-extrabold ${bb.text}`}>{r.score == null ? '—' : `${r.score}%`}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${st.tone}`}>{r.status || st.label}</span></div>
            <div className="text-right text-xs text-gray-500"><p>Manager</p><p className="font-semibold text-gray-700">{r.manager}</p><p className="mt-1">Completed</p><p className="font-semibold text-gray-700">{fmtDateY(r.completedAt)}</p></div>
          </div>
          {r.kpis?.length > 0 && <Section title="KPI"><div className="space-y-1.5">{r.kpis.map((k, i) => <div key={i} className="flex items-center gap-2 text-sm">{k.done ? <Check size={15} className="text-emerald-500" /> : <X size={15} className="text-red-400" />}<span className={k.done ? 'text-gray-700' : 'text-gray-400'}>{k.label}</span></div>)}</div></Section>}
          {Object.keys(r.ratings || {}).length > 0 && <Section title="Ratings"><div className="space-y-2">{Object.entries(r.ratings).map(([k, v]) => <div key={k}><div className="mb-0.5 flex justify-between text-xs"><span className="text-gray-600">{k}</span><span className="font-semibold text-gray-700">{v}%</span></div><div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${Number(v) || 0}%` }} /></div></div>)}</div></Section>}
          {r.achievements?.length > 0 && <Section title="Achievements"><div className="flex flex-wrap gap-1.5">{r.achievements.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><Trophy size={11} />{a}</span>)}</div></Section>}
          <Section title="Warnings"><p className="text-sm text-gray-600">{r.warningsCount ? `${r.warningsCount} active at review time` : 'None'}</p></Section>
          {r.notes && <Section title="Manager notes"><p className="whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{r.notes}</p></Section>}
          {r.actions?.length > 0 && <Section title="Actions taken"><div className="space-y-1.5">{r.actions.map((a, i) => <div key={i} className="flex items-center gap-2 text-sm text-gray-700"><Check size={15} className="text-emerald-500" />{a}</div>)}</div></Section>}
        </div>
      </div>
    </div>
  )
}

function ReviewForm({ person, defaultScore, defaultNotes, warningsCount, onClose, onSaved }) {
  const [score, setScore] = useState(defaultScore || '')
  const [statusLabel, setStatusLabel] = useState('')
  const [ratings, setRatings] = useState(() => Object.fromEntries(RATING_AXES.map((a) => [a, ''])))
  const [kpis, setKpis] = useState(() => [{ label: person.kpi || person.coreResponsibility || '', done: false }].filter((k) => k.label))
  const [kpiInput, setKpiInput] = useState('')
  const [achievements, setAchievements] = useState([])
  const [achInput, setAchInput] = useState('')
  const [actions, setActions] = useState([])
  const [notes, setNotes] = useState(defaultNotes || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const effectiveStatus = statusLabel || statusFor(score === '' ? null : Number(score)).label

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api('/reviews', { method: 'POST', body: {
        name: person.name, period: CUR_PERIOD, score: score === '' ? '' : Number(score), status: effectiveStatus,
        ratings: Object.fromEntries(Object.entries(ratings).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        kpis, achievements, actions, notes, warningsCount,
      } })
      onSaved()
    } catch (e) { setErr(e?.message || 'Could not save. A review for this month may already be locked.'); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-4"><button onClick={onClose} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ArrowLeft size={18} /></button><h3 className="font-semibold text-gray-900">Complete {periodLabel(CUR_PERIOD)} review</h3></div>
        <div className="space-y-5 p-5">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Once saved, this review is <b>locked permanently</b> as part of {person.name.split(' ')[0]}'s record. It cannot be edited.</p>
          <Field label="Overall score"><div className="flex items-center gap-3"><input type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-lg font-bold" placeholder="0–100" /><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusFor(score === '' ? null : Number(score)).tone}`}>{effectiveStatus}</span></div></Field>
          <Field label="Status (override)"><select value={statusLabel} onChange={(e) => setStatusLabel(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="">Auto from score ({statusFor(score === '' ? null : Number(score)).label})</option>{['Outstanding', 'Exceeded expectations', 'Met expectations', 'Needs improvement', 'Below expectations'].map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
          <Field label="Ratings (manager-entered)"><div className="space-y-2">{RATING_AXES.map((a) => <div key={a} className="flex items-center gap-3"><span className="w-32 shrink-0 text-sm text-gray-600">{a}</span><input type="number" min="0" max="100" value={ratings[a]} onChange={(e) => setRatings((r) => ({ ...r, [a]: e.target.value }))} placeholder="—" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><span className="text-xs text-gray-400">%</span></div>)}</div></Field>
          <Field label="KPI checklist"><div className="space-y-1.5">{kpis.map((k, i) => <div key={i} className="flex items-center gap-2"><button onClick={() => setKpis((ks) => ks.map((x, j) => j === i ? { ...x, done: !x.done } : x))} className={`flex h-5 w-5 items-center justify-center rounded border ${k.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300'}`}>{k.done && <Check size={12} />}</button><span className="flex-1 text-sm text-gray-700">{k.label}</span><button onClick={() => setKpis((ks) => ks.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-400"><X size={14} /></button></div>)}<div className="flex gap-2"><input value={kpiInput} onChange={(e) => setKpiInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && kpiInput.trim()) { setKpis((ks) => [...ks, { label: kpiInput.trim(), done: false }]); setKpiInput('') } }} placeholder="Add a KPI…" className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><button onClick={() => { if (kpiInput.trim()) { setKpis((ks) => [...ks, { label: kpiInput.trim(), done: false }]); setKpiInput('') } }} className="rounded-lg bg-gray-100 px-3 text-sm">Add</button></div></div></Field>
          <Field label="Achievements"><div className="mb-1.5 flex flex-wrap gap-1.5">{achievements.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{a}<button onClick={() => setAchievements((xs) => xs.filter((_, j) => j !== i))}><X size={11} /></button></span>)}</div><div className="flex gap-2"><input value={achInput} onChange={(e) => setAchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && achInput.trim()) { setAchievements((xs) => [...xs, achInput.trim()]); setAchInput('') } }} placeholder="e.g. Employee of the month" className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><button onClick={() => { if (achInput.trim()) { setAchievements((xs) => [...xs, achInput.trim()]); setAchInput('') } }} className="rounded-lg bg-gray-100 px-3 text-sm">Add</button></div></Field>
          <Field label="Actions taken"><div className="flex flex-wrap gap-1.5">{ACTION_OPTIONS.map((o) => { const on = actions.includes(o); return <button key={o} onClick={() => setActions((xs) => on ? xs.filter((x) => x !== o) : [...xs, o])} className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{o}</button> })}</div></Field>
          <Field label="Warnings at review time"><p className="text-sm text-gray-600">{warningsCount ? `${warningsCount} active` : 'None'} <span className="text-[11px] text-gray-400">(from live record)</span></p></Field>
          <Field label="Manager notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 p-3 text-sm" placeholder="Summary of the month…" /></Field>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        </div>
        <div className="sticky bottom-0 flex gap-2 border-t border-gray-100 bg-white px-5 py-4">
          <button onClick={onClose} className="rounded-full border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 rounded-full bg-[var(--color-brand)] py-3 text-base font-bold text-white hover:brightness-95 disabled:opacity-50">{busy ? 'Locking…' : 'Lock review'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) { return <div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">{label}</p>{children}</div> }
function Section({ title, children }) { return <div><p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-gray-500">{title}</p>{children}</div> }
