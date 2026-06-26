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
import { buildPayrollHistory, zohoConfigured, paySources, recordSalaryPayment, resolveVendor, getExpense, deleteExpense, updateSalaryExpense } from './lib/zoho-books.js'

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
const PORT = 4003

// Who manages people. Everyone else is staff.
const MANAGER_NAMES = ['Ya Fatou Sawaneh', 'Kaddy Bojang']
const DEFAULT_PASSWORD = 'damia2026'
// Passwords ON (4 Jun 2026) — a Pulse login must actually prove who you are.
// Everyone starts on DEFAULT_PASSWORD with mustChangePassword=true and is
// forced to set their own at first sign-in.
const REQUIRE_PASSWORD = true

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
  // the server re-checks every request regardless
  return { ...rest, powers: powersFor(u) }
}
function findUser(username) {
  return seedUsers().find((u) => u.username === username.toLowerCase())
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
  if (va && can(real, 'viewas')) {
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
  ['team', 'Team', 'Presence, schedules, coaching, add/archive staff'],
  ['payroll', 'Payroll', 'Salaries, payslips and benefits'],
  ['hr', 'HR', 'KPI rules, contracts, warnings, agent files'],
  ['marketing', 'Marketing', 'Marketing department page'],
  ['notices', 'Notices', 'Post and remove announcements'],
  ['viewas', 'View as', 'See the app as another staff member (read-only)'],
  ['grant', 'Grant access', 'Give or take powers (not their own, not the CEO’s)'],
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
// Powers are always checked on the REAL user — "view as" never changes
// what you're allowed to do, only what you're looking at.
function requirePower(power) {
  return (req, res, next) => {
    if (!can(req.realUser, power)) return res.status(403).json({ error: 'forbidden' })
    next()
  }
}
// Block writes while a manager is viewing as someone else (read-only impersonation).
function notViewAs(req, res, next) {
  if (req.isViewAs) return res.status(403).json({ error: 'Read-only while viewing as another user' })
  next()
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = username ? findUser(username) : null
  if (!user) return res.status(401).json({ error: 'Unknown username' })
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
  res.json({ powers: POWERS.map(([key, label, detail]) => ({ key, label, detail })) })
})

// Set someone's powers. Holder of 'grant' required. Guardrails:
//   - the CEO's powers can never be edited (he has everything, always)
//   - non-CEO granters cannot edit their OWN powers
//   - only the CEO can give or take the 'grant' power itself
// Every change is appended to the target's accessLog: who, when, before, after.
app.post('/api/staff/:username/access', auth, notViewAs, requirePower('grant'), (req, res) => {
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
  // Optional: set their email here too (seeded accounts have none, and the
  // Open Admin hand-off needs one to identify them in the admin system).
  if (typeof req.body?.email === 'string' && req.body.email.trim()) {
    const email = req.body.email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })
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
app.post('/api/staff/:username/reset-password', auth, requirePower('team'), notViewAs, (req, res) => {
  const { tempPassword } = req.body || {}
  if (!tempPassword || String(tempPassword).length < 8)
    return res.status(400).json({ error: 'Temporary password must be at least 8 characters' })
  const users = seedUsers()
  const target = users.find((u) => u.username === String(req.params.username).toLowerCase())
  if (!target) return res.status(404).json({ error: 'No such user' })
  if (target.role === 'manager' && req.realUser.username !== 'adama')
    return res.status(403).json({ error: 'Only the CEO can reset a manager password' })
  target.passwordHash = bcrypt.hashSync(String(tempPassword), 10)
  target.mustChangePassword = true
  db.write('users', users)
  for (const [tok, s] of Object.entries(sessions)) {
    if (s.username === target.username) delete sessions[tok]
  }
  persistSessions()
  res.json({ ok: true })
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
  // private manager notes never go to staff clients
  const roster =
    can(req.realUser, 'team')
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
app.post('/api/staff', auth, requirePower('team'), notViewAs, (req, res) => {
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
  res.json({ staff: { username, name: rec.name, email: rec.email, title: rec.title } })
})

// archive a staff member — keeps the record forever, blocks login, removes from active lists
app.post('/api/staff/:username/archive', auth, requirePower('team'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  if (u.username === req.realUser.username) return res.status(400).json({ error: "You can't archive your own account" })
  if (isArchived(u)) return res.status(409).json({ error: 'Already archived' })
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
app.post('/api/staff/:username/restore', auth, requirePower('team'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  if (!isArchived(u)) return res.status(409).json({ error: 'Not archived' })
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
    .filter((u) => u.username !== req.realUser.username && !isArchived(u))
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.role,
      department: u.department,
      title: u.title,
      email: u.email || null,
      powers: powersFor(u), // drives the Access toggles on the Team page
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
  db.write('attendance', all)
  res.json({ record: rec })
})

// self: undo a mistaken check-in — wipes TODAY's own record so they're "not
// checked in" again and can re-check-in. Only today, only your own.
app.post('/api/attendance/undo-checkin', auth, notViewAs, (req, res) => {
  const date = todayKey()
  const all = db.read('attendance', [])
  const rec = all.find((a) => a.username === req.user.username && a.date === date)
  if (!rec || !rec.checkIn) return res.status(409).json({ error: 'No check-in to undo today' })
  db.write('attendance', all.filter((a) => !(a.username === req.user.username && a.date === date)))
  res.json({ ok: true, record: null })
})

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
  const roster = can(req.realUser, 'team') && !req.isViewAs
    ? scheduleRoster(req)
    : seedUsers().filter((u) => u.username === req.user.username)

  const people = roster.map((u) => {
    const schedule = schedules[u.username] || DEFAULT_WEEK
    const byDate = {}
    let weekHours = 0
    for (const k of days) {
      const shift = schedule[dowOfKey(k)] || null
      const attendance = attAll.find((a) => a.username === u.username && a.date === k) || null
      const leave = leaveOnDate(leaveAll, u.username, k)
      if (shift && !leave) weekHours += shiftHours(shift)
      byDate[k] = {
        status: dayStatus({ schedule, attendance, leave }, k, todayK),
        shift,
        checkIn: attendance?.checkIn || null,
        checkOut: attendance?.checkOut || null,
        late: !!attendance?.late,
        leaveType: leave?.leaveType || null,
        note: leave?.note || '',
      }
    }
    return { username: u.username, name: u.name, department: u.department, schedule, weekHours, byDate }
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
  return seedUsers().filter((u) => !isArchived(u) && u.username !== req.user.username)
}

// manager: set each person's weekly roster in one request.
// body: { schedules: { username: { days: { dow: {start,end}|null } } } } — each person can differ.
app.put('/api/schedules', auth, requirePower('team'), notViewAs, (req, res) => {
  const incoming = req.body?.schedules || {}
  const allowed = new Set(scheduleRoster(req).map((u) => u.username))
  const all = db.read('schedules', {})
  let count = 0
  for (const [username, week] of Object.entries(incoming)) {
    if (!allowed.has(username)) continue
    all[username] = cleanWeek(week?.days || week)
    count++
  }
  db.write('schedules', all)
  res.json({ count })
})

// manager: set one person's weekly roster (in/off + hours per weekday)
app.put('/api/schedules/:username', auth, requirePower('team'), notViewAs, (req, res) => {
  const target = findUser(req.params.username)
  if (!target) return res.status(404).json({ error: 'No such user' })
  const schedule = cleanWeek(req.body?.days)
  const all = db.read('schedules', {})
  all[target.username] = schedule
  db.write('schedules', all)
  res.json({ username: target.username, schedule })
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
  res.json({ requests: mine.map((r) => visibleLeave(r, req.realUser)), annualUsed, annualEligible, eligibleFrom, monthsService })
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
  const list = status ? all.filter((l) => l.status === status) : all
  res.json({ requests: list.map((r) => visibleLeave(r, req.realUser)) })
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
app.post('/api/leave/:id/approve', auth, notViewAs, requirePower('approvals'), decideLeave('approved'))
app.post('/api/leave/:id/reject', auth, notViewAs, requirePower('approvals'), decideLeave('rejected'))

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
  const roster = can(req.realUser, 'team') && !req.isViewAs
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
        leaveType: leave?.leaveType || null,
        note: leave?.note || '',
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
app.put('/api/attendance/day', auth, requirePower('team'), notViewAs, (req, res) => {
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
  const who = can(req.realUser, 'payroll') && req.query.username ? req.query.username : req.user.username
  const list = db.read('benefits', []).filter((b) => b.username === who)
  res.json({ benefits: list })
})

app.post('/api/benefits', auth, requirePower('payroll'), notViewAs, (req, res) => {
  const { username, title, detail, amount, status, from, to, note } = req.body || {}
  const target = rosterFor(username) || findUser(username)
  if (!target) return res.status(404).json({ error: 'No such staff member' })
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

app.delete('/api/benefits/:id', auth, requirePower('payroll'), notViewAs, (req, res) => {
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
  res.json({ people })
})

// payslips — staff see their own; managers may read anyone's (?username=)
app.get('/api/payslips', auth, (req, res) => {
  const who = can(req.realUser, 'payroll') && req.query.username ? req.query.username : req.user.username
  const list = db.read('payslips', [])
    .filter((p) => p.username === who)
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

app.post('/api/payslips', auth, requirePower('payroll'), notViewAs, (req, res) => {
  const { username, period, earnings, deductions, note } = req.body || {}
  const target = rosterFor(username) || findUser(username)
  if (!target) return res.status(404).json({ error: 'No such staff member' })
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

app.delete('/api/payslips/:id', auth, requirePower('payroll'), notViewAs, (req, res) => {
  db.write('payslips', db.read('payslips', []).filter((p) => p.id !== req.params.id))
  res.json({ ok: true })
})

// Payroll history — per-person, per-month, pulled LIVE from Zoho Books
// (the "Salaries and Employee Wages" account). OWNER/CEO ONLY: this exposes
// every staff member's pay, so it's gated to the CEO, not the payroll power.
// Cached in memory (1h) so we don't hit Zoho on every page load; ?refresh=1
// forces a fresh pull.
let _payrollCache = null // { at, data }
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

// The roster to run for a month + what's already been paid (local record).
// `?period=YYYY-MM` (defaults to the current month). Suggested salary/bonus
// pre-fill from the roster; the owner edits them before paying.
app.get('/api/payroll/run', auth, requireOwner, async (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : new Date().toISOString().slice(0, 7)
  const archived = archivedNameSet()
  const merged = [...team, ...createdStaffRoster()].filter((p) => !archived.has(p.name))
  let paidRecords = db.read('payroll', []).filter((r) => r.period === period)
  // Reconcile each recorded payment against Books (Books is the truth): if the
  // expense was deleted in Zoho, drop the local record; if its total changed,
  // sync ours + flag it. Keeps the "Paid" badge honest no matter where edited.
  if (zohoConfigured() && paidRecords.length) {
    const all = db.read('payroll', [])
    let changed = false
    for (const r of paidRecords) {
      if (!r.expenseId) continue
      try {
        const exp = await getExpense(r.expenseId)
        if (!exp) { // deleted in Zoho
          const i = all.findIndex((x) => x.id === r.id)
          if (i >= 0) { all.splice(i, 1); changed = true; r._deleted = true }
        } else if (Math.round(exp.total) !== Math.round(r.total)) {
          r.total = Math.round(exp.total); r.editedInZoho = true
          const i = all.findIndex((x) => x.id === r.id)
          if (i >= 0) { all[i] = { ...all[i], total: r.total, editedInZoho: true }; changed = true }
        }
      } catch { /* leave record as-is on a transient Zoho hiccup */ }
    }
    if (changed) { db.write('payroll', all); _payrollCache = null }
    paidRecords = paidRecords.filter((r) => !r._deleted)
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
  if (!name) return res.status(400).json({ error: 'name required' })
  const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true
  try {
    const result = await recordSalaryPayment({ name, salary, bonus, paySourceKey, date, period, force: !!force, dryRun })
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
  try {
    const upd = await updateSalaryExpense(rec.expenseId, {
      name: rec.name, vendorId: rec.vendorId,
      salary: Number(salary) || 0, bonus: Number(bonus) || 0,
      paySourceKey: paySourceKey || rec.paySourceKey, date: date || rec.date, period: rec.period,
    })
    const next = {
      ...rec,
      salary: Math.round(Number(salary) || 0), bonus: Math.round(Number(bonus) || 0), total: upd.total,
      paySource: upd.paySource?.label || rec.paySource, paySourceKey: paySourceKey || rec.paySourceKey,
      date: date || rec.date, editedInZoho: false, editedBy: req.user.username, editedAt: new Date().toISOString(),
    }
    db.write('payroll', all.map((r) => (r.id === rec.id ? next : r)))
    _payrollCache = null
    res.json({ ok: true, record: next })
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
  if (can(req.realUser, 'team') && !req.isViewAs) {
    if (req.query.user) all = all.filter((c) => c.targetUsername === req.query.user)
  } else {
    all = all.filter((c) => c.targetUsername === req.user.username)
  }
  all = all.slice().sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
  res.json({ coaching: all })
})
app.post('/api/coaching', auth, notViewAs, requirePower('team'), (req, res) => {
  const { targetUsername, type, title, note, datetime } = req.body || {}
  if (!targetUsername) return res.status(400).json({ error: 'targetUsername required' })
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
app.delete('/api/coaching/:id', auth, notViewAs, requirePower('team'), (req, res) => {
  db.write('coaching', db.read('coaching', []).filter((c) => c.id !== req.params.id))
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
app.post('/api/kpi-rules', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.delete('/api/kpi-rules/:id', auth, requirePower('hr'), notViewAs, (req, res) => {
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
  if (req.query.agent) all = all.filter((w) => w.agent === req.query.agent)
  res.json({ warnings: all })
})
app.post('/api/warnings', auth, requirePower('hr'), notViewAs, (req, res) => {
  const { agent, type, reason, date } = req.body || {}
  if (!agent || !type) return res.status(400).json({ error: 'agent and type required' })
  if (!['verbal', 'formal', 'final'].includes(type)) return res.status(400).json({ error: 'type must be verbal/formal/final' })
  const all = db.read('warnings', [])
  const entry = { id: 'w_' + crypto.randomUUID(), agent, type, reason: reason || '', date: date || new Date().toISOString().slice(0, 10), issuedBy: req.user.name || 'Manager', createdAt: new Date().toISOString() }
  all.push(entry)
  db.write('warnings', all)
  res.json({ success: true, warning: entry })
})
app.delete('/api/warnings/:id', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.post('/api/agent-files', auth, requirePower('hr'), notViewAs, (req, res) => {
  const { agent, name, mimeType, base64, category } = req.body || {}
  if (!agent || !name || !base64) return res.status(400).json({ error: 'agent, name, base64 required' })
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
app.post('/api/agent-files/generate-review', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.delete('/api/agent-files/:id', auth, requirePower('hr'), notViewAs, (req, res) => {
  const files = db.read('agent-files', [])
  const meta = files.find((f) => f.id === req.params.id)
  if (!meta) return res.status(404).json({ error: 'not found' })
  try { const fp = path.join(FILES_DIR, fileSlug(meta.agent), meta.storedAs); if (fs.existsSync(fp)) fs.unlinkSync(fp) } catch { /* ignore */ }
  db.write('agent-files', files.filter((f) => f.id !== req.params.id))
  res.json({ success: true })
})

// ---------- employee profile fields (editable HR data not in the static roster) ----------
// Personal/contact + HR fields the static team.js roster doesn't carry. Stored
// per employee NAME so they survive roster edits. Read by anyone with 'hr';
// written by 'hr'. Never holds pay (that's the roster/payroll).
const PROFILE_FIELDS = ['phone', 'email', 'emergencyContact', 'emergencyPhone', 'manager', 'nextReview', 'address', 'notes', 'performanceScore', 'performanceStatus', 'performanceNote']
app.get('/api/employee-profile', auth, requirePower('hr'), (req, res) => {
  const name = req.query.name
  if (!name) return res.status(400).json({ error: 'name required' })
  const all = db.read('profiles', {})
  res.json({ profile: all[name] || {} })
})
app.put('/api/employee-profile', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.get('/api/employee-checklist', auth, requirePower('hr'), (req, res) => {
  const name = req.query.name
  if (!name) return res.status(400).json({ error: 'name required' })
  const c = (db.read('checklists', {}))[name] || {}
  res.json({ onboarding: mergeChecklist(ONBOARDING_ITEMS, c.onboarding), offboarding: mergeChecklist(OFFBOARDING_ITEMS, c.offboarding) })
})
app.put('/api/employee-checklist', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.get('/api/applicants', auth, requirePower('hr'), (req, res) => {
  const list = db.read('applicants', []).slice().sort((a, b) => ((a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1))
  res.json({ applicants: list })
})
app.post('/api/applicants', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.put('/api/applicants/:id', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.delete('/api/applicants/:id', auth, requirePower('hr'), notViewAs, (req, res) => {
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
app.get('/api/reviews', auth, requirePower('hr'), (req, res) => {
  const name = req.query.name
  const all = db.read('reviews', {})
  if (name) {
    const list = (all[name] || []).slice().sort((a, b) => (b.period || '').localeCompare(a.period || ''))
    return res.json({ reviews: list })
  }
  res.json({ reviews: all })
})
app.post('/api/reviews', auth, requirePower('hr'), notViewAs, (req, res) => {
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

app.listen(PORT, () => console.log(`Damia Staff API on http://localhost:${PORT}`))
