// Single source of truth for team and payroll data
// Used by HR page, Finance page, Dashboard, and Sales
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
    name: 'Ya Fatou Sawaneh', role: 'Customer Service Supervisor', type: 'Customer Service',
    base: 7000, commission: 5000, total: 12000,
    status: 'active', joined: 'Oct 2025', contract: '6-month fixed', contractEnd: '2026-08-31',
    coreResponsibility: 'Lead customer service — renewals follow-up, ticket resolution, customer retention',
    kpi: 'Retain 80%+ of expiring customers via timely renewal outreach',
    weeklyTarget: 'Renewal calls + ticket triage',
    performance: 90, actualOutput: 'Transitioned from Sales Supervisor May 2026',
    nextAction: 'monitor', nextActionNote: 'Role change effective May 2026. Pay unchanged (D7K base + D5K commission). Kaddy informally leads sales floor.',
    lastCheckIn: '2026-05-12', revenueGenerated: 0, warnings: 0,
    history: [
      { date: '2025-10-01', event: 'Joined as Customer Service & Sales Support' },
      { date: '2026-02-01', event: 'Promoted to Sales Supervisor', dateApproximate: true, note: 'Exact date pending — see HR file' },
      { date: '2026-05-01', event: 'Moved to Customer Service Supervisor — pay unchanged' },
    ],
  },
  { // Ebou — no sales target, manual fields
    name: 'Ebou Jobe', role: 'Technician / Installer', type: 'Operations',
    base: 15000, commission: 0, total: 15000,
    status: 'active', joined: 'Sep 2025', contract: 'Contractor',
    coreResponsibility: 'Install trackers and handle hardware setup',
    kpi: 'Complete all installations within 48 hours',
    weeklyTarget: 'Complete all pending installations',
    performance: 88, actualOutput: '7 completed, 1 pending',
    nextAction: 'monitor', nextActionNote: 'Reliable. Works closely with Abdou on ops.',
    lastCheckIn: '2026-04-10', revenueGenerated: 0, warnings: 0,
    history: [
      { date: '2025-09-01', event: 'Joined as Technician / Installer (Contractor)' },
    ],
  },
  autoCalc({
    name: 'Ramatoulie Mboge', role: 'Digital Marketing & Media Officer', type: 'Marketing',
    base: 8000, commission: 2000, transport: 1000, total: 11000,
    status: 'probation', joined: '2026-04-20', contract: '2-month probation', contractEnd: '2026-06-20',
    coreResponsibility: 'Create video/photo content, manage social media, plan campaigns',
    kpi: 'Grow social engagement + deliver consistent content pipeline',
    weeklyTarget: 'Onboarding — meet team, learn brand voice, plan first content slate',
    nextActionNote: 'New hire — starts 20 Apr. Probation ends 20 Jun. D8K base + D1K transport, D2K commission post-probation.',
    lastCheckIn: null, revenueGenerated: 0, warnings: 0,
    history: [
      { date: '2026-04-20', event: 'Joined as Digital Marketing & Media Officer — 2-month probation (ends 20 Jun 2026)' },
    ],
  }),
  autoCalc({
    name: 'Kaddy Bojang', role: 'Senior Sales Agent', type: 'Sales',
    base: 6000, commission: 6000, total: 12000,
    status: 'active', joined: 'Aug 2023', contract: 'Indefinite',
    coreResponsibility: 'Sell Damia Tracker to new customers',
    kpi: 'Close 5 tracker sales per month',
    weeklyTarget: 'Close 2 sales, generate 5 leads',
    target: 5, sales: 0, revenueGenerated: 0,
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
    base: 6000, commission: 5000, total: 11000,
    status: 'active', joined: '2026-04-01', contract: '3-month fixed', contractEnd: '2026-06-30',
    coreResponsibility: 'Sell Damia Tracker to new customers',
    kpi: 'Close 5 tracker sales per month',
    weeklyTarget: 'Close 2 sales, generate 5 leads',
    target: 5, sales: 5, revenueGenerated: 37500,
    lastCheckIn: '2026-04-10', warnings: 0,
    history: [
      { date: '2026-04-01', event: 'Joined as Sales Agent — 3-month fixed contract (ends 30 Jun 2026)' },
    ],
  }),
  // --- TRAINEES: change 'sales' and 'revenueGenerated', rest auto-calculates ---
  autoCalc({
    name: 'Majigen Sowe', role: 'Trainee', type: 'Training',
    base: 2000, commission: 0, total: 2000,
    status: 'training', joined: '30 Mar 2026', contractEnd: '2026-05-31',
    coreResponsibility: 'Learn sales process and demonstrate potential',
    kpi: '2 sales during training',
    weeklyTarget: '20 calls, 3 leads, 1 sale',
    target: 2, sales: 1, revenueGenerated: 7500,
    lastCheckIn: '2026-04-11', warnings: 0,
    history: [
      { date: '2026-03-30', event: 'Started Sales Trainee programme — 2-month evaluation (ends 31 May 2026)' },
    ],
  }),
  { // Cleaner — no calculations needed
    name: 'Cleaner', role: 'Office Cleaner', type: 'Operations',
    base: 2500, commission: 0, total: 2500,
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

export const pastStaff = [
  { name: 'Baboucarr Cham', role: 'Sales Supervisor', pay: 10000, reason: 'Let go — never performed', date: 'Jan 2026', finalPay: 2608 },
  { name: 'Ndey Drammeh', role: 'Sales Agent', pay: 6000, reason: 'Left voluntarily', date: 'Mar 2026', finalPay: 6000 },
  { name: 'Mathew Lenor', role: 'Operations Coordinator', pay: 0, reason: 'Left after 2 days', date: 'Apr 2026', finalPay: 0 },
  { name: 'Rohey Lowe', role: 'Sales Agent', pay: 11000, reason: 'Missed Saturday to attend event — 2nd warning', date: 'Apr 2026', finalPay: 3000 },
  { name: 'Hawa J Jaiteh', role: 'Sales Agent', pay: 6000, reason: 'Left team', date: 'May 2026', finalPay: 0 },
  { name: 'Fatoumatta', role: 'Training Agent', pay: 2000, reason: 'Left team', date: 'May 2026', finalPay: 0 },
  { name: 'Abdou Manjang', role: 'Operations + Social (Internship)', pay: 2000, reason: 'Left after ~1 week — role did not work out', date: 'Apr 2026', finalPay: 0 },
  { name: 'Sulaiman Bello', role: 'Developer', pay: 23000, reason: 'Let go', date: 'May 2026', finalPay: 6900 },
  { name: 'Olley Touray', role: 'Customer Support Trainee', pay: 2000, reason: 'Left during training', date: 'May 2026', finalPay: 0 },
];

export const payrollHistory = [
  { month: 'April 2026', total: 60400, breakdown: 'Mathew left 14 Apr — no pay. Abdou on new internship terms from 15 Apr (D5K 13–14 Apr + D2K 15–30 Apr). Rohey left 15 Apr — D3,000 final (half month base, no commission due to 2nd warning).' },
  { month: 'March 2026', total: 35500, breakdown: 'Ebou D15K + Ya Fatou D12K + Agents D6K + Cleaner D2.5K' },
  { month: 'February 2026', total: 21000, breakdown: 'Ebou D15K + Ya Fatou D6K (reduced after restructuring)' },
  { month: 'January 2026', total: 65397, breakdown: 'Full team incl. Baboucarr + agents who were let go' },
];

export const totalPayroll = team.reduce((sum, t) => sum + t.total, 0);
