import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Mail, Building2, KeyRound, Archive } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar, Button, Spinner, Modal, Field, Input } from '../components/ui.jsx'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'

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
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-[var(--color-good)]' : 'bg-[var(--color-ink-faint)]'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

// compact toggle for the capability sub-rows inside a power card

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5">
      <div className="flex items-center gap-2 mb-3"><Icon size={15} className="text-[var(--color-ink-faint)]" /><p className="text-[13px] font-semibold text-[var(--color-ink)]">{label}</p></div>
      <p className={`text-[13px] ${accent || 'text-[var(--color-ink-soft)]'}`}>{value}</p>
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
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [roles, setRoles] = useState([])

  function load() {
    Promise.all([api('/users'), api('/powers')]).then(([u, pw]) => {
      const found = (u.users || []).find((x) => x.username === username) || null
      setUser(found)
      setRoster((u.users || []).filter((x) => x.username !== username))
      setEmail(found?.email || '')
      setCatalogue(pw.powers || [])
      setLoaded(true)
    })
  }
  useEffect(() => { load() }, [username])
  // Roles are owner-only to read; a manager without that grant simply sees no
  // role picker rather than an error.
  useEffect(() => { api('/roles').then((r) => setRoles(r.roles || [])).catch(() => setRoles([])) }, [])

  // Assigning a role RESETS this person to it. Coverage is untouched.
  async function changeRole(next) {
    if (!next || next === user.roleId) return
    setSavingKey('__role')
    try {
      const res = await api(`/staff/${username}/role`, { method: 'POST', body: { roleId: next } })
      if (res.user) setUser(res.user)
    } catch (e) {
      setEmailMsg(e.message || 'Could not change the role')
    } finally {
      setSavingKey(null)
    }
  }

  if (!loaded) return <PageSkeleton tiles={0} rows={6} />
  if (!user) {
    return (
      <div className="max-w-4xl">
        <button onClick={() => navigate('/settings/team?tab=members')} className="flex items-center gap-2 text-[13px] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6"><ArrowLeft size={14} /> Back to Team &amp; access</button>
        <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-10 text-center text-[var(--color-ink-faint)]">Staff member not found.</div>
      </div>
    )
  }

  const powers = new Set(user.powers || [])
  const canSignIn = !user.suspended
  // Where this person deliberately differs from their role. Named out loud so
  // an exception is never invisible — an unexplained extra power is how access
  // creeps.
  const myRole = roles.find((r) => r.id === user.roleId)
  const roleDiff = myRole
    ? [...new Set([...powers, ...(myRole.powers || [])])]
      .filter((k) => powers.has(k) !== (myRole.powers || []).includes(k))
      .map((k) => (catalogue.find((c) => c.key === k)?.label || k))
    : []

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

  // The powers they hold that reach OTHER staff — the only ones with coverage
  // to set. Read from what the role gave them; this page never grants a power.
  const scopedPowers = catalogue.filter((p) => powers.has(p.key) && PEOPLE_SCOPED.includes(p.key))

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
  function toggleScope(key, un) {
    const cov = coverage(key)
    if (cov.has(un)) cov.delete(un); else cov.add(un)
    persist([...powers], canSignIn, `${key}:${un}`, scopesPayload(powers, key, cov), subsPayload(powers))
  }
  function setScopeAll(key, on) {
    const cov = new Set(on ? roster.map((r) => r.username) : [])
    persist([...powers], canSignIn, key, scopesPayload(powers, key, cov), subsPayload(powers))
  }
  function toggleSignIn() {
    persist([...powers], !canSignIn, '__signin')
  }


  async function saveEmail() {
    setEmailBusy(true); setEmailMsg('')
    try {
      // 🔒 The login only. The personal email is contact on file and belongs
      // to the employee record; sending it from here would let two pages write
      // the same field.
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
  const accessTone = !canSignIn ? 'text-[var(--color-bad)]' : powers.size > 0 ? 'text-[var(--color-good)]' : 'text-[var(--color-ink-faint)]'

  return (
    <div className="max-w-5xl">
      <button onClick={() => navigate('/settings/team?tab=members')} className="flex items-center gap-2 text-[13px] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6"><ArrowLeft size={14} /> Back to Team &amp; access</button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={user.name} size={56} />
          <div className="min-w-0">
            <h1 className="t-page">{user.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-[var(--color-ink-soft)] text-[13px]">{user.title}</span>
              {user.department && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--color-fill)] text-[var(--color-ink-soft)]">{user.department}</span>}
              <span className={`flex items-center gap-1 text-[11px] font-semibold ${accessTone}`}><span className={`w-1.5 h-1.5 rounded-full ${!canSignIn ? 'bg-[var(--color-bad)]' : powers.size > 0 ? 'bg-[var(--color-good)]' : 'bg-[var(--color-ink-faint)]'}`} /> {accessLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasRealPower('viewas') && <Button variant="outline" icon={ArrowRight} onClick={viewAs}>Open their view</Button>}
          {hasRealPower('staffadmin') && <Button variant="outline" icon={Archive} onClick={() => setArchiveOpen(true)}>Archive</Button>}
        </div>
      </div>

      {/* THE ROLE — set what someone can do in one move, instead of six
          powers and their sub-toggles one at a time (Adama 27 Aug).
          🔒 Choosing a role RESETS this person to that role's permissions and
          clears any exception. Who they cover is NOT touched: coverage is set
          per person below, and a role must never silently widen it. */}
      {hasRealPower('staffadmin') && (
        <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 mb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Role</p>
              <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">
                Sets the permissions below in one move. Changing it replaces them and clears any exception.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={user.roleId || ''}
                disabled={savingKey === '__role' || roles.length === 0}
                onChange={(e) => changeRole(e.target.value)}
                className="field min-w-[180px]">
                <option value="">No role</option>
                {roles.map((r) => <option key={r.id} value={r.id} disabled={r.id === 'owner'}>{r.name}</option>)}
              </select>
              <Link to="/settings/team?tab=roles" className="text-[12.5px] font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap">Edit roles</Link>
            </div>
          </div>
          {roleDiff.length > 0 && (
            <p className="mt-3 text-[12.5px] text-[var(--color-ink-soft)]">
              <b className="font-medium text-[var(--color-ink)]">Differs from the role</b> on {roleDiff.join(', ')} — set deliberately for this person, and kept when the role changes.
            </p>
          )}
        </div>
      )}

      {/* 🔒 THIS IS THE ACCESS PAGE (Adama 30 Aug). It answers one question —
          what can this person do in Pulse, and over whom — and nothing else.
          Email as a read-only tile duplicated the editable field in Login below
          it, and Department is EMPLOYMENT: it decides the sales goal, the
          leaderboard and My Team, it is owned by the employee record, and two
          pages that can both set it are two pages that can disagree about it. */}

      {/* Login + reset */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 mb-4">
        <h2 className="text-base font-semibold text-[var(--color-ink)] mb-4">Login</h2>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Work email (login)</label>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailMsg('') }} placeholder="name@damiatracker.com" className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px]" />
          </div>
          <Button onClick={saveEmail} disabled={emailBusy || email.trim() === (user.email || '')}>{emailBusy ? <Spinner size={16} /> : 'Save login email'}</Button>
          {hasRealPower('staffadmin') && <Button variant="outline" icon={KeyRound} onClick={() => setResetOpen(true)}>Reset password</Button>}
        </div>
        {emailMsg && <p className={`text-[11.5px] mt-2 ${emailMsg === 'Saved' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>{emailMsg}</p>}
        <LoginState user={user} />
        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--color-line-soft)] px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-ink)]">{canSignIn ? 'Can sign in to Pulse' : 'Sign-in paused'}</p>
            <p className="text-[11.5px] text-[var(--color-ink-faint)]">{canSignIn ? 'Switch off to pause their access instantly (reversible).' : 'They cannot log in until you switch this back on.'}</p>
          </div>
          <Toggle on={canSignIn} disabled={savingKey === '__signin'} onClick={toggleSignIn} />
        </div>
      </div>

      {/* WHO THEY COVER — not WHAT they can do (Adama 28 Aug: "all permission
          toggles should live on the role, here is where i give it to them, not
          in their individual pages").
          🔒 A role owns WHAT; it must never own WHO, because assigning a role
          would then silently widen which staff a manager can see. So the powers
          and their capabilities are set on the role and only READ here, and the
          one thing this page still writes is the coverage. */}
      {isCeo && (
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Who {user.name.split(' ')[0]} covers</h2>
        <p className="mb-5 mt-1 text-[13px] text-[var(--color-ink-soft)]">
          The role decides what {user.name.split(' ')[0]} can do. This decides which staff it applies to.
          {' '}<Link to="/settings/team?tab=roles" className="font-medium text-[var(--color-brand)] hover:underline">Edit roles</Link>
        </p>
        {scopedPowers.length === 0 ? (
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {user.roleId
              ? `Nothing on this role reaches other staff, so there is no coverage to set.`
              : `${user.name.split(' ')[0]} has no role yet, so there is nothing to apply to anyone.`}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scopedPowers.map((p) => {
              const cov = coverage(p.key)
              return (
                <div key={p.key} className="self-start rounded-lg border border-[var(--color-line)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--color-ink)]">{p.label}</p>
                      <p className="mt-1 text-[11.5px] text-[var(--color-ink-soft)]">{p.detail}</p>
                    </div>
                    <button
                      className="shrink-0 text-[11px] font-semibold text-[var(--color-brand)] hover:underline"
                      onClick={() => setScopeAll(p.key, cov.size !== roster.length)}
                    >
                      {cov.size === roster.length ? 'Clear all' : 'All staff'}
                    </button>
                  </div>
                  <div className="mt-3 border-t border-[var(--color-line-soft)] pt-2">
                    {roster.map((s0) => (
                      <label key={s0.username} className="flex cursor-pointer items-center gap-2 py-0.5 text-[13px] text-[var(--color-ink-soft)]">
                        <input
                          type="checkbox"
                          checked={cov.has(s0.username)}
                          onChange={() => toggleScope(p.key, s0.username)}
                          className="accent-[var(--color-brand)]"
                        />
                        <span className="truncate">{s0.name}</span>
                      </label>
                    ))}
                    <p className={`mt-1 text-[11px] font-medium ${cov.size ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-bad)]'}`}>
                      {cov.size === roster.length ? `Affects all ${roster.length} staff` : cov.size ? `Affects ${cov.size} of ${roster.length} staff` : 'Affects no one — pick staff above'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {resetOpen && <ResetDialog username={username} name={user.name} email={user.email} onClose={() => setResetOpen(false)} />}
      {archiveOpen && <ArchiveDialog username={username} name={user.name} onClose={() => setArchiveOpen(false)} onDone={() => navigate('/team')} />}
    </div>
  )
}

// Login state — answers "why can't they sign in?" without guessing. Three
// honest states: a link is out and still valid, they never chose a password,
// or they chose one and the account is theirs.
function LoginState({ user }) {
  const mins = user.passwordLinkExpires ? Math.max(0, Math.round((user.passwordLinkExpires - Date.now()) / 60000)) : 0
  const first = (user.name || '').split(' ')[0]
  let tone = 'text-[var(--color-good)] bg-[var(--color-good-bg)]'
  let text = `Password set. ${first} signs in with ${user.email}.`
  if (user.passwordLinkExpires && mins > 0) {
    tone = 'text-[var(--color-warn)] bg-[var(--color-warn-bg)]'
    text = `A set-password link is open, sent to ${user.email}, ${mins} min left. It works once. Until ${first} opens it, the old password still applies.`
  } else if (!user.passwordChosen) {
    tone = 'text-[var(--color-warn)] bg-[var(--color-warn-bg)]'
    text = `${first} has never chosen a password. Any link sent has expired or was not opened. Set a temporary password below and send it to ${first} directly.`
  }
  return <p className={`mt-3 rounded-lg px-3.5 py-2.5 text-[11.5px] font-semibold ${tone}`}>{text}</p>
}

function ResetDialog({ username, name, email, onClose }) {
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
        <div className="rounded-lg border border-[var(--color-line)] p-4">
          <div className="font-semibold text-[var(--color-ink)]">Email {first} a link</div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Goes to <span className="font-semibold text-[var(--color-ink)]">{email || 'no email on file'}</span>. They click it and choose their own password. Works for 60 minutes, once.</p>
          <Button className="mt-3" onClick={sendLink} disabled={!!busy}>{busy === 'email' ? <Spinner size={16} /> : 'Send the link'}</Button>
        </div>
        <div className="rounded-lg border border-[var(--color-line)] p-4">
          <div className="font-semibold text-[var(--color-ink)]">Or set a temporary password yourself</div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Min 8 characters. You share it with them; they'll be signed out and asked to change it at next login.</p>
          <div className="mt-3 flex gap-2">
            <div className="flex-1"><Input value={tempPw} onChange={(e) => setTempPw(e.target.value)} placeholder="e.g. Welcome2026" /></div>
            <Button variant="outline" onClick={reset} disabled={!!busy}>{busy === 'manual' ? <Spinner size={16} /> : 'Set it'}</Button>
          </div>
        </div>
        {done && <div className="rounded-lg bg-[var(--color-good-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-good)]">{done}</div>}
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
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
        <p className="text-[13px] text-[var(--color-ink-soft)]">They’ll move to <span className="font-semibold text-[var(--color-ink)]">Past Staff</span>, can no longer log in, and drop out of the active team. Their record is kept — restore them from Past Staff anytime.</p>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Resigned, contract ended, let go" /></Field>
        {error && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bad)]">{error}</div>}
      </div>
    </Modal>
  )
}
