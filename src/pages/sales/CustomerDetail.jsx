import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Phone, Pencil, Trash2, PhoneCall, MapPin, StickyNote, Mail, Flag, Send } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Button, Card, Pill, Spinner, Modal, Field, Input, Select, Textarea } from '../../components/ui.jsx'
import { CUSTOMER_STATUS, CALL_STATUS, NEXT_ACTION, TRANSPORT_OUTCOME, STATUS_TONE } from '../../lib/salesOptions.js'
import { dalasi, timeShort } from '../../lib/format.js'
import CustomerForm from './CustomerForm.jsx'
import { PageSkeleton } from '../../components/ui/Skeleton.jsx'

const ACT_TYPES = [
  { key: 'note', label: 'Note', icon: StickyNote, tone: 'warn' },
  { key: 'call', label: 'Call', icon: PhoneCall, tone: 'brand' },
  { key: 'visit', label: 'Visit', icon: MapPin, tone: 'rest' },
  { key: 'email', label: 'Email', icon: Mail, tone: 'good' },
]
const ACT_META = Object.fromEntries(ACT_TYPES.map((t) => [t.key, t]))
ACT_META.status = { label: 'Status', icon: Flag, tone: 'neutral' }

const HERO = 'var(--gradient-hero)'
const blankActivity = () => ({ type: 'note', note: '', callStatus: 'Wants More info', nextAction: 'Call Back', from: '', to: '', cost: '', outcome: 'Follow Up Needed' })

function initials(name = '') {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isViewAs } = useAuth()
  const [customer, setCustomer] = useState(null)
  const [acts, setActs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editAct, setEditAct] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [{ customers }, { activities }] = await Promise.all([api('/customers'), api(`/activities?customerId=${id}`)])
    setCustomer(customers.find((c) => c.id === id) || null)
    setActs(activities)
    setLoading(false)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function changeStatus(status) {
    setCustomer((c) => ({ ...c, status }))
    await api(`/customers/${id}`, { method: 'PATCH', body: { status } })
    await api('/activities', { method: 'POST', body: { customerId: id, type: 'status', note: `Status changed to ${status}` } })
    load()
  }
  async function addActivity(values) {
    setBusy(true)
    try {
      await api('/activities', { method: 'POST', body: { customerId: id, ...values } })
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function saveActivityEdit(values) {
    setBusy(true)
    try {
      await api(`/activities/${editAct.id}`, { method: 'PATCH', body: values })
      setEditAct(null)
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function saveEdit(values) {
    setBusy(true)
    try {
      await api(`/customers/${id}`, { method: 'PATCH', body: values })
      setEditing(false)
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function deleteActivity(aid) {
    await api(`/activities/${aid}`, { method: 'DELETE' })
    load()
  }

  if (loading) return <PageSkeleton tiles={0} rows={6} />
  if (!customer)
    return (
      <div className="py-16 text-center text-[var(--color-ink-faint)]">
        Customer not found. <button onClick={() => navigate('/sales')} className="font-semibold text-[var(--color-brand)]">Back to Sales</button>
      </div>
    )

  return (
    <div className="space-y-5">
      {/* ---- gradient hero ---- */}
      <div className="relative overflow-hidden rounded-[22px] text-white shadow-[var(--shadow-lift)]" style={{ background: HERO }}>
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.22), transparent 70%)' }} />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%)' }} />
        <div className="relative flex items-start justify-between p-4 sm:p-5">
          <button onClick={() => navigate('/sales')} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25">
            <ArrowLeft size={18} />
          </button>
          <div className="flex gap-2">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-[13px] font-semibold backdrop-blur-sm transition-colors hover:bg-white/25">
                <Phone size={15} /> Call
              </a>
            )}
          </div>
        </div>
        <div className="relative flex items-center gap-4 px-5 pb-6 pt-2 sm:px-7 sm:pb-8">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/15 text-[22px] font-semibold text-white ring-4 ring-white/30 backdrop-blur-sm sm:h-24 sm:w-24">
            {initials(customer.company)}
          </div>
          <div className="min-w-0">
            <h1 className="t-page">{customer.company}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/85">
              {customer.contact && <span>{customer.contact}{customer.role ? ` · ${customer.role}` : ''}</span>}
              {customer.phone && <span>{customer.phone}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ---- quick bar ---- */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">Status</span>
          {isViewAs ? (
            <Pill tone={STATUS_TONE[customer.status] || 'neutral'}>{customer.status}</Pill>
          ) : (
            <select value={customer.status} onChange={(e) => changeStatus(e.target.value)} className="focus-ring rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-ink)] outline-none">
              {CUSTOMER_STATUS.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
        </div>
        {customer.nextAction && (
          <div className="text-[13px] text-[var(--color-ink-faint)]">Next: <span className="font-semibold text-[var(--color-ink-soft)]">{customer.nextAction}</span></div>
        )}
        {(Number(customer.amountExpected) > 0 || Number(customer.amountPaid) > 0) && (
          <div className="text-[13px] text-[var(--color-ink-soft)]">Deal <span className="font-semibold text-[var(--color-ink)]">{dalasi(customer.amountExpected)}</span></div>
        )}
      </Card>

      {/* ---- Details ---- */}
      <Card className="p-5 sm:p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">Customer information</h2>
          {!isViewAs && (
            <Button variant="outline" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          <Row label="Company / Name" value={customer.company} />
          <Row label="Segment" value={customer.segment} />
          <Row label="Contact person" value={customer.contact} />
          <Row label="Role" value={customer.role} />
          <Row label="Phone" value={customer.phone} href={customer.phone ? `tel:${customer.phone}` : null} icon={Phone} />
          <Row label="WhatsApp" value={customer.whatsapp} href={waUrl(customer.whatsapp)} link />
          <Row label="Email" value={customer.email} href={customer.email ? `mailto:${customer.email}` : null} link />
          <Row label="Number of vehicles" value={customer.vehicles} />
          <Row label="Vehicle type" value={customer.vehicleType} />
          <Row label="Status" value={customer.status} />
          <Row label="Next action" value={customer.nextAction} />
          <Row label="Follow-up date" value={customer.followUpDate} />
          <Row label="Amount expected" value={Number(customer.amountExpected) ? dalasi(customer.amountExpected) : null} />
          <Row label="Amount paid" value={Number(customer.amountPaid) ? dalasi(customer.amountPaid) : null} />
        </dl>
      </Card>

      {/* ---- Add note / activity (between details and activity) ---- */}
      {!isViewAs && <Composer onSave={addActivity} busy={busy} />}

      {/* ---- Activity history ---- */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-[var(--color-ink)]">Activity {acts.length > 0 && <span className="text-[var(--color-ink-faint)]">({acts.length})</span>}</h2>
        {acts.length === 0 ? (
          <Card className="px-5 py-10 text-center text-[var(--color-ink-faint)]">No activity yet. Add a note above.</Card>
        ) : (
          <div className="space-y-3">
            {acts.map((a) => {
              const meta = ACT_META[a.type] || ACT_META.note
              return (
                <Card key={a.id} className="flex items-start gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ color: `var(--color-${meta.tone})`, background: `var(--color-${meta.tone}-bg)` }}>
                    <meta.icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--color-ink)]">{meta.label}</span>
                      {a.type === 'call' && a.callStatus && <Pill tone="brand">{a.callStatus}</Pill>}
                      {a.type === 'visit' && a.outcome && <Pill tone="rest">{a.outcome}</Pill>}
                    </div>
                    {a.type === 'visit' && (a.from || a.to) && (
                      <div className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{a.from || '—'} → {a.to || '—'}{Number(a.cost) > 0 ? ` · ${dalasi(a.cost)}` : ''}</div>
                    )}
                    {a.note && <div className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{a.note}</div>}
                    {a.nextAction && <div className="mt-1 text-[11.5px] font-semibold text-[var(--color-ink-faint)]">Next: {a.nextAction}</div>}
                    <div className="mt-1 text-[11.5px] text-[var(--color-ink-faint)]">{fmtWhen(a.createdAt)}</div>
                  </div>
                  {!isViewAs && a.type !== 'status' && (
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => setEditAct(a)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteActivity(a.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                  {!isViewAs && a.type === 'status' && (
                    <button onClick={() => deleteActivity(a.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {editing && <CustomerForm initial={customer} title="Edit customer" onClose={() => setEditing(false)} onSave={saveEdit} busy={busy} />}
      {/* customers cannot be deleted (data-protection) */}
      {editAct && (
        <Modal
          open
          onClose={() => setEditAct(null)}
          title="Edit entry"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditAct(null)}>Cancel</Button>
              <ModalSaveButton busy={busy} />
            </>
          }
        >
          <ActivityFields initial={editAct} onSubmit={saveActivityEdit} submitId="edit-act" />
        </Modal>
      )}
    </div>
  )
}

/* Inline composer placed between Details and Activity */
function Composer({ onSave, busy }) {
  const [v, setV] = useState(blankActivity())
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }))

  async function submit() {
    if (!v.note?.trim() && v.type === 'note') return
    await onSave(v)
    setV(blankActivity())
  }

  return (
    <Card className="p-5 sm:p-5">
      <h2 className="mb-4 text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">Add note</h2>
      <TypeTabs value={v.type} onChange={(type) => set({ type })} />
      <div className="rounded-lg border-2 border-[var(--color-line)] p-3 transition-colors focus-within:border-[var(--color-brand)]">
        <ActivityBody v={v} set={set} bare />
        <div className="mt-2 flex justify-end">
          <Button icon={Send} onClick={submit} disabled={busy}>
            {busy ? <Spinner size={16} /> : 'Save'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function TypeTabs({ value, onChange }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {ACT_TYPES.map((t) => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              active ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-line-soft)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        )
      })}
    </div>
  )
}

/* the type-specific fields + note, shared by composer and edit modal */
function ActivityBody({ v, set, bare = false }) {
  const placeholder = v.type === 'note' ? 'Write a note…' : v.type === 'email' ? 'What did you email about?' : 'What happened?'
  return (
    <div className="space-y-3">
      {v.type === 'call' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Outcome"><Select value={v.callStatus} onChange={(e) => set({ callStatus: e.target.value })} options={CALL_STATUS} /></Field>
          <Field label="Next action"><Select value={v.nextAction} onChange={(e) => set({ nextAction: e.target.value })} options={NEXT_ACTION} /></Field>
        </div>
      )}
      {v.type === 'visit' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><Input value={v.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To"><Input value={v.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          <Field label="Transport cost (D)"><Input type="number" value={v.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>
          <Field label="Outcome"><Select value={v.outcome} onChange={(e) => set({ outcome: e.target.value })} options={TRANSPORT_OUTCOME} /></Field>
        </div>
      )}
      {bare ? (
        <textarea
          rows={4}
          value={v.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
        />
      ) : (
        <Textarea rows={3} value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder={placeholder} />
      )}
    </div>
  )
}

/* edit-modal wrapper that owns its own state */
function ActivityFields({ initial, onSubmit }) {
  const [v, setV] = useState({ ...blankActivity(), ...initial })
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }))
  return (
    <form
      id="edit-act"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(v)
      }}
    >
      <TypeTabs value={v.type} onChange={(type) => set({ type })} />
      <ActivityBody v={v} set={set} />
    </form>
  )
}
function ModalSaveButton({ busy }) {
  return (
    <Button type="submit" form="edit-act" disabled={busy}>
      {busy ? <Spinner size={16} /> : 'Save'}
    </Button>
  )
}

function Row({ label, value, href, link, icon: Icon }) {
  return (
    <div className="flex items-start gap-4 border-b border-[var(--color-line-soft)] pb-4 last:border-0 sm:border-0 sm:pb-0">
      <dt className="w-36 shrink-0 text-[13px] text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--color-ink)]">
        {value ? (
          href ? (
            <a href={href} className={`inline-flex items-center gap-1.5 ${link ? 'break-all text-[var(--color-brand)]' : 'text-[var(--color-ink)]'}`}>
              {value}
              {Icon && <Icon size={14} className="text-[var(--color-ink-faint)]" />}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        )}
      </dd>
    </div>
  )
}

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ' · ' + timeShort(iso)
}

// WhatsApp deep link — Gambia (+220) if a local 7–8 digit number
function waUrl(num) {
  if (!num) return null
  const digits = String(num).replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits.length <= 8 ? '220' + digits : digits}`
}
