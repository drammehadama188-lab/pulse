import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Phone } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Button, Card, Pill, Spinner, Modal, ConfirmDialog, Field, Input, Select, Textarea } from '../../components/ui.jsx'
import { CALL_STATUS, NEXT_ACTION } from '../../lib/salesOptions.js'

const EMPTY = { date: new Date().toISOString().slice(0, 10), name: '', phone: '', callStatus: 'No Answer', note: '', nextAction: 'Call Back' }
const TONE = { 'Interested - Lead': 'good', 'Wants More info': 'brand', 'Ask for call back': 'warn', 'Not Right Now': 'neutral', 'No Answer': 'neutral', 'Not Interested': 'bad', 'Wrong Number': 'bad', Visited: 'rest', 'Proposal Sent': 'brand' }

export default function Calls() {
  const { isViewAs } = useAuth()
  const [rows, setRows] = useState(null)
  const [editor, setEditor] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { calls } = await api('/calls')
    setRows(calls)
  }
  useEffect(() => {
    load()
  }, [])

  async function save(v) {
    setBusy(true)
    try {
      if (editor.mode === 'add') await api('/calls', { method: 'POST', body: v })
      else await api(`/calls/${editor.record.id}`, { method: 'PATCH', body: v })
      setEditor(null)
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function doDelete() {
    setBusy(true)
    try {
      await api(`/calls/${confirm.id}`, { method: 'DELETE' })
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
        <p className="text-[13px] text-[var(--color-ink-soft)]">{rows.length} calls logged</p>
        {!isViewAs && (
          <Button icon={Plus} size="sm" onClick={() => setEditor({ mode: 'add', record: EMPTY })}>
            Log call
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[var(--color-ink-faint)]">No calls logged yet.</Card>
      ) : (
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--color-ink)]">{r.name || 'Unknown'}</span>
                  {r.phone && (
                    <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-brand)]">
                      <Phone size={12} /> {r.phone}
                    </a>
                  )}
                </div>
                {r.note && <div className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{r.note}</div>}
                {r.nextAction && <div className="mt-1 text-[11.5px] font-semibold text-[var(--color-ink-faint)]">Next: {r.nextAction}</div>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Pill tone={TONE[r.callStatus] || 'neutral'}>{r.callStatus}</Pill>
                {!isViewAs && (
                  <div className="flex gap-1">
                    <button onClick={() => setEditor({ mode: 'edit', record: r })} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setConfirm({ id: r.id, label: r.name })} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {editor && <CallForm editor={editor} onClose={() => setEditor(null)} onSave={save} busy={busy} />}
      <ConfirmDialog
        open={!!confirm}
        title="Delete call"
        message={`Remove the call with "${confirm?.label}"?`}
        onCancel={() => setConfirm(null)}
        onConfirm={doDelete}
        busy={busy}
      />
    </div>
  )
}

function CallForm({ editor, onClose, onSave, busy }) {
  const [v, setV] = useState(editor.record)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  return (
    <Modal
      open
      onClose={onClose}
      title={`${editor.mode === 'add' ? 'Log' : 'Edit'} call`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(v)} disabled={busy}>{busy ? <Spinner size={16} /> : 'Save'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name / Company"><Input value={v.name} onChange={set('name')} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Call status"><Select value={v.callStatus} onChange={set('callStatus')} options={CALL_STATUS} /></Field>
        <Field label="Next action"><Select value={v.nextAction} onChange={set('nextAction')} options={NEXT_ACTION} /></Field>
        <Field label="Date"><Input type="date" value={v.date} onChange={set('date')} /></Field>
        <div className="sm:col-span-2"><Field label="Note"><Textarea rows={2} value={v.note} onChange={set('note')} /></Field></div>
      </div>
    </Modal>
  )
}
