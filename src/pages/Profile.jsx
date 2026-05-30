import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Briefcase, CalendarDays, BadgeCheck, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { Avatar, Button, Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'

export default function Profile() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/team').then((t) => {
      setMe(t.team.find((p) => p.name === user.name) || null)
      setLoading(false)
    })
  }, [user.name])

  if (loading)
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} />
      </div>
    )

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">My profile</h1>

      <Card className="overflow-hidden">
        <div
          className="flex flex-col items-center gap-3 p-8 text-center"
          style={{ background: 'linear-gradient(160deg, var(--color-brand-50), var(--color-surface) 70%)' }}
        >
          <Avatar name={user.name} size={84} />
          <div>
            <div className="text-xl font-extrabold tracking-tight">{user.name}</div>
            <div className="text-[var(--color-ink-soft)]">{user.title}</div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Pill tone="brand" dot>
              {user.department}
            </Pill>
            <Pill tone={user.role === 'manager' ? 'good' : 'neutral'}>
              {user.role === 'manager' ? 'Manager' : 'Staff'}
            </Pill>
          </div>
        </div>

        {me && (
          <div className="divide-y divide-[var(--color-line-soft)]">
            <Info icon={Briefcase} label="Contract" value={me.contract || '—'} />
            <Info icon={CalendarDays} label="Joined" value={me.joined || '—'} />
            <Info
              icon={BadgeCheck}
              label="Status"
              value={me.status ? me.status[0].toUpperCase() + me.status.slice(1) : '—'}
            />
          </div>
        )}
      </Card>

      {me?.history?.length > 0 && (
        <div>
          <SectionTitle>Journey</SectionTitle>
          <Card className="p-5">
            <ol className="relative space-y-5 pl-6">
              <span className="absolute left-[7px] top-1 bottom-1 w-px bg-[var(--color-line)]" />
              {me.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[22px] top-1 h-3.5 w-3.5 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand)]" />
                    <div className="text-sm font-semibold text-[var(--color-ink)]">{h.event}</div>
                    <div className="text-xs text-[var(--color-ink-faint)]">
                      {new Date(h.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      {h.dateApproximate ? ' (approx.)' : ''}
                    </div>
                  </li>
                ))}
            </ol>
          </Card>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {user.role === 'manager' && (
          <Button variant="outline" icon={Users} onClick={() => navigate('/team')} className="w-full sm:w-auto">
            Manage team
          </Button>
        )}
        <Button variant="danger" icon={LogOut} onClick={logout} className="w-full sm:w-auto">
          Log out
        </Button>
      </div>
    </div>
  )
}

function Info({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-line-soft)] text-[var(--color-ink-soft)]">
        <Icon size={18} />
      </span>
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      <span className="ml-auto font-semibold text-[var(--color-ink)]">{value}</span>
    </div>
  )
}
