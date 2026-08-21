import {
  LayoutDashboard, Users, TrendingUp, Clock, FileText, Target,
  ClipboardCheck, ShieldAlert, Wallet, Gift, BookOpen, FolderOpen,
  Palmtree, User, Menu, UserPlus, ShieldCheck, BarChart3, GraduationCap,
} from 'lucide-react'

const isOwner = (u) => u?.username === 'adama' // CEO/owner — no self-service (leave, clock-in…)
// Access comes from per-person power grants (CEO holds all). 'manager' is
// just a title now — it unlocks nothing by itself.
const has = (u, p) => (u?.powers || []).includes(p)
// Anyone with the 'hr' power sees the management control-centre sections.
const mgr = (u) => has(u, 'hr')

// Full sidebar list (desktop). Each item self-gates via show().
// `group` buckets items into labelled sidebar sections (Dashboard sits on top,
// ungrouped). GROUP_ORDER below sets the section order.
//
// 22 Jun 2026 (Adama's request): the whole platform IS the CEO's HR control
// centre, so the old single "HR & Team" department page (8 buried tabs) was
// dissolved and its screens promoted to first-class, sectioned nav items —
// modelled on the admin app. Marketing removed (Pulse is HR-only). The
// management sections gate on powers so a plain staffer only sees Dashboard +
// Personal; the CEO (all powers) sees the full control centre.
export const NAV = [
  // 20 Aug 2026 — regrouped to the design Adama sent: Overview, People,
  // Performance, Time & requests, Payroll, Company, Analytics. Three pages the
  // mock did not draw are kept in the nearest section rather than dropped:
  // Staff (People), KPI Targets (Performance) and Team Workday (Time).
  { id: 'dashboard', to: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview', show: () => true },

  // PEOPLE — the roster, the day, and who is coming in.
  { id: 'people', to: '/people', label: 'Employees', icon: Users, group: 'People', show: mgr },
  { id: 'attendance-mgr', to: '/attendance', label: 'Attendance', icon: Clock, group: 'People', show: mgr },
  { id: 'recruitment', to: '/recruitment', label: 'Recruitment', icon: UserPlus, group: 'People', show: mgr },
  { id: 'staff', to: '/team', label: 'Staff', icon: ShieldCheck, group: 'People', show: (u) => has(u, 'staffadmin') },

  // PERFORMANCE — how people are doing, and what they are measured against.
  { id: 'performance', to: '/performance', label: 'Performance', icon: TrendingUp, group: 'Performance', show: mgr },
  { id: 'reviews', to: '/reviews', label: 'Reviews & Coaching', icon: ShieldAlert, group: 'Performance', show: mgr },
  // KPI Targets = where the company's goals are SET (CEO-only; Adama 3 Jul —
  // "Pulse should be responsible for changing the goals and it reflects in
  // admin"). Scorecards + Admin's goal numbers all read from it.
  { id: 'kpi-targets', to: '/kpi-targets', label: 'KPI Targets', icon: Target, group: 'Performance', show: isOwner },

  // TIME & REQUESTS
  // Hidden for a team lead whose approvals stay inside their own team — Team
  // Requests already covers those, so this would be a duplicate page.
  { id: 'requests', to: '/requests', label: 'Requests', icon: ClipboardCheck, group: 'Time & requests', show: (u) => has(u, 'approvals') && !(u?.isTeamLead && u?.approvalsBeyondTeam === false) },
  { id: 'workday-monitor', to: '/workday-monitor', label: 'Team Workday', icon: Target, group: 'Time & requests', show: mgr },

  // PAYROLL
  { id: 'payroll', to: '/payroll', label: 'Payroll', icon: Wallet, group: 'Payroll', show: (u) => has(u, 'payroll') },
  // Was /benefits, a placeholder shell that was never built on. The real
  // salary + benefits + payslips page is Pay.jsx, and managers had no link to
  // it at all (my-pay below is staff-only) — Adama had to type the URL.
  { id: 'benefits', to: '/pay', label: 'Payslips & Benefits', icon: Gift, group: 'Payroll', show: (u) => has(u, 'payroll') },

  // COMPANY
  { id: 'policies', to: '/policies', label: 'Policies', icon: BookOpen, group: 'Company', show: mgr },
  { id: 'documents', to: '/documents', label: 'Documents', icon: FolderOpen, group: 'Company', show: mgr },
  // Tracker Guide — the product taught to staff (Adama 19 Aug); everyone sees it.
  { id: 'tracker-guide', to: '/tracker-guide', label: 'Tracker Guide', icon: GraduationCap, group: 'Company', show: () => true },

  // ANALYTICS — Reports composes server-side from whichever powers the person holds.
  { id: 'reports', to: '/reports', label: 'Reports', icon: BarChart3, group: 'Analytics', show: (u) => ['team', 'approvals', 'payroll', 'hr'].some((p) => has(u, p)) },

  // MY TEAM — a team lead's scoped workspace over the people they manage (NOT the
  // whole company). Gated on isTeamLead (server-computed); pages re-check scope.
  { id: 'my-week', to: '/my-week', label: 'My Workday', icon: Target, group: 'My team', show: (u) => u?.isTeamLead },
  { id: 'reports-lead', to: '/reports', label: 'Reports', icon: BarChart3, group: 'My team', show: (u) => u?.isTeamLead && !has(u, 'hr') },
  { id: 'team-dashboard', to: '/team-dashboard', label: 'Team Dashboard', icon: LayoutDashboard, group: 'My team', show: (u) => u?.isTeamLead },
  { id: 'team-requests', to: '/team-requests', label: 'Team Requests', icon: ClipboardCheck, group: 'My team', show: (u) => u?.isTeamLead },
  { id: 'team-schedule', to: '/team-schedule', label: 'Team Schedule', icon: Clock, group: 'My team', show: (u) => u?.isTeamLead },
  { id: 'team-reviews', to: '/team-reviews', label: 'Team Reviews', icon: ShieldAlert, group: 'My team', show: (u) => u?.isTeamLead },

  // PERSONAL — self-service. Staff (no 'hr' power) get their own Attendance here;
  // managers reach the team view via the PEOPLE section instead.
  { id: 'my-progress', to: '/my-progress', label: 'My Progress', icon: Target, group: 'My work', show: (u) => !mgr(u) },
  { id: 'my-hours', to: '/attendance', label: 'My Hours', icon: Clock, group: 'My work', show: (u) => !mgr(u) },
  { id: 'my-leave', to: '/leave', label: 'Requests', icon: Palmtree, group: 'My work', show: (u) => !isOwner(u) },
  { id: 'my-reviews', to: '/my-reviews', label: 'Reviews', icon: FileText, group: 'My work', show: (u) => !mgr(u) },
  { id: 'my-pay', to: '/pay', label: 'Payslips', icon: Wallet, group: 'Pay', show: (u) => !mgr(u) },
  { id: 'my-policies', to: '/policies', label: 'Policies', icon: BookOpen, group: 'Company', show: (u) => !mgr(u) },
  { id: 'my-documents', to: '/my-documents', label: 'Documents', icon: FolderOpen, group: 'Company', show: (u) => !mgr(u) },
  { id: 'me', to: '/me', label: 'Me', icon: User, group: 'Personal', show: () => true },
]

// Section order for the grouped sidebar.
const GROUP_ORDER = ['Overview', 'People', 'Performance', 'Time & requests', 'My work', 'My team', 'Payroll', 'Pay', 'Company', 'Analytics', 'Personal']

export const MORE = { key: 'more', label: 'More', icon: Menu }

// Departments are dissolved — everything lives in NAV now. Kept as an empty
// export so the Sidebar import stays valid (it renders nothing).
export const DEPARTMENTS = []

export function navFor(user) {
  return NAV.filter((i) => i.show(user))
}

// Grouped sidebar: returns { top: [Dashboard…], sections: [{ label, items }] }.
// Empty sections are dropped so headers never show above nothing.
export function groupedNavFor(user) {
  const visible = navFor(user)
  // Dashboard lives under its own "Overview" heading in the new design, so
  // there is no ungrouped row above the sections any more.
  const top = visible.filter((i) => !i.group)
  const sections = GROUP_ORDER.map((label) => ({
    label,
    items: visible.filter((i) => i.group === label),
  })).filter((s) => s.items.length > 0)
  return { top, sections }
}

export function departmentsFor() {
  return DEPARTMENTS
}

// mobile bottom bar: Dashboard + up to 3 role-relevant + More (opens full menu)
export function mobileNavFor(user) {
  const home = byId('dashboard')
  const middle = []
  if (mgr(user)) middle.push(byId('people'), byId('performance'), byId('payroll'))
  else middle.push(byId('my-hours'), byId('my-reviews'), byId('me'))
  return [home, ...middle.filter(Boolean).slice(0, 3)]
}

function byId(id) {
  return NAV.find((i) => i.id === id)
}
