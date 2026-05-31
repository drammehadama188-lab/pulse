import { Home, Contact, TrendingUp, BarChart3, CalendarCheck, Megaphone, Clock, Palmtree, Wallet, User, ClipboardCheck, Users, Menu, Headphones, DollarSign, IdCard, Wrench, FileBarChart } from 'lucide-react'

const SALES_DEPTS = ['Sales', 'Training']
const isSales = (u) => SALES_DEPTS.includes(u?.department)
const isManager = (u) => u?.role === 'manager'
const isOwner = (u) => u?.username === 'adama' // CEO/owner — no self-service (leave, clock-in…)

// Full sidebar list (desktop). Each item self-gates via show().
export const NAV = [
  { to: '/', label: 'Home', icon: Home, show: () => true },
  { to: '/sales', label: 'Customers', icon: Contact, show: (u) => isSales(u) },
  { to: '/pipeline', label: 'Pipeline', icon: TrendingUp, show: (u) => isSales(u) },
  { to: '/report', label: 'Report', icon: BarChart3, show: (u) => isSales(u) },
  { to: '/day', label: 'My Day', icon: CalendarCheck, show: (u) => isSales(u) },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, show: isManager },
  { to: '/team', label: 'Team', icon: Users, show: isManager },
  { to: '/attendance', label: 'Hours', icon: Clock, show: () => true },
  { to: '/leave', label: 'Leave', icon: Palmtree, show: (u) => !isOwner(u) },
  { to: '/notices', label: 'Notices', icon: Megaphone, show: () => true },
  { to: '/pay', label: 'Pay', icon: Wallet, show: () => true },
  { to: '/profile', label: 'Me', icon: User, show: () => true },
]

export const MORE = { key: 'more', label: 'More', icon: Menu }

// Departments — the management layer. Manager-only. Lives under /dept/* so it
// never collides with the staff-facing pages above. Built fresh, one at a time;
// `ready:false` renders a clean "being set up" shell.
export const DEPARTMENTS = [
  { to: '/dept/sales', label: 'Sales', icon: TrendingUp, ready: false },
  { to: '/dept/customer-service', label: 'Customer Service', icon: Headphones, ready: false },
  { to: '/dept/finance', label: 'Finance', icon: DollarSign, ready: false },
  { to: '/dept/hr', label: 'HR & Team', icon: IdCard, ready: false },
  { to: '/dept/operations', label: 'Operations', icon: Wrench, ready: false },
  { to: '/dept/marketing', label: 'Marketing', icon: Megaphone, ready: true },
  { to: '/dept/reports', label: 'Reports', icon: FileBarChart, ready: false },
]

export function navFor(user) {
  return NAV.filter((i) => i.show(user))
}

export function departmentsFor(user) {
  return isManager(user) ? DEPARTMENTS : []
}

// mobile bottom bar: Home + up to 3 role-relevant + More (opens full menu)
export function mobileNavFor(user) {
  const home = NAV.find((i) => i.to === '/')
  const middle = []
  if (isSales(user)) middle.push(byPath('/sales'), byPath('/report'))
  if (isManager(user)) middle.push(byPath('/approvals'), byPath('/team'))
  middle.push(byPath('/attendance'))
  return [home, ...middle.filter(Boolean).slice(0, 3)]
}

function byPath(p) {
  return NAV.find((i) => i.to === p)
}
