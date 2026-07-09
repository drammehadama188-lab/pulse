// Damia Staff — backend API (port 4003)
// JSON-file persistence (v1; Postgres-ready behind the db.* helpers).
// Reuses The Desk's JSON-store pattern. No Zoho/Sheets here.

import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { team, pastStaff } from './src/data/team.js'
import { sallyCustomers, sallyMonthlyHistory } from './src/data/sally-sales-seed.js'
import { buildPayrollHistory, zohoConfigured, paySources, recordSalaryPayment, resolveVendor, getExpense, deleteExpense, updateSalaryExpense, existingSalaryExpense, salaryExpensesForMonth } from './lib/zoho-books.js'
import { sendMail, emailConfigured } from './lib/email.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Minimal .env loader (no dependency). Currently no required keys — kept
// so future config can drop into .env without a code change.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
} catch { /* no .env — fine, bridge stays off */ }

const DATA_DIR = path.join(__dirname, 'data')
const PORT = process.env.PORT || 4003
// Public address used inside set-password emails. Prod = pulse.damiatracker.com;
// local dev can override in .env (emails are blocked locally anyway).
const PULSE_PUBLIC_URL = (process.env.PULSE_PUBLIC_URL || 'https://pulse.damiatracker.com').replace(/\/$/, '')

// Who manages people. Everyone else is staff.
const MANAGER_NAMES = ['Ya Fatou Sawaneh', 'Kaddy Bojang']
const DEFAULT_PASSWORD = 'damia2026'
// Passwords ON (4 Jun 2026) — a Pulse login must actually prove who you are.
// Everyone starts on DEFAULT_PASSWORD with mustChangePassword=true and is
// forced to set their own at first sign-in.
const REQUIRE_PASSWORD = true

// Attendance counts from this date. Pulse went live on the internet on 6 Jul
// and that day was setup chaos (data migration wiped mid-day check-ins), so
// the record restarts clean the next morning (Adama 6 Jul: "restart the
// check-in from tomorrow"). Days before this are treated as unscheduled —
// no absences, no totals, everywhere.
const ATTENDANCE_START = process.env.ATTENDANCE_START || '2026-07-07'

// ---------- tiny JSON "db" (swap this module for Postgres later) ----------
fs.mkdirSync(DATA_DIR, { recursive: true })
const db = {
  read(name, fallback) {
    const f = path.join(DATA_DIR, `${name}.json`)
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch {
      return fallback
    }
  },
  write(name, value) {
    const f = path.join(DATA_DIR, `${name}.json`)
    const tmp = `${f}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, f)
    return value
  },
}

// ---------- seed users from roster ----------
function usernameFor(name) {
  const parts = name.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean)
  let u = parts[0] || 'user'
  if (u.length <= 3 && parts[1]) u += parts[1]
  return u
}

function seedUsers() {
  let users = db.read('users', null)
  if (users) return users
  users = team.map((p) => ({
    username: usernameFor(p.name),
    name: p.name,
    role: MANAGER_NAMES.includes(p.name) ? 'manager' : 'staff',
    department: p.type || 'General',
    title: p.role,
    passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
    mustChangePassword: true,
  }))
  // Owner / CEO
  users.unshift({
    username: 'adama',
    name: 'Adama Damia',
    role: 'manager',
    department: 'Leadership',
    title: 'Founder / CEO',
    passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
    mustChangePassword: true,
  })
  db.write('users', users)
  console.log('Seeded users (default password "%s"):', DEFAULT_PASSWORD)
  users.forEach((u) => console.log(`  ${u.username.padEnd(12)} ${u.role.padEnd(8)} ${u.name}`))
  return users
}

// ---------- staff onboarding helpers ----------
function uniqueUsername(base) {
  const taken = new Set(seedUsers().map((u) => u.username))
  let u = base || 'user'
  let n = 2
  while (taken.has(u)) u = `${base}${n++}`
  return u
}
function addMonths(isoDate, months) {
  const d = new Date(isoDate)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}
function isArchived(u) {
  return u.status === 'archived'
}

// ---------- team scoping (Adama 30 Jun) ----------
// "My Team" = the people a team lead manages. Structure is department-based: the
// performance team spans Sales + Customer Service. The Cleaner (Operations) and
// the CEO (Leadership) are support/owner — on NO team. A team lead manages every
// active person in the performance departments except themselves. One lead today
// (Momodou); the helper generalises if more are added.
const PERF_DEPARTMENTS = ['Sales', 'Customer Service']
function leadsATeam(u) {
  if (!u || u.username === 'adama') return false
  return u.title === 'Team Lead' || u.role === 'manager'
}
function teamMembersFor(lead) {
  if (!leadsATeam(lead)) return []
  return seedUsers().filter((u) =>
    !isArchived(u) &&
    PERF_DEPARTMENTS.includes(u.department) &&
    u.username !== lead.username,
  )
}
// Set of usernames a lead may see/act on (empty if they lead no team). Uses the
// VIEWED identity so it works correctly under owner view-as (Adama sees the
// lead's team). Powers are still checked separately on the full-access routes.
function teamUsernameSet(username) {
  const lead = findUser(username)
  return new Set(teamMembersFor(lead).map((m) => m.username))
}

// Team attendance % for a lead's team, this month to date (Adama 1 Jul). Expected
// days = SCHEDULED work-days MINUS APPROVED leave (approved leave is excused — for
// sick that means it carried the required medical certificate, per the Blue Book).
// Worked = a check-in that day; a LATE check-in still counts as present. Only an
// unexcused no-show pulls it down. Real Pulse data — no Admin feed needed.
function teamAttendancePct(lead) {
  const members = teamMembersFor(lead)
  if (!members.length) return null
  const today = todayKey()
  const CUR = today.slice(0, 7)
  const attAll = db.read('attendance', [])
  const leaveAll = db.read('leave', [])
  const schedules = db.read('schedules', {})
  const days = []
  for (let d = 1; d <= 31; d++) {
    const key = `${CUR}-${String(d).padStart(2, '0')}`
    if (key > today) break
    if (new Date(`${key}T00:00:00Z`).toISOString().slice(0, 7) !== CUR) break // guard month overflow
    if (key < ATTENDANCE_START) continue // pre-restart days don't count
    days.push(key)
  }
  let expected = 0, worked = 0
  for (const u of members) {
    const stored = schedules[u.username]
    for (const k of days) {
      if (!(effectiveWeek(stored, k)[dowOfKey(k)])) continue // not a scheduled work-day
      if (leaveOnDate(leaveAll, u.username, k)) continue // approved leave = excused, drop from expected
      expected++
      const att = attAll.find((a) => a.username === u.username && a.date === k)
      if (att && att.checkIn) worked++
    }
  }
  return expected ? Math.round((worked / expected) * 100) : null
}
function archivedNameSet() {
  return new Set(seedUsers().filter(isArchived).map((u) => u.name))
}
// created staff, mapped into the dashboard roster shape (NO salary, NO private notes)
function createdStaffRoster() {
  return seedUsers()
    .filter((u) => u.createdViaPulse && !isArchived(u))
    .map((u) => ({
      name: u.name,
      role: u.title,
      type: u.department,
      status: u.status || 'active',
      joined: u.joined,
      contract: u.contract,
      contractEnd: u.contractEnd || null,
      kpi: u.kpi,
      weeklyTarget: u.weeklyTarget || 'Close 2 sales, generate 5 leads',
      target: u.target || 0,
      sales: 0,
      revenueGenerated: 0,
      performance: 0,
    }))
}

const app = express()
app.use(cors())
app.use(express.json())
// Behind nginx (and maybe Cloudflare) in prod, so the real client IP lives in
// X-Forwarded-For. Trust exactly the proxy hop count (default 1 = nginx) so the
// office-network check reads the true client IP and an X-Forwarded-For header
// injected by the client itself isn't trusted. Bump TRUST_PROXY_HOPS to 2 if
// Cloudflare also fronts Pulse. (Dev = direct, so req.ip is just localhost.)
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))

// ---------- auth ----------
const sessions = db.read('sessions', {}) // token -> { username, exp }
function persistSessions() {
  db.write('sessions', sessions)
}
function publicUser(u) {
  if (!u) return null
  // salary is manager-only (served via /api/staff), never via /me or /users
  const { passwordHash, salary, ...rest } = u
  // resolved powers ride along so the UI can gate sections client-side;
  // the server re-checks every request regardless. isTeamLead unlocks the MY
  // TEAM nav section (gated again server-side on /api/team/*).
  return { ...rest, powers: powersFor(u), isTeamLead: leadsATeam(u), approvalsBeyondTeam: approvalsBeyondTeam(u), canCoachingEdit: canSub(u, 'team', 'coaching-edit'), canCoachingDelete: canSub(u, 'team', 'coaching-delete'), canDocsEdit: canSub(u, 'hr', 'files-edit'), canDocsDelete: canSub(u, 'hr', 'files-delete') }
}
// Accepts a username OR an email (Adama 6 Jul: staff know their email, not the
// internal username — Momodou typed his email and got "Unknown username").
// Usernames never contain '@', so the two can't collide.
function findUser(id) {
  const q = String(id || '').trim().toLowerCase()
  return seedUsers().find((u) => u.username === q || (u.email || '').toLowerCase() === q)
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const s = sessions[token]
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'unauthorized' })
  const real = findUser(s.username)
  if (!real || real.suspended) return res.status(401).json({ error: 'unauthorized' })
  // "View as": a manager may impersonate another user for READ-ONLY viewing.
  let effective = real
  let isViewAs = false
  const va = req.headers['x-view-as']
  if (va && can(real, 'viewas') && inScope(real, 'viewas', va)) {
    const target = findUser(va)
    if (target) {
      effective = target
      isViewAs = true
    }
  }
  req.realUser = real
  req.user = effective
  req.isViewAs = isViewAs
  req.token = token
  next()
}
// ---------- access powers ----------
// Per-person toggles, granted by the CEO (or anyone holding 'grant').
// The CEO (adama) implicitly holds every power. The 'manager' role is a
// TITLE only — power comes exclusively from these grants.
// 'sales' power removed 12 Jun 2026 (Adama's request) — Pulse is HR-only. The
// staff-profile route it used to gate (/agents/:slug) was re-pointed to 'hr'.
const POWERS = [
  ['approvals', 'Leave approvals', 'Approve or reject leave requests'],
  ['team', 'Team', 'Presence, schedules and coaching'],
  ['staffadmin', 'Manage staff', 'Add, archive and restore staff; reset passwords'],
  ['payroll', 'Payroll', 'Salaries, payslips and benefits'],
  ['hr', 'HR', 'KPI rules, contracts, warnings, agent files'],
  ['viewas', 'View as', 'See the app as another staff member (read-only)'],
]
const POWER_KEYS = POWERS.map(([k]) => k)
const CEO = 'adama'

function powersFor(u) {
  if (!u) return []
  if (u.username === CEO) return [...POWER_KEYS]
  return Array.isArray(u.permissions) ? u.permissions.filter((p) => POWER_KEYS.includes(p)) : []
}
function can(u, power) {
  return powersFor(u).includes(power)
}
// ---------- per-power people scope (named sub-toggles — Adama 3 Jul) ----------
// A grant may carry an explicit staff list: permissionScopes = { power: [usernames] }.
// No stored list = covers all active staff. The CEO is NEVER in any scope — the
// owner has no team association, appears in no rosters and cannot be targeted
// or impersonated. The CEO's own powers always cover everyone (except himself).
function scopeCandidates(holder) {
  return seedUsers().filter((x) => !isArchived(x) && x.username !== CEO && x.username !== holder?.username)
}
function powerScopeSet(holder, power) {
  if (!holder || !can(holder, power)) return new Set()
  const all = scopeCandidates(holder).map((x) => x.username)
  const stored = holder.username === CEO ? null : holder.permissionScopes?.[power]
  if (!Array.isArray(stored)) return new Set(all)
  const ok = new Set(all)
  return new Set(stored.filter((s) => ok.has(s)))
}
// Target check for actions — stored-list semantics so archived targets
// (restore) still resolve. Never the CEO, never yourself.
function inScope(holder, power, targetUsername) {
  const target = String(targetUsername || '').toLowerCase()
  if (!holder || !can(holder, power) || target === CEO || target === holder.username) return false
  if (holder.username === CEO) return true
  const stored = holder.permissionScopes?.[power]
  return !Array.isArray(stored) || stored.includes(target)
}
// ---------- capability sub-toggles (nested powers — Adama 3 Jul) ----------
// Parent toggle = see the area. Each sub = one specific action inside it.
// No stored list = all subs on (legacy grants keep working unchanged).
const SUBPOWERS = {
  approvals: [
    ['decide', 'Approve & reject', 'Decide requests — without this, view only'],
  ],
  team: [
    ['schedules', 'Edit schedules', 'Assign shifts and correct attendance days'],
    ['coaching', 'Coaching & flags', 'Log coaching sessions, flags and meetings'],
    ['coaching-edit', 'Edit coaching', 'Change logged coaching entries'],
    ['coaching-delete', 'Delete coaching', 'Remove logged coaching entries'],
  ],
  staffadmin: [
    ['add', 'Add staff', 'Create new staff accounts'],
    ['archive', 'Archive staff', 'Move someone to Past Staff'],
    ['restore', 'Restore staff', 'Bring someone back from Past Staff'],
    ['password', 'Reset passwords', 'Set a temporary password'],
  ],
  payroll: [
    ['edit', 'Edit pay', 'Create and delete payslips and benefits'],
  ],
  hr: [
    ['records', 'Records', 'Profiles, contracts, checklists, applicants'],
    ['performance', 'Performance', 'KPI rules, reviews, warnings, agent files'],
    ['files-edit', 'Edit documents', "Rename a document or change its type"],
    ['files-delete', 'Delete documents', "Remove uploaded documents from someone's file"],
  ],
  viewas: [],
}
function canSub(u, power, sub) {
  if (!can(u, power)) return false
  if (u.username === CEO) return true
  if (!(SUBPOWERS[power] || []).some(([k]) => k === sub)) return false
  const stored = u.permissionSubs?.[power]
  return !Array.isArray(stored) || stored.includes(sub)
}
// True when someone's Leave-approvals grant reaches OUTSIDE their own team —
// only then does the company Approvals page show anything Team Requests
// doesn't. Drives the nav dedupe (Adama 3 Jul).
function approvalsBeyondTeam(u) {
  if (!can(u, 'approvals')) return false
  const team = teamUsernameSet(u.username)
  return [...powerScopeSet(u, 'approvals')].some((x) => !team.has(x))
}
// HR + payroll records are keyed by display NAME in places.
function hrNamesSet(holder) {
  const scope = powerScopeSet(holder, 'hr')
  return new Set(seedUsers().filter((x) => scope.has(x.username)).map((x) => x.name))
}
// Powers are always checked on the REAL user — "view as" never changes
// what you're allowed to do, only what you're looking at.
function requirePower(power) {
  return (req, res, next) => {
    if (!can(req.realUser, power)) return res.status(403).json({ error: 'forbidden' })
    next()
  }
}
function requireSub(power, sub) {
  return (req, res, next) => {
    if (!canSub(req.realUser, power, sub)) return res.status(403).json({ error: 'forbidden' })
    next()
  }
}
// Access management is the CEO's alone (Grant power removed 3 Jul).
function requireCeo(req, res, next) {
  if (req.realUser.username !== CEO) return res.status(403).json({ error: 'forbidden' })
  next()
}
// Block writes while a manager is viewing as someone else (read-only impersonation).
// Log an action the owner takes while impersonating someone, so a future
// Activity page can show "Adama, acting as X, did Y". Never blocks the action.
function logImpersonatedAction(req) {
  try {
    const log = db.read('activity', [])
    log.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: req.realUser.username,
      actorName: req.realUser.name,
      as: req.user.username,
      asName: req.user.name,
      method: req.method,
      path: req.path,
    })
    db.write('activity', log.slice(-2000)) // keep the most recent 2000
  } catch { /* logging must never break the action */ }
}

function notViewAs(req, res, next) {
  if (req.isViewAs) {
    // The OWNER can act while impersonating (to build, test and fix any role) —
    // every such action is logged with the real actor. Other managers stay
    // strictly read-only while viewing as someone.
    if (req.realUser?.username === CEO) { logImpersonatedAction(req); return next() }
    return res.status(403).json({ error: 'Read-only while viewing as another user' })
  }
  next()
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = username ? findUser(username) : null
  if (!user) return res.status(401).json({ error: 'No account with that email' })
  if (isArchived(user)) return res.status(403).json({ error: 'This account is archived' })
  if (user.suspended) return res.status(403).json({ error: 'Your sign-in is paused. Speak to Adama.' })
  if (REQUIRE_PASSWORD && !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  sessions[token] = { username: user.username, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }
  persistSessions()
  res.json({ token, user: publicUser(user) })
})

app.get('/api/me', auth, (req, res) =>
  res.json({ user: publicUser(req.user) }))

// Change own password. Verifies the current one, swaps the hash, clears the
// first-login flag, and signs out every other session for this account.
// ---------- access powers: list + grant/revoke ----------
// The catalogue, for building the toggle UI.
app.get('/api/powers', auth, (req, res) => {
  res.json({ powers: POWERS.map(([key, label, detail]) => ({ key, label, detail, subs: (SUBPOWERS[key] || []).map(([k, l, d]) => ({ key: k, label: l, detail: d })) })) })
})

// Set someone's powers. Holder of 'grant' required. Guardrails:
//   - the CEO's powers can never be edited (he has everything, always)
//   - non-CEO granters cannot edit their OWN powers
//   - only the CEO can give or take the 'grant' power itself
// Every change is appended to the target's accessLog: who, when, before, after.
app.post('/api/staff/:username/access', auth, notViewAs, requireCeo, (req, res) => {
  const target = String(req.params.username).toLowerCase()
  const requested = Array.isArray(req.body?.powers) ? req.body.powers : null
  if (!requested) return res.status(400).json({ error: 'powers must be an array' })
  const invalid = requested.filter((p) => !POWER_KEYS.includes(p))
  if (invalid.length) return res.status(400).json({ error: `Unknown power: ${invalid.join(', ')}` })

  if (target === CEO) return res.status(403).json({ error: 'The CEO’s access cannot be edited' })
  const isCeo = req.realUser.username === CEO
  if (!isCeo && target === req.realUser.username)
    return res.status(403).json({ error: 'You cannot edit your own access' })

  const users = seedUsers()
  const user = users.find((u) => u.username === target)
  if (!user) return res.status(404).json({ error: 'No such user' })

  const before = powersFor(user)
  if (!isCeo && (requested.includes('grant') !== before.includes('grant')))
    return res.status(403).json({ error: 'Only the CEO can give or take Grant access' })

  user.permissions = [...new Set(requested)]
  // Named sub-toggles: which staff each power covers. Cleaned against the
  // roster — never the CEO, never themselves. No stored list = all staff.
  if (req.body?.scopes && typeof req.body.scopes === 'object') {
    const valid = new Set(seedUsers().filter((x) => x.username !== CEO && x.username !== target).map((x) => x.username))
    const clean = {}
    for (const [k, v] of Object.entries(req.body.scopes)) {
      if (!POWER_KEYS.includes(k) || !Array.isArray(v)) continue
      clean[k] = [...new Set(v.map((s) => String(s).toLowerCase()))].filter((s) => valid.has(s))
    }
    user.permissionScopes = clean
  }
  // Capability sub-toggles: which actions inside each power. No list = all.
  if (req.body?.subs && typeof req.body.subs === 'object') {
    const cleanSubs = {}
    for (const [k, v] of Object.entries(req.body.subs)) {
      if (!SUBPOWERS[k] || !Array.isArray(v)) continue
      const valid = new Set(SUBPOWERS[k].map(([sk]) => sk))
      cleanSubs[k] = [...new Set(v.map(String))].filter((s) => valid.has(s))
    }
    user.permissionSubs = cleanSubs
  }
  // Optional: set their email here too (seeded accounts have none, and the
  // Open Admin hand-off needs one to identify them in the admin system).
  if (typeof req.body?.email === 'string' && req.body.email.trim()) {
    const email = req.body.email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })
    // Emails must stay unique — they're a login identifier now (findUser).
    if (seedUsers().some((u) => u.username !== user.username && (u.email || '').toLowerCase() === email))
      return res.status(409).json({ error: 'Another staff member already uses that email' })
    user.email = email
  }
  // Master switch: pause/resume their Pulse sign-in entirely (reversible —
  // different from Archive, which means they left). Pausing kills sessions.
  let signInChange = null
  if (typeof req.body?.canSignIn === 'boolean') {
    const suspend = !req.body.canSignIn
    if (suspend !== !!user.suspended) {
      user.suspended = suspend
      signInChange = suspend ? 'paused' : 'resumed'
      if (suspend) {
        for (const [tok, s] of Object.entries(sessions)) {
          if (s.username === user.username) delete sessions[tok]
        }
        persistSessions()
      }
    }
  }
  user.accessLog = [
    ...(user.accessLog || []),
    {
      at: new Date().toISOString(),
      by: req.realUser.username,
      before,
      after: user.permissions,
      scopes: user.permissionScopes || {},
      subs: user.permissionSubs || {},
      ...(signInChange ? { signIn: signInChange } : {}),
    },
  ]
  db.write('users', users)
  res.json({ ok: true, user: publicUser(user) })
})

// ---------- Open Admin (SSO bridge into the customer system) — REMOVED ----------
// Removed 12 Jun 2026 at Adama's explicit request: Pulse is being narrowed to
// HR-only, so the admin sign-in bridge is gone. Deleted here: the
// POST /api/open-admin endpoint, the OPEN_ADMIN / ADMIN_API_URL /
// ADMIN_BASE_URL / PULSE_SSO_SECRET constants, and the 'admin' power (see
// POWERS above). Frontend "Open Admin" button removed from Sidebar. The
// customer data Pulse still holds will be transferred to the admin app later.

app.post('/api/change-password', auth, notViewAs, (req, res) => {
  const { currentPassword, newPassword } = req.body || {}
  if (!newPassword || String(newPassword).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' })
  const users = seedUsers()
  const user = users.find((u) => u.username === req.realUser.username)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  if (!bcrypt.compareSync(currentPassword || '', user.passwordHash))
    return res.status(401).json({ error: 'Current password is incorrect' })
  user.passwordHash = bcrypt.hashSync(String(newPassword), 10)
  user.mustChangePassword = false
  db.write('users', users)
  for (const [tok, s] of Object.entries(sessions)) {
    if (s.username === user.username && tok !== req.token) delete sessions[tok]
  }
  persistSessions()
  res.json({ ok: true, user: publicUser(user) })
})

// Manager resets a forgotten password to a temporary one the staff member
// must change at next sign-in. Managers can reset staff; only the CEO
// account can reset another manager. All their sessions are signed out.
app.post('/api/staff/:username/reset-password', auth, requireSub('staffadmin', 'password'), notViewAs, (req, res) => {
  const { tempPassword } = req.body || {}
  if (!tempPassword || String(tempPassword).length < 8)
    return res.status(400).json({ error: 'Temporary password must be at least 8 characters' })
  const users = seedUsers()
  const target = users.find((u) => u.username === String(req.params.username).toLowerCase())
  if (!target) return res.status(404).json({ error: 'No such user' })
  if (target.role === 'manager' && req.realUser.username !== 'adama')
    return res.status(403).json({ error: 'Only the CEO can reset a manager password' })
  if (!inScope(req.realUser, 'staffadmin', target.username)) return res.status(403).json({ error: 'Not in your Manage-staff scope' })
  target.passwordHash = bcrypt.hashSync(String(tempPassword), 10)
  target.mustChangePassword = true
  db.write('users', users)
  for (const [tok, s] of Object.entries(sessions)) {
    if (s.username === target.username) delete sessions[tok]
  }
  persistSessions()
  res.json({ ok: true })
})

// ---------- set-password links (emailed; one-time, 60 minutes) ----------
// The staff member clicks the emailed link and chooses their own password —
// nobody has to share a temporary one over WhatsApp. Links are stored in
// data/password-links.json: {token, username, exp}. One link per person at a
// time; using it (or requesting a new one) kills the old one.
const LINK_TTL_MS = 60 * 60 * 1000

function readLinks() {
  // prune expired links on every read so the file never grows
  const now = Date.now()
  return db.read('password-links', []).filter((l) => l.exp > now)
}

function createPasswordLink(username, createdBy) {
  const token = crypto.randomBytes(24).toString('hex')
  const links = readLinks().filter((l) => l.username !== username)
  links.push({ token, username, exp: Date.now() + LINK_TTL_MS, createdBy, createdAt: new Date().toISOString() })
  db.write('password-links', links)
  return token
}

async function sendSetPasswordEmail(user, { isNew, createdBy }) {
  const token = createPasswordLink(user.username, createdBy)
  const url = `${PULSE_PUBLIC_URL}/set-password?token=${token}`
  const first = String(user.name || '').split(' ')[0] || 'there'
  const intro = isNew
    ? 'Your Pulse account is ready. Pulse is the Damia team app — check in, request leave, and follow your targets and pay.'
    : 'A new password was requested for your Pulse account.'
  const subject = isNew ? 'Welcome to Pulse — set your password' : 'Set a new Pulse password'
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1f2430">
    <div style="font-size:22px;font-weight:800;color:#d6294f">Pulse</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#8a8f9c;margin-top:2px">by Damia Tracker</div>
    <p style="margin-top:22px;font-size:15px;line-height:1.6">Hi ${first},</p>
    <p style="font-size:15px;line-height:1.6">${intro}</p>
    <p style="font-size:15px;line-height:1.6">You'll sign in with this email address (<strong>${user.email}</strong>). Click the button to choose your password:</p>
    <p style="margin:26px 0"><a href="${url}" style="background:#d6294f;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:12px;display:inline-block">Set my password</a></p>
    <p style="font-size:13px;line-height:1.6;color:#8a8f9c">This link works for 60 minutes and can be used once. If it expires, ask your manager to send a new one. If you didn't expect this email, you can ignore it.</p>
    <p style="font-size:13px;color:#8a8f9c">Damia Security Solutions Ltd</p>
  </div>`
  const text = `Hi ${first},\n\n${intro}\n\nYou'll sign in with this email address (${user.email}). Set your password here (works for 60 minutes):\n${url}\n\nIf you didn't expect this email, you can ignore it.`
  const result = await sendMail({ to: user.email, subject, text, html })
  if (result.blocked) console.log(`[email] set-password link for ${user.username}: ${url}`)
  return result
}

// Manager emails someone a set-password link. Same guards as reset-password:
// managers handle staff, only the CEO handles managers.
app.post('/api/staff/:username/send-password-link', auth, requireSub('staffadmin', 'password'), notViewAs, async (req, res) => {
  const users = seedUsers()
  const target = users.find((u) => u.username === String(req.params.username).toLowerCase())
  if (!target) return res.status(404).json({ error: 'No such user' })
  if (isArchived(target)) return res.status(400).json({ error: 'This account is archived' })
  if (!target.email) return res.status(400).json({ error: 'This person has no email on file — add one first' })
  if (target.role === 'manager' && req.realUser.username !== 'adama')
    return res.status(403).json({ error: 'Only the CEO can reset a manager password' })
  if (!inScope(req.realUser, 'staffadmin', target.username)) return res.status(403).json({ error: 'Not in your Manage-staff scope' })
  if (!emailConfigured() && String(process.env.OUTBOUND_EMAIL || '').toLowerCase() !== 'off')
    return res.status(400).json({ error: 'Email is not set up on this server yet' })
  try {
    const result = await sendSetPasswordEmail(target, { isNew: false, createdBy: req.realUser.username })
    target.history = target.history || []
    target.history.push({ date: todayKey(), event: `Set-password link emailed to ${target.email} by ${req.realUser.username}` })
    db.write('users', users)
    res.json({ ok: true, blocked: !!result.blocked, email: target.email })
  } catch (e) {
    res.status(502).json({ error: `Could not send the email: ${e.message}` })
  }
})

// The two public endpoints behind the emailed link. No auth — the token IS
// the proof. GET validates and names the person; POST sets the password.
app.get('/api/password-link/:token', (req, res) => {
  const link = readLinks().find((l) => l.token === req.params.token)
  if (!link) return res.status(410).json({ error: 'This link has expired or was already used. Ask your manager to send a new one.' })
  const user = findUser(link.username)
  if (!user || isArchived(user)) return res.status(410).json({ error: 'This account is no longer active.' })
  res.json({ name: user.name, username: user.username, email: user.email || null })
})

app.post('/api/password-link/:token', (req, res) => {
  const links = readLinks()
  const link = links.find((l) => l.token === req.params.token)
  if (!link) return res.status(410).json({ error: 'This link has expired or was already used. Ask your manager to send a new one.' })
  const { password } = req.body || {}
  if (!password || String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  const users = seedUsers()
  const user = users.find((u) => u.username === link.username)
  if (!user || isArchived(user)) return res.status(410).json({ error: 'This account is no longer active.' })
  user.passwordHash = bcrypt.hashSync(String(password), 10)
  user.mustChangePassword = false
  user.history = user.history || []
  user.history.push({ date: todayKey(), event: 'Set their password via emailed link' })
  db.write('users', users)
  db.write('password-links', links.filter((l) => l.username !== link.username))
  for (const [tok, s] of Object.entries(sessions)) {
    if (s.username === user.username) delete sessions[tok]
  }
  persistSessions()
  res.json({ ok: true, username: user.username })
})

app.post('/api/logout', auth, (req, res) => {
  delete sessions[req.token]
  persistSessions()
  res.json({ ok: true })
})

// ---------- roster (for dashboards) ----------
app.get('/api/team', auth, (req, res) => {
  const archived = archivedNameSet()
  const merged = [...team, ...createdStaffRoster()].filter((p) => !archived.has(p.name))
  // private manager notes never go to staff clients. Scoped by the VIEWED user
  // so view-as renders exactly what that person sees.
  const roster =
    can(req.user, 'team')
      ? merged
      : merged.map(({ nextActionNote, ...p }) => p)
  res.json({ team: roster })
})

// ---------- staff onboarding (manager only) ----------
// list staff created via Pulse (includes salary — manager eyes only)
app.get('/api/staff', auth, requirePower('team'), (req, res) => {
  const staff = seedUsers()
    .filter((u) => u.createdViaPulse && !isArchived(u))
    .map((u) => ({
      username: u.username,
      name: u.name,
      email: u.email,
      title: u.title,
      department: u.department,
      role: u.role,
      status: u.status,
      salary: u.salary,
      target: u.target,
      kpi: u.kpi,
      contract: u.contract,
      contractEnd: u.contractEnd,
      joined: u.joined,
      createdAt: u.createdAt,
    }))
  res.json({ staff })
})

// create a sales staff account
app.post('/api/staff', auth, requireSub('staffadmin', 'add'), notViewAs, async (req, res) => {
  const { type, name, email, title, salary, target, contractMonths } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' })
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' })
  const users = seedUsers()
  if (users.some((u) => (u.email || '').toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: 'A staff member with that email already exists' })

  const isMgr = type === 'manager'
  const username = uniqueUsername(usernameFor(name))
  const joined = todayKey()
  const months = Number(contractMonths) || 0
  const contract = months > 0 ? `${months}-month fixed` : 'Indefinite'
  const contractEnd = months > 0 ? addMonths(joined, months) : null
  // managers oversee everything across departments — no preset sales goal (set manually later)
  const tgt = isMgr ? 0 : Number(target) || 5
  const cleanTitle = String(title || (isMgr ? 'Manager' : 'Sales Agent')).trim()

  const rec = {
    username,
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    role: isMgr ? 'manager' : 'staff',
    department: isMgr ? 'Management' : 'Sales',
    title: cleanTitle,
    passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
    mustChangePassword: true,
    salary: Number(salary) || 0,
    target: tgt,
    kpi: isMgr ? '' : `Close ${tgt} tracker sales per month`,
    weeklyTarget: isMgr ? '' : 'Close 2 sales, generate 5 leads',
    contract,
    contractEnd,
    joined,
    status: 'active',
    createdViaPulse: true,
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    history: [
      {
        date: joined,
        event: `Joined as ${cleanTitle} — ${contract}${contractEnd ? ` (ends ${contractEnd})` : ''}`,
      },
    ],
  }
  users.push(rec)
  db.write('users', users)

  // Email the invite (a set-password link) right away — best effort: the
  // account exists either way, and the modal tells the manager what happened.
  let invited = false
  if (emailConfigured() || String(process.env.OUTBOUND_EMAIL || '').toLowerCase() === 'off') {
    try {
      const result = await sendSetPasswordEmail(rec, { isNew: true, createdBy: req.user.username })
      invited = !result.blocked
      rec.history.push({ date: joined, event: `Invite emailed to ${rec.email}` })
      db.write('users', users)
    } catch (e) {
      console.log(`[email] invite to ${rec.email} failed: ${e.message}`)
    }
  }
  res.json({ staff: { username, name: rec.name, email: rec.email, title: rec.title }, invited })
})

// archive a staff member — keeps the record forever, blocks login, removes from active lists
app.post('/api/staff/:username/archive', auth, requireSub('staffadmin', 'archive'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  if (u.username === req.realUser.username) return res.status(400).json({ error: "You can't archive your own account" })
  if (isArchived(u)) return res.status(409).json({ error: 'Already archived' })
  if (!inScope(req.realUser, 'staffadmin', u.username)) return res.status(403).json({ error: 'Not in your Manage-staff scope' })
  const reason = String(req.body?.reason || '').trim()
  u.status = 'archived'
  u.archivedAt = new Date().toISOString()
  u.archivedBy = req.realUser.username
  u.archivedReason = reason || null
  u.history = u.history || []
  u.history.push({ date: todayKey(), event: `Left the team${reason ? ` — ${reason}` : ''}` })
  db.write('users', users)
  // end any active sessions so they're logged out immediately
  for (const [tok, s] of Object.entries(sessions)) if (s.username === u.username) delete sessions[tok]
  persistSessions()
  res.json({ ok: true })
})

// restore an archived staff member
app.post('/api/staff/:username/restore', auth, requireSub('staffadmin', 'restore'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  if (!isArchived(u)) return res.status(409).json({ error: 'Not archived' })
  if (!inScope(req.realUser, 'staffadmin', u.username)) return res.status(403).json({ error: 'Not in your Manage-staff scope' })
  u.status = 'active'
  delete u.archivedAt
  delete u.archivedBy
  delete u.archivedReason
  u.history = u.history || []
  u.history.push({ date: todayKey(), event: 'Reactivated' })
  db.write('users', users)
  res.json({ ok: true })
})

// past agents (manager only) — archived Pulse accounts + the historical roster of people who left
app.get('/api/past-agents', auth, requirePower('team'), (req, res) => {
  const archived = seedUsers()
    .filter(isArchived)
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.title,
      department: u.department,
      reason: u.archivedReason || 'Left the team',
      date: u.archivedAt ? u.archivedAt.slice(0, 10) : null,
      joined: u.joined || null,
      restorable: true,
    }))
  const historical = (pastStaff || []).map((p) => ({
    name: p.name,
    role: p.role,
    reason: p.reason || 'Left the team',
    date: p.date || null,
    restorable: false,
  }))
  res.json({ pastAgents: [...archived, ...historical] })
})

// who a manager can "view as" (everyone but themselves)
app.get('/api/users', auth, requirePower('team'), (req, res) => {
  const users = seedUsers()
    .filter((u) => u.username !== req.realUser.username && u.username !== CEO && !isArchived(u))
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.role,
      department: u.department,
      title: u.title,
      email: u.email || null,
      powers: powersFor(u), // drives the Access toggles on the Team page
      permissionScopes: u.permissionScopes || {}, // named sub-toggles: who each power affects
      permissionSubs: u.permissionSubs || {}, // capability sub-toggles: what they can do inside it
      isTeamLead: leadsATeam(u), // unlocks MY TEAM nav (also when viewing-as them)
      approvalsBeyondTeam: approvalsBeyondTeam(u), // nav dedupe: company Requests vs Team Requests
      // resolved action flags — view-as must show EXACTLY the viewed user's
      // buttons (Adama's standing rule), so these ride along like in /me
      canCoachingEdit: canSub(u, 'team', 'coaching-edit'),
      canCoachingDelete: canSub(u, 'team', 'coaching-delete'),
      canDocsEdit: canSub(u, 'hr', 'files-edit'),
      canDocsDelete: canSub(u, 'hr', 'files-delete'),
      suspended: !!u.suspended,
    }))
  res.json({ users })
})

// ---------- attendance ----------
const todayKey = () => new Date().toISOString().slice(0, 10)
function attendanceFor(username, date) {
  const all = db.read('attendance', [])
  return all.find((a) => a.username === username && a.date === date)
}

app.get('/api/attendance/today', auth, (req, res) => {
  res.json({ record: attendanceFor(req.user.username, todayKey()) || null })
})

app.get('/api/attendance/mine', auth, (req, res) => {
  const all = db.read('attendance', [])
  const mine = all
    .filter((a) => a.username === req.user.username)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  res.json({ records: mine })
})

function cleanLoc(body) {
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  return null
}

// Office-network check (Adama 30 Jun): a check-in whose client IP matches the
// office's public IP is stamped onOfficeNetwork:true — a trustworthy "at work"
// signal that works even on laptops (no GPS needed). OFFICE_IP(S) is a
// comma-separated list in .env (Gamtel IPs can change — edit there, no code
// change). Unset → onOfficeNetwork stays null (unknown); it never blocks check-in.
const OFFICE_IPS = (process.env.OFFICE_IPS || process.env.OFFICE_IP || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
function clientIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || ''
  return String(ip).replace(/^::ffff:/, '').replace(/%.*$/, '') // strip IPv4-mapped IPv6 + zone id
}
function onOfficeNetwork(req) {
  if (!OFFICE_IPS.length) return null // not configured → unknown
  return OFFICE_IPS.includes(clientIp(req))
}

app.post('/api/attendance/check-in', auth, notViewAs, (req, res) => {
  const all = db.read('attendance', [])
  const date = todayKey()
  let rec = all.find((a) => a.username === req.user.username && a.date === date)
  if (rec && rec.checkIn) return res.status(409).json({ error: 'Already checked in today' })
  const now = new Date().toISOString()
  if (!rec) {
    rec = { id: crypto.randomUUID(), username: req.user.username, name: req.user.name, date }
    all.push(rec)
  }
  rec.checkIn = now
  const loc = cleanLoc(req.body)
  if (loc) rec.checkInLoc = loc
  rec.checkInIp = clientIp(req)
  rec.onOfficeNetwork = onOfficeNetwork(req)
  // late if after 09:00 local
  const d = new Date(now)
  rec.late = d.getHours() > 9 || (d.getHours() === 9 && d.getMinutes() > 0)
  db.write('attendance', all)
  res.json({ record: rec })
})

app.post('/api/attendance/check-out', auth, notViewAs, (req, res) => {
  const all = db.read('attendance', [])
  const date = todayKey()
  const rec = all.find((a) => a.username === req.user.username && a.date === date)
  if (!rec || !rec.checkIn) return res.status(409).json({ error: 'Not checked in yet' })
  if (rec.checkOut) return res.status(409).json({ error: 'Already checked out' })
  rec.checkOut = new Date().toISOString()
  const loc = cleanLoc(req.body)
  if (loc) rec.checkOutLoc = loc
  rec.checkOutIp = clientIp(req)
  rec.checkOutOnOffice = onOfficeNetwork(req)
  db.write('attendance', all)
  res.json({ record: rec })
})

// Manager fixes a check-in (Adama 6 Jul): when someone couldn't check in or
// was wrongly marked late (network down, phone trouble), whoever holds the
// schedule permission sets the real time WITH a reason — from the Team
// Schedule page, not the person's profile. The original time stays on the
// record: it's a correction on top, never a rewrite.
app.post('/api/team/attendance-fix', auth, requireSub('team', 'schedules'), notViewAs, (req, res) => {
  const { username, date, checkIn, checkOut, reason } = req.body || {}
  const target = seedUsers().find((x) => x.username === String(username || '').toLowerCase())
  if (!target || isArchived(target)) return res.status(404).json({ error: 'No such staff member' })
  if (!powerScopeSet(req.realUser, 'team').has(target.username))
    return res.status(403).json({ error: 'Not in your Team scope' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Pick a date' })
  if (date > todayKey()) return res.status(400).json({ error: 'That day has not happened yet' })
  if (date < ATTENDANCE_START) return res.status(400).json({ error: `Attendance starts ${ATTENDANCE_START} — nothing to fix before that` })
  if (!HHMM.test(checkIn || '')) return res.status(400).json({ error: 'Check-in time must look like 09:05' })
  if (checkOut && !HHMM.test(checkOut)) return res.status(400).json({ error: 'Check-out time must look like 17:00' })
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'Say why — the reason shows on the record' })

  const all = db.read('attendance', [])
  let rec = all.find((a) => a.username === target.username && a.date === date)
  if (!rec) {
    rec = { id: crypto.randomUUID(), username: target.username, name: target.name, date }
    all.push(rec)
  }
  if (rec.fixedBy === undefined) rec.originalCheckIn = rec.checkIn || null
  rec.checkIn = `${date}T${checkIn}:00.000Z` // Gambia is GMT — local HH:MM == UTC
  if (checkOut) rec.checkOut = `${date}T${checkOut}:00.000Z`
  rec.late = checkIn > '09:00' // same rule as self check-in
  rec.fixedBy = req.realUser.username
  rec.fixedByName = req.realUser.name
  rec.fixedAt = new Date().toISOString()
  rec.fixReason = String(reason).trim().slice(0, 300)
  db.write('attendance', all)
  res.json({ record: rec })
})

// Self "undo check-in" REMOVED 8 Jul 2026 (Adama): staff can't wipe their own
// attendance record. Corrections are manager work — "Fix a check-in" on Team
// Schedule, or the Attendance day editor's "Clear · no record".

// manager: today's presence for whole team
app.get('/api/attendance', auth, requirePower('team'), (req, res) => {
  const date = req.query.date || todayKey()
  const all = db.read('attendance', [])
  const byUser = Object.fromEntries(all.filter((a) => a.date === date).map((a) => [a.username, a]))
  const roster = seedUsers().filter((u) => u.username !== 'adama' && !isArchived(u))
  const presence = roster.map((u) => ({
    username: u.username,
    name: u.name,
    department: u.department,
    record: byUser[u.username] || null,
  }))
  res.json({ date, presence })
})

// ---------- My Team (team-lead workspace, Adama 30 Jun) ----------
// A team lead's SCOPED view of the people they manage (never the whole company).
// Real data only — sales from agent-sales, attendance from today's record, score
// from the locked profile, contract end from the roster. Honest blanks where a
// source doesn't exist yet (reviews.json empty, Admin KPI feed off). Self-scoped
// to the caller's own team; 403 if they don't lead one (re-checked server-side).
// Which role scorecard applies to a person (mirrors /api/my/progress).
function scorecardKey(u) {
  const r = (u.title || '').toLowerCase()
  const t = (u.department || '').toLowerCase()
  if (r.includes('team lead')) return 'team-lead'
  if (r.includes('customer service') || t === 'customer service') return 'customer-service'
  if (t === 'sales' || r.includes('sales')) return 'sales'
  return null
}
// The member's weighted KPI scorecard so a team lead knows WHAT to coach on.
// Same targets/weights as My Progress. Actuals: sales from the sheet (real);
// every other KPI comes from the Admin feed later, so it's null until connected.
// ---------- KPI targets (Adama 3 Jul: "Pulse should be responsible for
// changing the goals and it reflects in admin") ----------
// The catalog = the canonical role scorecards with their DEFAULT numbers —
// exactly the ones walked through with Adama (sales 5/agent, retention 80%,
// team 12, …). The CEO schedules changes per KPI with an EFFECTIVE MONTH on
// the KPI Targets page; nothing moves until that month arrives, and history
// stays intact (each change is an appended entry, resolved by month — same
// idea as the admin's pricing history). Admin reads the resolved numbers over
// /api/integrations/kpi-targets with the shared PULSE_SYNC_KEY.
const KPI_CATALOG = {
  'sales': { role: 'Sales agent', kpis: [
    { key: 'sales', label: 'Tracker sales', kind: 'count', unit: 'sales', target: 5, weight: 40 },
    { key: 'online', label: 'Trackers online', kind: 'percent', unit: '%', target: 75, weight: 20 },
    { key: 'retention', label: 'Customer retention', kind: 'percent', unit: '%', target: 80, weight: 25 },
    { key: 'reviews', label: '5-star Google reviews', kind: 'count', unit: 'reviews', target: 3, weight: 15 },
  ] },
  'customer-service': { role: 'Customer Service', kpis: [
    { key: 'cases', label: 'Case resolution', kind: 'percent', unit: '%', target: 85, weight: 40 },
    { key: 'install', label: 'Installation within 3 days', kind: 'percent', unit: '%', target: 95, weight: 35 },
    { key: 'stock', label: 'Stock accountability (trackers)', kind: 'percent', unit: '% verified', target: 100, weight: 25 },
  ] },
  'team-lead': { role: 'Team Lead', kpis: [
    { key: 'team-sales', label: 'Team tracker sales', kind: 'count', unit: 'sales', target: 12, weight: 50 },
    { key: 'team-active', label: 'Whole team contributing', kind: 'percent', unit: '% of agents with a sale', target: 100, weight: 25 },
    { key: 'team-attendance', label: 'Team attendance', kind: 'percent', unit: '%', target: 90, weight: 25 },
    // Parked until Admin feeds them — visible, weight 0 (Adama 3 Jul).
    { key: 'team-retention', label: 'Team retention', kind: 'percent', unit: '%', target: 80, weight: 0 },
    { key: 'team-online', label: 'Trackers online', kind: 'percent', unit: '%', target: 75, weight: 0 },
    { key: 'team-reviews', label: 'Five-star reviews (team)', kind: 'count', unit: 'reviews', target: null, weight: 0 },
  ] },
}
// Custom KPIs the CEO added on top of the catalog (Adama 3 Jul: "I should be
// able to add a KPI if I want and it recalculates the weight"). Stored in
// data/kpi-custom.json; each takes effect from its month like everything else.
function customKpisFor(roleKey, month) {
  return db.read('kpi-custom', [])
    .filter((c) => c.role === roleKey && c.effectiveFrom <= month)
}
// Weights auto-balance to 100 (Adama 3 Jul): custom KPIs keep the weight the
// CEO gave them; the catalog's scored KPIs share what's left, scaled in
// proportion to their own weights. Weight-0 (parked) KPIs stay at 0.
function normalizeWeights(kpis) {
  const customs = kpis.filter((k) => k.custom && k.weight > 0)
  const cw = customs.reduce((s, k) => s + k.weight, 0)
  const base = kpis.filter((k) => !k.custom && k.weight > 0)
  const bw = base.reduce((s, k) => s + k.weight, 0)
  const room = Math.max(0, 100 - Math.min(cw, 100))
  if (bw > 0) {
    let acc = 0
    let biggest = null
    for (const k of base) {
      k.weight = Math.round((k.weight * room) / bw)
      acc += k.weight
      if (!biggest || k.weight > biggest.weight) biggest = k
    }
    if (biggest) biggest.weight += room - acc // absorb rounding drift
  }
  return kpis
}
// Resolve a role's plan for a month: catalog defaults + the CEO's custom KPIs,
// with any scheduled change effective on or before that month (latest wins),
// then weights normalized to total 100.
function kpiPlanFor(roleKey, month) {
  const cat = KPI_CATALOG[roleKey]
  if (!cat) return null
  const entries = db.read('kpi-targets', [])
  const resolve = (k, isCustom) => {
    const eligible = entries
      .filter((e) => e.role === roleKey && e.kpi === k.key && e.effectiveFrom <= month)
      .sort((a, b) => (a.effectiveFrom || '').localeCompare(b.effectiveFrom || ''))
    const set = eligible[eligible.length - 1] || null
    return {
      key: k.key, label: k.label, kind: k.kind, unit: k.unit,
      target: set && set.target != null ? set.target : k.target,
      weight: set && set.weight != null ? set.weight : k.weight,
      setFrom: set?.effectiveFrom || null,
      custom: !!isCustom,
      customId: isCustom ? k.id : undefined,
    }
  }
  const kpis = [
    ...cat.kpis.map((k) => resolve(k, false)),
    ...customKpisFor(roleKey, month).map((k) => resolve(k, true)),
  ]
  return { role: cat.role, kpis: normalizeWeights(kpis) }
}
// One KPI's resolved numbers for a month ({target, weight}, catalog fallback).
function kpiNumber(roleKey, kpiKey, month) {
  const plan = kpiPlanFor(roleKey, month)
  return plan?.kpis.find((k) => k.key === kpiKey) || null
}
// Overlay the resolved plan onto a built scorecard: the normalized weights
// win, and the CEO's custom KPIs join the card (actual null — nothing feeds
// them yet, so they show unmeasured, never faked).
function overlayPlan(kpis, roleKey, month) {
  const plan = kpiPlanFor(roleKey, month)
  if (!plan) return kpis
  const byKey = new Map(plan.kpis.map((k) => [k.key, k]))
  const out = kpis.map((k) => {
    const p = byKey.get(k.key)
    return p ? { ...k, weight: p.weight } : k
  })
  for (const p of plan.kpis) {
    if (p.custom && !out.some((k) => k.key === p.key)) {
      out.push({ key: p.key, label: p.label, kind: p.kind, target: p.target, weight: p.weight, unit: p.unit, actual: null, custom: true })
    }
  }
  return out
}

// KPI Targets — CEO-only management (the goals ARE the company's standards).
app.get('/api/kpi-targets', auth, requireCeo, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : todayKey().slice(0, 7)
  const roles = Object.keys(KPI_CATALOG).map((k) => ({ key: k, ...kpiPlanFor(k, month) }))
  const entries = db.read('kpi-targets', []).slice()
    .sort((a, b) => (b.effectiveFrom || '').localeCompare(a.effectiveFrom || '') || (b.setAt || '').localeCompare(a.setAt || ''))
  res.json({ month, roles, entries })
})
app.post('/api/kpi-targets', auth, notViewAs, requireCeo, (req, res) => {
  const { role, kpi, target, weight, effectiveFrom } = req.body || {}
  const cat = KPI_CATALOG[role]
  const def = cat?.kpis.find((k) => k.key === kpi)
    || db.read('kpi-custom', []).find((c) => c.role === role && c.key === kpi)
  if (!def) return res.status(400).json({ error: 'unknown role or KPI' })
  if (!/^\d{4}-\d{2}$/.test(String(effectiveFrom || ''))) return res.status(400).json({ error: 'effectiveFrom must be YYYY-MM' })
  if (String(effectiveFrom) < todayKey().slice(0, 7)) return res.status(400).json({ error: 'The effective month is in the past — goals change forward, not backward.' })
  const t = target === '' || target == null ? null : Number(target)
  const w = weight === '' || weight == null ? null : Number(weight)
  if (t == null && w == null) return res.status(400).json({ error: 'Set a target, a weight, or both.' })
  if (t != null && (!Number.isFinite(t) || t < 0)) return res.status(400).json({ error: 'Target must be a number ≥ 0.' })
  if (w != null && (!Number.isFinite(w) || w < 0 || w > 100)) return res.status(400).json({ error: 'Weight must be 0–100.' })
  const entry = {
    id: crypto.randomUUID(),
    role, kpi,
    target: t, weight: w,
    effectiveFrom: String(effectiveFrom),
    setBy: req.user.username,
    setAt: new Date().toISOString(),
  }
  const all = db.read('kpi-targets', [])
  all.push(entry)
  db.write('kpi-targets', all)
  res.json({ entry })
})
app.delete('/api/kpi-targets/:id', auth, notViewAs, requireCeo, (req, res) => {
  const all = db.read('kpi-targets', [])
  const idx = all.findIndex((e) => e.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'not found' })
  all.splice(idx, 1)
  db.write('kpi-targets', all)
  res.json({ ok: true })
})
// Add a custom KPI to a role (Adama 3 Jul) — it joins the scorecard from its
// effective month with the weight given; the catalog KPIs rebalance around it.
app.post('/api/kpi-custom', auth, notViewAs, requireCeo, (req, res) => {
  const { role, label, kind, unit, target, weight, effectiveFrom } = req.body || {}
  if (!KPI_CATALOG[role]) return res.status(400).json({ error: 'unknown role' })
  const name = String(label || '').trim()
  if (!name) return res.status(400).json({ error: 'Give the KPI a name.' })
  if (!['count', 'percent'].includes(kind)) return res.status(400).json({ error: 'kind must be count or percent' })
  if (!/^\d{4}-\d{2}$/.test(String(effectiveFrom || ''))) return res.status(400).json({ error: 'effectiveFrom must be YYYY-MM' })
  if (String(effectiveFrom) < todayKey().slice(0, 7)) return res.status(400).json({ error: 'The effective month is in the past.' })
  const t = Number(target)
  const w = Number(weight)
  if (!Number.isFinite(t) || t < 0) return res.status(400).json({ error: 'Target must be a number ≥ 0.' })
  if (!Number.isFinite(w) || w < 0 || w > 90) return res.status(400).json({ error: 'Weight must be 0–90 so the other KPIs keep room.' })
  const key = 'c-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const all = db.read('kpi-custom', [])
  if (all.some((c) => c.role === role && c.key === key) || KPI_CATALOG[role].kpis.some((k) => k.key === key)) {
    return res.status(409).json({ error: 'A KPI with this name already exists for the role.' })
  }
  const entry = {
    id: crypto.randomUUID(),
    role, key, label: name, kind,
    unit: String(unit || (kind === 'percent' ? '%' : '')).trim(),
    target: t, weight: w,
    effectiveFrom: String(effectiveFrom),
    addedBy: req.user.username,
    addedAt: new Date().toISOString(),
  }
  all.push(entry)
  db.write('kpi-custom', all)
  res.json({ entry })
})
// Remove a custom KPI (CEO). Its scheduled target/weight changes go with it.
app.delete('/api/kpi-custom/:id', auth, notViewAs, requireCeo, (req, res) => {
  const all = db.read('kpi-custom', [])
  const idx = all.findIndex((c) => c.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'not found' })
  const [removed] = all.splice(idx, 1)
  db.write('kpi-custom', all)
  db.write('kpi-targets', db.read('kpi-targets', []).filter((e) => !(e.role === removed.role && e.kpi === removed.key)))
  res.json({ ok: true })
})
// Admin reads the resolved targets here (shared key, no session) — how a goal
// set in Pulse ("retention 85% from August") shows up on admin's pages.
app.get('/api/integrations/kpi-targets', (req, res) => {
  const key = req.headers['x-pulse-key']
  if (!process.env.PULSE_SYNC_KEY || key !== process.env.PULSE_SYNC_KEY) return res.status(401).json({ error: 'bad key' })
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : todayKey().slice(0, 7)
  res.json({ month, roles: Object.keys(KPI_CATALOG).map((k) => ({ key: k, ...kpiPlanFor(k, month) })) })
})

function scorecardFor(u, salesActual) {
  const key = scorecardKey(u)
  const MONTH = todayKey().slice(0, 7)
  // Sales + CS numbers resolve through the KPI Targets store (CEO-set,
  // effective by month); the per-person sales target (u.target) still wins
  // for that one person when set.
  const N = (kpi, dflt) => kpiNumber(key, kpi, MONTH) || dflt
  if (key === 'sales') {
    const s = N('sales', { target: 5, weight: 40 }), o = N('online', { target: 75, weight: 20 })
    const r = N('retention', { target: 80, weight: 25 }), v = N('reviews', { target: 3, weight: 15 })
    return { role: 'Sales agent', kpis: overlayPlan([
      { key: 'sales', label: 'Tracker sales', kind: 'count', target: Number(u.target) || s.target, weight: s.weight, unit: 'sales', actual: salesActual ?? null },
      { key: 'online', label: 'Trackers online', kind: 'percent', target: o.target, weight: o.weight, unit: '%', actual: null },
      { key: 'retention', label: 'Customer retention', kind: 'percent', target: r.target, weight: r.weight, unit: '%', actual: null },
      { key: 'reviews', label: '5-star Google reviews', kind: 'count', target: v.target, weight: v.weight, unit: 'reviews', actual: null },
    ], 'sales', MONTH) }
  }
  if (key === 'customer-service') {
    const c = N('cases', { target: 85, weight: 40 }), i = N('install', { target: 95, weight: 35 }), st = N('stock', { target: 100, weight: 25 })
    return { role: 'Customer Service', kpis: overlayPlan([
      { key: 'cases', label: 'Case resolution', kind: 'percent', target: c.target, weight: c.weight, unit: '%', actual: null },
      { key: 'install', label: 'Installation within 3 days', kind: 'percent', target: i.target, weight: i.weight, unit: '%', actual: null },
      { key: 'stock', label: 'Stock accountability (trackers)', kind: 'percent', target: st.target, weight: st.weight, unit: '% verified', actual: null },
    ], 'customer-service', MONTH) }
  }
  // Team-lead member-card kept as-is (the canonical lead scorecard lives on
  // My Progress and resolves through the catalog's team-lead entry there).
  if (key === 'team-lead') return { role: 'Team Lead', kpis: [
    { key: 'team-target', label: 'Team hits its target', kind: 'percent', target: 100, weight: 45, unit: '% of team goal', actual: null },
    { key: 'team-active', label: 'Whole team contributing', kind: 'percent', target: 100, weight: 25, unit: '% on target', actual: null },
    { key: 'coaching', label: 'Coaching & check-ins', kind: 'percent', target: 100, weight: 20, unit: '% done', actual: null },
    { key: 'team-attendance', label: 'Team attendance', kind: 'percent', target: 95, weight: 10, unit: '%', actual: null },
  ] }
  return null
}
// Coaching cadence = every TWO WEEKS (Adama 1 Jul; was weekly, changed). A
// check-in (a 'coaching' or 'meeting' log, not a 'flag') keeps a member "current"
// for 14 days; after that the lead is due to check in again. Returns the last
// check-in, whether they're current, and when the next one is due.
const COACHING_INTERVAL_DAYS = 14
function coachingStatus(coachingAll, username) {
  let last = null
  for (const c of coachingAll) {
    if (c.targetUsername !== username) continue
    if ((c.type || 'coaching') === 'flag') continue // a flag isn't a check-in
    const d = c.datetime || c.createdAt
    if (d && (!last || d > last)) last = d
  }
  const lastMs = last ? new Date(last).getTime() : null
  const now = Date.now()
  const current = lastMs != null && (now - lastMs) <= COACHING_INTERVAL_DAYS * 86400000
  const nextDue = lastMs != null ? new Date(lastMs + COACHING_INTERVAL_DAYS * 86400000).toISOString() : null
  return { lastCoachedAt: last, coachingCurrent: current, nextCoachingDue: nextDue }
}

function teamMemberCard(u, ctx) {
  const att = ctx.attAll.find((a) => a.username === u.username && a.date === ctx.today) || null
  const leave = leaveOnDate(ctx.leaveAll, u.username, ctx.today)
  const person = team.find((t) => t.name === u.name) || null
  const profile = ctx.profiles[u.name] || {}
  const reviews = ctx.reviews[u.name] || []
  // Sales goal applies ONLY to the Sales department. Customer Service has its own
  // KPIs (cases/installation/stock) that come from the Admin feed — never a sales
  // goal. So a CS person never shows "X short of the sales goal".
  const salesRec = u.department === 'Sales' ? (ctx.sales[u.name] || null) : null
  const m = salesRec?.months?.[ctx.CUR]
  const sales = salesRec
    ? { actual: m && !m.pending ? (m.sales ?? null) : null, target: salesRec.monthlyTarget ?? null }
    : null
  const score = profile.performanceScore === '' || profile.performanceScore == null ? null : Number(profile.performanceScore)
  let status = 'not-in'
  if (leave) status = 'leave'
  else if (att?.checkIn && !att?.checkOut) status = att.late ? 'late' : 'working'
  else if (att?.checkOut) status = 'done'
  return {
    username: u.username, name: u.name, title: u.title, department: u.department,
    status,
    checkIn: att?.checkIn || null,
    late: !!att?.late,
    onOfficeNetwork: att?.onOfficeNetwork ?? null,
    leaveType: leave?.leaveType || null,
    sales,
    score,
    reviewThisMonth: reviews.some((r) => r.period === ctx.CUR),
    warnings: Array.isArray(profile.warnings) ? profile.warnings.length : 0,
    contractEnd: person?.contractEnd || u.contractEnd || null,
    ...coachingStatus(ctx.coaching, u.username),
  }
}

app.get('/api/team/overview', auth, (req, res) => {
  const lead = findUser(req.user.username)
  const members = teamMembersFor(lead)
  if (!members.length) return res.status(403).json({ error: 'not-a-team-lead' })
  const today = todayKey()
  const CUR = today.slice(0, 7)
  const ctx = {
    today, CUR,
    attAll: db.read('attendance', []),
    leaveAll: db.read('leave', []),
    profiles: db.read('profiles', {}),
    reviews: db.read('reviews', {}),
    sales: db.read('agent-sales', {}),
    coaching: db.read('coaching', []),
  }
  const cards = members.map((u) => teamMemberCard(u, ctx))

  const present = cards.filter((c) => ['working', 'late', 'done'].includes(c.status)).length
  const coachedCount = cards.filter((c) => c.coachingCurrent).length
  const late = cards.filter((c) => c.status === 'late').length
  const onLeave = cards.filter((c) => c.status === 'leave').length
  const notIn = cards.filter((c) => c.status === 'not-in').length

  const soon = []
  for (const c of cards) {
    if (!c.contractEnd) continue
    const days = Math.ceil((new Date(`${c.contractEnd}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
    if (days >= 0 && days <= 45) soon.push({ name: c.name, days })
  }
  const reviewsDue = cards.filter((c) => !c.reviewThisMonth).length
  const withGoal = cards.filter((c) => c.sales && c.sales.target)
  const goalsPct = withGoal.length
    ? Math.round(withGoal.reduce((s, c) => s + Math.min(1, (c.sales.actual || 0) / c.sales.target), 0) / withGoal.length * 100)
    : null

  // "Needs my attention" — real signals only
  const attention = []
  for (const c of cards) {
    if (c.status === 'late') attention.push({ type: 'late', name: c.name, message: `${c.name} checked in late today`, to: `/team-member/${c.username}` })
    if (c.sales && c.sales.target && (c.sales.actual ?? 0) < c.sales.target) {
      const short = c.sales.target - (c.sales.actual ?? 0)
      attention.push({ type: 'sales', name: c.name, message: `${c.name} is ${short} short of the sales goal (${c.sales.actual ?? 0}/${c.sales.target})`, to: `/team-member/${c.username}` })
    }
    if (c.warnings > 0) attention.push({ type: 'warning', name: c.name, message: `${c.name} has ${c.warnings} active warning${c.warnings === 1 ? '' : 's'}`, to: `/team-member/${c.username}` })
  }
  for (const s of soon) attention.push({ type: 'contract', name: s.name, message: `${s.name}'s contract ends in ${s.days} day${s.days === 1 ? '' : 's'}`, to: `/team-member/${members.find((m) => m.name === s.name)?.username || ''}` })
  for (const l of (ctx.leaveAll || [])) {
    if (l.status === 'pending' && members.some((m) => m.username === l.username)) {
      // Proper home is a scoped Team Requests page (not built yet); until then
      // open the member so the lead can see who it is.
      attention.push({ type: 'leave', name: l.name || l.username, message: `${l.name || l.username} has a pending ${l.leaveType || 'leave'} request`, to: `/team-member/${l.username}` })
    }
  }
  // Bi-weekly coaching KPI: flag every member whose check-in is due (none in the
  // last 14 days), with when the last one was.
  for (const c of cards) {
    if (c.coachingCurrent) continue
    const since = c.lastCoachedAt
      ? `last ${new Date(c.lastCoachedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      : 'never checked in'
    attention.push({ type: 'coaching', name: c.name, message: `Check-in with ${c.name} is due (${since})`, to: `/team-member/${c.username}` })
  }

  res.json({
    lead: { name: lead.name, title: lead.title },
    today,
    stats: { total: cards.length, present, late, notIn, onLeave, reviewsDue, contractsEndingSoon: soon.length, goalsPct, coachedThisPeriod: coachedCount, coachingIntervalDays: COACHING_INTERVAL_DAYS },
    attention,
    members: cards,
  })
})

// A single team member's detail for the lead: KPI scorecard (so they know WHAT
// to coach on), attendance/sales snapshot, and full coaching history. Uses the
// viewed user (works under view-as for reads). 403 if not the lead's member.
app.get('/api/team/member/:username', auth, (req, res) => {
  const lead = findUser(req.user.username)
  const member = teamMembersFor(lead).find((m) => m.username === String(req.params.username).toLowerCase())
  if (!member) return res.status(403).json({ error: 'not-your-team-member' })
  const CUR = todayKey().slice(0, 7)
  const salesRec = member.department === 'Sales' ? (db.read('agent-sales', {})[member.name] || null) : null
  const mm = salesRec?.months?.[CUR]
  const salesActual = mm && !mm.pending ? (mm.sales ?? null) : null
  const profile = (db.read('profiles', {}))[member.name] || {}
  const coachingAll = db.read('coaching', [])
  const history = coachingAll
    .filter((c) => c.targetUsername === member.username)
    .sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
  const person = team.find((t) => t.name === member.name) || null
  res.json({
    username: member.username,
    name: member.name,
    title: member.title,
    department: member.department,
    contractEnd: person?.contractEnd || null,
    score: profile.performanceScore === '' || profile.performanceScore == null ? null : Number(profile.performanceScore),
    scorecard: scorecardFor(member, salesActual),
    ...coachingStatus(coachingAll, member.username),
    coachingIntervalDays: COACHING_INTERVAL_DAYS,
    coaching: history,
  })
})

// ---------- schedules (per-person weekly roster) ----------
// Mon–Fri 9–5 is the default for anyone without a saved override (Blue Book normal week).
const DEFAULT_WEEK = {
  1: { start: '09:00', end: '17:00' },
  2: { start: '09:00', end: '17:00' },
  3: { start: '09:00', end: '17:00' },
  4: { start: '09:00', end: '17:00' },
  5: { start: '09:00', end: '17:00' },
  6: null,
  0: null,
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// Effective-dated schedules (Adama 28 Jun): a person's schedule is a LIST of
// dated entries [{ from:'YYYY-MM-DD', days:{week} }], and the one in force on a
// given date is the latest entry whose `from` <= that date. Backward compatible:
// a legacy single-week object is treated as one entry effective forever, so no
// migration of existing schedules.json is needed.
function scheduleEntries(stored) {
  if (Array.isArray(stored)) return stored.filter((e) => e && e.from && e.days).slice().sort((a, b) => (a.from < b.from ? -1 : 1))
  if (stored && typeof stored === 'object') return [{ from: '2000-01-01', days: stored }]
  return []
}
function effectiveWeek(stored, dateKey) {
  let chosen = null
  for (const e of scheduleEntries(stored)) { if (e.from <= dateKey) chosen = e; else break }
  return chosen ? chosen.days : DEFAULT_WEEK
}

// Monday (UTC) of the week containing `ref`. Gambia is GMT so local date == UTC date.
function mondayKey(ref = new Date()) {
  const d = new Date(ref)
  const off = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - off)
  return d.toISOString().slice(0, 10)
}
function weekKeys(startYmd) {
  const base = new Date(`${startYmd}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(base)
    x.setUTCDate(base.getUTCDate() + i)
    return x.toISOString().slice(0, 10)
  })
}

// manager: whole-team week — each person's presence + their weekly schedule
function shiftHours(shift) {
  if (!shift) return 0
  const [sh, sm] = shift.start.split(':').map(Number)
  const [eh, em] = shift.end.split(':').map(Number)
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60)
}

// weekly shift roster — each person's shift (times) + status per day + week hours.
// manager → whole roster; staff → self only.
app.get('/api/attendance/week', auth, (req, res) => {
  const wkStart = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : mondayKey()
  const days = weekKeys(wkStart)
  const todayK = todayKey()
  const attAll = db.read('attendance', [])
  const leaveAll = db.read('leave', [])
  const schedules = db.read('schedules', {})
  // Scopes: ?scope=self → just your own week (My Hours — personal even for
  // team leads, Adama 6 Jul); ?scope=team → a lead's own team; otherwise the
  // Team-power roster (manager Attendance page) or self as the fallback.
  const teamSet = req.query.scope === 'team' ? teamUsernameSet(req.user.username) : null
  const roster = req.query.scope === 'self'
    ? seedUsers().filter((u) => u.username === req.user.username)
    : teamSet && teamSet.size
      ? seedUsers().filter((u) => teamSet.has(u.username))
      : can(req.user, 'team')
        ? scheduleRoster(req)
        : seedUsers().filter((u) => u.username === req.user.username)

  const people = roster.map((u) => {
    const stored = schedules[u.username]
    const byDate = {}
    let weekHours = 0
    for (const k of days) {
      const week = effectiveWeek(stored, k)
      const shift = k < ATTENDANCE_START ? null : (week[dowOfKey(k)] || null)
      const attendance = attAll.find((a) => a.username === u.username && a.date === k) || null
      const leave = leaveOnDate(leaveAll, u.username, k)
      if (shift && !leave) weekHours += shiftHours(shift)
      byDate[k] = {
        status: dayStatus({ schedule: week, attendance, leave }, k, todayK),
        shift,
        checkIn: attendance?.checkIn || null,
        checkOut: attendance?.checkOut || null,
        late: !!attendance?.late,
        onOfficeNetwork: attendance?.onOfficeNetwork ?? null,
        leaveType: leave?.leaveType || null,
        note: leave?.note || '',
        fixedBy: attendance?.fixedByName || attendance?.fixedBy || null,
        fixReason: attendance?.fixReason || null,
      }
    }
    // `schedule` = the week in force TODAY (for the editor's current-schedule
    // display); `upcoming` = the next future-dated change, if any (timeline).
    const upcomingEntry = scheduleEntries(stored).find((e) => e.from > todayK) || null
    return {
      username: u.username, name: u.name, department: u.department,
      schedule: effectiveWeek(stored, todayK), weekHours, byDate,
      upcoming: upcomingEntry ? { from: upcomingEntry.from, days: upcomingEntry.days } : null,
    }
  })
  res.json({ start: wkStart, days, today: todayK, people })
})

function cleanWeek(incoming = {}) {
  const clean = {}
  for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
    const v = incoming[dow]
    clean[dow] = v && HHMM.test(v.start || '') && HHMM.test(v.end || '') ? { start: v.start, end: v.end } : null
  }
  return clean
}
function scheduleRoster(req) {
  // the people the VIEWED user's Team power covers (named sub-toggles);
  // the CEO is never in anyone's roster.
  const scope = powerScopeSet(req.user, 'team')
  return seedUsers().filter((u) => scope.has(u.username))
}

// manager: assign a schedule to people, effective from a date.
// body: { schedules: { username: { from:'YYYY-MM-DD', days: { dow:{start,end}|null } } } }
// Upserts a dated entry per person (replacing any entry with the same start
// date); earlier dates keep their existing schedule automatically.
app.put('/api/schedules', auth, requireSub('team', 'schedules'), notViewAs, (req, res) => {
  const incoming = req.body?.schedules || {}
  const allowed = new Set(scheduleRoster(req).map((u) => u.username))
  const all = db.read('schedules', {})
  let count = 0
  for (const [username, payload] of Object.entries(incoming)) {
    if (!allowed.has(username)) continue
    const from = /^\d{4}-\d{2}-\d{2}$/.test(payload?.from) ? payload.from : todayKey()
    const days = cleanWeek(payload?.days || payload)
    const entries = scheduleEntries(all[username]).filter((e) => e.from !== from)
    entries.push({ from, days })
    entries.sort((a, b) => (a.from < b.from ? -1 : 1))
    all[username] = entries
    count++
  }
  db.write('schedules', all)
  res.json({ count })
})

// MY TEAM: a team lead assigns schedules to their OWN team members, without
// the company-wide Team power (same lead lane as /api/team/leave). Targets
// outside the lead's team are silently skipped, like the manager route above.
app.put('/api/team/schedules', auth, notViewAs, (req, res) => {
  const teamSet = teamUsernameSet(req.user.username)
  if (teamSet.size === 0) return res.status(403).json({ error: 'not-a-team-lead' })
  const incoming = req.body?.schedules || {}
  const all = db.read('schedules', {})
  let count = 0
  for (const [username, payload] of Object.entries(incoming)) {
    if (!teamSet.has(username)) continue
    const from = /^\d{4}-\d{2}-\d{2}$/.test(payload?.from) ? payload.from : todayKey()
    const days = cleanWeek(payload?.days || payload)
    const entries = scheduleEntries(all[username]).filter((e) => e.from !== from)
    entries.push({ from, days })
    entries.sort((a, b) => (a.from < b.from ? -1 : 1))
    all[username] = entries
    count++
  }
  db.write('schedules', all)
  res.json({ count })
})

// manager: set one person's weekly roster (in/off + hours per weekday)
app.put('/api/schedules/:username', auth, requireSub('team', 'schedules'), notViewAs, (req, res) => {
  const target = findUser(req.params.username)
  if (!target) return res.status(404).json({ error: 'No such user' })
  const schedule = cleanWeek(req.body?.days)
  const all = db.read('schedules', {})
  all[target.username] = schedule
  db.write('schedules', all)
  res.json({ username: target.username, schedule })
})

// ---------- Reports (Adama 3 Jul) ----------
// The month's story: who came to work (and who didn't, with the exact days),
// coaching word-for-word, who's doing what (sales/review/warnings), leave and
// payroll cost. Sections compose from the VIEWED user's powers + named scopes.
app.get('/api/reports/month', auth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayKey().slice(0, 7)
  const days = monthKeys(month)
  const todayK = todayKey()
  const u = req.user
  const out = { month }
  const nameOf = (un) => seedUsers().find((x) => x.username === un)?.name || un

  // WHO CAME TO WORK — Team power, named scope
  if (can(u, 'team')) {
    const scope = powerScopeSet(u, 'team')
    const attAll = db.read('attendance', [])
    const leaveAll = db.read('leave', [])
    const schedules = db.read('schedules', {})
    out.attendance = seedUsers().filter((x) => scope.has(x.username)).map((p) => {
      const stored = schedules[p.username]
      let scheduled = 0, worked = 0, late = 0, onLeave = 0
      const absentDays = []
      for (const k of days) {
        if (k > todayK) break
        if (k < ATTENDANCE_START) continue // pre-restart days don't count
        const shift = effectiveWeek(stored, k)[dowOfKey(k)]
        if (!shift) continue
        if (leaveOnDate(leaveAll, p.username, k)) { onLeave++; continue }
        scheduled++
        const a = attAll.find((r) => r.username === p.username && r.date === k)
        if (a?.checkIn) { worked++; if (a.late) late++ }
        else if (k < todayK) absentDays.push(k)
      }
      const pct = scheduled ? Math.round((worked / scheduled) * 100) : null
      return { username: p.username, name: p.name, department: p.department, scheduled, worked, late, onLeave, absent: absentDays.length, absentDays, pct }
    })
  }

  // COACHING — when and what was said (Team power, named scope; own included)
  if (can(u, 'team')) {
    const scope = powerScopeSet(u, 'team')
    out.coaching = db.read('coaching', [])
      .filter((c) => scope.has(c.targetUsername) && ((c.datetime || c.createdAt) || '').slice(0, 7) === month)
      .sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
      .map((c) => ({ date: ((c.datetime || c.createdAt) || '').slice(0, 10), person: nameOf(c.targetUsername), type: c.type, title: c.title, note: c.note, by: c.createdBy }))
  }

  // LEAVE — Approvals power, named scope
  if (can(u, 'approvals')) {
    const SICK_ALLOWANCE = 5 // Blue Book: 5 paid sick days/yr (same as /api/leave/mine)
    const scope = powerScopeSet(u, 'approvals')
    const leaveAll = db.read('leave', []).filter((l) => l.status === 'approved')
    out.leave = seedUsers().filter((x) => scope.has(x.username)).map((p) => {
      const mine = leaveAll.filter((l) => l.username === p.username)
      const inMonth = mine.filter((l) => (l.from || '').slice(0, 7) <= month && (l.to || '').slice(0, 7) >= month)
      const byType = {}
      for (const l of inMonth) byType[l.type || 'Annual'] = (byType[l.type || 'Annual'] || 0) + daysBetween(l.from, l.to)
      const taken = Object.values(byType).reduce((s, n) => s + n, 0)
      const sickUsed = mine
        .filter((l) => (l.type || '') === 'Sick' && (l.from || '').slice(0, 4) === month.slice(0, 4))
        .reduce((s, l) => s + daysBetween(l.from, l.to), 0)
      const upcoming = mine.filter((l) => l.from > todayK).map((l) => ({ type: l.type, from: l.from, to: l.to }))
      return { username: p.username, name: p.name, taken, byType, sickUsed, sickAllowance: SICK_ALLOWANCE, upcoming }
    })
  }

  // WHO'S DOING WHAT — hr.performance, named scope: sales + review + coaching + warnings
  if (canSub(u, 'hr', 'performance')) {
    const names = hrNamesSet(u)
    const salesAll = db.read('agent-sales', {})
    const reviewsAll = db.read('reviews', {})
    const warnAll = db.read('warnings', [])
    const coach = db.read('coaching', [])
    out.performance = [...names].sort().map((name) => {
      const un = seedUsers().find((x) => x.name === name)?.username
      const m = salesAll[name]?.months?.[month]
      const rev = (Array.isArray(reviewsAll[name]) ? reviewsAll[name] : []).find((r) => r.period === month) || null
      const warns = (Array.isArray(warnAll) ? warnAll : []).filter((w) => w.agent === name)
      const coachingCount = coach.filter((c) => c.targetUsername === un && ((c.datetime || c.createdAt) || '').slice(0, 7) === month).length
      return {
        name,
        sales: m ? m.sales : null,
        revenue: m ? m.revenue : null,
        customers: m?.customers || [],
        reviewScore: rev?.score ?? null,
        reviewStatus: rev?.status || null,
        coachingCount,
        warnings: warns.map((w) => ({ type: w.type, reason: w.reason, date: w.date })),
      }
    })
  }

  // PAYROLL COST — Payroll power, named scope
  if (can(u, 'payroll')) {
    const scope = powerScopeSet(u, 'payroll')
    const scopeNames = new Set(seedUsers().filter((x) => scope.has(x.username)).map((x) => x.name))
    const rows = db.read('payroll', []).filter((r) => r.period === month && scopeNames.has(r.name))
    out.payroll = rows.map((r) => ({ name: r.name, base: Number(r.base) || 0, commission: Number(r.commission) || 0, total: Number(r.total) || 0 }))
  }

  res.json(out)
})

// ---------- leave ----------
function daysBetween(from, to) {
  const a = new Date(from)
  const b = new Date(to)
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

app.get('/api/leave/mine', auth, (req, res) => {
  const all = db.read('leave', [])
  const mine = all.filter((l) => l.username === req.user.username)
  const annualUsed = mine
    .filter((l) => l.status === 'approved' && (l.type || 'Annual') === 'Annual')
    .reduce((s, l) => s + daysBetween(l.from, l.to), 0)
  // Sick leave: 5 paid days/year (Adama 1 Jul), medical certificate required;
  // beyond 5 is unpaid unless Management approves. Counted per calendar year.
  const SICK_ALLOWANCE = 5
  const thisYear = new Date().getFullYear()
  const sickUsed = mine
    .filter((l) => l.status === 'approved' && (l.type || '') === 'Sick' && new Date(l.from).getFullYear() === thisYear)
    .reduce((s, l) => s + daysBetween(l.from, l.to), 0)
  const sickRemaining = Math.max(0, SICK_ALLOWANCE - sickUsed)
  // Blue Book: annual leave eligible only after 12 months of continuous service.
  // joined date comes from the static roster, or the staff member's own account (created staff)
  const roster = team.find((t) => t.name === req.user.name)
  const joinedStr = roster?.joined || req.user.joined || null
  const joined = joinedStr ? new Date(joinedStr) : null
  let annualEligible = true
  let eligibleFrom = null
  let monthsService = null
  if (joined && !isNaN(joined.getTime())) {
    const now = new Date()
    monthsService = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth()) - (now.getDate() < joined.getDate() ? 1 : 0)
    annualEligible = monthsService >= 12
    const ef = new Date(joined)
    ef.setMonth(ef.getMonth() + 12)
    eligibleFrom = ef.toISOString().slice(0, 10)
  }
  res.json({ requests: mine.map((r) => visibleLeave(r, req.user)), annualUsed, annualEligible, eligibleFrom, monthsService, sickAllowance: SICK_ALLOWANCE, sickUsed, sickRemaining })
})

app.post('/api/leave', auth, notViewAs, (req, res) => {
  const { type, from, to, reason } = req.body || {}
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' })
  const all = db.read('leave', [])
  const rec = {
    id: crypto.randomUUID(),
    username: req.user.username,
    name: req.user.name,
    department: req.user.department,
    type: type || 'Annual',
    from,
    to,
    days: daysBetween(from, to),
    reason: reason || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  all.push(rec)
  db.write('leave', all)
  res.json({ request: rec })
})

app.get('/api/leave', auth, requirePower('approvals'), (req, res) => {
  const all = db.read('leave', [])
  const status = req.query.status
  const scope = powerScopeSet(req.user, 'approvals')
  let list = all.filter((l) => scope.has(l.username))
  if (status) list = list.filter((l) => l.status === status)
  res.json({ requests: list.map((r) => visibleLeave(r, req.user)) })
})

// The CEO/owner is the only one who reads the private "why" note on a decision.
function isOwner(u) {
  return u?.username === 'adama'
}
// Hide the CEO-only "why" note from everyone except the owner.
function visibleLeave(rec, viewer) {
  if (isOwner(viewer)) return rec
  const { approverWhy, ...rest } = rec
  return rest
}

function decideLeave(status) {
  return (req, res) => {
    const all = db.read('leave', [])
    const rec = all.find((l) => l.id === req.params.id)
    if (!rec) return res.status(404).json({ error: 'not found' })
    if (!inScope(req.realUser, 'approvals', rec.username)) return res.status(403).json({ error: 'Not in your approval scope' })
    rec.status = status
    rec.decidedBy = req.user.name
    rec.decidedByUsername = req.user.username
    rec.decidedAt = new Date().toISOString()
    rec.decisionNote = String(req.body?.note || '').trim() // shown to the employee
    rec.approverWhy = String(req.body?.why || '').trim() // private — CEO only
    db.write('leave', all)
    res.json({ request: rec })
  }
}
app.post('/api/leave/:id/approve', auth, notViewAs, requireSub('approvals', 'decide'), decideLeave('approved'))
app.post('/api/leave/:id/reject', auth, notViewAs, requireSub('approvals', 'decide'), decideLeave('rejected'))

// ---------- MY TEAM · scoped leave requests (team leads) ----------
// A team lead sees and decides ONLY their own team's leave requests, without
// holding the company-wide 'approvals' power. Full-power approvers keep using
// /api/leave. Additive — the existing routes above are untouched.
app.get('/api/team/leave', auth, (req, res) => {
  const teamSet = teamUsernameSet(req.user.username)
  if (teamSet.size === 0) return res.status(403).json({ error: 'not-a-team-lead' })
  const all = db.read('leave', [])
  const status = req.query.status
  let list = all.filter((l) => teamSet.has(l.username))
  if (status) list = list.filter((l) => l.status === status)
  res.json({ requests: list.map((r) => visibleLeave(r, req.user)) })
})
app.post('/api/team/leave/:id/:action', auth, notViewAs, (req, res) => {
  const action = req.params.action
  if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'invalid action' })
  const teamSet = teamUsernameSet(req.user.username)
  const rec = db.read('leave', []).find((l) => l.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  if (!teamSet.has(rec.username)) return res.status(403).json({ error: 'not-your-team-member' })
  return decideLeave(action === 'approve' ? 'approved' : 'rejected')(req, res)
})

// MY TEAM · scoped reviews + warnings (read-only) for team leads. A lead sees
// their own team's locked reviews and warnings on record without the 'hr'
// power; issuing reviews/warnings stays with HR. Reviews/warnings are keyed by
// NAME, so we scope by the team members' names. Additive.
app.get('/api/team/reviews', auth, (req, res) => {
  const lead = findUser(req.user.username)
  const members = teamMembersFor(lead)
  if (!members.length) return res.status(403).json({ error: 'not-a-team-lead' })
  const names = new Set(members.map((m) => m.name))
  const allReviews = db.read('reviews', {})
  const reviews = {}
  for (const [name, list] of Object.entries(allReviews)) if (names.has(name)) reviews[name] = list
  const warnings = db.read('warnings', [])
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .filter((w) => names.has(w.agent))
  res.json({ reviews, warnings, members: members.map((m) => ({ username: m.username, name: m.name, role: m.title, department: m.department })) })
})

// ---------- monthly attendance calendar (schedule + attendance + leave, layered) ----------
function monthKeys(month) {
  // month = 'YYYY-MM' → every 'YYYY-MM-DD' in it
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based → last day of that month
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
function dowOfKey(key) {
  return new Date(`${key}T00:00:00Z`).getUTCDay()
}
// an approved leave record covering a date → { leaveType, note } or null
function leaveOnDate(leaveAll, username, dateKey) {
  const rec = leaveAll.find((l) => l.username === username && l.status === 'approved' && l.from <= dateKey && l.to >= dateKey)
  return rec ? { leaveType: rec.type || 'Annual', note: rec.reason || '' } : null
}
// layered status: leave > attendance > schedule > calendar position
function dayStatus({ schedule, attendance, leave }, dateKey, todayK) {
  if (dateKey < ATTENDANCE_START) return 'off' // before the clean restart — never absent
  if (leave) {
    const t = (leave.leaveType || '').toLowerCase()
    if (t === 'sick') return 'sick'
    if (t === 'off') return 'off' // excused off
    return 'leave'
  }
  if (attendance?.checkIn) return attendance.late ? 'late' : 'worked'
  if (!schedule[dowOfKey(dateKey)]) return 'off' // rest day per weekly schedule
  if (dateKey > todayK) return 'future'
  if (dateKey === todayK) return 'today'
  return 'absent'
}

// manager → whole roster; staff → self only (mirrors today/mine vs manager)
app.get('/api/attendance/month', auth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayKey().slice(0, 7)
  const days = monthKeys(month)
  const todayK = todayKey()
  const attAll = db.read('attendance', [])
  const leaveAll = db.read('leave', [])
  const schedules = db.read('schedules', {})
  const roster = can(req.user, 'team')
    ? scheduleRoster(req)
    : seedUsers().filter((u) => u.username === req.user.username)

  const people = roster.map((u) => {
    const schedule = schedules[u.username] || DEFAULT_WEEK
    const byDate = {}
    for (const k of days) {
      const attendance = attAll.find((a) => a.username === u.username && a.date === k) || null
      const leave = leaveOnDate(leaveAll, u.username, k)
      byDate[k] = {
        status: dayStatus({ schedule, attendance, leave }, k, todayK),
        checkIn: attendance?.checkIn || null,
        checkOut: attendance?.checkOut || null,
        late: !!attendance?.late,
        onOfficeNetwork: attendance?.onOfficeNetwork ?? null,
        leaveType: leave?.leaveType || null,
        note: leave?.note || '',
        fixedBy: attendance?.fixedByName || attendance?.fixedBy || null,
        fixReason: attendance?.fixReason || null,
      }
    }
    return { username: u.username, name: u.name, department: u.department, schedule, byDate }
  })
  res.json({ month, days, today: todayK, people })
})

// manager logs/overrides a single person-date from the calendar.
// The manager is authoritative: this replaces ANY attendance/calendar row for that
// person+date (including a real mistaken check-in). `worked` accepts optional
// checkIn/checkOut times ("HH:MM") to override the recorded clock times; `clear`
// removes everything for the date (undo).
app.put('/api/attendance/day', auth, requireSub('team', 'schedules'), notViewAs, (req, res) => {
  const { username, date, status, note, checkIn, checkOut } = req.body || {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Valid date required' })
  if (!['worked', 'off', 'sick', 'leave', 'clear'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  const target = scheduleRoster(req).find((u) => u.username === username)
  if (!target) return res.status(404).json({ error: 'No such staff member' })

  // Manager override wins: drop the calendar leave AND every attendance row for
  // this person+date (manual or a real check-in) so nothing stacks or duplicates.
  const leaveAll = db.read('leave', []).filter((l) => !(l.username === username && l.source === 'calendar' && l.from === date && l.to === date))
  const attAll = db.read('attendance', []).filter((a) => !(a.username === username && a.date === date))

  if (status === 'clear') {
    // undo — leave nothing for this date
  } else if (status === 'worked') {
    const sched = (db.read('schedules', {})[username] || DEFAULT_WEEK)[dowOfKey(date)] || { start: '09:00', end: '17:00' }
    const inHHMM = HHMM.test(checkIn || '') ? checkIn : sched.start
    const outHHMM = HHMM.test(checkOut || '') ? checkOut : sched.end
    const [ih, im] = inHHMM.split(':').map(Number)
    attAll.push({
      id: crypto.randomUUID(),
      username,
      name: target.name,
      date,
      checkIn: `${date}T${inHHMM}:00.000Z`,
      checkOut: `${date}T${outHHMM}:00.000Z`,
      late: ih > 9 || (ih === 9 && im > 0),
      manual: true,
    })
  } else {
    const typeMap = { sick: 'Sick', leave: 'Annual', off: 'Off' }
    const now = new Date().toISOString()
    leaveAll.push({
      id: crypto.randomUUID(),
      username,
      name: target.name,
      department: target.department,
      type: typeMap[status],
      from: date,
      to: date,
      days: 1,
      reason: note || '',
      status: 'approved',
      decidedBy: req.user.name,
      decidedAt: now,
      createdAt: now,
      source: 'calendar',
    })
  }
  db.write('leave', leaveAll)
  db.write('attendance', attAll)
  res.json({ ok: true })
})

// ---------- pay: payslips + benefits (self-read, manager-write) ----------
// roster record (with salary fields) for a username — manager use only.
function rosterFor(username) {
  const u = findUser(username)
  if (!u) return null
  const merged = [...team, ...createdStaffRoster()]
  return merged.find((p) => p.name === u.name) || null
}

const sum = (lines) => (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
function netOf(p) {
  return sum(p.earnings) - sum(p.deductions)
}

// One-time seed of benefit records we already know about (e.g. Kaddy's maternity
// exception). Only runs if the store is empty — never clobbers manager edits.
function seedBenefits() {
  if (db.read('benefits', null)) return
  db.write('benefits', [
    {
      id: crypto.randomUUID(),
      username: 'kaddy',
      name: 'Kaddy Bojang',
      title: 'Maternity leave (paid)',
      detail: '6 months fully paid at D6,000/month — approved exception to standard policy.',
      amount: 6000, // monthly pay during leave
      status: 'ended',
      from: '2025-11', to: '2026-05',
      note: 'Returned 4 May 2026.',
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    },
  ])
}
seedBenefits()

// benefits — staff see their own; managers may read anyone's (?username=)
app.get('/api/benefits', auth, (req, res) => {
  const who = req.query.username && inScope(req.user, 'payroll', req.query.username) ? req.query.username : req.user.username
  const list = db.read('benefits', []).filter((b) => b.username === who)
  res.json({ benefits: list })
})

app.post('/api/benefits', auth, requireSub('payroll', 'edit'), notViewAs, (req, res) => {
  const { username, title, detail, amount, status, from, to, note } = req.body || {}
  const target = rosterFor(username) || findUser(username)
  if (!target) return res.status(404).json({ error: 'No such staff member' })
  if (!inScope(req.realUser, 'payroll', username)) return res.status(403).json({ error: 'Not in your payroll scope' })
  if (!title) return res.status(400).json({ error: 'Title required' })
  const all = db.read('benefits', [])
  const rec = {
    id: crypto.randomUUID(),
    username,
    name: target.name,
    title,
    detail: detail || '',
    amount: Number(amount) || 0,
    status: ['upcoming', 'active', 'ended'].includes(status) ? status : 'upcoming',
    from: from || '', to: to || '',
    note: note || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.username,
  }
  all.push(rec)
  db.write('benefits', all)
  res.json({ benefit: rec })
})

app.delete('/api/benefits/:id', auth, requireSub('payroll', 'edit'), notViewAs, (req, res) => {
  db.write('benefits', db.read('benefits', []).filter((b) => b.id !== req.params.id))
  res.json({ ok: true })
})

// manager: roster for the payroll picker — username + salary fields, active staff only
app.get('/api/payroll/people', auth, requirePower('payroll'), (req, res) => {
  const archived = archivedNameSet()
  const merged = [...team, ...createdStaffRoster()].filter((p) => !archived.has(p.name))
  const people = merged.map((p) => {
    const u = seedUsers().find((x) => x.name === p.name)
    return {
      username: u?.username || null,
      name: p.name,
      title: p.role || u?.title || '',
      department: p.type || u?.department || '',
      base: Number(p.base) || 0,
      commission: Number(p.commission) || 0,
      transport: Number(p.transport) || 0,
      total: Number(p.total) || 0,
    }
  }).filter((p) => p.username)
  const scope = powerScopeSet(req.user, 'payroll')
  res.json({ people: people.filter((p) => scope.has(p.username)) })
})

// payslips — staff see their own; managers may read anyone's (?username=).
// Months with a recorded payroll payment are DERIVED live from the payroll
// record — never a synced copy (Adama 8 Jul: "the codes should always reflect
// what i have done, not me telling you"). Pay, edit, backdate or undo in Run
// Payroll and this page reflects it on the next load, by construction.
// Hand-written payslips only fill months that have no payroll record.
app.get('/api/payslips', auth, (req, res) => {
  const who = req.query.username && inScope(req.user, 'payroll', req.query.username) ? req.query.username : req.user.username
  const person = findUser(who)
  const manual = db.read('payslips', []).filter((p) => p.username === who)
  const fromPayroll = person
    ? db.read('payroll', []).filter((r) => r.name === person.name).map((r) => {
        // A labelled payment (training pay, transport allowance, …) is one
        // named line; a plain salary keeps the base + bonus split.
        const earnings = r.label
          ? [{ label: r.label, amount: (Number(r.salary) || 0) + (Number(r.bonus) || 0) }]
          : [
              { label: 'Base salary', amount: Number(r.salary) || 0 },
              ...(Number(r.bonus) > 0 ? [{ label: 'Bonus / commission', amount: Number(r.bonus) }] : []),
            ]
        return {
          id: `pay-${r.id}`,
          username: who,
          period: r.period,
          earnings,
          deductions: manual.find((p) => p.period === r.period)?.deductions || [],
          note: `Paid${r.date ? ' ' + r.date : ''}${r.paySource ? ' via ' + r.paySource : ''}`,
          source: 'payroll',
        }
      })
    : []
  const paidPeriods = new Set(fromPayroll.map((p) => p.period))
  const list = [...fromPayroll, ...manual.filter((p) => !paidPeriods.has(p.period))]
    .map((p) => ({ ...p, net: netOf(p) }))
    .sort((a, b) => (a.period < b.period ? 1 : -1))
  res.json({ payslips: list })
})

// manager: auto-draft a payslip from the roster salary (not saved — just a starting point)
app.get('/api/payslips/draft', auth, requirePower('payroll'), (req, res) => {
  const { username, period } = req.query
  const r = rosterFor(username)
  if (!r) return res.status(404).json({ error: 'No salary on file for this person' })
  const earnings = [{ label: 'Base salary', amount: Number(r.base) || 0 }]
  if (Number(r.commission) > 0) earnings.push({ label: 'Commission', amount: Number(r.commission) })
  if (Number(r.transport) > 0) earnings.push({ label: 'Transport allowance', amount: Number(r.transport) })
  res.json({ draft: { username, period: /^\d{4}-\d{2}$/.test(period || '') ? period : '', earnings, deductions: [] } })
})

app.post('/api/payslips', auth, requireSub('payroll', 'edit'), notViewAs, (req, res) => {
  const { username, period, earnings, deductions, note } = req.body || {}
  const target = rosterFor(username) || findUser(username)
  if (!target) return res.status(404).json({ error: 'No such staff member' })
  if (!inScope(req.realUser, 'payroll', username)) return res.status(403).json({ error: 'Not in your payroll scope' })
  if (!/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'Valid month required' })
  const clean = (lines) => (Array.isArray(lines) ? lines : [])
    .filter((l) => l && l.label && Number(l.amount) > 0)
    .map((l) => ({ label: String(l.label), amount: Number(l.amount) }))
  const all = db.read('payslips', [])
  // one payslip per person per month — replace if re-saved
  const next = all.filter((p) => !(p.username === username && p.period === period))
  const rec = {
    id: crypto.randomUUID(),
    username,
    name: target.name,
    period,
    earnings: clean(earnings),
    deductions: clean(deductions),
    note: note || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.username,
  }
  next.push(rec)
  db.write('payslips', next)
  res.json({ payslip: { ...rec, net: netOf(rec) } })
})

app.delete('/api/payslips/:id', auth, requireSub('payroll', 'edit'), notViewAs, (req, res) => {
  db.write('payslips', db.read('payslips', []).filter((p) => p.id !== req.params.id))
  res.json({ ok: true })
})

// Payroll history — per-person, per-month, pulled LIVE from Zoho Books
// (the "Salaries and Employee Wages" account). OWNER/CEO ONLY: this exposes
// every staff member's pay, so it's gated to the CEO, not the payroll power.
// Cached in memory (1h) so we don't hit Zoho on every page load; ?refresh=1
// forces a fresh pull.
let _payrollCache = null // { at, data }
const _runReconciledAt = {} // period -> when /payroll/run last verified that month against Zoho
const PAYROLL_TTL = 60 * 60 * 1000
app.get('/api/payroll/history', auth, async (req, res) => {
  if (req.realUser.username !== CEO) return res.status(403).json({ error: 'forbidden' })
  if (!zohoConfigured()) return res.status(503).json({ error: 'Zoho Books is not configured on this server' })
  const fresh = req.query.refresh === '1'
  if (!fresh && _payrollCache && Date.now() - _payrollCache.at < PAYROLL_TTL) {
    return res.json({ ...(_payrollCache.data), cached: true })
  }
  try {
    const data = await buildPayrollHistory({ from: '2025-01-01' })
    _payrollCache = { at: Date.now(), data }
    res.json({ ...data, cached: false })
  } catch (err) {
    // On failure keep serving the last good pull if we have one.
    if (_payrollCache) return res.json({ ...(_payrollCache.data), cached: true, stale: true, error: err.message })
    res.status(502).json({ error: 'Could not reach Zoho Books: ' + err.message })
  }
})

// ---------- payroll RUN (owner-only writes to Zoho Books) ----------
// Owner-only gate, reused by every endpoint below.
function requireOwner(req, res, next) {
  if (req.realUser.username !== CEO) return res.status(403).json({ error: 'forbidden' })
  next()
}

// Pay-source picker options (Wave / Access Bank / Cash …).
app.get('/api/payroll/paysources', auth, requireOwner, (req, res) => {
  res.json({ paySources: paySources().map((s) => ({ key: s.key, label: s.label })) })
})

// Which month someone joined ('YYYY-MM'), from the roster's mixed date
// formats ('2026-04-01', 'Jun 2026', 'Oct 2025'). Null = unknown, keep them.
function joinedYM(p) {
  const j = String(p.joined || '')
  if (/^\d{4}-\d{2}/.test(j)) return j.slice(0, 7)
  const d = new Date(j)
  return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// The roster to run for a month + what's already been paid (local record).
// `?period=YYYY-MM` (defaults to the current month). Suggested salary/bonus
// pre-fill from the roster; the owner edits them before paying.
app.get('/api/payroll/run', auth, requireOwner, async (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : new Date().toISOString().slice(0, 7)
  const archived = archivedNameSet()
  // Only people who had ALREADY joined by this month — Momodou joined in June,
  // so he doesn't belong on March's run (Adama 9 Jul: "misleading"). Anyone
  // with an actual payment recorded for the month stays visible regardless
  // (Sally's March training allowance predates her April joining).
  let paidRecords = db.read('payroll', []).filter((r) => r.period === period)
  const paidNames = new Set(paidRecords.map((r) => r.name))
  const merged = [...team, ...createdStaffRoster()].filter((p) => !archived.has(p.name) && (paidNames.has(p.name) || joinedYM(p) === null || joinedYM(p) <= period))
  // Reconcile each recorded payment against Books (Books is the truth): if the
  // expense was deleted in Zoho, drop the local record; if its total changed,
  // sync ours + flag it. Keeps the "Paid" badge honest no matter where edited.
  // Checks run in PARALLEL and at most once per period per 5 minutes — the old
  // one-at-a-time loop on every load made month switching crawl (Adama 8 Jul).
  const fresh = Date.now() - (_runReconciledAt[period] || 0) < 5 * 60 * 1000
  if (zohoConfigured() && !fresh) {
    if (paidRecords.length) {
      const checks = await Promise.all(paidRecords.filter((r) => r.expenseId).map((r) =>
        getExpense(r.expenseId).then((exp) => ({ r, exp })).catch(() => null) // null = transient hiccup, leave as-is
      ))
      const all = db.read('payroll', [])
      let changed = false
      for (const c of checks) {
        if (!c) continue
        const { r, exp } = c
        if (!exp) { // deleted in Zoho
          const i = all.findIndex((x) => x.id === r.id)
          if (i >= 0) { all.splice(i, 1); changed = true; r._deleted = true }
        } else if (Math.round(exp.total) !== Math.round(r.total)) {
          r.total = Math.round(exp.total); r.editedInZoho = true
          const i = all.findIndex((x) => x.id === r.id)
          if (i >= 0) { all[i] = { ...all[i], total: r.total, editedInZoho: true }; changed = true }
        }
      }
      if (changed) { db.write('payroll', all); _payrollCache = null }
      paidRecords = paidRecords.filter((r) => !r._deleted)
    }
    // AUTO-ADOPT (Adama 9 Jul: "you know what we have paid — why leave it Mark
    // paid" / "past staff are not on the previous payroll but you have this
    // information"): ONE query pulls every Salaries expense in the month from
    // Books; each unclaimed expense becomes an adopted record — matched to a
    // roster or past-staff name when possible, otherwise shown under the
    // vendor's name. Months paid straight into Zoho load fully, past staff
    // included, without any clicking.
    try {
      const monthExpenses = await salaryExpensesForMonth(period)
      const claimed = new Set(paidRecords.map((r) => String(r.expenseId)))
      const unclaimed = monthExpenses.filter((e) => !claimed.has(String(e.expense_id)))
      if (unclaimed.length) {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const knownNames = [...new Set([...merged.map((p) => p.name), ...pastStaff.map((p) => p.name)])]
        const matchName = (vendorName) => {
          const v = norm(vendorName)
          return knownNames.find((n) => norm(n) === v) || knownNames.find((n) => norm(n).includes(v) || v.includes(norm(n))) || vendorName
        }
        const all = db.read('payroll', [])
        for (const exp of unclaimed) {
          const rec = {
            id: crypto.randomUUID(),
            period,
            name: matchName(exp.vendor_name),
            salary: Math.round(Number(exp.total) || 0), // Books holds one total; fix the split in Edit if needed
            bonus: 0,
            total: Math.round(Number(exp.total) || 0),
            paySource: null,
            paySourceKey: null,
            date: exp.date,
            expenseId: exp.expense_id,
            vendorId: exp.vendor_id,
            adopted: true,
            postedBy: 'books-sync',
            postedAt: new Date().toISOString(),
          }
          all.push(rec)
          paidRecords.push(rec)
        }
        db.write('payroll', all)
        _payrollCache = null
      }
    } catch { /* Books unreachable — show what we have locally */ }
    _runReconciledAt[period] = Date.now()
  }
  const paidByName = {}
  paidRecords.forEach((r) => { paidByName[r.name] = r })
  // de-dupe roster by name (createdStaffRoster may overlap team)
  const seen = new Set()
  const people = merged.filter((p) => (seen.has(p.name) ? false : seen.add(p.name))).map((p) => ({
    name: p.name,
    role: p.role || '',
    suggestedSalary: Number(p.base) || 0,
    suggestedBonus: Number(p.commission) || 0,
    paid: paidByName[p.name] || null,
  }))
  // Payments to people no longer on the roster (past staff, pre-Pulse hires)
  // still belong to the month's story — read-only paid rows after the roster.
  const rosterNames = new Set(people.map((p) => p.name))
  for (const r of paidRecords) {
    if (rosterNames.has(r.name)) continue
    rosterNames.add(r.name)
    const past = pastStaff.find((p) => p.name === r.name)
    people.push({ name: r.name, role: past?.role || 'Past staff', suggestedSalary: 0, suggestedBonus: 0, paid: r, past: true })
  }
  res.json({ period, people, paySources: paySources().map((s) => ({ key: s.key, label: s.label })) })
})

// Resolve which Zoho vendor a name maps to (for the confirm step) — read only.
app.get('/api/payroll/resolve-vendor', auth, requireOwner, async (req, res) => {
  if (!zohoConfigured()) return res.status(503).json({ error: 'Zoho Books is not configured' })
  try { res.json(await resolveVendor(req.query.name || '')) }
  catch (err) { res.status(502).json({ error: err.message }) }
})

// Record a payment. dryRun=1 returns the exact Books payload WITHOUT writing.
// On a real run it posts one Salaries expense and stores a local record.
app.post('/api/payroll/pay', auth, requireOwner, notViewAs, async (req, res) => {
  if (!zohoConfigured()) return res.status(503).json({ error: 'Zoho Books is not configured' })
  const { name, salary, bonus, paySourceKey, date, period, force } = req.body || {}
  // Optional label — what this payment IS when it isn't a plain salary
  // (Adama 8 Jul: Sally's D2,000 transport allowance in training, Momodou's
  // D6,000 training pay). Flows to the Books description and the payslip line.
  const label = String(req.body?.label || '').trim().slice(0, 120)
  if (!name) return res.status(400).json({ error: 'name required' })
  const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true
  try {
    const result = await recordSalaryPayment({ name, salary, bonus, paySourceKey, date, period, label, force: !!force, dryRun })
    // duplicate / no_vendor are business outcomes (not HTTP errors) — return 200
    // with ok:false so the UI can show them without the fetch helper throwing.
    if (!result.ok) return res.json(result)
    if (!dryRun) {
      // Persist what we paid so the run shows status without re-hitting Books.
      const all = db.read('payroll', [])
      const ym = (period && /^\d{4}-\d{2}$/.test(period)) ? period : String(date).slice(0, 7)
      const rec = {
        id: crypto.randomUUID(),
        period: ym,
        name,
        salary: Math.round(Number(salary) || 0),
        bonus: Math.round(Number(bonus) || 0),
        total: result.total,
        paySource: result.paySource?.label || paySourceKey,
        paySourceKey,
        date,
        label: label || null,
        expenseId: result.expenseId || null,
        vendorId: result.vendor?.id || null,
        createdVendor: !!result.createdVendor,
        postedBy: req.user.username,
        postedAt: new Date().toISOString(),
      }
      // one record per person per month
      db.write('payroll', [...all.filter((r) => !(r.name === name && r.period === ym)), rec])
      // a fresh payment invalidates the cached history
      _payrollCache = null
      return res.json({ ...result, record: rec })
    }
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Edit a recorded payment — updates the Zoho expense + the local record.
app.put('/api/payroll/pay/:id', auth, requireOwner, notViewAs, async (req, res) => {
  if (!zohoConfigured()) return res.status(503).json({ error: 'Zoho Books is not configured' })
  const all = db.read('payroll', [])
  const rec = all.find((r) => r.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'No such payment record' })
  if (!rec.expenseId) return res.status(409).json({ error: 'This record has no linked Zoho expense' })
  const { salary, bonus, paySourceKey, date } = req.body || {}
  const label = req.body?.label != null ? String(req.body.label).trim().slice(0, 120) : (rec.label || '')
  try {
    const upd = await updateSalaryExpense(rec.expenseId, {
      name: rec.name, vendorId: rec.vendorId,
      salary: Number(salary) || 0, bonus: Number(bonus) || 0,
      paySourceKey: paySourceKey || rec.paySourceKey, date: date || rec.date, period: rec.period, label,
    })
    const next = {
      ...rec,
      salary: Math.round(Number(salary) || 0), bonus: Math.round(Number(bonus) || 0), total: upd.total,
      paySource: upd.paySource?.label || rec.paySource, paySourceKey: paySourceKey || rec.paySourceKey,
      date: date || rec.date, label: label || null, editedInZoho: false, editedBy: req.user.username, editedAt: new Date().toISOString(),
    }
    db.write('payroll', all.map((r) => (r.id === rec.id ? next : r)))
    _payrollCache = null
    res.json({ ok: true, record: next })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Adopt a Salaries expense that already exists in Books (entered directly in
// Zoho, or pre-dating Pulse) as that month's payroll record — it then shows
// Paid here and can be edited / backdated like any Pulse payment (Adama 8 Jul:
// "april was pre-entered already, give me the option to edit / backdate it").
// Writes NOTHING to Zoho — it only links the existing expense.
app.post('/api/payroll/adopt', auth, requireOwner, notViewAs, async (req, res) => {
  if (!zohoConfigured()) return res.status(503).json({ error: 'Zoho Books is not configured' })
  const { name, period } = req.body || {}
  if (!name || !/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'name and period (YYYY-MM) required' })
  try {
    const { match: vendor } = await resolveVendor(name)
    if (!vendor) return res.status(404).json({ error: `No Zoho vendor found for ${name}` })
    const exp = await existingSalaryExpense(vendor.id, period)
    if (!exp) return res.status(404).json({ error: `No Salaries expense in Books for ${name} in ${period}` })
    const all = db.read('payroll', [])
    const rec = {
      id: crypto.randomUUID(),
      period,
      name,
      salary: Math.round(Number(exp.total) || 0), // Books holds one total; fix the split in Edit if needed
      bonus: 0,
      total: Math.round(Number(exp.total) || 0),
      paySource: null,
      paySourceKey: null,
      date: exp.date,
      expenseId: exp.expense_id,
      vendorId: vendor.id,
      adopted: true,
      postedBy: req.user.username,
      postedAt: new Date().toISOString(),
    }
    db.write('payroll', [...all.filter((r) => !(r.name === name && r.period === period)), rec])
    _payrollCache = null
    _runReconciledAt[period] = 0 // next run re-verifies this month against Books
    res.json({ ok: true, record: rec })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Undo a recorded payment — deletes the Zoho expense + removes the local record.
app.delete('/api/payroll/pay/:id', auth, requireOwner, notViewAs, async (req, res) => {
  if (!zohoConfigured()) return res.status(503).json({ error: 'Zoho Books is not configured' })
  const all = db.read('payroll', [])
  const rec = all.find((r) => r.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'No such payment record' })
  try {
    if (rec.expenseId) await deleteExpense(rec.expenseId)
    db.write('payroll', all.filter((r) => r.id !== rec.id))
    _payrollCache = null
    res.json({ ok: true })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ---------- sales: customers + activities (owner-scoped, customer-centric) ----------
function seedSales() {
  if (!db.read('customers', null)) {
    const customers = []
    const activities = []
    const now = new Date().toISOString()
    for (const c of sallyCustomers) {
      const { _activities = [], ...fields } = c
      const id = crypto.randomUUID()
      const cust = { id, owner: 'sally', createdAt: now, ...fields }
      if ('amountExpected' in cust || 'amountPaid' in cust) {
        cust.balance = (Number(cust.amountExpected) || 0) - (Number(cust.amountPaid) || 0)
      }
      customers.push(cust)
      for (const a of _activities) {
        activities.push({ id: crypto.randomUUID(), owner: 'sally', customerId: id, date: '', createdAt: now, ...a })
      }
    }
    db.write('customers', customers)
    db.write('activities', activities)
  }
  if (!db.read('history', null)) {
    db.write('history', sallyMonthlyHistory.map((h) => ({ id: crypto.randomUUID(), owner: 'sally', ...h })))
  }
}

const CUSTOMER_FIELDS = ['company', 'segment', 'contact', 'role', 'email', 'phone', 'whatsapp', 'vehicles', 'vehicleType', 'status', 'nextAction', 'followUpDate', 'amountExpected', 'amountPaid']
const DAILY_FIELDS = ['date', 'callsMade', 'leadsGenerated', 'salesMade', 'amount', 'note']
const ACTIVITY_FIELDS = ['customerId', 'type', 'date', 'callStatus', 'note', 'nextAction', 'from', 'to', 'cost', 'outcome']

const NUMERIC = new Set(['amountExpected', 'amountPaid', 'callsMade', 'leadsGenerated', 'salesMade', 'amount', 'cost'])

function pick(body, fields) {
  const out = {}
  for (const f of fields) if (body[f] !== undefined) out[f] = NUMERIC.has(f) ? Number(body[f] || 0) : body[f]
  if ('amountExpected' in out || 'amountPaid' in out) {
    out.balance = (Number(out.amountExpected) || 0) - (Number(out.amountPaid) || 0)
  }
  return out
}

// customers: stamp wonAt when status becomes Won (drives target/commission)
function customerHook(rec) {
  if (rec.status === 'Won' && !rec.wonAt) rec.wonAt = new Date().toISOString()
  if (rec.status !== 'Won' && rec.wonAt) delete rec.wonAt
}

function makeCollection(name, fields, hook, opts = {}) {
  app.get(`/api/${name}`, auth, (req, res) => {
    res.json({ [name]: db.read(name, []).filter((r) => r.owner === req.user.username) })
  })
  app.post(`/api/${name}`, auth, notViewAs, (req, res) => {
    const all = db.read(name, [])
    const rec = {
      id: crypto.randomUUID(),
      owner: req.user.username,
      createdAt: new Date().toISOString(),
      ...pick(req.body || {}, fields),
    }
    if (hook) hook(rec)
    all.push(rec)
    db.write(name, all)
    res.json({ record: rec })
  })
  app.patch(`/api/${name}/:id`, auth, notViewAs, (req, res) => {
    const all = db.read(name, [])
    const rec = all.find((r) => r.id === req.params.id && r.owner === req.user.username)
    if (!rec) return res.status(404).json({ error: 'not found' })
    Object.assign(rec, pick(req.body || {}, fields))
    if (hook) hook(rec)
    db.write(name, all)
    res.json({ record: rec })
  })
  if (!opts.noDelete) {
    app.delete(`/api/${name}/:id`, auth, notViewAs, (req, res) => {
      const all = db.read(name, []).filter((r) => !(r.id === req.params.id && r.owner === req.user.username))
      db.write(name, all)
      res.json({ ok: true })
    })
  }
}
makeCollection('customers', CUSTOMER_FIELDS, customerHook, { noDelete: true }) // customers cannot be deleted
makeCollection('daily', DAILY_FIELDS)

// monthly sales history (seeded real results for past months; owner-scoped, read-only)
app.get('/api/sales-history', auth, (req, res) => {
  res.json({ history: db.read('history', []).filter((h) => h.owner === req.user.username) })
})

// activities live UNDER a customer (calls / visits / notes / status changes)
app.get('/api/activities', auth, (req, res) => {
  let all = db.read('activities', []).filter((a) => a.owner === req.user.username)
  if (req.query.customerId) all = all.filter((a) => a.customerId === req.query.customerId)
  all = all.slice().sort((a, b) => ((a.date || a.createdAt) < (b.date || b.createdAt) ? 1 : -1))
  res.json({ activities: all })
})
app.post('/api/activities', auth, notViewAs, (req, res) => {
  const all = db.read('activities', [])
  const rec = { id: crypto.randomUUID(), owner: req.user.username, createdAt: new Date().toISOString(), ...pick(req.body || {}, ACTIVITY_FIELDS) }
  all.push(rec)
  db.write('activities', all)
  res.json({ record: rec })
})
app.patch('/api/activities/:id', auth, notViewAs, (req, res) => {
  const all = db.read('activities', [])
  const rec = all.find((a) => a.id === req.params.id && a.owner === req.user.username)
  if (!rec) return res.status(404).json({ error: 'not found' })
  Object.assign(rec, pick(req.body || {}, ACTIVITY_FIELDS))
  db.write('activities', all)
  res.json({ record: rec })
})
app.delete('/api/activities/:id', auth, notViewAs, (req, res) => {
  db.write('activities', db.read('activities', []).filter((a) => !(a.id === req.params.id && a.owner === req.user.username)))
  res.json({ ok: true })
})

// ---------- announcements (global; managers post, everyone reads) ----------
app.get('/api/announcements', auth, (req, res) => {
  res.json({ announcements: db.read('announcements', []) })
})
app.post('/api/announcements', auth, notViewAs, requirePower('notices'), (req, res) => {
  const all = db.read('announcements', [])
  const { title, body, type } = req.body || {}
  const rec = {
    id: crypto.randomUUID(),
    title: title || 'Notice',
    body: body || '',
    type: type || 'General',
    author: req.user.name,
    createdAt: new Date().toISOString(),
  }
  all.unshift(rec)
  db.write('announcements', all)
  res.json({ record: rec })
})
app.delete('/api/announcements/:id', auth, notViewAs, requirePower('notices'), (req, res) => {
  db.write('announcements', db.read('announcements', []).filter((a) => a.id !== req.params.id))
  res.json({ ok: true })
})

// ---------- coaching / flags / meetings (manager -> staff) ----------
// type: 'coaching' | 'flag' | 'meeting'. Staff see their own; managers manage all.
app.get('/api/coaching', auth, (req, res) => {
  let all = db.read('coaching', [])
  if (can(req.user, 'team')) {
    const scope = powerScopeSet(req.user, 'team')
    all = all.filter((c) => scope.has(c.targetUsername) || c.targetUsername === req.user.username)
    if (req.query.user) all = all.filter((c) => c.targetUsername === req.query.user)
  } else {
    all = all.filter((c) => c.targetUsername === req.user.username)
  }
  all = all.slice().sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
  // Records store the username; pages (Reviews & Warnings) show the person's name.
  const users = seedUsers()
  all = all.map((c) => ({ ...c, targetName: users.find((x) => x.username === c.targetUsername)?.name || c.targetUsername }))
  res.json({ coaching: all })
})
// LOGGING: the Team power's "Coaching & flags" sub within your named scope, OR
// the target is on your OWN team (a lead's built-in right — coaching your team
// is the job). CHANGING HISTORY is different: edit and delete are each their
// OWN sub-toggle — no built-in bypass, grantable independently (Adama 7 Jul:
// "i can give someone to delete and not edit"). CEO always can.
function canLogCoaching(realUser, targetUsername) {
  return (inScope(realUser, 'team', targetUsername) && canSub(realUser, 'team', 'coaching')) || teamMembersFor(realUser).some((m) => m.username === targetUsername)
}
function canEditCoaching(realUser, targetUsername) {
  return inScope(realUser, 'team', targetUsername) && canSub(realUser, 'team', 'coaching-edit')
}
function canDeleteCoaching(realUser, targetUsername) {
  return inScope(realUser, 'team', targetUsername) && canSub(realUser, 'team', 'coaching-delete')
}
app.post('/api/coaching', auth, notViewAs, (req, res) => {
  const { targetUsername, type, title, note, datetime } = req.body || {}
  if (!targetUsername) return res.status(400).json({ error: 'targetUsername required' })
  const allowed = canLogCoaching(req.realUser, targetUsername)
  if (!allowed) return res.status(403).json({ error: 'forbidden' })
  const all = db.read('coaching', [])
  const rec = {
    id: crypto.randomUUID(),
    targetUsername,
    type: type || 'coaching',
    title: title || '',
    note: note || '',
    datetime: datetime || '',
    createdBy: req.user.name,
    createdAt: new Date().toISOString(),
  }
  all.push(rec)
  db.write('coaching', all)
  res.json({ record: rec })
})
app.put('/api/coaching/:id', auth, notViewAs, (req, res) => {
  const all = db.read('coaching', [])
  const rec = all.find((c) => c.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not-found' })
  if (!canEditCoaching(req.realUser, rec.targetUsername)) return res.status(403).json({ error: 'forbidden' })
  const { type, title, note, datetime } = req.body || {}
  if (type != null) rec.type = type
  if (title != null) rec.title = title
  if (note != null) rec.note = note
  if (datetime != null) rec.datetime = datetime
  rec.editedBy = req.user.name
  rec.editedAt = new Date().toISOString()
  db.write('coaching', all)
  res.json({ record: rec })
})
app.delete('/api/coaching/:id', auth, notViewAs, (req, res) => {
  const all = db.read('coaching', [])
  const rec = all.find((c) => c.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not-found' })
  if (!canDeleteCoaching(req.realUser, rec.targetUsername)) return res.status(403).json({ error: 'forbidden' })
  db.write('coaching', all.filter((c) => c.id !== req.params.id))
  res.json({ ok: true })
})

// ---------- DEPARTMENTS ----------
// Marketing — built fresh in Pulse, its own store. Sections are simple arrays.
const MKT_SECTIONS = ['socialMedia', 'leadSources', 'contentCalendar', 'campaigns', 'collaborations', 'adSpend']
const MKT_DEFAULT = Object.fromEntries(MKT_SECTIONS.map((s) => [s, []]))

app.get('/api/marketing', auth, (req, res) => {
  res.json({ ...MKT_DEFAULT, ...db.read('marketing', {}) })
})
app.post('/api/marketing/:section', auth, requirePower('marketing'), notViewAs, (req, res) => {
  const { section } = req.params
  if (!MKT_SECTIONS.includes(section)) return res.status(400).json({ error: 'Unknown section' })
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const data = { ...MKT_DEFAULT, ...db.read('marketing', {}) }
  data[section] = items
  db.write('marketing', data)
  res.json({ [section]: items })
})

// ---------- HR & Team: KPI rules + warnings (migrated from Founder Hub) ----------
// KPI rules: global, manager-managed. Upsert by id.
app.get('/api/kpi-rules', auth, (req, res) => {
  res.json({ rules: db.read('kpi-rules', []) })
})
app.post('/api/kpi-rules', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const b = req.body || {}
  const rules = db.read('kpi-rules', [])
  const fields = {
    scope: b.scope === 'agent' ? 'agent' : 'role',
    role: b.role ?? null,
    agent: b.agent ?? null,
    period: b.period || 'default',
    personalTarget: b.personalTarget === '' || b.personalTarget == null ? null : Number(b.personalTarget),
    teamTarget: b.teamTarget === '' || b.teamTarget == null ? null : Number(b.teamTarget),
    unit: b.unit || '', // what the targets count (sales, installs, tickets, posts…) — role-neutral KPIs
    weeklyTarget: b.weeklyTarget || '',
    kpi: b.kpi || '',
    coreResponsibility: b.coreResponsibility || '',
    focus: b.focus || '',
    active: b.active !== false,
  }
  let rule
  if (b.id) {
    rule = rules.find((r) => r.id === b.id)
    if (!rule) return res.status(404).json({ error: 'not found' })
    Object.assign(rule, fields)
  } else {
    rule = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...fields }
    rules.push(rule)
  }
  db.write('kpi-rules', rules)
  res.json({ rule })
})
app.delete('/api/kpi-rules/:id', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const rules = db.read('kpi-rules', []).filter((r) => r.id !== req.params.id)
  db.write('kpi-rules', rules)
  res.json({ ok: true })
})

// ---------- Person profiles: feedback, decisions, warnings, files ----------
// Coaching notes (per agent).
app.get('/api/feedback', auth, (req, res) => {
  let notes = db.read('feedback', [])
  if (req.query.agent) notes = notes.filter((n) => n.agent === req.query.agent)
  notes = notes.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  res.json({ notes })
})
app.post('/api/feedback', auth, requirePower('sales'), notViewAs, (req, res) => {
  const { agent, text } = req.body || {}
  if (!agent || !text) return res.status(400).json({ error: 'agent and text required' })
  const notes = db.read('feedback', [])
  const note = { id: 'n_' + crypto.randomUUID(), agent, text, createdAt: new Date().toISOString(), createdBy: req.user.name || 'Manager' }
  notes.push(note)
  db.write('feedback', notes)
  res.json({ success: true, note })
})
app.delete('/api/feedback/:id', auth, requirePower('sales'), notViewAs, (req, res) => {
  db.write('feedback', db.read('feedback', []).filter((n) => n.id !== req.params.id))
  res.json({ success: true })
})

// Management decisions (per agent, log-style with current + history).
app.get('/api/decisions', auth, (req, res) => {
  const all = db.read('decisions', [])
  if (req.query.agent) {
    const forAgent = all.filter((d) => d.agent === req.query.agent).sort((a, b) => (b.setAt || '').localeCompare(a.setAt || ''))
    return res.json({ current: forAgent[0] || null, history: forAgent.slice(1) })
  }
  res.json({ decisions: all })
})
app.post('/api/decisions', auth, requirePower('sales'), notViewAs, (req, res) => {
  const { agent, decision, reason } = req.body || {}
  if (!agent || !decision) return res.status(400).json({ error: 'agent and decision required' })
  const all = db.read('decisions', [])
  const entry = { id: 'd_' + crypto.randomUUID(), agent, decision, reason: reason || '', setAt: new Date().toISOString(), setBy: req.user.name || 'Manager' }
  all.push(entry)
  db.write('decisions', all)
  res.json({ success: true, decision: entry })
})

// Warnings (per agent; HR view lists all).
app.get('/api/warnings', auth, (req, res) => {
  let all = db.read('warnings', []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  // HR-performance holders see their scoped people (+ themselves); others own only.
  const hrNames = canSub(req.user, 'hr', 'performance') ? hrNamesSet(req.user) : null
  all = all.filter((w) => (hrNames ? hrNames.has(w.agent) : false) || w.agent === req.user.name)
  if (req.query.agent) all = all.filter((w) => w.agent === req.query.agent)
  res.json({ warnings: all })
})
app.post('/api/warnings', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const { agent, type, reason, date } = req.body || {}
  if (!agent || !type) return res.status(400).json({ error: 'agent and type required' })
  if (!['verbal', 'formal', 'final'].includes(type)) return res.status(400).json({ error: 'type must be verbal/formal/final' })
  if (!hrNamesSet(req.realUser).has(agent)) return res.status(403).json({ error: 'Not in your HR scope' })
  const all = db.read('warnings', [])
  const entry = { id: 'w_' + crypto.randomUUID(), agent, type, reason: reason || '', date: date || new Date().toISOString().slice(0, 10), issuedBy: req.user.name || 'Manager', createdAt: new Date().toISOString() }
  all.push(entry)
  db.write('warnings', all)
  res.json({ success: true, warning: entry })
})
app.delete('/api/warnings/:id', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const before = db.read('warnings', [])
  const after = before.filter((w) => w.id !== req.params.id)
  if (after.length === before.length) return res.status(404).json({ error: 'not found' })
  db.write('warnings', after)
  res.json({ success: true })
})

// Agent files — uploaded docs stored on disk under data/agent-files/<slug>/.
const FILES_DIR = path.join(DATA_DIR, 'agent-files')
const fileSlug = (s) => (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
function ensureAgentDir(agent) {
  const dir = path.join(FILES_DIR, fileSlug(agent))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
app.get('/api/agent-files', auth, (req, res) => {
  let files = db.read('agent-files', [])
  const hrNames = canSub(req.user, 'hr', 'performance') ? hrNamesSet(req.user) : null
  files = files.filter((f) => (hrNames ? hrNames.has(f.agent) : false) || f.agent === req.user.name)
  if (req.query.agent) files = files.filter((f) => f.agent === req.query.agent)
  res.json({ files: files.slice().sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')) })
})

// Staff self-view ("My Reviews"): the signed-in person's OWN reviews, documents
// and coaching. Always scoped to req.user on the SERVER (never a client-supplied
// name) so a staff member can never read another person's file. Read-only —
// HR still authors everything from the staff profile. (Added 12 Jun 2026.)
app.get('/api/my/file', auth, (req, res) => {
  const myName = req.user.name
  const files = db.read('agent-files', []).filter((f) => f.agent === myName)
  const byNewest = (a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')
  const reviews = files.filter((f) => f.category === 'monthly-review').sort(byNewest)
  const documents = files.filter((f) => f.category !== 'monthly-review').sort(byNewest)
  const coaching = db.read('coaching', [])
    .filter((c) => c.targetUsername === req.user.username)
    .sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
  res.json({ reviews, documents, coaching })
})
app.post('/api/agent-files', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const { agent, name, mimeType, base64, category } = req.body || {}
  if (!agent || !name || !base64) return res.status(400).json({ error: 'agent, name, base64 required' })
  if (!hrNamesSet(req.realUser).has(agent)) return res.status(403).json({ error: 'Not in your HR scope' })
  const dir = ensureAgentDir(agent)
  const id = 'f_' + crypto.randomUUID()
  const cleanBase64 = base64.includes(',') ? base64.split(',').pop() : base64
  const buffer = Buffer.from(cleanBase64, 'base64')
  const ext = (name.split('.').pop() || 'bin').toLowerCase()
  const storedAs = `${id}.${ext}`
  fs.writeFileSync(path.join(dir, storedAs), buffer)
  const files = db.read('agent-files', [])
  const meta = { id, agent, name, category: category || 'general', mimeType: mimeType || 'application/octet-stream', sizeBytes: buffer.length, storedAs, uploadedAt: new Date().toISOString(), uploadedBy: req.user.name || 'Manager' }
  files.push(meta)
  db.write('agent-files', files)
  res.json({ success: true, file: meta })
})
app.post('/api/agent-files/generate-review', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const { agent, period, reviewText, category } = req.body || {}
  if (!agent || !period || !reviewText) return res.status(400).json({ error: 'agent, period, reviewText required' })
  const dir = ensureAgentDir(agent)
  const id = 'f_' + crypto.randomUUID()
  const storedAs = `${id}.md`
  fs.writeFileSync(path.join(dir, storedAs), reviewText)
  const files = db.read('agent-files', [])
  const meta = { id, agent, name: `Monthly Review - ${period.replace(/[^a-zA-Z0-9 -]/g, '')}.md`, category: category || 'monthly-review', mimeType: 'text/markdown', sizeBytes: Buffer.byteLength(reviewText, 'utf8'), storedAs, uploadedAt: new Date().toISOString(), uploadedBy: req.user.name || 'Manager', period }
  files.push(meta)
  db.write('agent-files', files)
  res.json({ success: true, file: meta })
})
// Download is reached via a plain <a> tag, so it carries the token as ?t= instead of a header.
app.get('/api/agent-files/:id/download', (req, res) => {
  const t = req.query.t || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const s = sessions[t]
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'unauthorized' })
  const meta = db.read('agent-files', []).find((f) => f.id === req.params.id)
  if (!meta) return res.status(404).json({ error: 'not found' })
  const filePath = path.join(FILES_DIR, fileSlug(meta.agent), meta.storedAs)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing' })
  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${meta.name.replace(/"/g, '')}"`)
  res.sendFile(filePath)
})
// Edit (rename / re-categorise) and delete are each their OWN sub-toggle
// (Adama 8 Jul) — grantable independently, both scoped to the holder's HR names.
app.put('/api/agent-files/:id', auth, requireSub('hr', 'files-edit'), notViewAs, (req, res) => {
  const files = db.read('agent-files', [])
  const meta = files.find((f) => f.id === req.params.id)
  if (!meta) return res.status(404).json({ error: 'not found' })
  if (!hrNamesSet(req.realUser).has(meta.agent)) return res.status(403).json({ error: 'Not in your HR scope' })
  const { name, category } = req.body || {}
  if (name != null && String(name).trim()) meta.name = String(name).trim().slice(0, 200)
  if (category != null) meta.category = category
  meta.editedBy = req.user.name
  meta.editedAt = new Date().toISOString()
  db.write('agent-files', files)
  res.json({ success: true, file: meta })
})
app.delete('/api/agent-files/:id', auth, requireSub('hr', 'files-delete'), notViewAs, (req, res) => {
  const files = db.read('agent-files', [])
  const meta = files.find((f) => f.id === req.params.id)
  if (!meta) return res.status(404).json({ error: 'not found' })
  if (!hrNamesSet(req.realUser).has(meta.agent)) return res.status(403).json({ error: 'Not in your HR scope' })
  try { const fp = path.join(FILES_DIR, fileSlug(meta.agent), meta.storedAs); if (fs.existsSync(fp)) fs.unlinkSync(fp) } catch { /* ignore */ }
  db.write('agent-files', files.filter((f) => f.id !== req.params.id))
  res.json({ success: true })
})

// ---------- employee profile fields (editable HR data not in the static roster) ----------
// Personal/contact + HR fields the static team.js roster doesn't carry. Stored
// per employee NAME so they survive roster edits. Read by anyone with 'hr';
// written by 'hr'. Never holds pay (that's the roster/payroll).
const PROFILE_FIELDS = ['phone', 'email', 'emergencyContact', 'emergencyPhone', 'manager', 'nextReview', 'address', 'notes', 'performanceScore', 'performanceStatus', 'performanceNote']
app.get('/api/employee-profile', auth, requireSub('hr', 'records'), (req, res) => {
  const name = req.query.name
  if (!name) return res.status(400).json({ error: 'name required' })
  const all = db.read('profiles', {})
  res.json({ profile: all[name] || {} })
})
app.put('/api/employee-profile', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const { name, fields } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  const all = db.read('profiles', {})
  const clean = {}
  for (const k of PROFILE_FIELDS) if (fields && fields[k] !== undefined) clean[k] = String(fields[k] || '').trim()
  all[name] = { ...(all[name] || {}), ...clean, updatedAt: new Date().toISOString(), updatedBy: req.user.username }
  db.write('profiles', all)
  res.json({ profile: all[name] })
})

// ---------- onboarding / offboarding checklists (per employee) ----------
const ONBOARDING_ITEMS = ['Signed contract', 'Submitted ID', 'Training complete', 'App access granted', 'Uniform issued']
const OFFBOARDING_ITEMS = ['Equipment returned', 'Accounts disabled', 'Final salary paid', 'Exit interview completed']
function mergeChecklist(items, stored) {
  return items.map((label) => ({ label, ...(stored && stored[label] ? stored[label] : { done: false }) }))
}
app.get('/api/employee-checklist', auth, requireSub('hr', 'records'), (req, res) => {
  const name = req.query.name
  if (!name) return res.status(400).json({ error: 'name required' })
  const c = (db.read('checklists', {}))[name] || {}
  res.json({ onboarding: mergeChecklist(ONBOARDING_ITEMS, c.onboarding), offboarding: mergeChecklist(OFFBOARDING_ITEMS, c.offboarding) })
})
app.put('/api/employee-checklist', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const { name, type, label, done } = req.body || {}
  const items = type === 'onboarding' ? ONBOARDING_ITEMS : type === 'offboarding' ? OFFBOARDING_ITEMS : null
  if (!name || !items) return res.status(400).json({ error: 'name and valid type required' })
  if (!items.includes(label)) return res.status(400).json({ error: 'unknown checklist item' })
  const all = db.read('checklists', {})
  const c = all[name] || {}
  const section = c[type] || {}
  section[label] = done ? { done: true, doneAt: new Date().toISOString(), doneBy: req.user.username } : { done: false }
  c[type] = section
  all[name] = c
  db.write('checklists', all)
  res.json({ ok: true, item: { label, ...section[label] } })
})

// ---------- recruitment: applicants pipeline ----------
const APPLICANT_STAGES = ['cv_received', 'interviewed', 'hired', 'rejected']
const APPLICANT_FIELDS = ['name', 'role', 'email', 'phone', 'source', 'notes']
app.get('/api/applicants', auth, requireSub('hr', 'records'), (req, res) => {
  const list = db.read('applicants', []).slice().sort((a, b) => ((a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1))
  res.json({ applicants: list })
})
app.post('/api/applicants', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const b = req.body || {}
  if (!b.name) return res.status(400).json({ error: 'name required' })
  const now = new Date().toISOString()
  const rec = { id: crypto.randomUUID(), stage: 'cv_received', createdAt: now, updatedAt: now, createdBy: req.user.username, history: [{ stage: 'cv_received', at: now, by: req.user.username }] }
  for (const k of APPLICANT_FIELDS) rec[k] = String(b[k] || '').trim()
  const all = db.read('applicants', [])
  all.push(rec)
  db.write('applicants', all)
  res.json({ applicant: rec })
})
app.put('/api/applicants/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = db.read('applicants', [])
  const rec = all.find((a) => a.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  for (const k of APPLICANT_FIELDS) if (b[k] !== undefined) rec[k] = String(b[k] || '').trim()
  if (b.stage && APPLICANT_STAGES.includes(b.stage) && b.stage !== rec.stage) {
    rec.stage = b.stage
    rec.history = [...(rec.history || []), { stage: b.stage, at: new Date().toISOString(), by: req.user.username }]
  }
  rec.updatedAt = new Date().toISOString()
  db.write('applicants', all)
  res.json({ applicant: rec })
})
app.delete('/api/applicants/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  db.write('applicants', db.read('applicants', []).filter((a) => a.id !== req.params.id))
  res.json({ ok: true })
})

seedUsers()
seedSales()
// ---------- performance reviews (immutable monthly records) ----------
// A completed review is a permanent, LOCKED snapshot per employee + period
// (YYYY-MM). Never overwritten — this is the audit trail HR can rely on for
// pay/promotion decisions. Read/written by 'hr'. Stored in data/reviews.json
// keyed by employee name. Ratings are manager-entered (no sampled numbers).
app.get('/api/reviews', auth, requireSub('hr', 'performance'), (req, res) => {
  const name = req.query.name
  const all = db.read('reviews', {})
  if (name) {
    const list = (all[name] || []).slice().sort((a, b) => (b.period || '').localeCompare(a.period || ''))
    return res.json({ reviews: list })
  }
  res.json({ reviews: all })
})
app.post('/api/reviews', auth, requireSub('hr', 'performance'), notViewAs, (req, res) => {
  const { name, period, score, status, ratings, kpis, achievements, actions, notes, warningsCount } = req.body || {}
  if (!name || !period) return res.status(400).json({ error: 'name and period required' })
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' })
  const all = db.read('reviews', {})
  const list = all[name] || []
  if (list.some((r) => r.period === period)) return res.status(409).json({ error: 'A review for this period is already locked.' })
  const rec = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name, period,
    score: score === '' || score == null ? null : Number(score),
    status: String(status || '').slice(0, 40),
    ratings: ratings && typeof ratings === 'object' ? ratings : {},
    kpis: Array.isArray(kpis) ? kpis.map((k) => ({ label: String(k.label || '').slice(0, 120), done: !!k.done })) : [],
    achievements: Array.isArray(achievements) ? achievements.map((a) => String(a).slice(0, 80)).filter(Boolean) : [],
    actions: Array.isArray(actions) ? actions.map((a) => String(a).slice(0, 60)).filter(Boolean) : [],
    notes: String(notes || '').slice(0, 4000),
    warningsCount: Number(warningsCount) || 0,
    manager: req.user.name || req.user.username,
    completedBy: req.user.username,
    completedAt: new Date().toISOString(),
    locked: true,
  }
  all[name] = [...list, rec]
  db.write('reviews', all)
  res.json({ review: rec })
})

// ---------- agent sales (REAL monthly sales imported from Ya Fatou's sheet) ----------
// Per-agent monthly tracker sales + revenue, attributed via the sheet's
// "Sold By" column. Stored in data/agent-sales.json (gitignored — real
// customer/financial data, never committed). Read by 'hr'.
app.get('/api/agent-sales', auth, requireSub('hr', 'performance'), (req, res) => {
  const all = db.read('agent-sales', {})
  const name = req.query.name
  if (name) return res.json({ sales: all[name] || null })
  res.json({ sales: all })
})

// ---------- contract management (actions + immutable event log) ----------
// team.js stays the human-edited source of the ORIGINAL contract. Runtime
// actions (renew / extend / convert-to-permanent / terminate) are recorded as
// an OVERLAY in data/contracts.json keyed by employee name, plus an immutable
// event log. Effective contract = seed merged with the overlay's `current`.
// Read/written by 'hr'. Terminate ALSO archives the staff account via the same
// path as /api/staff/:username/archive, so the person drops out of every
// roster (team, payroll, attendance) and shows in Past Staff with the reason.
function seedContractFor(name) {
  const p = team.find((t) => t.name === name)
  if (!p) return null
  return {
    type: p.contract || (p.contractEnd ? 'Fixed term' : 'Permanent'),
    start: p.joined || null,
    end: p.contractEnd || null,
    status: 'active',
  }
}
function effectiveContract(name) {
  const seed = seedContractFor(name)
  if (!seed) return null
  const overlay = db.read('contracts', {})[name]
  const base = overlay?.current ? { ...seed, ...overlay.current } : seed
  return { ...base, events: overlay?.events || [] }
}
app.get('/api/contracts', auth, requireSub('hr', 'records'), (req, res) => {
  const name = req.query.name
  if (name) {
    const c = effectiveContract(name)
    if (!c) return res.status(404).json({ error: 'not on roster' })
    return res.json({ contract: c })
  }
  const all = {}
  for (const p of team) all[p.name] = effectiveContract(p.name)
  res.json({ contracts: all })
})
app.post('/api/contracts/action', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const { name, action, newStart, newEnd, newType, reason, note } = req.body || {}
  if (!name || !action) return res.status(400).json({ error: 'name and action required' })
  const seed = seedContractFor(name)
  if (!seed) return res.status(404).json({ error: 'not on roster' })
  const store = db.read('contracts', {})
  const rec = store[name] || { current: { ...seed }, events: [] }
  const cur = { ...seed, ...rec.current } // effective BEFORE this action
  const ev = {
    id: `con_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action, at: new Date().toISOString(), by: req.user.username,
    fromType: cur.type, fromEnd: cur.end,
    note: String(note || '').slice(0, 2000),
  }
  const next = { ...cur }
  if (action === 'renew') {
    if (!newEnd) return res.status(400).json({ error: 'New end date is required' })
    if (newStart) next.start = newStart
    next.end = newEnd
    if (newType) next.type = String(newType).slice(0, 80)
    next.status = 'active'
  } else if (action === 'extend') {
    if (!newEnd) return res.status(400).json({ error: 'New end date is required' })
    next.end = newEnd
    next.status = 'active'
  } else if (action === 'convert') {
    next.type = newType ? String(newType).slice(0, 80) : 'Permanent'
    next.end = null
    next.status = 'permanent'
  } else if (action === 'terminate') {
    const why = String(reason || '').trim()
    if (!why) return res.status(400).json({ error: 'A termination reason is required' })
    next.status = 'terminated'
    next.end = newEnd || todayKey()
    ev.reason = why
    // deactivate across Pulse via the existing archive path (reuse, don't fork)
    const users = seedUsers()
    const u = users.find((x) => x.name === name)
    if (u && u.username === req.realUser.username) {
      return res.status(400).json({ error: "You can't terminate your own contract" })
    }
    if (u && !isArchived(u)) {
      u.status = 'archived'
      u.archivedAt = ev.at
      u.archivedBy = req.realUser.username
      u.archivedReason = why
      u.history = u.history || []
      u.history.push({ date: todayKey(), event: `Left the team — ${why}` })
      db.write('users', users)
      for (const [tok, s] of Object.entries(sessions)) if (s.username === u.username) delete sessions[tok]
      persistSessions()
      ev.archived = true
    }
  } else {
    return res.status(400).json({ error: 'unknown action' })
  }
  ev.toType = next.type
  ev.toEnd = next.end
  rec.current = next
  rec.events = [...(rec.events || []), ev]
  rec.updatedAt = ev.at
  rec.updatedBy = req.user.username
  store[name] = rec
  db.write('contracts', store)
  res.json({ contract: { ...next, events: rec.events } })
})

// ---------- my record (staff self-view: own contract + history, scoped to caller) ----------
app.get('/api/my/record', auth, (req, res) => {
  const name = req.user.name
  const person = team.find((t) => t.name === name) || null
  const u = findUser(req.user.username)
  let contract = effectiveContract(name)
  if (!contract && u) {
    contract = {
      type: u.contract || (u.contractEnd ? 'Fixed term' : 'Permanent'),
      start: u.joined || null,
      end: u.contractEnd || null,
      status: isArchived(u) ? 'terminated' : 'active',
      events: [],
    }
  }
  res.json({
    name,
    role: person?.role || u?.title || '',
    department: person?.type || u?.department || '',
    joined: person?.joined || u?.joined || null,
    contract,
    history: person?.history || u?.history || [],
  })
})

// Staff self-view ("My Progress"): the signed-in person's OWN goals, score,
// KPI ratings, achievements and monthly history. Self-scoped — only ever returns
// the caller's own record. All data is real (locked reviews + live manager score
// + real sales); nothing is sampled.
// Sales source by month (Adama 29 Jun): sheet = history (≤ Jun 2026); Admin =
// truth from Jul 2026 (agents mark deals Won there). Needs ADMIN_SYNC_URL +
// PULSE_SYNC_KEY in .env; unset/unreachable → null, shown as "Connecting to Admin".
const SALES_ADMIN_FROM = '2026-07'
async function fetchAdminWonCount(name, month) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/sales?month=${month}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    const data = await resp.json()
    const row = (data.agents || []).find((a) => a.name === name)
    return row ? Number(row.won) || 0 : 0
  } catch { return null }
}
// The percent helpers return the WHOLE row (Adama 4 Jul: "I like to see
// numbers, not only percentage") — the scorecard shows the % plus the real
// counts behind it. null = Admin unreachable / no row.
async function fetchAdminRetention(name, month) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/retention?month=${month}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    return ((await resp.json()).agents || []).find((a) => a.name === name) || null
  } catch { return null }
}
async function fetchAdminStock(month) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/stock?month=${month}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    const data = await resp.json()
    return typeof data.accountabilityPct === 'number' ? data : null
  } catch { return null }
}
// Case-resolution from Admin (Ya Fatou's KPI): resolved on time ÷
// (resolved that month + open cases past their SLA). null = unreachable.
async function fetchAdminCases(name, month) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/cases?month=${month}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    return ((await resp.json()).agents || []).find((a) => a.name === name) || null
  } catch { return null }
}
// Installations-within-3-days from Admin (company-wide — Ya Fatou coordinates
// the process): onTime ÷ (completed this month + open past 3 days).
async function fetchAdminInstall(month) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/install?month=${month}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    const data = await resp.json()
    return typeof data.installPct === 'number' || data.completed != null ? data : null
  } catch { return null }
}
// Trackers-online rate for the agent's BOOK (live snapshot from Admin — same
// rules as Admin's own online meter). No book yet → null, never faked.
async function fetchAdminOnline(name) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/online`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    return ((await resp.json()).agents || []).find((a) => a.name === name) || null
  } catch { return null }
}
// Verified 5-star Google reviews credited to the agent this month. An agent
// absent from the feed simply has none yet — that's a real 0, not "unknown".
async function fetchAdminReviews(name, month) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/api/integrations/pulse/reviews?month=${month}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    const row = ((await resp.json()).agents || []).find((a) => a.name === name)
    return row ? Number(row.verified) || 0 : 0
  } catch { return null }
}
// Whole feed, unfiltered — the Team Lead card aggregates ACROSS the team's
// books, so it needs every agent row, not one name. null = unreachable.
async function fetchAdminFeed(pathWithQuery) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}${pathWithQuery}`, { headers: { 'x-pulse-key': key } })
    if (!resp.ok) return null
    return await resp.json()
  } catch { return null }
}
app.get('/api/my/progress', auth, async (req, res) => {
  const name = req.user.name
  const u = findUser(req.user.username)
  const person = team.find((t) => t.name === name) || null
  const profile = (db.read('profiles', {}))[name] || {}
  const reviews = ((db.read('reviews', {}))[name] || [])
    .slice().sort((a, b) => (a.period || '').localeCompare(b.period || ''))
  const sales = (db.read('agent-sales', {}))[name] || null
  const sc = profile.performanceScore === '' || profile.performanceScore == null ? null : Number(profile.performanceScore)

  // ----- Scorecard: each ROLE has its own weighted KPIs (Adama 29 Jun). Targets
  // + weights here; ACTUALS come from ADMIN once that connection is built —
  // until then only sales has an interim actual (the sheet); every other KPI
  // stays null ("Connecting to Admin") so nothing is ever faked. Roles covered:
  // Sales agent, Customer Service, Team Lead. Technician = contractor, no
  // scorecard for now.
  const now = new Date()
  const CUR = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const r = (person?.role || u?.title || '').toLowerCase()
  const t = (person?.type || u?.department || '').toLowerCase()
  let scKey = null
  if (r.includes('team lead')) scKey = 'team-lead'
  else if (r.includes('customer service') || t === 'customer service') scKey = 'customer-service'
  else if (t === 'sales' || r.includes('sales agent') || r.includes('sales intern') || r.includes('senior sales')) scKey = 'sales'

  let scorecard = null
  // Targets/weights resolve through the KPI Targets store (CEO-set on the
  // KPI Targets page, effective by month — Adama 3 Jul). Actuals unchanged.
  const kpiN = (kpi, dfltTarget, dfltWeight) => kpiNumber(scKey, kpi, CUR) || { target: dfltTarget, weight: dfltWeight }
  if (scKey === 'sales') {
    let salesActual
    if (CUR >= SALES_ADMIN_FROM) {
      salesActual = await fetchAdminWonCount(name, CUR) // Admin = source from Jul 2026
    } else {
      const m = sales?.months?.[CUR]
      salesActual = m && !m.pending ? (m.sales ?? null) : null // sheet = history
    }
    // All four actuals now flow from Admin (connected 4 Jul): retention =
    // renewal events on the agent's book, online = live book rate, reviews =
    // verified 5-star log. Unreachable → null ("Connecting to Admin").
    // Percent KPIs carry a `detail` line — the counts behind the % (Adama
    // 4 Jul: "I like to see numbers, not only percentage").
    const ret = await fetchAdminRetention(name, CUR)
    const onl = await fetchAdminOnline(name)
    const reviewsCount = await fetchAdminReviews(name, CUR)
    const kS = kpiN('sales', 5, 40), kO = kpiN('online', 75, 20), kR = kpiN('retention', 80, 25), kV = kpiN('reviews', 3, 15)
    scorecard = { role: 'Sales agent', kpis: [
      { key: 'sales', label: 'Tracker sales', kind: 'count', target: Number(u?.target) || kS.target, weight: kS.weight, unit: 'sales', actual: salesActual },
      { key: 'online', label: 'Trackers online', kind: 'percent', target: kO.target, weight: kO.weight, unit: '%',
        actual: typeof onl?.pct === 'number' ? onl.pct : null,
        detail: onl && onl.total ? `${onl.online} of ${onl.total} trackers online` : null },
      { key: 'retention', label: 'Customer retention', kind: 'percent', target: kR.target, weight: kR.weight, unit: '%',
        actual: typeof ret?.retentionPct === 'number' ? ret.retentionPct : null,
        detail: ret && ret.due ? `${ret.renewed} renewed of ${ret.due} due` : null },
      { key: 'reviews', label: '5-star Google reviews', kind: 'count', target: kV.target, weight: kV.weight, unit: 'reviews', actual: reviewsCount },
    ] }
  } else if (scKey === 'customer-service') {
    const stock = await fetchAdminStock(CUR) // accountability proven by weekly counts (Admin)
    const cas = await fetchAdminCases(name, CUR) // on-time resolution ÷ (resolved + open-overdue)
    const inst = await fetchAdminInstall(CUR) // company-wide: within 3 days of opening
    const kC = kpiN('cases', 85, 40), kI = kpiN('install', 95, 35), kSt = kpiN('stock', 100, 25)
    scorecard = { role: 'Customer Service', kpis: [
      { key: 'cases', label: 'Case resolution', kind: 'percent', target: kC.target, weight: kC.weight, unit: '%',
        actual: typeof cas?.casesPct === 'number' ? cas.casesPct : null,
        detail: cas ? `${cas.onTime} on time of ${cas.resolved + cas.openOverdue}${cas.openOverdue ? ` · ${cas.openOverdue} open past SLA` : ''}` : null },
      { key: 'install', label: 'Installation within 3 days', kind: 'percent', target: kI.target, weight: kI.weight, unit: '%',
        actual: typeof inst?.installPct === 'number' ? inst.installPct : null,
        detail: inst && (inst.completed || inst.openLate)
          ? `${inst.onTime} within 3 days of ${inst.completed + inst.openLate}${inst.openLate ? ` · ${inst.openLate} open past 3 days` : ''}`
          : (inst ? 'no installations this month yet' : null) },
      { key: 'stock', label: 'Stock accountability (trackers)', kind: 'percent', target: kSt.target, weight: kSt.weight, unit: '% verified',
        actual: typeof stock?.accountabilityPct === 'number' ? stock.accountabilityPct : null,
        detail: stock ? `${stock.cleanThisMonth ?? 0} clean counts of ${stock.weeksExpected ?? 4} weeks${stock.outstandingMissing ? ` · ${stock.outstandingMissing} missing` : ''}` : null },
    ] }
  } else if (scKey === 'team-lead') {
    const teamAtt = teamAttendancePct(u) // real now — from Pulse attendance
    // Month-one ramp (Adama 2 Jul): keep the standard, ramp the man. Score
    // sales + attendance only; coaching stays an activity, NOT a scored KPI.
    // Numbers come from the KPI Targets store — the ramp's 12 is the catalog
    // default; the snap to 15 later is one scheduled change, no code.
    // Actuals (Adama 5 Jul: "the team's target has to be connected from the
    // team itself") = the SAME Admin feeds the agents' own cards read,
    // aggregated across the lead's roster. Feed unreachable → null, never 0.
    const members = teamMembersFor(u)
    const teamNames = new Set(members.map((m) => m.name))
    const sellers = members.filter((m) => m.department === 'Sales')
    const [salesF, retF, onlF, revF] = await Promise.all([
      fetchAdminFeed(`/api/integrations/pulse/sales?month=${CUR}`),
      fetchAdminFeed(`/api/integrations/pulse/retention?month=${CUR}`),
      fetchAdminFeed('/api/integrations/pulse/online'),
      fetchAdminFeed(`/api/integrations/pulse/reviews?month=${CUR}`),
    ])
    const teamRows = (feed) => (feed?.agents || []).filter((a) => teamNames.has(a.name))
    const rowFor = (feed, m) => (feed?.agents || []).find((a) => a.name === m.name) || null
    const first = (m) => m.name.split(' ')[0]
    // Team sales: verified customers only (same rule as the agents' tiles).
    // A seller absent from a reachable feed has a real 0.
    const wonBy = (m) => Number(rowFor(salesF, m)?.won) || 0
    const teamWon = salesF ? teamRows(salesF).reduce((s, a) => s + (Number(a.won) || 0), 0) : null
    const withSale = sellers.filter((m) => wonBy(m) > 0).length
    // Retention/online: one combined book — sum the raw counts, then rate.
    const retDue = teamRows(retF).reduce((s, a) => s + (Number(a.due) || 0), 0)
    const retRen = teamRows(retF).reduce((s, a) => s + (Number(a.renewed) || 0), 0)
    const onlTotal = teamRows(onlF).reduce((s, a) => s + (Number(a.total) || 0), 0)
    const onlOn = teamRows(onlF).reduce((s, a) => s + (Number(a.online) || 0), 0)
    const revCount = revF ? teamRows(revF).reduce((s, a) => s + (Number(a.verified) || 0), 0) : null
    const kTS = kpiN('team-sales', 12, 50), kTA = kpiN('team-active', 100, 25), kAt = kpiN('team-attendance', 90, 25)
    const kTR = kpiN('team-retention', 80, 0), kTO = kpiN('team-online', 75, 0), kTV = kpiN('team-reviews', null, 0)
    // Team reviews target STEMS from the agents' own target (Adama 5 Jul):
    // each seller owes 3 five-star reviews, so the team owes 3 × sellers.
    // An explicit team-reviews entry on KPI Targets still wins if he sets one.
    const perSellerReviews = (kpiNumber('sales', 'reviews', CUR) || { target: 3 }).target
    const teamReviewsTarget = kTV.target ?? (perSellerReviews != null && sellers.length ? perSellerReviews * sellers.length : null)
    scorecard = { role: 'Team Lead', kpis: [
      { key: 'team-sales', label: 'Team tracker sales', kind: 'count', target: kTS.target, weight: kTS.weight, unit: 'sales', actual: teamWon,
        detail: salesF && sellers.length ? sellers.map((m) => `${first(m)} ${wonBy(m)}`).join(' · ') : null },
      { key: 'team-active', label: 'Whole team contributing', kind: 'percent', target: kTA.target, weight: kTA.weight, unit: '% of agents with a sale',
        actual: salesF && sellers.length ? Math.round((withSale / sellers.length) * 100) : null,
        detail: salesF && sellers.length ? `${sellers.map(first).join(' and ')} each need at least 1 — so far ${withSale} of ${sellers.length} have one` : null },
      { key: 'team-attendance', label: 'Team attendance', kind: 'percent', target: kAt.target, weight: kAt.weight, unit: '%', actual: teamAtt },
      // Real team numbers now visible — still weight 0 until Adama sets
      // weights on the KPI Targets page (decided WITH numbers in hand, 3 Jul).
      { key: 'team-retention', label: 'Team retention', kind: 'percent', target: kTR.target, weight: kTR.weight, unit: '%',
        actual: retF && retDue ? Math.round((retRen / retDue) * 100) : null,
        due: retF ? retDue : null, // goal text says "renew N of the M due" — real dues, not an abstract %
        detail: retF && retDue ? `${retRen} renewed of ${retDue} due` : null },
      { key: 'team-online', label: 'Trackers online', kind: 'percent', target: kTO.target, weight: kTO.weight, unit: '%',
        actual: onlF && onlTotal ? Math.round((onlOn / onlTotal) * 100) : null,
        detail: onlF && onlTotal ? `${onlOn} of ${onlTotal} trackers online` : null },
      { key: 'team-reviews', label: 'Five-star reviews (team)', kind: 'count', target: teamReviewsTarget, weight: kTV.weight, unit: 'reviews', actual: revCount,
        perSeller: perSellerReviews, // goal text explains where the team number comes from
        detail: revF && sellers.length ? sellers.map((m) => `${first(m)} ${Number(rowFor(revF, m)?.verified) || 0}`).join(' · ') : null },
    ] }
  }

  // Normalized weights + any CEO-added custom KPIs join the card (Adama 3 Jul).
  if (scorecard && scKey) scorecard.kpis = overlayPlan(scorecard.kpis, scKey, CUR)

  // ----- MY HISTORY (Adama 4 Jul: the page showed only "now", nothing about
  // past performance). Month-by-month sales record: the SHEET is the truth
  // before Jul 2026 (Ya Fatou's New_Customers), ADMIN (Won deals) from Jul on
  // — same cutover as the live number. The target resolves per month through
  // the KPI Targets store (5 before Jul, 6 from Jul — his effective-month
  // change). Locked review scores ride along when they exist.
  let history = null
  if (scKey === 'sales') {
    const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
    const monthsSet = new Set(Object.keys(sales?.months || {}))
    for (let m = SALES_ADMIN_FROM; m < CUR; m = nextMonth(m)) monthsSet.add(m)
    const list = [...monthsSet].filter((m) => /^\d{4}-\d{2}$/.test(m) && m < CUR).sort().reverse()
    history = []
    for (const mo of list) {
      let actual = null, customers = null, pending = false
      if (mo >= SALES_ADMIN_FROM) {
        actual = await fetchAdminWonCount(name, mo) // null when Admin unreachable — never faked
      } else {
        const rec = sales?.months?.[mo]
        pending = !!rec?.pending
        actual = rec && !rec.pending ? (rec.sales ?? null) : null
        customers = rec?.customers || null
      }
      const kk = kpiNumber(scKey, 'sales', mo) || { target: 5 }
      const review = reviews.find((rv) => rv.period === mo) || null
      history.push({ month: mo, sales: actual, pending, target: kk.target, customers, reviewScore: review?.score ?? null })
    }
    if (!history.length) history = null
  }

  // Goals mirror the scorecard (Adama 2 Jul): a KPI is the measure, the goal
  // is the actionable objective with the number. Professional register. The
  // manager's locked-review checklist rides along separately as additions.
  const GOAL_TEXT = {
    sales: (t) => `Close your ${t} tracker sales for the month.`,
    online: (t) => `Keep your customers' trackers online — ${t}% or above.`,
    retention: (t) => `Keep customer retention at ${t}% or above.`,
    reviews: (t) => `Bring in ${t} five-star Google reviews.`,
    cases: (t) => `Resolve ${t}% of customer cases.`,
    install: (t) => `Complete ${t}% of installations within 3 days.`,
    stock: () => 'Keep tracker stock fully accounted for.',
    // Team Lead lines written for Momodou, not for whoever designed the KPIs
    // (Adama 5 Jul: "if I do not get it, do you think Momodou will").
    'team-sales': (t) => `Sell ${t} trackers as a team this month.`,
    // Concrete dues, not an abstract % — "renew 4 of the 5 due", recomputed
    // from whatever is actually due each month (Adama 5 Jul).
    'team-retention': (t, k) => k?.due
      ? `Renew at least ${Math.ceil(k.due * t / 100)} of the ${k.due} customers due this month.`
      : `Customers due this month renew — at least ${t}%.`,
    'team-online': (t) => `Keep your team's customers' trackers online — at least ${t}%.`,
    'team-reviews': (t, k) => t != null
      ? `The team brings in ${t} five-star Google reviews${k?.perSeller != null ? ` — ${k.perSeller} per agent` : ''}.`
      : 'Get happy customers to leave five-star Google reviews.',
    'team-active': () => 'Every agent makes at least one sale this month.',
    'team-attendance': (t) => `Your team shows up — at least ${t}% of scheduled days.`,
  }
  const goals = (scorecard?.kpis || []).map((k) => ({
    key: k.key,
    text: (GOAL_TEXT[k.key] || ((t) => `${k.label}: ${t}${k.unit === '%' ? '%' : ''}`))(k.target, k),
    target: k.target,
    unit: k.unit,
    actual: k.actual,
    // null = not measurable yet (Connecting to Admin), or no target set yet
    // (team-reviews until Adama picks one) — never faked either way
    done: k.actual == null || k.target == null ? null : k.actual >= k.target,
  }))

  res.json({
    name,
    role: person?.role || u?.title || '',
    department: person?.type || u?.department || '',
    manager: profile.manager || '',
    goals,
    liveScore: Number.isFinite(sc) ? sc : null,
    liveStatus: profile.performanceStatus || '',
    liveNote: profile.performanceNote || '',
    target: Number(u?.target) || 0,
    weeklyTarget: u?.weeklyTarget || '',
    kpi: u?.kpi || '',
    reviews,
    sales,
    scorecard,
    history,
  })
})

// ---------- serve the built frontend (production) ----------
// One Node process serves both the API and the built SPA in production. In dev,
// Vite serves the frontend separately (proxying /api here), so this only runs
// when a dist/ build exists on disk.
const DIST_DIR = path.join(__dirname, 'dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

app.listen(PORT, () => console.log(`Damia Staff API on http://localhost:${PORT}`))
