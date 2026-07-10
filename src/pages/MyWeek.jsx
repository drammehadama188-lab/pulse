import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { greeting, firstName } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

// MY WEEK v2 — the team lead's operating system (Adama 9 Jul: "don't make him
// plan, make Pulse think"). Everything on this page DERIVES live from the
// goals: priorities stay up until the metric moves, Waiting For Me items
// vanish when done, wins are real deltas vs yesterday. Nothing to fill in.

const TIER = {
  high: { chip: '🔥 HIGH', ring: 'ring-2 ring-[var(--color-bad)]', text: 'text-[var(--color-bad)]' },
  medium: { chip: '🟠 MEDIUM', ring: 'ring-1 ring-amber-300', text: 'text-amber-600' },
  low: { chip: '🟡 LOW', ring: '', text: 'text-[var(--color-ink-soft)]' },
}
const DOT = { green: '🟢', amber: '🟡', red: '🔴', unknown: '⚪' }
const HEALTH_WORD = { green: 'On track', amber: 'Needs attention', red: 'Behind', unknown: 'Connecting' }

export default function MyWeek() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/myweek').then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'My Week is for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const n = data.priorities.length

  return (
    <div className="space-y-7">
      {/* header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-ink)]">{greeting()}, {firstName(data.lead.name)} 👋</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">
          {n === 0 ? 'Nothing is on fire — everything is on track.' : `${n} priorit${n === 1 ? 'y needs' : 'ies need'} your attention.`}
        </p>
      </div>

      {/* today's priorities — the system decided, he executes */}
      {n > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          {data.priorities.map((p) => {
            const t = TIER[p.tier] || TIER.low
            return (
              <Card key={p.key} className={`flex flex-col p-5 ${t.ring}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className={`text-[11px] font-extrabold tracking-wide ${t.text}`}>{t.chip} · PRIORITY {p.n}</span>
                </div>
                <div className="text-lg font-bold leading-tight text-[var(--color-ink)]">{p.title}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tabular-nums text-[var(--color-ink)]">{p.metric}</span>
                  {p.sub && <span className="text-xs text-[var(--color-ink-faint)]">{p.sub}</span>}
                </div>
                <p className="mt-2 flex-1 text-sm text-[var(--color-ink-soft)]"><span className="font-semibold">Why:</span> {p.why}</p>
                <Link to={p.action.to} className="mt-4 inline-flex items-center justify-center gap-1 rounded-xl bg-[var(--color-ink)] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90">
                  {p.action.label} <ChevronRight size={15} />
                </Link>
              </Card>
            )
          })}
        </div>
      )}

      {/* waiting for me — only things a manager can do; each disappears when done */}
      {data.waiting.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Waiting for me</h2>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
            {data.waiting.map((w, i) => (
              <Link key={i} to={w.to} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-paper)]">
                <span className="text-sm font-medium text-[var(--color-ink)]">{w.title}</span>
                <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-faint)]" />
              </Link>
            ))}
          </Card>
        </div>
      )}

      {/* team health — one glance, no thinking */}
      <div>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Team health</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {data.health.map((h) => (
            <Card key={h.area} className="p-3">
              <div className="text-xs font-semibold text-[var(--color-ink-soft)]">{h.area}</div>
              <div className="mt-1 text-sm font-bold text-[var(--color-ink)]">{DOT[h.status]} {HEALTH_WORD[h.status]}</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{h.line}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* today's wins — real deltas only */}
      {data.wins.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Today's progress</h2>
          <Card className="space-y-2 p-4">
            {data.wins.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                <CheckCircle2 size={15} className="shrink-0 text-[var(--color-good)]" /> {w}
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* this week — the goal bars */}
      {data.week.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">This month</h2>
          <Card className="space-y-4 p-5">
            {data.week.map((w) => {
              const pct = w.target ? Math.min(100, Math.round(((w.actual || 0) / w.target) * 100)) : 0
              return (
                <div key={w.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-semibold text-[var(--color-ink)]">{w.label}</span>
                    <span className="tabular-nums text-[var(--color-ink-soft)]">{w.actual ?? '—'}{w.unit || ''}{w.unit ? '' : ` / ${w.target}`}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-fill)]">
                    <div className={`h-full rounded-full ${pct >= 66 ? 'bg-[var(--color-good)]' : pct >= 33 ? 'bg-amber-400' : 'bg-[var(--color-bad)]'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </Card>
        </div>
      )}
    </div>
  )
}
