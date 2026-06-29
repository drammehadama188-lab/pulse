import { useEffect, useState } from 'react'
import { Palmtree, Plus, Stethoscope, Clock } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Button, Card, Pill, SectionTitle, Spinner, StatCard } from '../components/ui.jsx'
import { dateShort } from '../lib/format.js'

const TYPES = ['Annual', 'Sick', 'Unpaid', 'Compassionate', 'Maternity']
const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad' }

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Leave() {
  const { isViewAs } = useAuth()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ type: 'Annual', from: '', to: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const [leave, rec] = await Promise.all([api('/leave/mine'), api('/my/record').catch(() => null)])
    setData({ ...leave, joined: rec?.joined || null })
  }
  useEffect(() => {
    load()
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.from || !form.to) return setError('Pick both dates')
    if (form.to < form.from) return setError('End date is before start date')
    setBusy(true)
    try {
      await api('/leave', { method: 'POST', body: form })
      setForm({ type: 'Annual', from: '', to: '', reason: '' })
      setOpen(false)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const pending = data.requests.filter((r) => r.status === 'pending').length
  const annualNote = data.annualEligible ? 'Eligible' : data.eligibleFrom ? `From ${fmtDate(data.eligibleFrom)}` : 'After 12 months'
  const mw = data.joined ? Math.max(0, Math.round((Date.now() - new Date(data.joined).getTime()) / 2629800000)) : null
  const tenureLabel = mw == null ? '—' : mw >= 12 ? `${Math.floor(mw / 12)}y ${mw % 12}m` : `${mw} mo`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Requests</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">Request time off and track approvals.</p>
        </div>
        {!isViewAs && (
          <Button icon={Plus} onClick={() => setOpen((o) => !o)}>Request</Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Palmtree}
          tone={data.annualEligible ? 'good' : 'warn'}
          label="Annual leave"
          value={tenureLabel === '—' ? annualNote : `${tenureLabel} worked`}
          sub={data.annualEligible ? 'Eligible now' : (data.eligibleFrom ? `Eligible from ${fmtDate(data.eligibleFrom)}` : 'Eligible after 12 months')}
        />
        <StatCard icon={Stethoscope} tone="rest" label="Sick leave" value="Medical certificate" sub="Required for sick leave" />
        <StatCard icon={Clock} tone="warn" label="Pending" value={pending} sub="Requests awaiting approval" />
      </div>

      {/* request form */}
      {open && (
        <Card className="p-5 rise">
          <SectionTitle>New leave request</SectionTitle>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="focus-ring w-full rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 outline-none"
              >
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="hidden sm:block" />
            <div>
              <label className="mb-1.5 block text-sm font-semibold">From</label>
              <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="focus-ring w-full rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">To</label>
              <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="focus-ring w-full rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold">Reason (optional)</label>
              <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} className="focus-ring w-full resize-none rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 outline-none" placeholder="A short note for your manager" />
            </div>
            {form.type === 'Annual' && !data.annualEligible && (
              <div className="sm:col-span-2 rounded-xl bg-[var(--color-warn-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-warn)]">
                Annual leave is available after 12 months of service{data.eligibleFrom ? ` (from ${fmtDate(data.eligibleFrom)})` : ''}. You can still submit — your manager will decide.
              </div>
            )}
            {form.type === 'Sick' && (
              <div className="sm:col-span-2 rounded-xl bg-[var(--color-rest-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-rest)]">
                Sick leave requires a valid medical certificate.
              </div>
            )}
            {error && (
              <div className="sm:col-span-2 rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? <Spinner size={16} /> : 'Submit request'}</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* my requests */}
      <div>
        <SectionTitle>My requests</SectionTitle>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
          {data.requests.length === 0 && (
            <div className="px-5 py-10 text-center text-[var(--color-ink-faint)]">
              No leave requests yet. Tap <span className="font-semibold">Request</span> to add one.
            </div>
          )}
          {data.requests
            .slice()
            .reverse()
            .map((r) => (
              <div key={r.id} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-rest-bg)] text-[var(--color-rest)]"><Palmtree size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-ink)]">{r.type} · {r.days} day{r.days > 1 ? 's' : ''}</span>
                    <Pill tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Pill>
                  </div>
                  <div className="text-sm text-[var(--color-ink-faint)]">{dateShort(r.from)} – {dateShort(r.to)}{r.reason ? ` · ${r.reason}` : ''}</div>
                  {r.status !== 'pending' && r.decidedBy && (
                    <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
                      {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.decidedBy}{r.decidedAt ? ` · ${dateShort(r.decidedAt)}` : ''}
                    </div>
                  )}
                  {r.decisionNote && (
                    <div className="mt-1 text-sm text-[var(--color-ink-soft)]">
                      <span className="font-semibold text-[var(--color-ink)]">Note:</span> {r.decisionNote}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </Card>
      </div>
    </div>
  )
}
