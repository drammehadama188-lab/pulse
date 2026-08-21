import { useAuth } from '../context/AuthContext.jsx'
import Home from './Home.jsx'
import HrDashboard from './HrDashboard.jsx'

// The landing page is role-aware:
//  • CEO / anyone with the 'hr' power → the HR control-centre overview
//    (headcount, payroll, attention, probation & training countdown).
//  • Everyone else → their personal staff Home (greeting, check-in, focus).
// 22 Jun 2026 (Adama's request): turns the owner's landing into a control
// centre instead of looking like a staff page. The extra live tiles he asked
// for (Active today, On leave, Pending approvals, Upcoming reviews) land in
// Phase 2 on top of this overview.
export default function Dashboard() {
  const { hasPower } = useAuth()
  if (hasPower('hr')) {
    // 20 Aug 2026: the HR landing is its own page now, in the design Adama
    // sent — five tiles, what needs a decision, who is in today, development
    // and activity. It reads one endpoint instead of mounting a slice of the
    // Employees page.
    return <HrDashboard />
  }
  return <Home />
}
