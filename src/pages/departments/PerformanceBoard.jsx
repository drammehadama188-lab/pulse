import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Trophy, TrendingUp, TrendingDown, Minus, AlertTriangle, X, Search,
  Star, Gift, ChevronRight, Target, CalendarClock, PartyPopper, ClipboardList,
  ArrowUpRight, Sparkles, CheckCircle2, Brain, Lock, Plus, Check, ArrowLeft, CalendarCheck,
} from 'lucide-react'
import { api } from '../../lib/api.js'

// Performance board — a manager's operating system.
//
// DATA HONESTY (Adama's "no fake metrics" rule):
//  • REAL: roster (team.js), warnings, KPI text, manager-set live SCORE + notes,
//    department averages, Today's-priorities, career history (person.history),
//    recommended-action logic, and — new — the immutable REVIEW HISTORY
//    (/api/reviews). Reviews are manager-completed, locked, never overwritten.
//  • SAMPLE (badged): live trend line, radar axes, attendance, rating, goals,
//    and the Pulse-Intelligence sentence — deterministic per person, until each
//    gets a real source. Historical reviews are NEVER sampled.

const now = new Date()
const MS_DAY = 86400000
const pad2 = (n) => String(n).padStart(2, '0')
const daysUntil = (iso) => { const d = new Date(iso); return isNaN(d) ? null : Math.ceil((d - now) / MS_DAY) }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CUR_PERIOD = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
const periodLabel = (p) => { const [y, m] = String(p).split('-'); return `${MONTH_NAMES[Number(m) - 1] || '?'} ${y}` }
function lastMonths(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(MONTH_NAMES[d.getMonth()]) } return out }
function joinedDate(joined) { const d = new Date(`${joined} 1`); return isNaN(d) ? null : d }
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
const fmtDateY = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }

function seed(name, salt = 0) { let h = 2166136261 ^ salt; for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967295 }
const sampleInt = (name, salt, min, max) => Math.round(min + seed(name, salt) * (max - min))
function sampleSeries(name, end) {
  const start = Math.max(40, (end ?? 70) - sampleInt(name, 3, 8, 28))
  return lastMonths(6).map((m, i) => ({ m, v: Math.round(start + ((end ?? 70) - start) * (i / 5) + (seed(name, i + 20) * 8 - 4)) }))
}
const RADAR_AXES = [
  { key: 'Sales', salt: 31, min: 50, max: 100 }, { key: 'Attendance', salt: 32, min: 70, max: 100 },
  { key: 'Communication', salt: 33, min: 55, max: 100 }, { key: 'Customer rating', salt: 34, min: 60, max: 100 },
  { key: 'Initiative', salt: 35, min: 45, max: 100 },
]
const ACTION_OPTIONS = ['Bonus approved', 'Promotion recommended', 'Coaching scheduled', 'Public recognition', 'Performance improvement plan', 'Salary review']

function band(score) {
  if (score == null) return { label: 'Not rated', dot: 'bg-gray-300', text: 'text-gray-400', bar: 'bg-gray-200', chip: 'bg-gray-100 text-gray-500' }
  if (score >= 95) return { label: 'Exceptional', dot: 'bg-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-600', chip: 'bg-emerald-100 text-emerald-700' }
  if (score >= 85) return { label: 'Strong', dot: 'bg-green-500', text: 'text-green-600', bar: 'bg-green-500', chip: 'bg-green-100 text-green-700' }
  if (score >= 70) return { label: 'On track', dot: 'bg-blue-500', text: 'text-blue-600', bar: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700' }
  if (score >= 55) return { label: 'Watch', dot: 'bg-amber-500', text: 'text-amber-600', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' }
  return { label: 'Behind', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-500', chip: 'bg-red-100 text-red-700' }
}
// Review status (the audit-trail label for a completed month).
function statusFor(score) {
  if (score == null) return { label: 'Not scored', tone: 'bg-gray-100 text-gray-500' }
  if (score >= 90) return { label: 'Outstanding', tone: 'bg-emerald-100 text-emerald-700' }
  if (score >= 80) return { label: 'Exceeded expectations', tone: 'bg-green-100 text-green-700' }
  if (score >= 70) return { label: 'Met expectations', tone: 'bg-blue-100 text-blue-700' }
  if (score >= 55) return { label: 'Needs improvement', tone: 'bg-amber-100 text-amber-700' }
  return { label: 'Below expectations', tone: 'bg-red-100 text-red-700' }
}
const MEDALS = ['🥇', '🥈', '🥉']

function SampleTag() { return <span className="inline-flex items-center rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-500 ring-1 ring-violet-200" title="Sample data — no live source yet">Sample</span> }
function Trend({ delta, size = 13 }) {
  if (delta == null) return <Minus size={size} className="text-gray-300" />
  if (delta > 0) return <span className="inline-flex items-center font-semibold text-emerald-600"><TrendingUp size={size} />+{delta}</span>
  if (delta < 0) return <span className="inline-flex items-center font-semibold text-red-500"><TrendingDown size={size} />{delta}</span>
  return <span className="inline-flex items-center text-gray-300"><Minus size={size} /></span>
}

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'Sales', label: 'Sales' }, { id: 'Customer Service', label: 'Customer Service' },
  { id: 'Operations', label: 'Operations' }, { id: 'top', label: 'Above 90' }, { id: 'low', label: 'Below 60' },
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
      for (const { name, p } of rows) { const raw = p.performanceScore; next[name] = { score: raw === '' || raw == null ? null : Number(raw), note: p.performanceNote || '', nextReview: p.nextReview || '' } }
      setScores(next)
    })
    return () => { alive = false }
  }, [roster])

  const scoreOf = (name) => scores[name]?.score ?? null
  const trendOf = (name) => { const s = scoreOf(name); return s == null ? null : (sampleInt(name, 5, 0, 12) - 4) }

  const ranked = useMemo(() => roster.map((t) => ({ t, score: scoreOf(t.name) })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), [roster, scores])
  const rated = ranked.filter((r) => r.score != null)
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.score, 0) / rated.length) : null
  const top = rated[0]
  const needs = rated.length ? rated[rated.length - 1] : null

  const depts = useMemo(() => {
    const groups = {}
    roster.forEach((t) => { const k = t.type || 'Other'; (groups[k] = groups[k] || []).push(scoreOf(t.name)) })
    const arr = Object.entries(groups).map(([name, vals]) => { const r = vals.filter((x) => x != null); return { name, avg: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null, n: vals.length } })
    const rankable = arr.filter((d) => d.avg != null).sort((a, b) => b.avg - a.avg)
    return arr.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)).map((d) => {
      let status = 'Stable'
      if (d.avg == null) status = 'Not rated'
      else if (rankable.length > 1 && d.name === rankable[0].name) status = 'Best performing'
      else if (rankable.length > 1 && d.name === rankable[rankable.length - 1].name) status = 'Needs improvement'
      return { ...d, status }
    })
  }, [roster, scores])

  const companyRadar = useMemo(() => RADAR_AXES.map((a) => ({ axis: a.key, avg: Math.round(roster.reduce((s, t) => s + sampleInt(t.name, a.salt, a.min, a.max), 0) / Math.max(roster.length, 1)) })), [roster])

  const buckets = useMemo(() => {
    const out = { urgent: [], attention: [], good: [] }
    roster.forEach((t) => {
      const d = t.contractEnd ? daysUntil(t.contractEnd) : null
      if (d != null && d >= 0 && d <= 7) out.urgent.push({ icon: CalendarClock, text: `${t.name}'s contract expires in ${d} day${d === 1 ? '' : 's'}.`, name: t.name })
      else if (d != null && d > 7 && d <= 30) out.attention.push({ icon: CalendarClock, text: `${t.name}'s contract renews in ${d} days.`, name: t.name })
    })
    ranked.forEach(({ t, score }) => {
      if (score != null && score < 55) out.urgent.push({ icon: AlertTriangle, text: `${t.name} is behind (${score}%) — needs coaching.`, name: t.name })
      else if (score == null) out.attention.push({ icon: ClipboardList, text: `${t.name} hasn't been scored this month.`, name: t.name })
      else if (score >= 95) out.good.push({ icon: Star, text: `${t.name} is exceeding expectations (${score}%).`, name: t.name })
    })
    Object.entries(warningsByAgent).forEach(([name, ws]) => { if (ws.length >= 2) out.urgent.push({ icon: AlertTriangle, text: `${name} has ${ws.length} active warnings.`, name }); else if (ws.length === 1) out.attention.push({ icon: AlertTriangle, text: `${name} has an active warning.`, name }) })
    roster.forEach((t) => { const jd = joinedDate(t.joined); if (jd && jd.getMonth() === now.getMonth()) { const yrs = now.getFullYear() - jd.getFullYear(); if (yrs >= 1) out.good.push({ icon: PartyPopper, text: `${t.name}'s ${yrs}-year work anniversary is this month.`, name: t.name }) } })
    const best = depts.find((d) => d.status === 'Best performing'); if (best) out.good.push({ icon: Trophy, text: `${best.name} is the top department (${best.avg}%).`, name: null })
    return out
  }, [roster, ranked, warningsByAgent, depts, scores])

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

  return (
    <div className="space-y-6">
      {(buckets.urgent.length + buckets.attention.length + buckets.good.length) > 0 && (
        <div className="rounded-3xl border border-gray-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2"><Sparkles size={17} className="text-amber-500" /><h3 className="text-base font-semibold text-gray-900">Today's priorities</h3></div>
          <div className="grid gap-4 md:grid-cols-3">
            <PriorityCol title="Urgent" dot="bg-red-500" tone="text-red-700" items={buckets.urgent} onPick={setOpenName} />
            <PriorityCol title="Needs attention" dot="bg-amber-500" tone="text-amber-700" items={buckets.attention} onPick={setOpenName} />
            <PriorityCol title="Good news" dot="bg-emerald-500" tone="text-emerald-700" items={buckets.good} onPick={setOpenName} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Performance Health" value={avg == null ? '—' : `${avg}%`} sub={avg == null ? `${rated.length}/${roster.length} rated` : <span className="inline-flex items-center gap-1 text-emerald-600">+6% <SampleTag /></span>} accent={band(avg).text} />
        <Tile label="Top Performer" value={top ? top.t.name.split(' ')[0] : '—'} sub={top ? `${top.score}%` : 'rate the team'} accent="text-emerald-700" icon={Trophy} onClick={top && (() => setOpenName(top.t.name))} />
        <Tile label="Needs Coaching" value={needs ? needs.t.name.split(' ')[0] : '—'} sub={needs ? `${needs.score}%` : '—'} accent="text-red-600" icon={AlertTriangle} onClick={needs && (() => setOpenName(needs.t.name))} />
        <Tile label="Goals" value="18 / 24" sub={<SampleTag />} accent="text-blue-600" icon={CheckCircle2} />
        <Tile label="Team Rating" value="4.6 / 5" sub={<SampleTag />} accent="text-blue-600" icon={Star} />
        <Tile label="Attendance" value="96%" sub={<SampleTag />} accent="text-blue-600" icon={CalendarClock} />
      </div>

      <div className="rounded-3xl border border-gray-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Department comparison</h3>
        <div className="space-y-2.5">
          {depts.map((d) => {
            const b = band(d.avg)
            const sb = d.status === 'Best performing' ? 'bg-emerald-100 text-emerald-700' : d.status === 'Needs improvement' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
            return (
              <div key={d.name} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-sm font-medium text-gray-700">{d.name} <span className="text-gray-400">· {d.n}</span></span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${b.bar}`} style={{ width: `${d.avg ?? 0}%` }} /></div>
                <span className={`w-11 text-right text-sm font-bold ${b.text}`}>{d.avg == null ? '—' : `${d.avg}%`}</span>
                <span className="w-5 text-center"><Trend delta={d.avg == null ? null : (sampleInt(d.name, 9, 0, 10) - 4)} /></span>
                <span className={`hidden w-32 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium sm:inline-block ${sb}`}>{d.status}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-gray-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2"><Trophy size={18} className="text-amber-500" /><h3 className="text-base font-semibold text-gray-900">Leaderboard</h3></div>
          <div className="space-y-1">
            {ranked.map(({ t, score }, i) => {
              const b = band(score)
              return (
                <button key={t.name} onClick={() => setOpenName(t.name)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-gray-50">
                  <span className="w-6 text-center text-sm font-bold text-gray-400">{MEDALS[i] || i + 1}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${b.dot}`} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-gray-800">{t.name}</div><div className="truncate text-[11px] text-gray-400">{t.type}</div></div>
                  <span className="text-[11px]"><Trend delta={trendOf(t.name)} /></span>
                  <span className={`w-12 text-right text-sm font-bold ${b.text}`}>{score == null ? '—' : `${score}%`}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-gray-400">Trend vs last month <SampleTag /></p>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none" /></div>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f.label}</button>)}
          </div>
          <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
            {filtered.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No one matches this filter.</div>}
            {filtered.map(({ t, score }) => {
              const b = band(score)
              const w = warningsByAgent[t.name]?.length || 0
              const nr = scores[t.name]?.nextReview
              const initials = t.name.split(' ').map((x) => x[0]).slice(0, 2).join('')
              return (
                <button key={t.name} onClick={() => setOpenName(t.name)} className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left last:border-0 hover:bg-gray-50">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold text-white ${b.bar}`}>{initials}</span>
                  <div className="min-w-0 flex-[2]">
                    <div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-gray-900">{t.name}</span>{w > 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 text-[10px] font-medium text-red-600"><AlertTriangle size={9} />{w}</span>}</div>
                    <div className="truncate text-xs text-gray-500">{t.role}</div>
                    <div className="mt-0.5 truncate text-[11px] text-gray-400">{t.type}{w === 0 ? ' · 0 warnings' : ''}{nr ? ` · Next review ${fmtDate(nr) || nr}` : ''}</div>
                  </div>
                  <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 sm:block"><div className={`h-full rounded-full ${b.bar}`} style={{ width: `${score == null ? 0 : Math.max(score, 3)}%` }} /></div>
                  <span className="text-[11px]"><Trend delta={trendOf(t.name)} /></span>
                  <span className={`w-12 text-right text-base font-bold ${b.text}`}>{score == null ? '—' : `${score}%`}</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {openPerson && (
        <DetailDrawer
          person={openPerson} score={scoreOf(openPerson.name)} note={scores[openPerson.name]?.note || ''}
          nextReview={scores[openPerson.name]?.nextReview || ''} warnings={warningsByAgent[openPerson.name] || []}
          companyRadar={companyRadar} onSave={saveScore} onClose={() => setOpenName(null)}
          onFullProfile={() => navigate(`/agents/${openPerson.name.toLowerCase().replace(/\s+/g, '-')}`)}
        />
      )}
    </div>
  )
}

function PriorityCol({ title, dot, tone, items, onPick }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} /><span className={`text-xs font-bold uppercase tracking-wide ${tone}`}>{title}</span><span className="text-[11px] text-gray-300">{items.length}</span></div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-400">Nothing here.</p>}
        {items.map((it, i) => <button key={i} onClick={() => it.name && onPick(it.name)} className="flex w-full items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"><it.icon size={14} className="mt-0.5 shrink-0 text-gray-400" /><span className="leading-snug">{it.text}</span></button>)}
      </div>
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

function TrendLine({ series }) {
  const W = 280, H = 96, pad = 8
  const vals = series.map((s) => s.v)
  const min = Math.min(...vals) - 4, max = Math.max(...vals) + 4
  const x = (i) => pad + (i * (W - pad * 2)) / (series.length - 1)
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ')
  const area = `${d} L${x(series.length - 1)},${H} L${x(0)},${H} Z`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 96 }}>
        <path d={area} fill="rgba(59,130,246,0.10)" />
        <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((s, i) => <circle key={i} cx={x(i)} cy={y(s.v)} r="3" fill="#3b82f6" />)}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">{series.map((s) => <span key={s.m} className="text-center">{s.m}<br /><span className="font-semibold text-gray-500">{s.v}</span></span>)}</div>
    </div>
  )
}

function observation(person, score, series, warnings) {
  const f = person.name.split(' ')[0]
  const vals = series.map((s) => s.v)
  const delta = vals[vals.length - 1] - vals[0]
  const rising = vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1)
  if (rising && delta >= 8) return `${f} has improved steadily over the past six months${warnings.length ? '' : ' with a clean record'}. They may be ready for additional responsibility.`
  if (delta <= -8) return `${f}'s performance has dropped roughly ${Math.abs(delta)}% over recent months. A focused coaching session could turn this around.`
  if (score != null && score >= 90) return `${f} is among the top performers. Recognise the contribution to keep the momentum going.`
  if (score != null && score < 55) return `${f} is behind target${warnings.length ? ' and has active warnings' : ''}. A weekly check-in with clear goals is recommended.`
  return `${f}'s performance is holding steady. Keep regular check-ins to maintain momentum.`
}

function DetailDrawer({ person, score, note, nextReview, warnings, companyRadar, onSave, onClose, onFullProfile }) {
  const [view, setView] = useState('live') // live | history
  const [draft, setDraft] = useState(score == null ? '' : String(score))
  const [noteDraft, setNoteDraft] = useState(note)
  const [saving, setSaving] = useState(false)
  const [reviews, setReviews] = useState(null) // null = loading
  const [reviewing, setReviewing] = useState(false)
  const [openReview, setOpenReview] = useState(null)

  const b = band(draft === '' ? null : Number(draft))
  const s = draft === '' ? null : Number(draft)
  const initials = person.name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  const series = sampleSeries(person.name, score)
  const radar = RADAR_AXES.map((a) => ({ axis: a.key, v: sampleInt(person.name, a.salt, a.min, a.max), company: (companyRadar.find((c) => c.axis === a.key) || {}).avg }))
  const goals = [
    { label: 'Close 10 sales', done: sampleInt(person.name, 41, 0, 1) === 1 }, { label: 'Renew 20 customers', done: sampleInt(person.name, 42, 0, 1) === 1 },
    { label: 'Attend training', done: sampleInt(person.name, 43, 0, 1) === 1 }, { label: 'Zero late arrivals', done: sampleInt(person.name, 44, 0, 1) === 1 },
  ]
  const goalsDone = goals.filter((g) => g.done).length
  const career = Array.isArray(person.history) ? person.history : []

  function loadReviews() { api(`/reviews?name=${encodeURIComponent(person.name)}`).then((d) => setReviews(d.reviews || [])).catch(() => setReviews([])) }
  useEffect(() => { loadReviews() /* eslint-disable-next-line */ }, [person.name])
  const hasCurrent = (reviews || []).some((r) => r.period === CUR_PERIOD)

  const recs = []
  if (s == null) recs.push({ icon: ClipboardList, label: 'Set a score', tone: 'gray' })
  if (s != null && s >= 95) { recs.push({ icon: Star, label: 'Public recognition', tone: 'emerald' }); recs.push({ icon: Gift, label: 'Recommend bonus', tone: 'emerald' }); recs.push({ icon: ArrowUpRight, label: 'Promotion candidate', tone: 'blue' }) }
  else if (s != null && s >= 85) recs.push({ icon: Gift, label: 'Bonus candidate', tone: 'blue' })
  if (s != null && s < 55) { recs.push({ icon: CalendarClock, label: 'Schedule coaching', tone: 'amber' }); recs.push({ icon: Target, label: 'Weekly check-in', tone: 'amber' }); recs.push({ icon: AlertTriangle, label: 'Performance improvement plan', tone: 'red' }) }
  else if (s != null && s < 70) recs.push({ icon: Target, label: 'Set clearer goals', tone: 'amber' })
  if (warnings.length) recs.push({ icon: AlertTriangle, label: 'Address warnings', tone: 'red' })
  const RTONE = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700', gray: 'bg-gray-100 text-gray-600' }

  async function save() { setSaving(true); await onSave(person.name, draft === '' ? '' : Number(draft), noteDraft); setSaving(false); onClose() }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Employee Command Center</h3>
            <button onClick={onClose} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </div>
          <div className="mt-3 flex gap-1 rounded-full bg-gray-100 p-1">
            {[['live', 'Live performance'], ['history', 'Review history']].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)} className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${view === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}{id === 'history' && reviews?.length ? ` (${reviews.length})` : ''}</button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="flex items-start gap-4 px-5 pt-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-lg font-bold text-white">{initials}</div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-extrabold tracking-tight text-gray-900">{person.name}</p>
            <p className="text-sm text-gray-500">{person.role} · {person.type}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 font-medium ${b.chip}`}>{b.label}</span>
              {person.joined && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">Joined {person.joined}</span>}
              {person.status && <span className="rounded-full bg-gray-100 px-2 py-0.5 capitalize text-gray-500">{person.status}</span>}
            </div>
          </div>
        </div>

        {view === 'live' ? (
          <div className="space-y-7 p-5">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="mb-1.5 flex items-center gap-2"><Brain size={15} className="text-indigo-500" /><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Pulse intelligence</p><SampleTag /></div>
              <p className="text-sm leading-relaxed text-gray-700">{observation(person, s, series, warnings)}</p>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="mb-1 flex items-end justify-between"><label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current score</label><span className={`text-5xl font-extrabold leading-none ${b.text}`}>{draft === '' ? '—' : draft}<span className="text-2xl">%</span></span></div>
              <input type="range" min="0" max="100" value={draft === '' ? 0 : draft} onChange={(e) => setDraft(e.target.value)} className="mt-3 w-full accent-gray-900" />
              <div className="mt-2 flex items-center gap-2"><span className="text-[11px] text-gray-400">Live · changes daily</span><div className="flex-1" /><input type="number" min="0" max="100" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="—" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><button onClick={() => setDraft('')} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Clear</button></div>
            </div>

            <Section title="Performance over 6 months" sample><TrendLine series={series} /></Section>

            <Section title="Career progress">
              {career.length === 0 ? <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-500">{person.role} — no recorded role changes yet.</p> : (
                <ol className="relative ml-1 border-l-2 border-gray-100 pl-4">
                  {career.map((h, i) => <li key={i} className="mb-3 last:mb-0"><span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-blue-500" /><p className="text-sm font-semibold text-gray-800">{h.event}</p><p className="text-[11px] text-gray-400">{h.date}{h.dateApproximate ? ' (approx.)' : ''}{h.note ? ` · ${h.note}` : ''}</p></li>)}
                </ol>
              )}
            </Section>

            <Section title="Performance radar" sample>
              <div className="space-y-3">
                {radar.map((r) => (
                  <div key={r.axis}>
                    <div className="mb-1 flex justify-between text-xs"><span className="text-gray-600">{r.axis}</span><span className="font-semibold text-gray-700">{r.v}%<span className="ml-1 font-normal text-gray-400">· co. {r.company}%</span></span></div>
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${r.v}%` }} /><div className="absolute top-0 h-full w-0.5 bg-gray-500" style={{ left: `${r.company}%` }} title={`Company avg ${r.company}%`} /></div>
                  </div>
                ))}
                <p className="text-[11px] text-gray-400">Bar = employee · grey line = company average.</p>
              </div>
            </Section>

            <Section title={`Current goals · ${goalsDone}/${goals.length} complete`} sample>
              <div className="space-y-1.5">{goals.map((g) => <div key={g.label} className="flex items-center gap-2 text-sm"><CheckCircle2 size={16} className={g.done ? 'text-emerald-500' : 'text-gray-300'} /><span className={g.done ? 'text-gray-700' : 'text-gray-400'}>{g.label}</span></div>)}</div>
            </Section>

            <Section title="Current KPI"><p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{person.kpi || person.coreResponsibility || 'No KPI set.'}</p>{warnings.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600"><AlertTriangle size={12} />{warnings.length} active warning{warnings.length > 1 ? 's' : ''}</p>}</Section>

            <Section title="Manager notes"><textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="e.g. Excellent month — candidate for promotion." className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-gray-400 focus:outline-none" /></Section>

            {recs.length > 0 && (
              <Section title="Recommended actions">
                <div className="flex flex-wrap gap-2">{recs.map((r, i) => <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${RTONE[r.tone]}`}><r.icon size={13} />{r.label}</span>)}</div>
                <p className="mt-2 text-[11px] text-gray-400">Suggested from score + warnings. <button onClick={onFullProfile} className="font-medium text-gray-600 underline">Open full profile</button> to act.</p>
              </Section>
            )}
          </div>
        ) : (
          <HistoryView person={person} reviews={reviews} hasCurrent={hasCurrent} onComplete={() => setReviewing(true)} onOpen={setOpenReview} />
        )}

        {view === 'live' && (
          <div className="sticky bottom-0 flex gap-2 border-t border-gray-100 bg-white px-5 py-4">
            <button onClick={onClose} className="rounded-full border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 rounded-full bg-[var(--color-brand)] py-3 text-base font-bold text-white shadow-[0_6px_16px_rgba(214,41,79,0.30)] hover:brightness-95 disabled:opacity-50">{saving ? 'Saving…' : 'Save score'}</button>
          </div>
        )}

        {reviewing && (
          <ReviewForm person={person} defaultScore={draft} defaultNotes={noteDraft} warningsCount={warnings.length}
            onClose={() => setReviewing(false)} onSaved={() => { setReviewing(false); loadReviews() }} />
        )}
        {openReview && <ReviewDetail review={openReview} onClose={() => setOpenReview(null)} />}
      </div>
    </div>
  )
}

// ── Review history list + calendar (REAL, immutable) ──────────────────────
function HistoryView({ person, reviews, hasCurrent, onComplete, onOpen }) {
  const yr = now.getFullYear()
  const reviewed = new Set((reviews || []).map((r) => r.period))
  return (
    <div className="space-y-6 p-5">
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="mb-2 flex items-center gap-2"><CalendarCheck size={15} className="text-gray-500" /><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Review schedule · {yr}</p></div>
        <div className="grid grid-cols-6 gap-1.5">
          {MONTH_NAMES.map((m, i) => {
            const p = `${yr}-${pad2(i + 1)}`
            const done = reviewed.has(p)
            const isCur = p === CUR_PERIOD, future = i > now.getMonth()
            return <div key={m} className={`rounded-lg py-1.5 text-center text-[11px] font-medium ${done ? 'bg-emerald-100 text-emerald-700' : isCur ? 'bg-amber-100 text-amber-700' : future ? 'bg-white text-gray-300' : 'bg-red-50 text-red-500'}`} title={done ? 'Reviewed' : isCur ? 'Due now' : future ? 'Upcoming' : 'Missing'}>{m}{done ? ' ✓' : ''}</div>
          })}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Green = completed · amber = due now · red = missing.</p>
      </div>

      {!hasCurrent ? (
        <button onClick={onComplete} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-4 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50"><Plus size={16} /> Complete {periodLabel(CUR_PERIOD)} review</button>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><Check size={16} />{periodLabel(CUR_PERIOD)} review is locked.</div>
      )}

      <div>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-gray-500">Review history</p>
        {reviews == null ? <p className="text-sm text-gray-400">Loading…</p>
          : reviews.length === 0 ? <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No reviews yet. Completing a monthly review creates a permanent, locked record here — your audit trail.</p>
          : (
            <div className="space-y-2">
              {reviews.map((r) => { const st = statusFor(r.score); const bb = band(r.score); return (
                <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left hover:border-gray-300">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="text-sm font-bold text-gray-900">{periodLabel(r.period)}</span><Lock size={11} className="text-gray-300" /></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400"><span className={`rounded-full px-2 py-0.5 font-medium ${st.tone}`}>{st.label}</span><span>· {r.manager}</span><span>· {fmtDateY(r.completedAt)}</span></div>
                  </div>
                  <span className={`text-xl font-extrabold ${bb.text}`}>{r.score == null ? '—' : `${r.score}%`}</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              ) })}
            </div>
          )}
      </div>
    </div>
  )
}

function ReviewDetail({ review: r, onClose }) {
  const st = statusFor(r.score), bb = band(r.score)
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-white">
      <div className="sticky top-0 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-4"><button onClick={onClose} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ArrowLeft size={18} /></button><h3 className="font-semibold text-gray-900">{periodLabel(r.period)} review</h3><span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"><Lock size={11} /> Locked</span></div>
      <div className="space-y-6 p-5">
        <div className="flex items-end justify-between">
          <div><p className="text-xs uppercase tracking-wide text-gray-400">Overall score</p><p className={`text-5xl font-extrabold ${bb.text}`}>{r.score == null ? '—' : `${r.score}%`}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${st.tone}`}>{st.label}</span></div>
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
  )
}

function ReviewForm({ person, defaultScore, defaultNotes, warningsCount, onClose, onSaved }) {
  const [score, setScore] = useState(defaultScore || '')
  const [statusLabel, setStatusLabel] = useState('')
  const [ratings, setRatings] = useState(() => Object.fromEntries(RADAR_AXES.map((a) => [a.key, ''])))
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
        name: person.name, period: CUR_PERIOD,
        score: score === '' ? '' : Number(score), status: effectiveStatus,
        ratings: Object.fromEntries(Object.entries(ratings).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        kpis, achievements, actions, notes, warningsCount,
      } })
      onSaved()
    } catch (e) { setErr(e?.message || 'Could not save. A review for this month may already be locked.'); setBusy(false) }
  }

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-white">
      <div className="sticky top-0 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-4"><button onClick={onClose} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ArrowLeft size={18} /></button><h3 className="font-semibold text-gray-900">Complete {periodLabel(CUR_PERIOD)} review</h3></div>
      <div className="space-y-5 p-5">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Once saved, this review is <b>locked permanently</b> as part of {person.name.split(' ')[0]}'s record. It cannot be edited.</p>

        <Field label="Overall score">
          <div className="flex items-center gap-3"><input type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-lg font-bold" placeholder="0–100" /><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusFor(score === '' ? null : Number(score)).tone}`}>{effectiveStatus}</span></div>
        </Field>

        <Field label="Status (override)"><select value={statusLabel} onChange={(e) => setStatusLabel(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="">Auto from score ({statusFor(score === '' ? null : Number(score)).label})</option>{['Outstanding', 'Exceeded expectations', 'Met expectations', 'Needs improvement', 'Below expectations'].map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>

        <Field label="Ratings (manager-entered)">
          <div className="space-y-2">{RADAR_AXES.map((a) => (
            <div key={a.key} className="flex items-center gap-3"><span className="w-32 shrink-0 text-sm text-gray-600">{a.key}</span><input type="number" min="0" max="100" value={ratings[a.key]} onChange={(e) => setRatings((r) => ({ ...r, [a.key]: e.target.value }))} placeholder="—" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><span className="text-xs text-gray-400">%</span></div>
          ))}</div>
        </Field>

        <Field label="KPI checklist">
          <div className="space-y-1.5">{kpis.map((k, i) => (
            <div key={i} className="flex items-center gap-2"><button onClick={() => setKpis((ks) => ks.map((x, j) => j === i ? { ...x, done: !x.done } : x))} className={`flex h-5 w-5 items-center justify-center rounded border ${k.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300'}`}>{k.done && <Check size={12} />}</button><span className="flex-1 text-sm text-gray-700">{k.label}</span><button onClick={() => setKpis((ks) => ks.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-400"><X size={14} /></button></div>
          ))}
            <div className="flex gap-2"><input value={kpiInput} onChange={(e) => setKpiInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && kpiInput.trim()) { setKpis((ks) => [...ks, { label: kpiInput.trim(), done: false }]); setKpiInput('') } }} placeholder="Add a KPI…" className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><button onClick={() => { if (kpiInput.trim()) { setKpis((ks) => [...ks, { label: kpiInput.trim(), done: false }]); setKpiInput('') } }} className="rounded-lg bg-gray-100 px-3 text-sm">Add</button></div>
          </div>
        </Field>

        <Field label="Achievements">
          <div className="mb-1.5 flex flex-wrap gap-1.5">{achievements.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{a}<button onClick={() => setAchievements((xs) => xs.filter((_, j) => j !== i))}><X size={11} /></button></span>)}</div>
          <div className="flex gap-2"><input value={achInput} onChange={(e) => setAchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && achInput.trim()) { setAchievements((xs) => [...xs, achInput.trim()]); setAchInput('') } }} placeholder="e.g. Employee of the month" className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-sm" /><button onClick={() => { if (achInput.trim()) { setAchievements((xs) => [...xs, achInput.trim()]); setAchInput('') } }} className="rounded-lg bg-gray-100 px-3 text-sm">Add</button></div>
        </Field>

        <Field label="Actions taken">
          <div className="flex flex-wrap gap-1.5">{ACTION_OPTIONS.map((o) => { const on = actions.includes(o); return <button key={o} onClick={() => setActions((xs) => on ? xs.filter((x) => x !== o) : [...xs, o])} className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{o}</button> })}</div>
        </Field>

        <Field label={`Warnings at review time`}><p className="text-sm text-gray-600">{warningsCount ? `${warningsCount} active` : 'None'} <span className="text-[11px] text-gray-400">(from live record)</span></p></Field>

        <Field label="Manager notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 p-3 text-sm" placeholder="Summary of the month…" /></Field>

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      </div>
      <div className="sticky bottom-0 flex gap-2 border-t border-gray-100 bg-white px-5 py-4">
        <button onClick={onClose} className="rounded-full border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={busy} className="flex-1 rounded-full bg-[var(--color-brand)] py-3 text-base font-bold text-white shadow-[0_6px_16px_rgba(214,41,79,0.30)] hover:brightness-95 disabled:opacity-50">{busy ? 'Locking…' : 'Lock review'}</button>
      </div>
    </div>
  )
}

function Field({ label, children }) { return <div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">{label}</p>{children}</div> }
function Section({ title, sample, children }) { return <div><div className="mb-2.5 flex items-center gap-2"><p className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</p>{sample && <SampleTag />}</div>{children}</div> }
