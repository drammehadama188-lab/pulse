import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Mail, Building2, ShieldCheck, KeyRound, Archive } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar, Button, Spinner, Modal, Field, Input } from '../components/ui.jsx'

// Staff member — the per-person access page (admin Staff parity). Email + login,
// reset password, and the permission toggles that save instantly and are logged.
// Pulse's powers are flat (no sub-permissions), so each power is one toggle card.
// Kept in Pulse's light theme (dark sidebar) per the house style.

function Toggle({ on, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-gray-300'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-3"><Icon size={15} className="text-gray-400" /><p className="text-sm font-semibold text-gray-900">{label}</p></div>
      <p className={`text-sm ${accent || 'text-gray-700'}`}>{value}</p>
    </div>
  )
}

export default function StaffMember() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { enterViewAs, hasRealPower, realUser } = useAuth()
  const isCeo = realUser?.username === 'adama'

  const [user, setUser] = useState(null)
  const [catalogue, setCatalogue] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [savingKey, setSavingKey] = useState(null)
  const [email, setEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  function load() {
    Promise.all([api('/users'), api('/powers')]).then(([u, pw]) => {
      const found = (u.users || []).find((x) => x.username === username) || null
      setUser(found)
      setEmail(found?.email || '')
      setCatalogue(pw.powers || [])
      setLoaded(true)
    })
  }
  useEffect(() => { load() }, [username])

  if (!loaded) return <div className="flex justify-center py-24"><Spinner size={28} /></div>
  if (!user) {
    return (
      <div className="max-w-4xl">
        <button onClick={() => navigate('/team')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6"><ArrowLeft size={14} /> Back to Staff</button>
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">Staff member not found.</div>
      </div>
    )
  }

  const powers = new Set(user.powers || [])
  const canSignIn = !user.suspended

  // Persist the full powers set + sign-in flag. Optimistic; reverts on failure.
  async function persist(nextPowers, nextCanSignIn, key) {
    const prev = { powers: user.powers || [], suspended: user.suspended }
    setSavingKey(key)
    setUser((u) => ({ ...u, powers: nextPowers, suspended: !nextCanSignIn }))
    try {
      await api(`/staff/${username}/access`, { method: 'POST', body: { powers: nextPowers, canSignIn: nextCanSignIn } })
    } catch {
      setUser((u) => ({ ...u, powers: prev.powers, suspended: prev.suspended }))
    } finally {
      setSavingKey(null)
    }
  }
  function togglePower(key) {
    const next = new Set(powers)
    if (next.has(key)) next.delete(key); else next.add(key)
    persist([...next], canSignIn, key)
  }
  function toggleSignIn() {
    persist([...powers], !canSignIn, '__signin')
  }

  async function saveEmail() {
    setEmailBusy(true); setEmailMsg('')
    try {
      await api(`/staff/${username}/access`, { method: 'POST', body: { powers: [...powers], canSignIn, email: email.trim() } })
      setUser((u) => ({ ...u, email: email.trim() }))
      setEmailMsg('Saved')
    } catch (e) {
      setEmailMsg(e.message || 'Could not save')
    } finally {
      setEmailBusy(false)
    }
  }

  function viewAs() { enterViewAs(user); navigate('/') }

  const accessLabel = !canSignIn ? 'Sign-in paused' : powers.size > 0 ? 'Has access' : 'No admin access'
  const accessTone = !canSignIn ? 'text-red-600' : powers.size > 0 ? 'text-emerald-600' : 'text-gray-400'

  return (
    <div className="max-w-5xl">
      <button onClick={() => navigate('/team')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6"><ArrowLeft size={14} /> Back to Staff</button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={user.name} size={56} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900">{user.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-gray-600 text-sm">{user.title}</span>
              {user.department && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">{user.department}</span>}
              <span className={`flex items-center gap-1 text-[11px] font-semibold ${accessTone}`}><span className={`w-1.5 h-1.5 rounded-full ${!canSignIn ? 'bg-red-500' : powers.size > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} /> {accessLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasRealPower('viewas') && <Button variant="outline" icon={ArrowRight} onClick={viewAs}>Open their view</Button>}
          <Button variant="outline" icon={Archive} onClick={() => setArchiveOpen(true)}>Archive</Button>
        </div>
      </div>

      {/* Top cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Stat icon={Mail} label="Email" value={user.email || '—'} />
        <Stat icon={Building2} label="Department" value={user.department || '—'} />
        <Stat icon={ShieldCheck} label="Access" value={`${powers.size} ${powers.size === 1 ? 'power' : 'powers'} granted`} accent={powers.size > 0 ? 'text-emerald-700' : 'text-gray-400'} />
      </div>

      {/* Login + reset */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Login</h2>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Login email</label>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailMsg('') }} placeholder="name@damiatracker.com" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <Button onClick={saveEmail} disabled={emailBusy || email.trim() === (user.email || '')}>{emailBusy ? <Spinner size={16} /> : 'Save email'}</Button>
          <Button variant="outline" icon={KeyRound} onClick={() => setResetOpen(true)}>Reset password</Button>
        </div>
        {emailMsg && <p className={`text-xs mt-2 ${emailMsg === 'Saved' ? 'text-emerald-600' : 'text-red-600'}`}>{emailMsg}</p>}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{canSignIn ? 'Can sign in to Pulse' : 'Sign-in paused'}</p>
            <p className="text-xs text-gray-400">{canSignIn ? 'Switch off to pause their access instantly (reversible).' : 'They cannot log in until you switch this back on.'}</p>
          </div>
          <Toggle on={canSignIn} disabled={savingKey === '__signin'} onClick={toggleSignIn} />
        </div>
      </div>

      {/* Access — permission toggles, save instantly */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900">Access</h2>
        <p className="text-sm text-gray-500 mt-1 mb-5">What {user.name.split(' ')[0]} can open in Pulse — all yours to grant. Changes save instantly and are logged.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {catalogue.map((p) => {
            const on = powers.has(p.key)
            const locked = p.key === 'grant' && !isCeo
            return (
              <div key={p.key} className={`rounded-2xl border p-4 ${on ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{p.label}{locked && <span className="ml-1.5 text-[10px] font-medium text-gray-400">CEO only</span>}</p>
                  <Toggle on={on} disabled={locked || savingKey === p.key} onClick={() => !locked && togglePower(p.key)} />
                </div>
                <p className="text-xs text-gray-500 mt-1">{p.detail}</p>
              </div>
            )
          })}
        </div>
      </div>

      {resetOpen && <ResetDialog username={username} name={user.name} onClose={() => setResetOpen(false)} />}
      {archiveOpen && <ArchiveDialog username={username} name={user.name} onClose={() => setArchiveOpen(false)} onDone={() => navigate('/team')} />}
    </div>
  )
}

function ResetDialog({ username, name, onClose }) {
  const [tempPw, setTempPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  async function reset() {
    if (tempPw.trim().length < 8) { setError('At least 8 characters'); return }
    setBusy(true); setError(''); setDone('')
    try {
      await api(`/staff/${username}/reset-password`, { method: 'POST', body: { tempPassword: tempPw.trim() } })
      setDone(`Done. Share this temporary password with ${name.split(' ')[0]} — they'll be asked to change it at next login.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${name}`} footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{!done && <Button onClick={reset} disabled={busy}>{busy ? <Spinner size={16} /> : 'Set password'}</Button>}</>}>
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-ink-soft)]">Set a temporary password (min 8). They’ll be signed out and asked to change it at next login.</p>
        <Field label="Temporary password"><Input value={tempPw} onChange={(e) => setTempPw(e.target.value)} placeholder="e.g. Welcome2026" /></Field>
        {done && <div className="rounded-xl bg-[var(--color-good-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-good)]">{done}</div>}
        {error && <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}

function ArchiveDialog({ username, name, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setBusy(true); setError('')
    try {
      await api(`/staff/${username}/archive`, { method: 'POST', body: { reason } })
      onDone()
    } catch (e) {
      setError(e.message); setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Archive ${name}?`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={confirm} disabled={busy}>{busy ? <Spinner size={16} /> : 'Archive'}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-ink-soft)]">They’ll move to <span className="font-semibold text-[var(--color-ink)]">Past Staff</span>, can no longer log in, and drop out of the active team. Their record is kept — restore them from Past Staff anytime.</p>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Resigned, contract ended, let go" /></Field>
        {error && <div className="rounded-xl bg-[var(--color-bad-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}
