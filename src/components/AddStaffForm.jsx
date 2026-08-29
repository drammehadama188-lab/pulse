import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { Button, Spinner, Modal, Field, Input, MenuSelect } from './ui.jsx'

// Add employee — the one form that creates a staff account (POST /api/staff:
// record, default password, set-password invite email). It used to live inside
// the Staff page; when that page was retired (27 Aug) the form went unreachable
// and the Employees page's "Add employee" button pointed at itself. It lives
// here now so the live page owns it and no page retirement can take it away.
export default function AddStaffForm({ onClose, onCreated }) {
  const [v, setV] = useState({ type: 'agent', name: '', email: '', personalEmail: '', title: 'Sales Agent', customTitle: '', department: 'Sales', baseSalary: '', transport: '', commission: '', target: '5', contractMonths: '3', probationMonths: '3', phone: '', address: '', joined: new Date().toISOString().slice(0, 10) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const isMgr = v.type === 'manager'
  const pickType = (t) => setV((p) => ({ ...p, type: t, title: t === 'manager' ? 'Manager' : 'Sales Agent', department: t === 'manager' ? 'Management' : 'Sales' }))
  // Everyone used to be created into Sales, which put technicians on the
  // sales leaderboard with a sales goal (Adama 20 Aug). Same list the server
  // accepts; department decides goals, leaderboard and My Team.
  const DEPARTMENTS = ['Sales', 'Customer Service', 'Operations', 'Marketing', 'Training', 'Management', 'Leadership']

  const OTHER = 'Other — type it in'
  const finalTitle = v.title === OTHER ? v.customTitle.trim() : v.title

  async function save() {
    if (!v.name.trim()) return setError('Enter their full name')
    if (!/^\S+@\S+\.\S+$/.test(v.email)) return setError('Enter a valid work email — the login link goes there')
    if (v.personalEmail.trim() && !/^\S+@\S+\.\S+$/.test(v.personalEmail)) return setError('The personal email is not valid')
    if (!finalTitle) return setError('Type the job title')
    setBusy(true)
    setError('')
    try {
      const r = await api('/staff', {
        method: 'POST',
        body: {
          type: v.type,
          name: v.name,
          email: v.email,
          personalEmail: v.personalEmail,
          title: finalTitle,
          department: v.department,
          baseSalary: v.baseSalary,
          transport: v.transport,
          commission: v.commission,
          target: v.target,
          contractMonths: v.contractMonths,
          probationMonths: v.probationMonths,
          phone: v.phone,
          address: v.address,
          joined: v.joined,
        },
      })
      setCreated({ ...r.staff, invited: r.invited })
      onCreated()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Staff account created"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-good-bg)] text-[var(--color-good)]">
            <CheckCircle2 size={30} />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-ink)]">{created.name} is set up</div>
            <div className="mt-1 text-[var(--color-ink-soft)]">
              They sign in with: <span className="font-semibold text-[var(--color-ink)]">{created.email}</span>
            </div>
          </div>
          <p className="rounded-lg bg-[var(--color-fill)] px-4 py-3 text-left text-[13px] text-[var(--color-ink-soft)]">
            {created.invited
              ? `We emailed ${created.email} a link to choose their password. The link works for 60 minutes — if it expires, open their profile and press Reset password to send a new one.`
              : `The invite email could not be sent right now. Open their profile and press Reset password to email them a link, or set a temporary password there.`}
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isMgr ? 'Add manager' : 'Add employee'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={16} /> : 'Create account'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {[['agent', 'Sales agent'], ['manager', 'Manager']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => pickType(k)}
              className={`flex-1 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors ${v.type === k ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="Full name"><Input value={v.name} onChange={set('name')} placeholder="e.g. Modou Njie" /></Field>
        <Field label="Work email (login & invite)"><Input type="email" value={v.email} onChange={set('email')} placeholder="name@damiatracker.com" /></Field>
        <Field label="Personal email"><Input type="email" value={v.personalEmail} onChange={set('personalEmail')} placeholder="name@gmail.com" /></Field>
        <Field label="Title">
          <MenuSelect value={v.title} onChange={(t) => setV((p) => ({ ...p, title: t }))} options={isMgr ? ['Manager', 'Operations Manager', 'General Manager', 'Team Lead', OTHER] : ['Sales Agent', 'Sales Intern', 'Senior Sales Agent', 'Technician / Installer', 'Customer Service Supervisor', 'Office Cleaner', OTHER]} />
        </Field>
        {v.title === OTHER && (
          <Field label="Job title"><Input value={v.customTitle} onChange={set('customTitle')} placeholder="e.g. Driver" /></Field>
        )}
        <Field label="Department">
          <MenuSelect value={v.department} onChange={(d) => setV((p) => ({ ...p, department: d }))} options={DEPARTMENTS} />
        </Field>
        <Field label="Phone"><Input type="tel" value={v.phone} onChange={set('phone')} placeholder="e.g. 3XX XX XX" /></Field>
        <Field label="Address"><Input value={v.address} onChange={set('address')} placeholder="e.g. Bakau, New Town Road" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base salary (D)"><Input type="number" min="0" value={v.baseSalary} onChange={set('baseSalary')} placeholder="e.g. 6000" /></Field>
          <Field label="Transport allowance (D)"><Input type="number" min="0" value={v.transport} onChange={set('transport')} placeholder="0" /></Field>
        </div>
        <div className={isMgr ? '' : 'grid grid-cols-2 gap-3'}>
          <Field label="Commission on target (D)"><Input type="number" min="0" value={v.commission} onChange={set('commission')} placeholder="0" /></Field>
          {!isMgr && <Field label="Monthly target (sales)"><Input type="number" min="0" value={v.target} onChange={set('target')} /></Field>}
        </div>
        <div>
          <Field label="Start date">
            <Input type="date" value={v.joined} onChange={set('joined')} />
          </Field>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink-faint)]">The day they actually started — set a past date if you're entering them late. Payroll only shows people from their start month onward.</p>
        </div>
        <Field label="Contract length">
          <MenuSelect
            value={v.contractMonths}
            onChange={(m) => setV((p) => ({ ...p, contractMonths: m }))}
            options={[
              { value: '1', label: '1 month' },
              { value: '2', label: '2 months' },
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
              { value: '12', label: '12 months' },
              { value: '0', label: 'Indefinite' },
            ]}
          />
        </Field>
        <Field label="Probation">
          <MenuSelect
            value={v.probationMonths}
            onChange={(m) => setV((p) => ({ ...p, probationMonths: m }))}
            options={[
              { value: '0', label: 'None' },
              { value: '1', label: '1 month' },
              { value: '2', label: '2 months' },
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
            ]}
          />
        </Field>
        <p className="text-[11.5px] text-[var(--color-ink-faint)]">
          {isMgr
            ? 'Role is Manager — they clock in and get the management view (team schedule, approvals, attendance override). Cross-department goals are set separately.'
            : 'Salary is visible to managers only. Role is Sales — they get an empty pipeline of their own.'}
        </p>
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}
