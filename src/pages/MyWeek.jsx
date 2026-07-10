import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Flag, Plus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { greeting, firstName } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

// MY WORKDAY v6 — two objectives, different owners (Adama 9 Jul). The
// BUSINESS objective is assigned by the goals: he can't delete or rename it,
// only work it; when its month-goal is met the next-most-behind goal takes
// its place. HIS objective is one slot he writes and carries until HE marks
// it finished. Each objective carries its own note — no general notes pile.

const dayAfter = (key) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

export default function MyWeek() {
  const { isViewAs } = useAuth()
  const canAct = !isViewAs
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const noteTimers = useRef({})
  const [objNotes, setObjNotes] = useState({})
  const [ownNote, setOwnNote] = useState('')
  const [ownTitle, setOwnTitle] = useState('')

  async function load() {
    try {
      const d = await api('/workday')
      setData(d)
      setObjNotes(d.objNotes || {})
      setOwnNote(d.ownObjective?.note || '')
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
  function saveObjNote(key, text) {
    setObjNotes((n) => ({ ...n, [key]: text }))
    if (!canAct) return
    clearTimeout(noteTimers.current[key])
    noteTimers.current[key] = setTimeout(() => { api('/workday/objnote', { method: 'POST', body: { key, text } }).catch(() => {}) }, 800)
  }
  function saveOwnNote(text) {
    setOwnNote(text)
    if (!canAct) return
    clearTimeout(noteTimers.current.own)
    noteTimers.current.own = setTimeout(() => { api('/workday/own/note', { method: 'POST', body: { text } }).catch(() => {}) }, 800)
  }
  async function createOwn() {
    if (!ownTitle.trim()) return
    try { const r = await api('/workday/own', { method: 'POST', body: { title: ownTitle.trim() } }); setData((d) => ({ ...d, ownObjective: r.ownObjective })); setOwnTitle('') }
    catch (e) { alert(e.message) }
  }
  async function finishOwn() {
    try { await api('/workday/own/finish', { method: 'POST' }); setData((d) => ({ ...d, ownObjective: null })); setOwnNote('') }
    catch (e) { alert(e.message) }
  }

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'My Workday is for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const dateLabel = new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const itemsFor = (key, list) => (list || []).filter((i) => i.focusKey === key)
  const biz = data.focus[0] || null

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

      {/* THE business objective — assigned by the goals, not negotiable */}
      {biz ? (
        <section>
          <div className="border-t-4 border-[var(--color-brand)] pt-3">
            <div className="text-xs font-extrabold uppercase tracking-widest text-[var(--color-brand)]">Business objective</div>
            <h2 className="mt-0.5 text-2xl font-extrabold text-[var(--color-ink)]">{biz.title}</h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {biz.metrics.map((m) => (
              <div key={m.label}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{m.label}</div>
                <div className="text-xl font-extrabold tabular-nums text-[var(--color-ink)]">{m.value}</div>
              </div>
            ))}
            {biz.agents && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Agents</div>
                <div className="text-base font-semibold text-[var(--color-ink)]">{biz.agents.map((a) => `${a.name} ${a.won}`).join(' · ')}</div>
              </div>
            )}
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">My plan</div>
            <PlanArea items={itemsFor('biz', data.items)} tomorrowItems={itemsFor('biz', data.tomorrowItems)} canAct={canAct} today={data.today} focusKey="biz" placeholder={biz.key === 'renewals' ? 'e.g. Call Musa' : 'e.g. Sit with Sally on her pipeline'} onToggle={toggle} onRemove={remove} onAdd={add} />
          </div>
          {biz.progress && (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">Progress today: <span className="font-extrabold tabular-nums text-[var(--color-ink)]">{biz.progress.actual}/{biz.progress.goal}</span> {biz.progress.unit}</p>
          )}
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{biz.title} note</div>
            <textarea value={objNotes[biz.key] || ''} onChange={(e) => saveObjNote(biz.key, e.target.value)} disabled={!canAct} rows={2} placeholder="e.g. Musa requested the invoice by WhatsApp — saves by itself, follows this objective." className="w-full rounded-xl border border-[var(--color-line-soft)] bg-transparent px-3 py-2 text-sm" />
          </div>
        </section>
      ) : (
        <Card className="p-6 text-sm text-[var(--color-ink-soft)]">Every business goal is on track — nothing assigned today. Your own objective and follow-ups below.</Card>
      )}

      {/* HIS objective — one slot, carries until he finishes it */}
      <section>
        <div className="border-t border-[var(--color-line)] pt-3">
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-ink-faint)]">My objective</div>
          {data.ownObjective ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-[var(--color-ink)]">{data.ownObjective.title}</h2>
              {canAct && (
                <button onClick={finishOwn} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-bg)] px-3 py-1 text-xs font-bold text-[var(--color-good)] hover:opacity-80"><Flag size={12} /> Mark finished</button>
              )}
            </div>
          ) : canAct ? (
            <div className="mt-2 flex gap-1.5">
              <input value={ownTitle} onChange={(e) => setOwnTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createOwn()} placeholder="One objective of your own — e.g. Get Sally closing on her own" className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm" />
              <button onClick={createOwn} className="rounded-lg bg-[var(--color-ink)] px-3 py-2 text-xs font-bold text-white">Set</button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-ink-faint)]">No personal objective set.</p>
          )}
        </div>
        {data.ownObjective && (
          <>
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">My plan</div>
              <PlanArea items={itemsFor('myobj', data.items)} tomorrowItems={itemsFor('myobj', data.tomorrowItems)} canAct={canAct} today={data.today} focusKey="myobj" placeholder="e.g. Shadow her next customer call" onToggle={toggle} onRemove={remove} onAdd={add} />
            </div>
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Note</div>
              <textarea value={ownNote} onChange={(e) => saveOwnNote(e.target.value)} disabled={!canAct} rows={2} placeholder="Notes for this objective — saves by itself." className="w-full rounded-xl border border-[var(--color-line-soft)] bg-transparent px-3 py-2 text-sm" />
            </div>
          </>
        )}
      </section>

      {/* admin & follow-ups */}
      <section>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Admin &amp; Follow-ups</h2>
        <PlanArea items={itemsFor('quick', data.items)} tomorrowItems={itemsFor('quick', data.tomorrowItems)} canAct={canAct} today={data.today} focusKey="quick" placeholder="e.g. Call supplier" onToggle={toggle} onRemove={remove} onAdd={add} quiet />
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
    </div>
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
