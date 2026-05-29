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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username.trim())
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not sign in')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* brand panel */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white md:flex"
        style={{ background: 'linear-gradient(150deg, #2a5fe0 0%, #1e4fcc 45%, #14306f 100%)' }}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(217,138,35,0.25), transparent 70%)' }}
        />
        <div className="relative">
          <Brand />
        </div>
        <div className="relative max-w-sm">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight">
            Your workday,
            <br />
            all in one place.
          </h1>
          <p className="mt-3 text-white/75">
            Check in, request leave, track your targets and pay — built for the Damia team.
          </p>
        </div>
        <div className="relative text-sm text-white/55">Damia Security Solutions Ltd</div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm rise">
          <div className="mb-8 md:hidden">
            <Brand />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-[var(--color-ink)]">
            Welcome back
          </h2>
          <p className="mt-1.5 text-[var(--color-ink-soft)]">Enter your username to continue.</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[var(--color-ink)]">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="e.g. kaddy"
                className="focus-ring w-full rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)]"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={busy || !username}
              icon={busy ? undefined : LogIn}
              className="w-full"
            >
              {busy ? <Spinner size={18} /> : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--color-ink-faint)]">
            Trouble signing in? Ask your manager.
          </p>
        </div>
      </div>
    </div>
  )
}
