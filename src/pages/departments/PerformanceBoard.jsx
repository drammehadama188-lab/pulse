import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Trophy, TrendingUp, TrendingDown, Minus, AlertTriangle, X, Search,
  Award, Star, Gift, FileText, MessageSquare, ChevronRight, Target,
  CalendarClock, PartyPopper, ClipboardList, ArrowUpRight, Sparkles, CheckCircle2,
} from 'lucide-react'
import { api } from '../../lib/api.js'

// Performance board — a manager's operating system.
//
// DATA HONESTY (Adama's "no fake metrics" rule):
//  • REAL: roster (team.js), warnings, KPI text, the manager-set SCORE + notes
//    (persisted to /api/employee-profile), department averages (from scores),
//    and the "Today's Priorities" items derived from contract dates / join dates
//    / scores / warnings.
//  • SAMPLE (badged): trends, monthly history, radar axes, attendance, customer
//    rating, sales counts, goals, and insights drawn from them — generated
//    deterministically per person so the UI is stable. Each lights up for real
//    as its data source is built.

const now = new Date()
const MS_DAY = 86400000
const daysUntil = (iso) => { const d = new Date(iso); return isNaN(d) ? null : Math.ceil((d - now) / MS_DAY) }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function lastMonths(n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(MONTH_NAMES[d.getMonth()]) }
  return out
}
function joinedDate(joined) { const d = new Date(`${joined} 1`); return isNaN(d) ? null : d }

// Stable pseudo-number from a name (no Math.random → UI doesn't jump on render).
function seed(name, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967295
}
const sampleInt = (name, salt, min, max) => Math.round(min + seed(name, salt) * (max - min))
// Deterministic, gently-rising 6-month sample series ending near `end`.
function sampleSeries(name, end) {
  const start = Math.max(40, (end ?? 70) - sampleInt(name, 3, 8, 28))
  return lastMonths(6).map((m, i) => ({ m, v: Math.round(start + ((end ?? 70) - start) * (i / 5) + (seed(name, i + 20) * 8 - 4)) }))
}

function band(score) {
  if (score == null) return { label: 'Not rated', dot: 'bg-gray-300', text: 'text-gray-400', bar: 'bg-gray-200', chip: 'bg-gray-100 text-gray-500' }
  if (score >= 95) return { label: 'Exceptional', dot: 'bg-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-600', chip: 'bg-emerald-100 text-emerald-700' }
  if (score >= 85) return { label: 'Strong', dot: 'bg-green-500', text: 'text-green-600', bar: 'bg-green-500', chip: 'bg-green-100 text-green-700' }
  if (score >= 70) return { label: 'On track', dot: 'bg-blue-500', text: 'text-blue-600', bar: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700' }
  if (score >= 55) return { label: 'Watch', dot: 'bg-amber-500', text: 'text-amber-600', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' }
  return { label: 'Behind', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-500', chip: 'bg-red-100 text-red-700' }
}
const MEDALS = ['🥇', '🥈', '🥉']

function SampleTag() {
  return (
    <span className="inline-flex items-center rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-500 ring-1 ring-violet-200" title="Sample data — no live source yet">Sample</span>
  )
}
function Trend({ delta, size = 13 }) {
  if (delta == null) return <Minus size={size} className="text-gray-300" />
  if (delta > 0) return <span className="inline-flex items-center text-emerald-600"><TrendingUp size={size} />{delta ? `+${delta}` : ''}</span>
  if (delta < 0) return <span className="inline-flex items-center text-red-500"><TrendingDown size={size} />{delta}</span>
  return <Minus size={size} className="text-gray-300" />
}

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'Sales', label: 'Sales' },
  { id: 'Customer Service', label: 'Customer Service' }, { id: 'Operations', label: 'Operations' },
  { id: 'top', label: 'Above 90' }, { id: 'low', label: 'Below 60' },
  { id: 'review', label: 'Needs review' }, { id: 'new', label: 'New / Probation' },
]

export default function PerformanceBoard({ team = [], warningsByAgent = {} }) {
  const navigate = useNavigate()
  const roster = useMemo(() => team.filter((t) => t.status !== 'maternity'), [team])
  const [scores, setScores] = useState({})
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [openName, setOpenName] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all(roster.map((t) =>
      api(`/employee-profile?name=${encodeURIComponent(t.name)}`).then((d) => ({ name: t.name, p: d.profile || {} })).catch(() => ({ name: t.name, p: {} }))
    )).then((rows) => {
      if (!alive) return
      const next = {}
      for (const { name, p } of rows) {
        const raw = p.performanceScore
        next[name] = { score: raw === '' || raw == null ? null : Number(raw), note: p.performanceNote || '', nextReview: p.nextReview || '' }
      }
      setScores(next)
    })
    return () => { alive = false }
  }, [roster])

  const scoreOf = (name) => scores[name]?.score ?? null
  const trendOf = (name) => { const s = scoreOf(name); return s == null ? null : (sampleInt(name, 5, 0, 12) - 4) } // sample ±

  const ranked = useMemo(() =>
    roster.map((t) => ({ t, score: scoreOf(t.name) })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    [roster, scores])

  const rated = ranked.filter((r) => r.score != null)
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.score, 0) / rated.length) : null
  const top = rated[0]
  const needs = rated.length ? rated[rated.length - 1] : null

  // Department averages — REAL (from manager-set scores).
  const depts = useMemo(() => {
    const groups = {}
    roster.forEach((t) => { const k = t.type || 'Other'; (groups[k] = groups[k] || []).push(scoreOf(t.name)) })
    return Object.entries(groups).map(([name, arr]) => {
      const r = arr.filter((x) => x != null)
      return { name, avg: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null, n: arr.length }
    }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
  }, [roster, scores])

  // Today's Priorities — REAL, derived from live roster data + scores + warnings.
  const priorities = useMemo(() => {
    const items = []
    roster.forEach((t) => {
      const d = t.contractEnd ? daysUntil(t.contractEnd) : null
      if (d != null && d >= 0 && d <= 30) items.push({ tone: 'blue', icon: CalendarClock, text: `${t.name}'s contract renews in ${d} day${d === 1 ? '' : 's'}.`, name: t.name, order: d })
    })
    roster.forEach((t) => {
      const jd = joinedDate(t.joined)
      if (jd && jd.getMonth() === now.getMonth()) { const yrs = now.getFullYear() - jd.getFullYear(); if (yrs >= 1) items.push({ tone: 'green', icon: PartyPopper, text: `${t.name}'s ${yrs}-year work anniversary is this month.`, name: t.name, order: 50 }) }
    })
    ranked.forEach(({ t, score }) => { if (score == null) items.push({ tone: 'gray', icon: ClipboardList, text: `${t.name} has no score yet — set one.`, name: t.name, order: 10 }) })
    ranked.forEach(({ t, score }) => { if (score != null && score < 55) items.push({ tone: 'red', icon: AlertTriangle, text: `${t.name} is behind (${score}%) — needs coaching.`, name: t.name, order: 5 }) })
    Object.entries(warningsByAgent).forEach(([name, ws]) => { if (ws.length) items.push({ tone: 'amber', icon: AlertTriangle, text: `${name} has ${ws.length} active warning${ws.length > 1 ? 's' : ''}.`, name, order: 8 }) })
    ranked.forEach(({ t, score }) => { if (score != null && score >= 95) items.push({ tone: 'emerald', icon: Star, text: `${t.name} is exceeding expectations (${score}%) — recognise them.`, name: t.name, order: 40 }) })
    return items.sort((a, b) => a.order - b.order).slice(0, 6)
  }, [roster, ranked, warningsByAgent, scores])

  const filtered = ranked.filter(({ t, score }) => {
    if (q && !t.name.toLowerCase().includes(q.toLowerCase())) return false
    switch (filter) {
      case 'all': return true
      case 'top': return score != null && score >= 90
      case 'low': return score != null && score < 60
      case 'review': return (t.nextAction === 'review' || t.nextAction === 'warning') || (warningsByAgent[t.name]?.length || 0) > 0 || score == null
      case 'new': return t.status === 'probation' || t.status === 'training'
      default: return t.type === filter
    }
  })

  async function saveScore(name, score, note) {
    setScores((s) => ({ ...s, [name]: { ...(s[name] || {}), score: score === '' ? null : Number(score), note } }))
    try { await api('/employee-profile', { method: 'PUT', body: { name, fields: { performanceScore: score === '' ? '' : String(score), performanceNote: note || '' } } }) } catch { /* optimistic */ }
  }

  const openPerson = openName ? roster.find((t) => t.name === openName) : null
  const TONE = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', emerald: 'bg-emerald-50 text-emerald-700', gray: 'bg-gray-50 text-gray-600' }

  return (
    <div className="space-y-6">
      {/* ── Today's Priorities ─────────────────────────────────────────── */}
      {priorities.length > 0 && (
        <div className="rounded-3xl border border-gray-100 bg-white p-5">
          <div className="mb-3 flex items-center gap-2"><Sparkles size={17} className="text-amber-500" /><h3 className="text-base font-semibold text-gray-900">Today's priorities</h3></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {priorities.map((p, i) => (
              <button key={i} onClick={() => p.name && setOpenName(p.name)} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${TONE[p.tone]} hover:brightness-95`}>
                <p.icon size={15} className="mt-0.5 shrink-0" /><span className="leading-snug">{p.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Health tiles ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Performance Health" value={avg == null ? '—' : `${avg}%`} sub={avg == null ? `${rated.length}/${roster.length} rated` : <span className="inline-flex items-center gap-1 text-emerald-600">+6% <SampleTag /></span>} accent={band(avg).text} />
        <Tile label="Top Performer" value={top ? top.t.name.split(' ')[0] : '—'} sub={top ? `${top.score}%` : 'rate the team'} accent="text-emerald-700" icon={Trophy} onClick={top && (() => setOpenName(top.t.name))} />
        <Tile label="Needs Coaching" value={needs ? needs.t.name.split(' ')[0] : '—'} sub={needs ? `${needs.score}%` : '—'} accent="text-red-600" icon={AlertTriangle} onClick={needs && (() => setOpenName(needs.t.name))} />
        <Tile label="Goals" value="18 / 24" sub={<SampleTag />} accent="text-blue-600" icon={CheckCircle2} />
        <Tile label="Team Rating" value="4.6 / 5" sub={<SampleTag />} accent="text-blue-600" icon={Star} />
        <Tile label="Attendance" value="96%" sub={<SampleTag />} accent="text-blue-600" icon={CalendarClock} />
      </div>

      {/* ── Department comparison (REAL avgs) ──────────────────────────── */}
      <div className="rounded-3xl border border-gray-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Department comparison</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {depts.map((d) => { const b = band(d.avg); return (
            <div key={d.name} className="rounded-2xl bg-gray-50 p-4">
              <div className="flex items-baseline justify-between"><span className="text-sm font-medium text-gray-700">{d.name}</span><span className={`text-xl font-bold ${b.text}`}>{d.avg == null ? '—' : `${d.avg}%`}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full ${b.bar}`} style={{ width: `${d.avg ?? 0}%` }} /></div>
              <p className="mt-1.5 text-xs text-gray-400">{d.n} {d.n === 1 ? 'person' : 'people'}</p>
            </div>
          ) })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Leaderboard (with the "why") ─────────────────────────────── */}
        <div className="rounded-3xl border border-gray-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2"><Trophy size={18} className="text-amber-500" /><h3 className="text-base font-semibold text-gray-900">Leaderboard</h3></div>
          <div className="space-y-1">
            {ranked.map(({ t, score }, i) => {
              const b = band(score)
              return (
                <button key={t.name} onClick={() => setOpenName(t.name)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-gray-50">
                  <span className="w-6 text-center text-sm font-bold text-gray-400">{MEDALS[i] || i + 1}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${b.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-800">{t.name}</div>
                    <div className="truncate text-[11px] text-gray-400">{t.type}</div>
                  </div>
                  <span className="text-[11px]"><Trend delta={trendOf(t.name)} /></span>
                  <span className={`w-12 text-right text-sm font-bold ${b.text}`}>{score == null ? '—' : `${score}%`}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-gray-400">Trend vs last month <SampleTag /></p>
        </div>

        {/* ── Roster (compact, rich, filterable) ───────────────────────── */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none" />
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f.label}</button>
            ))}
          </div>

          <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
            {filtered.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No one matches this filter.</div>}
            {filtered.map(({ t, score }) => {
              const b = band(score)
              const w = warningsByAgent[t.name]?.length || 0
              const att = sampleInt(t.name, 12, 80, 100) // sample
              const initials = t.name.split(' ').map((x) => x[0]).slice(0, 2).join('')
              return (
                <button key={t.name} onClick={() => setOpenName(t.name)} className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left last:border-0 hover:bg-gray-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-[11px] font-semibold text-gray-500">{initials}</span>
                  <div className="min-w-0 flex-[2]">
                    <div className="truncate text-sm font-semibold text-gray-900">{t.name}</div>
                    <div className="truncate text-xs text-gray-500">{t.role}</div>
                  </div>
                  <div className="hidden min-w-0 flex-1 sm:block">
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${b.bar}`} style={{ width: `${score == null ? 0 : Math.max(score, 3)}%` }} /></div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                      <span className="inline-flex items-center gap-0.5">{att}% att <SampleTag /></span>
                      {w > 0 ? <span className="text-red-500">{w} warning{w > 1 ? 's' : ''}</span> : <span className="text-emerald-500">0 warnings</span>}
                    </div>
                  </div>
                  <span className="text-[11px]"><Trend delta={trendOf(t.name)} /></span>
                  <span className={`w-12 text-right text-sm font-bold ${b.text}`}>{score == null ? '—' : `${score}%`}</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {openPerson && (
        <DetailDrawer
          person={openPerson}
          score={scoreOf(openPerson.name)}
          note={scores[openPerson.name]?.note || ''}
          nextReview={scores[openPerson.name]?.nextReview || ''}
          warnings={warningsByAgent[openPerson.name] || []}
          onSave={saveScore}
          onClose={() => setOpenName(null)}
          onFullProfile={() => navigate(`/agents/${openPerson.name.toLowerCase().replace(/\s+/g, '-')}`)}
        />
      )}
    </div>
  )
}

function Tile({ label, value, sub, accent = 'text-gray-900', icon: Icon, onClick }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp onClick={onClick || undefined} className={`rounded-2xl border border-gray-100 bg-white p-4 text-left ${onClick ? 'hover:border-gray-300' : ''}`}>
      <div className="mb-1 flex items-center gap-1.5">{Icon && <Icon size={13} className="text-gray-400" />}<p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p></div>
      <p className={`truncate text-2xl font-bold ${accent}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
    </Cmp>
  )
}

// Smooth labelled trend line (SVG) — sample series.
function TrendLine({ series }) {
  const W = 280, H = 70, pad = 6
  const vals = series.map((s) => s.v)
  const min = Math.min(...vals) - 4, max = Math.max(...vals) + 4
  const x = (i) => pad + (i * (W - pad * 2)) / (series.length - 1)
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ')
  const area = `${d} L${x(series.length - 1)},${H} L${x(0)},${H} Z`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 70 }}>
        <path d={area} fill="rgba(59,130,246,0.10)" />
        <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((s, i) => <circle key={i} cx={x(i)} cy={y(s.v)} r="2.5" fill="#3b82f6" />)}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">{series.map((s) => <span key={s.m}>{s.m} {s.v}</span>)}</div>
    </div>
  )
}

function DetailDrawer({ person, score, note, nextReview, warnings, onSave, onClose, onFullProfile }) {
  const [draft, setDraft] = useState(score == null ? '' : String(score))
  const [noteDraft, setNoteDraft] = useState(note)
  const [saving, setSaving] = useState(false)
  const b = band(draft === '' ? null : Number(draft))
  const initials = person.name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  const series = sampleSeries(person.name, score)
  const radar = [
    { axis: 'Sales', v: sampleInt(person.name, 31, 50, 100) },
    { axis: 'Attendance', v: sampleInt(person.name, 32, 70, 100) },
    { axis: 'Communication', v: sampleInt(person.name, 33, 55, 100) },
    { axis: 'Customer rating', v: sampleInt(person.name, 34, 60, 100) },
    { axis: 'Initiative', v: sampleInt(person.name, 35, 45, 100) },
  ]
  const goals = [
    { label: 'Close 10 sales', done: sampleInt(person.name, 41, 0, 1) === 1 },
    { label: 'Renew 20 customers', done: sampleInt(person.name, 42, 0, 1) === 1 },
    { label: 'Attend training', done: sampleInt(person.name, 43, 0, 1) === 1 },
    { label: 'Zero late arrivals', done: sampleInt(person.name, 44, 0, 1) === 1 },
  ]
  const goalsDone = goals.filter((g) => g.done).length
  // Timeline (sample monthly journal).
  const timeline = lastMonths(3).slice().reverse().map((m, i) => ({ m, stars: sampleInt(person.name, 60 + i, 3, 5), notes: ['Completed KPI', i === 0 ? 'No warnings' : 'Missed 1 target', i === 1 ? 'Late twice' : 'On target'].slice(0, 2 + (i % 2)) }))

  // Recommended actions — REAL logic from score + warnings.
  const recs = []
  const s = draft === '' ? null : Number(draft)
  if (s == null) recs.push({ icon: ClipboardList, label: 'Set a score', tone: 'gray' })
  if (s != null && s >= 95) { recs.push({ icon: Star, label: 'Recognise', tone: 'emerald' }); recs.push({ icon: ArrowUpRight, label: 'Consider promotion', tone: 'blue' }) }
  if (s != null && s >= 85 && s < 95) recs.push({ icon: Gift, label: 'Bonus candidate', tone: 'blue' })
  if (s != null && s < 55) { recs.push({ icon: AlertTriangle, label: 'Coaching plan', tone: 'red' }); recs.push({ icon: CalendarClock, label: 'Schedule review', tone: 'amber' }) }
  if (warnings.length) recs.push({ icon: AlertTriangle, label: 'Address warnings', tone: 'amber' })
  const RTONE = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700', gray: 'bg-gray-100 text-gray-600' }

  async function save() { setSaving(true); await onSave(person.name, draft === '' ? '' : Number(draft), noteDraft); setSaving(false); onClose() }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <h3 className="font-semibold text-gray-900">Employee command center</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-base font-semibold text-white">{initials}</div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-gray-900">{person.name}</p>
              <p className="text-sm text-gray-500">{person.role} · {person.type}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 font-medium ${b.chip}`}>{b.label}</span>
                {person.joined && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">Joined {person.joined}</span>}
                {person.status && <span className="rounded-full bg-gray-100 px-2 py-0.5 capitalize text-gray-500">{person.status}</span>}
              </div>
            </div>
          </div>

          {/* Performance summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Mini label="Overall score" value={draft === '' ? '—' : `${draft}%`} cls={b.text} />
            <Mini label="Trend" value={<span className="inline-flex items-center gap-1 text-gray-700"><Trend delta={s == null ? null : (sampleInt(person.name, 5, 0, 12) - 4)} /> <SampleTag /></span>} />
            <Mini label="Next review" value={nextReview || <span className="inline-flex items-center gap-1 text-gray-400">Not set <SampleTag /></span>} />
            <Mini label="Contract ends" value={person.contractEnd ? new Date(person.contractEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
          </div>

          {/* Manager-set score (REAL) */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="mb-2 flex items-center justify-between"><label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Score (manager-set)</label><span className={`text-2xl font-bold ${b.text}`}>{draft === '' ? '—' : `${draft}%`}</span></div>
            <input type="range" min="0" max="100" value={draft === '' ? 0 : draft} onChange={(e) => setDraft(e.target.value)} className="w-full accent-gray-900" />
            <div className="mt-2 flex gap-2"><input type="number" min="0" max="100" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="—" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><button onClick={() => setDraft('')} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Clear</button></div>
          </div>

          {/* Trend line */}
          <Section title="Performance over 6 months" sample><TrendLine series={series} /></Section>

          {/* Radar / breakdown */}
          <Section title="Performance radar" sample>
            <div className="space-y-2">
              {radar.map((r) => (
                <div key={r.axis}><div className="mb-0.5 flex justify-between text-xs"><span className="text-gray-600">{r.axis}</span><span className="font-semibold text-gray-700">{r.v}%</span></div><div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${r.v}%` }} /></div></div>
              ))}
            </div>
          </Section>

          {/* Goals */}
          <Section title={`Monthly goals · ${goalsDone}/${goals.length} complete`} sample>
            <div className="space-y-1.5">
              {goals.map((g) => (
                <div key={g.label} className="flex items-center gap-2 text-sm"><CheckCircle2 size={16} className={g.done ? 'text-emerald-500' : 'text-gray-300'} /><span className={g.done ? 'text-gray-700' : 'text-gray-400'}>{g.label}</span></div>
              ))}
            </div>
          </Section>

          {/* KPI (text real) */}
          <Section title="KPI"><p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{person.kpi || person.coreResponsibility || 'No KPI set.'}</p>{warnings.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600"><AlertTriangle size={12} />{warnings.length} active warning{warnings.length > 1 ? 's' : ''}</p>}</Section>

          {/* Timeline */}
          <Section title="Performance timeline" sample>
            <div className="space-y-3">
              {timeline.map((tl) => (
                <div key={tl.m} className="border-l-2 border-gray-100 pl-3">
                  <div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-800">{tl.m}</span><span className="text-amber-400">{'★'.repeat(tl.stars)}<span className="text-gray-200">{'★'.repeat(5 - tl.stars)}</span></span></div>
                  <p className="text-xs text-gray-500">{tl.notes.join(' · ')}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Manager notes (REAL) */}
          <Section title="Manager notes"><textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="e.g. Excellent month — candidate for promotion." className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-gray-400 focus:outline-none" /></Section>

          {/* Recommended actions (REAL logic) */}
          {recs.length > 0 && (
            <Section title="Recommended actions">
              <div className="flex flex-wrap gap-2">
                {recs.map((r, i) => (<span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${RTONE[r.tone]}`}><r.icon size={13} />{r.label}</span>))}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Suggested from score + warnings. <button onClick={onFullProfile} className="font-medium text-gray-600 underline">Open full profile</button> to act.</p>
            </Section>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-gray-100 bg-white px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-full border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 rounded-full bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function Mini({ label, value, cls = 'text-gray-800' }) {
  return <div className="rounded-xl bg-gray-50 p-3"><p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p><p className={`mt-0.5 text-sm font-bold ${cls}`}>{value}</p></div>
}
function Section({ title, sample, children }) {
  return <div><div className="mb-2 flex items-center gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>{sample && <SampleTag />}</div>{children}</div>
}
