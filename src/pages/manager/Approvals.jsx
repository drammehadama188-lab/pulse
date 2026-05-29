import { useEffect, useState } from 'react'
import { Check, X, Palmtree, Inbox } from 'lucide-react'
import { api } from '../../lib/api.js'
import { Avatar, Button, Card, Pill, SectionTitle, Spinner } from '../../components/ui.jsx'
import { dateShort } from '../../lib/format.js'

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad' }

export default function Approvals() {
  const [requests, setRequests] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    const { requests } = await api('/leave')
    setRequests(requests)
  }
  useEffect(() => {
    load()
  }, [])

  async function decide(id, action) {
    setBusyId(id)
    try {
      await api(`/leave/${id}/${action}`, { method: 'POST' })
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!requests)
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} />
      </div>
    )

  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Approvals</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Review and decide leave requests.</p>
      </div>

      <div>
        <SectionTitle>Pending {pending.length > 0 && <Pill tone="warn">{pending.length}</Pill>}</SectionTitle>
        {pending.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 py-12 text-center text-[var(--color-ink-faint)]">
            <Inbox size={32} />
            <span>You're all caught up.</span>
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4">
                <Avatar name={r.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[var(--color-ink)]">{r.name}</div>
                  <div className="text-sm text-[var(--color-ink-faint)]">
                    {r.type} · {r.days} day{r.days > 1 ? 's' : ''} · {dateShort(r.from)}–{dateShort(r.to)}
                  </div>
                  {r.reason && (
                    <div className="mt-1 text-sm italic text-[var(--color-ink-soft)]">“{r.reason}”</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="good"
                    icon={Check}
                    disabled={busyId === r.id}
                    onClick={() => decide(r.id, 'approve')}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={X}
                    disabled={busyId === r.id}
                    onClick={() => decide(r.id, 'reject')}
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <SectionTitle>Decided</SectionTitle>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {decided
              .slice()
              .reverse()
              .map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-rest-bg)] text-[var(--color-rest)]">
                    <Palmtree size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[var(--color-ink)]">{r.name}</div>
                    <div className="text-sm text-[var(--color-ink-faint)]">
                      {r.type} · {dateShort(r.from)}–{dateShort(r.to)}
                    </div>
                  </div>
                  <Pill tone={STATUS_TONE[r.status]}>
                    {r.status[0].toUpperCase() + r.status.slice(1)}
                  </Pill>
                </div>
              ))}
          </Card>
        </div>
      )}
    </div>
  )
}
