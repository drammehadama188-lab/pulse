// Public roster — team and performance data. Safe to ship to the browser.
// Used by HR page, Dashboard, and Sales.
//
// ⚠️ PAY LIVES ELSEWHERE. base/commission/transport/total, past-staff settlement
// and payrollHistory were moved to server-only lib/roster-pay.js on 15 Jul 2026
// (they used to bundle into the public JS — every salary was readable in
// dist/assets/*.js). Pay now comes from permission-gated endpoints. Do NOT add
// any pay figure back into this file.
//
// HOW TO UPDATE: Only change 'sales' and 'revenueGenerated' per person.
// Everything else (performance, status, nextAction, actualOutput) auto-calculates.

function autoCalc(person) {
  const sales = person.sales || 0;
  const target = person.target || 0;
  const isTrainee = person.status === 'training';
  const isNew = person.status === 'probation' && !person.lastCheckIn;

  if (target > 0) {
    person.performance = Math.round((sales / target) * 100);
  }

  if (isNew) {
    person.actualOutput = 'Starting — no data yet';
    person.nextAction = person.nextAction || 'review';
    person.nextActionNote = person.nextActionNote || 'New hire — evaluate after first week.';
  } else if (target > 0) {
    person.actualOutput = sales === 0 ? '0 sales this month' : `${sales} sale${sales > 1 ? 's' : ''} this month`;
    if (sales === 0) {
      person.nextAction = isTrainee ? 'warning' : 'review';
      person.nextActionNote = isTrainee
        ? `Zero sales. Training ends ${person.contractEnd ? new Date(person.contractEnd).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : 'soon'}. Likely let go unless turnaround.`
        : 'Zero sales. Review immediately.';
    } else if (person.performance < 50) {
      person.nextAction = isTrainee ? 'review' : 'review';
      person.nextActionNote = `${target - sales} more needed to hit target.`;
    } else if (person.performance >= 80) {
      person.nextAction = 'monitor';
      person.nextActionNote = 'On track. Keep pushing.';
    } else {
      person.nextAction = 'monitor';
      person.nextActionNote = `${target - sales} more to hit target.`;
    }
  }

  return person;
}

// =============================================
// ONLY UPDATE: 'sales' and 'revenueGenerated'
// Everything else auto-calculates
// =============================================

export const team = [
  { // Ya Fatou — moved to Customer Service Supervisor May 2026 (was Sales Supervisor)
    name: 'Yafatou Sawaneh', role: 'Customer Service Supervisor', type: 'Customer Service',
    status: 'active', joined: 'Oct 2025', contract: '6-month fixed', contractEnd: '2026-08-31',
    coreResponsibility: 'Lead customer service — renewals follow-up, ticket resolution, customer retention',
    kpi: 'Retain 80%+ of expiring customers via timely renewal outreach',
    weeklyTarget: 'Renewal calls + ticket triage',
    performance: 90, actualOutput: 'Transitioned from Sales Supervisor May 2026',
    nextAction: 'monitor', nextActionNote: 'Role change effective May 2026. Pay unchanged. Kaddy informally leads sales floor.',
    lastCheckIn: '2026-05-12', revenueGenerated: 0, warnings: 0,
    history: [
      { date: '2025-10-01', event: 'Joined as Customer Service & Sales Support' },
      { date: '2026-02-01', event: 'Promoted to Sales Supervisor', dateApproximate: true, note: 'Exact date pending — see HR file' },
      { date: '2026-05-01', event: 'Moved to Customer Service Supervisor — pay unchanged' },
    ],
  },
  autoCalc({
    name: 'Kaddy Bojang', role: 'Senior Sales Agent', type: 'Sales',
    status: 'active', joined: 'Aug 2023', contract: 'Indefinite',
    coreResponsibility: 'Sell Damia Tracker to new customers',
    kpi: 'Close 5 tracker sales per month',
    weeklyTarget: 'Close 2 sales, generate 5 leads',
    target: 5, sales: 3, revenueGenerated: 20500,
    lastCheckIn: '2026-05-04', warnings: 0,
    history: [
      { date: '2023-08-01', event: 'Joined as Senior Sales Agent' },
      { date: '2025-11-01', event: 'Started 6-month maternity leave', dateApproximate: true },
      { date: '2026-05-04', event: 'Returned from maternity leave' },
    ],
  }),
  // --- SALES AGENTS: change 'sales' and 'revenueGenerated', rest auto-calculates ---
  autoCalc({
    name: 'Sally Saidy', role: 'Sales Agent', type: 'Sales',
    status: 'active', joined: '2026-04-01', contract: '3-month fixed', contractEnd: '2026-06-30',
    coreResponsibility: 'Sell Damia Tracker to new customers',
    kpi: 'Close 5 tracker sales per month',
    weeklyTarget: 'Close 2 sales, generate 5 leads',
    target: 5, sales: 6, revenueGenerated: 40000, // real, from Ya Fatou's sheet (Apr 5 + May 1); cumulative to date
    lastCheckIn: '2026-04-10', warnings: 0,
    history: [
      { date: '2026-04-01', event: 'Joined as Sales Agent — 3-month fixed contract (ends 30 Jun 2026)' },
    ],
  }),
  { // Momodou Lamin Keita — Team Lead, 3-month fixed-term contract (27 Jun–27 Sep 2026) following training. Pay in server-only lib/roster-pay.js.
    name: 'Momodou Lamin Keita', role: 'Team Lead', type: 'Management',
    status: 'active', joined: 'Jun 2026', contract: '3-month Team Lead (fixed term)', contractEnd: '2026-09-27',
    coreResponsibility: 'Lead and organise the team through the app launch; coordinate operations and team performance',
    kpi: 'Team coordination and delivery against launch targets',
    weeklyTarget: 'Coordinate team · drive launch tasks · report progress',
    performance: 0, actualOutput: 'Newly confirmed',
    nextAction: 'review', nextActionNote: 'Team Lead — 3-month fixed term, 27 Jun–27 Sep 2026.',
    lastCheckIn: null, revenueGenerated: 0, warnings: 0,
    history: [
      { date: '2026-05-20', event: 'Started pre-contract Team Lead training & assessment', dateApproximate: true },
    ],
  },
  { // Cleaner — no calculations needed
    name: 'Cleaner', role: 'Office Cleaner', type: 'Operations',
    status: 'active', joined: 'Jan 2026',
    coreResponsibility: 'Keep office clean', kpi: 'Office clean 5 days/week',
    weeklyTarget: 'Daily cleaning', actualOutput: 'Consistent',
    performance: 100, nextAction: 'none', nextActionNote: '',
    lastCheckIn: null, revenueGenerated: 0, warnings: 0,
    history: [
      { date: '2026-01-01', event: 'Joined as Office Cleaner (part-time)' },
    ],
  },
];

// Past staff — monetary fields (pay, finalPay) moved to server-only
// lib/roster-pay.js (pastStaffPay), served via /api/roster/private. Names/roles/
// reasons/dates stay here for the HR history list + category filter.
export const pastStaff = [
  { name: 'Baboucarr Cham', role: 'Sales Supervisor', reason: 'Let go — never performed', date: 'Jan 2026' },
  { name: 'Ndey Drammeh', role: 'Sales Agent', reason: 'Left voluntarily', date: 'Mar 2026' },
  { name: 'Mathew Lenor', role: 'Operations Coordinator', reason: 'Left after 2 days', date: 'Apr 2026' },
  { name: 'Rohey Lowe', role: 'Sales Agent', reason: 'Missed Saturday to attend event — 2nd warning', date: 'Apr 2026' },
  { name: 'Hawa J Jaiteh', role: 'Sales Agent', reason: 'Left team', date: 'May 2026' },
  { name: 'Fatoumatta', role: 'Training Agent', reason: 'Left team', date: 'May 2026' },
  { name: 'Abdou Manjang', role: 'Operations + Social (Internship)', reason: 'Left after ~1 week — role did not work out', date: 'Apr 2026' },
  { name: 'Sulaiman Bello', role: 'Developer', reason: 'Let go', date: 'May 2026' },
  { name: 'Olley Touray', role: 'Customer Support Trainee', reason: 'Left during training', date: 'May 2026' },
  { name: 'Majigen Sowe', role: 'Sales Trainee', reason: 'Training ended — not converted to a sales role', date: 'May 2026' },
  { name: 'Ramatoulie Mboge', role: 'Digital Marketing & Media Officer', reason: 'Terminated in probation — performance (20 May 2026)', date: 'May 2026' },
  { name: 'Ebrima Jallow', role: 'Digital Marketing & Media Officer', reason: 'Left — one-month probation (20 May–20 Jun) not confirmed', date: 'Jun 2026' },
  { name: 'Ebou Jobe', role: 'Technician / Installer', reason: 'Contract ended 15 Jun 2026', date: 'Jun 2026' },
];

// payrollHistory and totalPayroll moved to server-only lib/roster-pay.js on
// 15 Jul 2026 (per-person pay amounts must not ship in the public bundle).
// The HR Payroll History card and totals now load them from /api/roster/private.
