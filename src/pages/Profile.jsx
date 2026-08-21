import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { Avatar, Button, Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'

// My Profile — the staff self-view. Their own contract (the rich card, read-only)
// and employment history. Data comes from /api/my/record, scoped to the caller —
// staff never see anyone else's record. Reviews / Pay / Documents have their own
// pages; this is "who I am and where my contract stands".

const DAY = 86400000
function fmtDate(d) {
  if (!d) return '—'
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return d // already a label like "Oct 2025"
  const x = new Date(`${d}T00:00:00`)
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)] mb-1">{label}</p>
      <p className={`text-[13px] font-semibold ${accent || 'text-[var(--color-ink)]'}`}>{value}</p>
    </div>
  )
}

export default function Profile() {
  const { user, logout } = useAuth()
  const [rec, setRec] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/my/record')
      .then((d) => setRec(d))
      .catch(() => setRec(null))
      .finally(() => setLoading(false))
  }, [user.name])

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  const c = rec?.contract || null
  const now = new Date()
  const daysToEnd = c?.end ? Math.ceil((new Date(`${c.end}T00:00:00`) - now) / DAY) : null
  const terminated = c?.status === 'terminated'
  const permanent = c?.status === 'permanent' || (c && !c.end && !terminated)
  const badge = !c ? { label: '—', cls: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]' }
    : terminated ? { label: 'Ended', cls: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' }
    : permanent ? { label: 'Permanent', cls: 'bg-[var(--color-good-bg)] text-[var(--color-good)]' }
    : daysToEnd != null && daysToEnd < 0 ? { label: 'Expired', cls: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' }
    : daysToEnd != null && daysToEnd <= 30 ? { label: 'Expiring soon', cls: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]' }
    : { label: 'Active', cls: 'bg-[var(--color-good-bg)] text-[var(--color-good)]' }
  const history = rec?.history || []

  return (
    <div className="space-y-4">
      <h1 className="t-page">My profile</h1>

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-3 p-8 text-center" style={{ background: 'linear-gradient(160deg, var(--color-brand-50), var(--color-surface) 70%)' }}>
          <Avatar name={user.name} size={84} />
          <div>
            <div className="text-[18px] font-semibold tracking-tight">{user.name}</div>
            <div className="text-[var(--color-ink-soft)]">{rec?.role || user.title}</div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {(rec?.department || user.department) && <Pill tone="brand" dot>{rec?.department || user.department}</Pill>}
            <Pill tone={user.role === 'manager' ? 'good' : 'neutral'}>{user.role === 'manager' ? 'Manager' : 'Staff'}</Pill>
          </div>
        </div>
      </Card>

      {/* My contract */}
      {c && (
        <div>
          <SectionTitle>My contract</SectionTitle>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-5">
              <span className="text-[13px] font-semibold text-[var(--color-ink)]">{c.type || 'Contract'}</span>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
              <Stat label="Type" value={c.type || '—'} />
              <Stat label="Start date" value={fmtDate(c.start)} />
              <Stat label="End date" value={c.end ? fmtDate(c.end) : 'No end date'} accent={daysToEnd != null && daysToEnd <= 30 && !terminated ? 'text-[var(--color-bad)]' : 'text-[var(--color-ink)]'} />
              <Stat label="Time left" value={daysToEnd == null ? '—' : daysToEnd < 0 ? `${-daysToEnd} days ago` : `${daysToEnd} days`} accent={daysToEnd != null && daysToEnd <= 30 && !terminated ? 'text-[var(--color-bad)]' : 'text-[var(--color-ink)]'} />
            </div>
          </Card>
        </div>
      )}

      {/* Employment history */}
      {history.length > 0 && (
        <div>
          <SectionTitle>Employment history</SectionTitle>
          <Card className="p-5">
            <ol className="relative space-y-5 pl-6">
              <span className="absolute left-[7px] top-1 bottom-1 w-px bg-[var(--color-line)]" />
              {history.slice().reverse().map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[22px] top-1 h-3.5 w-3.5 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand)]" />
                  <div className="text-[13px] font-semibold text-[var(--color-ink)]">{h.event}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-faint)]">{fmtDate(h.date)}{h.dateApproximate ? ' (approx.)' : ''}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="danger" icon={LogOut} onClick={logout} className="w-full sm:w-auto">Log out</Button>
      </div>
    </div>
  )
}
