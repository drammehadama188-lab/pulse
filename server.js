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
import { rosterPay, pastStaffPay, payrollHistory as legacyPayrollHistory, totalPayroll } from './lib/roster-pay.js'
import { sallyCustomers, sallyMonthlyHistory } from './src/data/sally-sales-seed.js'
import { buildPayrollHistory, zohoConfigured, paySources, recordSalaryPayment, resolveVendor, getExpense, deleteExpense, updateSalaryExpense, existingSalaryExpense, salaryExpensesForMonth } from './lib/zoho-books.js'
import { sendMail, emailConfigured } from './lib/email.js'
// The contract, composed from the record using HIS OWN agreement wording.
import { contractHtml, missingForContract } from './lib/contract.js'
// The performance model — weights, bands and the three-source calculation —
// lives in ONE file the server and the pages both import (lib/, not src/).
import {
  PERF_WEIGHTS, overallPerformance, workKpiScore, managerAssessment, perfStatus, prevMonthKey,
} from './lib/performance-model.js'

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

// ---------- BEING BUILT vs BEING EMPLOYED (Adama 30 Aug) ----------
// "the account should be set up pending completion ... it means it's being
// worked on rather than starting each time i close it", and then: "we should
// have two — Complete which makes it all good, and Activate which makes it
// active. we can have both."
//
// 🔒 THEY ARE TWO DIFFERENT FACTS and both are needed:
//   pending  — the record is being built. Save and close and come back to it.
//   complete — every required field is there. The record is good.
//   active   — they are actually employed. Payable, scheduled, scored.
// A record can be complete days before the person starts, so completing it must
// not start paying them.
//
// 🔴 A DRAFT IS NOT ON STAFF. The roster is built by `!isArchived(u)` in ~47
// places — payroll, attendance, schedules, the performance board, team lists.
// Without this, typing a name on step 1 would put a half-made person into a
// payroll run and mark them absent for days they have not started.
const DRAFT_STATUSES = new Set(['pending', 'complete'])
function isDraft(u) {
  return DRAFT_STATUSES.has(u?.status)
}
// On staff = a real employee today. Use this anywhere money, time or a score is
// involved; use !isArchived where the question is "does this record exist".
function isOnStaff(u) {
  return !!u && !isArchived(u) && !isDraft(u)
}
function draftNameSet() {
  return new Set(seedUsers().filter(isDraft).map((u) => u.name))
}
// What a record needs before it can be called complete. 🔒 Documents and Pulse
// access are NEVER on this list — Adama's own rule is that a missing document
// does not block anything, and somebody can be employed with no sign-in.
function missingForComplete(u) {
  const gaps = []
  if (!String(u.name || '').trim()) gaps.push('Full name')
  if (!String(u.title || '').trim()) gaps.push('Job title')
  if (!String(u.department || '').trim()) gaps.push('Department')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(u.joined || ''))) gaps.push('Start date')
  if (!String(u.employmentType || '').trim()) gaps.push('Employment type')
  if (!(Number(u.pay?.base) > 0 || Number(u.salary) > 0)) gaps.push('Base salary')
  return gaps
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
    isOnStaff(u) &&
    !u.contractor &&
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
    // 🔴 A draft is not payroll's problem. This feeds the payroll roster.
    .filter((u) => u.createdViaPulse && isOnStaff(u))
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
// A hiring-list import is one whole CSV in the body — a few hundred applicants
// is well past the 100kb default, and this parser has to run BEFORE the global
// one or the request is rejected before reaching the route (19 Aug).
app.use('/api/applicants/import', express.json({ limit: '10mb' }))
// A CV is a PDF in the body, past the default too. Same rule: before the global.
const bigJson = express.json({ limit: '10mb' })
app.use('/api/applicants', (req, res, next) => (/\/cv$/.test(req.path) ? bigJson(req, res, next) : next()))
// An employee document is a PDF in the body as well. Without this it hit the
// 100kb default and every real contract was rejected: 27 Aug the HR import
// filed three small files for Yafatou and silently lost the other six —
// including both contracts — because a 600kb PDF base64s well past 100kb.
app.use('/api/agent-files', bigJson)
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
  // salary + pay split are manager-only (served via /api/staff), never via /me or /users
  const { passwordHash, salary, pay, ...rest } = u
  // resolved powers ride along so the UI can gate sections client-side;
  // the server re-checks every request regardless. isTeamLead unlocks the MY
  // TEAM nav section (gated again server-side on /api/team/*).
  return { ...rest, roleId: u.roleId || null, powers: powersFor(u), isTeamLead: leadsATeam(u), approvalsBeyondTeam: approvalsBeyondTeam(u), canCoachingEdit: canSub(u, 'team', 'coaching-edit'), canCoachingDelete: canSub(u, 'team', 'coaching-delete'), canDocsEdit: canSub(u, 'hr', 'files-edit'), canDocsDelete: canSub(u, 'hr', 'files-delete'), canRecordsEdit: canSub(u, 'hr', 'records'), canPayEdit: canSub(u, 'payroll', 'edit'), canMoveDepartment: canSub(u, 'staffadmin', 'add') }
}
// Accepts a username OR an email (Adama 6 Jul: staff know their email, not the
// internal username — Momodou typed his email and got "Unknown username").
// Usernames never contain '@', so the two can't collide.
function findUser(id) {
  const q = String(id || '').trim().toLowerCase()
  // 🔴 A BLANK LOOKUP MATCHES NOBODY. Somebody hired before their work email
  // exists is stored with no email (Adama 30 Aug), and without this guard
  // findUser('') matched the first of them on `(u.email || '') === ''` — a
  // whitespace username at the login door would have resolved to a real
  // account.
  if (!q) return undefined
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

// ---------- login brute-force lockout (Adama 15 Jul security fix) ----------
// In-memory, per (email + client IP): LOGIN_MAX_FAILS failures inside the window
// → locked for LOGIN_LOCK_MS. Cleared on a successful login. Mirrors the admin
// app's lockout. A constant dummy hash is always compared for unknown emails so
// response timing can't distinguish "no such account" from "wrong password".
const LOGIN_DUMMY_HASH = bcrypt.hashSync('x'.repeat(24), 10)
const loginFails = new Map() // key -> { count, firstAt, lockedUntil }
const LOGIN_MAX_FAILS = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCK_MS = 15 * 60 * 1000
const loginKey = (username, req) => `${String(username || '').toLowerCase()}|${clientIp(req)}`
const loginLocked = (key) => { const r = loginFails.get(key); return !!(r && r.lockedUntil > Date.now()) }
function loginRecordFail(key) {
  const now = Date.now()
  let r = loginFails.get(key)
  if (!r || now - r.firstAt > LOGIN_WINDOW_MS) r = { count: 0, firstAt: now, lockedUntil: 0 }
  r.count++
  if (r.count >= LOGIN_MAX_FAILS) r.lockedUntil = now + LOGIN_LOCK_MS
  loginFails.set(key, r)
}
const loginClear = (key) => loginFails.delete(key)

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const key = loginKey(username, req)
  if (loginLocked(key)) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' })

  const user = username ? findUser(username) : null
  // Always run bcrypt (against a dummy hash for unknown users) so timing is
  // uniform and a wrong email is indistinguishable from a wrong password.
  const passwordOk = REQUIRE_PASSWORD
    ? bcrypt.compareSync(password || '', user?.passwordHash || LOGIN_DUMMY_HASH)
    : true
  if (!user || !passwordOk) {
    loginRecordFail(key)
    // ONE generic message — never reveal whether the email exists (was four
    // distinct messages that let an attacker enumerate real staff accounts).
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  // Password is correct — only now is it safe to tell the real account holder
  // about account state (these states no longer leak to wrong-password probes).
  if (isArchived(user)) return res.status(403).json({ error: 'This account is archived. Speak to Adama.' })
  // 🔒 A record still being built is not an account. Activating them is what
  // opens the door, not the existence of a row with an email on it.
  if (isDraft(user)) return res.status(403).json({ error: 'This account is not active yet. Speak to Adama.' })
  if (user.suspended) return res.status(403).json({ error: 'Your sign-in is paused. Speak to Adama.' })

  loginClear(key)
  const token = crypto.randomBytes(24).toString('hex')
  sessions[token] = { username: user.username, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }
  persistSessions()
  res.json({ token, user: publicUser(user) })
})

app.get('/api/me', auth, (req, res) => {
  // Own pay is fine to return to the person themselves (never bundled, never
  // another person's). Keyed by name; created-via-Pulse staff use u.salary.
  const own = rosterPay[req.user.name]
    || (req.user.pay ? { base: Number(req.user.pay.base) || 0, commission: Number(req.user.pay.commission) || 0, transport: Number(req.user.pay.transport) || 0, total: Number(req.user.pay.total) || 0 } : null)
    || (req.user.salary ? { base: 0, commission: 0, transport: 0, total: Number(req.user.salary) } : null)
  res.json({ user: publicUser(req.user), pay: own })
})

// Change own password. Verifies the current one, swaps the hash, clears the
// first-login flag, and signs out every other session for this account.
// ---------- access powers: list + grant/revoke ----------
// The catalogue, for building the toggle UI.
app.get('/api/powers', auth, (req, res) => {
  res.json({ powers: POWERS.map(([key, label, detail]) => ({ key, label, detail, subs: (SUBPOWERS[key] || []).map(([k, l, d]) => ({ key: k, label: l, detail: d })) })) })
})

// ---------- ROLES (Adama 27 Aug: "stop assigning 50 permissions person by
// person" — the arrangement admin got on 25 Aug, in Pulse) ----------
//
// A role owns WHAT someone can do: the powers, and the capability sub-toggles
// inside each. 🔒 It deliberately does NOT own WHO they cover
// (`permissionScopes`) — his call, 27 Aug. Coverage stays on the person, so
// assigning a role can never silently widen which staff a manager can see.
//
// 🔑 `user.permissions` / `permissionSubs` remain the ONE set every gate
// reads (powersFor, can, canSub). Roles write into them; nothing about
// enforcement changed. A person carries `roleId`, and `customKeys` records
// where they deliberately differ from their role.
const BUILTIN_ROLES = [
  { id: 'owner', name: 'Owner', description: 'Everything. The CEO only.', powers: [...POWER_KEYS], subs: {} },
  { id: 'manager', name: 'Manager', description: 'Runs a team: approvals, presence, coaching.', powers: ['approvals', 'team'], subs: {} },
  { id: 'hr-admin', name: 'HR admin', description: 'People records, contracts and documents.', powers: ['hr', 'staffadmin', 'approvals'], subs: {} },
  { id: 'staff', name: 'Staff', description: 'No management access. Their own work only.', powers: [], subs: {} },
]
function loadRoles() {
  const stored = db.read('roles', null)
  if (Array.isArray(stored) && stored.length) return stored
  const seeded = BUILTIN_ROLES.map((r) => ({ ...r, builtin: true }))
  db.write('roles', seeded)
  return seeded
}
function roleById(id) {
  return loadRoles().find((r) => r.id === id) || null
}
// What a role grants, cleaned against the live catalogues so a stale role
// cannot hand out a power that no longer exists.
function roleGrant(role) {
  const powers = (role?.powers || []).filter((p) => POWER_KEYS.includes(p))
  const subs = {}
  for (const [k, v] of Object.entries(role?.subs || {})) {
    if (!SUBPOWERS[k] || !Array.isArray(v)) continue
    const valid = new Set(SUBPOWERS[k].map(([sk]) => sk))
    subs[k] = v.filter((s) => valid.has(s))
  }
  return { powers, subs }
}
// Where this person differs from their role — the keys they were given or
// denied on purpose. Shown with a mark in the UI so an exception is never
// invisible.
function customKeysFor(user) {
  const role = roleById(user.roleId)
  if (!role) return []
  const { powers } = roleGrant(role)
  const mine = new Set(powersFor(user))
  const theirs = new Set(powers)
  return [...new Set([...mine, ...theirs])].filter((k) => mine.has(k) !== theirs.has(k))
}
// Boot migration. 🔒 Reads only — it never changes anyone's permissions. It
// labels each person with the role that best matches what they ALREADY have,
// so the first screen he opens is honest rather than a reset.
function ensureRoles() {
  const roles = loadRoles()
  const users = seedUsers()
  let touched = false
  for (const u of users) {
    if (u.roleId || u.username === CEO) {
      if (u.username === CEO && u.roleId !== 'owner') { u.roleId = 'owner'; touched = true }
      continue
    }
    const mine = new Set(powersFor(u))
    // The closest role by what they hold now; ties go to the smaller role, so
    // nobody is labelled with more authority than they actually have.
    let best = 'staff'
    let bestScore = -1
    for (const r of roles) {
      if (r.id === 'owner') continue
      const theirs = new Set(roleGrant(r).powers)
      const overlap = [...mine].filter((k) => theirs.has(k)).length
      const wrong = [...theirs].filter((k) => !mine.has(k)).length + [...mine].filter((k) => !theirs.has(k)).length
      const score = overlap * 10 - wrong
      if (score > bestScore || (score === bestScore && theirs.size < roleGrant(roleById(best)).powers.length)) {
        best = r.id
        bestScore = score
      }
    }
    u.roleId = best
    touched = true
  }
  if (touched) db.write('users', users)
  return roles
}

app.get('/api/roles', auth, requireCeo, (req, res) => {
  const roles = ensureRoles()
  const users = seedUsers().filter((u) => !isArchived(u))
  res.json({
    // 🔑 Names, not just a count. "2 people" tells him nothing he can act on
    // — he asked who (27 Aug). The count stays for the summary line.
    roles: roles.map((r) => {
      const mine = users.filter((u) => u.roleId === r.id)
      return {
        ...r,
        members: mine.length,
        memberNames: mine.map((u) => u.name || u.username),
      }
    }),
    powers: POWERS.map(([key, label, detail]) => ({
      key, label, detail,
      subs: (SUBPOWERS[key] || []).map(([k, l, d]) => ({ key: k, label: l, detail: d })),
    })),
  })
})

app.post('/api/roles', auth, notViewAs, requireCeo, (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Give the role a name' })
  const roles = loadRoles()
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  if (!id) return res.status(400).json({ error: 'Give the role a name' })
  if (roles.some((r) => r.id === id)) return res.status(409).json({ error: 'A role with that name already exists' })
  const { powers, subs } = roleGrant(req.body || {})
  const role = { id, name, description: String(req.body?.description || '').trim().slice(0, 160), powers, subs, builtin: false }
  roles.push(role)
  db.write('roles', roles)
  res.json({ role })
})

// Editing a role pushes the change to everyone in it — that is the whole
// point of roles. 🔑 A member's deliberate exceptions (customKeys) are
// PRESERVED: a role edit must not quietly undo a decision he made about one
// person.
app.put('/api/roles/:id', auth, notViewAs, requireCeo, (req, res) => {
  const roles = loadRoles()
  const role = roles.find((r) => r.id === req.params.id)
  if (!role) return res.status(404).json({ error: 'No such role' })
  if (role.id === 'owner') return res.status(403).json({ error: 'The Owner role cannot be edited' })

  const beforeGrant = roleGrant(role)
  const { powers, subs } = roleGrant(req.body || {})
  if (typeof req.body?.name === 'string' && req.body.name.trim()) role.name = req.body.name.trim().slice(0, 60)
  if (typeof req.body?.description === 'string') role.description = req.body.description.trim().slice(0, 160)
  role.powers = powers
  role.subs = subs
  db.write('roles', roles)

  const users = seedUsers()
  let changed = 0
  for (const u of users) {
    if (u.roleId !== role.id || u.username === CEO || isArchived(u)) continue
    const mine = new Set(powersFor(u))
    const wasTheirs = new Set(beforeGrant.powers)
    // Keys this person differs on stay as they are; everything else follows
    // the role.
    const custom = [...mine].filter((k) => !wasTheirs.has(k))
    const denied = [...wasTheirs].filter((k) => !mine.has(k))
    const next = new Set(powers.filter((k) => !denied.includes(k)))
    for (const k of custom) next.add(k)
    const before = powersFor(u)
    u.permissions = [...next]
    u.permissionSubs = { ...subs }
    u.accessLog = [...(u.accessLog || []), {
      at: new Date().toISOString(), by: req.realUser.username,
      before, after: u.permissions, scopes: u.permissionScopes || {}, subs: u.permissionSubs || {},
      roleEdit: role.id,
    }]
    changed++
  }
  db.write('users', users)
  res.json({ role, membersUpdated: changed })
})

app.delete('/api/roles/:id', auth, notViewAs, requireCeo, (req, res) => {
  const roles = loadRoles()
  const role = roles.find((r) => r.id === req.params.id)
  if (!role) return res.status(404).json({ error: 'No such role' })
  if (role.builtin) return res.status(403).json({ error: 'A built-in role cannot be deleted' })
  const members = seedUsers().filter((u) => u.roleId === role.id && !isArchived(u)).length
  if (members) return res.status(409).json({ error: `${members} ${members === 1 ? 'person is' : 'people are'} on this role. Move them first.` })
  db.write('roles', roles.filter((r) => r.id !== role.id))
  res.json({ ok: true })
})

// Assigning a role RESETS the person to that role's set and clears their
// exceptions — the deliberate opposite of a role edit. 🔒 Their coverage
// (permissionScopes) is untouched: who they look after is a separate
// decision from what they can do.
app.post('/api/staff/:username/role', auth, notViewAs, requireCeo, (req, res) => {
  const target = String(req.params.username).toLowerCase()
  if (target === CEO) return res.status(403).json({ error: 'The CEO’s access cannot be edited' })
  const role = roleById(String(req.body?.roleId || ''))
  if (!role) return res.status(404).json({ error: 'No such role' })
  if (role.id === 'owner') return res.status(403).json({ error: 'The Owner role belongs to the CEO alone' })
  const users = seedUsers()
  const user = users.find((u) => u.username === target)
  if (!user) return res.status(404).json({ error: 'No such user' })

  const before = powersFor(user)
  const { powers, subs } = roleGrant(role)
  user.roleId = role.id
  user.permissions = [...powers]
  user.permissionSubs = { ...subs }
  user.accessLog = [...(user.accessLog || []), {
    at: new Date().toISOString(), by: req.realUser.username,
    before, after: user.permissions, scopes: user.permissionScopes || {}, subs: user.permissionSubs || {},
    roleAssigned: role.id,
  }]
  db.write('users', users)
  res.json({ ok: true, user: publicUser(user) })
})

// Every access change across everyone, newest first. Built from the
// accessLog Pulse has always kept on each user — nothing new to record.
app.get('/api/access-activity', auth, requireCeo, (req, res) => {
  const users = seedUsers()
  const nameOf = Object.fromEntries(users.map((u) => [u.username, u.name]))
  const rows = []
  for (const u of users) {
    for (const e of u.accessLog || []) {
      const before = new Set(e.before || [])
      const after = new Set(e.after || [])
      rows.push({
        at: e.at,
        who: u.name || u.username,
        by: nameOf[e.by] || e.by || '',
        gained: [...after].filter((k) => !before.has(k)),
        lost: [...before].filter((k) => !after.has(k)),
        signIn: e.signIn || null,
        roleAssigned: e.roleAssigned || null,
        roleEdit: e.roleEdit || null,
      })
    }
  }
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  res.json({ activity: rows.slice(0, 300) })
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

  // 🔒 PERMISSIONS COME FROM THE ROLE (Adama 28 Aug: "all permission toggles
  // should live here [the role page], not in their individual pages").
  // Enforced on the SERVER, not only by hiding the toggles: a rule the server
  // does not hold is a convention, and the next thing to POST here would not
  // know about it. This endpoint still carries email, personal email, the
  // sign-in switch and per-person COVERAGE — the client echoes the current
  // powers back alongside them, so an unchanged echo passes and only a real
  // change is refused.
  const sameSet = (a, b) => {
    const A = [...new Set(a)].sort(); const B = [...new Set(b)].sort()
    return A.length === B.length && A.every((v, i) => v === B[i])
  }
  if (!sameSet(requested, before)) {
    return res.status(409).json({ error: 'Permissions come from the role. Change them on the role in Settings › Team & access.' })
  }
  if (req.body?.subs && typeof req.body.subs === 'object') {
    const now = user.permissionSubs || {}
    // 🔴 THE DEFAULT HAS TO BE RESOLVED BEFORE COMPARING. `no stored list`
    // means EVERY capability (canSub: `!Array.isArray(stored) || …`), so
    // reading `now[k]` as an empty list — or worse, falling back to the
    // incoming list — made a narrowing look unchanged. It compared the
    // payload with itself and let subs through: {"team":["schedules"]}
    // silently stripped coaching, edit and delete from someone whose role
    // still granted them. Caught by excel-a0 against a running server.
    const stored = (k) => (Array.isArray(now[k]) ? now[k] : (SUBPOWERS[k] || []).map(([sk]) => sk))
    const keys = [...new Set([...Object.keys(req.body.subs), ...Object.keys(now)])].filter((k) => SUBPOWERS[k])
    const changed = keys.some((k) => {
      const incoming = Array.isArray(req.body.subs[k]) ? req.body.subs[k] : null
      // A key the caller did not send is not a change to it.
      return incoming !== null && !sameSet(incoming, stored(k))
    })
    if (changed) {
      return res.status(409).json({ error: 'What a permission can do comes from the role. Change it on the role in Settings › Team & access.' })
    }
  }

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
  // Personal email — on-file contact only, never a login. Empty string clears it.
  if (typeof req.body?.personalEmail === 'string') {
    const pe = req.body.personalEmail.trim().toLowerCase()
    if (pe && !/^\S+@\S+\.\S+$/.test(pe)) return res.status(400).json({ error: 'Invalid personal email' })
    user.personalEmail = pe
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
      personalEmail: u.personalEmail || '',
      title: u.title,
      department: u.department,
      role: u.role,
      status: u.status,
      salary: u.salary,
      pay: u.pay || null,
      phone: u.phone || '',
      address: u.address || '',
      target: u.target,
      kpi: u.kpi,
      contract: u.contract,
      contractEnd: u.contractEnd,
      probationEnd: u.probationEnd || null,
      joined: u.joined,
      createdAt: u.createdAt,
    }))
  res.json({ staff })
})

// create a sales staff account
app.post('/api/staff', auth, requireSub('staffadmin', 'add'), notViewAs, async (req, res) => {
  const { type, name, email, personalEmail, title, salary, target, contractMonths, baseSalary, transport, commission, probationMonths, phone, address } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' })
  // Two emails (Adama 19 Aug, Mustapha entered under his gmail): `email` is
  // the WORK one — it's the login and where the invite goes; personalEmail
  // is the on-file contact only, never a login.
  // 🔒 THE WORK EMAIL IS CREATED LATER (Adama 30 Aug): "the work email is
  // created after this part is done when we get her letter out and all that
  // then we can send her the log in". So it is OPTIONAL here — somebody can be
  // on the roster, on payroll and on a schedule before they can sign in. It
  // must still be a real address when one IS given.
  // 🔒 The personal email is NEVER a sign-in. It is contact on file.
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'That work email is not valid' })
  const cleanPersonal = String(personalEmail || '').trim().toLowerCase()
  if (cleanPersonal && !/^\S+@\S+\.\S+$/.test(cleanPersonal)) return res.status(400).json({ error: 'The personal email is not valid' })
  const users = seedUsers()
  if (cleanEmail && users.some((u) => (u.email || '').toLowerCase() === cleanEmail))
    return res.status(409).json({ error: 'A staff member with that email already exists' })

  const isMgr = type === 'manager'
  const username = uniqueUsername(usernameFor(name))
  // Start date can be backdated (Adama 3 Aug: Abdourahman joined in July but
  // was only entered in August — payroll hides months before someone joined,
  // so the real start date matters). Defaults to today.
  const joined = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.joined || '') ? req.body.joined : todayKey()
  const months = Number(contractMonths) || 0
  const contract = months > 0 ? `${months}-month fixed` : 'Indefinite'
  const contractEnd = months > 0 ? addMonths(joined, months) : null
  // managers oversee everything across departments — no preset sales goal (set manually later)
  const tgt = isMgr ? 0 : Number(target) || 5
  const cleanTitle = String(title || (isMgr ? 'Manager' : 'Sales Agent')).trim()
  // Pay split mirrors rosterPay's shape ({base, commission, transport, total},
  // total = the "up to" figure). `salary` stays the guaranteed monthly payment
  // (base + transport) — it's what payroll suggests; commission is on-target only.
  const payBase = Number(baseSalary ?? salary) || 0
  const payTransport = Number(transport) || 0
  const payCommission = Number(commission) || 0
  const probMonths = Number(probationMonths) || 0
  const probationEnd = probMonths > 0 ? addMonths(joined, probMonths) : null

  // ---- What the Add-employee wizard collects that the old modal never did
  // (Adama 30 Aug). Each is optional: leave it out and the record is exactly
  // what it was before, so nothing that already creates staff has to change.
  //
  // 🔑 EMPLOYMENT TYPE IS NOW STATED, NOT GUESSED. It used to be inferred —
  // "Contractor" if the contractor flag was set, "Contract" if there was an end
  // date, otherwise "Full-time" — which had no way to say part-time or intern,
  // and called a part-timer full-time.
  const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Fixed term', 'Contractor', 'Intern']
  const employmentType = EMPLOYMENT_TYPES.includes(String(req.body?.employmentType || '').trim())
    ? String(req.body.employmentType).trim()
    : null
  // A contractor keeps no schedule and never checks in — the flag's whole
  // meaning. Picking the type is now how that gets set, instead of a separate
  // trip to another endpoint after the person exists.
  const isContractor = employmentType === 'Contractor'
  // Who they report to. It lives on the profile, like every other HR field, and
  // has to be somebody actually here.
  const manager = String(req.body?.manager || '').trim()
  if (manager && !users.some((u) => !isArchived(u) && u.name === manager)) {
    return res.status(400).json({ error: 'Reports to must be someone on the team' })
  }
  // 🔒 Pulse ACCESS is not the job title. A role is granted deliberately or not
  // at all, and only the CEO may grant one — the same rule the Team & access
  // page enforces. Anyone else creating a person creates them with no access.
  const roleId = String(req.body?.roleId || '').trim()
  let grantRole = null
  if (roleId) {
    if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'Only the CEO grants Pulse access' })
    if (roleId === 'owner') return res.status(403).json({ error: 'The Owner role belongs to the CEO alone' })
    grantRole = roleById(roleId)
    if (!grantRole) return res.status(400).json({ error: 'Unknown access role' })
  }

  const rec = {
    username,
    name: String(name).trim(),
    email: cleanEmail,
    personalEmail: cleanPersonal,
    role: isMgr ? 'manager' : 'staff',
    // Picked on the form; a manager still defaults to Management and
    // everyone else to Sales when nothing is chosen (Adama 20 Aug).
    department: DEPARTMENTS.includes(String(req.body?.department || '').trim())
      ? String(req.body.department).trim()
      : (isMgr ? 'Management' : 'Sales'),
    title: cleanTitle,
    passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
    mustChangePassword: true,
    salary: payBase + payTransport,
    pay: { base: payBase, commission: payCommission, transport: payTransport, total: payBase + payCommission + payTransport },
    phone: String(phone || '').trim(),
    address: String(address || '').trim(),
    employmentType,
    contractor: isContractor,
    probationEnd,
    target: tgt,
    kpi: isMgr ? '' : `Close ${tgt} tracker sales per month`,
    weeklyTarget: isMgr ? '' : 'Close 2 sales, generate 5 leads',
    contract,
    contractEnd,
    joined,
    // 🔒 Created by the Add-employee wizard = PENDING, never active. The record
    // is being built; it becomes an employee when it is activated.
    status: req.body?.draft === false ? 'active' : 'pending',
    // Step 1 is behind them the moment the record exists.
    draftStep: 1,
    createdViaPulse: true,
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    history: [
      {
        date: joined,
        event: `Joined as ${cleanTitle} — ${contract}${contractEnd ? ` (ends ${contractEnd})` : ''}${probationEnd ? ` · probation to ${probationEnd}` : ''}`,
      },
    ],
  }
  if (grantRole) {
    const { powers, subs } = roleGrant(grantRole)
    rec.roleId = grantRole.id
    rec.permissions = [...powers]
    rec.permissionSubs = { ...subs }
    rec.history.push({ date: joined, event: `Pulse access — ${grantRole.name}` })
  }
  users.push(rec)
  db.write('users', users)

  if (manager) {
    const profiles = db.read('profiles', {})
    profiles[rec.name] = { ...(profiles[rec.name] || {}), manager }
    db.write('profiles', profiles)
    rec.history.push({ date: joined, event: `Reports to ${manager}` })
  }
  // A working week from the day they start. 🔒 A contractor gets none — that is
  // what being a contractor means here, and a schedule they never agreed to is
  // what filled their record with red "No clock in" days.
  const week = req.body?.schedule
  if (!isContractor && week && typeof week === 'object') {
    const schedules = db.read('schedules', {})
    upsertSchedule(schedules, username, { from: joined, days: week })
    db.write('schedules', schedules)
  }
  db.write('users', users)

  // Email the invite (a set-password link) right away — best effort: the
  // account exists either way, and the modal tells the manager what happened.
  let invited = false
  // Nothing to invite yet. The sign-in is sent from their record on the day the
  // work email exists.
  if (cleanEmail && (emailConfigured() || String(process.env.OUTBOUND_EMAIL || '').toLowerCase() === 'off')) {
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

// ---------- a record being built (Adama 30 Aug) ----------
// The wizard saves after EVERY step, so closing it never costs anything. These
// only ever touch a DRAFT: once somebody is activated their record is edited
// through the record page and payroll, which have their own gates.
// Picking a draft back up. Returns exactly what the wizard needs to refill
// itself — no more, so this can never become a second way to read a staff
// record (pay lives behind the payroll gate, not here... except the draft's own
// pay, which is the thing being edited and which only staffadmin:add can see).
app.get('/api/staff/:username/draft', auth, requireSub('staffadmin', 'add'), (req, res) => {
  const u = seedUsers().find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  if (!isDraft(u)) return res.status(409).json({ error: 'That record is already active — edit it from their profile.' })
  const monthsBetweenDates = (from, to) => {
    if (!from || !to) return ''
    const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`)
    if (isNaN(a) || isNaN(b)) return ''
    return String((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()))
  }
  const week = effectiveWeek(db.read('schedules', {})[u.username], u.joined || todayKey())
  const anyDay = Object.values(week).find(Boolean)
  res.json({
    draft: {
      username: u.username,
      status: u.status,
      step: Math.max(0, Math.min(5, Number(u.draftStep) || 0)),
      name: u.name || '', email: u.email || '', personalEmail: u.personalEmail || '',
      phone: u.phone || '', address: u.address || '',
      title: u.title || '', department: u.department || 'Sales',
      manager: (db.read('profiles', {})[u.name] || {}).manager || '',
      employmentType: u.employmentType || '', joined: u.joined || todayKey(),
      week: Object.fromEntries(Object.keys(week).map((k) => [k, !!week[k]])),
      start: anyDay?.start || '09:00', end: anyDay?.end || '17:00',
      contractMonths: monthsBetweenDates(u.joined, u.contractEnd),
      probationMonths: monthsBetweenDates(u.joined, u.probationEnd),
      baseSalary: u.pay?.base ? String(u.pay.base) : '',
      transport: u.pay?.transport ? String(u.pay.transport) : '',
      commission: u.pay?.commission ? String(u.pay.commission) : '',
      target: u.target != null ? String(u.target) : '5',
      roleId: u.roleId || '',
    },
    missing: missingForComplete(u),
  })
})
const DRAFT_TEXT = ['name', 'email', 'personalEmail', 'title', 'department', 'phone', 'address', 'employmentType']
app.put('/api/staff/:username/draft', auth, requireSub('staffadmin', 'add'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  // 🔒 Refuses on anyone real. A "draft save" must never become a back door
  // that rewrites an employed person's title, department or pay.
  if (!isDraft(u)) return res.status(409).json({ error: 'That record is already active — edit it from their profile.' })
  const b = req.body || {}

  const cleanEmail = String(b.email ?? u.email ?? '').trim().toLowerCase()
  if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'That work email is not valid' })
  if (cleanEmail && users.some((x) => x.username !== u.username && (x.email || '').toLowerCase() === cleanEmail))
    return res.status(409).json({ error: 'A staff member with that email already exists' })
  const cleanPersonal = String(b.personalEmail ?? u.personalEmail ?? '').trim().toLowerCase()
  if (cleanPersonal && !/^\S+@\S+\.\S+$/.test(cleanPersonal)) return res.status(400).json({ error: 'That personal email is not valid' })

  for (const k of DRAFT_TEXT) if (b[k] !== undefined) u[k] = String(b[k] || '').trim()
  u.email = cleanEmail
  u.personalEmail = cleanPersonal
  if (b.department !== undefined && !DEPARTMENTS.includes(u.department)) return res.status(400).json({ error: 'Unknown department' })
  if (b.joined !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(b.joined))) u.joined = String(b.joined)
  if (b.employmentType !== undefined) u.contractor = u.employmentType === 'Contractor'

  if (b.contractMonths !== undefined) {
    const m = Number(b.contractMonths) || 0
    u.contract = m > 0 ? `${m}-month fixed` : 'Indefinite'
    u.contractEnd = m > 0 ? addMonths(u.joined, m) : null
  }
  if (b.probationMonths !== undefined) {
    const pm = Number(b.probationMonths) || 0
    u.probationEnd = pm > 0 ? addMonths(u.joined, pm) : null
  }
  if (b.baseSalary !== undefined || b.transport !== undefined || b.commission !== undefined) {
    const base = Number(b.baseSalary ?? u.pay?.base) || 0
    const transport = Number(b.transport ?? u.pay?.transport) || 0
    const commission = Number(b.commission ?? u.pay?.commission) || 0
    u.pay = { base, commission, transport, total: base + commission + transport }
    u.salary = base + transport
  }
  if (b.target !== undefined) u.target = Number(b.target) || 0
  // 🔒 WHERE THEY GOT TO. Reopening a half-built record at step 1 makes them
  // walk the whole thing again to reach the step they were on — the exact
  // "starting each time i close it" this was built to stop (Adama 30 Aug).
  if (b.step !== undefined) u.draftStep = Math.max(0, Math.min(5, Number(b.step) || 0))
  if (b.manager !== undefined) {
    const manager = String(b.manager || '').trim()
    if (manager && !users.some((x) => isOnStaff(x) && x.name === manager)) return res.status(400).json({ error: 'Reports to must be someone on the team' })
    const profiles = db.read('profiles', {})
    profiles[u.name] = { ...(profiles[u.name] || {}), manager }
    db.write('profiles', profiles)
  }
  // 🔒 Access is the CEO's alone, on a draft exactly as anywhere else.
  if (b.roleId !== undefined && String(b.roleId || '')) {
    if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'Only the CEO grants Pulse access' })
    const role = roleById(String(b.roleId))
    if (!role || role.id === 'owner') return res.status(400).json({ error: 'Unknown access role' })
    const { powers, subs } = roleGrant(role)
    u.roleId = role.id
    u.permissions = [...powers]
    u.permissionSubs = { ...subs }
  }
  if (b.schedule && typeof b.schedule === 'object' && !u.contractor) {
    const schedules = db.read('schedules', {})
    upsertSchedule(schedules, u.username, { from: u.joined || todayKey(), days: b.schedule })
    db.write('schedules', schedules)
  }

  // 🔑 Completeness is a FACT about the record, not a button you can press over
  // a gap. It is recomputed on every save, so the wizard can show what is left.
  const missing = missingForComplete(u)
  if (u.status === 'complete' && missing.length) u.status = 'pending'
  db.write('users', users)
  res.json({ staff: { username: u.username, name: u.name, status: u.status }, missing })
})

// "Complete — makes it all good." The record is finished. They are NOT employed
// yet: a record can be finished days before somebody starts.
app.post('/api/staff/:username/complete', auth, requireSub('staffadmin', 'add'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  if (!isDraft(u)) return res.status(409).json({ error: 'That record is already active.' })
  const missing = missingForComplete(u)
  if (missing.length) return res.status(400).json({ error: `Still missing: ${missing.join(', ')}`, missing })
  u.status = 'complete'
  ;(u.history ||= []).push({ date: todayKey(), event: 'Record completed — ready to activate' })
  db.write('users', users)
  res.json({ status: u.status, missing: [] })
})

// "Activate — makes it active." NOW they are employed: payable, scheduled,
// scored, and able to sign in if they have a work email.
app.post('/api/staff/:username/activate', auth, requireSub('staffadmin', 'add'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  if (isArchived(u)) return res.status(409).json({ error: 'That record is archived.' })
  if (!isDraft(u)) return res.json({ status: u.status })
  const missing = missingForComplete(u)
  if (missing.length) return res.status(400).json({ error: `Cannot activate — still missing: ${missing.join(', ')}`, missing })
  // Probation is a state of an ACTIVE employee, so it resolves on activation
  // rather than being carried as a status through the draft.
  u.status = u.probationEnd && Date.parse(u.probationEnd) >= Date.now() ? 'probation' : 'active'
  ;(u.history ||= []).push({ date: todayKey(), event: `Activated as ${u.title || 'staff'}` })
  db.write('users', users)
  res.json({ status: u.status })
})

// ---------- the contract (Adama 30 Aug) ----------
// "we have to have a contract generator after pay is decided before documents,
// called contracts, that shows the contract, that way you can just send it via
// email to the person and review, and this goes to their files and after they
// sign too."
//
// 🔒 The wording is HIS — lib/contract.js is his own employment agreement with
// the facts filled in from the record. 🔒 Nothing is ever sent without it being
// shown first and Send being pressed: this endpoint only READS.
app.get('/api/staff/:username/contract', auth, requireSub('staffadmin', 'add'), (req, res) => {
  const u = seedUsers().find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  const week = effectiveWeek(db.read('schedules', {})[u.username], u.joined || todayKey())
  const manager = (db.read('profiles', {})[u.name] || {}).manager || ''
  res.json({
    html: contractHtml(u, { week, manager }),
    missing: missingForContract(u, week),
    to: u.personalEmail || u.email || '',
    filed: db.read('agent-files', []).filter((f) => f.agent === u.name && f.category === 'contract').length,
  })
})

// Keep a copy on their file. 🔑 Same category the Documents step reads, so
// filing the contract here ticks "Employment contract" there rather than
// leaving a second, separate idea of the same document.
function fileContract(u, htmlDoc, by) {
  const dir = ensureAgentDir(u.name)
  const id = 'f_' + crypto.randomUUID()
  const storedAs = `${id}.html`
  const buffer = Buffer.from(htmlDoc, 'utf8')
  fs.writeFileSync(path.join(dir, storedAs), buffer)
  const files = db.read('agent-files', [])
  const meta = {
    id, agent: u.name,
    name: `Contract of Employment — ${u.name} (${todayKey()}).html`,
    category: 'contract', mimeType: 'text/html', sizeBytes: buffer.length,
    storedAs, uploadedAt: new Date().toISOString(), uploadedBy: by, generated: true,
  }
  files.push(meta)
  db.write('agent-files', files)
  return meta
}

app.post('/api/staff/:username/contract/file', auth, requireSub('staffadmin', 'add'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  const week = effectiveWeek(db.read('schedules', {})[u.username], u.joined || todayKey())
  const missing = missingForContract(u, week)
  if (missing.length) return res.status(400).json({ error: `The contract cannot be written yet — missing: ${missing.join(', ')}`, missing })
  const manager = (db.read('profiles', {})[u.name] || {}).manager || ''
  const file = fileContract(u, contractHtml(u, { week, manager }), req.user.name || req.user.username)
  ;(u.history ||= []).push({ date: todayKey(), event: 'Contract generated and filed' })
  db.write('users', users)
  res.json({ file })
})

// 🔒 SENDS TO THE PERSONAL EMAIL. That is the whole point of the field: the
// work email does not exist yet when the letter goes out. A copy is filed at
// the same time, so what was sent is always on the record.
app.post('/api/staff/:username/contract/send', auth, requireSub('staffadmin', 'add'), notViewAs, async (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  const to = String(req.body?.to || u.personalEmail || u.email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: 'No valid email to send to — add their personal email on the Personal step.' })
  const week = effectiveWeek(db.read('schedules', {})[u.username], u.joined || todayKey())
  const missing = missingForContract(u, week)
  if (missing.length) return res.status(400).json({ error: `The contract cannot be sent yet — missing: ${missing.join(', ')}`, missing })
  if (!emailConfigured() && String(process.env.OUTBOUND_EMAIL || '').toLowerCase() !== 'off') {
    return res.status(503).json({ error: 'Email is not set up on this server.' })
  }
  const manager = (db.read('profiles', {})[u.name] || {}).manager || ''
  const htmlDoc = contractHtml(u, { week, manager })
  const first = String(u.name || '').split(/\s+/)[0]
  try {
    const result = await sendMail({
      to,
      subject: `Your contract of employment — Damia Tracker Gambia`,
      text: `Dear ${first},\n\nPlease find your contract of employment attached below. Read it carefully, and if you are happy with it, sign and return a copy to us.\n\nDamia Tracker Gambia`,
      html: `<p>Dear ${first},</p><p>Please find your contract of employment below. Read it carefully, and if you are happy with it, sign and return a copy to us.</p><hr>${htmlDoc}`,
    })
    // 🔒 File it whatever the mail server said. A copy of what was sent belongs
    // on the record even if the send later turns out to have bounced.
    const file = fileContract(u, htmlDoc, req.user.name || req.user.username)
    ;(u.history ||= []).push({ date: todayKey(), event: `Contract sent to ${to}` })
    db.write('users', users)
    res.json({ sent: !result.blocked, blocked: !!result.blocked, to, file })
  } catch (e) {
    res.status(502).json({ error: `Could not send: ${e.message}` })
  }
})

// Mark someone as a contractor — stays on payroll and in the staff list, but
// no check-in/out, no schedule, and off every attendance view (Adama 3 Aug:
// Abdourahman is a contractor, he does not check in and out).
app.post('/api/staff/:username/contractor', auth, requireSub('staffadmin', 'add'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  u.contractor = !!req.body?.contractor
  ;(u.history ||= []).push({ date: todayKey(), event: u.contractor ? 'Marked as contractor — no check-in or schedule' : 'Contractor mark removed — back on schedules and check-in' })
  db.write('users', users)
  res.json({ ok: true, contractor: u.contractor })
})

// Move someone to another department (Adama 20 Aug). Department was set once
// at creation — non-managers always landed in Sales — and nothing could change
// it after, so a Lead Technician sat on the sales leaderboard with a sales goal
// he was never given. Department decides the sales goal, the leaderboard and
// My Team, so the move is logged on the person's history like any other change.
const DEPARTMENTS = ['Sales', 'Customer Service', 'Operations', 'Marketing', 'Training', 'Management', 'Leadership']
app.get('/api/departments', auth, (_req, res) => res.json({ departments: DEPARTMENTS }))
app.post('/api/staff/:username/department', auth, requireSub('staffadmin', 'add'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === req.params.username)
  if (!u) return res.status(404).json({ error: 'No such staff member' })
  const next = String(req.body?.department || '').trim()
  if (!DEPARTMENTS.includes(next)) return res.status(400).json({ error: 'Unknown department' })
  const prev = u.department || '—'
  if (prev === next) return res.json({ ok: true, department: next })
  u.department = next
  ;(u.history ||= []).push({ date: todayKey(), event: `Moved from ${prev} to ${next}` })
  db.write('users', users)
  res.json({ ok: true, department: next })
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
  // Active (unexpired) set-password links, so a manager can SEE whether a
  // reset was actually completed instead of guessing (Adama 19 Aug: Mustapha
  // "keeps resetting the password, not working" — nothing on screen said
  // whether he ever opened a link). Read once, never the token itself.
  const activeLinks = readLinks()
  const users = seedUsers()
    .filter((u) => u.username !== req.realUser.username && u.username !== CEO && !isArchived(u))
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.role,
      department: u.department,
      title: u.title,
      email: u.email || null,
      personalEmail: u.personalEmail || '', // on-file contact — never a login
      powers: powersFor(u), // what the role gave them — read-only on the member page
      // The role they are on. Without it the Members list and the member page
      // both read "No role" for everyone no matter what is stored, so a role
      // could be assigned and never seen again (28 Aug).
      roleId: u.roleId || '',
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
      canPayEdit: canSub(u, 'payroll', 'edit'),
      suspended: !!u.suspended,
      contractor: !!u.contractor, // contractors skip check-in/schedules
      // Login state — false means they are still on a password someone else
      // set (invite default or a temporary one), i.e. they never completed a
      // set-password link. Never exposes the hash or the link token.
      passwordChosen: !u.mustChangePassword,
      passwordLinkExpires: activeLinks.find((l) => l.username === u.username)?.exp || null,
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
  if (req.user.contractor) return res.status(403).json({ error: 'Contractors do not check in or out' })
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
  if (req.user.contractor) return res.status(403).json({ error: 'Contractors do not check in or out' })
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
  const roster = seedUsers().filter((u) => u.username !== 'adama' && !isArchived(u) && !u.contractor)
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
// ---------- ASSIGNMENTS: what someone is TOLD TO DO for a period ----------
//
// Adama 30 Aug: "Their roles are their roles and under the role we have
// assignment. what they are told to do within a period. By default their role
// is customer service then that's the job. But lets say i want someone to
// handle a job for a month and be scored by that i can change the assignment
// from customer service to sales manager this is usually temporary. when the
// assignment says a department they will be judged by that".
//
// 🔒 THE MODEL. The ROLE is permanent and owns the title, the pay and what the
// person can do in Pulse. The ASSIGNMENT sits UNDER the role, carries a period,
// and owns exactly ONE thing: WHICH SCORECARD SCORES THEM. Nothing else moves.
//   · the title does not change — a permanent move is a role change
//   · pay does not change — payroll stays the only writer of pay
//   · permissions do not change — those come from the access role
//
// 🔒 IT REPLACES, IT DOES NOT ADD. Yafatou is the case that settled it: the
// Customer Service and Assistant Manager cards read the SAME company-wide
// Admin feeds for renewals, installations and stock, so running both side by
// side would print one number twice and call it two scorecards.
//
// 🔒 A MONTH IS SCORED BY THE ASSIGNMENT THAT WAS RUNNING THAT MONTH — the
// same rule the KPI targets follow. Ending an assignment must never silently
// rescore the months it covered. And when it lapses, scoring returns to the
// role on its own: nobody has to remember to switch it back.
const ASSIGNMENT_REASONS = ['Training for the role', 'Covering someone', 'Cross-training', 'Extra responsibility', 'Other']

function loadAssignments() {
  const all = db.read('assignments', [])
  return Array.isArray(all) ? all : []
}
// The assignment running in a given month. Compared by MONTH, not by day: a
// scorecard is a monthly thing, so an assignment that ran for any part of a
// month is what that month is judged on. An open end date runs until ended.
function assignmentFor(username, month) {
  const M = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : todayKey().slice(0, 7)
  return loadAssignments()
    .filter((a) => a.username === username && !a.cancelledAt)
    .filter((a) => String(a.from).slice(0, 7) <= M && (!a.to || String(a.to).slice(0, 7) >= M))
    .sort((a, b) => String(b.from).localeCompare(String(a.from)))[0] || null
}
// Same shape as applyDueRoleChanges: a future assignment applies itself on the
// day, and a finished one writes its own closing line. Idempotent — both are
// stamped once, so this can run on every read.
function applyDueAssignments() {
  const all = loadAssignments()
  const today = todayKey()
  const started = all.filter((a) => !a.startedAt && !a.cancelledAt && String(a.from) <= today)
  const ended = all.filter((a) => a.startedAt && !a.endedNoteAt && a.to && String(a.to) < today)
  if (!started.length && !ended.length) return all
  const users = seedUsers()
  for (const a of started) {
    const u = users.find((x) => x.username === a.username)
    a.startedAt = new Date().toISOString()
    if (!u) { a.applyNote = 'no such person'; continue }
    ;(u.history ||= []).push({
      date: a.from,
      event: `Assignment started — ${a.label}${a.to ? ` until ${a.to}` : ' (no end date set)'}${a.reason ? ` (${a.reason})` : ''}. Scored on the ${a.scorecardLabel} KPIs; job title unchanged.`,
    })
  }
  for (const a of ended) {
    const u = users.find((x) => x.username === a.username)
    a.endedNoteAt = new Date().toISOString()
    if (!u) continue
    ;(u.history ||= []).push({
      date: a.to,
      event: `Assignment ended — ${a.label}. Back to being scored on their role.`,
    })
  }
  db.write('users', users)
  db.write('assignments', all)
  return all
}

// Which scorecard scores this person. 🔒 The ASSIGNMENT outranks the title: it
// is what they were told to do for this period, and so it is what they agreed
// to be judged on. With no assignment running, the title decides, exactly as
// before.
//
// 🔑 The live USER RECORD wins over the static src/data/team.js seed row —
// `person` is only a fallback for somebody the users store has no title for.
// Reading the seed FIRST is what kept Yafatou on the Customer Service card
// after 19 Aug: a role change updates the user record, and nothing updates
// that file (Adama 29 Aug — "Yafatou is an assistant manager in training why
// does it say here she is the top performer").
//
// 🔑 Assistant Manager is checked BEFORE Customer Service: her title carried
// "Customer Service Supervisor" for months and the substring match would keep
// claiming her.
function scorecardKey(u, person = null, month = null) {
  const a = u?.username ? assignmentFor(u.username, month) : null
  if (a && KPI_CATALOG[a.scorecard]) return a.scorecard
  return titleScorecardKey(u, person)
}
// The card their ROLE alone would put them on — what an assignment replaces,
// and what scoring returns to when it ends.
function titleScorecardKey(u, person = null) {
  const r = (u?.title || person?.role || '').toLowerCase()
  const t = (u?.department || person?.type || '').toLowerCase()
  if (r.includes('assistant manager')) return 'assistant-manager'
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
    // Retention MOVED to Customer Service as "Customer renewals" (Adama 9 Jul)
    // — renewal outreach is Yafatou's job. Remaining weights auto-normalize.
    // Adama 20 Aug: 10 a month across the sales team. The live number still
    // comes from a KPI Targets entry; this is the catalog fallback.
    { key: 'sales', label: 'Tracker sales', kind: 'count', unit: 'sales', target: 10, weight: 40 },
    { key: 'online', label: 'Trackers online', kind: 'percent', unit: '%', target: 75, weight: 20 },
    // 5-star Google reviews REMOVED as an agent goal (Adama 19 Aug).
  ] },
  'customer-service': { role: 'Customer Service', kpis: [
    { key: 'renewal', label: 'Customer renewals', kind: 'percent', unit: '%', target: 80, weight: 25 },
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
  // Adama 26 Aug — Yafatou's role. Equal weights on purpose: the same day he
  // had the Weight column removed from the KPI Targets page ("weight ...
  // confuses me"), so no KPI here silently outranks another.
  'assistant-manager': { role: 'Assistant Manager', kpis: [
    { key: 'cases', label: 'Case resolution', kind: 'percent', unit: '%', target: 85, weight: 10 },
    { key: 'renewal', label: 'Customer renewal rate', kind: 'percent', unit: '% of renewals due', target: 85, weight: 10 },
    { key: 'install', label: 'Installations completed within 3 days', kind: 'percent', unit: '%', target: 95, weight: 10 },
    { key: 'offline-review', label: 'Offline devices reviewed', kind: 'percent', unit: '%', target: 90, weight: 10 },
    { key: 'stock', label: 'Stock accountability', kind: 'percent', unit: '%', target: 100, weight: 10 },
    { key: 'team-attendance', label: 'Team attendance', kind: 'percent', unit: '%', target: 90, weight: 10 },
    { key: 'team-sales', label: 'Team tracker sales', kind: 'count', unit: 'sales', target: 12, weight: 10 },
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
  const MONTH = todayKey().slice(0, 7)
  const key = scorecardKey(u, null, MONTH)
  // Sales + CS numbers resolve through the KPI Targets store (CEO-set,
  // effective by month); the per-person sales target (u.target) still wins
  // for that one person when set.
  const N = (kpi, dflt) => kpiNumber(key, kpi, MONTH) || dflt
  if (key === 'sales') {
    const s = N('sales', { target: 5, weight: 40 }), o = N('online', { target: 75, weight: 20 })
    return { role: 'Sales agent', kpis: overlayPlan([
      { key: 'sales', label: 'Tracker sales', kind: 'count', target: Number(u.target) || s.target, weight: s.weight, unit: 'sales', actual: salesActual ?? null },
      { key: 'online', label: 'Trackers online', kind: 'percent', target: o.target, weight: o.weight, unit: '%', actual: null },
    ], 'sales', MONTH) }
  }
  if (key === 'customer-service') {
    const rn = N('renewal', { target: 80, weight: 25 })
    const c = N('cases', { target: 85, weight: 40 }), i = N('install', { target: 95, weight: 35 }), st = N('stock', { target: 100, weight: 25 })
    return { role: 'Customer Service', kpis: overlayPlan([
      { key: 'renewal', label: 'Customer renewals', kind: 'percent', target: rn.target, weight: rn.weight, unit: '%', actual: null },
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
  // Any other card the catalog knows (Assistant Manager today) resolves
  // straight from the catalog. 🔴 Before assignments this returned null, which
  // showed a person NO KPIs at all — survivable while only a title could
  // reach that card, but an assignment can now point anyone at any card, and a
  // blank scorecard reads as "measured, scored nothing" rather than "not built".
  // Actuals stay null here: this builder is the preview, and workScorecardFor
  // is what fetches the real numbers.
  const plan = kpiPlanFor(key, MONTH)
  if (plan) return { role: plan.role, kpis: plan.kpis.map((k) => ({ ...k, actual: null })) }
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
  const sales = salesRec
    ? { actual: salesActualFrom(ctx.salesTally, u.name, ctx.CUR), target: salesRec.monthlyTarget ?? null }
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

app.get('/api/team/overview', auth, async (req, res) => {
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
    // One request for the whole team, not one per card.
    salesTally: await salesTallyFor(CUR),
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
app.get('/api/team/member/:username', auth, async (req, res) => {
  const lead = findUser(req.user.username)
  const member = teamMembersFor(lead).find((m) => m.username === String(req.params.username).toLowerCase())
  if (!member) return res.status(403).json({ error: 'not-your-team-member' })
  const CUR = todayKey().slice(0, 7)
  const salesRec = member.department === 'Sales' ? (db.read('agent-sales', {})[member.name] || null) : null
  const salesActual = salesRec ? await salesActualFor(member.name, CUR) : null
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

// ---------- MY WORKDAY (the manager's desk — Adama 9 Jul v5) ----------
// "The software informs. The manager manages." The system shows reality —
// goal, done, remaining, today's target, live done-today progress — and the
// PLAN is his: an empty writing area per objective ("These are the fires. You
// decide how to put them out."). Admin & Follow-ups auto-populates small jobs
// he can tick, delete or extend. Working Notes = his desk scratchpad. Carry
// Forward ("what still needs attention tomorrow?") turns each line into
// tomorrow's items, and unfinished work rolls over by itself. He can also
// write a plan for a day ahead. Stores: 'workday' (plans/ticks/deletions/
// carry), 'workday-notes', 'assignments', 'ops-snapshots'.

function opsSnapshots() { return db.read('ops-snapshots', []) }
function opsSaveSnapshot(snap) {
  const all = opsSnapshots().filter((s) => !(s.username === snap.username && s.date === snap.date))
  all.push(snap)
  db.write('ops-snapshots', all.filter((s) => s.date >= new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10)))
}

// Everything the workbench needs, in one pass: live feeds + local stores →
// the metrics object. Feed unreachable → null, never a made-up number.
async function opsMetrics(lead) {
  const today = todayKey()
  const CUR = today.slice(0, 7)
  const members = teamMembersFor(lead)
  const sellers = members.filter((m) => m.department === 'Sales')
  const yafatou = members.find((m) => m.department === 'Customer Service')
  const salesStore = db.read('agent-sales', {})
  const [salesF, retF, onlF, revF, casesF, instF, stockF] = await Promise.all([
    fetchAdminFeed(`/api/integrations/pulse/sales?month=${CUR}`),
    fetchAdminFeed(`/api/integrations/pulse/retention?month=${CUR}`),
    fetchAdminFeed('/api/integrations/pulse/online'),
    fetchAdminFeed(`/api/integrations/pulse/reviews?month=${CUR}`),
    yafatou ? fetchAdminCases(yafatou.name, CUR) : null,
    fetchAdminInstall(CUR),
    fetchAdminStock(CUR),
  ])
  const rowFor = (feed, m) => (feed?.agents || []).find((a) => a.name === m.name) || null
  const wonBy = (m) => Number(rowFor(salesF, m)?.won) || 0
  const teamWon = salesF ? sellers.reduce((s, m) => s + wonBy(m), 0) : null
  // Team goal = the KPI Targets store (Pulse is the source of truth — Adama
  // 10 Jul: "the monthly goal is 12, each agent 6"). Fallbacks: per-agent KPI
  // target × sellers, then the old per-agent sheet sum.
  const perAgentTarget = kpiNumber('sales', 'sales', CUR)?.target ?? null
  const teamTarget = kpiNumber('team-lead', 'team-sales', CUR)?.target
    ?? (perAgentTarget != null && sellers.length ? perAgentTarget * sellers.length : null)
    ?? (sellers.reduce((s, m) => s + (Number(salesStore[m.name]?.monthlyTarget) || 0), 0) || null)
  const perSellerReviews = (kpiNumber('sales', 'reviews', CUR) || { target: 3 }).target
  const reviewsTarget = perSellerReviews != null && sellers.length ? perSellerReviews * sellers.length : null
  const reviewsBy = (m) => Number(rowFor(revF, m)?.verified) || 0
  const reviewsCount = revF ? sellers.reduce((s, m) => s + reviewsBy(m), 0) : null
  const rnDue = (retF?.agents || []).reduce((s, a) => s + (Number(a.due) || 0), 0)
  const rnRen = (retF?.agents || []).reduce((s, a) => s + (Number(a.renewed) || 0), 0)
  const teamNames = new Set(members.map((m) => m.name))
  const onlRows = (onlF?.agents || []).filter((a) => teamNames.has(a.name))
  const onlTotal = onlRows.reduce((s, a) => s + (Number(a.total) || 0), 0)
  const onlOn = onlRows.reduce((s, a) => s + (Number(a.online) || 0), 0)
  const attAll = db.read('attendance', [])
  const checkedIn = members.filter((m) => attAll.find((a) => a.username === m.username && a.date === today && a.checkIn))
  const coachingAll = db.read('coaching', [])
  const coaching = members.map((m) => ({ m, ...coachingStatus(coachingAll, m.username) }))
  const pendingLeave = db.read('leave', []).filter((l) => l.status === 'pending' && members.some((m) => m.username === l.username))
  const reviewsStore = db.read('reviews', {})
  const reviewsMissing = members.filter((m) => !(reviewsStore[m.name] || []).some((r) => r.period === CUR))
  const contractsSoon = members.map((m) => {
    const p = team.find((t) => t.name === m.name)
    const end = p?.contractEnd || m.contractEnd || null
    if (!end) return null
    const days = Math.ceil((new Date(`${end}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
    return days >= 0 && days <= 45 ? { m, days } : null
  }).filter(Boolean)
  return {
    today, CUR, username: lead.username, members, sellers, yafatou,
    salesF, teamWon, teamTarget, wonBy,
    retF, rnDue, rnRen,
    rnTargetPct: kpiNumber('customer-service', 'renewal', CUR)?.target ?? 80,
    casesTargetPct: kpiNumber('customer-service', 'cases', CUR)?.target ?? 85,
    stockTargetPct: kpiNumber('customer-service', 'stock', CUR)?.target ?? 100,
    onlineTargetPct: kpiNumber('team-lead', 'team-online', CUR)?.target ?? 75,
    onlF, onlTotal, onlOn, onlPct: onlF && onlTotal ? Math.round((onlOn / onlTotal) * 100) : null,
    revF, reviewsCount, reviewsTarget, reviewsBy,
    casesF, instF, stockF,
    checkedIn, coaching, pendingLeave, reviewsMissing, contractsSoon,
  }
}

// "He can know what is coming and when he needs to push" (Adama 10 Jul):
// Mon–Sat of the current week. Past days show what actually happened (daily
// snapshot diffs — real numbers or nothing); today and coming days show the
// per-day quota that keeps the month's goal alive.
function weekPlanFor(username, today, remaining, snapField) {
  const snaps = opsSnapshots().filter((s) => s.username === username && s[snapField] != null).sort((a, b) => a.date.localeCompare(b.date))
  const didOn = (date) => {
    const i = snaps.findIndex((s) => s.date === date)
    if (i < 1) return null // no snapshot, or nothing before it to diff against
    return Math.max(0, (Number(snaps[i][snapField]) || 0) - (Number(snaps[i - 1][snapField]) || 0))
  }
  const mon = new Date(`${today}T00:00:00Z`); mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7))
  const daysLeft = workingDaysLeft(today)
  const base = Math.floor(remaining / daysLeft), extra = remaining % daysLeft
  let q = 0
  const out = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i)
    const date = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
    if (date < today) out.push({ label, date, past: true, did: didOn(date) })
    else { const need = base + (q < extra ? 1 : 0); q++; out.push({ label, date, today: date === today, need }) }
  }
  return out
}

function workingDaysLeft(today) {
  const [y, m, d] = today.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let n = 0
  for (let day = d; day <= last; day++) {
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay()
    if (dow !== 0 && dow !== 6) n++ // Mon–Fri, the whole team
  }
  return Math.max(1, n)
}

// Every goal can hold the chair. When an area isn't behind, it still gets an
// honest "hold the line" block so the rotation can put it in front.
const OBJECTIVE_KEYS = ['renewals', 'sales', 'cases', 'online', 'reviews']
function synthFocus(x, key) {
  const first = (m) => m.name.split(' ')[0]
  if (key === 'renewals') {
    const need = x.retF && x.rnDue ? Math.ceil(x.rnDue * (x.rnTargetPct / 100)) : null
    return { key, title: 'Renewals', metrics: [
      { label: 'Monthly goal', value: need != null ? `${need} renewals` : '—' },
      { label: 'Completed', value: x.retF ? String(x.rnRen) : '—' },
    ], progress: null, onTrack: true }
  }
  if (key === 'sales') {
    return { key, title: 'Sales', metrics: [
      { label: 'Monthly goal', value: x.teamTarget != null ? String(x.teamTarget) : '—' },
      { label: 'Current', value: x.teamWon != null ? String(x.teamWon) : '—' },
    ], agents: x.salesF ? x.sellers.map((m) => ({ name: first(m), won: x.wonBy(m) })) : null, progress: null, onTrack: true }
  }
  if (key === 'cases') {
    return { key, title: 'Customer cases', metrics: [
      { label: 'Resolution', value: x.casesF && typeof x.casesF.casesPct === 'number' ? `${Math.round(x.casesF.casesPct)}%` : '—' },
      { label: 'Goal', value: `${x.casesTargetPct}%` },
    ], progress: null, onTrack: true }
  }
  if (key === 'online') {
    return { key, title: 'Trackers online', metrics: [
      { label: 'Online now', value: x.onlPct != null ? `${x.onlPct}%` : '—' },
      { label: 'Goal', value: `${x.onlineTargetPct}%` },
    ], progress: null, onTrack: true }
  }
  return { key: 'reviews', title: 'Google reviews', metrics: [
    { label: 'Monthly goal', value: x.reviewsTarget != null ? String(x.reviewsTarget) : '—' },
    { label: 'Current', value: x.reviewsCount != null ? String(x.reviewsCount) : '—' },
  ], progress: null, onTrack: true }
}

// ROTATION (Adama 10 Jul: "everyday cannot be sales and cases — 5 goals, at
// least one has to be primary everyday, mixing"): the behind-areas form the
// pool (all five when nothing is behind), and the date walks the pool, so
// each day a different goal takes the chair. Adama's stored picks override.
const ROTATION_FROM = '2026-07-13' // Adama 10 Jul: the 10th keeps the plan
// Momodou already wrote (Sales + Cases, severity order); rotation starts Monday.
function rotationKeys(poolKeys, pick, dateKey) {
  const pool = poolKeys.length ? poolKeys : OBJECTIVE_KEYS
  if (dateKey < ROTATION_FROM) {
    const primary = pick?.primary && OBJECTIVE_KEYS.includes(pick.primary) ? pick.primary : pool[0]
    const rest = pool.filter((k) => k !== primary)
    const supporting = pick?.supporting && OBJECTIVE_KEYS.includes(pick.supporting) && pick.supporting !== primary
      ? pick.supporting
      : (rest[0] || OBJECTIVE_KEYS.find((k) => k !== primary))
    return { primary, supporting }
  }
  const dayIdx = Math.floor(new Date(`${dateKey}T00:00:00Z`).getTime() / 86400000)
  let primary = pick?.primary && OBJECTIVE_KEYS.includes(pick.primary) ? pick.primary : pool[dayIdx % pool.length]
  const pool2 = pool.filter((k) => k !== primary)
  let supporting = pick?.supporting && OBJECTIVE_KEYS.includes(pick.supporting) && pick.supporting !== primary
    ? pick.supporting
    : (pool2.length ? pool2[dayIdx % pool2.length] : OBJECTIVE_KEYS.find((k) => k !== primary))
  return { primary, supporting }
}
function objectivePickFor(username) {
  return db.read('workday-objectives', []).find((o) => o.username === username) || {}
}

// OBJECTIVES — the system shows REALITY (goal, done, remaining, today's
// target, live progress); it never writes the plan. "These are the fires —
// you decide how to put them out" (Adama 9 Jul v5). No auto steps.
function workdayFocus(x, prevSnap) {
  const first = (m) => m.name.split(' ')[0]
  const daysLeft = workingDaysLeft(x.today)
  const dayOfMonth = Number(x.today.slice(8, 10))
  const F = []
  // Renewals
  if (x.retF && x.rnDue) {
    const need = Math.ceil(x.rnDue * (x.rnTargetPct / 100))
    const remaining = Math.max(0, need - x.rnRen)
    if (remaining > 0) {
      const goal = Math.min(remaining, Math.max(1, Math.ceil(remaining / daysLeft)))
      const doneToday = prevSnap && prevSnap.rnRen != null ? Math.max(0, x.rnRen - prevSnap.rnRen) : 0
      F.push({
        key: 'renewals', severity: 70 + Math.min(20, remaining), title: 'Renewals',
        metrics: [
          { label: 'Monthly goal', value: `${need} renewals` },
          { label: 'Completed', value: String(x.rnRen) },
          { label: 'Remaining', value: String(remaining) },
          { label: "Today's target", value: String(goal) },
        ],
        progress: { actual: doneToday, goal, unit: 'renewed today' },
        weekPlan: weekPlanFor(x.username, x.today, remaining, 'rnRen'),
      })
    }
  }
  // Sales
  if (x.teamWon != null && x.teamTarget) {
    const remaining = x.teamTarget - x.teamWon
    const pace = Math.round(x.teamTarget * (dayOfMonth / 30))
    if (remaining > 0 && x.teamWon < pace) {
      const goal = Math.max(1, Math.ceil(remaining / daysLeft))
      const doneToday = prevSnap && prevSnap.teamWon != null ? Math.max(0, x.teamWon - prevSnap.teamWon) : 0
      F.push({
        key: 'sales', severity: 85 + (pace - x.teamWon), title: 'Sales',
        metrics: [
          { label: 'Monthly goal', value: String(x.teamTarget) },
          { label: 'Current', value: String(x.teamWon) },
          { label: "Today's target", value: String(goal) },
        ],
        agents: x.sellers.map((m) => ({ name: first(m), won: x.wonBy(m) })),
        progress: { actual: doneToday, goal, unit: 'closed today' },
        weekPlan: weekPlanFor(x.username, x.today, remaining, 'teamWon'),
      })
    }
  }
  // Customer cases
  if (x.casesF && typeof x.casesF.casesPct === 'number' && x.casesF.casesPct < x.casesTargetPct) {
    const open = Number(x.casesF.openOverdue) || 0
    const goal = open ? Math.min(open, Math.max(1, Math.ceil(open / 2))) : 1
    const doneToday = prevSnap && prevSnap.casesOnTime != null && typeof x.casesF.onTime === 'number' ? Math.max(0, x.casesF.onTime - prevSnap.casesOnTime) : 0
    F.push({
      key: 'cases', severity: 60 + Math.min(25, 85 - x.casesF.casesPct), title: 'Customer cases',
      metrics: [
        { label: 'Resolution', value: `${Math.round(x.casesF.casesPct)}%` },
        { label: 'Goal', value: `${x.casesTargetPct}%` },
        ...(open ? [{ label: 'Past deadline', value: String(open) }] : []),
        { label: "Today's target", value: `clear ${goal}` },
      ],
      progress: { actual: doneToday, goal, unit: 'resolved today' },
    })
  }
  // Google reviews
  if (x.reviewsCount != null && x.reviewsTarget && x.reviewsCount < x.reviewsTarget) {
    const remaining = x.reviewsTarget - x.reviewsCount
    F.push({
      key: 'reviews', severity: 55, title: 'Google reviews',
      metrics: [
        { label: 'Monthly goal', value: String(x.reviewsTarget) },
        { label: 'Current', value: String(x.reviewsCount) },
        { label: 'Remaining', value: String(remaining) },
      ],
      agents: x.sellers.map((m) => ({ name: first(m), won: x.reviewsBy(m) })),
      progress: null,
    })
  }
  // Trackers online
  if (x.onlPct != null && x.onlPct < x.onlineTargetPct) {
    F.push({
      key: 'online', severity: 62 + Math.min(20, x.onlineTargetPct - x.onlPct), title: 'Trackers online',
      metrics: [
        { label: 'Online now', value: `${x.onlPct}%` },
        { label: 'Goal', value: `${x.onlineTargetPct}%` },
        { label: 'Silent', value: String(x.onlTotal - x.onlOn) },
      ],
      progress: prevSnap && prevSnap.onlOn != null && x.onlOn != null ? { actual: Math.max(0, x.onlOn - prevSnap.onlOn), goal: Math.max(1, Math.ceil((x.onlTotal - x.onlOn) / 3)), unit: 'back online today' } : null,
    })
  }
  // Sales feed down — honest fallback, still no prescriptions
  if (x.teamWon == null && x.teamTarget) {
    F.push({
      key: 'sales', severity: 50, title: 'Sales',
      metrics: [
        { label: 'Monthly goal', value: String(x.teamTarget) },
        { label: 'Current', value: '? — Admin unreachable' },
      ],
      agents: null,
      progress: null,
    })
  }
  F.sort((a, b) => b.severity - a.severity)
  return F
}

// ---- day record store: his plan, ticks, deletions and the carry-forward box ----
function workdayStore() { return db.read('workday', []) }
function workdayGet(username, date) { return workdayStore().find((d) => d.username === username && d.date === date) || null }
function workdaySave(day) {
  const all = workdayStore().filter((d) => !(d.username === day.username && d.date === day.date))
  all.push(day)
  db.write('workday', all.filter((d) => d.date >= new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)))
}

// Today's items: HIS plan only (nothing auto-suggested), plus yesterday's
// unticked items carried forward — the next day just shows the goals.
function workdayToday(lead) {
  const today = todayKey()
  const stored = workdayGet(lead.username, today) || { username: lead.username, date: today, items: [] }
  // nothing is auto-suggested any more — purge auto items older versions seeded
  const byId = new Map(stored.items.filter((i) => !i.auto).map((i) => [i.id, i]))
  const yk = new Date(`${today}T00:00:00Z`); yk.setUTCDate(yk.getUTCDate() - 1)
  const prev = workdayGet(lead.username, yk.toISOString().slice(0, 10))
  if (prev) {
    for (const p of prev.items) {
      if (p.done || p.deleted || p.auto || byId.has(p.id)) continue
      byId.set(p.id, { ...p, done: false, carried: (p.carried || 0) + 1 })
    }
    // Carry Forward box → tomorrow's items, once (marker survives in stored.carriedFromBox)
    if (prev.carry && !stored.carriedFromBox) {
      for (const line of String(prev.carry).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20)) {
        byId.set(`carry-${crypto.randomUUID().slice(0, 8)}`, { id: `carry-${crypto.randomUUID().slice(0, 8)}`, title: line.slice(0, 160), focusKey: 'quick', done: false, own: true, carried: 1 })
      }
      stored.carriedFromBox = true
    }
  }
  const day = { ...stored, items: [...byId.values()] }
  workdaySave(day)
  return day
}

// AUDIT TRAIL (Adama 10 Jul: "i do not want him to cheat his way into the
// goals"): every plan mutation is logged under the REAL actor — Adama acting
// through view-as is recorded as adama, so contributions and corrections are
// distinguishable from Momodou's own edits. Nothing is ever silently gone.
function workdayAudit(lead, req, action, detail) {
  const all = db.read('workday-audit', [])
  all.push({
    id: crypto.randomUUID(),
    lead: lead.username,
    actor: req.realUser?.username || req.user?.username,
    at: new Date().toISOString(),
    action,
    detail,
  })
  db.write('workday-audit', all.filter((e) => e.at >= new Date(Date.now() - 90 * 86400000).toISOString()))
}

// Plan window: today up to NEXT week's Friday. The whole team works
// Monday–Friday (Adama 10 Jul), so weekends never appear.
function planWindow(today) {
  const t = new Date(`${today}T00:00:00Z`)
  const thisFri = new Date(t); thisFri.setUTCDate(t.getUTCDate() + ((5 - t.getUTCDay() + 7) % 7))
  const end = new Date(thisFri); end.setUTCDate(thisFri.getUTCDate() + 7)
  const out = []
  const d = new Date(t)
  while (d <= end) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

function workdayLeadFor(req) {
  const q = String(req.query.username || req.body?.username || '').toLowerCase()
  if (q && req.realUser?.username === CEO) {
    const u = findUser(q)
    return u && leadsATeam(u) ? u : null
  }
  const u = findUser(req.user.username)
  return u && leadsATeam(u) ? u : null
}

// Management items that were NOT done on their day — Adama gets told.
function adamaOverdueFor(username, today) {
  const out = []
  for (const d of workdayStore()) {
    if (d.username !== username || d.date >= today) continue
    for (const i of d.items) {
      if (i.byAdama && !i.done && !i.deleted) out.push({ title: i.title, date: d.date })
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20)
}

function assignmentsFor(username) {
  return db.read('assignments', []).filter((a) => a.toUsername === username && !a.archived)
    .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))
}

app.get('/api/workday', auth, async (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  try {
    const x = await opsMetrics(lead)
    const prevSnap = opsSnapshots().filter((s) => s.username === lead.username && s.date < x.today).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null
    opsSaveSnapshot({
      username: lead.username, date: x.today,
      teamWon: x.teamWon, rnRen: x.retF ? x.rnRen : null,
      casesOnTime: x.casesF && typeof x.casesF.onTime === 'number' ? x.casesF.onTime : null,
      onlOn: x.onlF ? x.onlOn : null,
    })
    const behind = workdayFocus(x, prevSnap)
    const byKey = new Map(behind.map((f) => [f.key, f]))
    const blockFor = (k) => byKey.get(k) || synthFocus(x, k)
    const poolKeys = behind.map((f) => f.key)
    const pick = objectivePickFor(lead.username)
    const todayKeys = rotationKeys(poolKeys, pick, x.today)
    const focus = [
      { ...blockFor(todayKeys.primary), slot: 'Primary objective' },
      { ...blockFor(todayKeys.supporting), slot: 'Supporting objective' },
    ]
    const day = workdayToday(lead)
    day.slots = { primary: todayKeys.primary, supporting: todayKeys.supporting }
    workdaySave(day)
    const objNotes = (db.read('workday-objnotes', []).find((n) => n.username === lead.username) || {}).notes || {}
    const week = []
    if (x.teamTarget) week.push({ label: 'Sales', actual: x.teamWon, target: x.teamTarget })
    if (x.retF && x.rnDue) week.push({ label: 'Renewals', actual: x.rnRen, target: Math.ceil(x.rnDue * (x.rnTargetPct / 100)) })
    if (x.casesF && typeof x.casesF.casesPct === 'number') week.push({ label: 'Cases', actual: Math.round(x.casesF.casesPct), target: 100, unit: '%' })
    if (x.onlPct != null) week.push({ label: 'Trackers online', actual: x.onlPct, target: 100, unit: '%' })
    if (x.reviewsTarget) week.push({ label: 'Google reviews', actual: x.reviewsCount, target: x.reviewsTarget })
    const win = planWindow(x.today)
    const planByDate = {}
    for (const dte of win) {
      planByDate[dte] = dte === x.today
        ? day.items.filter((i) => !i.deleted)
        : (workdayGet(lead.username, dte)?.items || []).filter((i) => !i.deleted)
    }
    const focusByDate = Object.fromEntries(win.map((dte) => [dte, rotationKeys(poolKeys, pick, dte)]))
    const focusBlocks = Object.fromEntries(OBJECTIVE_KEYS.map((k) => [k, blockFor(k)]))
    day.pool = poolKeys
    workdaySave(day)
    res.json({
      lead: { username: lead.username, name: lead.name },
      today: x.today,
      days: win,
      planByDate,
      focusByDate,
      focusBlocks,
      objectivePick: { primary: pick.primary || '', supporting: pick.supporting || '' },
      focus,
      items: day.items.filter((i) => !i.deleted),
      otherTitle: (db.read('workday-other', []).find((o) => o.username === lead.username) || {}).title || '',
      fromAdama: assignmentsFor(lead.username),
      adamaOverdue: adamaOverdueFor(lead.username, x.today),
      objNotes,
      week,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/workday/toggle', auth, notViewAs, (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const day = workdayGet(lead.username, todayKey())
  const item = day?.items.find((i) => i.id === req.body?.itemId && !i.deleted)
  if (!item) return res.status(404).json({ error: 'No such item today' })
  item.done = !item.done
  item.doneAt = item.done ? new Date().toISOString() : null
  workdaySave(day)
  workdayAudit(lead, req, item.done ? 'ticked' : 'unticked', { title: item.title, date: day.date })
  res.json({ ok: true, items: day.items.filter((i) => !i.deleted) })
})

// Remove an item from the list — auto items get a tombstone so the generator
// doesn't resurrect them tomorrow morning.
app.post('/api/workday/remove', auth, notViewAs, (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : todayKey()
  const day = workdayGet(lead.username, date)
  const item = day?.items.find((i) => i.id === req.body?.itemId)
  if (!item) return res.status(404).json({ error: 'No such item that day' })
  if (item.byAdama && req.realUser?.username !== CEO) return res.status(403).json({ error: 'This came from management — only Adama can remove it' })
  item.deleted = true
  workdaySave(day)
  workdayAudit(lead, req, 'removed', { title: item.title, date })
  res.json({ ok: true, items: day.items.filter((i) => !i.deleted) })
})

// Add to today's plan — planning lives in the day; tomorrow just shows the goals.
app.post('/api/workday/add', auth, notViewAs, (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const title = String(req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'title required' })
  const today = todayKey()
  const win = planWindow(today)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') && win.includes(req.body.date) ? req.body.date : today
  const focusKey = String(req.body?.focusKey || 'other')
  const day = workdayGet(lead.username, date) || { username: lead.username, date, items: [] }
  // Caps keep the plan honest (Adama 10 Jul): Primary 10, Supporting 8, Other 5.
  const todayRec = workdayGet(lead.username, today)
  const dateKeys = rotationKeys(todayRec?.pool || [], objectivePickFor(lead.username), date)
  const cap = focusKey === 'other' ? 5 : dateKeys.primary === focusKey ? 10 : dateKeys.supporting === focusKey ? 8 : 10
  const count = day.items.filter((i) => i.focusKey === focusKey && !i.deleted).length
  if (count >= cap) return res.status(400).json({ error: `This plan is full (${cap} max) — finish or remove something first` })
  const byAdama = req.realUser?.username === CEO && lead.username !== CEO
  day.items.push({ id: `own-${crypto.randomUUID().slice(0, 8)}`, title: title.slice(0, 160), focusKey, done: false, own: true, ...(byAdama ? { byAdama: true } : {}) })
  workdaySave(day)
  workdayAudit(lead, req, 'added', { title: title.slice(0, 160), date, focusKey })
  res.json({ ok: true, date, items: day.items.filter((i) => !i.deleted) })
})

// Edit an item's wording — his plan, his words, editable any time today.
app.post('/api/workday/edit', auth, notViewAs, (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const title = String(req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'title required' })
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : todayKey()
  const day = workdayGet(lead.username, date)
  const item = day?.items.find((i) => i.id === req.body?.itemId && !i.deleted)
  if (!item) return res.status(404).json({ error: 'No such item that day' })
  if (item.byAdama && req.realUser?.username !== CEO) return res.status(403).json({ error: 'This came from management — only Adama can edit it' })
  const before = item.title
  item.title = title.slice(0, 160)
  workdaySave(day)
  workdayAudit(lead, req, 'edited', { from: before, to: item.title, date })
  res.json({ ok: true, items: day.items.filter((i) => !i.deleted) })
})

// The OTHER objective — set by ADAMA ONLY (10 Jul: "only me, not him, can
// edit the objectives"); the lead plans and comments under it.
app.post('/api/workday/other', auth, notViewAs, (req, res) => {
  if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'Only Adama names the objectives' })
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const all = db.read('workday-other', []).filter((o) => o.username !== lead.username)
  const newTitle = String(req.body?.title || '').trim().slice(0, 120)
  all.push({ username: lead.username, title: newTitle, updatedAt: new Date().toISOString() })
  db.write('workday-other', all)
  workdayAudit(lead, req, 'other-objective', { title: newTitle })
  res.json({ ok: true })
})

// Adama picks the objectives himself when he wants to — overrides the daily
// rotation until cleared ('' = back to auto).
app.post('/api/workday/objectives', auth, notViewAs, (req, res) => {
  if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'Only Adama sets the objectives' })
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const clean = (v) => (OBJECTIVE_KEYS.includes(v) ? v : null)
  const all = db.read('workday-objectives', []).filter((o) => o.username !== lead.username)
  const rec = { username: lead.username, primary: clean(req.body?.primary), supporting: clean(req.body?.supporting), setAt: new Date().toISOString() }
  all.push(rec)
  db.write('workday-objectives', all)
  workdayAudit(lead, req, 'objectives-set', { primary: rec.primary || 'auto', supporting: rec.supporting || 'auto' })
  res.json({ ok: true })
})

// Per-objective comments — where he explains why a goal wasn't met, or
// anything the business should know (Adama 10 Jul). One running box per
// objective; Adama reads it on his card. Replaces the global Working Notes
// and the Carry Forward box (removed on his call). No suggestions anywhere —
// the plan is his responsibility; the system only shows the goal.
app.post('/api/workday/objnote', auth, notViewAs, (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  const key = String(req.body?.key || '')
  if (!key) return res.status(400).json({ error: 'key required' })
  const all = db.read('workday-objnotes', [])
  const rec = all.find((n) => n.username === lead.username) || (all.push({ username: lead.username, notes: {} }), all[all.length - 1])
  const before = rec.notes[key] || ''
  rec.notes[key] = String(req.body?.text || '').slice(0, 4000)
  rec.updatedAt = new Date().toISOString()
  db.write('workday-objnotes', all)
  if (before !== rec.notes[key]) workdayAudit(lead, req, 'comment', { key, text: rec.notes[key].slice(0, 140) })
  res.json({ ok: true })
})

// The timeline — the full history of what he added, edited, removed, ticked
// and commented, with who really did it. CEO/HR, or the lead reading his own.
app.get('/api/workday/audit', auth, (req, res) => {
  const q = String(req.query.username || '').toLowerCase()
  const isBoss = req.realUser?.username === CEO || can(req.user, 'hr')
  const target = q && isBoss ? q : req.user.username
  if (target !== req.user.username && !isBoss) return res.status(403).json({ error: 'forbidden' })
  const entries = db.read('workday-audit', []).filter((e) => e.lead === target)
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300)
  res.json({ entries })
})

// ---- From Adama: assignments (CEO writes, the lead works them) ----
app.post('/api/assignments', auth, notViewAs, (req, res) => {
  if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'forbidden' })
  const { username, title, due } = req.body || {}
  const target = findUser(String(username || '').toLowerCase())
  if (!target || !leadsATeam(target)) return res.status(400).json({ error: 'Pick a team lead' })
  if (!String(title || '').trim()) return res.status(400).json({ error: 'title required' })
  const all = db.read('assignments', [])
  const rec = { id: crypto.randomUUID(), toUsername: target.username, title: String(title).trim().slice(0, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null, done: false, createdAt: new Date().toISOString(), createdBy: CEO }
  all.push(rec)
  db.write('assignments', all)
  res.json({ ok: true, assignment: rec })
})
app.post('/api/assignments/:id/toggle', auth, notViewAs, (req, res) => {
  const all = db.read('assignments', [])
  const rec = all.find((a) => a.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  const isCeo = req.realUser?.username === CEO
  if (!isCeo && req.user.username !== rec.toUsername) return res.status(403).json({ error: 'forbidden' })
  rec.done = !rec.done
  rec.doneAt = rec.done ? new Date().toISOString() : null
  db.write('assignments', all)
  res.json({ ok: true, assignment: rec })
})
app.delete('/api/assignments/:id', auth, notViewAs, (req, res) => {
  if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'forbidden' })
  db.write('assignments', db.read('assignments', []).filter((a) => a.id !== req.params.id))
  res.json({ ok: true })
})

// CEO overview: each lead's objectives, plan progress, assignments and what
// they're carrying to tomorrow — out of the dark without asking.
app.get('/api/workday/overview', auth, async (req, res) => {
  if (req.realUser?.username !== CEO && !can(req.user, 'hr')) return res.status(403).json({ error: 'forbidden' })
  const leads = seedUsers().filter((u) => !isArchived(u) && leadsATeam(u))
  const out = []
  const today = todayKey()
  for (const lead of leads) {
    try {
      const x = await opsMetrics(lead)
      const prevSnap = opsSnapshots().filter((s) => s.username === lead.username && s.date < today).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null
      const behindO = workdayFocus(x, prevSnap)
      const bkO = new Map(behindO.map((f) => [f.key, f]))
      const tkO = rotationKeys(behindO.map((f) => f.key), objectivePickFor(lead.username), today)
      const focus = [bkO.get(tkO.primary) || synthFocus(x, tkO.primary), bkO.get(tkO.supporting) || synthFocus(x, tkO.supporting)]
      const day = workdayGet(lead.username, today)
      const items = (day?.items || []).filter((i) => !i.deleted)
      const objNotes = (db.read('workday-objnotes', []).find((n) => n.username === lead.username) || {}).notes || {}
      out.push({
        lead: { username: lead.username, name: lead.name },
        focus: focus.map((f) => ({ key: f.key, title: f.title, metrics: f.metrics, progress: f.progress, note: objNotes[f.key] || '' })),
        other: { title: (db.read('workday-other', []).find((o) => o.username === lead.username) || {}).title || '', note: objNotes.other || '' },
        adamaOverdue: adamaOverdueFor(lead.username, today),
        doneCount: items.filter((i) => i.done).length,
        totalItems: items.length,
        assignments: assignmentsFor(lead.username),
      })
    } catch { /* skip a lead we can't build */ }
  }
  res.json({ leads: out })
})

// ---------- REPORTS (Adama 10 Jul: team weekly + business monthly) ----------
// Both DERIVE on read — a finished week/month is stable data (snapshots, day
// records, audit), so there is nothing to generate, store or forget. The team
// report is SHARED: Momodou opens the same document Adama does.

function weekDaysOf(monday) {
  const out = []
  const d = new Date(`${monday}T00:00:00Z`)
  for (let i = 0; i < 5; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}
function mondayOf(dateKey) {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

// What actually moved during [mon..fri]: snapshot at/after the week's end
// minus the last snapshot before the week began. null = not enough history.
function weekDelta(username, mon, fri, field) {
  const snaps = opsSnapshots().filter((s) => s.username === username && s[field] != null).sort((a, b) => a.date.localeCompare(b.date))
  if (!snaps.length) return null
  const before = [...snaps].reverse().find((s) => s.date < mon) || null
  const endSnap = [...snaps].reverse().find((s) => s.date <= fri) || null
  if (!endSnap) return null
  const base = before ? Number(before[field]) || 0 : (snaps[0].date <= fri ? Number(snaps[0][field]) || 0 : null)
  if (base == null) return null
  return Math.max(0, (Number(endSnap[field]) || 0) - base)
}

app.get('/api/report/week', auth, async (req, res) => {
  const lead = workdayLeadFor(req)
  if (!lead) return res.status(403).json({ error: 'not-a-team-lead' })
  try {
    const today = todayKey()
    const mon = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : today)
    const days = weekDaysOf(mon)
    const fri = days[4]
    const x = await opsMetrics(lead)
    const CUR = today.slice(0, 7)

    // the five goals: month target, month standing (live), what THIS WEEK added
    const goals = [
      { key: 'sales', title: 'Sales', target: kpiNumber('team-lead', 'team-sales', CUR)?.target ?? null, actual: x.teamWon, unit: 'sales', weekDone: weekDelta(lead.username, mon, fri, 'teamWon') },
      { key: 'renewals', title: 'Renewals', target: x.retF && x.rnDue ? Math.ceil(x.rnDue * (x.rnTargetPct / 100)) : null, actual: x.retF ? x.rnRen : null, unit: 'renewals', weekDone: weekDelta(lead.username, mon, fri, 'rnRen') },
      { key: 'cases', title: 'Customer cases', target: x.casesTargetPct, actual: x.casesF && typeof x.casesF.casesPct === 'number' ? Math.round(x.casesF.casesPct) : null, unit: '%', weekDone: weekDelta(lead.username, mon, fri, 'casesOnTime') },
      { key: 'online', title: 'Trackers online', target: x.onlineTargetPct, actual: x.onlPct, unit: '%', weekDone: null },
      { key: 'reviews', title: 'Google reviews', target: x.reviewsTarget, actual: x.reviewsCount, unit: 'reviews', weekDone: null },
    ]

    // objectives that held the chair each day (stored slots; rotation as fallback)
    const pick = objectivePickFor(lead.username)
    const objectivesByDay = days.map((d) => {
      const rec = workdayGet(lead.username, d)
      const keys = rec?.slots?.primary ? rec.slots : rotationKeys(rec?.pool || [], pick, d)
      return { date: d, primary: keys.primary, supporting: keys.supporting }
    })

    // plan discipline: per objective area, what was planned / done / carried
    const plan = {}
    let adamaTotal = 0, adamaDone = 0
    const adamaMissed = []
    for (const d of days) {
      if (d > today) continue
      const rec = workdayGet(lead.username, d)
      for (const i of (rec?.items || [])) {
        if (i.deleted) continue
        const k = i.focusKey || 'other'
        plan[k] = plan[k] || { total: 0, done: 0, carried: 0 }
        plan[k].total++
        if (i.done) plan[k].done++
        if (i.carried) plan[k].carried++
        if (i.byAdama) {
          adamaTotal++
          if (i.done) adamaDone++
          else if (d < today) adamaMissed.push({ title: i.title, date: d })
        }
      }
    }

    // his comments + honesty notes, from the audit trail of this week
    const audit = db.read('workday-audit', []).filter((e) => e.lead === lead.username && e.at.slice(0, 10) >= mon && e.at.slice(0, 10) <= fri)
    const comments = {}
    for (const e of audit.filter((e) => e.action === 'comment').sort((a, b) => a.at.localeCompare(b.at))) comments[e.detail?.key] = e.detail?.text
    const flags = audit.filter((e) => (e.action === 'unticked' || e.action === 'removed') && e.actor === lead.username)
      .map((e) => ({ action: e.action, title: e.detail?.title, at: e.at }))

    // team attendance for the week (Mon–Fri, leave excused)
    const attAll = db.read('attendance', [])
    const leaveAll = db.read('leave', [])
    const schedules = db.read('schedules', {})
    const attendance = x.members.map((m) => {
      let scheduled = 0, worked = 0, late = 0
      for (const d of days) {
        if (d > today || d < ATTENDANCE_START) continue
        const shift = effectiveWeek(schedules[m.username], d)[dowOfKey(d)]
        if (!shift || leaveOnDate(leaveAll, m.username, d)) continue
        scheduled++
        const a = attAll.find((r) => r.username === m.username && r.date === d)
        if (a?.checkIn) { worked++; if (a.late) late++ }
      }
      return { name: m.name, scheduled, worked, late }
    })

    res.json({
      lead: { username: lead.username, name: lead.name },
      week: { start: mon, end: fri, days },
      generatedAt: new Date().toISOString(),
      currentMonth: CUR,
      goals,
      objectivesByDay,
      plan,
      fromAdama: { total: adamaTotal, done: adamaDone, missed: adamaMissed },
      comments,
      objNotes: (db.read('workday-objnotes', []).find((n) => n.username === lead.username) || {}).notes || {},
      flags,
      attendance,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---- the business report: one month, the whole company (CEO only) ----
app.get('/api/report/business', auth, async (req, res) => {
  if (req.realUser?.username !== CEO) return res.status(403).json({ error: 'forbidden' })
  try {
    const today = todayKey()
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today.slice(0, 7)
    const [salesF, retF, revF, instF, stockF, onlF] = await Promise.all([
      fetchAdminFeed(`/api/integrations/pulse/sales?month=${month}`),
      fetchAdminFeed(`/api/integrations/pulse/retention?month=${month}`),
      fetchAdminFeed(`/api/integrations/pulse/reviews?month=${month}`),
      fetchAdminInstall(month),
      fetchAdminStock(month),
      fetchAdminFeed('/api/integrations/pulse/online'),
    ])
    const sum = (feed, f) => (feed?.agents || []).reduce((s, a) => s + (Number(a[f]) || 0), 0)
    const won = salesF ? sum(salesF, 'won') : null
    const rnDue = retF ? sum(retF, 'due') : null
    const rnRen = retF ? sum(retF, 'renewed') : null
    const reviews = revF ? sum(revF, 'verified') : null
    const onlTotal = onlF ? sum(onlF, 'total') : null
    const onlOn = onlF ? sum(onlF, 'online') : null
    // cases: Yafatou's number is the company number
    const yafatou = seedUsers().find((u) => !isArchived(u) && u.department === 'Customer Service')
    const casesF = yafatou ? await fetchAdminCases(yafatou.name, month) : null

    const T = (role, kpi, fb) => kpiNumber(role, kpi, month)?.target ?? fb
    const rnTargetPct = T('customer-service', 'renewal', 80)
    const goals = [
      { title: 'Sales', target: T('team-lead', 'team-sales', 12), actual: won, unit: 'sales' },
      { title: 'Renewals', target: rnDue != null ? Math.ceil(rnDue * (rnTargetPct / 100)) : null, actual: rnRen, unit: `of ${rnDue ?? '?'} due` },
      { title: 'Cases resolved on time', target: T('customer-service', 'cases', 85), actual: casesF && typeof casesF.casesPct === 'number' ? Math.round(casesF.casesPct) : null, unit: '%' },
      { title: 'Installations in 3 days', target: T('customer-service', 'install', 95), actual: instF && typeof instF.installPct === 'number' ? Math.round(instF.installPct) : null, unit: '%' },
      { title: 'Stock accountability', target: T('customer-service', 'stock', 100), actual: stockF && typeof stockF.accountabilityPct === 'number' ? Math.round(stockF.accountabilityPct) : null, unit: '%' },
      { title: 'Trackers online (now)', target: T('team-lead', 'team-online', 75), actual: onlTotal ? Math.round((onlOn / onlTotal) * 100) : null, unit: '%' },
      { title: 'Google reviews', target: T('sales', 'reviews', 3) * 2, actual: reviews, unit: 'reviews' },
    ]

    // money: payroll cost (recorded payments) + renewal revenue at flat D6,500
    const payRecs = db.read('payroll', []).filter((r) => r.period === month)
    const payrollCost = payRecs.reduce((s, r) => s + (Number(r.total) || 0), 0)
    const money = {
      payrollCost,
      payrollPeople: payRecs.length,
      renewalRevenue: rnRen != null ? rnRen * 6500 : null,
      renewalOutstanding: rnDue != null && rnRen != null ? (rnDue - rnRen) * 6500 : null,
    }

    // team: headcount + month attendance (Mon–Fri, leave excused)
    const members = seedUsers().filter((u) => !isArchived(u) && u.username !== CEO)
    const attAll = db.read('attendance', [])
    const leaveAll = db.read('leave', [])
    const schedules = db.read('schedules', {})
    let scheduled = 0, worked = 0, late = 0
    for (const m of members) {
      for (const d of monthKeys(month)) {
        if (d > today || d < ATTENDANCE_START) continue
        const shift = effectiveWeek(schedules[m.username], d)[dowOfKey(d)]
        if (!shift || leaveOnDate(leaveAll, m.username, d)) continue
        scheduled++
        const a = attAll.find((r) => r.username === m.username && r.date === d)
        if (a?.checkIn) { worked++; if (a.late) late++ }
      }
    }
    const team = { headcount: members.length, scheduled, worked, late, attendancePct: scheduled ? Math.round((worked / scheduled) * 100) : null }

    // flags: what needs a decision
    const flags = []
    for (const g of goals) {
      if (g.actual == null) flags.push(`${g.title}: no data — check the Admin feed`)
      else if (g.target != null && g.actual < g.target) flags.push(`${g.title} behind: ${g.actual}${g.unit === '%' ? '%' : ''} of ${g.target}${g.unit === '%' ? '%' : ''}`)
    }
    if (team.attendancePct != null && team.attendancePct < 90) flags.push(`Attendance at ${team.attendancePct}% — below 90`)

    res.json({ month, generatedAt: new Date().toISOString(), goals, money, team, flags })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---------- REPORTING CENTRE (Adama 10 Jul) ----------
// One endpoint, seven reports, one structure: title · summary · key metrics ·
// detail sections · recent activity · notes. Every report answers ONE
// question. The PERIOD is separate from the report type. Metrics Pulse cannot
// measure yet are named in the notes — never invented.

function rcPeriod(period, today) {
  const CUR = today.slice(0, 7)
  const [y, m] = CUR.split('-').map(Number)
  const monthsBack = (n) => {
    const out = []
    for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7))
    return out
  }
  switch (period) {
    case 'today': return { label: `Today, ${today}`, months: [CUR], from: today, to: today }
    case 'week': { const mon = mondayOf(today); return { label: `Week of ${mon}`, months: [CUR], from: mon, to: weekDaysOf(mon)[4] } }
    case 'last_month': { const pm = monthsBack(2)[1]; return { label: monthName(pm), months: [pm], from: `${pm}-01`, to: `${pm}-31` } }
    case 'quarter': { const ms = monthsBack(3); return { label: `Last 3 months`, months: ms, from: `${ms[2]}-01`, to: today } }
    case 'year': { const ms = monthsBack(12); return { label: `Last 12 months`, months: ms, from: `${ms[11]}-01`, to: today } }
    default: return { label: monthName(CUR), months: [CUR], from: `${CUR}-01`, to: today }
  }
}
function monthName(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const rcSum = (feed, f) => (feed?.agents || []).reduce((s, a) => s + (Number(a[f]) || 0), 0)

// Aggregate the month-parameterised Admin feeds over the period's months.
async function rcFeeds(months) {
  const per = await Promise.all(months.map(async (mm) => ({
    month: mm,
    sales: await fetchAdminFeed(`/api/integrations/pulse/sales?month=${mm}`),
    ret: await fetchAdminFeed(`/api/integrations/pulse/retention?month=${mm}`),
    rev: await fetchAdminFeed(`/api/integrations/pulse/reviews?month=${mm}`),
    inst: await fetchAdminInstall(mm),
    stock: await fetchAdminStock(mm),
  })))
  const online = await fetchAdminFeed('/api/integrations/pulse/online')
  return { per, online }
}

function rcAttendance(members, from, to, today) {
  const attAll = db.read('attendance', [])
  const leaveAll = db.read('leave', [])
  const schedules = db.read('schedules', {})
  const rows = members.map((mem) => {
    let scheduled = 0, worked = 0, late = 0
    const d = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)
    while (d <= end) {
      const k = d.toISOString().slice(0, 10)
      d.setUTCDate(d.getUTCDate() + 1)
      if (k > today || k < ATTENDANCE_START) continue
      const shift = effectiveWeek(schedules[mem.username], k)[dowOfKey(k)]
      if (!shift || leaveOnDate(leaveAll, mem.username, k)) continue
      scheduled++
      const a = attAll.find((r) => r.username === mem.username && r.date === k)
      if (a?.checkIn) { worked++; if (a.late) late++ }
    }
    return { name: mem.name, scheduled, worked, late }
  })
  const tot = rows.reduce((s, r) => ({ scheduled: s.scheduled + r.scheduled, worked: s.worked + r.worked, late: s.late + r.late }), { scheduled: 0, worked: 0, late: 0 })
  return { rows, pct: tot.scheduled ? Math.round((tot.worked / tot.scheduled) * 100) : null, ...tot }
}

const rcStatus = (actual, target) => actual == null ? 'no data' : target == null ? '—' : actual >= target ? 'On target' : actual >= target * 0.7 ? 'Needs attention' : 'Behind'

app.get('/api/reportx', auth, async (req, res) => {
  const report = String(req.query.report || 'overview')
  const period = String(req.query.period || 'month')
  const today = todayKey()
  const CUR = today.slice(0, 7)
  const isCeo = req.realUser?.username === CEO
  const isHr = isCeo || can(req.user, 'hr')
  const isLead = leadsATeam(findUser(req.user.username) || {})
  if (!isHr && !isLead) return res.status(403).json({ error: 'forbidden' })
  if ((report === 'finance' || report === 'people') && !isHr) return res.status(403).json({ error: 'forbidden' })
  try {
    const P = rcPeriod(period, today)
    const F = await rcFeeds(P.months)
    const T = (role, kpi, fb) => kpiNumber(role, kpi, CUR)?.target ?? fb
    const members = seedUsers().filter((u) => !isArchived(u) && u.username !== CEO)
    const sellers = members.filter((u) => u.department === 'Sales')
    const yafatou = members.find((u) => u.department === 'Customer Service')
    const nMonths = P.months.length
    const scale = (t) => (t == null ? null : t * nMonths)

    const won = F.per.some((p) => p.sales) ? F.per.reduce((s, p) => s + rcSum(p.sales, 'won'), 0) : null
    const rnDue = F.per.some((p) => p.ret) ? F.per.reduce((s, p) => s + rcSum(p.ret, 'due'), 0) : null
    const rnRen = F.per.some((p) => p.ret) ? F.per.reduce((s, p) => s + rcSum(p.ret, 'renewed'), 0) : null
    const reviews = F.per.some((p) => p.rev) ? F.per.reduce((s, p) => s + rcSum(p.rev, 'verified'), 0) : null
    const onlTotal = rcSum(F.online, 'total'), onlOn = rcSum(F.online, 'online')
    const onlPct = F.online && onlTotal ? Math.round((onlOn / onlTotal) * 100) : null
    const casesAgg = { onTime: 0, resolved: 0, overdue: 0, seen: false }
    for (const p of P.months) {
      const c = yafatou ? await fetchAdminCases(yafatou.name, p) : null
      if (c) { casesAgg.seen = true; casesAgg.onTime += Number(c.onTime) || 0; casesAgg.resolved += Number(c.resolved) || 0; casesAgg.overdue += Number(c.openOverdue) || 0 }
    }
    const casesPct = casesAgg.seen && (casesAgg.resolved + casesAgg.overdue) ? Math.round((casesAgg.onTime / (casesAgg.resolved + casesAgg.overdue)) * 100) : null
    const inst = F.per[0]?.inst || null
    const stock = F.per[0]?.stock || null
    const stockPct = stock && typeof stock.accountabilityPct === 'number' ? Math.round(stock.accountabilityPct) : null
    const instPct = inst && typeof inst.installPct === 'number' ? Math.round(inst.installPct) : null
    const rnTargetPct = T('customer-service', 'renewal', 80)
    const rnNeed = rnDue != null ? Math.ceil(rnDue * (rnTargetPct / 100)) : null
    const salesTarget = scale(T('team-lead', 'team-sales', 12))
    const reviewsTarget = scale(T('sales', 'reviews', 3) * Math.max(1, sellers.length))

    const M = (label, value, sub) => ({ label, value: value == null ? '—' : String(value), sub: sub || null })
    let out = null

    if (report === 'overview') {
      const areas = [
        { area: 'Sales', status: rcStatus(won, salesTarget), line: won != null ? `${won}/${salesTarget}` : 'no data' },
        { area: 'Renewals', status: rcStatus(rnRen, rnNeed), line: rnRen != null ? `${rnRen} of ${rnDue} due` : 'no data' },
        { area: 'Customer service', status: rcStatus(casesPct, T('customer-service', 'cases', 85)), line: casesPct != null ? `${casesPct}% on time` : 'no data' },
        { area: 'Operations', status: rcStatus(instPct, T('customer-service', 'install', 95)), line: instPct != null ? `${instPct}% installs in 3 days` : 'no data' },
        { area: 'Inventory', status: rcStatus(stockPct, T('customer-service', 'stock', 100)), line: stockPct != null ? `${stockPct}% verified` : 'no data' },
        { area: 'Trackers online', status: rcStatus(onlPct, T('team-lead', 'team-online', 75)), line: onlPct != null ? `${onlPct}%` : 'no data' },
      ]
      const att = rcAttendance(members, P.from, P.to, today)
      areas.push({ area: 'Attendance', status: att.pct == null ? 'no data' : att.pct >= 90 ? 'On target' : att.pct >= 75 ? 'Needs attention' : 'Behind', line: att.pct != null ? `${att.pct}%` : 'no data' })
      const behind = areas.filter((a) => a.status === 'Behind').map((a) => a.area)
      const attn = areas.filter((a) => a.status === 'Needs attention').map((a) => a.area)
      const good = areas.filter((a) => a.status === 'On target').map((a) => a.area)
      const score = areas.filter((a) => a.status !== 'no data').length
        ? Math.round((good.length / areas.filter((a) => a.status !== 'no data').length) * 100) : null
      out = {
        question: 'How is the business doing?',
        summary: behind.length
          ? `${behind.join(' and ')} ${behind.length === 1 ? 'is' : 'are'} behind target${attn.length ? `; ${attn.join(', ').toLowerCase()} need${attn.length === 1 ? 's' : ''} attention` : ''}${good.length ? `, while ${good.join(', ').toLowerCase()} ${good.length === 1 ? 'is' : 'are'} performing well` : ''}.`
          : attn.length ? `Business is stable — ${attn.join(', ').toLowerCase()} need${attn.length === 1 ? 's' : ''} attention.` : 'Business is on track across the board.',
        metrics: [M('Health score', score != null ? `${score}%` : null, 'areas on target'), M('Areas behind', behind.length), M('Need attention', attn.length)],
        sections: [{ title: 'Business areas', rows: areas.map((a) => [a.area, a.line, a.status]) , head: ['Area', 'Where it stands', 'Status'] }],
        activity: [],
        notes: [],
      }
    }

    if (report === 'sales') {
      const perAgent = new Map()
      for (const p of F.per) for (const a of (p.sales?.agents || [])) perAgent.set(a.name, (perAgent.get(a.name) || 0) + (Number(a.won) || 0))
      const trend = [...F.per].reverse().map((p) => [monthName(p.month), p.sales ? String(rcSum(p.sales, 'won')) : '—'])
      out = {
        question: 'Are we selling enough?',
        summary: won == null ? 'The sales feed is unreachable — get the numbers from the agents directly.'
          : `${won} sale${won === 1 ? '' : 's'} against a target of ${salesTarget}. ${[...perAgent.entries()].sort((a, b) => b[1] - a[1]).map(([n, w]) => `${n.split(' ')[0]} ${w}`).join(', ') || ''}.`,
        metrics: [M('Target', salesTarget), M('Completed', won), M('Remaining', won != null && salesTarget != null ? Math.max(0, salesTarget - won) : null), M('Per salesperson', won != null && sellers.length ? (won / sellers.length).toFixed(1) : null)],
        sections: [
          { title: 'By salesperson', head: ['Agent', 'Sales'], rows: sellers.map((s0) => [s0.name, String(perAgent.get(s0.name) ?? '—')]) },
          ...(nMonths > 1 ? [{ title: 'Trend', head: ['Month', 'Sales'], rows: trend }] : []),
        ],
        activity: [],
        notes: ['Not measured yet in Pulse: revenue per sale, conversion rate, pipeline and opportunities (they live in Admin → Sales).'],
      }
    }

    if (report === 'cs') {
      out = {
        question: 'Are customers being looked after?',
        summary: casesPct == null && rnRen == null ? 'Customer service feeds are unreachable.' :
          `Case resolution ${casesPct != null ? `at ${casesPct}%` : 'has no data'}${casesAgg.overdue ? ` with ${casesAgg.overdue} past deadline` : ''}; ${rnRen ?? '—'} of ${rnDue ?? '—'} due customers renewed; ${reviews ?? '—'} five-star reviews.`,
        metrics: [M('Resolution rate', casesPct != null ? `${casesPct}%` : null, `target ${T('customer-service', 'cases', 85)}%`), M('Resolved on time', casesAgg.seen ? casesAgg.onTime : null), M('Past deadline', casesAgg.seen ? casesAgg.overdue : null), M('Renewals', rnRen, rnDue != null ? `of ${rnDue} due` : null), M('Google reviews', reviews, reviewsTarget != null ? `target ${reviewsTarget}` : null)],
        sections: [],
        activity: [],
        notes: ['Not measured yet: average response time, customer satisfaction, per-case lists (Admin → Cases has the queue).'],
      }
    }

    if (report === 'operations') {
      out = {
        question: 'Are installations and inventory under control?',
        summary: instPct == null && stockPct == null ? 'Operations feeds are unreachable.' :
          `Installations ${instPct != null ? `${instPct}% within 3 days` : 'no data'}${inst?.openLate ? ` (${inst.openLate} open past 3 days)` : ''}; stock ${stockPct != null ? `${stockPct}% verified` : 'no data'}${stock?.outstandingMissing ? ` with ${stock.outstandingMissing} trackers unaccounted` : ''}; ${onlPct != null ? `${onlPct}% of trackers online` : 'online rate unavailable'}.`,
        metrics: [M('Installs in 3 days', instPct != null ? `${instPct}%` : null, `target ${T('customer-service', 'install', 95)}%`), M('Installs completed', inst?.completed ?? null), M('Stock verified', stockPct != null ? `${stockPct}%` : null, `target ${T('customer-service', 'stock', 100)}%`), M('Trackers online', onlPct != null ? `${onlPct}%` : null, onlTotal ? `${onlOn} of ${onlTotal}` : null)],
        sections: [],
        activity: [],
        notes: ['Not measured yet: average installation time, SIM inventory counts and technician workload (Admin → Inventory / SIM & Data).'],
      }
    }

    if (report === 'finance') {
      const payRows = P.months.map((mm) => {
        const recs = db.read('payroll', []).filter((r) => r.period === mm)
        return [monthName(mm), recs.length ? `D${recs.reduce((s, r) => s + (Number(r.total) || 0), 0).toLocaleString()}` : '—', String(recs.length)]
      })
      const payrollCost = P.months.reduce((s, mm) => s + db.read('payroll', []).filter((r) => r.period === mm).reduce((a, r) => a + (Number(r.total) || 0), 0), 0)
      const renewalRevenue = rnRen != null ? rnRen * 6500 : null
      const outstanding = rnDue != null && rnRen != null ? (rnDue - rnRen) * 6500 : null
      out = {
        question: 'Are we making money?',
        summary: `Payroll paid D${payrollCost.toLocaleString()} this period; renewals brought ${renewalRevenue != null ? `D${renewalRevenue.toLocaleString()}` : '—'} with ${outstanding != null ? `D${outstanding.toLocaleString()}` : '—'} still out there.`,
        metrics: [M('Payroll paid', `D${payrollCost.toLocaleString()}`), M('Renewal revenue', renewalRevenue != null ? `D${renewalRevenue.toLocaleString()}` : null, 'recorded × D6,500'), M('Renewals outstanding', outstanding != null ? `D${outstanding.toLocaleString()}` : null, 'due, not renewed')],
        sections: [{ title: 'Payroll by month', head: ['Month', 'Paid', 'Payments'], rows: payRows }],
        activity: [],
        notes: ['Not measured in Pulse: total revenue, expenses, profit and cash balance — they live in Zoho Books; new-sale revenue is not fed to Pulse.'],
      }
    }

    if (report === 'people') {
      const att = rcAttendance(members, P.from, P.to, today)
      const leaveAll = db.read('leave', []).filter((l) => l.status === 'approved' && l.from <= P.to && l.to >= P.from)
      const coachingAll = db.read('coaching', []).filter((c) => { const d0 = (c.datetime || c.createdAt || '').slice(0, 10); return d0 >= P.from && d0 <= P.to })
      const reviewsStore = db.read('reviews', {})
      const reviewsDone = members.filter((mem) => (reviewsStore[mem.name] || []).some((r) => P.months.includes(r.period))).length
      const warnAll = db.read('warnings', []).filter((w) => (w.date || '') >= P.from && (w.date || '') <= P.to)
      const contractsSoon = members.map((mem) => { const p0 = team.find((t) => t.name === mem.name); const end = p0?.contractEnd || mem.contractEnd; if (!end) return null; const d0 = Math.ceil((new Date(`${end}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000); return d0 >= 0 && d0 <= 45 ? [mem.name, `${d0} days`] : null }).filter(Boolean)
      const left = pastStaff.filter((p0) => P.months.some((mm) => (p0.date || '').includes(monthName(mm).split(' ')[0].slice(0, 3))))
      out = {
        question: 'Is the team healthy?',
        summary: `Attendance at ${att.pct != null ? `${att.pct}%` : '—'} (${att.worked} of ${att.scheduled} scheduled days), ${coachingAll.length} coaching session${coachingAll.length === 1 ? '' : 's'} logged, ${reviewsDone} of ${members.length} monthly reviews done, ${warnAll.length} warning${warnAll.length === 1 ? '' : 's'} issued.`,
        metrics: [M('Attendance', att.pct != null ? `${att.pct}%` : null, `${att.late} late arrivals`), M('Coaching sessions', coachingAll.length), M('Reviews done', `${reviewsDone}/${members.length}`), M('Warnings', warnAll.length), M('On approved leave', leaveAll.length)],
        sections: [
          { title: 'Attendance by person', head: ['Person', 'Worked', 'Late'], rows: att.rows.map((r) => [r.name, `${r.worked}/${r.scheduled}`, String(r.late)]) },
          ...(contractsSoon.length ? [{ title: 'Contracts ending soon', head: ['Person', 'Ends in'], rows: contractsSoon }] : []),
          ...(left.length ? [{ title: 'Left this period', head: ['Person', 'Reason'], rows: left.map((p0) => [p0.name, p0.reason || '—']) }] : []),
        ],
        activity: coachingAll.slice(-8).reverse().map((c) => `Coaching: ${c.title || 'check-in'} (${(c.datetime || c.createdAt || '').slice(0, 10)})`),
        notes: ['Not tracked yet: promotions as records (role changes live in contracts).'],
      }
    }

    if (report === 'managers') {
      const lead = seedUsers().find((u) => !isArchived(u) && leadsATeam(u))
      if (!lead) { out = { question: 'Are managers managing?', summary: 'No team leads yet.', metrics: [], sections: [], activity: [], notes: [] } }
      else {
        const KEY_TITLES = { renewals: 'Renewals', sales: 'Sales', cases: 'Customer cases', online: 'Trackers online', reviews: 'Google reviews', other: 'Other', quick: 'Other', myobj: 'Own objective', biz: 'Business' }
        const teamMembers = teamMembersFor(lead)
        const coachingAll = db.read('coaching', []).filter((c) => { const d0 = (c.datetime || c.createdAt || '').slice(0, 10); return d0 >= P.from && d0 <= P.to })
        const reviewsStore = db.read('reviews', {})
        const reviewsDone = teamMembers.filter((mem) => (reviewsStore[mem.name] || []).some((r) => P.months.includes(r.period))).length
        const pendingLeave = db.read('leave', []).filter((l) => l.status === 'pending' && teamMembers.some((mem) => mem.username === l.username)).length

        // his days: which objectives held the chair, what he planned, what got done
        const snaps = opsSnapshots().filter((sn) => sn.username === lead.username).sort((a, b) => a.date.localeCompare(b.date))
        const dayDelta = (date, field) => {
          const i = snaps.findIndex((sn) => sn.date === date && sn[field] != null)
          if (i < 1) return null
          const prev = [...snaps.slice(0, i)].reverse().find((sn) => sn[field] != null)
          return prev ? Math.max(0, (Number(snaps[i][field]) || 0) - (Number(prev[field]) || 0)) : null
        }
        const dayRows = []
        const itemRows = []
        let planned = 0, done = 0, adamaT = 0, adamaD = 0
        const dcur = new Date(`${P.from}T00:00:00Z`)
        const dend = new Date(`${P.to <= today ? P.to : today}T00:00:00Z`)
        const pick = objectivePickFor(lead.username)
        while (dcur <= dend) {
          const k = dcur.toISOString().slice(0, 10)
          const dow = dcur.getUTCDay()
          dcur.setUTCDate(dcur.getUTCDate() + 1)
          if (dow === 0 || dow === 6) continue
          const rec = workdayGet(lead.username, k)
          const keys = rec?.slots?.primary ? rec.slots : rotationKeys(rec?.pool || [], pick, k)
          const items = (rec?.items || []).filter((i) => !i.deleted)
          const dDone = items.filter((i) => i.done).length
          planned += items.length; done += dDone
          for (const i of items) { if (i.byAdama) { adamaT++; if (i.done) adamaD++ } }
          const moved = [
            dayDelta(k, 'teamWon') ? `sales +${dayDelta(k, 'teamWon')}` : null,
            dayDelta(k, 'rnRen') ? `renewals +${dayDelta(k, 'rnRen')}` : null,
            dayDelta(k, 'casesOnTime') ? `cases +${dayDelta(k, 'casesOnTime')}` : null,
          ].filter(Boolean).join(' · ')
          const dayLabel = new Date(`${k}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
          dayRows.push([dayLabel, `${KEY_TITLES[keys.primary] || keys.primary} + ${KEY_TITLES[keys.supporting] || keys.supporting}`, items.length ? `${dDone}/${items.length} done` : 'no plan written', moved || '—'])
          for (const i of items) itemRows.push([dayLabel, KEY_TITLES[i.focusKey] || i.focusKey, `${i.title}${i.byAdama ? ' (from Adama)' : ''}`, i.done ? '✓ done' : i.carried ? '○ carried over' : '○ not done'])
        }
        const objNotes = (db.read('workday-objnotes', []).find((n) => n.username === lead.username) || {}).notes || {}
        const commentRows = Object.entries(objNotes).filter(([, t]) => t).map(([k2, t]) => [KEY_TITLES[k2] || k2, t])

        // only the activity worth asking about — never the raw edit noise
        const audit = db.read('workday-audit', []).filter((e) => e.lead === lead.username && e.at.slice(0, 10) >= P.from && e.at.slice(0, 10) <= P.to)
        const flagged = audit.filter((e) => e.action === 'unticked' || e.action === 'removed')
          .map((e) => `${e.at.slice(0, 10)} — ${e.actor === CEO ? 'Adama' : e.actor} ${e.action === 'unticked' ? 'UNTICKED' : 'removed'} “${e.detail?.title || ''}”`)
        const objChanges = audit.filter((e) => e.action === 'objectives-set')
          .map((e) => `${e.at.slice(0, 10)} — Adama set objectives: ${e.detail?.primary || 'auto'} + ${e.detail?.supporting || 'auto'}`)

        out = {
          question: 'Are managers managing effectively?',
          summary: `${lead.name}: ${planned ? `${done} of ${planned} planned items done (${Math.round((done / planned) * 100)}%)` : 'no plan written this period'}${adamaT ? `, ${adamaD}/${adamaT} of Adama's items done` : ''}, ${coachingAll.length} coaching session${coachingAll.length === 1 ? '' : 's'}, ${reviewsDone}/${teamMembers.length} reviews completed${pendingLeave ? `, ${pendingLeave} leave request${pendingLeave === 1 ? '' : 's'} waiting on him` : ''}.`,
          metrics: [M('Plan done', planned ? `${Math.round((done / planned) * 100)}%` : null, planned ? `${done} of ${planned}` : 'no plan'), M('Coaching', coachingAll.length), M('Reviews', `${reviewsDone}/${teamMembers.length}`), M('From Adama', adamaT ? `${adamaD}/${adamaT}` : '—'), M('Approvals waiting', pendingLeave)],
          sections: [
            { title: 'Day by day', head: ['Day', 'Objectives', 'Plan', 'Numbers moved'], rows: dayRows },
            ...(itemRows.length ? [{ title: 'The plan, item by item', head: ['Day', 'Objective', 'Item', 'Status'], rows: itemRows.slice(0, 60) }] : []),
            ...(commentRows.length ? [{ title: 'His comments', head: ['Objective', 'Comment'], rows: commentRows }] : []),
          ],
          activity: [...flagged, ...objChanges].slice(0, 15),
          notes: flagged.length ? ['Activity shows only unticks, removals and objective changes — the things worth asking about.'] : [],
        }
      }
    }

    if (!out) return res.status(400).json({ error: 'unknown report' })
    res.json({ report, period: { key: period, label: P.label }, generatedAt: new Date().toISOString(), ...out })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
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
const HHMM_MIN = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

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
  return shiftMinutes(shift) / 60
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
      ? seedUsers().filter((u) => teamSet.has(u.username) && !u.contractor)
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

// A break belongs to the SHIFT, not alongside it (Adama 28 Aug mockup) — kept
// inside the day so every reader of a schedule subtracts it without knowing it
// exists. 0 = no fixed break, which is what most of the team works.
const BREAK_CHOICES = [0, 30, 45, 60, 90]
function cleanBreak(v) {
  const n = Math.round(Number(v) || 0)
  return BREAK_CHOICES.includes(n) ? n : 0
}
function cleanWeek(incoming = {}) {
  const clean = {}
  for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
    const v = incoming[dow]
    if (!(v && HHMM.test(v.start || '') && HHMM.test(v.end || ''))) { clean[dow] = null; continue }
    const brk = cleanBreak(v.breakMinutes)
    clean[dow] = brk ? { start: v.start, end: v.end, breakMinutes: brk } : { start: v.start, end: v.end }
  }
  return clean
}
// 🔒 The ONE place a shift becomes minutes. Everything that reports scheduled
// hours goes through here, so a break can never be counted as worked time on
// one page and not on another.
function shiftMinutes(shift) {
  if (!shift) return 0
  const span = HHMM_MIN(shift.end) - HHMM_MIN(shift.start)
  return Math.max(0, span - (Number(shift.breakMinutes) || 0))
}
function scheduleRoster(req) {
  // the people the VIEWED user's Team power covers (named sub-toggles);
  // the CEO is never in anyone's roster. Contractors don't check in or hold
  // a schedule (Adama 3 Aug: Abdourahman) — they never appear here.
  const scope = powerScopeSet(req.user, 'team')
  // Nobody is absent from a job they have not been activated into.
  return seedUsers().filter((u) => scope.has(u.username) && !u.contractor && isOnStaff(u))
}

// Write one dated entry for one person, and hand back what changed.
//
// "Only for one week" (Adama 28 Aug mockup) needs NO new storage: the new week
// goes in at `from`, and a second entry goes in seven days later carrying
// whatever week WOULD have applied then had this change never happened. The
// pattern reverts on its own and effectiveWeek() resolves it like any other
// entry — nothing that reads a schedule has to know a temporary week exists.
function upsertSchedule(all, username, payload) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(payload?.from) ? payload.from : todayKey()
  const days = cleanWeek(payload?.days || payload)
  const before = scheduleEntries(all[username])
  const entries = before.filter((e) => e.from !== from)
  entries.push({ from, days })
  let until = null
  if (payload?.oneWeek) {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7)
    until = d.toISOString().slice(0, 10)
    // If something was already due to start that day, it already says what
    // resumes — do not overwrite a change he scheduled on purpose.
    if (!before.some((e) => e.from === until)) {
      entries.push({ from: until, days: effectiveWeek(all[username], until) })
    }
  }
  entries.sort((a2, b2) => (a2.from < b2.from ? -1 : 1))
  all[username] = entries
  return { from, until }
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
  let until = null
  for (const [username, payload] of Object.entries(incoming)) {
    if (!allowed.has(username)) continue
    ;({ until } = upsertSchedule(all, username, payload))
    count++
  }
  db.write('schedules', all)
  res.json({ count, until })
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
  let until = null
  for (const [username, payload] of Object.entries(incoming)) {
    if (!teamSet.has(username)) continue
    ;({ until } = upsertSchedule(all, username, payload))
    count++
  }
  db.write('schedules', all)
  res.json({ count, until })
})

// manager: set one person's weekly roster (in/off + hours per weekday)
app.put('/api/schedules/:username', auth, requireSub('team', 'schedules'), notViewAs, (req, res) => {
  const target = findUser(req.params.username)
  if (!target) return res.status(404).json({ error: 'No such user' })
  const all = db.read('schedules', {})
  // Was assigning a bare week object straight over the entry LIST, throwing
  // away every dated version the person had. Same upsert as the other two now.
  const { from, until } = upsertSchedule(all, target.username, { from: req.body?.from, days: req.body?.days, oneWeek: req.body?.oneWeek })
  db.write('schedules', all)
  res.json({ username: target.username, schedule: effectiveWeek(all[target.username], todayKey()), from, until })
})

// ---------- Reports (Adama 3 Jul) ----------
// The month's story: who came to work (and who didn't, with the exact days),
// coaching word-for-word, who's doing what (sales/review/warnings), leave and
// payroll cost. Sections compose from the VIEWED user's powers + named scopes.
app.get('/api/reports/month', auth, async (req, res) => {
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
    const salesTally = await salesTallyFor(month)
    // This list is every person in scope, not just sellers. A zero has to mean
    // "sold nothing", so only a seller gets one — an office cleaner gets no
    // number at all. Anyone who DID close something is shown regardless of
    // department, because admin says they closed it.
    const deptOf = (name) => seedUsers().find((x) => x.name === name)?.department || ''
    const salesHere = (name) => {
      if (month < SALES_ADMIN_FROM) return salesFromSheet(name, month)
      if (!salesTally) return null
      const won = salesTally.get(name)
      if (won !== undefined) return won
      return deptOf(name) === 'Sales' ? 0 : null
    }
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
        sales: salesHere(name),
        // Admin's feed carries the count, not the money — a sheet month keeps
        // its revenue, an admin month shows none rather than a stale figure.
        revenue: month < SALES_ADMIN_FROM && m ? m.revenue : null,
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
// ── ONE MONTH OF ONE PERSON'S ATTENDANCE (Adama 27 Aug, the employee-record
// Attendance mockup) ──────────────────────────────────────────────────────
// The record page used to compute attendance for the CURRENT month only, so
// the tab's month arrows moved the calendar while the data underneath stayed
// on this month. This owns the month instead, and every figure the tab shows
// comes from here — the tiles, the calendar, the strip and the table cannot
// quote different numbers.
//
// 🔒 Measured only. Overtime is time past THAT DAY'S scheduled end, not past
// a hardcoded 8 hours; a day with no check-out earns no overtime rather than
// an assumed one. There is no excused/unexcused split on an absence because
// nothing in Pulse records one (Adama 27 Aug) — approved leave is its own
// status, and the absence count stands on its own.
function attendanceMonth(username, month) {
  const days = monthKeys(month)
  const todayK = todayKey()
  const attAll = db.read('attendance', []).filter((a) => a.username === username)
  const leaveAll = db.read('leave', [])
  // 🔴 NOBODY IS ABSENT BEFORE THEY WERE HIRED. Mustapha joined 19 Aug and
  // his record read "14 days absent this month" — the month started counting
  // on the 1st (Adama, 27 Aug). The floor is the LATER of the attendance
  // system's own start and this person's join date.
  // 🔒 SOMEONE WHO DOES NOT CLOCK IN IS NEVER ABSENT. A contractor keeps no
  // schedule (the flag's whole meaning — Adama 3 Aug, and again 28 Aug for
  // Abdourahman and the Cleaner: "not full time employees that check in and
  // out"). Without this their record filled with red "No clock in" days
  // against a Mon–Fri week nobody ever agreed to.
  const person = findUser(username)
  const keepsSchedule = !person?.contractor
  const joined = String(person?.joined || '').slice(0, 10)
  const startFrom = /^\d{4}-\d{2}-\d{2}$/.test(joined) && joined > ATTENDANCE_START ? joined : ATTENDANCE_START
  // 🔴 A stored schedule is an ARRAY of dated versions ([{from, days}]), not
  // a weekday map — indexing it by day-of-week silently returns entry 0 for
  // Sunday and undefined for every other day, which read as "works Sundays
  // only" and printed a 325% attendance rate (Adama, 27 Aug). effectiveWeek
  // is the only correct way to resolve one.
  const stored = db.read('schedules', {})[username]

  const cells = days.map((date) => {
    const attendance = attAll.find((a) => a.date === date) || null
    const leave = leaveOnDate(leaveAll, username, date)
    const schedule = effectiveWeek(stored, date)
    const shift = keepsSchedule ? (schedule[dowOfKey(date)] || null) : null
    // Before they joined, the day is simply not theirs — never an absence.
    const status = date < startFrom || !keepsSchedule
      ? (attendance?.checkIn ? (attendance.late ? 'late' : 'worked') : 'off')
      : dayStatus({ schedule, attendance, leave }, date, todayK)
    const startMin = shift ? HHMM_MIN(shift.start) : null
    const endMin = shift ? HHMM_MIN(shift.end) : null
    const inMs = attendance?.checkIn ? Date.parse(attendance.checkIn) : null
    const outMs = attendance?.checkOut ? Date.parse(attendance.checkOut) : null
    const workedMinutes = inMs && outMs ? Math.max(0, Math.round((outMs - inMs) / 60000)) : null
    // Overtime = past the scheduled end of THAT day. No check-out, no claim.
    let overtimeMinutes = 0
    if (outMs != null && endMin != null) {
      const out = new Date(outMs)
      overtimeMinutes = Math.max(0, (out.getUTCHours() * 60 + out.getUTCMinutes()) - endMin)
    }
    // A day someone clocked into and never out of is not a number we can
    // trust — it is a record a manager has to close.
    const missingCheckout = !!(attendance?.checkIn && !attendance.checkOut && date < todayK)
    return {
      date,
      status,
      checkIn: attendance?.checkIn || null,
      checkOut: attendance?.checkOut || null,
      workedMinutes,
      overtimeMinutes,
      missingCheckout,
      late: !!attendance?.late,
      leaveType: leave?.leaveType || null,
      scheduled: shift ? { start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes || 0 } : null,
      // Through shiftMinutes, so an unpaid break is not reported as hours the
      // person was scheduled to work.
      scheduledMinutes: shiftMinutes(shift),
      fixedByName: attendance?.fixedByName || null,
      fixReason: attendance?.fixReason || '',
    }
  })

  // Scheduled days = days this person was rostered, counted only up to today
  // so a rate is not punished for days that have not happened yet.
  const elapsed = cells.filter((c) => c.date <= todayK && c.date >= startFrom)
  const scheduledDays = elapsed.filter((c) => c.scheduled).length
  const present = elapsed.filter((c) => c.status === 'worked' || c.status === 'late').length
  const late = elapsed.filter((c) => c.status === 'late').length
  const absent = elapsed.filter((c) => c.status === 'absent').length
  const leaveDays = elapsed.filter((c) => c.status === 'leave' || c.status === 'sick').length
  const workedMinutes = elapsed.reduce((s, c) => s + (c.workedMinutes || 0), 0)
  const scheduledMinutes = elapsed.filter((c) => c.scheduled).reduce((s, c) => s + c.scheduledMinutes, 0)
  const overtimeMinutes = elapsed.reduce((s, c) => s + c.overtimeMinutes, 0)
  const missingCheckouts = elapsed.filter((c) => c.missingCheckout).length

  return {
    month,
    today: todayK,
    attendanceStart: startFrom,
    keepsSchedule,
    days: cells,
    summary: {
      scheduledDays,
      present,
      late,
      absent,
      leave: leaveDays,
      workedMinutes,
      scheduledMinutes,
      overtimeMinutes,
      missingCheckouts,
      ratePct: scheduledDays ? Math.round((present / scheduledDays) * 100) : null,
      latePctOfAttended: present ? Math.round((late / present) * 1000) / 10 : null,
    },
  }
}
// The tab reads this; same gate as the record it sits on.
app.get('/api/hr/employee/:username/attendance', auth, requirePower('hr'), (req, res) => {
  const u = findUser(req.params.username)
  // Someone who has left keeps their attendance: it is the record of the months
  // they worked, and it is exactly what a question about their exit asks for.
  if (!u) return res.status(404).json({ error: 'not found' })
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayKey().slice(0, 7)
  res.json(attendanceMonth(u.username, month))
})

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
    const stored = schedules[u.username]
    const byDate = {}
    for (const k of days) {
      const attendance = attAll.find((a) => a.username === u.username && a.date === k) || null
      const leave = leaveOnDate(leaveAll, u.username, k)
      // Resolved per DATE: a schedule is a list of dated versions, and the
      // one in force can change mid-month.
      const schedule = effectiveWeek(stored, k)
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
    const sched = effectiveWeek(db.read('schedules', {})[username], date)[dowOfKey(date)] || { start: '09:00', end: '17:00' }
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
    // Pay lives server-side (lib/roster-pay.js), keyed by name. Created-via-Pulse
    // staff carry their figure on the user record (u.salary) instead. Confirmed
    // by Adama 15 Jul: rosterPay holds the identical figures moved out of team.js.
    const pay = contractPay(u)
    return {
      username: u?.username || null,
      name: p.name,
      title: p.role || u?.title || '',
      department: p.type || u?.department || '',
      base: Number(pay.base) || 0,
      commission: Number(pay.commission) || 0,
      transport: Number(pay.transport) || 0,
      total: Number(pay.total) || 0,
    }
  }).filter((p) => p.username)
  const scope = powerScopeSet(req.user, 'payroll')
  res.json({ people: people.filter((p) => scope.has(p.username)) })
})

// Past-staff settlement + legacy payroll history + payroll total. All pay data,
// so payroll-gated (was bundled in the public JS until 15 Jul 2026). Feeds the HR
// "past employees" pay fields, the Payroll History card, and the payroll total.
app.get('/api/roster/private', auth, requirePower('payroll'), (req, res) => {
  const pastStaffFull = (pastStaff || []).map((p) => ({ ...p, ...(pastStaffPay[p.name] || { pay: 0, finalPay: 0 }) }))
  res.json({ pastStaff: pastStaffFull, payrollHistory: legacyPayrollHistory, totalPayroll })
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
  // Pay moved off roster entries on 15 Jul — read rosterPay / the user's pay
  // split. Commission is left off the draft: it's "up to", not automatic.
  const u = findUser(username)
  const pay = rosterPay[r.name] || u?.pay || (u?.salary ? { base: Number(u.salary) } : {})
  const earnings = [{ label: 'Base salary', amount: Number(pay.base) || 0 }]
  if (Number(pay.transport) > 0) earnings.push({ label: 'Transport allowance', amount: Number(pay.transport) })
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
  // Self-heal for the cross-month double-adopt bug (fixed below): a payment
  // recorded into one month but PAID on a date in the next month got adopted
  // again into that next month — two local records pointing at the SAME Books
  // expense (Cleaner + Momodou, Jun paid in Jul). Keep the record a person
  // actually posted (or the oldest) and drop the extras. Local only — the
  // Books expense is never touched.
  {
    const all = db.read('payroll', [])
    const byExp = {}
    for (const r of all) if (r.expenseId) (byExp[String(r.expenseId)] ||= []).push(r)
    const drop = new Set()
    for (const group of Object.values(byExp)) {
      if (group.length < 2) continue
      const keep = group.find((r) => r.postedBy !== 'books-sync') || group.slice().sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)))[0]
      for (const r of group) if (r !== keep) drop.add(r.id)
    }
    if (drop.size) { db.write('payroll', all.filter((r) => !drop.has(r.id))); _payrollCache = null }
  }
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
          // Books holds ONE number — after a Zoho-side edit the old salary/
          // bonus split is meaningless, so reset it (salary = total, bonus 0).
          // Leaving the split alone kept ghost bonuses alive no matter how
          // many times Books was corrected (Sally's 7k+7k, Jun).
          r.total = Math.round(exp.total); r.salary = r.total; r.bonus = 0; r.editedInZoho = true
          const i = all.findIndex((x) => x.id === r.id)
          if (i >= 0) { all[i] = { ...all[i], total: r.total, salary: r.total, bonus: 0, editedInZoho: true }; changed = true }
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
      // Claimed = expenses linked by ANY month's record, not just this one —
      // a June payment paid on a July date must not be adopted again as July.
      const claimed = new Set(db.read('payroll', []).filter((r) => r.expenseId).map((r) => String(r.expenseId)))
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
  // Pay moved out of team.js on 15 Jul (security) — p.base no longer exists on
  // roster entries; the split lives in rosterPay, created-staff pay on the user
  // record. Bonus stays 0: commission is "up to", not an automatic payment.
  // 🔒 A PART MONTH IS PAID FOR THE DAYS WORKED, at both ends (Adama 28 Aug:
  // "shouldn't pulse calculate the final pay if started the 19th"). Someone who
  // joins or leaves mid-month was suggested a FULL salary before this, on their
  // very first payroll — the month they are least likely to be checked on.
  // Working days come from their own schedule; the figure stays editable.
  const suggestedSalary = (name) => {
    const u = seedUsers().find((x) => x.name === name)
    // 🔒 The guaranteed monthly pay, base + transport, from the one resolver.
    // This column used to mean base alone for the old roster and base plus
    // transport for anyone created in Pulse. Same column, two meanings.
    const base = monthlyPayFor(u || {}).fixed
    if (!u || !base) return base
    const part = partMonthFor(u, period)
    if (!part.partial || !part.inMonth) return base
    // 🔒 Not rounded to a whole dalasi — see money2.
    return money2((base * part.worked) / part.inMonth)
  }
  const partMonthNote = (name) => {
    const u = seedUsers().find((x) => x.name === name)
    if (!u) return null
    const part = partMonthFor(u, period)
    if (!part.partial || !part.inMonth) return null
    return { from: part.from, to: part.to, workedDays: part.worked, monthDays: part.inMonth }
  }
  // 🔑 SAY WHAT THE FIGURE IS MADE OF. The Base column meant two things at once:
  // for someone created in Pulse `salary` is base PLUS transport, while the
  // older roster entries carry base alone. Same column, two meanings, and no
  // way to see which row is which. The split travels with the row now.
  const payParts = (name) => {
    const u = seedUsers().find((x) => x.name === name)
    if (!u) return null
    const m = monthlyPayFor(u)
    if (!m.base && !m.transport) return null
    return { base: m.base, transport: m.transport, commission: m.commission }
  }
  const people = merged.filter((p) => (seen.has(p.name) ? false : seen.add(p.name))).map((p) => ({
    name: p.name,
    role: p.role || '',
    suggestedSalary: suggestedSalary(p.name),
    suggestedBonus: 0,
    // Says WHY the suggestion is not a whole month, so a smaller number does
    // not read as a mistake.
    partMonth: partMonthNote(p.name),
    payParts: payParts(p.name),
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
  // ?inline=1 opens it in the browser instead of downloading it (Adama
  // 27 Aug: "option to view document?"). Same route, same permission check —
  // reading a contract should not mean putting a copy on your laptop first.
  const disposition = req.query.inline ? 'inline' : 'attachment'
  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `${disposition}; filename="${meta.name.replace(/"/g, '')}"`)
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
const PROFILE_FIELDS = ['phone', 'email', 'emergencyContact', 'emergencyPhone', 'manager', 'nextReview', 'address', 'notes', 'performanceScore', 'performanceStatus', 'performanceNote',
  // Read by the employee record since 20 Aug, but nothing could ever WRITE
  // them, so they showed "—" forever no matter who looked (Adama 27 Aug).
  'schedule', 'location', 'dob', 'gender', 'nationality', 'maritalStatus', 'noticePeriod']
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

// ---------- edit the employee record in place (Adama 27 Aug) ----------
// The record page could SHOW a job title, a start date and a date of birth but
// nothing in Pulse could ever write them, so they read "—" for good. This is
// the one write behind the per-card Edit on the record.
//
// One endpoint, because a single card holds fields from two stores — the
// roster (users) and the HR profile. The page sends what changed; the server
// decides where each field lands, so no page has to know the storage.
//
// 🔒 Deliberately NOT editable here:
//   name        — profiles, reviews, sales, documents and warnings are all
//                 keyed by NAME. A rename here would orphan every one of them.
//   email       — it is the login. The CEO changes it on Team & access.
//   department  — moves the sales goal and the leaderboard; it keeps its own
//                 Manage-staff endpoint and its own history line.
//   employment  — decided by the contract actions, never typed.
// 🔑 `contractEnd` is editable here because it was previously set ONCE at
// hire and never again — so when Sally's contract was extended by three
// months there was nowhere in Pulse to put it, and she has read "Permanent"
// ever since (Adama, 28 Aug: "just did not put it in the system"). An end
// date that cannot be moved makes every renewal look like a permanent job.
const RECORD_ROSTER_FIELDS = ['title', 'joined', 'employeeId', 'phone', 'address', 'contractEnd']
const RECORD_PROFILE_FIELDS = ['manager', 'schedule', 'location', 'dob', 'gender', 'nationality', 'maritalStatus', 'emergencyContact', 'emergencyPhone', 'noticePeriod']
const RECORD_FIELD_LABEL = {
  title: 'Job title', joined: 'Start date', employeeId: 'Employee ID', phone: 'Phone', address: 'Address',
  contractEnd: 'Contract ends',
  manager: 'Reports to', schedule: 'Work schedule', location: 'Location', dob: 'Date of birth', gender: 'Gender',
  nationality: 'Nationality', maritalStatus: 'Marital status', emergencyContact: 'Emergency contact',
  emergencyPhone: 'Emergency phone', noticePeriod: 'Notice period',
}
const isDayOrBlank = (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)
const employeeIdOf = (u) => u.employeeId || `EMP-${String(u.username).slice(0, 3).toUpperCase()}`

app.patch('/api/hr/employee/:username', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u || isArchived(u)) return res.status(404).json({ error: 'not found' })
  const fields = req.body?.fields
  if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'Nothing to save' })

  const clean = {}
  for (const k of [...RECORD_ROSTER_FIELDS, ...RECORD_PROFILE_FIELDS]) {
    if (fields[k] === undefined) continue
    clean[k] = String(fields[k] ?? '').trim().slice(0, 160)
  }
  if (!Object.keys(clean).length) return res.status(400).json({ error: 'Nothing to save' })
  if (clean.joined !== undefined && !isDayOrBlank(clean.joined)) return res.status(400).json({ error: 'Start date must be a real date' })
  if (clean.dob !== undefined && !isDayOrBlank(clean.dob)) return res.status(400).json({ error: 'Date of birth must be a real date' })
  // Blank means no end date — a permanent job. A real date means fixed term,
  // and the whole app reads it that way (employment type, the contract-ending
  // warnings, the record's Contract card).
  if (clean.contractEnd !== undefined && !isDayOrBlank(clean.contractEnd)) return res.status(400).json({ error: 'Contract end must be a real date' })
  if (clean.contractEnd && clean.joined === undefined && u.joined && clean.contractEnd < String(u.joined).slice(0, 10)) {
    return res.status(400).json({ error: 'A contract cannot end before it started' })
  }
  // An employee ID that two people share stops identifying anybody.
  if (clean.employeeId) {
    const taken = users.some((x) => x.username !== u.username && employeeIdOf(x).toLowerCase() === clean.employeeId.toLowerCase())
    if (taken) return res.status(409).json({ error: 'That employee ID already belongs to someone else' })
  }
  // "Reports to" has to name somebody who is actually here.
  if (clean.manager) {
    const known = users.some((x) => !isArchived(x) && x.name === clean.manager && x.username !== u.username)
    if (!known) return res.status(400).json({ error: 'Reports to must be someone on the team' })
  }

  const profiles = db.read('profiles', {})
  const changes = []

  for (const k of RECORD_ROSTER_FIELDS) {
    if (clean[k] === undefined) continue
    const was = String(u[k] ?? '')
    if (was === clean[k]) continue
    u[k] = clean[k]
    // Phone and address were read as `u.x || profile.x`, so a leftover profile
    // copy would resurrect the value HR had just cleared. One truth: the roster.
    if (profiles[u.name]) delete profiles[u.name][k]
    changes.push(`${RECORD_FIELD_LABEL[k]}: ${was || '—'} → ${clean[k] || '—'}`)
  }

  const profile = profiles[u.name] || {}
  for (const k of RECORD_PROFILE_FIELDS) {
    if (clean[k] === undefined) continue
    const was = String(profile[k] ?? '')
    if (was === clean[k]) continue
    profile[k] = clean[k]
    changes.push(`${RECORD_FIELD_LABEL[k]}: ${was || '—'} → ${clean[k] || '—'}`)
  }

  if (!changes.length) return res.json({ ok: true, changed: [] })

  profile.updatedAt = new Date().toISOString()
  profile.updatedBy = req.realUser.username
  profiles[u.name] = profile
  db.write('profiles', profiles)
  // Every change lands on the person's History, the same as a department move.
  ;(u.history ||= []).push({ date: todayKey(), event: `Record updated by ${req.realUser.name || req.realUser.username} — ${changes.join('; ')}` })
  db.write('users', users)
  res.json({ ok: true, changed: changes })
})

// ---------- onboarding / offboarding checklists (per employee) ----------
const ONBOARDING_ITEMS = ['Signed contract', 'Submitted ID', 'Training complete', 'App access granted', 'Uniform issued']
// 🔒 COMPANY PROPERTY IS ITEMISED (Adama 28 Aug: "even a checklist if they hold
// any company property"). "Equipment returned" as one line is a line nobody can
// answer honestly: it hides which phone, whose tracker, which SIM. Property is
// also the reason people reach for withholding pay, which the Labour Act does
// not allow — so the list exists to get the things BACK on the last day, beside
// the payment, not after it.
const OFFBOARDING_PROPERTY = [
  'Company phone returned',
  'Tracker or demo unit returned',
  'SIM card returned',
  'Laptop or tablet returned',
  'Office keys returned',
  'Uniform returned',
  'ID card returned',
]
const OFFBOARDING_ADMIN = [
  'Customer handover completed',
  'WhatsApp and customer numbers handed over',
  'Pulse and admin accounts disabled',
  'Final pay paid',
  'Exit interview completed',
]
const OFFBOARDING_ITEMS = [...OFFBOARDING_PROPERTY, ...OFFBOARDING_ADMIN]
const offboardingGroup = (label) => (OFFBOARDING_PROPERTY.includes(label) ? 'Company property' : 'Handover and access')
// 🔒 THREE STATES, NOT TWO (Adama 28 Aug: "he has no company property so did
// not see that option and also he had no whatsapp number, we have to add no not
// apply option when it does not apply"). A list that can only be ticked or left
// blank turns "he never had a company phone" into "somebody forgot the phone",
// and an offboarding that can never reach zero is one nobody finishes.
function mergeChecklist(items, stored, grouped = false) {
  return items.map((label) => ({
    label,
    ...(grouped ? { group: offboardingGroup(label) } : {}),
    done: false,
    na: false,
    ...(stored && stored[label] ? stored[label] : {}),
  }))
}
app.get('/api/employee-checklist', auth, requireSub('hr', 'records'), (req, res) => {
  const name = req.query.name
  if (!name) return res.status(400).json({ error: 'name required' })
  const c = (db.read('checklists', {}))[name] || {}
  res.json({ onboarding: mergeChecklist(ONBOARDING_ITEMS, c.onboarding), offboarding: mergeChecklist(OFFBOARDING_ITEMS, c.offboarding, true) })
})
app.put('/api/employee-checklist', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const { name, type, label, done, state } = req.body || {}
  const items = type === 'onboarding' ? ONBOARDING_ITEMS : type === 'offboarding' ? OFFBOARDING_ITEMS : null
  if (!name || !items) return res.status(400).json({ error: 'name and valid type required' })
  if (!items.includes(label)) return res.status(400).json({ error: 'unknown checklist item' })
  const all = db.read('checklists', {})
  const c = all[name] || {}
  const section = c[type] || {}
  // `state` is the three-way control; `done` stays accepted so an older client
  // keeps working.
  const next = state || (done ? 'done' : 'todo')
  const stamp = { at: new Date().toISOString(), by: req.user.username }
  section[label] = next === 'done' ? { done: true, na: false, doneAt: stamp.at, doneBy: stamp.by }
    : next === 'na' ? { done: false, na: true, naAt: stamp.at, naBy: stamp.by }
      : { done: false, na: false }
  c[type] = section
  all[name] = c
  db.write('checklists', all)
  res.json({ ok: true, item: { label, ...section[label] } })
})

// ---------- recruitment: applicants pipeline ----------
// Call outcomes are stages of their own: at the end of a hiring round the
// dead numbers must be countable apart from the people who said no.
// 🔒 Same list, same order, as STAGES in src/pages/recruitment/stages.js.
// Shortlisted and Offer added 20 Aug 2026 — the pipeline had no way to say
// "we want this one" between the interview and the hire.
const APPLICANT_STAGES = ['cv_received', 'no_answer', 'unreachable', 'not_interested', 'not_qualified', 'interviewed', 'shortlisted', 'offer', 'hired', 'rejected']
const APPLICANT_FIELDS = ['name', 'role', 'email', 'phone', 'source', 'notes', 'positionId']
// Contact is a separate axis from stage: someone can still be New and already
// have been rung twice. Screening is a HUMAN mark — 🔒 nothing here reads an
// applicant's answers and grades them.
const CONTACT_STATUS = ['not_contacted', 'called_no_answer', 'contacted']
const SCREENING = ['', 'strong', 'review', 'weak']
// 🔒 A PAST EMPLOYEE APPLYING AGAIN IS MATCHED ON EMAIL OR PHONE, NEVER ON
// NAME (Adama 28 Aug: "never name only, many share same name in the gambia").
// A name collision would tell you somebody was dismissed when they have never
// worked here, which is worse than not knowing. Email and phone are the two
// things an applicant gives that actually belong to them.
//
// ⚠️ It can only find people who left with contact details on their record.
// The pre-Pulse roster in team.js holds names, roles and reasons only, so those
// leavers cannot be matched by anything and are never guessed at.
function pastStaffMatchFor(a) {
  const email = String(a.email || '').trim().toLowerCase()
  const key = phoneKey(a.phone)
  if (!email && !key) return null
  const archived = seedUsers().filter(isArchived)
  for (const u of archived) {
    const emails = [u.email, u.personalEmail].filter(Boolean).map((x) => String(x).trim().toLowerCase())
    const keys = [phoneKey(u.phone), phoneKey(u.whatsapp)].filter(Boolean)
    const byEmail = email && emails.includes(email)
    const byPhone = key && keys.includes(key)
    if (!byEmail && !byPhone) continue
    const exit = loadExits().filter((x) => x.username === u.username && !x.cancelledAt)
      .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0] || null
    return {
      username: u.username,
      name: u.name,
      // Which fact matched, so a person can check it rather than trust it.
      matchedOn: byEmail && byPhone ? 'email and phone' : byEmail ? 'email' : 'phone',
      title: u.title || '',
      left: exit?.lastDay || (u.archivedAt ? u.archivedAt.slice(0, 10) : null),
      type: exit?.type || '',
      reason: exit?.reason || u.archivedReason || '',
      // The one thing a recruiter has to see before booking an interview.
      rehire: exit ? !!exit.rehire : null,
    }
  }
  return null
}

app.get('/api/applicants', auth, requireSub('hr', 'records'), (req, res) => {
  // Two repairs on the way out, so records imported before the fixes read
  // correctly without rewriting anyone's file. The "p:" prefix Meta puts on
  // phone numbers is stripped; and the first import stored the FORM's name as
  // the source, which made ad applicants uncountable against the other
  // channels — an imported record (it has answers) is the Ads channel, with
  // the form name kept beside it.
  const imported = (a) => a.answers && Object.keys(a.answers).length > 0
  const list = db.read('applicants', []).slice().sort((a, b) => ((a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1))
    .map((a) => (a.phone ? { ...a, phone: cleanPhone(a.phone) } : a))
    .map((a) => (imported(a) && a.source !== 'Ads' ? { ...a, form: a.form || a.source, source: 'Ads' } : a))
    .map((a) => ({ ...a, pastStaff: pastStaffMatchFor(a) }))
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
  if (b.contactStatus !== undefined && CONTACT_STATUS.includes(b.contactStatus)) {
    rec.contactStatus = b.contactStatus
    rec.contactedAt = b.contactStatus === 'not_contacted' ? null : new Date().toISOString()
  }
  if (b.screening !== undefined && SCREENING.includes(b.screening)) rec.screening = b.screening
  if (b.stage && APPLICANT_STAGES.includes(b.stage) && b.stage !== rec.stage) {
    rec.stage = b.stage
    rec.history = [...(rec.history || []), { stage: b.stage, at: new Date().toISOString(), by: req.user.username }]
  }
  rec.updatedAt = new Date().toISOString()
  db.write('applicants', all)
  res.json({ applicant: rec })
})
app.patch('/api/applicants/bulk', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const b = req.body || {}
  const ids = new Set(Array.isArray(b.ids) ? b.ids : [])
  if (!ids.size) return res.status(400).json({ error: 'ids required' })
  const all = db.read('applicants', [])
  const now = new Date().toISOString()
  let changed = 0
  for (const rec of all) {
    if (!ids.has(rec.id)) continue
    let touched = false
    if (b.stage && APPLICANT_STAGES.includes(b.stage) && b.stage !== rec.stage) {
      rec.stage = b.stage
      rec.history = [...(rec.history || []), { stage: b.stage, at: now, by: req.user.username }]
      touched = true
    }
    if (b.contactStatus !== undefined && CONTACT_STATUS.includes(b.contactStatus)) {
      rec.contactStatus = b.contactStatus
      rec.contactedAt = b.contactStatus === 'not_contacted' ? null : now
      touched = true
    }
    if (b.screening !== undefined && SCREENING.includes(b.screening)) { rec.screening = b.screening; touched = true }
    // A bulk note is ADDED to what is already there. Overwriting a hundred
    // notes with one sentence is not something a button should be able to do.
    if (b.appendNote) {
      const line = String(b.appendNote).trim()
      if (line) { rec.notes = [rec.notes, line].filter(Boolean).join('\n'); touched = true }
    }
    if (touched) { rec.updatedAt = now; changed++ }
  }
  if (changed) db.write('applicants', all)
  res.json({ changed })
})
// Deleting many at once is its own route, not DELETE /:id with a magic id.
app.post('/api/applicants/bulk-delete', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const ids = new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])
  if (!ids.size) return res.status(400).json({ error: 'ids required' })
  const all = db.read('applicants', [])
  const kept = all.filter((a) => !ids.has(a.id))
  db.write('applicants', kept)
  res.json({ deleted: all.length - kept.length })
})
app.delete('/api/applicants/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  db.write('applicants', db.read('applicants', []).filter((a) => a.id !== req.params.id))
  res.json({ ok: true })
})

// ---------- bulk import (Adama 19 Aug) ----------
// A hiring ad returns hundreds of applicants as one CSV (259 from the Sales
// Agent form). Typing those in one at a time is not work anyone will do, so
// the file goes in whole and comes out as a call list. Meta names the columns
// after the questions the form asked, so nothing here assumes fixed headers —
// the shape is read from the file.
function parseDelimited(text) {
  const s = String(text || '').replace(/^﻿/, '')
  const head = s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n'))
  // Meta exports commas; some locales hand back semicolons or tabs.
  const delim = [',', ';', '\t'].reduce((best, d) => (head.split(d).length > head.split(best).length ? d : best), ',')
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === delim) { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''))
}
const normKey = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Meta's own bookkeeping columns — kept off the answer list, which is meant to
// hold only what the applicant actually told us.
const META_COLUMNS = new Set(['id', 'createdtime', 'adid', 'adname', 'adsetid', 'adsetname', 'campaignid', 'campaignname', 'formid', 'formname', 'isorganic', 'platform', 'leadstatus', 'partnername', 'retaileritemid', 'customdisclaimerresponses', 'vehicle'])
const NAME_KEYS = ['fullname', 'name', 'yourname']
const PHONE_KEYS = ['phonenumber', 'phone', 'mobile', 'mobilenumber', 'whatsapp', 'whatsappnumber']
const EMAIL_KEYS = ['email', 'emailaddress']
const DOB_KEYS = ['dateofbirth', 'dob', 'birthday']
// Digits only, so +220 7xx xx xx, 00220…, and a bare local number all compare
// equal. The last 7 digits are the number itself in The Gambia.
// Meta writes phone answers as "p:+2207956636". The prefix is theirs, not part
// of the number — left in it shows on screen and breaks the tap-to-call link.
function cleanPhone(v) { return String(v || '').replace(/^\s*p\s*:\s*/i, '').trim() }
function phoneDigits(v) { return String(v || '').replace(/\D/g, '') }
function phoneKey(v) { const d = phoneDigits(v); return d.length >= 7 ? d.slice(-7) : '' }
app.post('/api/applicants/import', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const raw = String((req.body || {}).csv || '')
  // An Excel file is a zip (xlsx, "PK") or an OLE container (xls) — reading it
  // as text yields rows of nothing and a silent zero. Say so instead.
  if (/^PK\x03\x04/.test(raw) || /^\xD0\xCF\x11\xE0/.test(raw) || /^\s*<(!doctype|html)/i.test(raw)) {
    return res.status(400).json({ error: 'That is an Excel or web file, not a CSV. On Meta’s download, use the CSV link.' })
  }
  const rows = parseDelimited(raw)
  if (rows.length < 2) return res.status(400).json({ error: 'That file has no rows to read.' })
  const role = String((req.body || {}).role || '').trim()
  const headers = rows[0].map((h) => String(h || '').trim())
  const keys = headers.map(normKey)
  const findCol = (cands) => keys.findIndex((k) => cands.includes(k))
  // Exact names first, then anything that simply CONTAINS the word. A form
  // asking "What is your name?" names its column after the question, and that
  // is the normal case, not the exception (19 Aug: every row was skipped
  // because the column was not called full_name).
  const taken = []
  const loose = (re) => keys.findIndex((k, i) => !META_COLUMNS.has(k) && re.test(k) && !taken.includes(i))
  let iName = findCol(NAME_KEYS)
  if (iName === -1) iName = loose(/name/)
  taken.push(iName)
  const iFirst = findCol(['firstname']), iLast = findCol(['lastname'])
  let iPhone = findCol(PHONE_KEYS)
  if (iPhone === -1) iPhone = loose(/phone|mobile|whatsapp|tel|number/)
  taken.push(iPhone)
  const iEmail = findCol(EMAIL_KEYS)
  const iDob = findCol(DOB_KEYS)
  const iCreated = findCol(['createdtime', 'created'])
  const iForm = findCol(['formname'])
  // Anything left that isn't Meta plumbing is a question the applicant answered.
  const questionCols = keys.map((k, i) => ({ k, i })).filter(({ k, i }) =>
    !META_COLUMNS.has(k) && ![iName, iFirst, iLast, iPhone, iEmail, iDob].includes(i))
  const label = (h) => String(h || '').replace(/_/g, ' ').replace(/\?+$/, '').trim()
  const yesNo = (v) => { const s = String(v || '').trim().toLowerCase(); if (/^(yes|y|true|1)\b/.test(s)) return true; if (/^(no|n|false|0)\b/.test(s)) return false; return null }

  const all = db.read('applicants', [])
  const seen = new Set(all.map((a) => phoneKey(a.phone)).filter(Boolean))
  const seenNames = new Set(all.map((a) => String(a.name || '').trim().toLowerCase()).filter(Boolean))
  const now = new Date().toISOString()
  const added = []
  let duplicates = 0, noPhone = 0
  for (const r of rows.slice(1)) {
    const cell = (i) => (i >= 0 ? String(r[i] || '').trim() : '')
    const name = cell(iName) || [cell(iFirst), cell(iLast)].filter(Boolean).join(' ')
    if (!name) continue
    const phone = cleanPhone(cell(iPhone))
    // Same person, applied twice — one record, not two calls to the same number.
    const key = phoneKey(phone)
    if (key ? seen.has(key) : seenNames.has(name.toLowerCase())) { duplicates++; continue }
    if (key) seen.add(key); else seenNames.add(name.toLowerCase())
    const answers = {}
    for (const { i } of questionCols) { const v = cell(i); if (v) answers[label(headers[i])] = v }
    // Two screening signals: can they start, and what have they actually sold.
    // The second is written in their own words, so it is carried through for
    // reading — grading a sentence by machine would just be a guess.
    let startNow = null, experience = ''
    for (const [q, a] of Object.entries(answers)) {
      if (startNow === null && /start/i.test(q) && /(immediate|now|right away|straight)/i.test(q)) startNow = yesNo(a)
      if (!experience && /(sold|sell|sales|experience)/i.test(q)) experience = a
    }
    const digits = phoneDigits(phone)
    if (digits.length < 7) noPhone++
    added.push({
      id: crypto.randomUUID(),
      name, role, email: cell(iEmail), phone,
      // Source is the CHANNEL, so it can be counted against WhatsApp,
      // referrals and the rest. Which form/campaign it was is kept beside it.
      source: 'Ads',
      form: cell(iForm) || '',
      notes: '',
      stage: 'cv_received',
      answers,
      startNow,
      experience,
      dob: cell(iDob),
      phoneValid: digits.length >= 7,
      appliedAt: cell(iCreated) || null,
      createdAt: now, updatedAt: now, createdBy: req.user.username,
      history: [{ stage: 'cv_received', at: now, by: req.user.username }],
    })
  }
  if (added.length) db.write('applicants', all.concat(added))
  // Nothing imported and nothing rejected means the file was read but no
  // column held a name. Hand back what the columns actually were — a bare
  // "0 added" is unfixable for whoever is standing in front of it.
  const reason = (!added.length && !duplicates && iName === -1 && iFirst === -1)
    ? `No name column found. Columns read: ${headers.filter(Boolean).join(', ') || '(none)'}`
    : null
  res.json({ added: added.length, duplicates, noPhone, rows: rows.length - 1, headers: headers.filter(Boolean), reason })
})

// ---------- HR dashboard (Adama 20 Aug, the new design) ----------
// One call assembles the landing page: headcount, who is in today, what needs
// a decision, how the team is doing, who is in probation or coaching, and what
// just happened. Every figure is read from the same stores the detail pages
// use, so the dashboard cannot disagree with the page it links to.
//
// 🔒 PAY IS GATED SEPARATELY. The payroll tile is only computed for a caller
// who holds the payroll power; everyone else gets null and the tile does not
// render. Never send a salary figure to a browser that is not allowed it.
function hrRoster() {
  return seedUsers().filter((u) => !isArchived(u) && u.username !== CEO)
}
const dayDiff = (iso) => {
  if (!iso) return null
  const to = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  const from = Date.parse(`${todayKey()}T00:00:00Z`)
  return Number.isNaN(to) ? null : Math.round((to - from) / 86400000)
}
const daysUntil = (iso) => dayDiff(iso)

app.get('/api/hr/dashboard', auth, requirePower('hr'), async (req, res) => {
  const today = todayKey()
  const roster = hrRoster()
  const attendance = db.read('attendance', []).filter((a) => a.date === today)
  const byUser = Object.fromEntries(attendance.map((a) => [a.username, a]))

  // Who is in. A contractor keeps no schedule, so they are not counted absent.
  const scheduled = roster.filter((u) => !u.contractor)
  const people = scheduled.map((u) => {
    const rec = byUser[u.username]
    return {
      username: u.username,
      name: u.name,
      title: u.title || '',
      department: u.department || '',
      present: !!rec?.checkIn,
      startTime: rec?.checkIn || null,
      status: u.status || 'active',
    }
  })
  const present = people.filter((p) => p.present).length

  // What needs a decision, newest concern first. Each row carries where to go.
  const attention = []
  for (const u of roster) {
    const probLeft = daysUntil(u.probationEnd)
    if (probLeft != null && probLeft <= 30) {
      attention.push({
        kind: 'Probation',
        line: probLeft < 0
          ? `${u.name}'s probation ended ${Math.abs(probLeft)} days ago`
          : `${u.name} probation decision due in ${probLeft} days`,
        to: `/people?person=${encodeURIComponent(u.name)}`,
        cta: 'Review employee',
        urgency: probLeft,
      })
    }
    const contractLeft = daysUntil(u.contractEnd)
    if (contractLeft != null && contractLeft <= 30) {
      attention.push({
        kind: 'Contract',
        line: contractLeft < 0
          ? `${u.name}'s contract expired ${Math.abs(contractLeft)} days ago`
          : `${u.name}'s contract expires in ${contractLeft} days`,
        to: `/people?person=${encodeURIComponent(u.name)}`,
        cta: 'Review contract',
        urgency: contractLeft,
      })
    }
  }
  const pendingLeave = db.read('leave', []).filter((l) => l.status === 'pending').length
  if (pendingLeave) {
    attention.push({
      kind: 'Request',
      line: `${pendingLeave} leave request${pendingLeave > 1 ? 's' : ''} awaiting approval`,
      to: '/requests',
      cta: 'Review request',
      urgency: 0,
    })
  }
  // Lateness this month, counted from the check-in against the person's start.
  const monthPrefix = today.slice(0, 7)
  const lateBy = {}
  for (const a of db.read('attendance', [])) {
    if (!a.date?.startsWith(monthPrefix) || !a.checkIn || !a.late) continue
    lateBy[a.name || a.username] = (lateBy[a.name || a.username] || 0) + 1
  }
  for (const [name, times] of Object.entries(lateBy)) {
    if (times < 3) continue
    attention.push({
      kind: 'Attendance',
      line: `${name} has been late ${times} times this month`,
      to: '/attendance',
      cta: 'Review attendance',
      urgency: 1,
    })
  }
  attention.sort((a, b) => a.urgency - b.urgency)

  // Probation and coaching, the two things a person is actively being taken
  // through. Coaching entries are the recent ones only.
  const development = []
  for (const u of roster) {
    const left = daysUntil(u.probationEnd)
    if (left == null || left < -30) continue
    const months = Number(u.probationMonths) || 3
    const total = months * 30
    development.push({
      name: u.name,
      title: u.title || '',
      note: `Probation · ${left < 0 ? 'decision overdue' : `${left} days remaining`}`,
      progress: Math.max(0, Math.min(100, Math.round(((total - Math.max(0, left)) / total) * 100))),
      due: u.probationEnd,
      to: `/people?person=${encodeURIComponent(u.name)}`,
      cta: 'Review',
    })
  }
  const coaching = db.read('coaching', [])
    .slice()
    .sort((a, b) => ((a.datetime || a.createdAt) < (b.datetime || b.createdAt) ? 1 : -1))
    .slice(0, 3)
  for (const c of coaching) {
    const u = roster.find((x) => x.username === c.targetUsername)
    if (!u) continue
    development.push({
      name: u.name,
      title: u.title || '',
      note: c.topic ? `Coaching · ${c.topic}` : 'Coaching',
      progress: null,
      due: c.datetime || c.createdAt,
      to: `/performance/${u.username}`,
      cta: 'View',
    })
  }

  // What happened, from the records themselves rather than a separate log.
  const activity = []
  for (const a of attendance) {
    if (a.checkIn) activity.push({ at: a.checkIn, line: `${a.name || a.username} clocked in` })
  }
  for (const l of db.read('leave', [])) {
    if (l.decidedAt) activity.push({ at: l.decidedAt, line: `Leave request ${l.status} for ${l.name || l.username}` })
  }
  for (const w of db.read('warnings', [])) {
    if (w.createdAt) activity.push({ at: w.createdAt, line: `Warning recorded for ${w.name || w.agent || 'a staff member'}` })
  }
  for (const c of db.read('coaching', [])) {
    if (c.createdAt) activity.push({ at: c.createdAt, line: `Coaching logged for ${c.targetName || c.targetUsername}` })
  }
  activity.sort((x, y) => (x.at < y.at ? 1 : -1))

  // Team performance, from Pulse's OWN records — sales against target for the
  // Sales department, and the manager-entered review score for the others. A
  // department with nothing recorded is left out rather than shown at zero,
  // which would read as failure instead of silence.
  const salesStore = db.read('agent-sales', {})
  const profiles = db.read('profiles', {})
  const performance = []
  const salesPeople = roster.filter((u) => u.department === 'Sales')
  let sold = 0
  let target = 0
  const salesTally = await salesTallyFor(monthPrefix)
  for (const u of salesPeople) {
    const rec = salesStore[u.name]
    if (!rec) continue
    if (rec.monthlyTarget) target += Number(rec.monthlyTarget) || 0
    sold += Number(salesActualFrom(salesTally, u.name, monthPrefix)) || 0
  }
  if (target > 0) {
    performance.push({
      area: 'Sales',
      line: `${sold} of ${target} sales target`,
      pct: Math.min(100, Math.round((sold / target) * 100)),
    })
  }
  const byDept = {}
  for (const u of roster) {
    if (u.department === 'Sales') continue
    const score = Number(profiles[u.name]?.performanceScore)
    if (!score) continue
    ;(byDept[u.department || 'Other'] ||= []).push(score)
  }
  for (const [dept, scores] of Object.entries(byDept)) {
    performance.push({
      area: dept,
      line: `Review score · ${scores.length} ${scores.length === 1 ? 'person' : 'people'}`,
      pct: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    })
  }

  // 🔒 Pay only for a payroll holder.
  let payroll = null
  if (canSub(req.realUser, 'payroll', 'run') || can(req.realUser, 'payroll')) {
    const base = roster.reduce((sum, u) => {
      const own = Number(u.salary) || Number(u.pay?.base) || 0
      const legacy = Number(rosterPay[u.name]?.total) || 0
      return sum + (own || legacy)
    }, 0)
    payroll = { base, period: monthPrefix }
  }

  res.json({
    headcount: { total: roster.length, active: roster.filter((u) => (u.status || 'active') === 'active').length },
    today: { present, absent: scheduled.length - present, people: people.sort((a, b) => Number(b.present) - Number(a.present)) },
    payroll,
    attention: attention.slice(0, 5),
    performance,
    attentionCount: attention.length,
    probation: roster.filter((u) => daysUntil(u.probationEnd) != null && daysUntil(u.probationEnd) >= 0).length,
    development: development.slice(0, 3),
    activity: activity.slice(0, 5),
    asOf: new Date().toISOString(),
  })
})

// ---------- the Employees list (Adama 20 Aug, the new design) ----------
// Exactly what the page shows and nothing more. 🔒 NO PAY: the roster endpoint
// next door carries salary for the payroll screens, and this one deliberately
// does not — a page that never displays a figure should never receive one.
app.get('/api/hr/employees', auth, requirePower('hr'), (req, res) => {
  // Anyone whose last day has passed drops off this roster the moment it is
  // read, so the list cannot show a leaver as current.
  applyDueExits()
  const today = todayKey()
  const leave = db.read('leave', [])
  const onLeaveToday = new Set(
    leave
      .filter((l) => l.status === 'approved' && (l.from || '') <= today && today <= (l.to || l.from || ''))
      .map((l) => l.username),
  )
  // The next thing HR has to DO about this person. Probation first because it
  // has a deadline and a decision; then the contract; otherwise the yearly
  // review, which falls on the anniversary of the day they started.
  // 🔒 Nothing is invented: a person with no start date simply has no
  // milestone rather than a made-up one.
  const milestoneFor = (u) => {
    const days = dayDiff;
    if (u.probationEnd && days(u.probationEnd) >= -30) return { label: 'Probation review', date: u.probationEnd, days: days(u.probationEnd) };
    if (u.contractEnd && days(u.contractEnd) >= -30) return { label: 'Contract ends', date: u.contractEnd, days: days(u.contractEnd) };
    if (!u.joined) return null;
    const start = new Date(u.joined);
    if (isNaN(start)) return null;
    const next = new Date(start);
    next.setFullYear(new Date().getFullYear());
    if (next < new Date()) next.setFullYear(next.getFullYear() + 1);
    const iso = next.toISOString().slice(0, 10);
    return { label: 'Annual review', date: iso, days: days(iso) };
  };

  const employees = seedUsers()
    .filter((u) => !isArchived(u) && u.username !== CEO)
    .map((u) => {
      const probation = u.probationEnd && Date.parse(u.probationEnd) >= Date.now()
      const status = (u.status && u.status !== 'active' && u.status) // maternity, suspended, whatever HR set
        || (u.suspended && 'inactive')
        || (onLeaveToday.has(u.username) && 'leave')
        || (probation && 'probation')
        || 'active'
      return {
        username: u.username,
        name: u.name,
        // The work address is the one colleagues use; a personal address is
        // not the company's to put on a list.
        email: u.email || '',
        phone: u.phone || '',
        title: u.title || '',
        department: u.department || '',
        status,
        employment: u.employmentType || (u.contractor ? 'Contractor' : u.contractEnd ? 'Contract' : 'Full-time'),
        // The second line under employment: what the arrangement IS, rather
        // than repeating the status chip.
        employmentNote: probation ? 'Probation' : u.contractEnd ? 'Fixed term' : u.contractor ? 'No schedule' : 'Permanent',
        startDate: u.joined || null,
        probationEnd: u.probationEnd || null,
        contractEnd: u.contractEnd || null,
        milestone: milestoneFor(u),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const count = (s) => employees.filter((e) => e.status === s).length
  // A contract inside two months is a conversation that has to start; a
  // milestone inside one is a decision that is already late if ignored.
  // 🔒 A record still being built is not a deadline. Its probation date and
  // contract end are placeholders until somebody is actually activated.
  const live = employees.filter((e) => e.status !== 'pending' && e.status !== 'complete')
  const contractSoon = live.filter((e) => e.contractEnd && e.milestone?.label === 'Contract ends' && e.milestone.days <= 60).length
  const actionDue = live.filter((e) => e.milestone && e.milestone.days <= 30 && e.milestone.label !== 'Annual review')
  // Who left, so the page can show them without a second endpoint and a
  // second set of permissions.
  const past = seedUsers()
    .filter(isArchived)
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.title || '',
      department: u.department || '',
      joined: u.joined || null,
      left: u.archivedAt ? u.archivedAt.slice(0, 10) : null,
      reason: u.archivedReason || 'Left the team',
    }))
    .sort((a, b) => String(b.left || '').localeCompare(String(a.left || '')))

  res.json({
    employees,
    past,
    counts: {
      total: employees.length,
      active: count('active'),
      leave: count('leave'),
      probation: count('probation'),
      // Being built, and finished but not yet started. Neither is employed.
      pending: count('pending'),
      complete: count('complete'),
      inactive: employees.length - count('active') - count('leave') - count('probation') - count('pending') - count('complete'),
      contractSoon,
      actionDue: actionDue.length,
    },
    nextAction: actionDue.sort((a, b) => a.milestone.days - b.milestone.days)[0]
      ? {
        name: actionDue[0].name,
        label: actionDue[0].milestone.label,
        days: actionDue[0].milestone.days,
      }
      : null,
    departments: [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(),
    employmentTypes: [...new Set(employees.map((e) => e.employment))].sort(),
  })
})

// ---------- one employee, everything the profile shows (Adama 20 Aug) ----------
// Resolved by USERNAME, not by matching a name against a static list — people
// created in Pulse are not in that list, so their profile used to be
// unreachable. 🔒 No pay here: the salary card reads the payroll-gated
// endpoint separately, so a viewer without that power receives no figure at all.
app.get('/api/hr/employee/:username', auth, requirePower('hr'), async (req, res) => {
  // A role change dated for today (or any day since) takes effect the moment
  // the record is opened — nobody has to remember to come back and type it.
  applyDueRoleChanges()
  applyDueAssignments()
  // Same for a last working day that has arrived: the account closes on the day
  // that was agreed, not the day somebody remembers to close it.
  applyDueExits()
  const u = findUser(req.params.username)
  // 🔒 An archived record still OPENS. Someone who has left is exactly who HR
  // still has offboarding to finish for — equipment back, final pay, exit
  // interview — and a 404 sent them to a page that could show none of it.
  // Writes stay shut: the PATCH above refuses an archived record.
  if (!u) return res.status(404).json({ error: 'not found' })

  const today = todayKey()
  const month = today.slice(0, 7)
  const profile = db.read('profiles', {})[u.name] || {}
  const attAll = db.read('attendance', []).filter((a) => a.username === u.username)
  const mine = attAll.filter((a) => a.date?.startsWith(month))
  const leaveAll = db.read('leave', []).filter((l) => l.username === u.username)

  // 🔒 ONE attendance truth: the same month builder the Attendance tab reads,
  // so the record's tiles and that tab can never disagree. It counts against
  // the person's OWN weekly schedule rather than an assumed Mon-Fri, and it
  // never marks days before ATTENDANCE_START absent.
  const attMonthNow = attendanceMonth(u.username, month)
  const present = attMonthNow.summary.present
  const late = attMonthNow.summary.late
  const onLeave = attMonthNow.summary.leave
  const workingDays = attMonthNow.summary.scheduledDays
  const minutes = attMonthNow.summary.workedMinutes
  const checkIns = mine.filter((a) => a.checkIn).map((a) => new Date(a.checkIn))
  const avgCheckIn = checkIns.length
    ? (() => {
      const avg = checkIns.reduce((s, d) => s + d.getUTCHours() * 60 + d.getUTCMinutes(), 0) / checkIns.length
      return `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(Math.round(avg % 60)).padStart(2, '0')}`
    })()
    : null

  // Performance: the manager-entered score, and sales against target where the
  // person carries one. 🔒 Nothing is computed from a formula nobody agreed to.
  const salesRec = u.department === 'Sales' ? db.read('agent-sales', {})[u.name] : null
  // Whose sale a sale is comes from admin — see salesActualFor. The sheet
  // record still carries the monthly target.
  const salesActual = salesRec ? await salesActualFor(u.name, month) : null
  const attendancePct = attMonthNow.summary.ratePct
  const performance = {
    score: profile.performanceScore === '' || profile.performanceScore == null ? null : Number(profile.performanceScore),
    sales: salesRec ? { actual: salesActual, target: salesRec.monthlyTarget ?? null } : null,
    attendancePct,
  }
  // The person's REAL role scorecard (Adama 27 Aug: "performance is driven by
  // actual KPIs, not a separate manual score"). Same builder My Progress and
  // the team-member card use, so the record cannot invent its own targets.
  // 🔑 A KPI whose `actual` is null is NOT zero — Pulse has no feed for it
  // yet, and the tab must say so rather than draw an empty bar that reads as
  // a failure. Attendance is added because we genuinely measure it.
  const scorecard = scorecardFor(u, salesActual)
  scorecard.kpis = [
    ...scorecard.kpis,
    { key: 'attendance', label: 'Attendance', kind: 'percent', unit: '%', target: 90, weight: 0, actual: attendancePct },
  ]

  // Every document, with who put it there — the Documents tab groups by
  // category and the Overview shows the newest few from the same list.
  const documents = db.read('agent-files', [])
    .filter((f) => f.agent === u.name)
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''))
    .map(({ id, name, category, mimeType, sizeBytes, uploadedAt, uploadedBy }) => ({ id, name, category: category || 'other', mimeType, sizeBytes, uploadedAt, uploadedBy: uploadedBy || '' }))

  // WHAT NEEDS ATTENTION — the record's first screen answers "is anything
  // wrong here", so each item is a fact with somewhere to go. Only things
  // that are actually true land here; an empty list says so plainly rather
  // than inventing a chore.
  const attention = []
  if (attMonthNow.summary.missingCheckouts > 0) {
    const n = attMonthNow.summary.missingCheckouts
    attention.push({
      tone: 'bad',
      title: `${n} attendance ${n === 1 ? 'record needs' : 'records need'} review`,
      detail: 'Clocked in with no clock-out, so the hours cannot be counted.',
      action: 'Review attendance', tab: 'Attendance',
    })
  }
  if (attMonthNow.summary.absent > 0) {
    const n = attMonthNow.summary.absent
    attention.push({
      tone: 'warn',
      title: `${n} ${n === 1 ? 'day' : 'days'} absent this month`,
      detail: 'Scheduled days with no clock-in and no approved leave.',
      action: 'Review attendance', tab: 'Attendance',
    })
  }
  // Behind PACE, not behind target — being on 1 of 5 on the 2nd of the month
  // is not a problem, and calling it one teaches people to ignore the page.
  if (salesRec && salesActual != null && salesRec.monthlyTarget) {
    const dayOfMonth = Number(today.slice(8, 10))
    const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
    const expected = (salesRec.monthlyTarget * dayOfMonth) / daysInMonth
    if (salesActual < Math.floor(expected)) {
      attention.push({
        tone: 'warn',
        title: 'Sales behind pace',
        detail: `${salesActual} of ${salesRec.monthlyTarget} with ${daysInMonth - dayOfMonth} ${daysInMonth - dayOfMonth === 1 ? 'day' : 'days'} left.`,
        action: 'Open performance', tab: 'Performance',
      })
    }
  }
  // 🔒 THE PAPERWORK IS PART OF THE RECORD (Adama 27 Aug: "how do we make
  // sure pulse always has these"). Pulse held ONE document in total while
  // every contract sat in a folder on his laptop. A record now says what is
  // missing, so it cannot drift quietly again.
  //
  // 🔑 Judged on what is ON FILE, never on a tick: the onboarding checklist
  // has a "Signed contract" item anyone can tick with nothing uploaded, and a
  // tick is not a contract.
  const hasDoc = (cat) => documents.some((f) => f.category === cat)
  if (!hasDoc('contract')) {
    attention.push({
      tone: 'bad',
      title: 'No signed contract on file',
      detail: 'Nothing in this record proves the terms they are employed on.',
      action: 'Open documents', tab: 'Documents',
    })
  }
  if (!documents.some((f) => /\bid\b/i.test(f.name))) {
    attention.push({
      tone: 'warn',
      title: 'No ID document on file',
      detail: 'A copy of their ID has not been uploaded.',
      action: 'Open documents', tab: 'Documents',
    })
  }

  // Reviews and the ratings inside them, newest first.
  const reviewsAll = (db.read('reviews', {})[u.name] || [])
    .slice()
    .sort((x, y) => String(y.period || '').localeCompare(String(x.period || '')))
    .map((r) => ({ period: r.period, score: r.score ?? null, status: r.status || '', ratings: r.ratings || null, notes: r.notes || '', at: r.completedAt || r.createdAt || null }))
  const scored = reviewsAll.filter((r) => typeof r.score === 'number')
  const averageReview = scored.length ? Math.round((scored.reduce((a, b) => a + b.score, 0) / scored.length) * 10) / 10 : null

  // Notes are everything written ABOUT this person: coaching, and warnings —
  // which belong on the record, not in a separate directory.
  const notes = [
    ...db.read('coaching', [])
      .filter((c) => c.targetUsername === u.username)
      .map((c) => ({
        kind: c.type === 'praise' ? 'Recognition' : 'Coaching',
        title: c.title || '',
        text: c.note || c.notes || '',
        by: c.byName || c.by || '',
        at: c.datetime || c.createdAt,
      })),
    ...db.read('warnings', [])
      .filter((w) => w.agent === u.name)
      .map((w) => ({ kind: 'Concern', title: `${w.type} warning`, text: w.reason || '', by: w.by || '', at: w.date || w.createdAt })),
    ...(profile.notes ? [{ kind: 'General', title: '', text: profile.notes, by: '', at: profile.notesAt || null }] : []),
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))

  // ---------- the file of somebody who has left ----------
  // 🔒 ONE PAGE, NOT A HUNT THROUGH TABS (Adama 28 Aug: "after it ended maybe
  // just one page summarised everything including their attendance and all,
  // and the page says dismissed, that is his file"). Attendance is summed
  // across the WHOLE employment rather than the current month, which for a
  // leaver is usually empty and always misleading.
  let leaverFile = null
  if (isArchived(u)) {
    const last = lastDayOf(u) || (u.archivedAt ? u.archivedAt.slice(0, 10) : today)
    const first = String(u.joined || '').slice(0, 10) || last
    const totals = { scheduledDays: 0, present: 0, late: 0, absent: 0, leave: 0, workedMinutes: 0 }
    // Month by month from the month they joined to the month they left.
    for (let m = first.slice(0, 7); m <= last.slice(0, 7);) {
      const s = attendanceMonth(u.username, m).summary
      totals.scheduledDays += s.scheduledDays
      totals.present += s.present
      totals.late += s.late
      totals.absent += s.absent
      totals.leave += s.leave
      totals.workedMinutes += s.workedMinutes
      const [yy, mm] = m.split('-').map(Number)
      m = `${mm === 12 ? yy + 1 : yy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}`
    }
    const exitRec = loadExits().filter((x) => x.username === u.username && !x.cancelledAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null
    const exit = exitForViewer(exitRec, req.realUser, u.username)
    const daysServed = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000) + 1
    leaverFile = {
      first,
      last,
      daysServed: daysServed > 0 ? daysServed : null,
      monthsServed: completedMonthsBetween(first, last),
      contractEnd: u.contractEnd || null,
      // Did they reach the end of the term they signed for?
      finishedTerm: u.contractEnd ? last >= String(u.contractEnd).slice(0, 10) : null,
      exit,
      attendance: {
        ...totals,
        ratePct: totals.scheduledDays ? Math.round((totals.present / totals.scheduledDays) * 100) : null,
      },
      checklist: mergeChecklist(OFFBOARDING_ITEMS, (db.read('checklists', {})[u.name] || {}).offboarding, true),
    }
  }

  res.json({
    leaverFile,
    employee: {
      username: u.username,
      name: u.name,
      title: u.title || '',
      department: u.department || '',
      email: u.email || '',
      personalEmail: u.personalEmail || '',
      phone: u.phone || profile.phone || '',
      address: u.address || profile.address || '',
      joined: u.joined || null,
      // Archived reads as Inactive on the record; the raw 'archived' matched no
      // pill and fell back to the green "Active" one on a person who had left.
      status: isArchived(u) ? 'inactive' : (u.status || 'active'),
      left: isArchived(u) ? (u.archivedAt ? u.archivedAt.slice(0, 10) : null) : null,
      leftReason: isArchived(u) ? (u.archivedReason || 'Left the team') : '',
      employment: u.employmentType || (u.contractor ? 'Contractor' : u.contractEnd ? 'Contract' : 'Full-time'),
      contractEnd: u.contractEnd || null,
      probationEnd: u.probationEnd || null,
      reportsTo: profile.manager || '',
      schedule: profile.schedule || 'Mon – Fri, 8:00 AM – 5:00 PM',
      // Where they work — a separate fact from the home address below, which
      // is why the Job card no longer borrows it.
      location: profile.location || '',
      employeeId: employeeIdOf(u),
      dob: profile.dob || '',
      gender: profile.gender || '',
      nationality: profile.nationality || '',
      maritalStatus: profile.maritalStatus || '',
      emergencyContact: profile.emergencyContact || '',
      emergencyPhone: profile.emergencyPhone || '',
    },
    attendance: {
      workingDays,
      present,
      // Absent is COUNTED, not inferred by subtraction: a scheduled day with
      // no clock-in and no approved leave. Subtracting used to turn any gap
      // in the data into an accusation.
      absent: attMonthNow.summary.absent,
      late,
      leave: onLeave,
      hours: Math.floor(minutes / 60),
      minutes: Math.round(minutes % 60),
      ratePct: attMonthNow.summary.ratePct,
      missingCheckouts: attMonthNow.summary.missingCheckouts,
      overtimeMinutes: attMonthNow.summary.overtimeMinutes,
      avgCheckIn,
      month,
    },
    performance: { ...performance, averageReview, reviews: reviewsAll.slice(0, 6) },
    scorecard,
    attention,
    documents,
    notes,
    contract: {
      type: u.contractEnd ? 'Fixed term' : u.contractor ? 'Contractor' : 'Permanent',
      start: u.joined || null,
      // 🔑 THE AGREED TERM AND WHAT ACTUALLY HAPPENED ARE TWO DIFFERENT FACTS
      // (Adama 28 Aug: "i put the right end date when i dismissed him but it
      // maintained the contract end date… i want to know how long was the
      // contract and when he got fired"). The contract still ran to 19 Nov; he
      // left on 28 Aug. Overwriting one with the other loses the question
      // "did they finish the term".
      end: u.contractEnd || null,
      endedOn: isArchived(u) ? lastDayOf(u) : null,
      endedWhy: isArchived(u) ? (u.archivedReason || 'Left the team') : '',
      noticePeriod: profile.noticePeriod || '',
      document: documents.find((f) => f.category === 'contract') || null,
    },
    history: (u.history || []).slice().reverse(),
  })
})

// ---------- ROLE CHANGES (Adama 28 Aug: "the role change should have
// questions, follow proper procedures, not just that") ----------
//
// Changing someone's job is an EVENT, not a field edit. Its consequences live
// on five different pages — title, department, who they report to, pay, and
// what they can do in Pulse — so before this they had to be remembered one at
// a time, and Yafatou's May role change reached none of them.
//
// 🔒 EFFECTIVE-DATED, and future dates APPLY THEMSELVES (his call). A change
// agreed today for 1 September is recorded now and takes effect on the day,
// the same way a dated schedule entry does — nobody has to remember to come
// back and type it. `applyDueRoleChanges()` runs on read, so any request
// after the date brings the person up to date.
//
// 🔑 Pay is stored ON THE CHANGE, never applied by this endpoint: payroll is
// its own gate and its own page. The change carries the agreed figure so the
// decision is on the record, and payroll remains the only writer of pay.
const ROLE_CHANGE_REASONS = ['Promotion', 'Restructure', 'Their request', 'Performance', 'Other']

function loadRoleChanges() {
  const all = db.read('role-changes', [])
  return Array.isArray(all) ? all : []
}
// Bring anyone whose change has come due up to date. Idempotent: a change is
// applied once and marked, so this can run on every read.
function applyDueRoleChanges() {
  const all = loadRoleChanges()
  const due = all.filter((c) => !c.appliedAt && c.effectiveFrom <= todayKey())
  if (!due.length) return all
  const users = seedUsers()
  for (const c of due) {
    const u = users.find((x) => x.username === c.username)
    if (!u) { c.appliedAt = new Date().toISOString(); c.applyNote = 'no such person'; continue }
    const from = []
    if (c.title && c.title !== u.title) { from.push(`${u.title || '—'} → ${c.title}`); u.title = c.title }
    if (c.department && c.department !== u.department) { from.push(`${u.department || '—'} → ${c.department}`); u.department = c.department }
    if (c.roleId && c.roleId !== u.roleId) {
      const role = roleById(c.roleId)
      if (role && role.id !== 'owner') {
        const { powers, subs } = roleGrant(role)
        const beforePowers = powersFor(u)
        u.roleId = role.id
        u.permissions = [...powers]
        u.permissionSubs = { ...subs }
        u.accessLog = [...(u.accessLog || []), {
          at: new Date().toISOString(), by: c.by || 'pulse',
          before: beforePowers, after: u.permissions,
          scopes: u.permissionScopes || {}, subs: u.permissionSubs || {},
          roleAssigned: role.id,
        }]
        from.push(`access role → ${role.name}`)
      }
    }
    // Who they report to lives on the profile, like every other HR field.
    if (c.manager) {
      const profiles = db.read('profiles', {})
      profiles[u.name] = { ...(profiles[u.name] || {}), manager: c.manager }
      db.write('profiles', profiles)
      from.push(`reports to ${c.manager}`)
    }
    ;(u.history ||= []).push({
      date: c.effectiveFrom,
      event: `Role change — ${c.fromTitle || '—'} → ${c.title || u.title}${c.reason ? ` (${c.reason})` : ''}${from.length ? `. ${from.join('; ')}` : ''}`,
    })
    c.appliedAt = new Date().toISOString()
  }
  db.write('users', users)
  db.write('role-changes', all)
  return all
}

// Everything recorded for one person, newest first, with what is still to come
// marked. The record page shows upcoming ones so a change agreed for next
// month is visible before it lands rather than arriving as a surprise.
app.get('/api/hr/employee/:username/role-changes', auth, requirePower('hr'), (req, res) => {
  const u = findUser(req.params.username)
  // Reading the history of a person who has left is not a write. (The POST
  // below still refuses: nobody changes the role of somebody who has gone.)
  if (!u) return res.status(404).json({ error: 'not found' })
  const all = applyDueRoleChanges().filter((c) => c.username === u.username)
  res.json({
    changes: all.sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))),
    today: todayKey(),
    reasons: ROLE_CHANGE_REASONS,
  })
})

app.post('/api/hr/employee/:username/role-changes', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u || isArchived(u)) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  const effectiveFrom = String(b.effectiveFrom || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return res.status(400).json({ error: 'Pick the date it takes effect' })
  if (u.joined && effectiveFrom < String(u.joined).slice(0, 10)) {
    return res.status(400).json({ error: 'A role cannot change before the person joined' })
  }
  const title = String(b.title || '').trim().slice(0, 80)
  if (!title) return res.status(400).json({ error: 'Give the new job title' })
  const department = String(b.department || '').trim()
  if (department && !DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Unknown department' })
  const reason = ROLE_CHANGE_REASONS.includes(b.reason) ? b.reason : 'Other'
  const roleId = b.roleId ? String(b.roleId) : ''
  if (roleId && !roleById(roleId)) return res.status(400).json({ error: 'Unknown access role' })
  if (roleId === 'owner') return res.status(403).json({ error: 'The Owner role belongs to the CEO alone' })
  // A manager has to be somebody who is actually here.
  const manager = String(b.manager || '').trim()
  if (manager && !users.some((x) => !isArchived(x) && x.name === manager && x.username !== u.username)) {
    return res.status(400).json({ error: 'Reports to must be someone on the team' })
  }

  const change = {
    id: crypto.randomUUID(),
    username: u.username,
    effectiveFrom,
    fromTitle: u.title || '',
    fromDepartment: u.department || '',
    title,
    department,
    manager,
    roleId,
    reason,
    note: String(b.note || '').trim().slice(0, 400),
    // 🔑 RECORDED, NOT APPLIED. Payroll is its own gate and its own page; this
    // keeps the agreed figure on the record so the decision is not lost, and
    // leaves payroll the only thing that changes what someone is paid.
    payNote: String(b.payNote || '').trim().slice(0, 160),
    // A new role is measured differently. Nothing here can know the right
    // targets, so it says so instead of guessing.
    kpiReview: b.kpiReview !== false,
    by: req.realUser.name || req.realUser.username,
    createdAt: new Date().toISOString(),
    appliedAt: null,
  }
  const all = loadRoleChanges()
  all.push(change)
  db.write('role-changes', all)
  // A change dated today or earlier takes effect immediately; a future one
  // waits, and applyDueRoleChanges picks it up on the day.
  applyDueRoleChanges()
  res.json({ change })
})

// A future change can be called off before it lands. One already applied
// stays — undoing history is not a correction, it is a lie.
app.delete('/api/hr/employee/:username/role-changes/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = loadRoleChanges()
  const c = all.find((x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'not found' })
  if (c.appliedAt) return res.status(409).json({ error: 'That change has already taken effect. Record a new one instead.' })
  db.write('role-changes', all.filter((x) => x.id !== c.id))
  res.json({ ok: true })
})

// Everything assigned to one person, newest first. The scorecards on offer are
// the catalog's own keys, so an assignment can only ever point at a card that
// really exists and really has numbers behind it.
app.get('/api/hr/employee/:username/assignments', auth, requirePower('hr'), (req, res) => {
  const u = findUser(req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  const all = applyDueAssignments().filter((a) => a.username === u.username && !a.cancelledAt)
  const month = todayKey().slice(0, 7)
  res.json({
    assignments: all.sort((a, b) => String(b.from).localeCompare(String(a.from))),
    current: assignmentFor(u.username, month),
    // What their ROLE alone would score them on, so the page can say plainly
    // what the assignment is replacing and what it goes back to.
    roleScorecard: (() => {
      const k = titleScorecardKey(u)
      return k ? { key: k, label: KPI_CATALOG[k].role } : null
    })(),
    scorecards: Object.keys(KPI_CATALOG).map((k) => ({ key: k, label: KPI_CATALOG[k].role })),
    today: todayKey(),
    reasons: ASSIGNMENT_REASONS,
  })
})

app.post('/api/hr/employee/:username/assignments', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const u = findUser(req.params.username)
  if (!u || isArchived(u)) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  const from = String(b.from || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return res.status(400).json({ error: 'Pick the date the assignment starts' })
  if (u.joined && from < String(u.joined).slice(0, 10)) {
    return res.status(400).json({ error: 'An assignment cannot start before the person joined' })
  }
  const to = b.to ? String(b.to).slice(0, 10) : ''
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'That end date is not a date' })
  if (to && to < from) return res.status(400).json({ error: 'The assignment cannot end before it starts' })
  const scorecard = String(b.scorecard || '')
  if (!KPI_CATALOG[scorecard]) return res.status(400).json({ error: 'Pick what they will be judged on' })
  const reason = ASSIGNMENT_REASONS.includes(b.reason) ? b.reason : 'Other'
  // 🔒 ONE assignment at a time. Two overlapping ones would put a person on two
  // scorecards for the same month, which is the thing this model exists to
  // avoid — the two cards mostly read the SAME company-wide feeds, so it would
  // print one number twice and call it two results.
  const clash = loadAssignments().find((a) => a.username === u.username && !a.cancelledAt
    && String(a.from).slice(0, 7) <= (to || '9999-12').slice(0, 7)
    && (!a.to || String(a.to).slice(0, 7) >= from.slice(0, 7)))
  if (clash) {
    return res.status(409).json({ error: `${u.name.split(' ')[0]} is already assigned to ${clash.scorecardLabel} over those dates. End that one first.` })
  }

  const a = {
    id: crypto.randomUUID(),
    username: u.username,
    scorecard,
    scorecardLabel: KPI_CATALOG[scorecard].role,
    label: String(b.label || '').trim().slice(0, 80) || KPI_CATALOG[scorecard].role,
    from,
    to,
    reason,
    note: String(b.note || '').trim().slice(0, 400),
    // What their role scores them on, captured NOW. When the assignment ends
    // they go back to the role, and the role may have moved on in the meantime;
    // this is a record of what was replaced, not a promise of what returns.
    replacedScorecard: titleScorecardKey(u) || null,
    fromTitle: u.title || '',
    by: req.realUser.name || req.realUser.username,
    createdAt: new Date().toISOString(),
    startedAt: null,
    cancelledAt: null,
  }
  const all = loadAssignments()
  all.push(a)
  db.write('assignments', all)
  applyDueAssignments()
  res.json({ assignment: a })
})

// End a running assignment. 🔒 It is dated, never deleted: the months it
// covered stay scored the way they were lived. Default is today, and an end
// date cannot be pushed back before it started.
app.post('/api/hr/employee/:username/assignments/:id/end', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = loadAssignments()
  const a = all.find((x) => x.id === req.params.id && x.username === String(req.params.username || '').trim().toLowerCase())
  if (!a || a.cancelledAt) return res.status(404).json({ error: 'not found' })
  const to = req.body?.to ? String(req.body.to).slice(0, 10) : todayKey()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'That end date is not a date' })
  if (to < String(a.from)) return res.status(400).json({ error: 'The assignment cannot end before it starts' })
  a.to = to
  a.endedBy = req.realUser.name || req.realUser.username
  a.endedAt = new Date().toISOString()
  db.write('assignments', all)
  applyDueAssignments()
  res.json({ assignment: a })
})

// An assignment that has not started yet can be called off. One that has run
// cannot: it is ENDED with a date, not erased.
app.delete('/api/hr/employee/:username/assignments/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = loadAssignments()
  const a = all.find((x) => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'not found' })
  if (a.startedAt) return res.status(409).json({ error: 'That assignment has already started. End it with a date instead.' })
  db.write('assignments', all.filter((x) => x.id !== a.id))
  res.json({ ok: true })
})

// ---------- ENDING EMPLOYMENT (Adama 28 Aug: "if someone is fired where do i
// put that in pulse?") ----------
//
// The honest answer that day was NOWHERE: the terminate action existed but sat
// on a profile page nothing linked to any more, keyed to the static roster, so
// anyone created in Pulse could not be reached by it at all.
//
// 🔒 ONE event covers every way employment ends — dismissed, resigned, contract
// ended, probation not passed. Splitting them into separate flows is how a
// company ends up with three half-records of the same leaver.
//
// 🔒 EFFECTIVE-DATED, and a future last day APPLIES ITSELF, exactly like a role
// change: a notice period agreed today is on the record today and closes the
// account on the day. `applyDueExits()` runs on read and is idempotent.
//
// 🔑 Closing the account reuses the ARCHIVE path (status, archivedReason,
// history line, sessions killed) rather than forking a second way to make
// someone inactive — Past employees reads exactly what that path writes.
//
// 🔑 Pay is RECORDED, never applied. Payroll is its own page and its own gate.
const EXIT_TYPES = ['Dismissed', 'Resigned', 'Contract ended', 'Probation not passed']
const EXIT_NOTICE = ['Worked', 'Paid in lieu', 'Waived', 'Not applicable']

function loadExits() {
  const all = db.read('exits', [])
  return Array.isArray(all) ? all : []
}
// Close the account of anyone whose last day has arrived. Idempotent: an exit
// is applied once and marked, so this is safe on every read.
function applyDueExits() {
  const all = loadExits()
  const due = all.filter((x) => !x.appliedAt && !x.cancelledAt && x.lastDay <= todayKey())
  if (!due.length) return all
  const users = seedUsers()
  let closed = false
  for (const x of due) {
    const u = users.find((y) => y.username === x.username)
    if (!u) { x.appliedAt = new Date().toISOString(); x.applyNote = 'no such person'; continue }
    if (!isArchived(u)) {
      u.status = 'archived'
      u.archivedAt = new Date().toISOString()
      u.archivedBy = x.by || 'pulse'
      // Past employees shows this line, so it carries the plain reason.
      u.archivedReason = `${x.type}${x.reason ? ` — ${x.reason}` : ''}`
      // 🔒 ONE history line, stamped with the LAST DAY, not the day it was typed.
      ;(u.history ||= []).push({
        date: x.lastDay,
        event: `Left the team — ${x.type}${x.reason ? ` (${x.reason})` : ''}`,
      })
      // Logged out immediately: employment ended, so access ends with it.
      for (const [tok, s] of Object.entries(sessions)) if (s.username === u.username) delete sessions[tok]
      closed = true
    }
    x.appliedAt = new Date().toISOString()
  }
  if (closed) { db.write('users', users); persistSessions() }
  db.write('exits', all)
  return all
}

// What is recorded about this person leaving — nothing, something coming, or
// the exit that already took effect. Cancelled ones stay in the store as a
// trail but are not shown as live.
app.get('/api/hr/employee/:username/exit', auth, requirePower('hr'), (req, res) => {
  const u = findUser(req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  const mine = applyDueExits()
    .filter((x) => x.username === u.username && !x.cancelledAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  res.json({
    exit: exitForViewer(mine[0] || null, req.realUser, u.username),
    today: todayKey(),
    types: EXIT_TYPES,
    notice: EXIT_NOTICE,
    archived: isArchived(u),
  })
})

app.post('/api/hr/employee/:username/exit', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u) return res.status(404).json({ error: 'not found' })
  if (isArchived(u)) return res.status(409).json({ error: 'They have already left' })
  if (u.username === req.realUser.username) return res.status(400).json({ error: "You can't end your own employment" })
  if (u.roleId === 'owner') return res.status(403).json({ error: "The owner's record cannot be ended here" })
  const b = req.body || {}
  const lastDay = String(b.lastDay || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return res.status(400).json({ error: 'Pick their last working day' })
  if (u.joined && lastDay < String(u.joined).slice(0, 10)) {
    return res.status(400).json({ error: 'A last day cannot be before the person joined' })
  }
  if (!EXIT_TYPES.includes(b.type)) return res.status(400).json({ error: 'Say how the employment is ending' })
  // The same bar the contract action has always held: no reason, no exit.
  const reason = String(b.reason || '').trim().slice(0, 400)
  if (!reason) return res.status(400).json({ error: 'A reason is required' })
  const notice = EXIT_NOTICE.includes(b.notice) ? b.notice : 'Not applicable'
  const open = loadExits().find((x) => x.username === u.username && !x.cancelledAt && !x.appliedAt)
  if (open) return res.status(409).json({ error: 'An exit is already recorded for them. Cancel that one first.' })

  const exit = {
    id: crypto.randomUUID(),
    username: u.username,
    name: u.name,
    type: b.type,
    lastDay,
    reason,
    notice,
    // Asked at the exit, while the reason is fresh — a year later nobody can
    // answer it from the file.
    rehire: b.rehire === true,
    // 🔑 RECORDED, NOT PAID. Payroll stays the only writer of money.
    // The FIGURE, not a sentence about it — and the days it was worked out
    // from travel with it, so the record can still explain itself in a year.
    // A comma-decimal can still arrive from a locale-formatted field; read it
    // rather than storing NaN or a number a hundred times too small.
    payAmount: (() => {
      const n = Number(String(b.payAmount ?? '').replace(',', '.'))
      return Number.isFinite(n) && n >= 0 ? money2(n) : null
    })(),
    // The whole settlement, as it stood on the day it was agreed: the days, the
    // lines it was built from and the leave balance. A figure with no working
    // is a figure nobody can answer questions about a year later.
    payBasis: (() => {
      const part = partMonthFor(u, lastDay.slice(0, 7), lastDay)
      const m = monthlyPayFor(u)
      const share = part.inMonth ? part.worked / part.inMonth : 0
      const lines = [['Base salary', m.base], ['Transport & data', m.transport]]
        .filter(([, monthly]) => monthly > 0)
        .map(([label, monthly]) => ({ label, monthly, amount: money2(monthly * share) }))
      const leave = accruedLeaveFor(u, lastDay)
      const dayRate = part.inMonth ? money2(m.fixed / part.inMonth) : 0
      if (leave && leave.balance > 0 && dayRate) {
        lines.push({ label: `Accrued leave, ${leave.balance} days`, monthly: null, amount: money2(leave.balance * dayRate) })
      }
      return { workedDays: part.worked, monthDays: part.inMonth, from: part.from, to: part.to, lines, leave }
    })(),
    note: String(b.note || '').trim().slice(0, 400),
    title: u.title || '',
    department: u.department || '',
    by: req.realUser.name || req.realUser.username,
    createdAt: new Date().toISOString(),
    appliedAt: null,
    cancelledAt: null,
  }
  const all = loadExits()
  all.push(exit)
  db.write('exits', all)
  // Dated today or earlier it takes effect now; a future one waits for its day.
  const applied = applyDueExits().find((x) => x.id === exit.id) || exit
  res.json({ exit: applied })
})

// ---------- part-month pay (Adama 28 Aug: "shouldn't pulse calculate the
// final pay if started the 19th which is on the contract?") ----------
//
// It should, and nothing did: the payroll run suggested a FULL month to
// everyone, including someone who joined on the 19th.
//
// 🔒 WORKING DAYS FROM THEIR OWN SCHEDULE (his call) — never calendar days,
// never an assumed Mon-Fri. `effectiveWeek()` is the only resolver of a dated
// schedule, so a changed week is honoured for the days it covers.
// 🔒 BOTH ENDS: the month someone joins is pro-rated exactly like the month
// they leave. One rule, or it is not a rule.
// 🔑 PROPOSED, NEVER PAID. This hands a figure to whoever is doing the paying;
// payroll stays the only writer of money, and the number stays editable.
function scheduledDaysIn(username, monthKey, fromKey, toKey) {
  const stored = db.read('schedules', {})[username]
  const [y, m] = monthKey.split('-').map(Number)
  const lastD = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let inMonth = 0
  let worked = 0
  for (let d = 1; d <= lastD; d++) {
    const key = `${monthKey}-${String(d).padStart(2, '0')}`
    if (!effectiveWeek(stored, key)[dowOfKey(key)]) continue // not a working day for them
    inMonth++
    if (key >= fromKey && key <= toKey) worked++
  }
  return { inMonth, worked }
}
// The last day we know about: a recorded exit (pending or applied) first, then
// the archive date for someone who left before exits were recorded here.
function lastDayOf(u) {
  const x = loadExits()
    .filter((e) => e.username === u.username && !e.cancelledAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  if (x) return x.lastDay
  return isArchived(u) && u.archivedAt ? u.archivedAt.slice(0, 10) : null
}
function partMonthFor(u, monthKey, lastDayOverride = null) {
  const [y, m] = monthKey.split('-').map(Number)
  const lastD = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthStart = `${monthKey}-01`
  const monthEnd = `${monthKey}-${String(lastD).padStart(2, '0')}`
  const joined = String(u.joined || '').slice(0, 10)
  const leaving = lastDayOverride || lastDayOf(u)
  const from = joined && joined > monthStart ? joined : monthStart
  const to = leaving && leaving < monthEnd ? leaving : monthEnd
  const partial = from !== monthStart || to !== monthEnd
  if (from > to) return { from, to, partial: true, inMonth: 0, worked: 0 } // not employed in this month at all
  return { from, to, partial, ...scheduledDaysIn(u.username, monthKey, from, to) }
}
// 🔒 ONE PLACE THAT SAYS WHAT SOMEBODY IS PAID. Order matters: a figure set on
// the record wins, because it is the one a person corrected against the signed
// contract; the older roster file is the fallback for staff who predate that.
// Every page that quotes pay reads this, so a correction lands everywhere at
// once instead of on the page somebody happened to fix.
function contractPay(u) {
  if (!u) return {}
  if (u.pay && u.payUpdatedAt) return u.pay
  return rosterPay[u.name] || u.pay || (u.salary ? { base: Number(u.salary) } : {})
}

// What is GUARANTEED every month, split into its parts. Base + transport is
// the guaranteed pay (it is what `salary` holds on a created record);
// 🔒 COMMISSION IS NEVER IN IT — the contract says payable only on confirmed,
// paid, activated installs and "is not guaranteed", so it can never ride along
// in an automatic figure. It is reported separately so whoever settles can
// decide, and a part month never quietly pays or withholds it.
function monthlyPayFor(u) {
  const p = contractPay(u)
  const base = Number(p.base) || 0
  const transport = Number(p.transport) || 0
  const commission = Number(p.commission) || 0
  // A legacy record with only a total: treat it as the guaranteed monthly pay
  // rather than inventing a split that is not on file.
  const fixed = base + transport || Number(p.total) || 0
  return { base, transport, commission, fixed }
}
// Dalasi and butut. 🔒 Never round a part month up to a whole number — the
// figure is somebody's pay, and a rounded lump hides which part is which.
const money2 = (n) => Math.round(Number(n) * 100) / 100

// ---------- correcting what somebody is paid ----------
// 🔑 Pay could be typed ONCE, when the person was created, and never corrected.
// Mustapha's record said D6,000 base while his signed offer letter says D7,000,
// and there was no screen anywhere to fix it — so payroll, the salary card and
// the exit settlement all quoted the same wrong figure, confidently.
// 🔒 Payroll power only, and the figures never touch a history line: the record
// history is readable with HR power, and pay is not.
app.patch('/api/hr/employee/:username/pay', auth, requireSub('payroll', 'edit'), notViewAs, (req, res) => {
  const users = seedUsers()
  const u = users.find((x) => x.username === String(req.params.username || '').trim().toLowerCase())
  if (!u) return res.status(404).json({ error: 'not found' })
  if (!inScope(req.realUser, 'payroll', u.username)) return res.status(403).json({ error: 'Not in your Payroll scope' })
  const b = req.body || {}
  const num = (v) => Math.max(0, Math.round(Number(v) || 0))
  const base = num(b.base)
  const transport = num(b.transport)
  const commission = num(b.commission)
  if (!base && !transport) return res.status(400).json({ error: 'Give at least a base salary' })
  u.pay = { base, transport, commission, total: base + transport + commission }
  // `salary` is the GUARANTEED monthly figure, which is base plus transport.
  // Commission is on-target only and never belongs in it.
  u.salary = base + transport
  u.payUpdatedAt = new Date().toISOString()
  u.payUpdatedBy = req.realUser.name || req.realUser.username
  ;(u.history ||= []).push({ date: todayKey(), event: 'Contract pay updated' })
  db.write('users', users)
  res.json({ pay: u.pay, salary: u.salary })
})

// ---------- accrued annual leave ----------
// 🔒 LEAVE BUILDS UP MONTHLY, it does not appear on an anniversary. Labour Act
// 2023 s.109(2): where an entitlement is expressed over more than a month, "the
// appropriate proportion of the entitlement is deemed to accrue for each month
// of employment"; s.109(4) makes what is accrued and unused payable when
// employment ends; s.109(6) values a leave day at the person's normal
// contractual rate, excluding bonus and overtime.
// Blue Book bands: under 3 years 14 working days a year, 3 to 7 years 21, over
// 7 years 30. Part of a month does not accrue (Adama 28 Aug: completed months).
function annualLeaveBandFor(months) {
  const years = (months || 0) / 12
  if (years >= 7) return 30
  if (years >= 3) return 21
  return 14
}
function completedMonthsBetween(startKey, endKey) {
  if (!startKey || !endKey) return null
  const a = new Date(`${String(startKey).slice(0, 10)}T00:00:00Z`)
  const b = new Date(`${String(endKey).slice(0, 10)}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return null
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) m -= 1
  return Math.max(0, m)
}
// Their own scheduled working days inside a date range, used for both the leave
// entitlement (counted in working days) and the leave already taken.
function workingDaysBetween(username, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey > toKey) return 0
  const stored = db.read('schedules', {})[username]
  let n = 0
  const d = new Date(`${fromKey}T00:00:00Z`)
  const end = new Date(`${toKey}T00:00:00Z`)
  // A guard on runaway ranges: nobody accrues leave over more than ten years.
  for (let i = 0; d <= end && i < 4000; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    if (effectiveWeek(stored, key)[dowOfKey(key)]) n++
  }
  return n
}
function annualLeaveTaken(username, fromKey, toKey) {
  return db.read('leave', [])
    .filter((l) => l.username === username && l.status === 'approved' && String(l.type || 'Annual') === 'Annual')
    .reduce((sum, l) => {
      const from = String(l.from || '').slice(0, 10)
      const to = String(l.to || l.from || '').slice(0, 10)
      if (!from || to < fromKey || from > toKey) return sum
      return sum + workingDaysBetween(username, from < fromKey ? fromKey : from, to > toKey ? toKey : to)
    }, 0)
}
// 🔒 NO CARRY-OVER (Adama 28 Aug: "they have to all take their leave in same
// year no carry over"). Leave is earned and taken inside ONE LEAVE YEAR, which
// is the calendar year, the same for everybody. Whatever is unused at 31
// December is gone, so what is paid out on exit is only what was earned since
// 1 January, or since joining if that is later. This is also why an old
// employee's balance cannot silently grow into a payout nobody budgeted for.
function accruedLeaveFor(u, lastDay) {
  const joined = String(u.joined || '').slice(0, 10)
  const totalMonths = completedMonthsBetween(joined, lastDay)
  if (totalMonths == null) return null
  const yearStart = `${lastDay.slice(0, 4)}-01-01`
  const from = joined > yearStart ? joined : yearStart
  const monthsThisYear = completedMonthsBetween(from, lastDay) || 0
  const band = annualLeaveBandFor(totalMonths)
  // Each month earns at the band the person was in THAT month, not at today's
  // band applied backwards — otherwise someone crossing three years of service
  // would earn 21 days a year for their first three years too.
  let earnedRaw = 0
  const monthsBefore = totalMonths - monthsThisYear
  for (let i = 1; i <= monthsThisYear; i++) earnedRaw += annualLeaveBandFor(monthsBefore + i) / 12
  const earned = money2(earnedRaw)
  const taken = annualLeaveTaken(u.username, from, lastDay)
  return {
    months: monthsThisYear,
    totalMonths,
    band,
    yearFrom: from,
    earned,
    taken,
    balance: money2(Math.max(0, earned - taken)),
  }
}

// 🔒 THE SETTLEMENT IS PAY. An exit record carries the final figure and the
// working behind it, and the record endpoints are HR-gated, not payroll-gated —
// so the money comes off unless the caller may already see pay. Stripping it in
// the PAYLOAD, never in the page: what the browser receives is what the viewer
// has.
function exitForViewer(exit, realUser, username) {
  if (!exit) return null
  if (realUser?.username === CEO || inScope(realUser, 'payroll', username)) return exit
  const { payAmount, payBasis, ...rest } = exit
  return rest
}

// What the last month comes to, for a last day that has not been saved yet —
// the form asks as the date is picked. 🔒 The MONEY is only in the answer for
// someone who may already see pay; everyone else gets the days and no figure,
// because what the browser receives is what the viewer has.
app.get('/api/hr/employee/:username/final-pay', auth, requirePower('hr'), (req, res) => {
  const u = findUser(req.params.username)
  if (!u) return res.status(404).json({ error: 'not found' })
  const lastDay = String(req.query.lastDay || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return res.status(400).json({ error: 'lastDay required' })
  const monthKey = lastDay.slice(0, 7)
  const part = partMonthFor(u, monthKey, lastDay)
  // Blue Book: annual leave is earned only after 12 months of continuous
  // service, so for most leavers there is nothing to pay out — and Pulse can
  // say so rather than leave somebody wondering.
  const joined = u.joined ? new Date(`${String(u.joined).slice(0, 10)}T00:00:00Z`) : null
  const end = new Date(`${lastDay}T00:00:00Z`)
  const monthsService = joined
    ? (end.getUTCFullYear() - joined.getUTCFullYear()) * 12 + (end.getUTCMonth() - joined.getUTCMonth())
      - (end.getUTCDate() < joined.getUTCDate() ? 1 : 0)
    : null
  const showPay = req.realUser.username === CEO || inScope(req.realUser, 'payroll', u.username)
  const m = monthlyPayFor(u)
  const share = part.inMonth ? part.worked / part.inMonth : 0
  // Every guaranteed part of the monthly pay is pro-rated, and each is shown as
  // its own line: one lump cannot be checked against a contract.
  const lines = [
    ['Base salary', m.base],
    ['Transport & data', m.transport],
  ].filter(([, monthly]) => monthly > 0)
    .map(([label, monthly]) => ({ label, monthly, amount: money2(monthly * share) }))
  // Accrued leave is part of what is owed, not a note beside it (s.109(4)). A
  // leave day is worth a normal working day of the guaranteed monthly pay.
  const leave = accruedLeaveFor(u, lastDay)
  const dayRate = part.inMonth ? money2(m.fixed / part.inMonth) : 0
  if (leave && leave.balance > 0 && dayRate) {
    lines.push({
      label: `Accrued leave, ${leave.balance} day${leave.balance === 1 ? '' : 's'}`,
      monthly: null,
      amount: money2(leave.balance * dayRate),
    })
  }
  const amount = money2(lines.reduce((a, l) => a + l.amount, 0))
  res.json({
    month: monthKey,
    from: part.from,
    to: part.to,
    workedDays: part.worked,
    monthDays: part.inMonth,
    partial: part.partial,
    monthsService,
    // 🔒 Accrued leave is CALCULATED, not left to whoever is settling up. It is
    // null only when the join date is missing, which is a gap to fix, not a zero.
    leave: showPay ? accruedLeaveFor(u, lastDay) : null,
    completedMonths: monthsService,
    // null = "you cannot see pay", which is not the same as zero.
    pay: showPay && m.fixed
      ? { lines, amount, monthlyFixed: m.fixed, commissionMonthly: m.commission }
      : null,
  })
})

// A notice can be called off before the last day. One that has already taken
// effect stays — the account is restored from Team & access, which is where
// bringing someone back belongs.
app.delete('/api/hr/employee/:username/exit/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = loadExits()
  const x = all.find((y) => y.id === req.params.id)
  if (!x || x.cancelledAt) return res.status(404).json({ error: 'not found' })
  if (x.appliedAt) return res.status(409).json({ error: 'They have already left. Restore the account from Team & access instead.' })
  x.cancelledAt = new Date().toISOString()
  x.cancelledBy = req.realUser.name || req.realUser.username
  db.write('exits', all)
  res.json({ ok: true })
})

// ---------- recruitment: positions ----------
// A position is the job being hired for. Applicants attach to one, so "how is
// the Sales Agent round going" is a question the system can answer instead of
// a count of everyone who ever applied for anything.
const POSITION_FIELDS = ['title', 'department', 'location', 'employment', 'summary']
const positionCounts = (p, applicants) => {
  // Older applicants carry only a typed role. Matching on the title as well
  // keeps the 259 imported as "Sales Agent" counted against the real opening.
  const mine = applicants.filter((a) => a.positionId === p.id || (!a.positionId && a.role && a.role.toLowerCase() === (p.title || '').toLowerCase()))
  return {
    applicantCount: mine.length,
    hiredCount: mine.filter((a) => a.stage === 'hired').length,
    interviewedCount: mine.filter((a) => ['interviewed', 'shortlisted', 'offer', 'hired', 'rejected'].includes(a.stage)).length,
  }
}
app.get('/api/positions', auth, requireSub('hr', 'records'), (req, res) => {
  const applicants = db.read('applicants', [])
  const positions = db.read('positions', []).map((p) => ({ ...p, ...positionCounts(p, applicants) }))
  res.json({ positions: positions.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) })
})
app.post('/api/positions', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const b = req.body || {}
  if (!b.title) return res.status(400).json({ error: 'title required' })
  const now = new Date().toISOString()
  const rec = { id: crypto.randomUUID(), status: 'open', openings: Math.max(1, Number(b.openings) || 1), createdAt: now, updatedAt: now, createdBy: req.user.username }
  for (const k of POSITION_FIELDS) rec[k] = String(b[k] || '').trim()
  const all = db.read('positions', [])
  all.push(rec)
  db.write('positions', all)
  res.json({ position: rec })
})
app.put('/api/positions/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = db.read('positions', [])
  const rec = all.find((p) => p.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  for (const k of POSITION_FIELDS) if (b[k] !== undefined) rec[k] = String(b[k] || '').trim()
  if (b.openings !== undefined) rec.openings = Math.max(1, Number(b.openings) || 1)
  if (b.status === 'open' || b.status === 'closed') rec.status = b.status
  rec.updatedAt = new Date().toISOString()
  db.write('positions', all)
  res.json({ position: rec })
})
// Closing a position is the normal end of a round; deleting one is only for a
// mistake, so it refuses while anyone is attached — the applicants would keep
// pointing at a job that no longer exists.
app.delete('/api/positions/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const attached = db.read('applicants', []).filter((a) => a.positionId === req.params.id).length
  if (attached) return res.status(409).json({ error: `${attached} applicant(s) are on this position. Close it instead.` })
  db.write('positions', db.read('positions', []).filter((p) => p.id !== req.params.id))
  res.json({ ok: true })
})

// ---------- recruitment: interview templates ----------
// A template is the set of questions an interview runs on. Damia's own sales
// questions ship as the starting set — a generic HR form scores nothing worth
// knowing. Every one of them is editable.
const DEFAULT_TEMPLATE_SECTIONS = [
  ['Introduction', [
    'Tell me about yourself and why you applied to Damia Tracker.',
    'What do you know about vehicle tracking and what we do?',
  ]],
  ['Sales ability', [
    'Tell me about something you have sold and exactly how you sold it.',
    'A fleet owner with 12 vehicles agrees to see you. What do you do before you meet him?',
    'Explain a tracker to someone who has never used one.',
  ]],
  ['Communication', [
    'Sell me the phone in my hand in two minutes.',
    'A customer speaks Wolof and does not read English. How do you take him through the app?',
  ]],
  ['Objection handling', [
    '"It is too expensive." What do you say?',
    '"My driver is trusted, I do not need this." What do you say?',
    '"I will think about it and call you." What do you do?',
  ]],
  ['Initiative and drive', [
    'How many people would you approach in a day, and where would you find them?',
    'Tell me about a target you missed. What did you do next?',
  ]],
  ['Integrity and judgment', [
    'A customer offers to pay you cash directly instead of paying the company. What do you do?',
    'You promised an installation today and it cannot happen. How do you handle it?',
  ]],
  ['Closing', [
    'How do you ask for the money?',
    'The customer says yes. What are the next three things you do?',
  ]],
]
function seedTemplates() {
  const existing = db.read('interview-templates', null)
  if (existing) return existing
  const now = new Date().toISOString()
  const t = [{
    id: crypto.randomUUID(),
    name: 'Sales agent interview',
    role: 'Sales Agent',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    sections: DEFAULT_TEMPLATE_SECTIONS.map(([title, questions]) => ({
      id: crypto.randomUUID(),
      title,
      questions: questions.map((text) => ({ id: crypto.randomUUID(), text })),
    })),
  }]
  db.write('interview-templates', t)
  return t
}
// Sections come in whole from the editor. Ids are kept where they exist so an
// edit to the wording of a question does not orphan the answers already given.
function cleanSections(sections) {
  return (Array.isArray(sections) ? sections : []).map((s) => ({
    id: s.id || crypto.randomUUID(),
    title: String(s.title || '').trim() || 'Section',
    questions: (Array.isArray(s.questions) ? s.questions : [])
      .map((q) => ({ id: q.id || crypto.randomUUID(), text: String(q.text || '').trim() }))
      .filter((q) => q.text),
  })).filter((s) => s.questions.length)
}
app.get('/api/interview-templates', auth, requireSub('hr', 'records'), (req, res) => {
  res.json({ templates: seedTemplates() })
})
app.post('/api/interview-templates', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const b = req.body || {}
  if (!b.name) return res.status(400).json({ error: 'name required' })
  const now = new Date().toISOString()
  const rec = {
    id: crypto.randomUUID(),
    name: String(b.name).trim(),
    role: String(b.role || '').trim(),
    isDefault: false,
    sections: cleanSections(b.sections),
    createdAt: now, updatedAt: now, createdBy: req.user.username,
  }
  const all = seedTemplates()
  all.push(rec)
  db.write('interview-templates', all)
  res.json({ template: rec })
})
app.put('/api/interview-templates/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = seedTemplates()
  const rec = all.find((t) => t.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  if (b.name !== undefined) rec.name = String(b.name).trim() || rec.name
  if (b.role !== undefined) rec.role = String(b.role || '').trim()
  if (b.sections !== undefined) rec.sections = cleanSections(b.sections)
  // One default at a time, so "start an interview" never has to guess.
  if (b.isDefault === true) all.forEach((t) => { t.isDefault = t.id === rec.id })
  rec.updatedAt = new Date().toISOString()
  db.write('interview-templates', all)
  res.json({ template: rec })
})
app.delete('/api/interview-templates/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = seedTemplates()
  const rec = all.find((t) => t.id === req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  // Interviews keep their own copy of the questions, so removing a template
  // never touches a completed scorecard — but the last one cannot go or there
  // is nothing to start an interview from.
  if (all.length === 1) return res.status(409).json({ error: 'This is the only template.' })
  const left = all.filter((t) => t.id !== rec.id)
  if (rec.isDefault && left.length) left[0].isDefault = true
  db.write('interview-templates', left)
  res.json({ ok: true })
})

// ---------- recruitment: interviews ----------
// 🔒 An interview SNAPSHOTS the template's questions when it is created. Editing
// a template afterwards must never change what a scored interview asked, or the
// scores stop meaning anything.
const RECOMMENDATIONS = ['strong_yes', 'yes', 'unsure', 'no']
// Every answered question is scored 1-5. A section's score is the average of
// its answered questions; the total is the average of all answered questions
// as a percentage. Unanswered questions are left out rather than counted zero —
// a half-finished interview should not read as a bad one.
function scoreInterview(iv) {
  const answers = iv.answers || {}
  const sections = (iv.sections || []).map((s) => {
    const scores = s.questions.map((q) => Number(answers[q.id]?.score)).filter((n) => n >= 1 && n <= 5)
    return {
      id: s.id,
      title: s.title,
      answered: scores.length,
      of: s.questions.length,
      score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    }
  })
  const all = (iv.sections || []).flatMap((s) => s.questions.map((q) => Number(answers[q.id]?.score))).filter((n) => n >= 1 && n <= 5)
  const totalQuestions = (iv.sections || []).reduce((n, s) => n + s.questions.length, 0)
  return {
    sectionScores: sections,
    answered: all.length,
    totalQuestions,
    totalScore: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 20) : null,
  }
}
const withScores = (iv) => ({ ...iv, ...scoreInterview(iv) })
app.get('/api/interviews', auth, requireSub('hr', 'records'), (req, res) => {
  const applicants = db.read('applicants', [])
  const byId = Object.fromEntries(applicants.map((a) => [a.id, a]))
  let list = db.read('interviews', [])
  if (req.query.applicantId) list = list.filter((i) => i.applicantId === req.query.applicantId)
  const out = list.map((iv) => {
    const a = byId[iv.applicantId]
    const { sectionScores, ...rest } = withScores(iv)
    return { ...rest, applicantName: a?.name || iv.applicantName || 'Removed applicant', applicantPhone: a ? cleanPhone(a.phone) : '', applicantStage: a?.stage || null }
  })
  res.json({ interviews: out.sort((x, y) => (y.scheduledAt || y.createdAt || '').localeCompare(x.scheduledAt || x.createdAt || '')) })
})
app.get('/api/interviews/:id', auth, requireSub('hr', 'records'), (req, res) => {
  const iv = db.read('interviews', []).find((i) => i.id === req.params.id)
  if (!iv) return res.status(404).json({ error: 'not found' })
  const a = db.read('applicants', []).find((x) => x.id === iv.applicantId) || null
  const applicant = a ? { ...a, phone: cleanPhone(a.phone) } : null
  res.json({ interview: withScores(iv), applicant })
})
app.post('/api/interviews', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const b = req.body || {}
  const applicant = db.read('applicants', []).find((a) => a.id === b.applicantId)
  if (!applicant) return res.status(400).json({ error: 'applicant required' })
  const templates = seedTemplates()
  const settings = db.read('recruitment-settings', {})
  const template = templates.find((t) => t.id === b.templateId)
    || templates.find((t) => t.id === settings.defaultTemplateId)
    || templates.find((t) => t.isDefault) || templates[0]
  if (!template) return res.status(400).json({ error: 'no interview template' })
  // 🔒 Starting an interview on someone who already has one OPEN returns that
  // one. Two blank interviews for the same person is how scoring gets "lost":
  // the work is safe on the first record and the second looks like nothing
  // saved. Pass force to deliberately run a second interview.
  if (!b.force) {
    const open = db.read('interviews', []).find((i) => i.applicantId === applicant.id && i.status !== 'completed')
    if (open) return res.json({ interview: withScores(open), resumed: true })
  }
  const now = new Date().toISOString()
  const rec = {
    id: crypto.randomUUID(),
    applicantId: applicant.id,
    applicantName: applicant.name,
    positionId: applicant.positionId || b.positionId || '',
    templateId: template.id,
    templateName: template.name,
    sections: JSON.parse(JSON.stringify(template.sections || [])),
    answers: {},
    interviewer: String(b.interviewer || settings.defaultInterviewer || req.user.name || '').trim(),
    scheduledAt: b.scheduledAt || now,
    status: 'scheduled',
    recommendation: '',
    summary: '',
    createdAt: now, updatedAt: now, createdBy: req.user.username,
  }
  const all = db.read('interviews', [])
  all.push(rec)
  db.write('interviews', all)
  res.json({ interview: withScores(rec) })
})
app.put('/api/interviews/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = db.read('interviews', [])
  const iv = all.find((i) => i.id === req.params.id)
  if (!iv) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  if (b.interviewer !== undefined) iv.interviewer = String(b.interviewer || '').trim()
  if (b.scheduledAt !== undefined) iv.scheduledAt = b.scheduledAt || iv.scheduledAt
  if (b.summary !== undefined) iv.summary = String(b.summary || '')
  if (b.recommendation !== undefined && RECOMMENDATIONS.includes(b.recommendation)) iv.recommendation = b.recommendation
  // One answer at a time: {questionId, score, notes}. Sending the whole answer
  // map would let a stale tab wipe scores typed in another.
  if (b.answer && b.answer.questionId) {
    const known = (iv.sections || []).some((s) => s.questions.some((q) => q.id === b.answer.questionId))
    if (!known) return res.status(400).json({ error: 'unknown question' })
    const prev = iv.answers[b.answer.questionId] || {}
    const score = b.answer.score === null ? null : Number(b.answer.score)
    iv.answers[b.answer.questionId] = {
      score: b.answer.score === undefined ? (prev.score ?? null) : (score >= 1 && score <= 5 ? score : null),
      notes: b.answer.notes === undefined ? (prev.notes || '') : String(b.answer.notes || ''),
      // Flagged answers are the ones to come back to before deciding.
      flag: b.answer.flag === undefined ? !!prev.flag : !!b.answer.flag,
      at: new Date().toISOString(),
    }
    if (iv.status === 'scheduled') iv.status = 'in_progress'
  }
  // A question asked on the spot joins THIS interview only. The template is
  // never touched — an interview owns the questions it actually asked.
  if (b.addQuestion) {
    // Trim first: a question of nothing but spaces is not a question, and it
    // would sit in the interview forever as an unanswerable row.
    const text = String(b.addQuestion.text || '').trim()
    const section = (iv.sections || []).find((x) => x.id === b.addQuestion.sectionId) || (iv.sections || [])[0]
    if (text && section) section.questions.push({ id: crypto.randomUUID(), text, adhoc: true })
  }
  if (b.status && ['scheduled', 'in_progress', 'completed'].includes(b.status)) {
    iv.status = b.status
    if (b.status === 'completed') {
      iv.completedAt = new Date().toISOString()
      const { totalScore } = scoreInterview(iv)
      iv.finalScore = totalScore
      // Everything connected: a completed interview moves the applicant on,
      // unless a decision has already been recorded past that point.
      const applicants = db.read('applicants', [])
      const a = applicants.find((x) => x.id === iv.applicantId)
      if (a && !['interviewed', 'shortlisted', 'offer', 'hired', 'rejected'].includes(a.stage)) {
        a.stage = 'interviewed'
        a.updatedAt = new Date().toISOString()
        a.history = [...(a.history || []), { stage: 'interviewed', at: a.updatedAt, by: req.user.username }]
        db.write('applicants', applicants)
      }
    }
  }
  iv.updatedAt = new Date().toISOString()
  db.write('interviews', all)
  res.json({ interview: withScores(iv) })
})
app.delete('/api/interviews/:id', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  db.write('interviews', db.read('interviews', []).filter((i) => i.id !== req.params.id))
  res.json({ ok: true })
})

// ---------- recruitment: settings ----------
// Small and real: which template an interview starts on, and who is put down
// as the interviewer when nobody says otherwise.
app.get('/api/recruitment-settings', auth, requireSub('hr', 'records'), (req, res) => {
  res.json({ settings: db.read('recruitment-settings', { defaultTemplateId: '', defaultInterviewer: '' }) })
})
app.put('/api/recruitment-settings', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const cur = db.read('recruitment-settings', { defaultTemplateId: '', defaultInterviewer: '' })
  const b = req.body || {}
  if (b.defaultTemplateId !== undefined) cur.defaultTemplateId = String(b.defaultTemplateId || '')
  if (b.defaultInterviewer !== undefined) cur.defaultInterviewer = String(b.defaultInterviewer || '').trim()
  db.write('recruitment-settings', cur)
  res.json({ settings: cur })
})

// ---------- recruitment: CVs ----------
// One CV per applicant, on disk beside the record. Same shape as agent files:
// base64 in, metadata on the record, download carries the token as ?t= because
// it is reached by a plain link.
const CV_DIR = path.join(DATA_DIR, 'applicant-cvs')
app.post('/api/applicants/:id/cv', auth, requireSub('hr', 'records'), notViewAs, (req, res) => {
  const all = db.read('applicants', [])
  const a = all.find((x) => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'not found' })
  const { name, mimeType, base64 } = req.body || {}
  if (!name || !base64) return res.status(400).json({ error: 'name and base64 required' })
  const buffer = Buffer.from(base64.includes(',') ? base64.split(',').pop() : base64, 'base64')
  if (!buffer.length) return res.status(400).json({ error: 'empty file' })
  fs.mkdirSync(CV_DIR, { recursive: true })
  const ext = (String(name).split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const storedAs = `${a.id}.${ext || 'bin'}`
  fs.writeFileSync(path.join(CV_DIR, storedAs), buffer)
  a.cv = { name: String(name), mimeType: mimeType || 'application/octet-stream', sizeBytes: buffer.length, storedAs, uploadedAt: new Date().toISOString(), uploadedBy: req.user.name || req.user.username }
  a.updatedAt = new Date().toISOString()
  db.write('applicants', all)
  res.json({ cv: a.cv })
})
app.get('/api/applicants/:id/cv', (req, res) => {
  const t = req.query.t || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const s = sessions[t]
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'unauthorized' })
  const user = findUser(s.username)
  if (!user || user.suspended || !canSub(user, 'hr', 'records')) return res.status(403).json({ error: 'forbidden' })
  const a = db.read('applicants', []).find((x) => x.id === req.params.id)
  if (!a?.cv) return res.status(404).json({ error: 'no cv' })
  const filePath = path.join(CV_DIR, a.cv.storedAs)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing' })
  res.setHeader('Content-Type', a.cv.mimeType || 'application/octet-stream')
  // Inline so it renders in the CV pane next to the questions; ?download=1
  // hands it over as a file instead.
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${String(a.cv.name).replace(/"/g, '')}"`)
  res.sendFile(filePath)
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
// 🔑 THE SHEET ENDS IN JUNE. This store is the imported sales history, and
// every month from SALES_ADMIN_FROM on lives in ADMIN, not here — so the
// Performance board, which scores a sales role on attainment when nobody has
// been rated by hand, had no figure for August and showed the whole company as
// "Not rated" while sales were being closed every day.
//
// 🔒 ONE RULE, ONE PLACE: the admin months are overlaid here, through
// salesTallyFor, so every reader of this endpoint gets the same number the
// record page and My Day already show. July stays blank on purpose — see
// SALES_ADMIN_FROM.
app.get('/api/agent-sales', auth, requireSub('hr', 'performance'), async (req, res) => {
  const stored = db.read('agent-sales', {})
  const all = JSON.parse(JSON.stringify(stored))
  const cur = todayKey().slice(0, 7)
  // One admin month, in the shape the sheet months already use, so the page
  // renders both the same way.
  // 🔑 A number that is not KNOWN stays null and prints as "—". Revenue used to
  // be dropped by the feed entirely and rendered `|| 0`, so a month with real
  // sales showed "D0" — a claim, not a gap. A month with NO sales genuinely
  // earned nothing, so that one is a true zero.
  const fromAdmin = (r) => {
    const sales = Number(r?.won) || 0
    return {
      sales,
      revenue: r && r.revenue != null ? Number(r.revenue) || 0 : (sales === 0 ? 0 : null),
      customers: (r?.customers || []).map((c) => (Number(c?.amount) > 0 ? `${c.name} @ D${Number(c.amount).toLocaleString()}` : (c?.name || 'Customer'))),
      // `source` marks where the number came from, so a reader can tell an
      // admin month from an imported one.
      source: 'admin',
    }
  }
  for (let m = SALES_ADMIN_FROM; m <= cur;) {
    const feed = await salesFeedFor(m)
    if (feed) {
      const rows = new Map((feed.agents || []).map((r) => [r.name, r]))
      for (const [who, r] of rows) {
        const rec = all[who] || (all[who] = { monthlyTarget: null, months: {} })
        rec.months = rec.months || {}
        rec.months[m] = fromAdmin(r)
      }
      // 🔑 A seller who closed nothing this month sold ZERO — that is a fact and
      // a score of 0%. Leaving them out of the overlay would print "Not rated"
      // beside somebody who simply did not sell, which reads as a missing
      // number rather than a real one. Only people who carry a target, so
      // nobody is scored on a target they were never given.
      for (const [who, rec] of Object.entries(all)) {
        if (!rec || !Number(rec.monthlyTarget)) continue
        rec.months = rec.months || {}
        if (rec.months[m] == null) rec.months[m] = fromAdmin(rows.get(who))
      }
    }
    const [yy, mm] = m.split('-').map(Number)
    m = `${mm === 12 ? yy + 1 : yy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}`
  }
  // 🔒 A month is scored against the target Pulse HELD FOR THAT MONTH — the same
  // KPI Targets store the KPI page and My Day read. It used to be one frozen
  // `monthlyTarget`, imported with the sheet in June, so Performance scored
  // August against 5 while KPI Targets said 7 and September's 10 would never
  // have arrived at all. Months before the admin cutover keep the number they
  // were actually scored on: nothing already recorded is rewritten.
  // 🔑 Only a SALES person carries the sales-agent target. Anyone else who
  // closed something shows the count with no target, rather than being measured
  // against a goal that was never theirs.
  const targetCache = {}
  const targetFor = (m) => (m in targetCache ? targetCache[m] : (targetCache[m] = kpiNumber('sales', 'sales', m)?.target ?? null))
  const deptByName = new Map(seedUsers().map((u) => [u.name, u.department]))
  for (const [who, rec] of Object.entries(all)) {
    for (const [m, row] of Object.entries(rec?.months || {})) {
      if (!row) continue
      row.target = m >= SALES_ADMIN_FROM
        ? (deptByName.get(who) === 'Sales' ? targetFor(m) : null)
        : (rec.monthlyTarget ?? null)
    }
  }
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
// AUGUST 2026, not July (Adama 27 Aug): "before we had handled, now it's
// closed — leave the old records, just fix it for this month, and know that
// when it says closed it means agents sold, just from August."
//
// The admin field behind the attribution is the same one it always was, but
// what people PUT in it changed: it used to record who HANDLED the account,
// and it now records who CLOSED the sale. So admin's per-person numbers only
// mean "sales" from August on. July would be read with the old meaning — the
// person who handled it counted as the person who sold it — so it is left out
// rather than credited to the wrong agent.
//
// 🔒 Do not move this back to '2026-07'. The earlier 29 Jun note ("Admin =
// truth from Jul 2026") was written before the field's meaning changed.
const SALES_ADMIN_FROM = '2026-08'

// 🔒 ONE rule for how many sales a person has in a month. Every page that shows
// the number goes through here (Adama 27 Aug, on a customer closed by Kaddy that
// her record counted as zero: "read admin, when a deal is closed it's attributed
// to a person, pick that").
//
// ADMIN is the source from SALES_ADMIN_FROM on, and admin's ledger credits
// whoever CLOSED the deal — the "Closed by" line on the customer record — never
// the account manager. Months BEFORE that keep the imported sheet exactly as it
// stands: nothing already recorded is rewritten ("do not change the records from
// before"). The sheet ends at June, so July has neither source and shows
// nothing — blank, rather than a number attributed to the wrong person.
//
// null means "cannot say" — admin unreachable, or the sheet has no entry. It is
// never flattened to 0, because a zero reads as a person who sold nothing.
function salesFromSheet(name, month) {
  const m = db.read('agent-sales', {})[name]?.months?.[month]
  return m && !m.pending ? (m.sales ?? null) : null
}
// Admin's raw month, once. The feed carries the count AND (since 29 Aug) what
// the month was worth and who was bought from — a page that shows a month,
// rather than a score, needs all three.
async function salesFeedFor(month) {
  if (month < SALES_ADMIN_FROM) return null
  return await fetchAdminFeed(`/api/integrations/pulse/sales?month=${month}`)
}
// The whole month in ONE request, for pages that show a team rather than one
// person. Map of name → sales closed; null when admin could not be reached.
async function salesTallyFor(month) {
  const feed = await salesFeedFor(month)
  if (!feed) return null
  return new Map((feed.agents || []).map((r) => [r.name, Number(r.won) || 0]))
}
// One person out of a tally you already hold — so a team page makes one request
// instead of one per head.
function salesActualFrom(tally, name, month) {
  if (month < SALES_ADMIN_FROM) return salesFromSheet(name, month)
  return tally ? (tally.get(name) ?? 0) : null
}
async function salesActualFor(name, month) {
  return salesActualFrom(await salesTallyFor(month), name, month)
}
async function fetchAdminWonCount(name, month) {
  const tally = await salesTallyFor(month)
  return tally ? (tally.get(name) ?? 0) : null
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
  const data = await fetchAdminFeed(`/api/integrations/pulse/stock?month=${month}`)
  return data && typeof data.accountabilityPct === 'number' ? data : null
}
// Case-resolution from Admin (Ya Fatou's KPI): resolved on time ÷
// (resolved that month + open cases past their SLA). null = unreachable.
async function fetchAdminCases(name, month) {
  const data = await fetchAdminFeed(`/api/integrations/pulse/cases?month=${month}`)
  return (data?.agents || []).find((a) => a.name === name) || null
}
// Installations-within-3-days from Admin (company-wide — Ya Fatou coordinates
// the process): onTime ÷ (completed this month + open past 3 days).
async function fetchAdminInstall(month) {
  const data = await fetchAdminFeed(`/api/integrations/pulse/install?month=${month}`)
  return data && (typeof data.installPct === 'number' || data.completed != null) ? data : null
}
// Trackers-online rate for the agent's BOOK (live snapshot from Admin — same
// rules as Admin's own online meter). No book yet → null, never faked.
async function fetchAdminOnline(name) {
  const data = await fetchAdminFeed('/api/integrations/pulse/online')
  return (data?.agents || []).find((a) => a.name === name) || null
}
// Verified 5-star Google reviews credited to the agent this month. An agent
// absent from the feed simply has none yet — that's a real 0, not "unknown".
async function fetchAdminReviews(name, month) {
  const data = await fetchAdminFeed(`/api/integrations/pulse/reviews?month=${month}`)
  if (!data) return null
  const row = (data.agents || []).find((a) => a.name === name)
  return row ? Number(row.verified) || 0 : 0
}
// Whole feed, unfiltered — the Team Lead card aggregates ACROSS the team's
// books, so it needs every agent row, not one name. null = unreachable.
// 🔑 EVERY Admin read goes through here, and an identical read inside the same
// few seconds is served once. The Performance board scores the whole roster,
// and each person's card wants the same five month-wide feeds — without this
// it made one HTTP call per person per KPI to the same URL.
const ADMIN_FEED_TTL_MS = 15000
const adminFeedCache = new Map()
async function fetchAdminFeed(pathWithQuery) {
  const base = process.env.ADMIN_SYNC_URL, key = process.env.PULSE_SYNC_KEY
  if (!base || !key) return null
  const hit = adminFeedCache.get(pathWithQuery)
  if (hit && Date.now() - hit.at < ADMIN_FEED_TTL_MS) return hit.promise
  const promise = (async () => {
    try {
      const resp = await fetch(`${base.replace(/\/$/, '')}${pathWithQuery}`, { headers: { 'x-pulse-key': key } })
      if (!resp.ok) return null
      return await resp.json()
    } catch { return null }
  })()
  // A failed read must not be remembered as the answer for the next 15s.
  promise.then((v) => { if (v == null) adminFeedCache.delete(pathWithQuery) }, () => adminFeedCache.delete(pathWithQuery))
  adminFeedCache.set(pathWithQuery, { at: Date.now(), promise })
  return promise
}
// ---------- WORK KPIs: ONE builder (Adama 29 Aug) ----------
// The role scorecard with its REAL actuals from Admin. This used to live inline
// inside /api/my/progress, which meant a person could see their own work KPIs
// and nobody could see the team's. The Performance board scores the same
// numbers now, so a manager and the person they manage cannot be looking at two
// different scorecards.
// 🔒 An actual that Admin cannot answer for stays NULL — never 0, never faked.
// `person` is the static roster row when there is one; `u` is the user record.
async function workScorecardFor({ u, person = null, name, month }) {
  const sales = (db.read('agent-sales', {}))[name] || null
  const CUR = month
  // 🔴 SOME ADMIN FEEDS ARE A SNAPSHOT OF TODAY, NOT OF A MONTH. "Trackers
  // online" and the team's attendance answer "right now"; there is no way to
  // ask them what they were in July. Scoring a finished month with them would
  // quietly judge that month on this morning's data, so for any month but the
  // current one they are UNMEASURED — and an unmeasured KPI leaves the
  // denominator rather than counting as a miss.
  const SCORING_LIVE_MONTH = month === todayKey().slice(0, 7)
  const liveOnly = (v) => (SCORING_LIVE_MONTH ? v : null)
  // 🔒 The month being scored decides the card, so a finished assignment
  // leaves the months it covered scored as they were lived.
  const scKey = scorecardKey(u, person, month)

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
    // Actuals flow from Admin (connected 4 Jul): online = live book rate,
    // reviews = verified 5-star log. Unreachable → null ("Connecting to
    // Admin"). Retention MOVED to Customer Service 9 Jul (renewal outreach is
    // Yafatou's job). Percent KPIs carry a `detail` line — the counts behind
    // the % (Adama 4 Jul: "I like to see numbers, not only percentage").
    const onl = SCORING_LIVE_MONTH ? await fetchAdminOnline(name) : null
    const kS = kpiN('sales', 5, 40), kO = kpiN('online', 75, 20)
    scorecard = { role: 'Sales agent', kpis: [
      { key: 'sales', label: 'Tracker sales', kind: 'count', target: Number(u?.target) || kS.target, weight: kS.weight, unit: 'sales', actual: salesActual },
      { key: 'online', label: 'Trackers online', kind: 'percent', target: kO.target, weight: kO.weight, unit: '%',
        actual: typeof onl?.pct === 'number' ? onl.pct : null,
        detail: onl && onl.total ? `${onl.online} of ${onl.total} trackers online` : null },
      // 5-star Google reviews REMOVED as an agent goal (Adama 19 Aug).
    ] }
  } else if (scKey === 'customer-service') {
    const stock = await fetchAdminStock(CUR) // accountability proven by weekly counts (Admin)
    const cas = await fetchAdminCases(name, CUR) // on-time resolution ÷ (resolved + open-overdue)
    const inst = await fetchAdminInstall(CUR) // company-wide: within 3 days of opening
    // Renewals = COMPANY-WIDE (moved from the sales agents 9 Jul): Yafatou
    // runs renewal outreach for every book, so sum every agent's dues.
    const retFeed = await fetchAdminFeed(`/api/integrations/pulse/retention?month=${CUR}`)
    const rnDue = (retFeed?.agents || []).reduce((s, a) => s + (Number(a.due) || 0), 0)
    const rnRen = (retFeed?.agents || []).reduce((s, a) => s + (Number(a.renewed) || 0), 0)
    const kRn = kpiN('renewal', 80, 25)
    const kC = kpiN('cases', 85, 40), kI = kpiN('install', 95, 35), kSt = kpiN('stock', 100, 25)
    scorecard = { role: 'Customer Service', kpis: [
      { key: 'renewal', label: 'Customer renewals', kind: 'percent', target: kRn.target, weight: kRn.weight, unit: '%',
        actual: retFeed && rnDue ? Math.round((rnRen / rnDue) * 100) : null,
        due: retFeed ? rnDue : null,
        detail: retFeed && rnDue ? `${rnRen} renewed of ${rnDue} due` : (retFeed ? 'no renewals due this month yet' : null) },
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
  } else if (scKey === 'assistant-manager') {
    // Adama 29 Aug: Yafatou runs day-to-day OPERATIONS, so her KPIs are the
    // company's operational numbers, not one person's book. Every actual here
    // is the SAME Admin feed the Customer Service and Team Lead cards read,
    // aggregated company-wide rather than filtered to a name.
    // 🔒 Team tracker sales is the team's TOTAL. It is not credited to her —
    // a sale belongs to its closer, never the manager.
    const [casF, retF, salesF] = await Promise.all([
      fetchAdminFeed(`/api/integrations/pulse/cases?month=${CUR}`),
      fetchAdminFeed(`/api/integrations/pulse/retention?month=${CUR}`),
      fetchAdminFeed(`/api/integrations/pulse/sales?month=${CUR}`),
    ])
    const inst = await fetchAdminInstall(CUR)
    const stock = await fetchAdminStock(CUR)
    const sum = (feed, f) => (feed?.agents || []).reduce((acc, a) => acc + (Number(a[f]) || 0), 0)
    const casOnTime = sum(casF, 'onTime')
    const casTotal = sum(casF, 'resolved') + sum(casF, 'openOverdue')
    const rnDue = sum(retF, 'due'), rnRen = sum(retF, 'renewed')
    const teamWon = salesF ? sum(salesF, 'won') : null
    const kC = kpiN('cases', 85, 10), kRn = kpiN('renewal', 85, 10), kI = kpiN('install', 95, 10)
    const kOff = kpiN('offline-review', 90, 10), kSt = kpiN('stock', 100, 10)
    const kAt = kpiN('team-attendance', 90, 10), kTS = kpiN('team-sales', 12, 10)
    scorecard = { role: 'Assistant Manager', kpis: [
      { key: 'cases', label: 'Case resolution', kind: 'percent', target: kC.target, weight: kC.weight, unit: '%',
        actual: casF && casTotal ? Math.round((casOnTime / casTotal) * 100) : null,
        detail: casF && casTotal ? `${casOnTime} on time of ${casTotal}` : (casF ? 'no cases this month yet' : null) },
      { key: 'renewal', label: 'Customer renewal rate', kind: 'percent', target: kRn.target, weight: kRn.weight, unit: '% of renewals due',
        actual: retF && rnDue ? Math.round((rnRen / rnDue) * 100) : null,
        due: retF ? rnDue : null,
        detail: retF && rnDue ? `${rnRen} renewed of ${rnDue} due` : (retF ? 'no renewals due this month yet' : null) },
      { key: 'install', label: 'Installations completed within 3 days', kind: 'percent', target: kI.target, weight: kI.weight, unit: '%',
        actual: typeof inst?.installPct === 'number' ? inst.installPct : null,
        detail: inst && (inst.completed || inst.openLate)
          ? `${inst.onTime} within 3 days of ${inst.completed + inst.openLate}${inst.openLate ? ` · ${inst.openLate} open past 3 days` : ''}`
          : (inst ? 'no installations this month yet' : null) },
      // 🔴 NOTHING FEEDS THIS YET. There is no offline-review endpoint in Admin,
      // so it stays null and is named as unmeasured rather than counted as a
      // miss — the same rule as every other KPI Admin cannot answer for.
      { key: 'offline-review', label: 'Offline devices reviewed', kind: 'percent', target: kOff.target, weight: kOff.weight, unit: '%', actual: null },
      { key: 'stock', label: 'Stock accountability', kind: 'percent', target: kSt.target, weight: kSt.weight, unit: '%',
        actual: typeof stock?.accountabilityPct === 'number' ? stock.accountabilityPct : null,
        detail: stock ? `${stock.cleanThisMonth ?? 0} clean counts of ${stock.weeksExpected ?? 4} weeks${stock.outstandingMissing ? ` · ${stock.outstandingMissing} missing` : ''}` : null },
      { key: 'team-attendance', label: 'Team attendance', kind: 'percent', target: kAt.target, weight: kAt.weight, unit: '%',
        actual: liveOnly(teamAttendancePct(u)) },
      { key: 'team-sales', label: 'Team tracker sales', kind: 'count', target: kTS.target, weight: kTS.weight, unit: 'sales', actual: teamWon },
    ] }
  } else if (scKey === 'team-lead') {
    // teamAttendancePct only ever answers for the current month.
    const teamAtt = liveOnly(teamAttendancePct(u))
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
      SCORING_LIVE_MONTH ? fetchAdminFeed('/api/integrations/pulse/online') : null,
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
  return { key: scKey, scorecard }
}

// One person's whole performance picture for a month. Everything the board row
// and the record page show comes from here, so the two cannot disagree.
async function performanceFor(u, month) {
  const name = u.name
  const person = team.find((t) => t.name === name) || null
  const { scorecard } = await workScorecardFor({ u, person, name, month })
  const work = workKpiScore(scorecard)
  const att = attendanceMonth(u.username, month)
  const reviewList = (db.read('reviews', {}))[name] || []
  const manager = managerAssessment(reviewList, month)
  const overall = overallPerformance({
    work: work?.pct ?? null,
    attendance: att.summary.ratePct,
    manager: manager.pct,
  })
  return {
    username: u.username,
    name,
    title: u.title || '',
    department: u.department || '',
    scorecardRole: scorecard?.role || null,
    work: work ? { ...work, kpis: scorecard.kpis } : null,
    attendance: {
      pct: att.summary.ratePct,
      late: att.summary.late,
      absent: att.summary.absent,
      present: att.summary.present,
      scheduledDays: att.summary.scheduledDays,
      keepsSchedule: att.keepsSchedule,
    },
    manager: { reviewed: manager.reviewed, pct: manager.pct, stars: manager.stars, at: manager.at },
    overall,
    status: perfStatus(overall),
  }
}

// The board: every scored person for a month, plus the five header figures.
// 🔒 The people scored are the LIVE roster — the same list Employees shows.
app.get('/api/performance/board', auth, requireSub('hr', 'performance'), async (req, res) => {
  // A role change that has come due decides WHICH scorecard someone is scored
  // on, so it has to land before anybody is scored. It used to apply only when
  // their record was opened — a promotion dated for the 1st would have left
  // them on their old KPIs here until somebody happened to click them.
  applyDueRoleChanges()
  applyDueAssignments()
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : todayKey().slice(0, 7)
  // 🔒 Only the people this caller's HR power actually covers. A board that
  // scored the whole company for anyone holding hr:performance would hand a
  // supervisor everybody's numbers (rule 51 — a route acting on records
  // re-checks WHICH records, not just that you are logged in).
  const scope = powerScopeSet(req.realUser, 'hr')
  const roster = seedUsers().filter((u) =>
    scope.has(u.username) && isOnStaff(u) && !/cleaner/i.test(`${u.title || ''} ${u.name || ''}`))
  const people = await Promise.all(roster.map((u) => performanceFor(u, month)))

  const prev = prevMonthKey(month)
  const before = await Promise.all(roster.map((u) => performanceFor(u, prev)))
  const avg = (list, pick) => {
    const vals = list.map(pick).filter((v) => v != null)
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
  }
  const averagePerformance = avg(people, (p) => p.overall)
  const attendanceAverage = avg(people, (p) => p.attendance.pct)
  const prevPerformance = avg(before, (p) => p.overall)
  const prevAttendance = avg(before, (p) => p.attendance.pct)
  const scored = people.filter((p) => p.overall != null)
  const top = scored.slice().sort((a, b) => b.overall - a.overall)[0] || null

  res.json({
    month,
    weights: PERF_WEIGHTS,
    people,
    summary: {
      employees: people.length,
      onTrack: people.filter((p) => p.status === 'on-track').length,
      needsAttention: people.filter((p) => p.status === 'needs-attention').length,
      notScored: people.filter((p) => p.status === 'not-scored').length,
      averagePerformance,
      // 🔑 null, not 0 — "no comparison" and "no change" are different answers.
      performanceDelta: averagePerformance == null || prevPerformance == null ? null : averagePerformance - prevPerformance,
      attendanceAverage,
      attendanceDelta: attendanceAverage == null || prevAttendance == null ? null : attendanceAverage - prevAttendance,
      reviewsDue: people.filter((p) => !p.manager.reviewed).length,
      reviewsTotal: people.length,
      topPerformer: top ? { username: top.username, name: top.name, overall: top.overall, status: top.status } : null,
    },
  })
})

// One person's performance record. Same numbers as their row on the board,
// plus what sits behind them: every KPI, the attendance month, the review
// history, and what changed since last month.
app.get('/api/performance/person/:username', auth, requireSub('hr', 'performance'), async (req, res) => {
  // Reached by username, but an older bookmark carries a slugified NAME
  // (/performance/sally-saidy) — that used to be the only address this page
  // had, so it still has to resolve.
  applyDueRoleChanges()
  applyDueAssignments()
  const key = String(req.params.username || '')
  const slug = (n) => String(n || '').toLowerCase().replace(/\s+/g, '-')
  const u = findUser(key) || seedUsers().find((x) => slug(x.name) === key)
  if (!u) return res.status(404).json({ error: 'not found' })
  // Same scope check as the board — a record page reached by URL is still a
  // record, and being allowed the page is not being allowed this person.
  if (!powerScopeSet(req.realUser, 'hr').has(u.username)) return res.status(403).json({ error: 'forbidden' })
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : todayKey().slice(0, 7)
  const cur = await performanceFor(u, month)
  const prev = await performanceFor(u, prevMonthKey(month))
  const reviewList = ((db.read('reviews', {}))[u.name] || [])
    .slice().sort((a, b) => (b.period || '').localeCompare(a.period || ''))
  const coaching = db.read('coaching', []).filter((c) => c.username === u.username || c.name === u.name)
  const warnings = db.read('warnings', []).filter((w) => w.agent === u.name)

  // Points, the way the design reads them: what each source contributed out of
  // the weight it carries. A source with no number contributes nothing and says
  // so — it is not a zero.
  const points = [
    { key: 'work', label: 'Work KPIs (from Admin)', weight: PERF_WEIGHTS.work, pct: cur.work?.pct ?? null, was: prev.work?.pct ?? null },
    { key: 'attendance', label: 'Attendance (from Pulse)', weight: PERF_WEIGHTS.attendance, pct: cur.attendance.pct, was: prev.attendance.pct },
    { key: 'manager', label: 'Manager assessment', weight: PERF_WEIGHTS.manager, pct: cur.manager.pct, was: prev.manager.pct },
  ].map((p) => ({
    ...p,
    earned: p.pct == null ? null : Math.round((p.pct / 100) * p.weight),
    delta: p.pct == null || p.was == null ? null : p.pct - p.was,
  }))

  res.json({
    month,
    weights: PERF_WEIGHTS,
    person: { username: u.username, name: u.name, title: u.title || '', department: u.department || '', status: u.status || 'active' },
    performance: cur,
    previous: { month: prevMonthKey(month), overall: prev.overall },
    points,
    attendanceMonth: attendanceMonth(u.username, month),
    reviews: reviewList,
    coaching,
    warnings,
  })
})

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
  const { key: scKey, scorecard } = await workScorecardFor({ u, person, name, month: CUR })


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
    online: (t) => `Keep your customers' trackers online at ${t}% or above.`,
    retention: (t) => `Keep customer retention at ${t}% or above.`, // legacy key — moved to CS as 'renewal'
    renewal: (t, k) => k?.due
      ? `Renew at least ${Math.ceil(k.due * t / 100)} of the ${k.due} customers due this month.`
      : `Renew at least ${t}% of the customers due this month.`,
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
      : `Renew at least ${t}% of the customers due this month.`,
    'team-online': (t) => `Keep your team's customers' trackers online at ${t}% or above.`,
    'team-reviews': (t, k) => t != null
      ? `The team brings in ${t} five-star Google reviews${k?.perSeller != null ? ` (${k.perSeller} per agent)` : ''}.`
      : 'Get happy customers to leave five-star Google reviews.',
    'team-active': () => 'Every agent makes at least one sale this month.',
    'team-attendance': (t) => `Your team shows up at least ${t}% of scheduled days.`,
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
    joined: u?.joined || person?.joined || null, // lets the page welcome a new joiner instead of "behind"
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
