import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { Brand } from '../components/layout/Brand.jsx'
import { Button, Spinner } from '../components/ui.jsx'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await login(username.trim(), password)
      navigate(user?.mustChangePassword ? '/change-password' : '/', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not sign in')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* brand panel */}
      <div
        className="relative hidden flex-col items-center justify-center overflow-hidden p-12 md:flex"
        style={{ background: 'linear-gradient(150deg, #f6f7f9 0%, #ffffff 55%, #f3f4f6 100%)' }}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(214,41,79,0.12), transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(38,166,154,0.22), transparent 70%)' }}
        />
        <div className="relative flex flex-col items-center text-center">
          <div className="flex items-center gap-4">
            <svg width="62" height="83" viewBox="0 0 120 160" aria-hidden>
              <path
                d="M78 10 C 46 44 44 72 60 96 C 70 111 66 122 50 130 C 60 112 46 102 52 80 C 58 54 70 30 78 10 Z"
                fill="#d6294f"
              />
              <path
                d="M56 92 C 32 118 32 140 48 154 C 41 140 52 130 60 122 C 71 112 68 96 56 92 Z"
                fill="#d6294f"
              />
            </svg>
            <div className="text-left leading-none">
              <div className="text-5xl font-semibold tracking-tight text-[var(--color-ink)]">
                Pulse
              </div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-soft)]">
                by Damia Tracker
              </div>
            </div>
          </div>
          <p className="mt-7 max-w-xs text-[var(--color-ink-soft)]">
            Check in, request leave, track your targets and pay — built for the Damia team.
          </p>
        </div>
        <div className="absolute bottom-12 left-12 text-[13px] text-[var(--color-ink-faint)]">
          Damia Security Solutions Ltd
        </div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm rise">
          <div className="mb-6 md:hidden">
            <Brand />
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">
            Welcome back
          </h2>
          <p className="mt-1.5 text-[var(--color-ink-soft)]">Sign in with your email and password.</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[var(--color-ink)]">
                Email
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="name@gmail.com"
                className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[var(--color-ink)]">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)]"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={busy || !username || !password}
              icon={busy ? undefined : LogIn}
              className="w-full"
            >
              {busy ? <Spinner size={18} /> : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11.5px] text-[var(--color-ink-faint)]">
            Trouble signing in? Ask your manager.
          </p>
        </div>
      </div>
    </div>
  )
}
