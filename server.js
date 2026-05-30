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
  const { name, email, title, salary, target, contractMonths } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' })
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' })
  const users = seedUsers()
  if (users.some((u) => (u.email || '').toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: 'A staff member with that email already exists' })

  const username = uniqueUsername(usernameFor(name))
  const joined = todayKey()
  const months = Number(contractMonths) || 0
  const contract = months > 0 ? `${months}-month fixed` : 'Indefinite'
  const contractEnd = months > 0 ? addMonths(joined, months) : null
  const tgt = Number(target) || 5
  const cleanTitle = String(title || 'Sales Agent').trim()

  const rec = {
    username,
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    role: 'staff',
    department: 'Sales',
    title: cleanTitle,
    passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
    mustChangePassword: true,
    salary: Number(salary) || 0,
    target: tgt,
    kpi: `Close ${tgt} tracker sales per month`,
    weeklyTarget: 'Close 2 sales, generate 5 leads',
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
  res.json({ requests: mine, annualUsed, annualEligible, eligibleFrom, monthsService })
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
  res.json({ requests: status ? all.filter((l) => l.status === status) : all })
})

function decideLeave(status) {
  return (req, res) => {
    const all = db.read('leave', [])
    const rec = all.find((l) => l.id === req.params.id)
    if (!rec) return res.status(404).json({ error: 'not found' })
    rec.status = status
    rec.decidedBy = req.user.name
    rec.decidedAt = new Date().toISOString()
    db.write('leave', all)
    res.json({ request: rec })
  }
}
app.post('/api/leave/:id/approve', auth, notViewAs, managerOnly, decideLeave('approved'))
app.post('/api/leave/:id/reject', auth, notViewAs, managerOnly, decideLeave('rejected'))

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
