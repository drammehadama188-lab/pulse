import {
  LayoutDashboard, Users, TrendingUp, Clock, FileText, Target,
  ClipboardCheck, ShieldAlert, Wallet, Gift, BookOpen, FolderOpen,
  Palmtree, User, Menu,
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
  { id: 'contracts', to: '/contracts', label: 'Contracts', icon: FileText, group: 'People', show: mgr },

  // MANAGEMENT — goals, incoming requests, the employee record
  { id: 'reviews', to: '/reviews', label: 'Goals & Reviews', icon: Target, group: 'Management', show: mgr },
  { id: 'requests', to: '/requests', label: 'Requests', icon: ClipboardCheck, group: 'Management', show: (u) => has(u, 'approvals') || has(u, 'team') },
  // 'records' (Employee Records / warnings) merged into "Employees & Records" tab.

  // PAYROLL
  { id: 'payroll', to: '/payroll', label: 'Payroll', icon: Wallet, group: 'Payroll', show: (u) => has(u, 'payroll') },
  { id: 'benefits', to: '/benefits', label: 'Benefits', icon: Gift, group: 'Payroll', show: (u) => has(u, 'payroll') },

  // COMPANY
  { id: 'policies', to: '/policies', label: 'Policies', icon: BookOpen, group: 'Company', show: mgr },
  { id: 'documents', to: '/documents', label: 'Documents', icon: FolderOpen, group: 'Company', show: mgr },

  // PERSONAL — self-service. Staff (no 'hr' power) get their own Attendance here;
  // managers reach the team view via the PEOPLE section instead.
  { id: 'my-hours', to: '/attendance', label: 'My Hours', icon: Clock, group: 'Personal', show: (u) => !mgr(u) },
  { id: 'my-leave', to: '/leave', label: 'Leave', icon: Palmtree, group: 'Personal', show: (u) => !isOwner(u) },
  { id: 'my-reviews', to: '/my-reviews', label: 'My Reviews', icon: FileText, group: 'Personal', show: (u) => !mgr(u) },
  { id: 'my-pay', to: '/pay', label: 'Pay', icon: Wallet, group: 'Personal', show: (u) => !mgr(u) },
  { id: 'me', to: '/me', label: 'Me', icon: User, group: 'Personal', show: () => true },
]

// Section order for the grouped sidebar.
const GROUP_ORDER = ['People', 'Management', 'Payroll', 'Company', 'Personal']

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
