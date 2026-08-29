// THE PERFORMANCE MODEL — the one Adama drew on 29 Aug 2026.
//
// Overall performance is CALCULATED from three sources. Nobody types it:
//   • Work KPIs      (from Admin)  60%
//   • Attendance     (from Pulse)  15%
//   • Manager review (assessment)  25%
//
// 🔒 "Managers provide assessment and feedback — they do not override factual
// results." A manager's number is a QUARTER of the score, not the score. The
// old model let a hand-typed number replace everything.
//
// This file is shared by the server (which computes the numbers) and the pages
// (which draw them), so a weight or a band cannot mean two things in one
// product. It is pure: no fetches, no storage, no Express.

export const PERF_WEIGHTS = { work: 60, attendance: 15, manager: 25 }

export const PERF_SOURCES = [
  { key: 'work', label: 'Work KPIs', from: 'from Admin' },
  { key: 'attendance', label: 'Attendance', from: 'from Pulse' },
  { key: 'manager', label: 'Manager assessment', from: 'assessment' },
]

// 🔒 A component that cannot be measured is ABSENT, never zero. The weights of
// the components that DO have a number are renormalised between them, so an
// unwritten review does not read as a manager scoring somebody nothing. If
// nothing can be measured the person is "Not yet scored" — an honest blank,
// which is what the design shows for a new starter.
export function overallPerformance(parts) {
  const present = Object.entries(PERF_WEIGHTS)
    .map(([key, weight]) => ({ key, weight, pct: parts?.[key] == null ? null : Number(parts[key]) }))
    .filter((p) => p.pct != null && Number.isFinite(p.pct))
  const totalWeight = present.reduce((s, p) => s + p.weight, 0)
  if (!totalWeight) return null
  return Math.round(present.reduce((s, p) => s + p.pct * p.weight, 0) / totalWeight)
}

// How far a single KPI got towards its target, 0–100. Over-achievement counts
// as met, not as credit that hides a miss elsewhere.
export function kpiAttainment(k) {
  if (!k || k.actual == null || k.target == null || Number(k.target) <= 0) return null
  return Math.min(100, Math.round((Number(k.actual) / Number(k.target)) * 100))
}

// The Work-KPI component: weighted attainment across the KPIs Admin can
// actually answer for. 🔒 The denominator is what is MEASURED, so "2 of 5
// targets" never counts a KPI nothing feeds as a miss. What is unmeasured is
// named, so the reader can see why the denominator is what it is.
export function workKpiScore(scorecard) {
  const kpis = scorecard?.kpis || []
  if (!kpis.length) return null
  const measured = kpis.filter((k) => kpiAttainment(k) != null)
  const unmeasured = kpis.filter((k) => kpiAttainment(k) == null).map((k) => k.label)
  if (!measured.length) return { pct: null, met: 0, measured: 0, total: kpis.length, unmeasured }
  const w = measured.reduce((s, k) => s + (Number(k.weight) || 0), 0)
  const pct = w
    ? Math.round(measured.reduce((s, k) => s + kpiAttainment(k) * (Number(k.weight) || 0), 0) / w)
    : Math.round(measured.reduce((s, k) => s + kpiAttainment(k), 0) / measured.length)
  return {
    pct,
    met: measured.filter((k) => Number(k.actual) >= Number(k.target)).length,
    measured: measured.length,
    total: kpis.length,
    unmeasured,
  }
}

// 🔒 Only a LOCKED review counts as the manager's assessment. A number still
// being typed on somebody's profile is a draft, and a draft must not move a
// score anybody is judged on. No review for the month = "Not reviewed", and the
// component is simply absent from the calculation.
export const RATING_AXES = ['Sales', 'Attendance', 'Communication', 'Customer rating', 'Initiative']
// ⚠️ A rating axis is a PERCENTAGE, 0–100 — that is what the review form has
// always saved and what is already on disk. Reading them as 1–5 stars and
// multiplying by 20 turned an 80 into 1600%. Stars are only how a percentage is
// DRAWN (five of them, one per 20 points); they are never how it is stored.
export function managerAssessment(reviewList, month) {
  const rev = (reviewList || []).find((r) => r.period === month)
  if (!rev) return { reviewed: false, pct: null, stars: null, at: null, review: null }
  const axes = RATING_AXES
    .map((a) => Number(rev.ratings?.[a]))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.min(100, n))
  // A review saved with an overall score and no axes still counts.
  const pct = axes.length
    ? Math.round(axes.reduce((s, n) => s + n, 0) / axes.length)
    : (rev.score == null ? null : Math.min(100, Number(rev.score)))
  return { reviewed: true, pct, stars: pct == null ? null : Math.round(pct / 20), at: rev.completedAt || null, review: rev }
}

// The chip on the row. 🔑 Coarser than the score guide on purpose: the guide
// colours the NUMBER, this answers "does this person need me today?"
export const PERF_STATUS = {
  'on-track': 'On track',
  'needs-attention': 'Needs attention',
  'not-scored': 'Not yet scored',
}
export function perfStatus(pct) {
  if (pct == null) return 'not-scored'
  return pct >= 70 ? 'on-track' : 'needs-attention'
}

// The score guide printed under the summary: what the NUMBER means.
export const SCORE_GUIDE = [
  { id: 'excellent', label: 'Excellent', min: 90 },
  { id: 'good', label: 'Good', min: 70 },
  { id: 'attention', label: 'Needs attention', min: 50 },
  { id: 'poor', label: 'Poor', min: 0 },
]
export const scoreGrade = (pct) => (pct == null ? null : SCORE_GUIDE.find((g) => pct >= g.min) || SCORE_GUIDE[SCORE_GUIDE.length - 1])

export const prevMonthKey = (ym) => {
  const [y, m] = String(ym).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
