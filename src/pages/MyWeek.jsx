import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Plus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { greeting, firstName } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

// MY WORKDAY v5 — the manager's desk. The system shows reality (metrics, live
// progress); the PLAN is his to write. Primary objective dominates the page;
// everything else is quieter. Carry Forward hands unfinished thinking to
// tomorrow; items roll over on their own.

const dayAfter = (key) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

export default function MyWeek() {
  const { isViewAs } = useAuth()
  const canAct = !isViewAs
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [carry, setCarry] = useState('')
  const [carrySaved, setCarrySaved] = useState(false)
  const notesTimer = useRef(null)

  async function load() {
    try {
      const d = await api('/workday')
      setData(d); setNotes(d.notes || ''); setCarry(d.carry || '')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function toggle(itemId) {
    try { const r = await api('/workday/toggle', { method: 'POST', body: { itemId } }); setData((d) => ({ ...d, items: r.items })) }
    catch (e) { alert(e.message) }
  }
  async function remove(itemId) {
    try { const r = await api('/workday/remove', { method: 'POST', body: { itemId } }); setData((d) => ({ ...d, items: r.items })) }
    catch (e) { alert(e.message) }
  }
  async function add(title, focusKey, date) {
    try {
      const r = await api('/workday/add', { method: 'POST', body: { title, focusKey, date } })
      setData((d) => (r.date === d.today ? { ...d, items: r.items } : { ...d, tomorrowItems: r.items }))
    } catch (e) { alert(e.message) }
  }
  async function toggleAssignment(id) {
    try {
      const r = await api(`/assignments/${id}/toggle`, { method: 'POST' })
      setData((d) => ({ ...d, fromAdama: d.fromAdama.map((a) => (a.id === id ? r.assignment : a)) }))
    } catch (e) { alert(e.message) }
  }
  async function saveCarry() {
    try { await api('/workday/carry', { method: 'POST', body: { text: carry } }); setCarrySaved(true); setTimeout(() => setCarrySaved(false), 2000) }
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

  const dateLabel = new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const itemsFor = (key, list) => (list || []).filter((i) => i.focusKey === key)

  return (
    <div className="space-y-8">
      {/* header + always-visible month strip */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-ink)]">{greeting()}, {firstName(data.lead.name)} 👋</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{dateLabel}</p>
        {data.week.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {data.week.map((w) => {
              const pct = w.target ? Math.min(100, Math.round(((w.actual || 0) / w.target) * 100)) : 0
              return (
                <div key={w.label} className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--color-ink-soft)]">{w.label}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-fill)]">
                    <span className={`block h-full rounded-full ${pct >= 66 ? 'bg-[var(--color-good)]' : pct >= 33 ? 'bg-amber-400' : 'bg-[var(--color-bad)]'}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-xs font-bold tabular-nums text-[var(--color-ink)]">{w.actual ?? '—'}{w.unit || `/${w.target}`}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* objectives — the system shows reality, HE writes the plan */}
      {data.focus.length === 0 && (
        <Card className="p-6 text-sm text-[var(--color-ink-soft)]">Nothing is behind target — Admin &amp; Follow-ups below, and push the month further.</Card>
      )}
      {data.focus.map((f, i) => (
        <ObjectiveCard
          key={f.key} f={f} primary={i === 0} data={data} canAct={canAct}
          items={itemsFor(f.key, data.items)} tomorrowItems={itemsFor(f.key, data.tomorrowItems)}
          onToggle={toggle} onRemove={remove} onAdd={add}
        />
      ))}

      {/* admin & follow-ups */}
      <section>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Admin &amp; Follow-ups</h2>
        <PlanArea
          items={itemsFor('quick', data.items)} tomorrowItems={itemsFor('quick', data.tomorrowItems)}
          canAct={canAct} today={data.today} focusKey="quick" placeholder="e.g. Call supplier"
          onToggle={toggle} onRemove={remove} onAdd={add} quiet
        />
      </section>

      {/* from Adama */}
      {data.fromAdama.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-brand)]">From Adama</h2>
          <div className="space-y-1 border-l-2 border-[var(--color-brand)] pl-3">
            {data.fromAdama.map((a) => (
              <button key={a.id} onClick={canAct ? () => toggleAssignment(a.id) : undefined} className={`flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left ${canAct ? 'hover:bg-[var(--color-paper)]' : 'cursor-default'}`}>
                <span className="mt-0.5 shrink-0">{a.done ? <CheckCircle2 size={16} className="text-[var(--color-good)]" /> : <Circle size={16} className="text-[var(--color-ink-faint)]" />}</span>
                <span className={`text-sm font-medium ${a.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{a.title}{a.due ? <span className="ml-2 text-xs font-semibold text-[var(--color-ink-faint)]">due {new Date(`${a.due}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span> : null}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* working notes */}
      <section>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Working notes</h2>
        <textarea value={notes} onChange={(e) => onNotes(e.target.value)} disabled={!canAct} rows={4} placeholder="Your desk scratchpad — supplier to call, SIMs to order… saves by itself." className="w-full rounded-xl border border-[var(--color-line-soft)] bg-transparent px-3 py-2.5 text-sm" />
      </section>

      {/* carry forward */}
      <section>
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Carry forward</h2>
        <p className="mb-2 text-xs text-[var(--color-ink-faint)]">What still needs attention tomorrow? Each line becomes an item on tomorrow's list.</p>
        <textarea value={carry} onChange={(e) => setCarry(e.target.value)} disabled={!canAct} rows={3} placeholder={'Waiting for Access Bank payment\nMusa requested invoice\nSally needs coaching'} className="w-full rounded-xl border border-[var(--color-line-soft)] bg-transparent px-3 py-2.5 text-sm" />
        {canAct && (
          <div className="mt-2 flex items-center gap-2">
            <button onClick={saveCarry} className="rounded-xl bg-[var(--color-ink)] px-4 py-2 text-sm font-bold text-white hover:opacity-90">Save</button>
            {carrySaved && <span className="text-xs font-semibold text-[var(--color-good)]">Saved — it'll be on tomorrow's list ✓</span>}
          </div>
        )}
      </section>
    </div>
  )
}

// One objective: metrics = context, the writing area = the hero.
function ObjectiveCard({ f, primary, data, canAct, items, tomorrowItems, onToggle, onRemove, onAdd }) {
  return (
    <section className={primary ? '' : 'opacity-95'}>
      {primary ? (
        <div className="border-t-4 border-[var(--color-brand)] pt-3">
          <div className="text-xs font-extrabold uppercase tracking-widest text-[var(--color-brand)]">{f.slot}</div>
          <h2 className="mt-0.5 text-2xl font-extrabold text-[var(--color-ink)]">{f.title}</h2>
        </div>
      ) : (
        <div className="border-t border-[var(--color-line)] pt-3">
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-ink-faint)]">{f.slot}</div>
          <h2 className="mt-0.5 text-lg font-bold text-[var(--color-ink)]">{f.title}</h2>
        </div>
      )}

      {/* reality — metrics only, no instructions */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {f.metrics.map((m) => (
          <div key={m.label}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{m.label}</div>
            <div className={`font-extrabold tabular-nums text-[var(--color-ink)] ${primary ? 'text-xl' : 'text-base'}`}>{m.value}</div>
          </div>
        ))}
        {f.agents && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Agents</div>
            <div className={`font-semibold text-[var(--color-ink)] ${primary ? 'text-base' : 'text-sm'}`}>{f.agents.map((a) => `${a.name} ${a.won}`).join(' · ')}</div>
          </div>
        )}
      </div>

      {/* his plan — the writing area is the centre */}
      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">My plan</div>
        <PlanArea
          items={items} tomorrowItems={tomorrowItems} canAct={canAct} today={data.today}
          focusKey={f.key} placeholder={f.key === 'renewals' ? 'e.g. Call Musa' : 'e.g. Sit with Sally on her pipeline'}
          onToggle={onToggle} onRemove={onRemove} onAdd={onAdd}
        />
      </div>

      {f.progress && (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Progress today: <span className="font-extrabold tabular-nums text-[var(--color-ink)]">{f.progress.actual}/{f.progress.goal}</span> {f.progress.unit}
        </p>
      )}
    </section>
  )
}

// The writing area: his items for today (or tomorrow), an always-open add
// line, tick to complete, ✕ to remove (auto items stay removed).
function PlanArea({ items, tomorrowItems, canAct, today, focusKey, placeholder, onToggle, onRemove, onAdd, quiet }) {
  const [when, setWhen] = useState('today')
  const [text, setText] = useState('')
  const list = when === 'today' ? items : tomorrowItems
  const date = when === 'today' ? today : dayAfter(today)

  function submit() {
    if (!text.trim()) return
    onAdd(text.trim(), focusKey, date)
    setText('')
  }

  return (
    <div className={quiet ? '' : 'rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4'}>
      {canAct && (
        <div className="mb-2 flex gap-1 text-[11px] font-bold">
          {['today', 'tomorrow'].map((w) => (
            <button key={w} onClick={() => setWhen(w)} className={`rounded-full px-2.5 py-1 uppercase tracking-wide ${when === w ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>{w}</button>
          ))}
        </div>
      )}
      <div className="space-y-0.5">
        {list.length === 0 && <p className="py-1 text-sm text-[var(--color-ink-faint)]">{when === 'today' ? 'Nothing planned yet — write your first action below.' : 'Nothing planned for tomorrow yet.'}</p>}
        {list.map((it) => (
          <div key={it.id} className="group flex items-start gap-2 rounded-lg px-1 py-1">
            <button onClick={canAct && when === 'today' ? () => onToggle(it.id) : undefined} className={`mt-0.5 shrink-0 ${canAct && when === 'today' ? '' : 'cursor-default'}`}>
              {it.done ? <CheckCircle2 size={17} className="text-[var(--color-good)]" /> : <Circle size={17} className="text-[var(--color-ink-faint)]" />}
            </button>
            <span className="min-w-0 flex-1">
              {it.to && !it.done ? (
                <Link to={it.to} className="text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]">{it.title}</Link>
              ) : (
                <span className={`text-sm font-medium ${it.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{it.title}</span>
              )}
              {it.carried ? <span className="ml-2 rounded-full bg-[var(--color-bad-bg,#fef2f2)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-bad)]">from yesterday</span> : null}
            </span>
            {canAct && when === 'today' && (
              <button onClick={() => onRemove(it.id)} title="Remove" className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-bad)] group-hover:opacity-100"><X size={14} /></button>
            )}
          </div>
        ))}
      </div>
      {canAct && (
        <div className="mt-1.5 flex items-center gap-2">
          <Plus size={15} className="shrink-0 text-[var(--color-ink-faint)]" />
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={`${placeholder} — Enter to add${when === 'tomorrow' ? ' for tomorrow' : ''}`} className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-ink-faint)]" />
        </div>
      )}
    </div>
  )
}
