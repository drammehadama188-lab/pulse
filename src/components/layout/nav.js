import { Home, Contact, TrendingUp, BarChart3, CalendarCheck, Megaphone, Clock, Palmtree, Wallet, User, ClipboardCheck, Users, Menu, Headphones, DollarSign, IdCard, Wrench, FileBarChart } from 'lucide-react'

const SALES_DEPTS = ['Sales', 'Training']
const isSales = (u) => SALES_DEPTS.includes(u?.department)
const isOwner = (u) => u?.username === 'adama' // CEO/owner — no self-service (leave, clock-in…)
// Access comes from per-person power grants (CEO holds all). 'manager' is
// just a title now — it unlocks nothing by itself.
const has = (u, p) => (u?.powers || []).includes(p)

// Full sidebar list (desktop). Each item self-gates via show().
// `group` buckets items into labelled sidebar sections (Home sits on top,
// ungrouped). GROUP_ORDER below sets the section order + which headers show.
export const NAV = [
  { to: '/', label: 'Home', icon: Home, group: null, show: () => true },
  { to: '/sales', label: 'Customers', icon: Contact, group: 'Sales', show: (u) => isSales(u) },
  { to: '/pipeline', label: 'Pipeline', icon: TrendingUp, group: 'Sales', show: (u) => isSales(u) },
  { to: '/report', label: 'Report', icon: BarChart3, group: 'Sales', show: (u) => isSales(u) },
  { to: '/day', label: 'My Day', icon: CalendarCheck, group: 'Sales', show: (u) => isSales(u) },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, group: 'Manage', show: (u) => has(u, 'approvals') },
  { to: '/team', label: 'Team', icon: Users, group: 'Manage', show: (u) => has(u, 'team') },
  { to: '/attendance', label: 'Hours', icon: Clock, group: 'Personal', show: () => true },
  { to: '/leave', label: 'Leave', icon: Palmtree, group: 'Personal', show: (u) => !isOwner(u) },
  { to: '/notices', label: 'Notices', icon: Megaphone, group: 'Personal', show: () => true },
  { to: '/pay', label: 'Pay', icon: Wallet, group: 'Personal', show: () => true },
  { to: '/profile', label: 'Me', icon: User, group: 'Personal', show: () => true },
]

// Section order for the grouped sidebar.
const GROUP_ORDER = ['Sales', 'Manage', 'Personal']

export const MORE = { key: 'more', label: 'More', icon: Menu }

// Departments — the management layer. Manager-only. Lives under /dept/* so it
// never collides with the staff-facing pages above. Built fresh, one at a time;
// `ready:false` renders a clean "being set up" shell.
// `power` decides who sees each department. Shells without a power yet
// (not built, no owner decided) stay CEO-only.
export const DEPARTMENTS = [
  { to: '/dept/sales', label: 'Sales', icon: TrendingUp, ready: false, power: 'sales' },
  { to: '/dept/customer-service', label: 'Customer Service', icon: Headphones, ready: false, power: null },
  { to: '/dept/finance', label: 'Finance', icon: DollarSign, ready: false, power: 'payroll' },
  { to: '/dept/hr', label: 'HR & Team', icon: IdCard, ready: true, power: 'hr' },
  { to: '/dept/operations', label: 'Operations', icon: Wrench, ready: false, power: null },
  { to: '/dept/marketing', label: 'Marketing', icon: Megaphone, ready: true, power: 'marketing' },
  { to: '/dept/reports', label: 'Reports', icon: FileBarChart, ready: false, power: null },
]

export function navFor(user) {
  return NAV.filter((i) => i.show(user))
}

// Grouped sidebar: returns { top: [Home…], sections: [{ label, items }] }.
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

export function departmentsFor(user) {
  return DEPARTMENTS.filter((d) => (d.power ? has(user, d.power) : isOwner(user)))
}

// mobile bottom bar: Home + up to 3 role-relevant + More (opens full menu)
export function mobileNavFor(user) {
  const home = NAV.find((i) => i.to === '/')
  const middle = []
  if (isSales(user)) middle.push(byPath('/sales'), byPath('/report'))
  if (has(user, 'approvals')) middle.push(byPath('/approvals'))
  if (has(user, 'team')) middle.push(byPath('/team'))
  middle.push(byPath('/attendance'))
  return [home, ...middle.filter(Boolean).slice(0, 3)]
}

function byPath(p) {
  return NAV.find((i) => i.to === p)
}
