import { useEffect, useState } from 'react'
import { Plus, Trash2, Megaphone, Tag } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Button, Card, Pill, Spinner, Modal, ConfirmDialog, Field, Input, Select, Textarea } from '../../components/ui.jsx'
import { PRICING } from '../../lib/salesOptions.js'
import { dalasi } from '../../lib/format.js'

const TYPES = ['General', 'Pricing', 'Policy', 'Urgent']
const TYPE_TONE = { General: 'brand', Pricing: 'good', Policy: 'rest', Urgent: 'bad' }

export default function Notices() {
  const { realIsManager, isViewAs } = useAuth()
  const canManage = realIsManager && !isViewAs
  const [items, setItems] = useState(null)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { announcements } = await api('/announcements')
    setItems(announcements)
  }
  useEffect(() => {
    load()
  }, [])

  async function save(v) {
    setBusy(true)
    try {
      await api('/announcements', { method: 'POST', body: v })
      setOpen(false)
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function doDelete() {
    setBusy(true)
    try {
      await api(`/announcements/${confirm.id}`, { method: 'DELETE' })
      setConfirm(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight md:text-[27px]">Notices</h1>

      {/* pricing reference */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-5 py-4">
          <Tag size={18} className="text-[var(--color-good)]" />
          <h3 className="font-bold text-[var(--color-ink)]">Pricing & discount policy</h3>
        </div>
        <div className="divide-y divide-[var(--color-line-soft)]">
          {PRICING.map((p, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1">
                <div className="font-semibold text-[var(--color-ink)]">{p.tier}</div>
                <div className="text-sm text-[var(--color-ink-faint)]">{p.vehicles}</div>
              </div>
              {p.price != null ? (
                <div className="text-lg font-semibold text-[var(--color-ink)]">{dalasi(p.price)}</div>
              ) : (
                <Pill tone="warn">Needs approval</Pill>
              )}
            </div>
          ))}
        </div>
        <div className="bg-[var(--color-fill)] px-5 py-3 text-xs text-[var(--color-ink-soft)]">
          Always use approved pricing. Any other discount must be authorised before promising it.
        </div>
      </Card>

      {/* announcements */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-[var(--color-brand)]" />
            <h3 className="font-bold text-[var(--color-ink)]">Announcements</h3>
          </div>
          {canManage && (
            <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>
              Post
            </Button>
          )}
        </div>

        {!items ? (
          <div className="flex justify-center py-10"><Spinner size={24} /></div>
        ) : items.length === 0 ? (
          <Card className="px-5 py-10 text-center text-[var(--color-ink-faint)]">No announcements yet.</Card>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={TYPE_TONE[a.type] || 'brand'}>{a.type}</Pill>
                      <span className="font-bold text-[var(--color-ink)]">{a.title}</span>
                    </div>
                    {a.body && <div className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{a.body}</div>}
                    <div className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                      {a.author} · {new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  {canManage && (
                    <button onClick={() => setConfirm({ id: a.id, label: a.title })} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {open && <NoticeForm onClose={() => setOpen(false)} onSave={save} busy={busy} />}
      <ConfirmDialog open={!!confirm} title="Delete announcement" message={`Remove "${confirm?.label}"?`} onCancel={() => setConfirm(null)} onConfirm={doDelete} busy={busy} />
    </div>
  )
}

function NoticeForm({ onClose, onSave, busy }) {
  const [v, setV] = useState({ title: '', body: '', type: 'General' })
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const [error, setError] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title="Post announcement"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => (v.title.trim() ? onSave(v) : setError('Title is required'))} disabled={busy}>
            {busy ? <Spinner size={16} /> : 'Post'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Type"><Select value={v.type} onChange={set('type')} options={TYPES} /></Field>
        <Field label="Title"><Input value={v.title} onChange={set('title')} placeholder="e.g. New fleet pricing" /></Field>
        <Field label="Message"><Textarea rows={3} value={v.body} onChange={set('body')} /></Field>
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}
