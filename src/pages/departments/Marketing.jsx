import { useEffect, useState } from 'react'
import { Megaphone, Share2, Filter, CalendarDays, Handshake, DollarSign, Plus, Trash2, Users2, Target, Wallet } from 'lucide-react'
import { api } from '../../lib/api.js'
import { Button, Card, Input, SectionTitle, Spinner, StatCard } from '../../components/ui.jsx'

// Marketing department — built fresh in Pulse. Editable sections backed by
// /api/marketing (Pulse's own store). Starts empty; the team fills it in.
const SECTIONS = [
  { key: 'socialMedia', title: 'Social media', icon: Share2, cols: [
    { k: 'platform', label: 'Platform' }, { k: 'handle', label: 'Handle' }, { k: 'followers', label: 'Followers', type: 'number' },
  ] },
  { key: 'leadSources', title: 'Lead sources', icon: Filter, cols: [
    { k: 'source', label: 'Source' }, { k: 'leads', label: 'Leads', type: 'number' }, { k: 'conversions', label: 'Conversions', type: 'number' },
  ] },
  { key: 'contentCalendar', title: 'Content calendar', icon: CalendarDays, cols: [
    { k: 'date', label: 'Date', type: 'date' }, { k: 'title', label: 'Title' }, { k: 'channel', label: 'Channel' }, { k: 'status', label: 'Status' },
  ] },
  { key: 'campaigns', title: 'Campaigns', icon: Megaphone, cols: [
    { k: 'name', label: 'Campaign' }, { k: 'status', label: 'Status' }, { k: 'budget', label: 'Budget (D)', type: 'number' }, { k: 'spent', label: 'Spent (D)', type: 'number' },
  ] },
  { key: 'collaborations', title: 'Collaborations', icon: Handshake, cols: [
    { k: 'partner', label: 'Partner' }, { k: 'type', label: 'Type' }, { k: 'status', label: 'Status' },
  ] },
  { key: 'adSpend', title: 'Ad spend', icon: DollarSign, cols: [
    { k: 'channel', label: 'Channel' }, { k: 'amount', label: 'Amount (D)', type: 'number' }, { k: 'period', label: 'Period' },
  ] },
]

const sum = (arr, k) => (arr || []).reduce((s, r) => s + (Number(r[k]) || 0), 0)

export default function Marketing() {
  const [data, setData] = useState(null)

  useEffect(() => {
    api('/marketing').then(setData)
  }, [])

  function onSaved(key, items) {
    setData((d) => ({ ...d, [key]: items }))
  }

  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const activeCampaigns = (data.campaigns || []).filter((c) => (c.status || '').toLowerCase() === 'active').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[27px]">Marketing</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Department · social, leads, content, campaigns</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users2} tone="brand" label="Total followers" value={sum(data.socialMedia, 'followers').toLocaleString()} />
        <StatCard icon={Target} tone="good" label="Leads (all sources)" value={sum(data.leadSources, 'leads').toLocaleString()} />
        <StatCard icon={Megaphone} tone="warn" label="Active campaigns" value={activeCampaigns} />
        <StatCard icon={Wallet} tone="rest" label="Ad spend (D)" value={sum(data.adSpend, 'amount').toLocaleString()} />
      </div>

      {SECTIONS.map((s) => (
        <EditableSection key={s.key} section={s} rows={data[s.key] || []} onSaved={(items) => onSaved(s.key, items)} />
      ))}
    </div>
  )
}

function EditableSection({ section, rows, onSaved }) {
  const [items, setItems] = useState(rows)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(items) !== JSON.stringify(rows)

  function setCell(i, k, v) {
    setItems((arr) => arr.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
  }
  function addRow() {
    setItems((arr) => [...arr, Object.fromEntries(section.cols.map((c) => [c.k, '']))])
  }
  function removeRow(i) {
    setItems((arr) => arr.filter((_, idx) => idx !== i))
  }
  async function save() {
    setBusy(true)
    try {
      const res = await api(`/marketing/${section.key}`, { method: 'POST', body: { items } })
      onSaved(res[section.key] ?? items)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SectionTitle
        action={
          dirty ? (
            <Button size="sm" onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : 'Save'}</Button>
          ) : (
            <Button size="sm" variant="ghost" icon={Plus} onClick={addRow}>Add</Button>
          )
        }
      >
        <span className="inline-flex items-center gap-2">
          <section.icon size={16} className="text-[var(--color-brand)]" /> {section.title}
        </span>
      </SectionTitle>

      <Card className="overflow-hidden">
        {/* header */}
        <div className="hidden gap-3 border-b border-[var(--color-line-soft)] px-4 py-2.5 sm:flex">
          {section.cols.map((c) => (
            <div key={c.k} className="flex-1 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{c.label}</div>
          ))}
          <div className="w-9" />
        </div>

        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
            Nothing yet — hit <span className="font-semibold">Add</span> to start.
          </div>
        )}

        {items.map((row, i) => (
          <div key={i} className="flex flex-col gap-2 border-b border-[var(--color-line-soft)] px-3 py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
            {section.cols.map((c) => (
              <div key={c.k} className="flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)] sm:hidden">{c.label}</span>
                <Input
                  type={c.type || 'text'}
                  value={row[c.k] ?? ''}
                  onChange={(e) => setCell(i, c.k, e.target.value)}
                  placeholder={c.label}
                  className="!py-2"
                />
              </div>
            ))}
            <button
              onClick={() => removeRow(i)}
              title="Remove row"
              className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)] sm:self-center"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {items.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Button size="sm" variant="ghost" icon={Plus} onClick={addRow}>Add row</Button>
            {dirty && <span className="text-xs font-semibold text-[var(--color-warn)]">Unsaved changes</span>}
          </div>
        )}
      </Card>
    </div>
  )
}
