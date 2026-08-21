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
  const [otherDraft, setOtherDraft] = useState('')
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
      setData(w); setAudit(a.entries || []); setOtherDraft(w.otherTitle || '')
      setSelDate((cur) => (cur && w.days.includes(cur) ? cur : w.today))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { if (lead) loadLead(lead) }, [lead])

  async function setObjectives(field, value) {
    const cur = data.objectivePick || { primary: '', supporting: '' }
    const next = { ...cur, [field]: value }
    try {
      await api('/workday/objectives', { method: 'POST', body: { username: lead, primary: next.primary, supporting: next.supporting } })
      loadLead(lead)
    } catch (e) { alert(e.message) }
  }
  async function saveOther() {
    try { await api('/workday/other', { method: 'POST', body: { username: lead, title: otherDraft.trim() } }); loadLead(lead) }
    catch (e) { alert(e.message) }
  }
  async function addFor(focusKey) {
    const text = (drafts[focusKey] || '').trim()
    if (!text) return
    try {
      await api('/workday/add', { method: 'POST', body: { username: lead, title: text, focusKey, date: selDate } })
      setDrafts((s) => ({ ...s, [focusKey]: '' }))
      loadLead(lead)
    } catch (e) { alert(e.message) }
  }

  if (error) return <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">Couldn't load — {error}</Card>
  if (!leads) return <div className="flex justify-center py-24"><Spinner size={28} /></div>
  if (!leads.length) return <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">No team leads yet.</Card>
  if (!data || !selDate) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const dayItems = data.planByDate[selDate] || []
  const itemsFor = (key) => dayItems.filter((i) => i.focusKey === key)
  const dayKeys = data.focusByDate?.[selDate] || { primary: data.focus[0]?.key, supporting: data.focus[1]?.key }
  const blockOf = (k) => data.focusBlocks?.[k] || data.focus.find((x) => x.key === k) || { key: k, title: k, metrics: [] }
  const sections = [
    ...[dayKeys.primary, dayKeys.supporting].filter(Boolean).map((k, i) => {
      const f = blockOf(k)
      return { key: k, label: `${i === 0 ? 'Primary' : 'Supporting'} — ${f.title}`, metrics: f.metrics || [], progress: selDate === data.today ? f.progress : null, note: data.objNotes?.[k] || '' }
    }),
    { key: 'other', label: null, metrics: [], progress: null, note: data.objNotes?.other || '' },
  ]
  const KEY_LABELS = { renewals: 'Renewals', sales: 'Sales', cases: 'Customer cases', online: 'Trackers online', reviews: 'Google reviews' }

  return (
    <div className="max-w-5xl space-y-7">
      <div>
        <h1 className="t-page">Team Workday</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{data.lead.name}'s plans, live — add to them, and read the full history below. Ticking stays his.</p>
        {leads.length > 1 && (
          <div className="mt-2 flex gap-2">
            {leads.map((l) => (
              <button key={l.lead.username} onClick={() => setLead(l.lead.username)} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${lead === l.lead.username ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>{l.lead.name}</button>
            ))}
          </div>
        )}
      </div>

      {/* the goals, always on top — all of them */}
      {data.week.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {data.week.map((w) => {
            const pct = w.target ? Math.min(100, Math.round(((w.actual || 0) / w.target) * 100)) : 0
            return (
              <div key={w.label} className="flex items-center gap-2">
                <span className="text-[11.5px] font-semibold text-[var(--color-ink-soft)]">{w.label}</span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-fill)]">
                  <span className={`block h-full rounded-full ${pct >= 66 ? 'bg-[var(--color-good-bg)]0' : pct >= 33 ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-bad)]'}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="text-[11.5px] font-semibold tabular-nums text-[var(--color-ink)]">{w.actual ?? '—'}{w.unit || `/${w.target}`}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* management items he did NOT do on their day */}
      {(data.adamaOverdue || []).length > 0 && (
        <div className="rounded-lg border border-[var(--color-bad-bg)] bg-[var(--color-bad-bg)] p-4">
          <p className="text-[13px] font-semibold text-[var(--color-bad)]">Your items he hasn't done:</p>
          <div className="mt-1 space-y-0.5">
            {data.adamaOverdue.map((o, i) => (
              <p key={i} className="text-[13px] text-[var(--color-bad)]">“{o.title}” — was for {new Date(`${o.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</p>
            ))}
          </div>
        </div>
      )}

      <DayStrip days={data.days} today={data.today} selDate={selDate} onSelect={setSelDate} planByDate={data.planByDate} />

      {/* objectives rotate daily; Adama can pin them here — only he can */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] bg-white px-4 py-3 text-[13px]">
        <span className="font-semibold text-[var(--color-ink-soft)]">Objectives:</span>
        {['primary', 'supporting'].map((field) => (
          <label key={field} className="flex items-center gap-1.5">
            <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{field}</span>
            <select
              value={(data.objectivePick || {})[field] || ''}
              onChange={(e) => setObjectives(field, e.target.value)}
              className="rounded-lg border border-[var(--color-line)] px-2 py-1 text-[13px]"
            >
              <option value="">Auto — rotates daily</option>
              {Object.entries({ renewals: 'Renewals', sales: 'Sales', cases: 'Customer cases', online: 'Trackers online', reviews: 'Google reviews' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        ))}
      </div>

      {sections.map((sec) => (
        <div key={sec.key} className="rounded-lg border border-[var(--color-line)] bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {sec.key === 'other' ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-base font-semibold text-[var(--color-ink)]">Other —</span>
                <input value={otherDraft} onChange={(e) => setOtherDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveOther()} onBlur={saveOther} placeholder="Name his other objective — e.g. Coaching" className="min-w-0 flex-1 border-0 border-b border-dashed border-[var(--color-line)] bg-transparent py-0.5 text-base font-semibold text-[var(--color-ink)] outline-none placeholder:font-medium placeholder:text-[var(--color-ink-faint)]" />
              </div>
            ) : (
              <h2 className="text-base font-semibold text-[var(--color-ink)]">{sec.label}</h2>
            )}
            {sec.metrics.length > 0 && (
              <span className="text-[11.5px] text-[var(--color-ink-soft)]">{sec.metrics.map((m) => `${m.label.toLowerCase()} ${m.value}`).join(' · ')}{sec.progress ? ` · today ${sec.progress.actual}/${sec.progress.goal}` : ''}</span>
            )}
          </div>
          <div className="mt-3 space-y-1">
            {itemsFor(sec.key).length === 0 && <p className="text-[13px] text-[var(--color-ink-faint)]">Nothing planned for this day.</p>}
            {itemsFor(sec.key).map((it) => (
              <div key={it.id} className="flex items-start gap-2 text-[13px]">
                <span className="mt-0.5 shrink-0">{it.done ? <CheckCircle2 size={16} className="text-[var(--color-good)]" /> : <Circle size={16} className="text-[var(--color-ink-faint)]" />}</span>
                <span className={`flex-1 ${it.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>
                  {it.title}
                  {it.byAdama && <span className="ml-2 rounded-full bg-[var(--color-bad-bg)] px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--color-bad)]">from you</span>}
                  {it.carried ? <span className="ml-2 rounded-full bg-[var(--color-warn-bg)] px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--color-warn)]">carried</span> : null}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-[var(--color-line-soft)] pt-2">
            <Plus size={14} className="shrink-0 text-[var(--color-ink-faint)]" />
            <input
              value={drafts[sec.key] || ''}
              onChange={(e) => setDrafts((s) => ({ ...s, [sec.key]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addFor(sec.key)}
              placeholder={`Add to his ${selDate === data.today ? 'today' : selDate} plan — Enter to send`}
              className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[13px] outline-none placeholder:text-[var(--color-ink-faint)]"
            />
          </div>
          <p className="mt-2 rounded-lg bg-[var(--color-fill)] px-2.5 py-2 text-[11.5px] text-[var(--color-ink-soft)]"><span className="font-semibold">His comment:</span> {sec.note || <span className="text-[var(--color-ink-faint)]">nothing written yet</span>}</p>
        </div>
      ))}

      {/* the timeline — nothing disappears quietly */}
      <div>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Timeline — every change, who and when</h2>
        <div className="rounded-lg border border-[var(--color-line)] bg-white">
          {(audit || []).length === 0 && <p className="p-5 text-center text-[13px] text-[var(--color-ink-faint)]">No activity logged yet.</p>}
          <div className="max-h-[28rem] divide-y divide-[var(--color-line-soft)] overflow-y-auto">
            {(audit || []).map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                <span className="w-24 shrink-0 text-[11.5px] tabular-nums text-[var(--color-ink-faint)]">{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} {timeShort(e.at)}</span>
                <span className={`w-20 shrink-0 text-[11.5px] font-semibold ${e.actor === 'adama' ? 'text-[var(--color-bad)]' : 'text-[var(--color-ink-soft)]'}`}>{e.actor === 'adama' ? 'You' : e.actor}</span>
                <span className={`flex-1 ${RED_FLAGS.has(e.action) ? 'font-semibold text-[var(--color-warn)]' : 'text-[var(--color-ink-soft)]'}`}>
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
