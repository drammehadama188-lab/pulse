// Zoho Books client for Pulse — read-only.
// Reuses the same refresh-token flow as admin-damia-tracker. Credentials come
// from .env (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN /
// ZOHO_ORG_ID). Only the refresh token lives on disk; access tokens are minted
// in memory at runtime and reused until they 401.
//
// We pull the "Salaries and Employee Wages" expense account and turn it into a
// per-person, per-month payroll history. Nothing is written back to Zoho.

import https from 'node:https'
import querystring from 'node:querystring'

// NB: read process.env at CALL time, not module-init time. server.js imports
// this module (hoisted) before its .env loader runs, so any value captured in a
// top-level const here would be undefined.
const authBase = () => process.env.ZOHO_AUTH_BASE || 'https://accounts.zoho.eu'
const apiBase = () => process.env.ZOHO_API_BASE || 'https://www.zohoapis.eu'
const orgId = () => process.env.ZOHO_ORG_ID

// Account IDs live in .env (gitignored), not source. Salaries is where staff
// pay is booked; pay sources are the bank/cash accounts a payment comes from.
const salaryAccountId = () => process.env.ZOHO_SALARY_ACCOUNT_ID
export function paySources() {
  return [
    { key: 'wave', label: 'Wave', accountId: process.env.ZOHO_PAYSRC_WAVE },
    { key: 'access_bank', label: 'Access Bank', accountId: process.env.ZOHO_PAYSRC_ACCESS_BANK },
    { key: 'cash', label: 'Cash on Hand', accountId: process.env.ZOHO_PAYSRC_CASH },
    { key: 'petty_cash', label: 'Petty Cash', accountId: process.env.ZOHO_PAYSRC_PETTY_CASH },
  ].filter((s) => s.accountId)
}
export function paySourceById(key) {
  return paySources().find((s) => s.key === key) || null
}

export function zohoConfigured() {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN && orgId())
}

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: headers || {} },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, data }) }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

let accessToken = null
async function refreshAccessToken() {
  const body = querystring.stringify({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  })
  const res = await request('POST', authBase() + '/oauth/v2/token?' + body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  if (!res.data || !res.data.access_token) {
    throw new Error('Zoho token refresh failed: ' + JSON.stringify(res.data))
  }
  accessToken = res.data.access_token
  return accessToken
}

async function zohoGet(endpoint) {
  if (!accessToken) await refreshAccessToken()
  let res = await request('GET', apiBase() + endpoint, { Authorization: 'Zoho-oauthtoken ' + accessToken })
  if (res.status === 401) {
    await refreshAccessToken()
    res = await request('GET', apiBase() + endpoint, { Authorization: 'Zoho-oauthtoken ' + accessToken })
  }
  if (res.status !== 200) {
    throw new Error(`Zoho ${endpoint} → HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`)
  }
  return res.data
}

// POST a JSON body to Books (create vendor / expense). Retries once on 401.
async function zohoPost(endpoint, payload) {
  if (!accessToken) await refreshAccessToken()
  const body = JSON.stringify(payload)
  const headers = () => ({ Authorization: 'Zoho-oauthtoken ' + accessToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  let res = await request('POST', apiBase() + endpoint, headers(), body)
  if (res.status === 401) {
    await refreshAccessToken()
    res = await request('POST', apiBase() + endpoint, headers(), body)
  }
  // Zoho returns code 0 on success; non-zero code (or non-2xx) is an error.
  if (res.status >= 300 || (res.data && typeof res.data === 'object' && res.data.code && res.data.code !== 0)) {
    throw new Error(`Zoho POST ${endpoint} → HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`)
  }
  return res.data
}

// Pull every expense in a date range (paginated).
async function fetchExpenses(dateStart, dateEnd) {
  let all = []
  let page = 1
  while (page <= 50) {
    const d = await zohoGet(`/books/v3/expenses?organization_id=${orgId()}&page=${page}&per_page=200&date_start=${dateStart}&date_end=${dateEnd}`)
    const items = Array.isArray(d.expenses) ? d.expenses : []
    all = all.concat(items)
    if (!d.page_context?.has_more_page) break
    page++
  }
  return all
}

const SALARY_ACCOUNT_RE = /salar|wage/i

// Some Books vendors are saved as an email/handle (e.g. the Nigeria dev). Map
// them to a friendly display name for the history. Map lives in .env
// (ZOHO_VENDOR_DISPLAY_NAMES as JSON) so no personal names sit in source and
// it's editable without a deploy. Display-only — Zoho data is never changed.
function vendorDisplayName(name) {
  try {
    const map = JSON.parse(process.env.ZOHO_VENDOR_DISPLAY_NAMES || '{}')
    return map[name] || map[String(name).toLowerCase()] || name
  } catch { return name }
}

const MONTH_LABEL = (ym) => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Build per-person, per-month payroll history from the Salaries account.
// `from` defaults to 2025-01-01 (Books has a stray Jan-2024 entry we skip).
export async function buildPayrollHistory({ from = '2025-01-01', to } = {}) {
  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const end = to || `${yyyy}-${mm}-${dd}`
  const currentMonth = `${yyyy}-${mm}`

  const expenses = await fetchExpenses(from, end)

  // Bucket Salaries-account lines by month, then consolidate per person.
  const months = new Map() // ym -> Map<name,{amount,notes[]}>
  for (const e of expenses) {
    if (!SALARY_ACCOUNT_RE.test(e.account_name || '')) continue
    const ym = (e.date || '').slice(0, 7)
    if (!ym || ym < '2025-01') continue // skip the stray 2024 entry
    if (!months.has(ym)) months.set(ym, new Map())
    const people = months.get(ym)
    const name = (e.vendor_name || 'Unnamed').trim()
    if (!people.has(name)) people.set(name, { amount: 0, notes: [] })
    const rec = people.get(name)
    rec.amount += Number(e.total) || 0
    if (e.description) rec.notes.push(String(e.description).trim())
  }

  // Shape into a sorted (newest-first) list with per-person breakdowns.
  const list = [...months.entries()]
    .map(([ym, people]) => {
      const peopleArr = [...people.entries()]
        .map(([name, r]) => ({ name: vendorDisplayName(name), amount: Math.round(r.amount), note: r.notes.join('; ') || '' }))
        .sort((a, b) => b.amount - a.amount)
      const total = peopleArr.reduce((s, p) => s + p.amount, 0)
      return { ym, month: MONTH_LABEL(ym), total, headcount: peopleArr.length, people: peopleArr }
    })
    .sort((a, b) => (a.ym < b.ym ? 1 : -1))

  // Confidence flag — mark months that look like incomplete bookkeeping so
  // they aren't mistaken for the true wage bill. Heuristic: well below the
  // median month, or very few people. The current month is "in progress",
  // not low-confidence.
  const closed = list.filter((m) => m.ym !== currentMonth)
  const totals = closed.map((m) => m.total).sort((a, b) => a - b)
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0
  for (const m of list) {
    if (m.ym === currentMonth) { m.confidence = 'in_progress'; continue }
    const thin = (median > 0 && m.total < 0.5 * median) || m.headcount <= 2
    m.confidence = thin ? 'low' : 'ok'
  }

  return { source: 'zoho-books', account: 'Salaries and Employee Wages', from, to: end, median, months: list }
}

// ---------- payroll WRITE path (create vendors + salary expenses) ----------

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

let _vendorCache = null // { at, vendors:[{id,name}] }
const VENDOR_TTL = 30 * 60 * 1000
async function listVendors(force = false) {
  if (!force && _vendorCache && Date.now() - _vendorCache.at < VENDOR_TTL) return _vendorCache.vendors
  let all = []
  let page = 1
  while (page <= 20) {
    const d = await zohoGet(`/books/v3/contacts?organization_id=${orgId()}&contact_type=vendor&page=${page}&per_page=200`)
    const items = Array.isArray(d.contacts) ? d.contacts : []
    all = all.concat(items.map((c) => ({ id: c.contact_id, name: c.contact_name })))
    if (!d.page_context?.has_more_page) break
    page++
  }
  _vendorCache = { at: Date.now(), vendors: all }
  return all
}

// Resolve a staff name to an existing Zoho vendor WITHOUT creating anything.
// Returns { match: {id,name} | null, fuzzy: bool, candidates: [...] }. The UI
// shows this so the owner approves the vendor (or a new one) before any post.
export async function resolveVendor(name) {
  const vendors = await listVendors()
  const n = normName(name)
  const exact = vendors.find((v) => normName(v.name) === n)
  if (exact) return { match: exact, fuzzy: false }
  // fuzzy: one vendor whose normalized name contains (or is contained by) ours
  const near = vendors.filter((v) => {
    const vn = normName(v.name)
    return vn.includes(n) || n.includes(vn)
  })
  if (near.length === 1) return { match: near[0], fuzzy: true }
  return { match: null, fuzzy: false, candidates: near.map((v) => ({ id: v.id, name: v.name })) }
}

async function createVendor(name) {
  const d = await zohoPost(`/books/v3/contacts?organization_id=${orgId()}`, {
    contact_name: String(name).trim(),
    contact_type: 'vendor',
  })
  const c = d.contact
  if (!c?.contact_id) throw new Error('Vendor create returned no id')
  _vendorCache = null // bust cache so the new vendor is visible next lookup
  return { id: c.contact_id, name: c.contact_name }
}

// Is there already a Salaries expense for this vendor in this YYYY-MM? Guards
// against double-paying on a re-run or double-click.
export async function existingSalaryExpense(vendorId, ym) {
  const start = `${ym}-01`
  const [y, m] = ym.split('-').map(Number)
  const endDay = new Date(y, m, 0).getDate()
  const end = `${ym}-${String(endDay).padStart(2, '0')}`
  let page = 1
  while (page <= 10) {
    const d = await zohoGet(`/books/v3/expenses?organization_id=${orgId()}&vendor_id=${vendorId}&date_start=${start}&date_end=${end}&page=${page}&per_page=200`)
    const items = Array.isArray(d.expenses) ? d.expenses : []
    const hit = items.find((e) => String(e.account_id) === String(salaryAccountId()) || /salar|wage/i.test(e.account_name || ''))
    if (hit) return { expense_id: hit.expense_id, total: hit.total, date: hit.date }
    if (!d.page_context?.has_more_page) break
    page++
  }
  return null
}

// Record one staff payment as a single Salaries expense (salary + bonus
// combined; the split is in the description). dryRun assembles and returns the
// exact payload WITHOUT writing — used to prove the path before any real post.
export async function recordSalaryPayment({ name, salary = 0, bonus = 0, paySourceKey, date, period, autoCreateVendor = true, force = false, dryRun = false }) {
  if (!salaryAccountId()) throw new Error('ZOHO_SALARY_ACCOUNT_ID not set')
  const src = paySourceById(paySourceKey)
  if (!src) throw new Error('Unknown pay source: ' + paySourceKey)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Valid date (YYYY-MM-DD) required')
  const total = Math.round((Number(salary) || 0) + (Number(bonus) || 0))
  if (total <= 0) throw new Error('Amount must be greater than zero')
  const ym = (period && /^\d{4}-\d{2}$/.test(period)) ? period : date.slice(0, 7)

  // Resolve (or create) the vendor.
  const resolved = await resolveVendor(name)
  let vendor = resolved.match
  let createdVendor = false
  if (!vendor) {
    if (!autoCreateVendor) {
      return { ok: false, reason: 'no_vendor', candidates: resolved.candidates, message: `No Zoho vendor matches "${name}".` }
    }
    if (!dryRun) { vendor = await createVendor(name); createdVendor = true }
    else vendor = { id: '(new — will be created)', name: name.trim() }
  }

  // Duplicate guard.
  let duplicate = null
  if (vendor.id && !String(vendor.id).startsWith('(')) {
    duplicate = await existingSalaryExpense(vendor.id, ym)
    if (duplicate && !force) {
      return { ok: false, reason: 'duplicate', vendor, duplicate, message: `${name} already has a Salaries expense for ${ym} (D${Number(duplicate.total).toLocaleString()}).` }
    }
  }

  const bonusNote = Number(bonus) > 0 ? ` (Base D${Math.round(Number(salary)).toLocaleString()} + Bonus D${Math.round(Number(bonus)).toLocaleString()})` : ''
  const payload = {
    account_id: salaryAccountId(),
    paid_through_account_id: src.accountId,
    vendor_id: String(vendor.id).startsWith('(') ? undefined : vendor.id,
    date,
    amount: total,
    description: `Payroll ${ym} — ${name}${bonusNote}. Paid via ${src.label}.`,
  }

  if (dryRun) {
    return { ok: true, dryRun: true, vendor, createdVendor, fuzzyVendor: resolved.fuzzy, paySource: src, total, payload }
  }

  const d = await zohoPost(`/books/v3/expenses?organization_id=${orgId()}`, payload)
  const exp = d.expense || {}
  return { ok: true, vendor, createdVendor, fuzzyVendor: resolved.fuzzy, paySource: src, total, expenseId: exp.expense_id, date: exp.date }
}

// Fetch one expense by id — null if it no longer exists (deleted in Zoho).
export async function getExpense(expenseId) {
  if (!accessToken) await refreshAccessToken()
  const ep = `/books/v3/expenses/${expenseId}?organization_id=${orgId()}`
  let res = await request('GET', apiBase() + ep, { Authorization: 'Zoho-oauthtoken ' + accessToken })
  if (res.status === 401) { await refreshAccessToken(); res = await request('GET', apiBase() + ep, { Authorization: 'Zoho-oauthtoken ' + accessToken }) }
  if (res.status === 404) return null
  if (res.status !== 200) throw new Error(`Zoho getExpense → HTTP ${res.status}`)
  const e = res.data.expense
  if (!e) return null
  return { expense_id: e.expense_id, total: e.total, date: e.date, description: e.description, paid_through_account_name: e.paid_through_account_name }
}

// DELETE a Books expense (the "undo").
export async function deleteExpense(expenseId) {
  if (!accessToken) await refreshAccessToken()
  const ep = `/books/v3/expenses/${expenseId}?organization_id=${orgId()}`
  let res = await request('DELETE', apiBase() + ep, { Authorization: 'Zoho-oauthtoken ' + accessToken })
  if (res.status === 401) { await refreshAccessToken(); res = await request('DELETE', apiBase() + ep, { Authorization: 'Zoho-oauthtoken ' + accessToken }) }
  if (res.status === 404) return { ok: true, alreadyGone: true } // already deleted in Zoho — fine
  if (res.status >= 300) throw new Error(`Zoho deleteExpense → HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`)
  return { ok: true }
}

// Update an existing salary expense (the "edit"). Re-uses the same one-line
// salary+bonus shape. vendorId/name come from the stored record.
async function zohoPut(endpoint, payload) {
  if (!accessToken) await refreshAccessToken()
  const body = JSON.stringify(payload)
  const headers = () => ({ Authorization: 'Zoho-oauthtoken ' + accessToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  let res = await request('PUT', apiBase() + endpoint, headers(), body)
  if (res.status === 401) { await refreshAccessToken(); res = await request('PUT', apiBase() + endpoint, headers(), body) }
  if (res.status >= 300 || (res.data && typeof res.data === 'object' && res.data.code && res.data.code !== 0)) {
    throw new Error(`Zoho PUT ${endpoint} → HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`)
  }
  return res.data
}

export async function updateSalaryExpense(expenseId, { name, vendorId, salary = 0, bonus = 0, paySourceKey, date, period }) {
  if (!salaryAccountId()) throw new Error('ZOHO_SALARY_ACCOUNT_ID not set')
  const src = paySourceById(paySourceKey)
  if (!src) throw new Error('Unknown pay source: ' + paySourceKey)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Valid date (YYYY-MM-DD) required')
  const total = Math.round((Number(salary) || 0) + (Number(bonus) || 0))
  if (total <= 0) throw new Error('Amount must be greater than zero')
  const ym = (period && /^\d{4}-\d{2}$/.test(period)) ? period : date.slice(0, 7)
  const bonusNote = Number(bonus) > 0 ? ` (Base D${Math.round(Number(salary)).toLocaleString()} + Bonus D${Math.round(Number(bonus)).toLocaleString()})` : ''
  const payload = {
    account_id: salaryAccountId(),
    paid_through_account_id: src.accountId,
    vendor_id: vendorId || undefined,
    date,
    amount: total,
    description: `Payroll ${ym} — ${name}${bonusNote}. Paid via ${src.label}.`,
  }
  const d = await zohoPut(`/books/v3/expenses/${expenseId}?organization_id=${orgId()}`, payload)
  const exp = d.expense || {}
  return { ok: true, paySource: src, total, expenseId: exp.expense_id || expenseId, date: exp.date || date }
}
