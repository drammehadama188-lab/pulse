// Server-only compensation + payroll data.
//
// ⚠️ NEVER import this from any file under src/ — doing so bundles it into the
// public JavaScript that Pulse serves to every browser (the 15 Jul 2026 leak,
// where every staff salary was readable in dist/assets/*.js). This file is
// imported ONLY by server.js and served back through permission-gated endpoints
// (/api/payroll/people, /api/me self-pay, /api/roster/private). Keyed by the
// person's `name` so it maps onto the public roster in src/data/team.js at
// request time.

// Active staff pay — keyed by name (matches src/data/team.js `name`).
export const rosterPay = {
  'Yafatou Sawaneh':     { base: 7000,  commission: 5000,  transport: 0, total: 12000 },
  'Kaddy Bojang':        { base: 6000,  commission: 6000,  transport: 0, total: 12000 },
  'Sally Saidy':         { base: 6000,  commission: 5000,  transport: 0, total: 11000 },
  'Momodou Lamin Keita': { base: 16000, commission: 10000, transport: 0, total: 26000 },
  'Cleaner':             { base: 2500,  commission: 0,     transport: 0, total: 2500  },
}

// Past staff monetary settlement — keyed by name (matches pastStaff `name`).
// The non-monetary fields (role, reason, date) stay in src/data/team.js.
export const pastStaffPay = {
  'Baboucarr Cham':    { pay: 10000, finalPay: 2608 },
  'Ndey Drammeh':      { pay: 6000,  finalPay: 6000 },
  'Mathew Lenor':      { pay: 0,     finalPay: 0    },
  'Rohey Lowe':        { pay: 11000, finalPay: 3000 },
  'Hawa J Jaiteh':     { pay: 6000,  finalPay: 0    },
  'Fatoumatta':        { pay: 2000,  finalPay: 0    },
  'Abdou Manjang':     { pay: 2000,  finalPay: 0    },
  'Sulaiman Bello':    { pay: 23000, finalPay: 6900 },
  'Olley Touray':      { pay: 2000,  finalPay: 0    },
  'Majigen Sowe':      { pay: 2000,  finalPay: 2000 },
  'Ramatoulie Mboge':  { pay: 9000,  finalPay: 9000 },
  'Ebrima Jallow':     { pay: 6000,  finalPay: 0    },
  'Ebou Jobe':         { pay: 15000, finalPay: 15000 },
}

// Legacy payroll history (Jan–Apr 2026), display-only. Moved out of the client
// bundle 15 Jul 2026 — per-person pay amounts must not ship to browsers. Served
// via /api/roster/private (payroll power). Going-forward months come from the
// live payslip API (/api/payslips), not this array.
export const payrollHistory = [
  {
    month: 'April 2026',
    total: 60400,
    breakdown: 'Mathew left 14 Apr — no pay. Abdou on new internship terms from 15 Apr (D5K to 14 Apr + D2K 15–30 Apr). Rohey left 15 Apr — D3,000 final (half month base, no commission due to 2nd warning).',
    people: [
      { name: 'Mathew Lenor', amount: 0, note: 'Left 14 Apr — no pay' },
      { name: 'Abdourahman Manjang', amount: 7000, note: 'D5,000 to 14 Apr + D2,000 internship 15–30 Apr' },
      { name: 'Rohey Lowe', amount: 3000, note: 'Final pay — half-month base, no commission (2nd warning)' },
      { name: 'Rest of team — not itemised', amount: 50400, unallocated: true, note: 'Bulk team pay for April was not recorded per person in the ledger' },
    ],
  },
  {
    month: 'March 2026',
    total: 35500,
    breakdown: 'Ebou D15K + Ya Fatou D12K + Agents D6K + Cleaner D2.5K',
    people: [
      { name: 'Ebou', amount: 15000 },
      { name: 'Ya Fatou Sawaneh', amount: 12000 },
      { name: 'Agents — not itemised', amount: 6000, unallocated: true, note: 'Recorded only as a combined "Agents" line in the ledger' },
      { name: 'Cleaner', amount: 2500 },
    ],
  },
  {
    month: 'February 2026',
    total: 21000,
    breakdown: 'Ebou D15K + Ya Fatou D6K (reduced after restructuring)',
    people: [
      { name: 'Ebou', amount: 15000 },
      { name: 'Ya Fatou Sawaneh', amount: 6000, note: 'Reduced after restructuring' },
    ],
  },
  {
    month: 'January 2026',
    total: 65397,
    breakdown: 'Full team incl. Baboucarr + agents who were let go',
    people: [
      { name: 'Whole team — not itemised', amount: 65397, unallocated: true, note: 'Full team incl. Baboucarr + agents since let go; never broken down per person in the ledger' },
    ],
  },
]

// Convenience: total monthly payroll across active staff (was totalPayroll in
// team.js). Server-side only.
export const totalPayroll = Object.values(rosterPay).reduce((s, p) => s + (p.total || 0), 0)

// Merge helper — given the public roster array, attach pay by name. Used by the
// payroll endpoint so it keeps returning the same shape it did when pay lived in
// team.js.
export function withPay(person) {
  const p = rosterPay[person.name] || { base: 0, commission: 0, transport: 0, total: 0 }
  return { ...person, ...p }
}
