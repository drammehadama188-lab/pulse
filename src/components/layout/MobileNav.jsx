import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { navFor, mobileNavFor, MORE } from './nav.js'

export function MobileNav() {
  const { user } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const primary = mobileNavFor(user)
  const all = navFor(user)

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-sidebar-edge)] bg-[var(--color-sidebar)] md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {primary.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${isActive ? 'text-[var(--color-sidebar-ink-active)]' : 'text-[var(--color-sidebar-ink)]'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-[var(--color-sidebar-active)]' : ''}`}>
                    <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-[var(--color-sidebar-ink)]"
          >
            <span className="flex h-8 w-12 items-center justify-center rounded-full">
              <MORE.icon size={20} strokeWidth={2} />
            </span>
            {MORE.label}
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(20,24,40,0.45)] backdrop-blur-sm md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="w-full rounded-t-3xl bg-[var(--color-surface)] p-3 pb-8 rise" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-[var(--color-line)]" />
            <div className="grid grid-cols-4 gap-1 p-2">
              {all.map((item) => {
                const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl py-3 text-[11px] font-semibold ${active ? 'bg-[var(--color-brand-50)] text-[var(--color-brand)]' : 'text-[var(--color-ink-soft)]'}`}
                  >
                    <item.icon size={22} strokeWidth={2} />
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
