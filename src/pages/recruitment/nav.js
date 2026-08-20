import { LayoutDashboard, Users, ClipboardCheck, CalendarDays, Briefcase, FileQuestion, BarChart3, Settings } from 'lucide-react'

// Recruitment is its own department inside Pulse (Adama, 20 Aug 2026): you go
// into it and the sidebar becomes hiring's own pages, the way admin's sections
// work. Not tabs — a page buried in a tab is a page nobody opens.
export const RECRUITMENT_NAV = [
  { id: 'r-dashboard', to: '/recruitment', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'r-applicants', to: '/recruitment/applicants', label: 'Applicants', icon: Users },
  { id: 'r-interviews', to: '/recruitment/interviews', label: 'Interviews', icon: ClipboardCheck },
  { id: 'r-calendar', to: '/recruitment/calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'r-positions', to: '/recruitment/positions', label: 'Positions', icon: Briefcase },
  { id: 'r-templates', to: '/recruitment/templates', label: 'Templates', icon: FileQuestion },
  { id: 'r-reports', to: '/recruitment/reports', label: 'Reports', icon: BarChart3 },
  { id: 'r-settings', to: '/recruitment/settings', label: 'Settings', icon: Settings },
]
