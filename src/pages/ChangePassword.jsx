import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { Button, Card, Field, Input, Spinner } from '../components/ui.jsx'

// Set your own password. Reached two ways: forced after first sign-in
// (mustChangePassword) or voluntarily from the profile page.
export default function ChangePassword() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const forced = !!user?.mustChangePassword

  async function onSubmit(e) {
    e.preventDefault()
    if (next !== confirm) {
      setError('New passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      })
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not change password')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-brand-bg,#fdecef)]">
          <KeyRound size={20} className="text-[var(--color-brand,#d6294f)]" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--color-ink)]">
            {forced ? 'Set your password' : 'Change password'}
          </h1>
          <p className="text-sm text-[var(--color-ink-soft)]">
            {forced
              ? 'Before you continue, replace the starter password with one only you know.'
              : 'Pick a new password — at least 8 characters.'}
          </p>
        </div>
      </div>

      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={forced ? 'Starter password' : 'Current password'}>
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder={forced ? 'The password you signed in with' : 'Current password'}
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type it again"
            />
          </Field>

          {error && (
            <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">
              {error}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={busy || !current || next.length < 8 || !confirm}
            className="w-full"
          >
            {busy ? <Spinner size={18} /> : 'Save password'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
