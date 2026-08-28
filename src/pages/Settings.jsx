import { Link } from 'react-router-dom'
import { Building2, Users, ShieldCheck, History, SlidersHorizontal, Plug, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

// Settings — the arrangement Adama asked for on 27 Aug ("in admin we have
// settings where the permission toggles sit and the whole set up is so
// organised... the staff page needs to go"). Same shape as admin's Settings:
// grouped rows, each one a place rather than a pile of switches.
//
// 🔑 Rows that are not built yet say so rather than being hidden. A settings
// page that quietly omits half its subject teaches you not to trust it; one
// that says "Soon" tells you where this is going.
const GROUPS = [
  {
    title: 'Company',
    items: [
      { icon: Building2, label: 'Company profile', detail: 'Name, address and the details that appear on documents', to: null },
      { icon: SlidersHorizontal, label: 'Preferences', detail: 'Working week, leave year and company-wide defaults', to: null },
    ],
  },
  {
    title: 'Team & access',
    items: [
      { icon: Users, label: 'Members', detail: 'Everyone with a Pulse account, and the role they hold', to: '/settings/team?tab=members' },
      { icon: ShieldCheck, label: 'Roles', detail: 'What each role can do — set it once, everyone on it follows', to: '/settings/team?tab=roles' },
      { icon: History, label: 'Access activity', detail: 'Who changed whose access, and when', to: '/settings/team?tab=activity' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { icon: Plug, label: 'Damia Tracker admin', detail: 'The staff list Pulse sends to the tracker system', to: null },
    ],
  },
]

export default function Settings() {
  const { user } = useAuth()
  const isOwner = user?.username === 'adama'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="t-page">Settings</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Company details, who can do what, and the systems Pulse talks to.</p>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-[12.5px] font-semibold text-[var(--color-ink-soft)]">{g.title}</h2>
          <div className="card divide-y divide-[var(--color-line-soft)]">
            {g.items.map((it) => {
              const live = it.to && (isOwner || g.title !== 'Team & access')
              const Row = (
                <span className="flex items-center gap-4 px-5 py-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-fill)] text-[var(--color-ink-soft)]">
                    <it.icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-[var(--color-ink)]">{it.label}</span>
                    <span className="block text-[12.5px] text-[var(--color-ink-soft)]">{it.detail}</span>
                  </span>
                  {live
                    ? <ChevronRight size={16} className="shrink-0 text-[var(--color-ink-faint)]" />
                    : <span className="shrink-0 rounded-[6px] bg-[var(--color-fill)] px-2 py-1 text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                      {it.to ? 'Owner only' : 'Soon'}
                    </span>}
                </span>
              )
              return live
                ? <Link key={it.label} to={it.to} className="block hover:bg-[var(--color-soft)]">{Row}</Link>
                : <div key={it.label} className="opacity-70">{Row}</div>
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
