// Client pay data — fetched from permission-gated endpoints, never bundled.
// Pay figures used to live in src/data/team.js and shipped in the public JS
// (the 15 Jul 2026 leak). They now come from the server: /api/payroll/people
// (payroll power) and /api/roster/private (payroll power). A normal staffer's
// browser receives an empty list here (the endpoint 403s → [] / zeros), so no
// colleague's salary reaches their machine. Own pay comes from /api/me.
import { api } from './api'

let _people = null
// [{ username, name, title, department, base, commission, transport, total }]
export function rosterPay() {
  if (!_people) _people = api('/payroll/people').then((r) => r.people || []).catch(() => [])
  return _people
}

// name -> pay row, for O(1) lookup on profile pages.
export async function payByName() {
  const people = await rosterPay()
  const m = {}
  for (const p of people) m[p.name] = p
  return m
}

let _private = null
// { pastStaff:[{name,role,reason,date,pay,finalPay}], payrollHistory:[...], totalPayroll }
export function rosterPrivate() {
  if (!_private) _private = api('/roster/private').then((r) => r).catch(() => ({ pastStaff: [], payrollHistory: [], totalPayroll: 0 }))
  return _private
}
