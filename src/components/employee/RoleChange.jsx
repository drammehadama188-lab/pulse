import { useEffect, useState } from 'react'
import { ArrowRight, CalendarClock } from 'lucide-react'
import { api } from '../../lib/api.js'

// Recording a role change (Adama 28 Aug: "the role change should have
// questions, follow proper procedures, not just that").
//
// The point is not the form. It is that ONE answer set moves the title, the
// department, who they report to and what they can do in Pulse, on ONE date —
// instead of five edits on five pages, each stamped whenever someone got
// round to it. Yafatou's May change reached none of them.
//
// 🔑 Pay is written down here, never applied here. Payroll is its own page and
// its own permission; this keeps the agreed figure attached to the decision.
const CARD = 'card'
const day = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function RoleChange({ employee, departments, roster, roles, canEdit, onDone }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => api(`/hr/employee/${employee.username}/role-changes`).then(setData).catch(() => setData(null))
  useEffect(() => { load() }, [employee.username]) // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    setForm({
      effectiveFrom: new Date().toISOString().slice(0, 10),
      title: employee.title || '',
      department: employee.department || '',
      manager: employee.reportsTo || '',
      roleId: employee.roleId || '',
      reason: 'Promotion',
      payNote: '',
      note: '',
      kpiReview: true,
    })
    setError('')
    setOpen(true)
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/hr/employee/${employee.username}/role-changes`, { method: 'POST', body: form })
      setOpen(false)
      await load()
      await onDone?.()
    } catch (e) {
      setError(e.message || 'Could not record that')
    } finally {
      setBusy(false)
    }
  }
  async function cancel(id) {
    try {
      await api(`/hr/employee/${employee.username}/role-changes/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e.message || 'Could not cancel that')
    }
  }

  const upcoming = (data?.changes || []).filter((c) => !c.appliedAt)
  const past = (data?.changes || []).filter((c) => c.appliedAt)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className={`${CARD} p-5`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="t-card">Role changes</h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">
            One record of a move: the job, who they report to, what they can do, and when it starts.
          </p>
        </div>
        {canEdit && !open && (
          <button onClick={start} className="btn-secondary">Record a role change</button>
        )}
      </div>

      {/* A change agreed for next month is visible before it lands, so it is
          never a surprise on the day. */}
      {upcoming.length > 0 && (
        <div className="mb-3 space-y-2">
          {upcoming.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-stage-new)] bg-[var(--color-stage-new-bg)] px-4 py-3">
              <CalendarClock size={15} className="shrink-0 text-[var(--color-stage-new)]" />
              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
                <b className="font-medium">{c.fromTitle || '—'} → {c.title}</b> from {day(c.effectiveFrom)}
                <span className="block text-[12.5px] text-[var(--color-ink-soft)]">
                  Not applied yet · {c.reason}{c.payNote ? ` · pay: ${c.payNote}` : ''}
                </span>
              </span>
              {canEdit && (
                <button onClick={() => cancel(c.id)} className="text-[12.5px] font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && form && (
        <div className="mb-4 space-y-3 rounded-[10px] border border-[var(--color-line)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Effective from</span>
              <input type="date" className="field mt-1 w-full" value={form.effectiveFrom}
                onChange={(e) => set('effectiveFrom', e.target.value)} />
              <span className="mt-1 block text-[11.5px] text-[var(--color-ink-faint)]">
                A future date is recorded now and applies itself on the day.
              </span>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Why</span>
              <select className="field mt-1 w-full" value={form.reason} onChange={(e) => set('reason', e.target.value)}>
                {(data?.reasons || ['Promotion', 'Other']).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">New job title</span>
              <input className="field mt-1 w-full" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Assistant Manager" />
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Department</span>
              <select className="field mt-1 w-full" value={form.department} onChange={(e) => set('department', e.target.value)}>
                <option value="">Unchanged</option>
                {(departments || []).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Reports to</span>
              <select className="field mt-1 w-full" value={form.manager} onChange={(e) => set('manager', e.target.value)}>
                <option value="">Unchanged</option>
                {(roster || []).filter((r) => r.name !== employee.name).map((r) => <option key={r.username || r.name} value={r.name}>{r.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">What they can do in Pulse</span>
              <select className="field mt-1 w-full" value={form.roleId} onChange={(e) => set('roleId', e.target.value)}>
                <option value="">Unchanged</option>
                {(roles || []).filter((r) => r.id !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">Pay agreed (written down here, changed in Payroll)</span>
            <input className="field mt-1 w-full" value={form.payNote} onChange={(e) => set('payNote', e.target.value)}
              placeholder="D12,000 base + D5,000 commission from 1 Sep" />
          </label>
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">Anything else worth recording</span>
            <input className="field mt-1 w-full" value={form.note} onChange={(e) => set('note', e.target.value)}
              placeholder="Letter signed 20 Aug, filed under Documents" />
          </label>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={form.kpiReview} onChange={(e) => set('kpiReview', e.target.checked)} className="mt-0.5" />
            <span className="text-[12.5px] text-[var(--color-ink-soft)]">
              Their KPI targets need reviewing — a new role is measured differently, and nothing here can guess the right numbers.
            </span>
          </label>
          {error && <p className="text-[12.5px] text-[var(--color-stage-out)]">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setOpen(false)} disabled={busy} className="btn-secondary disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={busy || !form.title.trim() || !form.effectiveFrom} className="btn-primary disabled:opacity-50">
              {busy ? 'Recording…' : 'Record the change'}
            </button>
          </div>
        </div>
      )}

      {past.length === 0 && upcoming.length === 0 && !open && (
        <p className="py-3 text-[13px] text-[var(--color-ink-soft)]">
          No role change recorded. When someone moves job, record it here so the date, the reason and the letter stay together.
        </p>
      )}

      {past.length > 0 && (
        <div className="divide-y divide-[var(--color-line-soft)]">
          {past.map((c) => (
            <div key={c.id} className="flex items-start gap-3 py-3">
              <span className="w-[86px] shrink-0 text-[12px] text-[var(--color-ink-faint)]">{day(c.effectiveFrom)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--color-ink)]">
                  {c.fromTitle || '—'} <ArrowRight size={13} className="text-[var(--color-ink-faint)]" /> <b className="font-medium">{c.title}</b>
                </span>
                <span className="mt-0.5 block text-[12.5px] text-[var(--color-ink-soft)]">
                  {c.reason}{c.department && c.department !== c.fromDepartment ? ` · moved to ${c.department}` : ''}
                  {c.payNote ? ` · pay: ${c.payNote}` : ''}{c.by ? ` · recorded by ${c.by}` : ''}
                </span>
                {c.note && <span className="mt-0.5 block text-[12.5px] text-[var(--color-ink-faint)]">{c.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
