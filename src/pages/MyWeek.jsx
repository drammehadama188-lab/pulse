import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, ChevronRight, Plus } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { greeting, firstName } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

// MY WORKDAY — the manager's workbench (Adama 9 Jul v3). Not a dashboard:
// Pulse prepares the day (Main focus 50% / Secondary 30% / Quick tasks 20%),
// he works from it — ticking steps, adding his own named items, receiving
// "From Adama" assignments, keeping private notes, closing with an End-of-Day
// note. Unfinished work rolls into tomorrow automatically.

const FOCUS_TONE = {
  0: { chip: 'bg-[var(--color-brand-50)] text-[var(--color-brand)]', bar: 'bg-[var(--color-brand)]' },
  1: { chip: 'bg-blue-50 text-blue-700', bar: 'bg-blue-500' },
}

export default function MyWeek() {
  const { isViewAs, ownerActing } = useAuth()
  const canAct = !isViewAs // real lead, or the owner acting
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null) // focusKey being added to
  const [addText, setAddText] = useState('')
  const [log, setLog] = useState('')
  const [logSaved, setLogSaved] = useState(false)
  const [notes, setNotes] = useState('')
  const notesTimer = useRef(null)

  async function load() {
    try {
      const d = await api('/workday')
      setData(d); setLog(d.log || ''); setNotes(d.notes || '')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function toggle(itemId) {
    try {
      const r = await api('/workday/toggle', { method: 'POST', body: { itemId } })
      setData((d) => ({ ...d, items: r.items }))
    } catch (e) { alert(e.message) }
  }
  async function addItem(focusKey) {
    if (!addText.trim()) return
    try {
      const r = await api('/workday/add', { method: 'POST', body: { title: addText.trim(), focusKey } })
      setData((d) => ({ ...d, items: r.items }))
      setAdding(null); setAddText('')
    } catch (e) { alert(e.message) }
  }
  async function toggleAssignment(id) {
    try {
      const r = await api(`/assignments/${id}/toggle`, { method: 'POST' })
      setData((d) => ({ ...d, fromAdama: d.fromAdama.map((a) => (a.id === id ? r.assignment : a)) }))
    } catch (e) { alert(e.message) }
  }
  async function saveLog() {
    try { await api('/workday/log', { method: 'POST', body: { text: log } }); setLogSaved(true); setTimeout(() => setLogSaved(false), 2000) }
    catch (e) { alert(e.message) }
  }
  function onNotes(text) {
    setNotes(text)
    if (!canAct) return
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => { api('/workday/notes', { method: 'POST', body: { text } }).catch(() => {}) }, 800)
  }

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'My Workday is for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const itemsFor = (key) => (data.items || []).filter((i) => i.focusKey === key)
  const quickItems = itemsFor('quick')
  const dateLabel = new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  return (
    <div className="space-y-7">
      {/* header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-ink)]">{greeting()}, {firstName(data.lead.name)} 👋</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{dateLabel} — Pulse prepared your day. Work it top to bottom.</p>
      </div>

      {/* focus blocks — 50 / 30 */}
      {data.focus.length === 0 && (
        <Card className="p-6 text-sm text-[var(--color-ink-soft)]">Nothing is behind target right now — quick tasks below, and push the month's goals further.</Card>
      )}
      {data.focus.map((f, i) => {
        const tone = FOCUS_TONE[i] || FOCUS_TONE[1]
        const steps = itemsFor(f.key)
        const pct = f.progress?.goal ? Math.min(100, Math.round(((f.progress.actual || 0) / f.progress.goal) * 100)) : null
        return (
          <Card key={f.key} className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${tone.chip}`}>{f.slot} · {f.share}% of today</span>
              <span className="text-lg font-bold text-[var(--color-ink)]">{f.title}</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{f.objective}</div>
            <div className="text-xs text-[var(--color-ink-faint)]">Because {f.because}.</div>
            {f.progress && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--color-ink-soft)]">Progress — {f.progress.unit}</span>
                  <span className="font-bold tabular-nums text-[var(--color-ink)]">{f.progress.actual}/{f.progress.goal}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-fill)]">
                  <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
            <div className="mt-3 space-y-1">
              {steps.map((it) => <ItemRow key={it.id} it={it} canAct={canAct} onToggle={() => toggle(it.id)} />)}
            </div>
            {canAct && (adding === f.key ? (
              <AddRow value={addText} onChange={setAddText} onAdd={() => addItem(f.key)} onCancel={() => { setAdding(null); setAddText('') }} />
            ) : (
              <button onClick={() => { setAdding(f.key); setAddText('') }} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"><Plus size={13} /> Add a step (e.g. “Call Musa”)</button>
            ))}
          </Card>
        )
      })}

      {/* quick tasks — the 20% */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--color-fill)] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--color-ink-soft)]">Quick tasks · {data.quickShare}%</span>
          <span className="text-lg font-bold text-[var(--color-ink)]">Keep the machine tidy</span>
        </div>
        <div className="mt-3 space-y-1">
          {quickItems.length === 0 && <p className="text-sm text-[var(--color-ink-faint)]">Nothing pending — clean slate.</p>}
          {quickItems.map((it) => <ItemRow key={it.id} it={it} canAct={canAct} onToggle={() => toggle(it.id)} />)}
        </div>
        {canAct && (adding === 'quick' ? (
          <AddRow value={addText} onChange={setAddText} onAdd={() => addItem('quick')} onCancel={() => { setAdding(null); setAddText('') }} />
        ) : (
          <button onClick={() => { setAdding('quick'); setAddText('') }} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"><Plus size={13} /> Add a task</button>
        ))}
      </Card>

      {/* from Adama — assignments, their own colour */}
      {data.fromAdama.length > 0 && (
        <Card className="border-l-4 border-[var(--color-brand)] p-5">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-brand)]">From Adama</h2>
          <div className="mt-2 space-y-1">
            {data.fromAdama.map((a) => (
              <button key={a.id} onClick={canAct ? () => toggleAssignment(a.id) : undefined} className={`flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left ${canAct ? 'hover:bg-[var(--color-paper)]' : 'cursor-default'}`}>
                <span className="mt-0.5 shrink-0">{a.done ? <CheckCircle2 size={17} className="text-[var(--color-good)]" /> : <Circle size={17} className="text-[var(--color-ink-faint)]" />}</span>
                <span className="min-w-0 flex-1">
                  <span className={`text-sm font-semibold ${a.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{a.title}</span>
                  {a.due && <span className="ml-2 text-xs font-semibold text-[var(--color-ink-faint)]">due {new Date(`${a.due}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* personal notes — scratchpad */}
      <Card className="p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">My notes</h2>
        <p className="mb-2 text-xs text-[var(--color-ink-faint)]">Your scratchpad — supplier to call, SIMs to order, anything. Saves by itself.</p>
        <textarea value={notes} onChange={(e) => onNotes(e.target.value)} disabled={!canAct} rows={4} placeholder="Write anything…" className="w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-sm" />
      </Card>

      {/* end of day */}
      <Card className="p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">End of day — what happened today?</h2>
        <p className="mb-2 text-xs text-[var(--color-ink-faint)]">A few honest lines. Adama reads this — it replaces the report meeting.</p>
        <textarea value={log} onChange={(e) => setLog(e.target.value)} disabled={!canAct} rows={3} placeholder="e.g. Renewed two customers, one asked for another week. Cases down from 18 to 11. Couldn't finish coaching Sally." className="w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-sm" />
        {canAct && (
          <div className="mt-2 flex items-center gap-2">
            <button onClick={saveLog} className="rounded-xl bg-[var(--color-ink)] px-4 py-2 text-sm font-bold text-white hover:opacity-90">Save</button>
            {logSaved && <span className="text-xs font-semibold text-[var(--color-good)]">Saved ✓</span>}
          </div>
        )}
      </Card>

      {/* this week */}
      {data.week.length > 0 && (
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">This month</h2>
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
      )}
    </div>
  )
}

function ItemRow({ it, canAct, onToggle }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-1.5 py-1">
      <button onClick={canAct ? onToggle : undefined} className={`mt-0.5 shrink-0 ${canAct ? '' : 'cursor-default'}`}>
        {it.done ? <CheckCircle2 size={17} className="text-[var(--color-good)]" /> : <Circle size={17} className="text-[var(--color-ink-faint)]" />}
      </button>
      <span className="min-w-0 flex-1">
        {it.to && !it.done ? (
          <Link to={it.to} className="text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]">{it.title} <ChevronRight size={12} className="inline" /></Link>
        ) : (
          <span className={`text-sm font-medium ${it.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{it.title}</span>
        )}
        {it.carried ? <span className="ml-2 rounded-full bg-[var(--color-bad-bg,#fef2f2)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-bad)]">from yesterday{it.carried > 1 ? ` · day ${it.carried + 1}` : ''}</span> : null}
      </span>
    </div>
  )
}

function AddRow({ value, onChange, onAdd, onCancel }) {
  return (
    <div className="mt-2 flex gap-1.5">
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAdd()} placeholder="e.g. Call Musa" className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-sm" />
      <button onClick={onAdd} className="rounded-lg bg-[var(--color-ink)] px-2.5 py-1.5 text-xs font-bold text-white">Add</button>
      <button onClick={onCancel} className="rounded-lg bg-[var(--color-fill)] px-2 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">✕</button>
    </div>
  )
}
