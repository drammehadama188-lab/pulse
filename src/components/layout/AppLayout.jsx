import { Outlet, useNavigate } from 'react-router-dom'
import { Eye, X } from 'lucide-react'
import { Sidebar } from './Sidebar.jsx'
import { MobileNav } from './MobileNav.jsx'
import { Brand } from './Brand.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { Avatar } from '../ui.jsx'

function ViewAsBanner() {
  const { isViewAs, user, exitViewAs } = useAuth()
  const navigate = useNavigate()
  if (!isViewAs) return null
  return (
    <div className="sticky top-0 z-40 flex items-center gap-3 bg-[var(--color-brand)] px-4 py-2.5 text-white">
      <Eye size={18} />
      <span className="text-sm font-semibold">
        Viewing as <span className="font-extrabold">{user.name}</span>
        <span className="hidden opacity-75 sm:inline"> · {user.title}</span>
      </span>
      <button
        onClick={() => {
          exitViewAs()
          navigate('/team')
        }}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-white/25"
      >
        <X size={16} /> Exit
      </button>
    </div>
  )
}

export function AppLayout() {
  const { user } = useAuth()
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <ViewAsBanner />
      <div className="flex min-w-0 flex-1 overflow-hidden">
        {/* Sidebar stays fixed; only the content column scrolls. */}
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {/* mobile top bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)]/90 px-4 py-3 backdrop-blur-md md:hidden">
            <Brand />
            <Avatar name={user?.name} size={34} />
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav />
    </div>
  )
}
