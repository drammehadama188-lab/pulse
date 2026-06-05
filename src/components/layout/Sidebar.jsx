import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, ExternalLink } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../lib/api.js'
import { groupedNavFor, departmentsFor } from './nav.js'
import { Brand } from './Brand.jsx'
import { Avatar, Spinner } from '../ui.jsx'

// "Open Admin" — Adama's design (4 Jun): visible only to holders of the
// Admin power, and only once the bridge flag is on. Opens the customer
// system in a new tab signed in as this person, so their actions are
// logged there under their own name.
function OpenAdminButton() {
  const { hasRealPower, openAdminEnabled, isViewAs } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!openAdminEnabled || !hasRealPower('admin') || isViewAs) return null

  async function open() {
    setBusy(true)
    setError('')
    try {
      const { url } = await api('/open-admin', { method: 'POST' })
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(e.message || 'Could not open Admin')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={open}
        disabled={busy}
        className="flex w-full items-center gap-3 rounded-2xl bg-white/15 px-3.5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/25"
      >
        {busy ? <Spinner size={18} /> : <ExternalLink size={18} strokeWidth={2.2} className="shrink-0" />}
        <span className="flex-1 text-left">Open Admin</span>
      </button>
      {error && <p className="mt-1 px-3.5 text-xs text-white/70">{error}</p>}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="mb-1 mt-6 px-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
      {children}
    </div>
  )
}

function NavRow({ item, soon = false }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
          isActive
            ? 'bg-white text-[var(--color-sidebar)] shadow-sm'
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

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-sidebar-edge)] bg-[var(--color-sidebar)] px-4 py-6 md:flex">
      <div className="px-2">
        <Brand onDark />
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {top.map((item) => (
          <NavRow key={item.to} item={item} />
        ))}

        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <SectionLabel>{section.label}</SectionLabel>
            {section.items.map((item) => (
              <NavRow key={item.to} item={item} />
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

      <OpenAdminButton />

      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3">
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
