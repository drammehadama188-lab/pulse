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
    <div className="mb-1.5 mt-6 px-3 text-[10px] font-semibold text-[var(--color-sidebar-ink-faint)] first:mt-0">
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
        `group flex items-center gap-2.5 whitespace-nowrap rounded-[8px] px-3 py-2.5 text-[13px] transition-colors ${
          isActive
            ? 'bg-[var(--color-brand)] font-medium text-white'
            : 'font-normal text-[var(--color-sidebar-ink)] hover:bg-white/[0.05] hover:text-[var(--color-sidebar-ink-hover)]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon size={18} strokeWidth={isActive ? 2 : 1.7} className="shrink-0"
            style={{ color: isActive ? '#fff' : undefined }} />
          <span className="flex-1">{item.label}</span>
          {soon && (
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--color-sidebar-ink-faint)]">
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
    <aside
      className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-sidebar-edge)] px-4 py-5 md:flex"
      style={{ background: 'var(--color-sidebar)' }}
    >
      <div className="px-2">
        <Brand onDark />
      </div>

      {inRecruitment ? (
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          <NavLink to="/" className="mb-3 flex items-center gap-2 px-3 py-2 text-[10px] font-semibold text-[var(--color-sidebar-ink-faint)] transition-colors hover:text-white">
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

      <div className="mt-4 flex items-center gap-2.5 rounded-[8px] border border-[var(--color-sidebar-edge)] bg-[var(--color-sidebar-tile)] px-2.5 py-2.5">
        <Avatar name={user?.name} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-white">{user?.name}</div>
          <div className="truncate text-[11.5px] text-[var(--color-sidebar-ink-faint)]">{user?.title}</div>
        </div>
        <button
          onClick={logout}
          title="Log out"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--color-sidebar-ink-faint)] transition-colors hover:bg-white/10 hover:text-white focus-ring"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}
