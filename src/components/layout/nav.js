import {
  LayoutDashboard, Users, TrendingUp, Clock, FileText, Target,
  ClipboardCheck, ShieldAlert, Wallet, Gift, BookOpen, FolderOpen,
  Palmtree, User, Menu, UserPlus, ShieldCheck, BarChart3,
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
  { id: 'dashboard', to: '/', label: 'Dashboard', icon: LayoutDashboard, group: null, show: () => true },

  // PEOPLE — the roster, performance and contracts (management view).
  // "Employees & Records" folds the old standalone "Employee Records" (warnings)
  // in as a tab (24 Jun 2026, Adama) so there's no duplicate nav item.
  { id: 'people', to: '/people', label: 'Employees & Records', icon: Users, group: 'People', show: mgr },
  { id: 'performance', to: '/performance', label: 'Performance', icon: TrendingUp, group: 'People', show: mgr },
  { id: 'attendance-mgr', to: '/attendance', label: 'Attendance', icon: Clock, group: 'People', show: mgr },
  { id: 'recruitment', to: '/recruitment', label: 'Recruitment', icon: UserPlus, group: 'People', show: mgr },
  { id: 'staff', to: '/team', label: 'Staff', icon: ShieldCheck, group: 'People', show: (u) => has(u, 'staffadmin') },

  // MANAGEMENT — goals, incoming requests, the employee record
  // KPI Targets = where the company's goals are SET (CEO-only; Adama 3 Jul —
  // "Pulse should be responsible for changing the goals and it reflects in
  // admin"). Scorecards + Admin's goal numbers all read from it.
  { id: 'kpi-targets', to: '/kpi-targets', label: 'KPI Targets', icon: Target, group: 'Management', show: isOwner },
  { id: 'reviews', to: '/reviews', label: 'Reviews & Warnings', icon: ShieldAlert, group: 'Management', show: mgr },
  // Hidden for a team lead whose approvals stay inside their own team — Team
  // Requests already covers those, so this would be a duplicate page.
  { id: 'requests', to: '/requests', label: 'Requests', icon: ClipboardCheck, group: 'Management', show: (u) => has(u, 'approvals') && !(u?.isTeamLead && u?.approvalsBeyondTeam === false) },
  // Reports composes server-side from whichever powers the person holds.
  { id: 'workday-monitor', to: '/workday-monitor', label: 'Team Workday', icon: Target, group: 'Management', show: mgr },
  { id: 'reports', to: '/reports', label: 'Reports', icon: BarChart3, group: 'Management', show: (u) => ['team', 'approvals', 'payroll', 'hr'].some((p) => has(u, p)) },
  // 'records' (Employee Records / warnings) merged into "Employees & Records" tab.

  // PAYROLL
  { id: 'payroll', to: '/payroll', label: 'Payroll', icon: Wallet, group: 'Payroll', show: (u) => has(u, 'payroll') },
  { id: 'benefits', to: '/benefits', label: 'Benefits', icon: Gift, group: 'Payroll', show: (u) => has(u, 'payroll') },

  // COMPANY
  { id: 'policies', to: '/policies', label: 'Policies', icon: BookOpen, group: 'Company', show: mgr },
  { id: 'documents', to: '/documents', label: 'Documents', icon: FolderOpen, group: 'Company', show: mgr },

  // MY TEAM — a team lead's scoped workspace over the people they manage (NOT the
  // whole company). Gated on isTeamLead (server-computed); pages re-check scope.
  { id: 'my-week', to: '/my-week', label: 'My Workday', icon: Target, group: 'My team', show: (u) => u?.isTeamLead },
  { id: 'reports-lead', to: '/reports?tab=weekly', label: 'Reports', icon: BarChart3, group: 'My team', show: (u) => u?.isTeamLead && !has(u, 'hr') },
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
const GROUP_ORDER = ['People', 'Management', 'My work', 'My team', 'Payroll', 'Pay', 'Company', 'Personal']

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
