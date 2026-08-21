import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'

// WEEKLY REPORT — the shared Friday document (Adama 10 Jul). Momodou opens
// the exact same report Adama does; Monday's conversation starts from one
// truth. Everything derives from the week's real records — nothing is written
// by hand and nothing can be edited after the fact.

const KEY_TITLES = { renewals: 'Renewals', sales: 'Sales', cases: 'Customer cases', online: 'Trackers online', reviews: 'Google reviews', other: 'Other', quick: 'Other' }

function mondayOf(d) {
  const t = new Date(d); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}
function fmt(d) { return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }

export default function WeeklyReport() {
  const { user, hasPower } = useAuth()
  const isBoss = hasPower('hr')
  const [leads, setLeads] = useState(null)
  const [lead, setLead] = useState(null)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // week choices: this week + the previous 8
  const weeks = []
  { let m = new Date(`${mondayOf(new Date())}T00:00:00Z`)
    for (let i = 0; i < 9; i++) { weeks.push(m.toISOString().slice(0, 10)); m = new Date(m); m.setUTCDate(m.getUTCDate() - 7) } }

  useEffect(() => {
    if (!isBoss) { setLeads([]); setLead(user?.username); return }
    api('/workday/overview').then((d) => {
      setLeads(d.leads || [])
      if (d.leads?.length) setLead(d.leads[0].lead.username)
    }).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!lead) return
    setData(null)
    api(`/report/week?start=${weekStart}${isBoss ? `&username=${lead}` : ''}`)
      .then(setData).catch((e) => setError(e.message))
  }, [lead, weekStart])

  if (error) return <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'Weekly reports are for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const planKeys = Object.keys(data.plan)

  return (
    <div className="max-w-4xl space-y-7">
      <div>
        <h1 className="t-page">Weekly report</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{data.lead.name} · week of {fmt(data.week.start)} – {fmt(data.week.end)} · the same document for both of you.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {weeks.map((w) => (
            <button key={w} onClick={() => setWeekStart(w)} className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${w === weekStart ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
              {w === weeks[0] ? 'This week' : fmt(w)}
            </button>
          ))}
        </div>
      </div>

      {/* the goals — what this week added, where the month stands */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Goals</h2>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
          {data.goals.map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="w-40 text-[13px] font-semibold text-[var(--color-ink)]">{g.title}</span>
              <span className="text-[13px] tabular-nums text-[var(--color-ink-soft)]">this week: <span className="font-semibold text-[var(--color-ink)]">{g.weekDone != null ? `+${g.weekDone}` : '—'}</span></span>
              <span className="text-[13px] tabular-nums text-[var(--color-ink-soft)]">month: <span className="font-semibold text-[var(--color-ink)]">{g.actual ?? '—'}{g.unit === '%' ? '%' : ''}</span>{g.target != null ? ` of ${g.target}${g.unit === '%' ? '%' : ''}` : ''}</span>
              {g.target != null && g.actual != null && (
                <span className={`ml-auto text-[11.5px] font-semibold ${g.actual >= g.target ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>{g.actual >= g.target ? 'On target' : 'Behind'}</span>
              )}
            </div>
          ))}
        </Card>
        <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">"Month" columns show the live standing as of {new Date(data.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.</p>
      </section>

      {/* who held the chair each day */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Objectives by day</h2>
        <div className="flex flex-wrap gap-1.5">
          {data.objectivesByDay.map((d) => (
            <Card key={d.date} className="px-3 py-2 text-center">
              <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} {fmt(d.date)}</div>
              <div className="text-[11.5px] font-semibold text-[var(--color-ink)]">{KEY_TITLES[d.primary] || d.primary}</div>
              <div className="text-[11px] text-[var(--color-ink-soft)]">{KEY_TITLES[d.supporting] || d.supporting}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* plan discipline */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">His plan — written vs done</h2>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
          {planKeys.length === 0 && <p className="p-4 text-[13px] text-[var(--color-ink-faint)]">No plan written this week.</p>}
          {planKeys.map((k) => (
            <div key={k} className="flex items-center gap-4 px-4 py-3 text-[13px]">
              <span className="w-40 font-semibold text-[var(--color-ink)]">{KEY_TITLES[k] || k}</span>
              <span className="tabular-nums text-[var(--color-ink-soft)]"><span className="font-semibold text-[var(--color-ink)]">{data.plan[k].done}</span> done of {data.plan[k].total}</span>
              {data.plan[k].carried > 0 && <span className="text-[11.5px] font-semibold text-[var(--color-bad)]">{data.plan[k].carried} carried over</span>}
            </div>
          ))}
        </Card>
      </section>

      {/* management items */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-brand)]">From Adama</h2>
        <Card className="p-4 text-[13px]">
          {data.fromAdama.total === 0 ? (
            <p className="text-[var(--color-ink-faint)]">No management items this week.</p>
          ) : (
            <>
              <p className="font-semibold text-[var(--color-ink)]">{data.fromAdama.done} of {data.fromAdama.total} done.</p>
              {data.fromAdama.missed.map((m, i) => (
                <p key={i} className="mt-1 text-[var(--color-bad)]">Not done: “{m.title}” — was for {fmt(m.date)}</p>
              ))}
            </>
          )}
        </Card>
      </section>

      {/* his words */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">His comments</h2>
        <Card className="space-y-2 p-4 text-[13px]">
          {Object.keys(data.comments).length === 0 && <p className="text-[var(--color-ink-faint)]">No comments written this week.</p>}
          {Object.entries(data.comments).map(([k, text]) => (
            <p key={k}><span className="font-semibold text-[var(--color-ink)]">{KEY_TITLES[k] || k}:</span> <span className="text-[var(--color-ink-soft)]">{text}</span></p>
          ))}
        </Card>
      </section>

      {/* honesty notes */}
      {data.flags.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Worth asking about</h2>
          <Card className="space-y-1 p-4 text-[13px]">
            {data.flags.map((f, i) => (
              <p key={i} className="text-amber-700">{f.action === 'unticked' ? 'Unticked' : 'Removed'}: “{f.title}” · {fmt(f.at.slice(0, 10))}</p>
            ))}
          </Card>
        </section>
      )}

      {/* team attendance */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Team attendance</h2>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
          {data.attendance.map((a) => (
            <div key={a.name} className="flex items-center gap-4 px-4 py-2.5 text-[13px]">
              <span className="w-40 font-semibold text-[var(--color-ink)]">{a.name}</span>
              <span className="tabular-nums text-[var(--color-ink-soft)]">{a.worked}/{a.scheduled} days{a.late ? ` · ${a.late} late` : ''}</span>
              {a.scheduled > 0 && a.worked < a.scheduled && <span className="ml-auto text-[11.5px] font-semibold text-[var(--color-bad)]">{a.scheduled - a.worked} missed</span>}
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}
