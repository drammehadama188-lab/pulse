import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, AlertTriangle, CheckCircle2, Clock, ChevronRight, Search, CalendarClock, Repeat } from 'lucide-react'
import { team } from '../data/team'
import { api } from '../lib/api.js'

// Contracts — answers ONE question: "which contracts need my attention today?".
// The deep detail (full employment record) lives on the employee's profile
// (/agents/:slug). Every number here is real (team.js HR roster + live
// performance score); nothing is invented.

const DAY = 86400000
const now = new Date()
const slugify = (n) => n.toLowerCase().replace(/\s+/g, '-')
const daysLeft = (end) => (end ? Math.ceil((new Date(`${end}T00:00:00`) - now) / DAY) : null)
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(`${s}T00:00:00`); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
// `joined` is sometimes a month-year ("Oct 2025") and sometimes an ISO date.
const fmtStart = (s) => { if (!s) return '—'; return /^\d{4}-\d{2}-\d{2}/.test(s) ? fmtDate(s) : s }

function contractKind(t) {
  const c = (t.contract || '').toLowerCase()
  if (t.status === 'probation' || t.status === 'training') return 'Probation'
  if (!t.contractEnd || c.includes('indefinite') || c.includes('permanent')) return 'Permanent'
  return 'Fixed term'
}

// Real status badge from the contract's dates + the person's status.
function statusBadge(t) {
  const d = daysLeft(t.contractEnd)
  if (t.status === 'probation' || t.status === 'training') return { label: 'Probation', cls: 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]', dot: 'var(--color-rest)' }
  if (!t.contractEnd) return { label: 'Permanent', cls: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', dot: 'var(--color-good)' }
  if (d < 0) return { label: 'Expired', cls: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]', dot: 'var(--color-bad)' }
  if (d <= 30) return { label: 'Expiring soon', cls: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]', dot: 'var(--color-warn)' }
  return { label: 'Active', cls: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', dot: 'var(--color-good)' }
}

// Recommendation from the real score + time left. Never fabricated — falls back
// to "Review" when there's no score yet.
function recommend(t, score) {
  const d = daysLeft(t.contractEnd)
  if (d == null) return null
  if (d < 0) return { label: 'Confirm, extend or end', tone: 'bad' }
  if (score != null && score >= 80) return { label: 'Renew', tone: 'good' }
  if (score != null && score < 55) return { label: 'Review — underperforming', tone: 'bad' }
  return { label: 'Review', tone: 'ink' }
}

function StatCard({ label, value, tone }) {
  const c = {
    good: 'text-[var(--color-good)]', warn: 'text-[var(--color-warn)]', bad: 'text-[var(--color-bad)]',
    blue: 'text-[#1d4ed8]', rest: 'text-[var(--color-rest)]', ink: 'text-[var(--color-ink)]',
  }[tone || 'ink']
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{label}</p>
      <p className={`mt-0.5 text-[26px] font-semibold tabular-nums ${c}`}>{value}</p>
    </div>
  )
}

export default function Contracts() {
  const navigate = useNavigate()
  // Live contract truth (renew/extend/terminate live in the contracts store —
  // the static roster never changes). Terminated people leave this page; real
  // end dates override the seed (Adama 20 Jul: terminated still said Active).
  const [live, setLive] = useState(null)
  useEffect(() => { api('/contracts').then((d) => setLive(d.contracts || {})).catch(() => setLive({})) }, [])
  const roster = useMemo(() => team
    .filter((t) => t.status !== 'maternity')
    .filter((t) => (live?.[t.name]?.status) !== 'terminated')
    .map((t) => {
      const c = live?.[t.name]
      return c && c.end !== undefined ? { ...t, contractEnd: c.end } : t
    }), [live])
  const [scores, setScores] = useState({})
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all(roster.map((t) => api(`/employee-profile?name=${encodeURIComponent(t.name)}`).then((d) => ({ name: t.name, p: d.profile || {} })).catch(() => ({ name: t.name, p: {} }))))
      .then((rows) => { if (!alive) return; const next = {}; for (const { name, p } of rows) { const raw = p.performanceScore; next[name] = raw === '' || raw == null ? null : Number(raw) } setScores(next) })
    return () => { alive = false }
  }, [roster])

  const scoreOf = (t) => scores[t.name] ?? (typeof t.performance === 'number' ? t.performance : null)

  const stats = useMemo(() => {
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    let active = 0, expMonth = 0, exp90 = 0, permanent = 0, probation = 0
    for (const t of roster) {
      const kind = contractKind(t)
      active++
      if (kind === 'Permanent') permanent++
      if (kind === 'Probation') probation++
      const d = daysLeft(t.contractEnd)
      if (t.contractEnd && t.contractEnd.startsWith(thisMonth) && d >= 0) expMonth++
      if (d != null && d >= 0 && d <= 90) exp90++
    }
    return { active, expMonth, exp90, permanent, probation }
  }, [roster])

  // Sort: expired first, then soonest-ending, then permanent/no-end last.
  const list = useMemo(() => {
    const arr = roster.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
    return arr.sort((a, b) => {
      const da = daysLeft(a.contractEnd), db = daysLeft(b.contractEnd)
      if (da == null && db == null) return 0
      if (da == null) return 1
      if (db == null) return -1
      return da - db
    })
  }, [roster, q])

  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-page">Contracts</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Which contracts need your attention — renew, extend or let expire</p>
      </div>

      {/* Top cards — the situation at a glance */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Active contracts" value={stats.active} tone="ink" />
        <StatCard label="Expiring this month" value={stats.expMonth} tone={stats.expMonth ? 'warn' : 'ink'} />
        <StatCard label="Expiring in 90 days" value={stats.exp90} tone={stats.exp90 ? 'warn' : 'ink'} />
        <StatCard label="Permanent" value={stats.permanent} tone="good" />
        <StatCard label="Probation" value={stats.probation} tone="rest" />
      </div>

      <div className="relative w-full sm:w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-[13px] focus:border-[var(--color-ink-faint)] focus:outline-none" />
      </div>

      {/* Contract cards */}
      <div className="space-y-3">
        {list.map((t) => {
          const d = daysLeft(t.contractEnd)
          const sb = statusBadge(t)
          const score = scoreOf(t)
          const rec = recommend(t, score)
          const recTone = { good: 'text-[var(--color-good)]', bad: 'text-[var(--color-bad)]', ink: 'text-[var(--color-ink-soft)]' }[rec?.tone || 'ink']
          const urgent = d != null && d <= 30
          return (
            <div key={t.name} className={`rounded-lg border bg-[var(--color-surface)] p-4 ${urgent ? 'border-[var(--color-warn)]/50' : 'border-[var(--color-line)]'}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {/* days-left badge */}
                  <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg text-center ${d == null ? 'bg-[var(--color-good-bg)] text-[var(--color-good)]' : d < 0 ? 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' : d <= 30 ? 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
                    {d == null ? <CheckCircle2 size={22} /> : <><span className="text-[15px] font-semibold leading-none tabular-nums">{Math.abs(d)}</span><span className="text-[9px] font-semibold uppercase">{d < 0 ? 'days ago' : 'days'}</span></>}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-[var(--color-ink)]">{t.name}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sb.cls}`}><i className="h-1.5 w-1.5 rounded-full" style={{ background: sb.dot }} />{sb.label}</span>
                    </div>
                    <p className="text-[13px] text-[var(--color-ink-soft)]">{t.role} · {t.contract || contractKind(t)}</p>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[11.5px]">
                      <div><span className="text-[var(--color-ink-faint)]">Started </span><span className="font-semibold text-[var(--color-ink)]">{fmtStart(t.joined)}</span></div>
                      <div><span className="text-[var(--color-ink-faint)]">Ends </span><span className="font-semibold text-[var(--color-ink)]">{t.contractEnd ? fmtDate(t.contractEnd) : 'No end date'}</span></div>
                      <div><span className="text-[var(--color-ink-faint)]">Performance </span><span className="font-semibold text-[var(--color-ink)]">{score == null ? '—' : `${score}%`}</span></div>
                      {rec && <div><span className="text-[var(--color-ink-faint)]">Recommendation </span><span className={`font-semibold ${recTone}`}>{rec.label}</span></div>}
                    </div>
                  </div>
                </div>
                <button onClick={() => navigate(`/agents/${slugify(t.name)}`)} className="inline-flex items-center gap-1.5 self-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-line)]">
                  Review contract <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-[var(--color-ink-faint)]">Click <strong>Review contract</strong> to open the employee's full employment record — contract, salary, performance, warnings, history and documents.</p>
    </div>
  )
}
