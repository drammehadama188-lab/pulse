import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { navFor } from './nav.js'
import { Brand } from './Brand.jsx'
import { Avatar } from '../ui.jsx'

export function Sidebar() {
  const { user, logout } = useAuth()
  const items = navFor(user)

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]/70 px-4 py-6 backdrop-blur-sm md:flex">
      <div className="px-2">
        <Brand />
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--color-brand-50)] text-[var(--color-brand)]'
                  : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={20}
                  strokeWidth={isActive ? 2.4 : 2}
                  className="shrink-0"
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]/60 p-3">
        <Avatar name={user?.name} size={38} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold text-[var(--color-ink)]">{user?.name}</div>
          <div className="truncate text-xs text-[var(--color-ink-faint)]">{user?.title}</div>
        </div>
        <button
          onClick={logout}
          title="Log out"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)] focus-ring"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  )
}
