import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import MyRequests from './pages/MyRequests.jsx';
import Approvals from './pages/Approvals.jsx';
import GateDesk from './pages/GateDesk.jsx';
import Profile from './pages/Profile.jsx';
import UsersPage from './pages/admin/Users.jsx';
import AccessPage from './pages/admin/Access.jsx';
import AdminApprovals from './pages/admin/AdminApprovals.jsx';
import LogsPage from './pages/admin/Logs.jsx';
import AttendancePage from './pages/admin/Attendance.jsx';

export default function App() {
  const { me, user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (!me) return <Login />;
  if (user.must_change_password) return <ChangePassword forced />;

  const isAdmin = user.role === 'admin';
  const isSecurity = user.role === 'security' || isAdmin;
  const home = isAdmin ? '/admin/users' : user.role === 'security' ? '/gate' : '/requests';

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/requests" element={<MyRequests />} />
        {me.isAuthority && <Route path="/approvals" element={<Approvals />} />}
        {isSecurity && <Route path="/gate" element={<GateDesk />} />}
        <Route path="/profile" element={<Profile />} />
        {isAdmin && (
          <>
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/access" element={<AccessPage />} />
            <Route path="/admin/approvals" element={<AdminApprovals />} />
            <Route path="/admin/logs" element={<LogsPage />} />
            <Route path="/admin/attendance" element={<AttendancePage />} />
          </>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
