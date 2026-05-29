import { useState } from 'react'
import { Modal, Button, Spinner, Field, Input, Select, Textarea } from '../../components/ui.jsx'
import { CUSTOMER_STATUS, SEGMENTS, NEXT_ACTION, VEHICLE_TYPES } from '../../lib/salesOptions.js'

export const EMPTY_CUSTOMER = {
  company: '', segment: 'Other', contact: '', role: '', phone: '', whatsapp: '', email: '',
  vehicles: '', vehicleType: '', status: 'New', nextAction: 'Call Back', followUpDate: '',
  amountExpected: '', amountPaid: '',
}

export default function CustomerForm({ initial = EMPTY_CUSTOMER, title = 'Add customer', onClose, onSave, busy }) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState('')
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  function submit() {
    if (!v.company?.trim()) return setError('Company / name is required')
    onSave(v)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Spinner size={16} /> : 'Save'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Company / Name"><Input value={v.company} onChange={set('company')} placeholder="e.g. Ayoub Furniture" /></Field>
        </div>
        <Field label="Segment"><Select value={v.segment} onChange={set('segment')} options={SEGMENTS} /></Field>
        <Field label="Status"><Select value={v.status} onChange={set('status')} options={CUSTOMER_STATUS} /></Field>
        <Field label="Contact person"><Input value={v.contact} onChange={set('contact')} /></Field>
        <Field label="Role"><Input value={v.role} onChange={set('role')} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="WhatsApp"><Input value={v.whatsapp} onChange={set('whatsapp')} inputMode="tel" /></Field>
        <Field label="Email"><Input value={v.email} onChange={set('email')} inputMode="email" /></Field>
        <Field label="Number of vehicles"><Input value={v.vehicles} onChange={set('vehicles')} inputMode="numeric" /></Field>
        <Field label="Vehicle type">
          <Select value={v.vehicleType} onChange={set('vehicleType')}>
            <option value="">—</option>
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Next action"><Select value={v.nextAction} onChange={set('nextAction')} options={NEXT_ACTION} /></Field>
        <Field label="Amount expected (D)"><Input type="number" value={v.amountExpected} onChange={set('amountExpected')} /></Field>
        <Field label="Amount paid (D)"><Input type="number" value={v.amountPaid} onChange={set('amountPaid')} /></Field>
        <div className="sm:col-span-2">
          <Field label="Follow-up date"><Input type="date" value={v.followUpDate} onChange={set('followUpDate')} /></Field>
        </div>
        {error && (
          <div className="sm:col-span-2 rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>
        )}
      </div>
    </Modal>
  )
}
