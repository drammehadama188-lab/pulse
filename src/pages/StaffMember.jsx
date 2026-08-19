import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Mail, Building2, ShieldCheck, KeyRound, Archive } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar, Button, Spinner, Modal, Field, Input } from '../components/ui.jsx'

// Staff member — the per-person access page (admin Staff parity). Email + login,
// reset password, and the permission toggles that save instantly and are logged.
// Each people-scoped power card carries named sub-toggles (Adama 3 Jul): the
// staff this grant covers, so the toggle always says exactly who is affected.
// Kept in Pulse's light theme (dark sidebar) per the house style.

// Powers whose grant covers specific people (all except 'grant', which is a
// yes/no capability). The CEO is never in any list — server enforces too.
const PEOPLE_SCOPED = ['approvals', 'team', 'staffadmin', 'payroll', 'hr', 'viewas']

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

// compact toggle for the capability sub-rows inside a power card
function MiniToggle({ on, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-gray-300'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
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
  const [roster, setRoster] = useState([]) // everyone this grant could cover (no CEO, no self)
  const [catalogue, setCatalogue] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [savingKey, setSavingKey] = useState(null)
  const [email, setEmail] = useState('')
  const [personalEmail, setPersonalEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  function load() {
    Promise.all([api('/users'), api('/powers')]).then(([u, pw]) => {
      const found = (u.users || []).find((x) => x.username === username) || null
      setUser(found)
      setRoster((u.users || []).filter((x) => x.username !== username))
      setEmail(found?.email || '')
      setPersonalEmail(found?.personalEmail || '')
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

  // Named sub-toggles: who each power covers. No stored list = all staff.
  const coverage = (key) => {
    const stored = (user.permissionScopes || {})[key]
    return new Set(Array.isArray(stored) ? stored : roster.map((r) => r.username))
  }
  // Capability sub-toggles: what they can DO inside a power. No list = all.
  const subsOf = (key) => catalogue.find((c) => c.key === key)?.subs || []
  const subCoverage = (key) => {
    const stored = (user.permissionSubs || {})[key]
    return new Set(Array.isArray(stored) ? stored : subsOf(key).map((s) => s.key))
  }
  // Explicit lists for every held power, so what you see is exactly what
  // gets stored.
  const scopesPayload = (powerSet, overrideKey, overrideSet) => {
    const out = {}
    for (const k of PEOPLE_SCOPED) {
      if (!powerSet.has(k)) continue
      out[k] = [...(k === overrideKey ? overrideSet : coverage(k))]
    }
    return out
  }
  const subsPayload = (powerSet, overrideKey, overrideSet) => {
    const out = {}
    for (const k of PEOPLE_SCOPED) {
      if (!powerSet.has(k) || !subsOf(k).length) continue
      out[k] = [...(k === overrideKey ? overrideSet : subCoverage(k))]
    }
    return out
  }

  // Persist powers + scopes + subs + sign-in flag. Optimistic; reverts on failure.
  async function persist(nextPowers, nextCanSignIn, key, nextScopes, nextSubs) {
    const prev = { powers: user.powers || [], suspended: user.suspended, permissionScopes: user.permissionScopes, permissionSubs: user.permissionSubs }
    setSavingKey(key)
    setUser((u) => ({ ...u, powers: nextPowers, suspended: !nextCanSignIn, ...(nextScopes ? { permissionScopes: nextScopes } : {}), ...(nextSubs ? { permissionSubs: nextSubs } : {}) }))
    try {
      await api(`/staff/${username}/access`, { method: 'POST', body: { powers: nextPowers, canSignIn: nextCanSignIn, ...(nextScopes ? { scopes: nextScopes } : {}), ...(nextSubs ? { subs: nextSubs } : {}) } })
    } catch {
      setUser((u) => ({ ...u, powers: prev.powers, suspended: prev.suspended, permissionScopes: prev.permissionScopes, permissionSubs: prev.permissionSubs }))
    } finally {
      setSavingKey(null)
    }
  }
  function togglePower(key) {
    const next = new Set(powers)
    if (next.has(key)) next.delete(key); else next.add(key)
    persist([...next], canSignIn, key, scopesPayload(next), subsPayload(next))
  }
  function toggleScope(key, un) {
    const cov = coverage(key)
    if (cov.has(un)) cov.delete(un); else cov.add(un)
    persist([...powers], canSignIn, `${key}:${un}`, scopesPayload(powers, key, cov), subsPayload(powers))
  }
  function setScopeAll(key, on) {
    const cov = new Set(on ? roster.map((r) => r.username) : [])
    persist([...powers], canSignIn, key, scopesPayload(powers, key, cov), subsPayload(powers))
  }
  function toggleSubCap(key, subKey) {
    const cov = subCoverage(key)
    if (cov.has(subKey)) cov.delete(subKey); else cov.add(subKey)
    persist([...powers], canSignIn, `${key}.${subKey}`, scopesPayload(powers), subsPayload(powers, key, cov))
  }
  function toggleSignIn() {
    persist([...powers], !canSignIn, '__signin')
  }
  async function toggleContractor() {
    const next = !user.contractor
    setSavingKey('__contractor')
    setUser((u) => ({ ...u, contractor: next }))
    try {
      await api(`/staff/${username}/contractor`, { method: 'POST', body: { contractor: next } })
    } catch {
      setUser((u) => ({ ...u, contractor: !next }))
    } finally {
      setSavingKey(null)
    }
  }

  async function saveEmail() {
    setEmailBusy(true); setEmailMsg('')
    try {
      await api(`/staff/${username}/access`, { method: 'POST', body: { powers: [...powers], canSignIn, email: email.trim(), personalEmail: personalEmail.trim() } })
      setUser((u) => ({ ...u, email: email.trim(), personalEmail: personalEmail.trim() }))
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
          {hasRealPower('staffadmin') && <Button variant="outline" icon={Archive} onClick={() => setArchiveOpen(true)}>Archive</Button>}
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
            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Work email (login)</label>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailMsg('') }} placeholder="name@damiatracker.com" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Personal email</label>
            <input type="email" value={personalEmail} onChange={(e) => { setPersonalEmail(e.target.value); setEmailMsg('') }} placeholder="name@gmail.com" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <Button onClick={saveEmail} disabled={emailBusy || (email.trim() === (user.email || '') && personalEmail.trim() === (user.personalEmail || ''))}>{emailBusy ? <Spinner size={16} /> : 'Save emails'}</Button>
          {hasRealPower('staffadmin') && <Button variant="outline" icon={KeyRound} onClick={() => setResetOpen(true)}>Reset password</Button>}
        </div>
        {emailMsg && <p className={`text-xs mt-2 ${emailMsg === 'Saved' ? 'text-emerald-600' : 'text-red-600'}`}>{emailMsg}</p>}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{canSignIn ? 'Can sign in to Pulse' : 'Sign-in paused'}</p>
            <p className="text-xs text-gray-400">{canSignIn ? 'Switch off to pause their access instantly (reversible).' : 'They cannot log in until you switch this back on.'}</p>
          </div>
          <Toggle on={canSignIn} disabled={savingKey === '__signin'} onClick={toggleSignIn} />
        </div>
        {hasRealPower('staffadmin') && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Contractor</p>
              <p className="text-xs text-gray-400">Contractors are paid through Payroll but do not check in or out and hold no schedule — they stay off every attendance view.</p>
            </div>
            <Toggle on={!!user.contractor} disabled={savingKey === '__contractor'} onClick={toggleContractor} />
          </div>
        )}
      </div>

      {/* Access — permission toggles, save instantly. CEO-only: Grant access
          was removed 3 Jul — nobody else manages who can do what. */}
      {isCeo && (
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900">Access</h2>
        <p className="text-sm text-gray-500 mt-1 mb-5">What {user.name.split(' ')[0]} can open in Pulse — all yours to grant. Changes save instantly and are logged.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {catalogue.map((p) => {
            const on = powers.has(p.key)
            const locked = p.key === 'grant' && !isCeo
            const scoped = on && PEOPLE_SCOPED.includes(p.key)
            const cov = scoped ? coverage(p.key) : null
            return (
              <div key={p.key} className={`self-start rounded-2xl border p-4 ${on ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{p.label}{locked && <span className="ml-1.5 text-[10px] font-medium text-gray-400">CEO only</span>}</p>
                  <Toggle on={on} disabled={locked || savingKey === p.key} onClick={() => !locked && togglePower(p.key)} />
                </div>
                <p className="text-xs text-gray-500 mt-1">{p.detail}</p>
                {on && (p.subs || []).length > 0 && (
                  <div className="mt-3 border-t border-emerald-100 pt-2">
                    <p className="mb-1 text-[10px] uppercase tracking-wider font-bold text-gray-400">They can</p>
                    {p.subs.map((s) => {
                      const subOn = subCoverage(p.key).has(s.key)
                      return (
                        <div key={s.key} className="flex items-center justify-between gap-2 py-1">
                          <div className="min-w-0">
                            <p className={`text-sm ${subOn ? 'text-gray-800' : 'text-gray-400'}`}>{s.label}</p>
                            <p className="text-[11px] text-gray-400">{s.detail}</p>
                          </div>
                          <MiniToggle on={subOn} disabled={savingKey === `${p.key}.${s.key}`} onClick={() => toggleSubCap(p.key, s.key)} />
                        </div>
                      )
                    })}
                  </div>
                )}
                {scoped && (
                  <div className="mt-3 border-t border-emerald-100 pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Applies to</p>
                      <button
                        className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700"
                        onClick={() => setScopeAll(p.key, cov.size !== roster.length)}
                      >
                        {cov.size === roster.length ? 'Clear all' : 'All staff'}
                      </button>
                    </div>
                    {roster.map((s) => (
                      <label key={s.username} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={cov.has(s.username)}
                          onChange={() => toggleScope(p.key, s.username)}
                          className="accent-emerald-500"
                        />
                        <span className="truncate">{s.name}</span>
                      </label>
                    ))}
                    <p className={`mt-1 text-[11px] font-medium ${cov.size ? 'text-gray-400' : 'text-red-500'}`}>
                      {cov.size === roster.length ? `Affects all ${roster.length} staff` : cov.size ? `Affects ${cov.size} of ${roster.length} staff` : 'Affects no one — pick staff below'}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      )}

      {resetOpen && <ResetDialog username={username} name={user.name} onClose={() => setResetOpen(false)} />}
      {archiveOpen && <ArchiveDialog username={username} name={user.name} onClose={() => setArchiveOpen(false)} onDone={() => navigate('/team')} />}
    </div>
  )
}

function ResetDialog({ username, name, onClose }) {
  const first = name.split(' ')[0]
  const [tempPw, setTempPw] = useState('')
  const [busy, setBusy] = useState(false) // 'email' | 'manual' | false
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  // Preferred: email them a one-time link (60 min) and they choose their own
  // password — nothing to pass around on WhatsApp.
  async function sendLink() {
    setBusy('email'); setError(''); setDone('')
    try {
      const r = await api(`/staff/${username}/send-password-link`, { method: 'POST' })
      setDone(r.blocked
        ? `Email sending is switched off on this machine (test mode) — nothing was sent. On the live server the link goes to ${r.email}.`
        : `Done. ${first} got an email at ${r.email} with a link to choose a new password. The link works for 60 minutes.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Fallback when email is not an option: set a temporary password and share
  // it yourself. They're signed out and must change it at next login.
  async function reset() {
    if (tempPw.trim().length < 8) { setError('At least 8 characters'); return }
    setBusy('manual'); setError(''); setDone('')
    try {
      await api(`/staff/${username}/reset-password`, { method: 'POST', body: { tempPassword: tempPw.trim() } })
      setDone(`Done. Share this temporary password with ${first} — they'll be asked to change it at next login.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${name}`} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-[var(--color-line)] p-4">
          <div className="font-semibold text-[var(--color-ink)]">Email {first} a link</div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">They click it and choose their own password. The link works for 60 minutes and can be used once.</p>
          <Button className="mt-3" onClick={sendLink} disabled={!!busy}>{busy === 'email' ? <Spinner size={16} /> : 'Send the link'}</Button>
        </div>
        <div className="rounded-2xl border border-[var(--color-line)] p-4">
          <div className="font-semibold text-[var(--color-ink)]">Or set a temporary password yourself</div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">Min 8 characters. You share it with them; they'll be signed out and asked to change it at next login.</p>
          <div className="mt-3 flex gap-2">
            <div className="flex-1"><Input value={tempPw} onChange={(e) => setTempPw(e.target.value)} placeholder="e.g. Welcome2026" /></div>
            <Button variant="outline" onClick={reset} disabled={!!busy}>{busy === 'manual' ? <Spinner size={16} /> : 'Set it'}</Button>
          </div>
        </div>
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
