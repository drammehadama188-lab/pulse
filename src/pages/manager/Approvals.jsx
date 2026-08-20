import { useEffect, useState } from 'react'
import { Check, X, Palmtree, Inbox, Lock } from 'lucide-react'
import { api } from '../../lib/api.js'
import { Avatar, Button, Card, Field, Modal, Pill, SectionTitle, Spinner, Textarea } from '../../components/ui.jsx'
import { dateShort } from '../../lib/format.js'

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad' }

const decidedOn = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export default function Approvals({ scope }) {
  const team = scope === 'team' // MY TEAM: a lead sees only their own team
  const listUrl = team ? '/team/leave' : '/leave'
  const decideUrl = (id, action) => (team ? `/team/leave/${id}/${action}` : `/leave/${id}/${action}`)
  const [requests, setRequests] = useState(null)
  const [decision, setDecision] = useState(null) // { request, action }

  async function load() {
    const { requests } = await api(listUrl)
    setRequests(requests)
  }
  useEffect(() => {
    load()
  }, [])

  if (!requests)
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} />
      </div>
    )

  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight md:text-[26px]">{team ? 'Team Requests' : 'Approvals'}</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{team ? 'Leave requests from your team.' : 'Review and decide leave requests.'}</p>
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
                  <div className="font-semibold text-[var(--color-ink)]">{r.name}</div>
                  <div className="text-[13px] text-[var(--color-ink-faint)]">
                    {r.type} · {r.days} day{r.days > 1 ? 's' : ''} · {dateShort(r.from)}–{dateShort(r.to)}
                  </div>
                  {r.reason && <div className="mt-1 text-[13px] italic text-[var(--color-ink-soft)]">“{r.reason}”</div>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="good" icon={Check} onClick={() => setDecision({ request: r, action: 'approve' })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" icon={X} onClick={() => setDecision({ request: r, action: 'reject' })}>
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
                <div key={r.id} className="flex items-start gap-4 px-5 py-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-rest-bg)] text-[var(--color-rest)]">
                    <Palmtree size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--color-ink)]">{r.name}</span>
                      <Pill tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Pill>
                    </div>
                    <div className="text-[13px] text-[var(--color-ink-faint)]">
                      {r.type} · {dateShort(r.from)}–{dateShort(r.to)}
                    </div>
                    {r.decidedBy && (
                      <div className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">
                        by {r.decidedBy}{r.decidedAt ? ` · ${decidedOn(r.decidedAt)}` : ''}
                      </div>
                    )}
                    {r.decisionNote && (
                      <div className="mt-1.5 text-[13px] text-[var(--color-ink-soft)]">
                        <span className="font-semibold text-[var(--color-ink)]">To {r.name.split(' ')[0]}:</span> {r.decisionNote}
                      </div>
                    )}
                    {r.approverWhy && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[var(--color-fill)] px-2.5 py-1.5 text-[11.5px] text-[var(--color-ink-soft)]">
                        <Lock size={12} className="mt-0.5 shrink-0" />
                        <span><span className="font-semibold">CEO-only:</span> {r.approverWhy}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </Card>
        </div>
      )}

      {decision && (
        <DecisionModal
          request={decision.request}
          action={decision.action}
          endpoint={decideUrl(decision.request.id, decision.action)}
          showWhy={!team}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); load() }}
        />
      )}
    </div>
  )
}

function DecisionModal({ request, action, endpoint, showWhy = true, onClose, onDone }) {
  const approve = action === 'approve'
  const [note, setNote] = useState('')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const first = request.name.split(' ')[0]

  async function submit() {
    setBusy(true)
    try {
      await api(endpoint, { method: 'POST', body: { note, why } })
      onDone()
    } catch (e) {
      alert(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${approve ? 'Approve' : 'Reject'} — ${request.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={approve ? 'good' : 'danger'} onClick={submit} disabled={busy}>
            {busy ? <Spinner size={16} /> : approve ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-[var(--color-fill)] px-4 py-3 text-[13px] text-[var(--color-ink-soft)]">
          {request.type} · {request.days} day{request.days > 1 ? 's' : ''} · {dateShort(request.from)}–{dateShort(request.to)}
          {request.reason && <div className="mt-1 italic">“{request.reason}”</div>}
        </div>
        <Field label={`Note for ${first} (they'll see this)`}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={approve ? 'e.g. Approved — enjoy your time off' : 'e.g. We need cover that week, please re-request later'}
          />
        </Field>
        {showWhy && (
          <Field label="Why this decision — CEO only (private)">
            <Textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              rows={2}
              placeholder="Your reasoning — only the CEO sees this, never the employee"
            />
          </Field>
        )}
      </div>
    </Modal>
  )
}
