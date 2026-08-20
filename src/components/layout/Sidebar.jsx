import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { groupedNavFor, departmentsFor } from './nav.js'
import { RECRUITMENT_NAV } from '../../pages/recruitment/nav.js'
import { Brand } from './Brand.jsx'
import { Avatar } from '../ui.jsx'

// "Open Admin" SSO button removed 12 Jun 2026 at Adama's request — Pulse is
// now HR-only, with no sign-in bridge into the customer/admin system. The old
// OpenAdminButton component (api('/open-admin'), ExternalLink icon) lived here.

function SectionLabel({ children }) {
  return (
    <div className="mb-1 mt-6 px-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 first:mt-0">
      {children}
    </div>
  )
}

function NavRow({ item, soon = false }) {
  return (
    <NavLink
      to={item.to}
      end={item.end || item.to === '/'}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
          isActive
            ? 'bg-white text-[var(--color-sidebar)]'
            : 'text-white/75 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon size={20} strokeWidth={isActive ? 2.4 : 2} className="shrink-0" />
          <span className="flex-1">{item.label}</span>
          {soon && (
            <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/70">
              Soon
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const { user, logout } = useAuth()
  const { top, sections } = groupedNavFor(user)
  const departments = departmentsFor(user)
  const { pathname } = useLocation()
  // Inside Recruitment the sidebar becomes Recruitment's own pages — it is a
  // department you go into, not one link among twenty. One row back out.
  const inRecruitment = pathname.startsWith('/recruitment')

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-sidebar-edge)] bg-[var(--color-sidebar)] px-4 py-6 md:flex">
      <div className="px-2">
        <Brand onDark />
      </div>

      {inRecruitment ? (
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          <NavLink to="/" className="mb-3 flex items-center gap-2 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white/50 transition-colors hover:text-white">
            <ArrowLeft size={14} /> Pulse
          </NavLink>
          <SectionLabel>Recruitment</SectionLabel>
          {RECRUITMENT_NAV.map((item) => (
            <NavRow key={item.id} item={item} />
          ))}
        </nav>
      ) : (
      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {top.map((item) => (
          <NavRow key={item.id} item={item} />
        ))}

        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <SectionLabel>{section.label}</SectionLabel>
            {section.items.map((item) => (
              <NavRow key={item.id} item={item} />
            ))}
          </div>
        ))}

        {departments.length > 0 && (
          <>
            <SectionLabel>Departments</SectionLabel>
            {departments.map((item) => (
              <NavRow key={item.to} item={item} soon={!item.ready} />
            ))}
          </>
        )}
      </nav>
      )}

      {/* Open Admin SSO button removed 12 Jun 2026 at Adama's request — Pulse is HR-only now. */}

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/15 bg-white/10 p-3">
        <Avatar name={user?.name} size={38} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold text-white">{user?.name}</div>
          <div className="truncate text-xs text-white/60">{user?.title}</div>
        </div>
        <button
          onClick={logout}
          title="Log out"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-ring"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  )
}
