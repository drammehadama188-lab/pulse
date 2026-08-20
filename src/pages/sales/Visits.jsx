import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Button, Card, Pill, Spinner, Modal, ConfirmDialog, Field, Input, Select, Textarea } from '../../components/ui.jsx'
import { TRANSPORT_OUTCOME } from '../../lib/salesOptions.js'
import { dalasi } from '../../lib/format.js'

const EMPTY = { date: new Date().toISOString().slice(0, 10), from: '', to: '', cost: '', reason: '', outcome: 'Follow Up Needed', company: '', notes: '' }
const TONE = { 'Sale Closed': 'good', 'Lead Created': 'good', Interested: 'brand', 'Follow Up Needed': 'warn', 'No Show': 'bad' }

export default function Visits() {
  const { isViewAs } = useAuth()
  const [rows, setRows] = useState(null)
  const [editor, setEditor] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { visits } = await api('/visits')
    setRows(visits.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1)))
  }
  useEffect(() => {
    load()
  }, [])

  const monthSpend = useMemo(() => {
    const m = new Date().toISOString().slice(0, 7)
    return (rows || []).filter((r) => (r.date || '').startsWith(m)).reduce((s, r) => s + (Number(r.cost) || 0), 0)
  }, [rows])

  async function save(v) {
    setBusy(true)
    try {
      if (editor.mode === 'add') await api('/visits', { method: 'POST', body: v })
      else await api(`/visits/${editor.record.id}`, { method: 'PATCH', body: v })
      setEditor(null)
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function doDelete() {
    setBusy(true)
    try {
      await api(`/visits/${confirm.id}`, { method: 'DELETE' })
      setConfirm(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <div className="flex justify-center py-16"><Spinner size={26} /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--color-ink-soft)]">
          {rows.length} visits · {dalasi(monthSpend)} transport this month
        </p>
        {!isViewAs && (
          <Button icon={Plus} size="sm" onClick={() => setEditor({ mode: 'add', record: EMPTY })}>
            Log visit
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[var(--color-ink-faint)]">
          No visits logged yet. Tap <span className="font-semibold">Log visit</span> after a field trip.
        </Card>
      ) : (
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-rest-bg)] text-[var(--color-rest)]">
                <MapPin size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--color-ink)]">
                    {r.from || '—'} → {r.to || '—'}
                  </span>
                  {Number(r.cost) > 0 && <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">{dalasi(r.cost)}</span>}
                </div>
                {(r.reason || r.company) && (
                  <div className="mt-0.5 text-[13px] text-[var(--color-ink-faint)]">
                    {[r.company, r.reason].filter(Boolean).join(' · ')}
                  </div>
                )}
                {r.notes && <div className="mt-1 text-[13px] italic text-[var(--color-ink-soft)]">“{r.notes}”</div>}
                {r.date && (
                  <div className="mt-1 text-[11.5px] text-[var(--color-ink-faint)]">
                    {new Date(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Pill tone={TONE[r.outcome] || 'neutral'}>{r.outcome}</Pill>
                {!isViewAs && (
                  <div className="flex gap-1">
                    <button onClick={() => setEditor({ mode: 'edit', record: r })} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setConfirm({ id: r.id, label: `${r.from} → ${r.to}` })} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {editor && <VisitForm editor={editor} onClose={() => setEditor(null)} onSave={save} busy={busy} />}
      <ConfirmDialog open={!!confirm} title="Delete visit" message={`Remove "${confirm?.label}"?`} onCancel={() => setConfirm(null)} onConfirm={doDelete} busy={busy} />
    </div>
  )
}

function VisitForm({ editor, onClose, onSave, busy }) {
  const [v, setV] = useState(editor.record)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  return (
    <Modal
      open
      onClose={onClose}
      title={`${editor.mode === 'add' ? 'Log' : 'Edit'} visit`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(v)} disabled={busy}>{busy ? <Spinner size={16} /> : 'Save'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From"><Input value={v.from} onChange={set('from')} placeholder="e.g. Kairaba Avenue" /></Field>
        <Field label="To"><Input value={v.to} onChange={set('to')} placeholder="e.g. Kotu" /></Field>
        <Field label="Transport cost (D)"><Input type="number" value={v.cost} onChange={set('cost')} /></Field>
        <Field label="Date"><Input type="date" value={v.date} onChange={set('date')} /></Field>
        <Field label="Outcome"><Select value={v.outcome} onChange={set('outcome')} options={TRANSPORT_OUTCOME} /></Field>
        <Field label="Company / Prospect"><Input value={v.company} onChange={set('company')} /></Field>
        <div className="sm:col-span-2"><Field label="Reason for visit"><Input value={v.reason} onChange={set('reason')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={v.notes} onChange={set('notes')} /></Field></div>
      </div>
    </Modal>
  )
}
