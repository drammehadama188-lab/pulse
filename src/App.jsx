import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { AppLayout } from './components/layout/AppLayout.jsx'
import { Spinner } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import SetPassword from './pages/SetPassword.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Sales from './pages/sales/Sales.jsx'
import CustomerDetail from './pages/sales/CustomerDetail.jsx'
import Pipeline from './pages/sales/Pipeline.jsx'
import Report from './pages/sales/Monthly.jsx'
import DailyTracker from './pages/sales/DailyTracker.jsx'
import Notices from './pages/sales/Notices.jsx'
import MyReviews from './pages/MyReviews.jsx'
import MyProgress from './pages/MyProgress.jsx'
import TeamDashboard from './pages/TeamDashboard.jsx'
import MyWeek from './pages/MyWeek.jsx'
import WorkdayMonitor from './pages/WorkdayMonitor.jsx'
import TeamMember from './pages/TeamMember.jsx'
import Attendance from './pages/Attendance.jsx'
import Leave from './pages/Leave.jsx'
import Pay from './pages/Pay.jsx'
import Profile from './pages/Profile.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Approvals from './pages/manager/Approvals.jsx'
import Reports from './pages/Reports.jsx'
import Team from './pages/manager/Team.jsx'
import HRTeam from './pages/departments/HRTeam.jsx'
import EmployeeProfile from './pages/EmployeeProfile.jsx'
import Recruitment from './pages/Recruitment.jsx'
import Performance from './pages/Performance.jsx'
import PerformancePerson from './pages/PerformancePerson.jsx'
import Contracts from './pages/Contracts.jsx'
import PastStaffProfile from './pages/PastStaffProfile.jsx'
import ReviewsWarnings from './pages/ReviewsWarnings.jsx'
import KpiTargets from './pages/KpiTargets.jsx'
import StaffMember from './pages/StaffMember.jsx'
import DepartmentShell from './pages/departments/DepartmentShell.jsx'
import Policies from './pages/departments/Policies.jsx'
import MyDocuments from './pages/MyDocuments.jsx'
import { Target, Gift, BookOpen, FolderOpen } from 'lucide-react'

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={30} />
    </div>
  )
}

// Route gate. `power` names a granted access power (server POWERS list);
// power="ceo" marks CEO-only pages (unbuilt department shells). The legacy
// `manager` prop now means holding the Team power. The server independently
// enforces every check per request — this is presentation only.
function RequireAuth({ children, manager = false, power = null, teamLead = false }) {
  const { user, realUser, loading, isManager, hasPower } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  // First sign-in: nothing works until the starter password is replaced.
  if (realUser?.mustChangePassword && location.pathname !== '/change-password')
    return <Navigate to="/change-password" replace />
  if (power === 'ceo' && user?.username !== 'adama') return <Navigate to="/" replace />
  if (power && power !== 'ceo' && !hasPower(power)) return <Navigate to="/" replace />
  if (manager && !isManager) return <Navigate to="/" replace />
  if (teamLead && !user?.isTeamLead) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <FullScreenLoader /> : user ? <Navigate to="/" replace /> : <Login />}
      />
      {/* Public — reached from the emailed set-password link; the token is the auth. */}
      <Route path="/set-password" element={<SetPassword />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        {/* Landing — role-aware: CEO/HR see the control-centre overview, staff see personal Home. */}
        <Route path="/" element={<Dashboard />} />
        {/* 12 Jun 2026 (Adama's request): Sales cleared out of Pulse (HR-only).
            These paths now redirect Home; the Sales page components remain on
            disk but unrouted. Customer/sales DATA is kept for the admin transfer. */}
        <Route path="/sales" element={<Navigate to="/" replace />} />
        <Route path="/sales/c/:id" element={<Navigate to="/" replace />} />
        <Route path="/pipeline" element={<Navigate to="/" replace />} />
        <Route path="/report" element={<Navigate to="/" replace />} />
        <Route path="/day" element={<Navigate to="/" replace />} />

        {/* ── HR control centre (22 Jun 2026, Adama's request) ──────────────
            The old single "HR & Team" page (8 buried tabs) is dissolved into
            first-class sectioned pages. Each focused page mounts a slice of
            HRTeam via `only={…}`. Ready/adapt screens wired to real content;
            new ones (Goals & Reviews, Benefits, Policies, Documents) render a
            clean "being set up" shell to be filled in Phase 2. */}
        {/* PEOPLE */}
        <Route path="/people" element={<RequireAuth power="hr"><HRTeam only={['roster', 'contracts', 'past', 'warnings']} title="Employees & Records" subtitle="Your team — roster, past staff and records" /></RequireAuth>} />
        <Route path="/performance" element={<RequireAuth power="hr"><Performance /></RequireAuth>} />
        <Route path="/performance/:slug" element={<RequireAuth power="hr"><PerformancePerson /></RequireAuth>} />
        <Route path="/past/:slug" element={<RequireAuth power="hr"><PastStaffProfile /></RequireAuth>} />
        <Route path="/contracts" element={<Navigate to="/people?tab=contracts" replace />} />
        <Route path="/recruitment" element={<RequireAuth power="hr"><Recruitment /></RequireAuth>} />
        {/* MANAGEMENT */}
        <Route path="/reviews" element={<RequireAuth power="hr"><ReviewsWarnings /></RequireAuth>} />
        {/* KPI Targets — CEO sets the company's goals here; Pulse scorecards
            and Admin's goal numbers follow (Adama 3 Jul). */}
        <Route path="/kpi-targets" element={<RequireAuth power="ceo"><KpiTargets /></RequireAuth>} />
        <Route path="/requests" element={<RequireAuth power="approvals"><Approvals /></RequireAuth>} />
        {/* Reports self-composes on the server from the viewer's powers. */}
        <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
        <Route path="/records" element={<RequireAuth power="hr"><HRTeam only={['warnings']} title="Employee Records" subtitle="Warnings, disciplinary actions and notes" /></RequireAuth>} />
        {/* PAYROLL */}
        <Route path="/payroll" element={<RequireAuth power="payroll"><HRTeam only={['payroll']} title="Payroll" subtitle="Salaries, commission and payroll history" /></RequireAuth>} />
        <Route path="/benefits" element={<RequireAuth power="payroll"><DepartmentShell icon={Gift} title="Benefits" subtitle="Payroll" blurb="Allowances, bonuses and staff benefits. Being set up — coming online here soon." /></RequireAuth>} />
        {/* COMPANY */}
        <Route path="/policies" element={<Policies />} />
        <Route path="/documents" element={<RequireAuth power="hr"><DepartmentShell icon={FolderOpen} title="Documents" subtitle="Company" blurb="Contracts, IDs and employee documents. Being set up — coming online here soon." /></RequireAuth>} />

        {/* Personal self-service */}
        {/* Notices repurposed → My Reviews (staff self-view) on 12 Jun 2026. */}
        <Route path="/my-reviews" element={<MyReviews />} />
        <Route path="/my-progress" element={<MyProgress />} />
        <Route path="/team-dashboard" element={<RequireAuth teamLead><TeamDashboard /></RequireAuth>} />
        <Route path="/my-week" element={<RequireAuth teamLead><MyWeek /></RequireAuth>} />
        <Route path="/workday-monitor" element={<RequireAuth power="hr"><WorkdayMonitor /></RequireAuth>} />
        <Route path="/team-member/:username" element={<RequireAuth teamLead><TeamMember /></RequireAuth>} />
        {/* MY TEAM — existing pages reused, scoped to the lead's own team (Adama 1 Jul). */}
        <Route path="/team-requests" element={<RequireAuth teamLead><Approvals scope="team" /></RequireAuth>} />
        <Route path="/team-schedule" element={<RequireAuth teamLead><Attendance scope="team" /></RequireAuth>} />
        <Route path="/team-reviews" element={<RequireAuth teamLead><ReviewsWarnings scope="team" /></RequireAuth>} />
        <Route path="/notices" element={<Navigate to="/my-reviews" replace />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/pay" element={<Pay />} />
        <Route path="/my-documents" element={<MyDocuments />} />
        <Route path="/me" element={<Profile />} />
        <Route path="/profile" element={<Navigate to="/me" replace />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/approvals" element={<RequireAuth power="approvals"><Approvals /></RequireAuth>} />
        <Route path="/team" element={<RequireAuth power="staffadmin"><Team /></RequireAuth>} />
        <Route path="/staff/:username" element={<RequireAuth power="staffadmin"><StaffMember /></RequireAuth>} />

        {/* Back-compat: the old bundled HR page + its deep links still resolve. */}
        <Route path="/dept/hr" element={<RequireAuth power="hr"><HRTeam /></RequireAuth>} />
        <Route path="/dept/marketing" element={<Navigate to="/" replace />} />
        {/* Staff profile — opened from the roster/performance pages. */}
        <Route path="/agents/:slug" element={<RequireAuth power="hr"><EmployeeProfile /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
