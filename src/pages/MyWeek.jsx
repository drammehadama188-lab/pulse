import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, Plus } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { firstName, timeShort } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

// MY WORKDAY v4 — operations, not checkboxes (Adama 9 Jul). One verdict
// sentence answers "am I winning today?"; the biggest operation takes the
// screen; each operation opens as a WORKSPACE (objective, working list,
// timeline of what happened, its own notes). People Waiting On Me is
// person-framed; Finished Today builds itself.

const PRIORITY = {
  critical: { word: 'Critical', dot: '🔴', cls: 'text-[var(--color-bad)]' },
  high: { word: 'High', dot: '🟠', cls: 'text-amber-600' },
  medium: { word: 'Medium', dot: '🟡', cls: 'text-amber-500' },
  ontrack: { word: 'On track', dot: '🟢', cls: 'text-[var(--color-good)]' },
  done: { word: 'Done', dot: '✅', cls: 'text-[var(--color-good)]' },
  unknown: { word: 'Check', dot: '⚪', cls: 'text-[var(--color-ink-faint)]' },
}

export default function MyWeek() {
  const { isViewAs } = useAuth()
  const canAct = !isViewAs
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null) // operation key → workspace view

  async function load() {
    try { setData(await api('/workday')) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'My Workday is for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const setItems = (items) => setData((d) => ({ ...d, items }))
  const op = open ? data.operations.find((o) => o.key === open) : null
  if (op) return <Workspace data={data} op={op} canAct={canAct} onBack={() => { setOpen(null); load() }} setItems={setItems} setData={setData} />

  const hero = data.operations[0]
  const rest = data.operations.slice(1)

  return (
    <div className="space-y-7">
      {/* the verdict — one sentence, one direction */}
      <div>
        <p className="text-sm font-semibold text-[var(--color-ink-faint)]">{firstName(data.lead.name)} · {new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
        <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight text-[var(--color-ink)]">{data.verdict}</h1>
      </div>

      {/* the hero — today's biggest responsibility gets the screen */}
      {hero && <OperationCard op={hero} hero onOpen={() => setOpen(hero.key)} />}

      {/* the rest of today's operations */}
      {rest.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Today's operations</h2>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
            {rest.map((o, i) => {
              const p = PRIORITY[o.priority] || PRIORITY.unknown
              return (
                <button key={o.key} onClick={() => setOpen(o.key)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-paper)]">
                  <span className="w-5 text-center text-sm font-extrabold text-[var(--color-ink-faint)]">{i + 2}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-bold text-[var(--color-ink)]">{o.title}</span>
                    <span className="ml-2 text-xs text-[var(--color-ink-soft)]">{o.objective}</span>
                  </span>
                  <span className={`shrink-0 text-xs font-bold ${p.cls}`}>{p.dot} {p.word}</span>
                  <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-faint)]" />
                </button>
              )
            })}
          </Card>
        </div>
      )}

      {/* people waiting on me */}
      {data.waiting.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">People waiting on me</h2>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
            {data.waiting.map((w, i) => {
              const row = (
                <>
                  <span className={`text-sm font-bold ${w.adama ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink)]'}`}>{w.who}</span>
                  <span className="min-w-0 flex-1 text-sm text-[var(--color-ink-soft)]">{w.what}</span>
                  {w.to && <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-faint)]" />}
                </>
              )
              return w.to
                ? <Link key={i} to={w.to} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-paper)]">{row}</Link>
                : <div key={i} className="flex items-center gap-3 px-4 py-3">{row}</div>
            })}
          </Card>
        </div>
      )}

      {/* finished today — momentum, no report writing */}
      {data.finished.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Finished today</h2>
          <Card className="space-y-1.5 p-4">
            {data.finished.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                <CheckCircle2 size={15} className="shrink-0 text-[var(--color-good)]" />
                <span className="flex-1">{f.title}</span>
                <span className="text-xs tabular-nums text-[var(--color-ink-faint)]">{timeShort(f.at)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* this month */}
      {data.month.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">This month</h2>
          <Card className="space-y-4 p-5">
            {data.month.map((w) => {
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

function OperationCard({ op, hero, onOpen }) {
  const p = PRIORITY[op.priority] || PRIORITY.unknown
  const pct = op.progress?.goal ? Math.min(100, Math.round(((op.progress.actual || 0) / op.progress.goal) * 100)) : null
  return (
    <Card className={`p-6 ${op.priority === 'critical' ? 'ring-2 ring-[var(--color-bad)]' : op.priority === 'high' ? 'ring-1 ring-amber-300' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs font-extrabold uppercase tracking-wide ${p.cls}`}>{p.dot} {p.word}{hero ? " · today's biggest responsibility" : ''}</span>
      </div>
      <h2 className="mt-1 text-2xl font-extrabold text-[var(--color-ink)]">{op.title}</h2>
      <p className="mt-1 text-base font-semibold text-[var(--color-ink)]">{op.objective}</p>
      <p className="text-sm text-[var(--color-ink-soft)]">Because {op.because}.</p>
      {op.progress && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--color-ink-soft)]">{op.progress.unit}</span>
            <span className="font-bold tabular-nums text-[var(--color-ink)]">{op.progress.actual}/{op.progress.goal}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-fill)]">
            <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {op.next && <p className="mt-3 text-sm text-[var(--color-ink)]"><span className="font-bold">Next:</span> {op.next}</p>}
      <button onClick={onOpen} className="mt-4 inline-flex items-center gap-1 rounded-xl bg-[var(--color-ink)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">
        Open {op.title.toLowerCase()} <ChevronRight size={15} />
      </button>
    </Card>
  )
}

// The WORKSPACE — click an operation and THAT becomes the page: goal, working
// list, timeline of what happened today, and this operation's own notes.
function Workspace({ data, op, canAct, onBack, setItems, setData }) {
  const p = PRIORITY[op.priority] || PRIORITY.unknown
  const items = (data.items || []).filter((i) => i.opKey === op.key)
  const timeline = items.filter((i) => i.done && i.doneAt).sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)))
  const [addText, setAddText] = useState('')
  const [notes, setNotes] = useState(data.opNotes?.[op.key] || '')
  const notesTimer = useRef(null)
  const pct = op.progress?.goal ? Math.min(100, Math.round(((op.progress.actual || 0) / op.progress.goal) * 100)) : null

  async function toggle(itemId) {
    try { const r = await api('/workday/toggle', { method: 'POST', body: { itemId } }); setItems(r.items) }
    catch (e) { alert(e.message) }
  }
  async function add() {
    if (!addText.trim()) return
    try { const r = await api('/workday/add', { method: 'POST', body: { title: addText.trim(), opKey: op.key } }); setItems(r.items); setAddText('') }
    catch (e) { alert(e.message) }
  }
  function onNotes(text) {
    setNotes(text)
    setData((d) => ({ ...d, opNotes: { ...d.opNotes, [op.key]: text } }))
    if (!canAct) return
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => { api('/workday/opnotes', { method: 'POST', body: { opKey: op.key, text } }).catch(() => {}) }, 800)
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-brand)]">
        <ArrowLeft size={16} /> My Workday
      </button>

      <div>
        <span className={`text-xs font-extrabold uppercase tracking-wide ${p.cls}`}>{p.dot} {p.word}</span>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[var(--color-ink)]">{op.title}</h1>
        <p className="mt-1 text-base font-semibold text-[var(--color-ink)]">{op.objective}</p>
        <p className="text-sm text-[var(--color-ink-soft)]">Because {op.because}.</p>
      </div>

      {op.progress && (
        <Card className="p-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--color-ink-soft)]">{op.progress.unit}</span>
            <span className="font-bold tabular-nums text-[var(--color-ink)]">{op.progress.actual}/{op.progress.goal}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-fill)]">
            <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} />
          </div>
        </Card>
      )}

      {/* working list */}
      <div>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Working list</h2>
        <Card className="p-4">
          <div className="space-y-1">
            {items.length === 0 && <p className="text-sm text-[var(--color-ink-faint)]">Nothing here yet — add the names you're working ({op.key === 'renewals' ? 'e.g. “Call Musa”' : 'e.g. “Follow up Lead A”'}).</p>}
            {items.map((it) => (
              <div key={it.id} className="flex items-start gap-2 rounded-lg px-1 py-1">
                <button onClick={canAct ? () => toggle(it.id) : undefined} className={`mt-0.5 shrink-0 ${canAct ? '' : 'cursor-default'}`}>
                  {it.done ? <CheckCircle2 size={17} className="text-[var(--color-good)]" /> : <Circle size={17} className="text-[var(--color-ink-faint)]" />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className={`text-sm font-medium ${it.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>{it.title}</span>
                  {it.carried ? <span className="ml-2 rounded-full bg-[var(--color-bad-bg,#fef2f2)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-bad)]">from yesterday</span> : null}
                </span>
              </div>
            ))}
          </div>
          {canAct && (
            <div className="mt-3 flex gap-1.5">
              <input value={addText} onChange={(e) => setAddText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add to this operation…" className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-sm" />
              <button onClick={add} className="rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-xs font-bold text-white"><Plus size={13} className="inline" /> Add</button>
            </div>
          )}
        </Card>
      </div>

      {/* timeline — what actually happened today */}
      {timeline.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">Today's timeline</h2>
          <Card className="space-y-1.5 p-4">
            {timeline.map((t) => (
              <div key={t.id} className="flex items-center gap-3 text-sm">
                <span className="w-12 shrink-0 tabular-nums text-xs font-semibold text-[var(--color-ink-faint)]">{timeShort(t.doneAt)}</span>
                <span className="text-[var(--color-ink)]">{t.title}</span>
                <CheckCircle2 size={14} className="text-[var(--color-good)]" />
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* this operation's notes */}
      <div>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-ink-faint)]">{op.title} notes</h2>
        <Card className="p-4">
          <textarea value={notes} onChange={(e) => onNotes(e.target.value)} disabled={!canAct} rows={4} placeholder={op.key === 'renewals' ? 'e.g. Musa requested the invoice by WhatsApp.' : 'Notes about this operation — saves by itself.'} className="w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-sm" />
        </Card>
      </div>

      {op.link && (
        <Link to={op.link.to} className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-brand)]">
          {op.link.label} <ChevronRight size={15} />
        </Link>
      )}
    </div>
  )
}
