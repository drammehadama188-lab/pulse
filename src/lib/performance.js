// Shared performance logic — used by the Performance overview (PerformanceBoard)
// and the dedicated per-employee page (PerformancePerson). All numbers are real:
// manager-set live scores, locked monthly reviews, and sales — the imported
// sheet up to June 2026, admin from August on. Nothing here samples or invents
// data, and a number that is not known stays null rather than becoming zero.

export const now = new Date()
const pad2 = (n) => String(n).padStart(2, '0')
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const CUR_PERIOD = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
export const periodLabel = (p) => { const [y, m] = String(p).split('-'); return `${MONTH_NAMES[Number(m) - 1] || '?'} ${y}` }
export const fmtDateY = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
export const prevMonth = (period) => { const [y, m] = String(period).split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` }
export const slugify = (name) => name.toLowerCase().replace(/\s+/g, '-')
// Whole days still to come in the current month, today excluded — the month is
// judged when it ends, not while it runs. The Gambia is on UTC, so UTC parts
// are the local date.
export function daysLeftInMonth(d = new Date()) {
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.max(0, Math.round((end - today) / 86400000) - 1)
}

export const RATING_AXES = ['Sales', 'Attendance', 'Communication', 'Customer rating', 'Initiative']
export const ACTION_OPTIONS = ['Bonus approved', 'Promotion recommended', 'Coaching scheduled', 'Public recognition', 'Performance improvement plan', 'Salary review']
export const TARGET_DEFAULT = 90

export function band(score) {
  if (score == null) return { label: 'Not rated', dot: 'bg-gray-300', text: 'text-gray-400', bar: 'bg-gray-200', chip: 'bg-gray-100 text-gray-500' }
  if (score >= 95) return { label: 'Exceptional', dot: 'bg-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-600', chip: 'bg-emerald-100 text-emerald-700' }
  if (score >= 85) return { label: 'Strong', dot: 'bg-green-500', text: 'text-green-600', bar: 'bg-green-500', chip: 'bg-green-100 text-green-700' }
  if (score >= 70) return { label: 'On track', dot: 'bg-blue-500', text: 'text-blue-600', bar: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700' }
  if (score >= 55) return { label: 'Watch', dot: 'bg-amber-500', text: 'text-amber-600', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' }
  return { label: 'Behind', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-500', chip: 'bg-red-100 text-red-700' }
}

export function statusFor(score) {
  if (score == null) return { label: 'Not scored', tone: 'bg-gray-100 text-gray-500' }
  if (score >= 90) return { label: 'Outstanding', tone: 'bg-emerald-100 text-emerald-700' }
  if (score >= 80) return { label: 'Exceeded expectations', tone: 'bg-green-100 text-green-700' }
  if (score >= 70) return { label: 'Met expectations', tone: 'bg-blue-100 text-blue-700' }
  if (score >= 55) return { label: 'Needs improvement', tone: 'bg-amber-100 text-amber-700' }
  return { label: 'Below expectations', tone: 'bg-red-100 text-red-700' }
}

// Attendance colour bands (Adama 1 Jul): the attendance KPI is coloured by the
// ABSOLUTE attendance %, not attainment-vs-target — green ≥95, amber 80–94,
// red <80. Same shape as band() so it drops into the KPI render.
export function attendanceBand(pct) {
  if (pct == null) return { label: 'Not tracked', dot: 'bg-gray-300', text: 'text-gray-400', bar: 'bg-gray-200', chip: 'bg-gray-100 text-gray-500' }
  if (pct >= 95) return { label: 'On target', dot: 'bg-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-600', chip: 'bg-emerald-100 text-emerald-700' }
  if (pct >= 80) return { label: 'Watch', dot: 'bg-amber-500', text: 'text-amber-600', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' }
  return { label: 'Below', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-500', chip: 'bg-red-100 text-red-700' }
}

export function pctChip(pct) {
  if (pct == null) return 'bg-gray-100 text-gray-500'
  if (pct >= 100) return 'bg-emerald-100 text-emerald-700'
  if (pct >= 60) return 'bg-green-100 text-green-700'
  if (pct >= 40) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

// Period switcher: current month is "live", past months are locked reviews,
// quarter/year are computed averages over their real review months.
export function buildPeriods() {
  // Plain labels only (Adama 27 Jun) — no "· Live" / "· Average" suffix; the
  // helper text under the switcher already explains live vs locked vs average.
  const out = [{ id: 'current', kind: 'current', period: CUR_PERIOD, label: periodLabel(CUR_PERIOD) }]
  for (let i = 1; i <= 5; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const p = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; out.push({ id: p, kind: 'month', period: p, label: periodLabel(p) }) }
  const yr = now.getFullYear(), q = Math.floor(now.getMonth() / 3) + 1
  const qMonths = (qq) => [0, 1, 2].map((k) => `${yr}-${pad2((qq - 1) * 3 + 1 + k)}`).filter((p) => p <= CUR_PERIOD)
  out.push({ id: `Q${q}-${yr}`, kind: 'range', label: `Q${q} ${yr}`, months: qMonths(q) })
  if (q > 1) out.push({ id: `Q${q - 1}-${yr}`, kind: 'range', label: `Q${q - 1} ${yr}`, months: qMonths(q - 1) })
  const yMonths = []; for (let m = 0; m <= now.getMonth(); m++) yMonths.push(`${yr}-${pad2(m + 1)}`)
  out.push({ id: `Y-${yr}`, kind: 'range', label: `${yr}`, months: yMonths })
  return out
}

export function reviewScore(reviewsByName, name, period) {
  const r = (reviewsByName[name] || []).find((x) => x.period === period)
  return r ? (r.score == null ? null : Number(r.score)) : null
}

// The standard period picker (Adama 27 Jun — canonical across Pulse): This
// Month / Last Month / This Quarter / This Year / All Time, plus a custom range.
// Maps each preset to the score-resolution kind below.
//  • current — live manager score (this month, not yet locked)
//  • month   — one locked monthly review
//  • range   — average of locked reviews across an explicit list of months
//  • all     — average of every locked review on record
export function buildStandardPeriods() {
  const yr = now.getFullYear(), q = Math.floor(now.getMonth() / 3) + 1
  const qMonths = [0, 1, 2].map((k) => `${yr}-${pad2((q - 1) * 3 + 1 + k)}`).filter((p) => p <= CUR_PERIOD)
  const yMonths = []; for (let m = 0; m <= now.getMonth(); m++) yMonths.push(`${yr}-${pad2(m + 1)}`)
  return [
    { id: 'this-month', label: 'This Month', kind: 'current', period: CUR_PERIOD },
    { id: 'last-month', label: 'Last Month', kind: 'month', period: prevMonth(CUR_PERIOD) },
    { id: 'this-quarter', label: 'This Quarter', kind: 'range', months: qMonths },
    { id: 'this-year', label: 'This Year', kind: 'range', months: yMonths },
    { id: 'all-time', label: 'All Time', kind: 'all' },
  ]
}
export const defaultPeriod = () => buildStandardPeriods()[0]

// Inclusive list of YYYY-MM between two yyyy-mm-dd date-input values.
export function monthsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return []
  const [fy, fm] = fromIso.split('-').map(Number), [ty, tm] = toIso.split('-').map(Number)
  if (fy > ty || (fy === ty && fm > tm)) return []
  const out = []; let y = fy, m = fm
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) { out.push(`${y}-${pad2(m)}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

export function scoreForPeriod(name, p, live, reviewsByName) {
  if (!p) return null
  if (p.kind === 'current') return live[name]?.score ?? null
  if (p.kind === 'month') return reviewScore(reviewsByName, name, p.period)
  if (p.kind === 'all') {
    const vals = (reviewsByName[name] || []).map((r) => (r.score == null ? null : Number(r.score))).filter((v) => v != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const vals = (p.months || []).map((m) => reviewScore(reviewsByName, name, m)).filter((v) => v != null)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

// The target a single month was scored against. The server stamps it on the
// month from Pulse's KPI Targets, so a change of goal applies from the month it
// takes effect and no page carries its own copy. `monthlyTarget` is the old
// sheet-wide number, kept only as the fallback for a month the server did not
// stamp.
export function monthTarget(sales, m) {
  const row = sales?.months?.[m]
  if (row && row.target != null) return Number(row.target) || 0
  return Number(sales?.monthlyTarget) || 0
}

// Real sales for the active period (sum across the period's months).
// 🔑 Revenue can be UNKNOWN — admin months carry the money only since the feed
// started sending it. Unknown stays null so the page prints "—"; summing it as
// zero told the reader a month with sales earned nothing.
export function salesForPeriod(sales, p) {
  if (!sales || !sales.months || !p) return null
  const months = p.kind === 'range' ? (p.months || []) : p.kind === 'all' ? Object.keys(sales.months) : [p.period]
  const pairs = months.map((m) => [m, sales.months[m]]).filter(([, r]) => r)
  if (!pairs.length) return null
  const live = pairs.filter(([, r]) => !r.pending)
  const totalSales = live.reduce((s, [, r]) => s + (r.sales || 0), 0)
  const withRevenue = live.filter(([, r]) => r.revenue != null)
  const revenue = withRevenue.length ? withRevenue.reduce((s, [, r]) => s + (r.revenue || 0), 0) : null
  // Each month brings its own target, so a period spanning a goal change adds
  // up to what was actually asked for rather than one number times a count.
  const targetForPeriod = live.reduce((s, [m]) => s + monthTarget(sales, m), 0)
  return { sales: totalSales, revenue, target: targetForPeriod || null, pending: pairs.some(([, r]) => r.pending) && !live.length }
}

// Real, derived insights for one person — from locked reviews + live score +
// real sales. Never invents; says "not enough history" when it can't.
export function insightsFor(name, live, reviewsByName, sales) {
  const out = []
  const revs = (reviewsByName[name] || []).filter((r) => r.score != null).slice().sort((a, b) => a.period.localeCompare(b.period))
  const series = revs.map((r) => ({ period: r.period, v: Number(r.score) }))
  const liveScore = live[name]?.score
  if (liveScore != null && (!series.length || series[series.length - 1].period !== CUR_PERIOD)) series.push({ period: CUR_PERIOD, v: liveScore })

  if (series.length >= 2) {
    const last = series[series.length - 1], prev = series[series.length - 2]
    const d = last.v - prev.v
    if (d !== 0) out.push({ tone: d > 0 ? 'good' : 'bad', text: `Score ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} pts vs ${periodLabel(prev.period)} (${prev.v}% → ${last.v}%).` })
    let run = 1
    for (let i = series.length - 1; i > 0; i--) { if (series[i].v > series[i - 1].v) run++; else break }
    if (run >= 3) out.push({ tone: 'good', text: `Improved for ${run - 1} consecutive months.` })
  }

  if (sales && sales.months) {
    const recorded = Object.entries(sales.months).filter(([, m]) => !m.pending).sort((a, b) => a[0].localeCompare(b[0]))
    const last = recorded[recorded.length - 1]
    if (last) {
      const [p, m] = last, tgt = monthTarget(sales, p)
      // 🔑 A month still running has not been missed. Saying "missed" on the 3rd
      // judges a month that has 28 days left in it; the honest line is where
      // they stand and how long is left.
      if (tgt && m.sales >= tgt) out.push({ tone: 'good', text: `Hit the sales target in ${periodLabel(p)} (${m.sales}/${tgt}).` })
      else if (tgt && p === CUR_PERIOD) {
        const left = daysLeftInMonth()
        out.push({ tone: left === 0 ? 'bad' : 'muted', text: `${m.sales} of ${tgt} sales this month, ${left} ${left === 1 ? 'day' : 'days'} left.` })
      } else if (tgt) out.push({ tone: 'bad', text: `Missed the sales target in ${periodLabel(p)} (${m.sales}/${tgt}).` })
    }
  }

  if (!out.length) out.push({ tone: 'muted', text: 'Not enough history yet — complete monthly reviews to build the trend and insights.' })
  return out
}

// A sales role is scored on real sales attainment (Adama 27 Jun: "they are her
// real scores"). type Sales or any roster row carrying a sales target.
export function isSalesRole(person) { return !!person && (person.type === 'Sales' || Number(person.target) > 0) }

// Sales attainment for the period = sales ÷ target, capped at 100. This is the
// real, derived score for a sales role when no manual review score is set.
export function salesAttainment(sales, p) {
  const ps = salesForPeriod(sales, p)
  if (!ps || !ps.target) return null
  return Math.min(Math.round((ps.sales / ps.target) * 100), 100)
}

// The headline score actually shown: a manual review/live score wins; otherwise
// a sales role falls back to its real sales attainment. Returns the source too.
export function effectiveScore(manual, person, sales, p) {
  if (manual != null) return { score: manual, source: 'manual' }
  if (isSalesRole(person)) { const s = salesAttainment(sales, p); if (s != null) return { score: s, source: 'sales' } }
  return { score: null, source: null }
}

// Month-over-month change in sales attainment (only meaningful for a single
// month / the current month).
export function salesTrendDelta(sales, p) {
  if (!p || (p.kind !== 'current' && p.kind !== 'month')) return null
  const cur = salesAttainment(sales, p)
  const prev = salesAttainment(sales, { kind: 'month', period: prevMonth(p.period) })
  return cur == null || prev == null ? null : cur - prev
}

// Chronological real score series for the trend chart: locked reviews ascending
// + the live current point if a live score is set.
export function trendSeries(reviews, liveScore) {
  const revs = (reviews || []).filter((r) => r.score != null).slice().sort((a, b) => a.period.localeCompare(b.period)).map((r) => ({ period: r.period, v: Number(r.score) }))
  if (liveScore != null && (!revs.length || revs[revs.length - 1].period !== CUR_PERIOD)) revs.push({ period: CUR_PERIOD, v: liveScore })
  return revs
}

// HOW THE BOARD SLICES THE ROSTER (Adama 29 Aug). Four groups that PARTITION
// the team: everyone is in exactly one, and the four counts add up to the
// roster. 🔒 The tiles and the dropdown on the Performance page set the same
// `group`, so a tile's number is exactly the rows clicking it gives you.
export const PERF_GROUPS = [
  { id: 'performing', label: 'Performing', test: (s) => s != null && s >= 85 },
  { id: 'on-track', label: 'On track', test: (s) => s != null && s >= 70 && s < 85 },
  { id: 'attention', label: 'Needs attention', test: (s) => s != null && s < 70 },
  { id: 'unrated', label: 'Not rated', test: (s) => s == null },
]
export const groupOf = (score) => PERF_GROUPS.find((g) => g.test(score))?.id || 'unrated'

// Where a score came from. Shown on the row so nobody reads a derived number as
// a review that was never written — the "everyone Not rated" confusion.
export const SCORE_SOURCES = [
  { id: 'manual', label: 'Manager review' },
  { id: 'sales', label: 'Sales attainment' },
  { id: 'none', label: 'Not scored' },
]
export const sourceLabel = (s) => SCORE_SOURCES.find((x) => x.id === (s || 'none'))?.label || 'Not scored'
