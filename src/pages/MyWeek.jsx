import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Plus, RotateCcw } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Card, Spinner } from '../components/ui.jsx'

// MY WEEK — the team lead's auto-built planner (Adama 9 Jul). The system reads
// the data (coaching due, sales pace, attendance, Yafatou's cases/installs/
// stock) and ranks each day's Top 3. Undone Top-3 items roll forward with a
// "carried" badge. Informational — it doesn't move the scorecard (month one).

const CAT = {
  coaching: { label: 'Coaching', cls: 'bg-purple-50 text-purple-700' },
  sales: { label: 'Sales', cls: 'bg-emerald-50 text-emerald-700' },
  attendance: { label: 'Attendance', cls: 'bg-amber-50 text-amber-700' },
  cs: { label: "Yafatou's", cls: 'bg-blue-50 text-blue-700' },
  ops: { label: 'Ops', cls: 'bg-gray-100 text-gray-600' },
  own: { label: 'Mine', cls: 'bg-gray-100 text-gray-600' },
}

const dayLabel = (key, today) => {
  const d = new Date(`${key}T00:00:00Z`)
  const name = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  return key === today ? 'TODAY' : `${name} ${d.getUTCDate()}`
}

export default function MyWeek() {
  const { user, isViewAs } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null) // date being added to
  const [addText, setAddText] = useState('')

  async function load() {
    try { setData(await api('/myweek')) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function toggle(date, itemId) {
    try {
      const r = await api('/myweek/toggle', { method: 'POST', body: { date, itemId } })
      setData((d) => ({ ...d, days: d.days.map((day) => (day.date === date ? { ...day, done: r.done } : day)) }))
    } catch (e) { alert(e.message) }
  }
  async function addItem(date) {
    if (!addText.trim()) return
    try {
      const r = await api('/myweek/add', { method: 'POST', body: { date, title: addText.trim() } })
      setData((d) => ({ ...d, days: d.days.map((day) => (day.date === date ? { ...day, items: r.items } : day)) }))
      setAdding(null); setAddText('')
    } catch (e) { alert(e.message) }
  }

  if (error) return <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{error === 'not-a-team-lead' ? 'My Week is for team leads.' : `Couldn't load — ${error}`}</Card>
  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-ink)]">My Week</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Built from the data every morning — work the Top 3, tick things off. Undone priorities follow you to tomorrow.</p>
      </div>

      {/* goals strip — every item below traces to one of these */}
      <div className="flex flex-wrap gap-2">
        {data.goals.map((g) => (
          <span key={g.key} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${g.owner === 'you' ? 'border-[var(--color-line)] text-[var(--color-ink)]' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
            {g.label} · {g.target}
            {g.owner !== 'you' && <span className="font-medium opacity-70">— {g.owner} owns it, you make it happen</span>}
            {g.weight ? <span className="opacity-60">· {g.weight}%</span> : null}
          </span>
        ))}
      </div>

      {/* week */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.days.map((day) => {
          const ranked = [...(day.items || [])].sort((a, b) => (b.rank || 0) - (a.rank || 0))
          const top = ranked.slice(0, 3)
          const rest = ranked.slice(3)
          const doneSet = new Set(day.done || [])
          return (
            <Card key={day.date} className={`p-4 ${day.today ? 'ring-2 ring-[var(--color-brand)]' : ''} ${day.past ? 'opacity-70' : ''}`}>
              <div className="mb-3 flex items-center justify-between">
                <span className={`text-sm font-extrabold ${day.today ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink)]'}`}>{dayLabel(day.date, data.today)}</span>
                {day.past && <span className="text-[11px] font-semibold text-[var(--color-ink-faint)]">{doneSet.size}/{ranked.length ? Math.min(3, ranked.length) : 0} top-3 done</span>}
                {day.preview && <span className="text-[11px] font-semibold text-[var(--color-ink-faint)]">preview</span>}
              </div>
              {ranked.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--color-ink-faint)]">{day.past ? 'No plan was built this day.' : 'Nothing scheduled yet.'}</p>
              ) : (
                <div className="space-y-2">
                  {top.map((it, i) => (
                    <ItemRow key={it.id} it={it} n={i + 1} done={doneSet.has(it.id)} canTick={(day.today || day.past) && !isViewAs} onToggle={() => toggle(day.date, it.id)} />
                  ))}
                  {rest.length > 0 && (
                    <div className="border-t border-[var(--color-line-soft)] pt-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Also</div>
                      {rest.map((it) => (
                        <ItemRow key={it.id} it={it} small done={doneSet.has(it.id)} canTick={(day.today || day.past) && !isViewAs} onToggle={() => toggle(day.date, it.id)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!day.past && !isViewAs && (
                adding === day.date ? (
                  <div className="mt-3 flex gap-1.5">
                    <input autoFocus value={addText} onChange={(e) => setAddText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem(day.date)} placeholder="Add your own…" className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-sm" />
                    <button onClick={() => addItem(day.date)} className="rounded-lg bg-[var(--color-ink)] px-2.5 py-1.5 text-xs font-bold text-white">Add</button>
                    <button onClick={() => { setAdding(null); setAddText('') }} className="rounded-lg bg-[var(--color-fill)] px-2 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setAdding(day.date); setAddText('') }} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"><Plus size={13} /> Add my own</button>
                )
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function ItemRow({ it, n, small, done, canTick, onToggle }) {
  const m = CAT[it.cat] || CAT.ops
  return (
    <button
      onClick={canTick ? onToggle : undefined}
      className={`flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left ${canTick ? 'hover:bg-[var(--color-paper)]' : 'cursor-default'}`}
    >
      <span className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]">
        {done ? <CheckCircle2 size={small ? 14 : 17} className="text-[var(--color-good)]" /> : <Circle size={small ? 14 : 17} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`${small ? 'text-xs' : 'text-sm font-semibold'} ${done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>
          {n ? `${n}. ` : ''}{it.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${m.cls}`}>{m.label}</span>
          {it.carried ? <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-bad-bg,#fef2f2)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--color-bad)]"><RotateCcw size={9} /> carried · day {it.carried + 1}</span> : null}
        </span>
      </span>
    </button>
  )
}
