import { useEffect, useState } from 'react'
import { CalendarClock, Target } from 'lucide-react'
import { api } from '../../lib/api.js'

// Assignment — what someone is TOLD TO DO for a period (Adama 30 Aug: "Their
// roles are their roles and under the role we have assignment. what they are
// told to do within a period ... when the assignment says a department they
// will be judged by that").
//
// 🔒 The role keeps the title, the pay and the Pulse access. The assignment
// owns one thing: which scorecard scores them while it runs. It REPLACES the
// role's card rather than sitting beside it, and when it lapses scoring goes
// back to the role on its own.
const CARD = 'card'
const day = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function Assignment({ employee, canEdit, onDone }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => api(`/hr/employee/${employee.username}/assignments`).then(setData).catch(() => setData(null))
  useEffect(() => { load() }, [employee.username]) // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    setForm({
      scorecard: '',
      label: '',
      from: new Date().toISOString().slice(0, 10),
      to: '',
      reason: 'Training for the role',
      note: '',
    })
    setError('')
    setOpen(true)
  }

  async function save() {
    setBusy(true); setError('')
    try {
      await api(`/hr/employee/${employee.username}/assignments`, { method: 'POST', body: form })
      setOpen(false); await load(); await onDone?.()
    } catch (e) { setError(e.message || 'Could not record that') } finally { setBusy(false) }
  }
  async function end(id) {
    setError('')
    try { await api(`/hr/employee/${employee.username}/assignments/${id}/end`, { method: 'POST', body: {} }); await load(); await onDone?.() }
    catch (e) { setError(e.message || 'Could not end that') }
  }
  async function cancel(id) {
    setError('')
    try { await api(`/hr/employee/${employee.username}/assignments/${id}`, { method: 'DELETE' }); await load(); await onDone?.() }
    catch (e) { setError(e.message || 'Could not cancel that') }
  }

  const list = data?.assignments || []
  const current = data?.current || null
  const upcoming = list.filter((a) => !a.startedAt)
  const past = list.filter((a) => a.startedAt && (!current || a.id !== current.id))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const picked = (data?.scorecards || []).find((s) => s.key === form?.scorecard) || null

  return (
    <div className={`${CARD} p-5`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="t-card">Assignment</h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">
            What they are doing for a period, and what they are judged on while they do it. The job title does not change.
          </p>
        </div>
        {canEdit && !open && !current && (
          <button onClick={start} className="btn-secondary">Set an assignment</button>
        )}
      </div>

      {/* What is running right now, and what it replaced. */}
      {current ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-stage-new)] bg-[var(--color-stage-new-bg)] px-4 py-3">
          <Target size={15} className="shrink-0 text-[var(--color-stage-new)]" />
          <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
            <b className="font-medium">{current.label}</b> — judged on the {current.scorecardLabel} KPIs
            <span className="block text-[12.5px] text-[var(--color-ink-soft)]">
              {day(current.from)} {current.to ? `to ${day(current.to)}` : '· no end date set'}
              {current.reason ? ` · ${current.reason}` : ''}
            </span>
          </span>
          {canEdit && (
            <button onClick={() => end(current.id)} className="text-[12.5px] font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]">End today</button>
          )}
        </div>
      ) : !open && (
        <p className="py-1 text-[13px] text-[var(--color-ink-soft)]">
          {data?.roleScorecard
            ? `No assignment running. Judged on the ${data.roleScorecard.label} KPIs, from their role.`
            : 'No assignment running.'}
        </p>
      )}

      {upcoming.length > 0 && (
        <div className="mb-3 space-y-2">
          {upcoming.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-line)] px-4 py-3">
              <CalendarClock size={15} className="shrink-0 text-[var(--color-ink-faint)]" />
              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
                <b className="font-medium">{a.label}</b> from {day(a.from)}
                <span className="block text-[12.5px] text-[var(--color-ink-soft)]">Not started yet · {a.scorecardLabel} KPIs</span>
              </span>
              {canEdit && <button onClick={() => cancel(a.id)} className="text-[12.5px] font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]">Cancel</button>}
            </div>
          ))}
        </div>
      )}

      {open && form && (
        <div className="mb-4 space-y-3 rounded-[10px] border border-[var(--color-line)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">What they will be judged on</span>
              <select className="field mt-1 w-full" value={form.scorecard} onChange={(e) => set('scorecard', e.target.value)}>
                <option value="">Pick one</option>
                {(data?.scorecards || []).map((sc) => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
              </select>
              {data?.roleScorecard && (
                <span className="mt-1 block text-[11.5px] text-[var(--color-ink-faint)]">
                  Replaces the {data.roleScorecard.label} KPIs until it ends.
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Call it</span>
              <input className="field mt-1 w-full" value={form.label} onChange={(e) => set('label', e.target.value)}
                placeholder={picked ? `${picked.label} training` : 'Assistant Manager training'} />
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Starts</span>
              <input type="date" className="field mt-1 w-full" value={form.from} onChange={(e) => set('from', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Ends</span>
              <input type="date" className="field mt-1 w-full" value={form.to} onChange={(e) => set('to', e.target.value)} />
              <span className="mt-1 block text-[11.5px] text-[var(--color-ink-faint)]">
                Leave blank and it runs until you end it by hand.
              </span>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Why</span>
              <select className="field mt-1 w-full" value={form.reason} onChange={(e) => set('reason', e.target.value)}>
                {(data?.reasons || ['Other']).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">What they have to show by the end</span>
            <input className="field mt-1 w-full" value={form.note} onChange={(e) => set('note', e.target.value)}
              placeholder="Holds the seven KPIs without being chased" />
          </label>
          {error && <p className="text-[12.5px] text-[var(--color-stage-out)]">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setOpen(false)} disabled={busy} className="btn-secondary disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={busy || !form.scorecard || !form.from} className="btn-primary disabled:opacity-50">
              {busy ? 'Saving…' : 'Set the assignment'}
            </button>
          </div>
        </div>
      )}

      {error && !open && <p className="mb-2 text-[12.5px] text-[var(--color-stage-out)]">{error}</p>}

      {past.length > 0 && (
        <div className="divide-y divide-[var(--color-line-soft)] border-t border-[var(--color-line-soft)] pt-1">
          {past.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-3">
              <span className="w-[86px] shrink-0 text-[12px] text-[var(--color-ink-faint)]">{day(a.from)}</span>
              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
                {a.label} — {a.scorecardLabel} KPIs
                <span className="block text-[12.5px] text-[var(--color-ink-soft)]">
                  Ended {day(a.to)}{a.reason ? ` · ${a.reason}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
