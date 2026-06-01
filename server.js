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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const PORT = 4003

// Who manages people. Everyone else is staff.
const MANAGER_NAMES = ['Ya Fatou Sawaneh', 'Kaddy Bojang']
const DEFAULT_PASSWORD = 'damia2026'
const REQUIRE_PASSWORD = false // password disabled for now (like The Desk). Flip to true to re-enable.

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
  return rest
}
function findUser(username) {
  return seedUsers().find((u) => u.username === username.toLowerCase())
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const s = sessions[token]
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'unauthorized' })
  const real = findUser(s.username)
  if (!real) return res.status(401).json({ error: 'unauthorized' })
  // "View as": a manager may impersonate another user for READ-ONLY viewing.
  let effective = real
  let isViewAs = false
  const va = req.headers['x-view-as']
  if (va && real.role === 'manager') {
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
function managerOnly(req, res, next) {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'forbidden' })
  next()
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
  if (REQUIRE_PASSWORD && !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  sessions[token] = { username: user.username, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }
  persistSessions()
  res.json({ token, user: publicUser(user) })
})

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }))

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
    req.realUser.role === 'manager'
      ? merged
      : merged.map(({ nextActionNote, ...p }) => p)
  res.json({ team: roster })
})

// ---------- staff onboarding (manager only) ----------
// list staff created via Pulse (includes salary — manager eyes only)
app.get('/api/staff', auth, managerOnly, (req, res) => {
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
app.post('/api/staff', auth, managerOnly, notViewAs, (req, res) => {
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
app.post('/api/staff/:username/archive', auth, managerOnly, notViewAs, (req, res) => {
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
app.post('/api/staff/:username/restore', auth, managerOnly, notViewAs, (req, res) => {
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
app.get('/api/past-agents', auth, managerOnly, (req, res) => {
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
app.get('/api/users', auth, managerOnly, (req, res) => {
  const users = seedUsers()
    .filter((u) => u.username !== req.realUser.username && !isArchived(u))
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.role,
      department: u.department,
      title: u.title,
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
app.get('/api/attendance', auth, managerOnly, (req, res) => {
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
  const roster = req.user.role === 'manager'
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
app.put('/api/schedules', auth, managerOnly, notViewAs, (req, res) => {
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
app.put('/api/schedules/:username', auth, managerOnly, notViewAs, (req, res) => {
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

app.get('/api/leave', auth, managerOnly, (req, res) => {
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
app.post('/api/leave/:id/approve', auth, notViewAs, managerOnly, decideLeave('approved'))
app.post('/api/leave/:id/reject', auth, notViewAs, managerOnly, decideLeave('rejected'))

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
  const roster = req.user.role === 'manager'
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
app.put('/api/attendance/day', auth, managerOnly, notViewAs, (req, res) => {
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
  const who = req.user.role === 'manager' && req.query.username ? req.query.username : req.user.username
  const list = db.read('benefits', []).filter((b) => b.username === who)
  res.json({ benefits: list })
})

app.post('/api/benefits', auth, managerOnly, notViewAs, (req, res) => {
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

app.delete('/api/benefits/:id', auth, managerOnly, notViewAs, (req, res) => {
  db.write('benefits', db.read('benefits', []).filter((b) => b.id !== req.params.id))
  res.json({ ok: true })
})

// manager: roster for the payroll picker — username + salary fields, active staff only
app.get('/api/payroll/people', auth, managerOnly, (req, res) => {
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
  const who = req.user.role === 'manager' && req.query.username ? req.query.username : req.user.username
  const list = db.read('payslips', [])
    .filter((p) => p.username === who)
    .map((p) => ({ ...p, net: netOf(p) }))
    .sort((a, b) => (a.period < b.period ? 1 : -1))
  res.json({ payslips: list })
})

// manager: auto-draft a payslip from the roster salary (not saved — just a starting point)
app.get('/api/payslips/draft', auth, managerOnly, (req, res) => {
  const { username, period } = req.query
  const r = rosterFor(username)
  if (!r) return res.status(404).json({ error: 'No salary on file for this person' })
  const earnings = [{ label: 'Base salary', amount: Number(r.base) || 0 }]
  if (Number(r.commission) > 0) earnings.push({ label: 'Commission', amount: Number(r.commission) })
  if (Number(r.transport) > 0) earnings.push({ label: 'Transport allowance', amount: Number(r.transport) })
  res.json({ draft: { username, period: /^\d{4}-\d{2}$/.test(period || '') ? period : '', earnings, deductions: [] } })
})

app.post('/api/payslips', auth, managerOnly, notViewAs, (req, res) => {
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

app.delete('/api/payslips/:id', auth, managerOnly, notViewAs, (req, res) => {
  db.write('payslips', db.read('payslips', []).filter((p) => p.id !== req.params.id))
  res.json({ ok: true })
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
app.post('/api/announcements', auth, notViewAs, managerOnly, (req, res) => {
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
app.delete('/api/announcements/:id', auth, notViewAs, managerOnly, (req, res) => {
  db.write('announcements', db.read('announcements', []).filter((a) => a.id !== req.params.id))
  res.json({ ok: true })
})

// ---------- coaching / flags / meetings (manager -> staff) ----------
// type: 'coaching' | 'flag' | 'meeting'. Staff see their own; managers manage all.
app.get('/api/coaching', auth, (req, res) => {
  let all = db.read('coaching', [])
  if (req.user.role === 'manager' && !req.isViewAs) {
    if (req.query.user) all = all.filter((c) => c.targetUsername === req.query.user)
  } else {
    all = all.filter((c) => c.targetUsername === req.user.username)
  }
  all = all.slice().sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
  res.json({ coaching: all })
})
app.post('/api/coaching', auth, notViewAs, managerOnly, (req, res) => {
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
app.delete('/api/coaching/:id', auth, notViewAs, managerOnly, (req, res) => {
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
app.post('/api/marketing/:section', auth, managerOnly, notViewAs, (req, res) => {
  const { section } = req.params
  if (!MKT_SECTIONS.includes(section)) return res.status(400).json({ error: 'Unknown section' })
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const data = { ...MKT_DEFAULT, ...db.read('marketing', {}) }
  data[section] = items
  db.write('marketing', data)
  res.json({ [section]: items })
})

seedUsers()
seedSales()
app.listen(PORT, () => console.log(`Damia Staff API on http://localhost:${PORT}`))
