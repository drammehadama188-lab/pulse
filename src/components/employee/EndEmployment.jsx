import { useEffect, useState } from 'react'
import { CalendarClock, UserX, Check } from 'lucide-react'
import { api } from '../../lib/api.js'

// Ending someone's employment (Adama 28 Aug: "if someone is fired where do i
// put that in pulse?").
//
// 🔒 ONE flow for every exit — dismissed, resigned, contract ended, probation
// not passed. A firing is not a different KIND of record from a resignation;
// it is the same record with a different reason, and splitting them is how a
// company ends up with three half-answers about the same person.
//
// 🔒 The last day is a DATE, not "now". A notice period agreed today is
// recorded today and closes the account on the day it runs out — the server
// applies it, nobody has to remember.
//
// 🔑 What the form asks is the point. Reason, notice, rehire and final pay are
// the questions somebody will ask a year from now, and the exit is the only
// moment anyone can still answer them.
const CARD = 'card'
const day = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function EndEmployment({ employee, canEdit, open, onClose, onDone }) {
  const [data, setData] = useState(null)
  const [checklist, setChecklist] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // What the last month comes to, for the date currently in the form. Computed
  // on the server: 🔒 the money is only in the answer for someone who may see
  // pay, so this is a figure to check, not one this page worked out.
  const [finalPay, setFinalPay] = useState(null)

  const load = () => api(`/hr/employee/${employee.username}/exit`).then(setData).catch(() => setData(null))
  const loadChecklist = () => api(`/employee-checklist?name=${encodeURIComponent(employee.name)}`)
    .then((r) => setChecklist(r.offboarding || []))
    .catch(() => setChecklist([]))
  useEffect(() => { load() }, [employee.username]) // eslint-disable-line react-hooks/exhaustive-deps

  const exit = data?.exit || null
  const left = !!(exit?.appliedAt) || !!data?.archived
  const pending = !!exit && !exit.appliedAt
  // Offboarding only matters once someone is actually going.
  useEffect(() => { if (exit || data?.archived) loadChecklist() }, [exit?.id, data?.archived]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    setError('')
    setForm({
      type: 'Resigned',
      lastDay: new Date().toISOString().slice(0, 10),
      reason: '',
      notice: 'Worked',
      rehire: true,
      payNote: '',
      note: '',
    })
  }, [open])

  useEffect(() => {
    const lastDay = form?.lastDay
    if (!open || !lastDay) { setFinalPay(null); return }
    let live = true
    api(`/hr/employee/${employee.username}/final-pay?lastDay=${lastDay}`)
      .then((r) => { if (live) setFinalPay(r) })
      .catch(() => { if (live) setFinalPay(null) })
    return () => { live = false }
  }, [open, form?.lastDay, employee.username])

  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/hr/employee/${employee.username}/exit`, { method: 'POST', body: form })
      onClose?.()
      await load()
      await loadChecklist()
      await onDone?.()
    } catch (e) {
      setError(e.message || 'Could not record that')
    } finally {
      setBusy(false)
    }
  }
  async function cancelExit() {
    setError('')
    try {
      await api(`/hr/employee/${employee.username}/exit/${exit.id}`, { method: 'DELETE' })
      await load()
      await onDone?.()
    } catch (e) {
      setError(e.message || 'Could not cancel that')
    }
  }
  async function tick(item, done) {
    setChecklist((c) => c.map((i) => (i.label === item.label ? { ...i, done } : i)))
    try {
      await api('/employee-checklist', { method: 'PUT', body: { name: employee.name, type: 'offboarding', label: item.label, done } })
    } catch {
      loadChecklist()
    }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const dismissal = form?.type === 'Dismissed'
  const outstanding = checklist.filter((i) => !i.done).length

  // Nothing recorded and nothing being recorded: the record stays clean. The
  // action lives in the header, not as an empty card on every profile.
  if (!open && !exit && !data?.archived) return null

  return (
    <div className={`${CARD} mb-5 p-5`}>
      {pending && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-pill-leave)] bg-[var(--color-pill-leave-bg)] px-4 py-3">
          <CalendarClock size={15} className="shrink-0 text-[var(--color-pill-leave)]" />
          <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
            <b className="font-medium">Leaving on {day(exit.lastDay)}</b> · {exit.type}
            <span className="block text-[12.5px] text-[var(--color-ink-soft)]">
              Still active until that day, then the account closes itself. {exit.reason}
            </span>
          </span>
          {canEdit && (
            <button onClick={cancelExit} className="text-[12.5px] font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]">
              Cancel the notice
            </button>
          )}
        </div>
      )}

      {left && (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-[10px] border border-[var(--color-stage-out)] bg-[var(--color-bad-bg)] px-4 py-3">
          <UserX size={15} className="mt-0.5 shrink-0 text-[var(--color-stage-out)]" />
          <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
            <b className="font-medium">
              Left the team{exit?.lastDay ? ` — last day ${day(exit.lastDay)}` : employee.left ? ` — ${day(employee.left)}` : ''}
            </b>
            <span className="block text-[12.5px] text-[var(--color-ink-soft)]">
              {exit ? `${exit.type} · ${exit.reason}` : (employee.leftReason || 'Left the team')}
            </span>
          </span>
        </div>
      )}

      {exit && (
        <div className="mb-4 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          {[
            ['Last working day', day(exit.lastDay)],
            ['Notice', exit.notice],
            ['Rehire', exit.rehire ? 'Would rehire' : 'Would not rehire'],
            ['Recorded by', exit.by || '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[12px] text-[var(--color-ink-faint)]">{label}</p>
              <p className="mt-1 text-[13px] font-medium text-[var(--color-ink)]">{value}</p>
            </div>
          ))}
          {exit.payNote && (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-[12px] text-[var(--color-ink-faint)]">Final pay agreed (paid in Payroll, not here)</p>
              <p className="mt-1 text-[13px] text-[var(--color-ink)]">{exit.payNote}</p>
            </div>
          )}
          {exit.note && (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-[12px] text-[var(--color-ink-faint)]">Note</p>
              <p className="mt-1 text-[13px] text-[var(--color-ink)]">{exit.note}</p>
            </div>
          )}
        </div>
      )}

      {/* Offboarding is the part that outlives the last day, so it stays here
          on the record rather than disappearing with the person. */}
      {(exit || data?.archived) && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="t-card">Offboarding</h2>
            <span className="text-[12.5px] text-[var(--color-ink-soft)]">
              {outstanding ? `${outstanding} still to do` : 'All done'}
            </span>
          </div>
          <div className="divide-y divide-[var(--color-line-soft)]">
            {checklist.map((item) => (
              <label key={item.label} className="flex items-center gap-3 py-2.5">
                <input type="checkbox" checked={!!item.done} disabled={!canEdit}
                  onChange={(e) => tick(item, e.target.checked)} />
                <span className={`text-[13px] ${item.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'}`}>
                  {item.label}
                </span>
                {item.done && <Check size={14} className="ml-auto shrink-0 text-[var(--color-pill-active)]" />}
              </label>
            ))}
          </div>
        </div>
      )}

      {open && form && (
        <div className="mt-4 space-y-3 rounded-[10px] border border-[var(--color-line)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">How it is ending</span>
              <select className="field mt-1 w-full" value={form.type} onChange={(e) => set('type', e.target.value)}>
                {(data?.types || ['Resigned', 'Dismissed']).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Last working day</span>
              <input type="date" className="field mt-1 w-full" value={form.lastDay} onChange={(e) => set('lastDay', e.target.value)} />
              <span className="mt-1 block text-[11.5px] text-[var(--color-ink-faint)]">
                A future date is recorded now and closes the account on the day.
              </span>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Notice</span>
              <select className="field mt-1 w-full" value={form.notice} onChange={(e) => set('notice', e.target.value)}>
                {(data?.notice || ['Worked', 'Paid in lieu', 'Waived', 'Not applicable']).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-[var(--color-ink-faint)]">Final pay agreed (recorded here, paid in Payroll)</span>
              <input className="field mt-1 w-full" value={form.payNote} onChange={(e) => set('payNote', e.target.value)}
                placeholder={finalPay?.pay ? `D${finalPay.pay.amount.toLocaleString()} for ${finalPay.workedDays} days` : 'What they are owed, and when it is paid'} />
              {finalPay && (
                <span className="mt-1 block text-[11.5px] text-[var(--color-ink-faint)]">
                  {finalPay.workedDays} of {finalPay.monthDays} working days in {finalPay.month}
                  {finalPay.pay ? (
                    <>
                      {' · '}
                      <button type="button" onClick={() => set('payNote', `D${finalPay.pay.amount.toLocaleString()} — ${finalPay.workedDays} of ${finalPay.monthDays} working days`)}
                        className="font-medium text-[var(--color-brand)] hover:underline">
                        Use D{finalPay.pay.amount.toLocaleString()}
                      </button>
                      {' (D'}{finalPay.pay.base.toLocaleString()}{' ÷ '}{finalPay.monthDays}{' × '}{finalPay.workedDays}{')'}
                    </>
                  ) : ' · you cannot see pay, so no figure is shown'}
                  {finalPay.leaveOwed === 0 && ' · no leave to pay out (under a year of service)'}
                </span>
              )}
            </label>
          </div>
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">Reason</span>
            <textarea rows={3} className="field mt-1 w-full" value={form.reason} onChange={(e) => set('reason', e.target.value)}
              placeholder={dismissal ? 'What happened, and what was done about it before this' : 'In their words where you have them'} />
            {dismissal && (
              <span className="mt-1 block text-[11.5px] text-[var(--color-ink-faint)]">
                Warnings and reviews already on this record stay attached to it. If a warning was given, it belongs on the record before this.
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">Anything else worth recording</span>
            <input className="field mt-1 w-full" value={form.note} onChange={(e) => set('note', e.target.value)}
              placeholder="Resignation letter filed under Documents" />
          </label>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={form.rehire} onChange={(e) => set('rehire', e.target.checked)} className="mt-0.5" />
            <span className="text-[12.5px] text-[var(--color-ink-soft)]">
              Would take them back. Ask it now — in a year nobody can answer it from the file.
            </span>
          </label>
          <p className="text-[12.5px] text-[var(--color-ink-soft)]">
            On the last day {employee.name} is signed out, drops off the roster, payroll and attendance, and moves to Past employees with this reason. The record stays.
          </p>
          {error && <p className="text-[12.5px] text-[var(--color-stage-out)]">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="btn-secondary disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={busy || !form.reason.trim() || !form.lastDay} className="btn-primary disabled:opacity-50">
              {busy ? 'Recording…' : 'End employment'}
            </button>
          </div>
        </div>
      )}

      {error && !open && <p className="mt-3 text-[12.5px] text-[var(--color-stage-out)]">{error}</p>}

      {!exit && !open && data?.archived && (
        <p className="text-[13px] text-[var(--color-ink-soft)]">
          They left before exits were recorded here, so the reason above is all that is on file.
        </p>
      )}
    </div>
  )
}
