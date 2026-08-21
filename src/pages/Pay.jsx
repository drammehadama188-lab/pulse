import { useEffect, useState } from 'react'
import { Wallet, Bus, FileText, Baby, Gift, Plus, Trash2, ChevronDown, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { Button, Card, ConfirmDialog, Field, Input, Modal, Pill, Select, SectionTitle, Spinner } from '../components/ui.jsx'
import { dalasi } from '../lib/format.js'

function monthLabel(p) {
  if (!/^\d{4}-\d{2}$/.test(p || '')) return p || ''
  const [y, m] = p.split('-')
  return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function rangeLabel(from, to) {
  const a = monthLabel(from)
  const b = monthLabel(to)
  if (a && b) return `${a} – ${b}`
  if (a) return `From ${a}`
  if (b) return `Until ${b}`
  return ''
}
const sum = (lines) => (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
const thisMonth = () => new Date().toISOString().slice(0, 7)

const STATUS_TONE = { upcoming: 'brand', active: 'good', ended: 'neutral' }
const STATUS_RANK = { active: 0, upcoming: 1, ended: 2 }

export default function Pay() {
  const { user, hasPower, isViewAs } = useAuth()
  // Pay management needs the Payroll power specifically (not Team)
  const isManager = hasPower('payroll')
  const [people, setPeople] = useState([]) // manager: payroll roster
  const [selected, setSelected] = useState(user.username)
  const [ownRoster, setOwnRoster] = useState(null) // self salary
  const [benefits, setBenefits] = useState([])
  const [payslips, setPayslips] = useState([])
  const [loading, setLoading] = useState(true)
  const [benefitOpen, setBenefitOpen] = useState(false)
  const [payslipOpen, setPayslipOpen] = useState(false)
  const [del, setDel] = useState(null) // { kind, id }

  const canEdit = isManager && !isViewAs

  async function loadDetails(username) {
    const q = isManager ? `?username=${encodeURIComponent(username)}` : ''
    const [b, p] = await Promise.all([api('/benefits' + q), api('/payslips' + q)])
    setBenefits(b.benefits)
    setPayslips(p.payslips)
  }

  useEffect(() => {
    ;(async () => {
      try {
        if (isManager) {
          const { people } = await api('/payroll/people')
          setPeople(people)
          const own = people.find((p) => p.username === user.username)
          const sel = own ? own.username : people[0]?.username || user.username
          setSelected(sel)
          await loadDetails(sel)
        } else {
          // Own pay comes from /api/me (server-only source, never bundled).
          const me = await api('/me')
          setOwnRoster(me.pay || null)
          await loadDetails(user.username)
        }
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function changePerson(username) {
    setSelected(username)
    await loadDetails(username)
  }

  async function confirmDelete() {
    const path = del.kind === 'benefit' ? `/benefits/${del.id}` : `/payslips/${del.id}`
    await api(path, { method: 'DELETE' })
    setDel(null)
    await loadDetails(selected)
  }

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const roster = isManager ? people.find((p) => p.username === selected) || null : ownRoster
  const personName = isManager ? people.find((p) => p.username === selected)?.name || user.name : user.name
  const sortedBenefits = [...benefits].sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight md:text-[26px]">Payslips</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">
            {isManager ? 'Salary, benefits and monthly payslips.' : 'Your salary, benefits and payslips.'}
          </p>
        </div>
        {isManager && people.length > 0 && (
          <Select value={selected} onChange={(e) => changePerson(e.target.value)} className="max-w-[240px]">
            {people.map((p) => (
              <option key={p.username} value={p.username}>{p.name}</option>
            ))}
          </Select>
        )}
      </div>

      {/* salary summary */}
      {roster ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-5" style={{ background: 'linear-gradient(150deg, var(--color-brand-50), var(--color-surface) 75%)' }}>
            <div>
              <div className="text-[13px] font-semibold text-[var(--color-ink-soft)]">Monthly total</div>
              <div className="mt-1 text-4xl font-semibold tracking-tight text-[var(--color-ink)]">{dalasi(roster.total)}</div>
            </div>
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-brand)] text-white"><Wallet size={26} /></span>
          </div>
          <div className="divide-y divide-[var(--color-line-soft)]">
            <Row icon={Wallet} label="Base salary" value={dalasi(roster.base)} />
            {roster.commission > 0 && <Row icon={Wallet} label="Commission (on target)" value={dalasi(roster.commission)} />}
            {roster.transport > 0 && <Row icon={Bus} label="Transport allowance" value={dalasi(roster.transport)} />}
          </div>
        </Card>
      ) : (
        <Card className="p-5 text-[var(--color-ink-soft)]">No salary on file{isManager ? ' for this person' : ''}.</Card>
      )}

      {/* benefits */}
      <div>
        <SectionTitle action={canEdit ? <Button size="sm" icon={Plus} onClick={() => setBenefitOpen(true)}>Add benefit</Button> : null}>
          Benefits
        </SectionTitle>
        {sortedBenefits.length ? (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {sortedBenefits.map((b) => (
              <div key={b.id} className="flex items-start gap-3 px-5 py-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand)]">
                  {/maternity/i.test(b.title) ? <Baby size={17} /> : <Gift size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--color-ink)]">{b.title}</span>
                    <Pill tone={STATUS_TONE[b.status] || 'neutral'}>{b.status}</Pill>
                  </div>
                  {b.detail && <div className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{b.detail}</div>}
                  <div className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">
                    {[rangeLabel(b.from, b.to), b.note].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {b.amount > 0 && <span className="shrink-0 font-semibold text-[var(--color-ink)]">{dalasi(b.amount)}</span>}
                {canEdit && (
                  <button onClick={() => setDel({ kind: 'benefit', id: b.id })} className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" title="Remove benefit">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </Card>
        ) : (
          <Card className="px-5 py-8 text-center text-[13px] text-[var(--color-ink-faint)]">No benefits recorded.</Card>
        )}
      </div>

      {/* payment history */}
      <div>
        <SectionTitle action={canEdit && roster ? <Button size="sm" icon={Plus} onClick={() => setPayslipOpen(true)}>New payslip</Button> : null}>
          Payment history
        </SectionTitle>
        {payslips.length ? (
          <div className="space-y-2">
            {payslips.map((p) => (
              <Payslip key={p.id} slip={p} canEdit={canEdit} onDelete={() => setDel({ kind: 'payslip', id: p.id })} />
            ))}
          </div>
        ) : (
          <Card className="flex items-center gap-4 px-5 py-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-line-soft)] text-[var(--color-ink-faint)]"><FileText size={20} /></span>
            <div className="text-[13px] text-[var(--color-ink-faint)]">No payslips yet.{canEdit && roster ? ' Add one with the button above.' : ''}</div>
          </Card>
        )}
      </div>

      {benefitOpen && (
        <BenefitModal
          personName={personName}
          username={selected}
          onClose={() => setBenefitOpen(false)}
          onSaved={async () => { setBenefitOpen(false); await loadDetails(selected) }}
        />
      )}
      {payslipOpen && (
        <PayslipModal
          personName={personName}
          username={selected}
          onClose={() => setPayslipOpen(false)}
          onSaved={async () => { setPayslipOpen(false); await loadDetails(selected) }}
        />
      )}
      <ConfirmDialog
        open={!!del}
        onCancel={() => setDel(null)}
        onConfirm={confirmDelete}
        title={del?.kind === 'benefit' ? 'Remove benefit?' : 'Delete payslip?'}
        message="This removes the record. It can be re-added later."
        confirmLabel="Remove"
      />
    </div>
  )
}

function Payslip({ slip, canEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  // The whole story on the row face — salary + bonus and how/when it was paid
  // — matching what the manager sees in Run Payroll (Adama 8 Jul). The
  // expansion keeps the full line-by-line detail.
  const breakdown = [
    (slip.earnings || []).map((l) => `${l.label} ${dalasi(l.amount)}`).join(' + '),
    slip.note,
  ].filter(Boolean).join(' · ')
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-line-soft)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand)]"><FileText size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--color-ink)]">{monthLabel(slip.period)}</div>
          <div className="truncate text-[11.5px] text-[var(--color-ink-faint)]">{breakdown || 'Net pay'}</div>
        </div>
        <span className="text-[15px] font-semibold text-[var(--color-ink)]">{dalasi(slip.net)}</span>
        <ChevronDown size={18} className={`text-[var(--color-ink-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-[var(--color-line-soft)] px-5 py-4">
          <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Earnings</div>
          {slip.earnings?.length ? slip.earnings.map((l, i) => (
            <Line key={i} label={l.label} amount={l.amount} />
          )) : <div className="py-1 text-[13px] text-[var(--color-ink-faint)]">—</div>}
          {slip.deductions?.length > 0 && (
            <>
              <div className="mt-3 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Deductions</div>
              {slip.deductions.map((l, i) => <Line key={i} label={l.label} amount={-l.amount} />)}
            </>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-line-soft)] pt-3">
            <span className="font-semibold text-[var(--color-ink)]">Net pay</span>
            <span className="font-semibold text-[var(--color-ink)]">{dalasi(slip.net)}</span>
          </div>
          {slip.note && <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">{slip.note}</p>}
          {canEdit && (
            <button onClick={onDelete} className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">
              <Trash2 size={14} /> Delete payslip
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

function Line({ label, amount }) {
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      <span className={`font-semibold ${amount < 0 ? 'text-[var(--color-bad)]' : 'text-[var(--color-ink)]'}`}>{dalasi(amount)}</span>
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      {Icon && <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-line-soft)] text-[var(--color-ink-soft)]"><Icon size={17} /></span>}
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      <span className="ml-auto font-semibold text-[var(--color-ink)]">{value}</span>
    </div>
  )
}

function BenefitModal({ personName, username, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', detail: '', amount: '', status: 'upcoming', from: '', to: '', note: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await api('/benefits', { method: 'POST', body: { username, ...form, amount: Number(form.amount) || 0 } })
      onSaved()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add benefit — ${personName}`}
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving || !form.title.trim()}>{saving ? <Spinner size={16} /> : 'Save benefit'}</Button></>}
    >
      <div className="space-y-3">
        <Field label="Benefit"><Input value={form.title} onChange={set('title')} placeholder="e.g. Maternity leave (paid)" /></Field>
        <Field label="Details"><Input value={form.detail} onChange={set('detail')} placeholder="e.g. 6 months fully paid — exception" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (D, optional)"><Input type="number" value={form.amount} onChange={set('amount')} placeholder="0" /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={set('status')}>
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="ended">Ended</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (month)"><Input type="month" value={form.from} onChange={set('from')} /></Field>
          <Field label="To (month)"><Input type="month" value={form.to} onChange={set('to')} /></Field>
        </div>
        <Field label="Note (optional)"><Input value={form.note} onChange={set('note')} placeholder="e.g. Returned 4 May 2026" /></Field>
      </div>
    </Modal>
  )
}

function PayslipModal({ personName, username, onClose, onSaved }) {
  const [period, setPeriod] = useState(thisMonth())
  const [earnings, setEarnings] = useState([])
  const [deductions, setDeductions] = useState([])
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(true)

  async function draft(p) {
    setDrafting(true)
    try {
      const { draft } = await api(`/payslips/draft?username=${encodeURIComponent(username)}&period=${p}`)
      setEarnings(draft.earnings || [])
      setDeductions(draft.deductions || [])
    } catch {
      setEarnings([{ label: 'Base salary', amount: 0 }])
    } finally {
      setDrafting(false)
    }
  }
  useEffect(() => { draft(period) /* eslint-disable-next-line */ }, [])

  const net = sum(earnings) - sum(deductions)

  async function save() {
    setSaving(true)
    try {
      await api('/payslips', { method: 'POST', body: { username, period, earnings, deductions } })
      onSaved()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-lg"
      title={`New payslip — ${personName}`}
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving || drafting}>{saving ? <Spinner size={16} /> : 'Save payslip'}</Button></>}
    >
      <div className="flex items-end gap-2">
        <Field label="Month"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <Button variant="ghost" size="sm" onClick={() => draft(period)} disabled={drafting}>Auto-fill from salary</Button>
      </div>
      {drafting ? (
        <div className="flex justify-center py-8"><Spinner size={22} /></div>
      ) : (
        <>
          <LineEditor title="Earnings" lines={earnings} setLines={setEarnings} addLabel="Add earning" />
          <LineEditor title="Deductions" lines={deductions} setLines={setDeductions} addLabel="Add deduction" />
          <div className="mt-4 flex items-center justify-between rounded-lg bg-[var(--color-fill)] px-4 py-3">
            <span className="font-semibold text-[var(--color-ink)]">Net pay</span>
            <span className="text-[15px] font-semibold text-[var(--color-ink)]">{dalasi(net)}</span>
          </div>
        </>
      )}
    </Modal>
  )
}

function LineEditor({ title, lines, setLines, addLabel }) {
  const update = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const remove = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i))
  const add = () => setLines((ls) => [...ls, { label: '', amount: '' }])
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">{title}</div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={l.label} onChange={(e) => update(i, 'label', e.target.value)} placeholder="Label" className="flex-1" />
            <Input type="number" value={l.amount} onChange={(e) => update(i, 'amount', e.target.value)} placeholder="0" className="w-28" />
            <button onClick={() => remove(i)} className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" title="Remove"><X size={16} /></button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-brand)]"><Plus size={15} /> {addLabel}</button>
    </div>
  )
}
