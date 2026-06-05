import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { AppLayout } from './components/layout/AppLayout.jsx'
import { Spinner } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import Sales from './pages/sales/Sales.jsx'
import CustomerDetail from './pages/sales/CustomerDetail.jsx'
import Pipeline from './pages/sales/Pipeline.jsx'
import Report from './pages/sales/Monthly.jsx'
import DailyTracker from './pages/sales/DailyTracker.jsx'
import Notices from './pages/sales/Notices.jsx'
import Attendance from './pages/Attendance.jsx'
import Leave from './pages/Leave.jsx'
import Pay from './pages/Pay.jsx'
import Profile from './pages/Profile.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Approvals from './pages/manager/Approvals.jsx'
import Team from './pages/manager/Team.jsx'
import Marketing from './pages/departments/Marketing.jsx'
import HRTeam from './pages/departments/HRTeam.jsx'
import AgentProfile from './pages/sales/AgentProfile.jsx'
import DepartmentShell from './pages/departments/DepartmentShell.jsx'
import { TrendingUp, Headphones, DollarSign, Wrench, FileBarChart } from 'lucide-react'

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
function RequireAuth({ children, manager = false, power = null }) {
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
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/sales/c/:id" element={<CustomerDetail />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/report" element={<Report />} />
        <Route path="/day" element={<DailyTracker />} />
        <Route path="/notices" element={<Notices />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/pay" element={<Pay />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route
          path="/approvals"
          element={
            <RequireAuth power="approvals">
              <Approvals />
            </RequireAuth>
          }
        />
        <Route
          path="/team"
          element={
            <RequireAuth power="team">
              <Team />
            </RequireAuth>
          }
        />

        {/* Departments — gated by granted powers; unbuilt shells stay CEO-only. */}
        <Route path="/dept/marketing" element={<RequireAuth power="marketing"><Marketing /></RequireAuth>} />
        <Route path="/dept/sales" element={<RequireAuth power="sales"><DepartmentShell icon={TrendingUp} title="Sales" /></RequireAuth>} />
        <Route path="/dept/customer-service" element={<RequireAuth power="ceo"><DepartmentShell icon={Headphones} title="Customer Service" /></RequireAuth>} />
        <Route path="/dept/finance" element={<RequireAuth power="payroll"><DepartmentShell icon={DollarSign} title="Finance" /></RequireAuth>} />
        <Route path="/dept/hr" element={<RequireAuth power="hr"><HRTeam /></RequireAuth>} />
        <Route path="/agents/:slug" element={<RequireAuth power="sales"><AgentProfile /></RequireAuth>} />
        <Route path="/dept/operations" element={<RequireAuth power="ceo"><DepartmentShell icon={Wrench} title="Operations" /></RequireAuth>} />
        <Route path="/dept/reports" element={<RequireAuth power="ceo"><DepartmentShell icon={FileBarChart} title="Reports" /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
