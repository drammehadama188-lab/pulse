import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Plus, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { greeting, firstName } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

// MY WORKDAY — the manager's desk (Adama, 10 Jul). The system shows the goals
// and live numbers; the PLAN is his, visible from today to NEXT week's Friday
// so he knows which days to use. Ticking is today-only (work counts when it
// happens); every add/edit/remove is on the audit timeline Adama can read.

export default function MyWeek() {
  const { isViewAs } = useAuth()
  const canAct = !isViewAs
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selDate, setSelDate] = useState(null)
  const [objNotes, setObjNotes] = useState({})
  const [noteSaved, setNoteSaved] = useState({})
  const [otherTitle, setOtherTitle] = useState('')
  const noteTimers = useRef({})
  const otherTimer = useRef(null)

  async function load() {
    try {
      const d = await api('/workday')
      setData(d); setObjNotes(d.objNotes || {}); setOtherTitle(d.otherTitle || '')
      setSelDate((cur) => (cur && d.days.includes(cur) ? cur : d.today))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  const updateItems = (date, items) =>
    setData((d) => ({ ...d, planByDate: { ...d.planByDate, [date]: items }, items: date === d.today ? items : d.items }))

  async function toggle(itemId) {
    try { const r = await api('/workday/toggle', { method: 'POST', body: { itemId } }); updateItems(data.today, r.items) }
    catch (e) { alert(e.message) }
  }
  async function editItem(itemId, title, date) {
    try { const r = await api('/workday/edit', { method: 'POST', body: { itemId, title, date } }); updateItems(date, r.items) }
    catch (e) { alert(e.message) }
  }
  async function remove(itemId, date) {
    try { const r = await api('/workday/remove', { method: 'POST', body: { itemId, date } }); updateItems(date, r.items) }
    catch (e) { alert(e.message) }
  }
  async function add(title, focusKey, date) {
    try { const r = await api('/workday/add', { method: 'POST', body: { title, focusKey, date } }); updateItems(r.date, r.items) }
    catch (e) { alert(e.message) }
  }
  async function toggleAssignment(id) {
    try {
      const r = await api(`/assignments/${id}/toggle`, { method: 'POST' })
      setData((d) => ({ ...d, fromAdama: d.fromAdama.map((a) => (a.id === id ? r.assignment : a)) }))
    } catch (e) { alert(e.message) }
  }
  function saveObjNote(key, text) {
    setObjNotes((n) => ({ ...n, [key]: text }))
    clearTimeout(noteTimers.current[key])
    noteTimers.current[key] = setTimeout(() => {
      api('/workday/objnote', { method: 'POST', body: { key, text } })
        .then(() => { setNoteSaved((v) => ({ ...v, [key]: true })); setTimeout(() => setNoteSaved((v) => ({ ...v, [key]: false })), 1500) })
        .catch(() => {})
    }, 600)
  }
  function saveOtherTitle(title) {
    setOtherTitle(title)
    clearTimeout(otherTimer.current)
    otherTimer.current = setTimeout(() => { api('/workday/other', { method: 'POST', body: { title } }).catch(() => {}) }, 600)
  }

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'My Workday is for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data || !selDate) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const dateLabel = new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const dayItems = data.planByDate[selDate] || []
  const itemsFor = (key) => dayItems.filter((i) => i.focusKey === key)
  const isToday = selDate === data.today

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

      {/* plan days — today up to next week's Friday */}
      <DayStrip days={data.days} today={data.today} selDate={selDate} onSelect={setSelDate} planByDate={data.planByDate} />

      {/* objectives — the system shows the goal, HE writes the plan */}
      {data.focus.length === 0 && (
        <Card className="p-6 text-sm text-[var(--color-ink-soft)]">Nothing is behind target — your other objective below, and push the month further.</Card>
      )}
      {data.focus.map((f, i) => (
        <ObjectiveSection
          key={f.key}
          slot={f.slot} title={f.title} metrics={f.metrics} agents={f.agents} progress={isToday ? f.progress : null} weekPlan={f.weekPlan}
          primary={i === 0} canAct={canAct} canTick={canAct && isToday}
          items={itemsFor(f.key)} focusKey={f.key} date={selDate}
          placeholder={f.key === 'renewals' ? 'e.g. Call Musa' : 'e.g. Sit with Sally on her pipeline'}
          cap={i === 0 ? 10 : 8}
          note={objNotes[f.key] || ''} noteSaved={!!noteSaved[f.key]}
          onNote={(text) => saveObjNote(f.key, text)}
          onToggle={toggle} onRemove={remove} onAdd={add} onEdit={editItem}
        />
      ))}

      {/* the OTHER objective — unspecified, his to name */}
      <section>
        <div className="border-t border-[var(--color-line)] pt-3">
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-ink-faint)]">Other objective</div>
          <input
            value={otherTitle}
            onChange={(e) => canAct && saveOtherTitle(e.target.value)}
            readOnly={!canAct}
            placeholder="What else are you working on? e.g. Coaching"
            className="mt-0.5 w-full max-w-md border-0 bg-transparent text-lg font-bold text-[var(--color-ink)] outline-none placeholder:font-semibold placeholder:text-[var(--color-ink-faint)]"
          />
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">My plan</div>
          <PlanArea items={itemsFor('other')} canAct={canAct} canTick={canAct && isToday} focusKey="other" date={selDate} cap={5} placeholder="e.g. Coaching session with Sally" onToggle={toggle} onRemove={remove} onAdd={add} onEdit={editItem} />
        </div>
        <CommentBox label="Comments" value={objNotes.other || ''} saved={!!noteSaved.other} onChange={(text) => saveObjNote('other', text)} />
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

export function DayStrip({ days, today, selDate, onSelect, planByDate }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {days.map((d) => {
        const dt = new Date(`${d}T00:00:00Z`)
        const n = (planByDate?.[d] || []).length
        const sel = d === selDate
        return (
          <button key={d} onClick={() => onSelect(d)} className={`rounded-xl px-3 py-1.5 text-center ${sel ? 'bg-[var(--color-ink)] text-white' : 'border border-[var(--color-line-soft)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-line)]'}`}>
            <span className="block text-[10px] font-bold uppercase tracking-wide opacity-75">{d === today ? 'Today' : dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
            <span className="block text-sm font-extrabold tabular-nums">{dt.getUTCDate()}{n ? <span className="ml-1 text-[10px] font-bold opacity-70">·{n}</span> : null}</span>
          </button>
        )
      })}
    </div>
  )
}

function ObjectiveSection({ slot, title, metrics, agents, progress, weekPlan, primary, canAct, canTick, items, focusKey, date, cap, placeholder, note, noteSaved, onNote, onToggle, onRemove, onAdd, onEdit }) {
  return (
    <section>
      {primary ? (
        <div className="border-t-4 border-[var(--color-brand)] pt-3">
          <div className="text-xs font-extrabold uppercase tracking-widest text-[var(--color-brand)]">{slot}</div>
          <h2 className="mt-0.5 text-2xl font-extrabold text-[var(--color-ink)]">{title}</h2>
        </div>
      ) : (
        <div className="border-t border-[var(--color-line)] pt-3">
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-ink-faint)]">{slot}</div>
          <h2 className="mt-0.5 text-lg font-bold text-[var(--color-ink)]">{title}</h2>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{m.label}</div>
            <div className={`font-extrabold tabular-nums text-[var(--color-ink)] ${primary ? 'text-xl' : 'text-base'}`}>{m.value}</div>
          </div>
        ))}
        {agents && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Agents</div>
            <div className={`font-semibold text-[var(--color-ink)] ${primary ? 'text-base' : 'text-sm'}`}>{agents.map((a) => `${a.name} ${a.won}`).join(' · ')}</div>
          </div>
        )}
      </div>
      {weekPlan && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {weekPlan.map((d) => (
            <div key={d.date} className={`rounded-lg px-2.5 py-1.5 text-center ${d.today ? 'bg-[var(--color-brand)] text-white' : d.past ? 'bg-[var(--color-fill)] text-[var(--color-ink-faint)]' : 'bg-[var(--color-surface)] border border-[var(--color-line-soft)] text-[var(--color-ink)]'}`}>
              <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">{d.label}</div>
              <div className="text-sm font-extrabold tabular-nums">{d.past ? (d.did == null ? '—' : `✓${d.did}`) : d.need}</div>
            </div>
          ))}
          <div className="self-center pl-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">per-day pace to hit the month</div>
        </div>
      )}
      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">My plan</div>
        <PlanArea items={items} canAct={canAct} canTick={canTick} focusKey={focusKey} date={date} cap={cap} placeholder={placeholder} onToggle={onToggle} onRemove={onRemove} onAdd={onAdd} onEdit={onEdit} />
      </div>
      {progress && (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Progress today: <span className="font-extrabold tabular-nums text-[var(--color-ink)]">{progress.actual}/{progress.goal}</span> {progress.unit}
        </p>
      )}
      <CommentBox label="Comments" value={note} saved={noteSaved} onChange={onNote} />
    </section>
  )
}

function CommentBox({ label, value, saved, onChange }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{label} {saved && <span className="normal-case tracking-normal text-[var(--color-good)]">Saved ✓</span>}</div>
      <textarea
        value={value} onChange={(e) => onChange(e.target.value)} rows={2}
        placeholder="Why wasn't the goal met, or anything the business should know — saves by itself."
        className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </div>
  )
}

// The plan for the selected day. Ticking only counts TODAY; future days are
// for planning. Click a line to reword it. Items Adama added carry his badge.
export function PlanArea({ items, canAct, canTick, focusKey, date, cap, placeholder, onToggle, onRemove, onAdd, onEdit }) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null)
  const [editText, setEditText] = useState('')
  const full = cap != null && items.length >= cap
  function submit() {
    if (!text.trim()) return
    onAdd(text.trim(), focusKey, date)
    setText('')
  }
  function saveEdit(id) {
    if (editText.trim()) onEdit(id, editText.trim(), date)
    setEditing(null)
  }
  return (
    <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
      <div className="space-y-0.5">
        {items.length === 0 && <p className="py-1 text-sm text-[var(--color-ink-faint)]">Nothing planned for this day yet — write below.</p>}
        {items.map((it) => (
          <div key={it.id} className="group flex items-start gap-2 rounded-lg px-1 py-1">
            <button onClick={canTick ? () => onToggle(it.id) : undefined} title={canTick ? undefined : 'Ticking counts on the day itself'} className={`mt-0.5 shrink-0 ${canTick ? '' : 'cursor-default opacity-50'}`}>
              {it.done ? <CheckCircle2 size={17} className="text-[var(--color-good)]" /> : <Circle size={17} className="text-[var(--color-ink-faint)]" />}
            </button>
            {editing === it.id ? (
              <input
                autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(it.id); if (e.key === 'Escape') setEditing(null) }}
                onBlur={() => saveEdit(it.id)}
                className="min-w-0 flex-1 rounded border border-[var(--color-line)] px-1.5 py-0.5 text-sm"
              />
            ) : (
              <span
                onClick={canAct && !it.done ? () => { setEditing(it.id); setEditText(it.title) } : undefined}
                className={`min-w-0 flex-1 ${canAct && !it.done ? 'cursor-text' : ''}`}
                title={canAct && !it.done ? 'Click to edit' : undefined}
              >
                <span className={`text-sm font-medium ${it.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{it.title}</span>
                {it.byAdama ? <span className="ml-2 rounded-full bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-brand)]">from Adama</span> : null}
                {it.carried ? <span className="ml-2 rounded-full bg-[var(--color-bad-bg,#fef2f2)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-bad)]">from yesterday</span> : null}
              </span>
            )}
            {canAct && editing !== it.id && (
              <button onClick={() => onRemove(it.id, date)} title="Remove" className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-bad)] group-hover:opacity-100"><X size={14} /></button>
            )}
          </div>
        ))}
      </div>
      {canAct && (full ? (
        <p className="mt-1.5 text-xs font-semibold text-[var(--color-ink-faint)]">{items.length}/{cap} — the plan is full. Finish or remove something first.</p>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <Plus size={15} className="shrink-0 text-[var(--color-ink-faint)]" />
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={`${placeholder} — Enter to add`} className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-ink-faint)]" />
          {cap != null && <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[var(--color-ink-faint)]">{items.length}/{cap}</span>}
        </div>
      ))}
    </div>
  )
}
