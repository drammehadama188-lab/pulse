import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UserCheck, Clock, Palmtree, FileText, Target, CalendarClock,
  TrendingUp, AlertTriangle, Building2, CircleSlash, MessageSquare, ChevronRight,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { Avatar, Card, Pill, SectionTitle, Spinner, StatCard } from '../components/ui.jsx'
import { timeShort, dateLong } from '../lib/format.js'

// MY TEAM · Team Dashboard — the page a team lead opens every morning. A SCOPED
// snapshot of the people they manage (Momodou → Ya Fatou, Kaddy, Sally; the
// Cleaner + CEO are never here). REAL data only: attendance from today's record,
// sales from agent-sales, score from locked reviews, contract end from the
// roster. Anything with no source yet shows an honest blank ("No review yet",
// "Not tracked") — never an invented number. As reviews get locked and the Admin
// KPI feed turns on, the blanks fill in.

const STATUS = {
  working: { label: 'Working', tone: 'good' },
  late: { label: 'Late', tone: 'warn' },
  done: { label: 'Checked out', tone: 'neutral' },
  leave: { label: 'On leave', tone: 'rest' },
  'not-in': { label: 'Not in yet', tone: 'neutral' },
}

const ATTN_ICON = {
  late: Clock,
  sales: TrendingUp,
  warning: AlertTriangle,
  contract: CalendarClock,
  leave: Palmtree,
  coaching: MessageSquare,
}

export default function TeamDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/team/overview')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>
  if (error) {
    return (
      <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">
        {error === 'not-a-team-lead' ? "You don't lead a team." : `Couldn't load your team — ${error}`}
      </Card>
    )
  }

  const { stats, attention, members } = data

  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-page">My Team</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{dateLong()} · {stats.total} {stats.total === 1 ? 'person' : 'people'}</p>
      </div>

      {/* TODAY — at-a-glance counts */}
      <div>
        <SectionTitle>Today</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard icon={UserCheck} tone="good" label="Present" value={`${stats.present} / ${stats.total}`} />
          <StatCard icon={Clock} tone="warn" label="Late" value={stats.late} />
          <StatCard icon={CircleSlash} tone="neutral" label="Not in yet" value={stats.notIn} />
          <StatCard icon={Palmtree} tone="brand" label="On leave" value={stats.onLeave} />
          <StatCard icon={FileText} tone="rest" label="Reviews due" value={stats.reviewsDue} />
          <StatCard icon={Target} tone="brand" label="Goals" value={stats.goalsPct == null ? '—' : `${stats.goalsPct}%`} sub={stats.goalsPct == null ? 'No targets tracked yet' : 'sales avg vs target'} />
          <StatCard icon={MessageSquare} tone="rest" label="Coaching (2-weekly)" value={`${stats.coachedThisPeriod} / ${stats.total}`} sub="checked in ≤ 14 days" />
          <StatCard icon={CalendarClock} tone="warn" label="Contracts ending" value={stats.contractsEndingSoon} sub="within 45 days" />
        </div>
      </div>

      {/* NEEDS MY ATTENTION — real signals only */}
      <div>
        <SectionTitle>Needs my attention today</SectionTitle>
        {attention.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-[var(--color-ink-faint)]">Nothing needs attention right now.</Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
            {attention.map((a, i) => {
              const Icon = ATTN_ICON[a.type] || AlertTriangle
              const clickable = !!a.to
              return (
                <button
                  key={i}
                  disabled={!clickable}
                  onClick={() => clickable && navigate(a.to)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5 ${clickable ? 'hover:bg-[var(--color-fill)]' : 'cursor-default'}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.type === 'warning' ? 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' : 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]'}`}>
                    <Icon size={16} />
                  </span>
                  <span className="text-[13px] text-[var(--color-ink)]">{a.message}</span>
                  {clickable && <ChevronRight size={16} className="ml-auto shrink-0 text-[var(--color-ink-faint)]" />}
                </button>
              )
            })}
          </Card>
        )}
      </div>

      {/* MY TEAM — per-person cards */}
      <div>
        <SectionTitle>My team</SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
          {members.map((m) => {
            const st = STATUS[m.status] || STATUS['not-in']
            return (
              <div
                key={m.username}
                onClick={() => navigate(`/team-member/${m.username}`)}
                className="flex cursor-pointer flex-col gap-3 px-4 py-4 transition-colors hover:bg-[var(--color-fill)] sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} size={42} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[var(--color-ink)]">{m.name}</div>
                    <div className="truncate text-[11.5px] text-[var(--color-ink-soft)]">{m.title} · {m.department}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Pill tone={st.tone} dot>{st.label}{m.checkIn && (m.status === 'working' || m.status === 'late') ? ` · ${timeShort(m.checkIn)}` : ''}</Pill>
                      {m.onOfficeNetwork === true && <span title="Checked in on the office network" className="text-[var(--color-good)]"><Building2 size={15} /></span>}
                      {m.onOfficeNetwork === false && <Pill tone="bad"><AlertTriangle size={12} /> Off-site</Pill>}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-5 pl-[54px] sm:pl-0">
                  <Metric label="Score" value={m.score == null ? '—' : `${m.score}%`} hint={m.score == null ? 'No review yet' : ''} />
                  <Metric
                    label="Goal"
                    value={!m.sales ? '—' : m.sales.actual == null ? '—' : `${m.sales.actual}/${m.sales.target ?? '?'}`}
                    hint={!m.sales ? (m.department === 'Sales' ? 'Not tracked' : 'Connecting to Admin') : m.sales.actual == null ? 'Connecting to Admin' : ''}
                  />
                  <Metric label="Warnings" value={m.warnings} tone={m.warnings > 0 ? 'bad' : 'good'} />
                </div>
              </div>
            )
          })}
        </Card>
        <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">
          Scores and other KPIs fill in as monthly reviews are locked and the Admin feed is connected — nothing here is a placeholder.
        </p>
      </div>
    </div>
  )
}

function Metric({ label, value, hint, tone }) {
  return (
    <div className="text-right">
      <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${tone === 'bad' ? 'text-[var(--color-bad)]' : tone === 'good' ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink)]'}`}>{value}</div>
      {hint && <div className="text-[10px] text-[var(--color-ink-faint)]">{hint}</div>}
    </div>
  )
}
