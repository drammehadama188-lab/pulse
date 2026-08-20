import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { KeyRound, CheckCircle2 } from 'lucide-react'
import { Brand } from '../components/layout/Brand.jsx'
import { Button, Spinner } from '../components/ui.jsx'

// Public page behind the emailed set-password link (/set-password?token=…).
// No login required — the one-time token is the proof. Staff land here from
// the invite or reset email, choose a password, then sign in with it.
export default function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  const [checking, setChecking] = useState(true)
  const [who, setWho] = useState(null) // {name, username} when the link is valid
  const [linkError, setLinkError] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) { setLinkError('This link is missing its code. Open the link from the email again.'); setChecking(false); return }
    fetch(`/api/password-link/${token}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.error || 'This link is not valid.')
        setWho(data)
      })
      .catch((e) => setLinkError(e.message))
      .finally(() => setChecking(false))
  }, [token])

  async function onSubmit(e) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('The two passwords do not match'); return }
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/password-link/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Could not set the password.')
      setDone(true)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const inputCls = 'focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)]'

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm rise">
        <div className="mb-6">
          <Brand />
        </div>

        {checking ? (
          <div className="flex items-center gap-3 text-[var(--color-ink-soft)]">
            <Spinner size={20} /> Checking your link…
          </div>
        ) : linkError ? (
          <>
            <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">This link no longer works</h2>
            <p className="mt-2 text-[var(--color-ink-soft)]">{linkError}</p>
            <p className="mt-4 text-[13px] text-[var(--color-ink-soft)]">
              Already have a password? <Link to="/login" className="font-semibold text-[var(--color-brand)]">Sign in</Link>
            </p>
          </>
        ) : done ? (
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-good-bg)] text-[var(--color-good)]">
              <CheckCircle2 size={30} />
            </div>
            <h2 className="mt-4 text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">Password saved</h2>
            <p className="mt-2 text-[var(--color-ink-soft)]">
              Sign in with your email <span className="font-semibold text-[var(--color-ink)]">{who.email || who.username}</span> and your new password.
            </p>
            <Link to="/login">
              <Button className="mt-6 w-full" icon={KeyRound}>Go to sign in</Button>
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">
              Hi {who.name.split(' ')[0]}, choose your password
            </h2>
            <p className="mt-1.5 text-[var(--color-ink-soft)]">
              You'll sign in with <span className="font-semibold text-[var(--color-ink)]">{who.email || who.username}</span>. Pick a password only you know — at least 8 characters.
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[var(--color-ink)]">New password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={inputCls} />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[var(--color-ink)]">Type it again</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Same password" className={inputCls} />
              </div>
              {error && (
                <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>
              )}
              <Button type="submit" className="w-full" disabled={busy} icon={busy ? undefined : KeyRound}>
                {busy ? <Spinner size={16} /> : 'Save password'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
