import { Home, Contact, TrendingUp, BarChart3, CalendarCheck, Megaphone, Clock, Palmtree, Wallet, User, ClipboardCheck, Users, Menu } from 'lucide-react'

const SALES_DEPTS = ['Sales', 'Training']
const isSales = (u) => SALES_DEPTS.includes(u?.department)
const isManager = (u) => u?.role === 'manager'

// Full sidebar list (desktop). Each item self-gates via show().
export const NAV = [
  { to: '/', label: 'Home', icon: Home, show: () => true },
  { to: '/sales', label: 'Customers', icon: Contact, show: (u) => isSales(u) || isManager(u) },
  { to: '/pipeline', label: 'Pipeline', icon: TrendingUp, show: (u) => isSales(u) || isManager(u) },
  { to: '/report', label: 'Report', icon: BarChart3, show: (u) => isSales(u) || isManager(u) },
  { to: '/day', label: 'My Day', icon: CalendarCheck, show: (u) => isSales(u) },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, show: isManager },
  { to: '/team', label: 'Team', icon: Users, show: isManager },
  { to: '/attendance', label: 'Hours', icon: Clock, show: () => true },
  { to: '/leave', label: 'Leave', icon: Palmtree, show: () => true },
  { to: '/notices', label: 'Notices', icon: Megaphone, show: () => true },
  { to: '/pay', label: 'Pay', icon: Wallet, show: () => true },
  { to: '/profile', label: 'Me', icon: User, show: () => true },
]

export const MORE = { key: 'more', label: 'More', icon: Menu }

export function navFor(user) {
  return NAV.filter((i) => i.show(user))
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
