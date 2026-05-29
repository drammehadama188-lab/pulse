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
import Approvals from './pages/manager/Approvals.jsx'
import Team from './pages/manager/Team.jsx'

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={30} />
    </div>
  )
}

function RequireAuth({ children, manager = false }) {
  const { user, loading, isManager } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
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
        <Route
          path="/approvals"
          element={
            <RequireAuth manager>
              <Approvals />
            </RequireAuth>
          }
        />
        <Route
          path="/team"
          element={
            <RequireAuth manager>
              <Team />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
