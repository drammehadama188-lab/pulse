import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Plus } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { timeShort } from '../lib/format.js'
import { DayStrip } from './MyWeek.jsx'

// TEAM WORKDAY (CEO) — Adama 10 Jul: "a page where I can monitor this, even
// contribute to the plan, and a timeline of what he is editing — I don't want
// him to cheat his way into the goals." Reads the lead's live workday, lets
// Adama drop items into any day (badged "from Adama" on the lead's screen),
// and shows the full audit trail: every add, edit, delete, tick and untick
// with the real actor and time.

const ACTION_TEXT = {
  added: (d) => `added “${d.title}” (${d.focusKey}) for ${d.date}`,
  edited: (d) => `edited “${d.from}” → “${d.to}” (${d.date})`,
  removed: (d) => `removed “${d.title}” (${d.date})`,
  ticked: (d) => `ticked “${d.title}”`,
  unticked: (d) => `UNTICKED “${d.title}”`,
  comment: (d) => `commented on ${d.key}: “${d.text}”`,
  'other-objective': (d) => `set Other objective to “${d.title}”`,
}
const RED_FLAGS = new Set(['removed', 'unticked'])

export default function WorkdayMonitor() {
  const [leads, setLeads] = useState(null)
  const [lead, setLead] = useState(null) // username
  const [data, setData] = useState(null)
  const [audit, setAudit] = useState(null)
  const [selDate, setSelDate] = useState(null)
  const [drafts, setDrafts] = useState({}) // focusKey -> text
  const [error, setError] = useState('')

  useEffect(() => {
    api('/workday/overview').then((d) => {
      setLeads(d.leads || [])
      if (d.leads?.length) setLead(d.leads[0].lead.username)
    }).catch((e) => setError(e.message))
  }, [])

  async function loadLead(u) {
    try {
      const [w, a] = await Promise.all([
        api(`/workday?username=${u}`),
        api(`/workday/audit?username=${u}`),
      ])
      setData(w); setAudit(a.entries || [])
      setSelDate((cur) => (cur && w.days.includes(cur) ? cur : w.today))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { if (lead) loadLead(lead) }, [lead])

  async function addFor(focusKey) {
    const text = (drafts[focusKey] || '').trim()
    if (!text) return
    try {
      await api('/workday/add', { method: 'POST', body: { username: lead, title: text, focusKey, date: selDate } })
      setDrafts((s) => ({ ...s, [focusKey]: '' }))
      loadLead(lead)
    } catch (e) { alert(e.message) }
  }

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">Couldn't load — {error}</Card>
  if (!leads) return <div className="flex justify-center py-24"><Spinner size={28} /></div>
  if (!leads.length) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">No team leads yet.</Card>
  if (!data || !selDate) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const dayItems = data.planByDate[selDate] || []
  const itemsFor = (key) => dayItems.filter((i) => i.focusKey === key)
  const sections = [
    ...data.focus.map((f, i) => ({ key: f.key, label: `${i === 0 ? 'Primary' : 'Supporting'} — ${f.title}`, metrics: f.metrics, progress: f.progress, note: data.objNotes?.[f.key] || '' })),
    { key: 'other', label: `Other — ${data.otherTitle || 'not named yet'}`, metrics: [], progress: null, note: data.objNotes?.other || '' },
  ]

  return (
    <div className="max-w-5xl space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900">Team Workday</h1>
        <p className="mt-1 text-gray-500">{data.lead.name}'s plans, live — add to them, and read the full history below. Ticking stays his.</p>
        {leads.length > 1 && (
          <div className="mt-2 flex gap-2">
            {leads.map((l) => (
              <button key={l.lead.username} onClick={() => setLead(l.lead.username)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${lead === l.lead.username ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>{l.lead.name}</button>
            ))}
          </div>
        )}
      </div>

      <DayStrip days={data.days} today={data.today} selDate={selDate} onSelect={setSelDate} planByDate={data.planByDate} />

      {sections.map((sec) => (
        <div key={sec.key} className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-gray-900">{sec.label}</h2>
            {sec.metrics.length > 0 && (
              <span className="text-xs text-gray-500">{sec.metrics.map((m) => `${m.label.toLowerCase()} ${m.value}`).join(' · ')}{sec.progress ? ` · today ${sec.progress.actual}/${sec.progress.goal}` : ''}</span>
            )}
          </div>
          <div className="mt-3 space-y-1">
            {itemsFor(sec.key).length === 0 && <p className="text-sm text-gray-400">Nothing planned for this day.</p>}
            {itemsFor(sec.key).map((it) => (
              <div key={it.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0">{it.done ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} className="text-gray-300" />}</span>
                <span className={`flex-1 ${it.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                  {it.title}
                  {it.byAdama && <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">from you</span>}
                  {it.carried ? <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">carried</span> : null}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
            <Plus size={14} className="shrink-0 text-gray-400" />
            <input
              value={drafts[sec.key] || ''}
              onChange={(e) => setDrafts((s) => ({ ...s, [sec.key]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addFor(sec.key)}
              placeholder={`Add to his ${selDate === data.today ? 'today' : selDate} plan — Enter to send`}
              className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-gray-400"
            />
          </div>
          {sec.note && <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-xs text-gray-600"><span className="font-semibold">His comment:</span> {sec.note}</p>}
        </div>
      ))}

      {/* the timeline — nothing disappears quietly */}
      <div>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-gray-400">Timeline — every change, who and when</h2>
        <div className="rounded-2xl border border-gray-200 bg-white">
          {(audit || []).length === 0 && <p className="p-6 text-center text-sm text-gray-400">No activity logged yet.</p>}
          <div className="max-h-[28rem] divide-y divide-gray-50 overflow-y-auto">
            {(audit || []).map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-xs tabular-nums text-gray-400">{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} {timeShort(e.at)}</span>
                <span className={`w-20 shrink-0 text-xs font-bold ${e.actor === 'adama' ? 'text-red-600' : 'text-gray-600'}`}>{e.actor === 'adama' ? 'You' : e.actor}</span>
                <span className={`flex-1 ${RED_FLAGS.has(e.action) ? 'font-semibold text-amber-700' : 'text-gray-700'}`}>
                  {(ACTION_TEXT[e.action] || (() => e.action))(e.detail || {})}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
