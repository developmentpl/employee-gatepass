import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Users, ClipboardCheck, ScrollText, Fingerprint, FileText, CheckSquare, DoorOpen, LogOut, Menu, LayoutDashboard, ShieldCheck, Settings,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Avatar } from './ui.jsx';
import NotificationBell from './NotificationBell.jsx';

const ROLE_LABEL = { user: 'Employee', admin: 'Admin', security: 'Security', security_admin: 'Security admin' };

function Item({ to, icon: Icon, label, count }) {
  return (
    <NavLink to={to}>
      <Icon size={18} />
      <span>{label}</span>
      {count > 0 && <span className="count">{count}</span>}
    </NavLink>
  );
}

export default function Layout() {
  const { me, user, logout, summary } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const isAdmin = user.role === 'admin';
  const isGateLogin = user.role === 'security';
  const isSecAdmin = user.role === 'security_admin';
  const canGate = isGateLogin || isSecAdmin || isAdmin;

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="wordmark">HARMAN</div>
            <div className="sub">Employee Gate Pass</div>
          </div>
          <NotificationBell />
        </div>
        <nav className="nav">
          <Item to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          {isAdmin && (
            <>
              <div className="nav-group">Administration</div>
              <Item to="/admin/users" icon={Users} label="User Access Management" />
              <Item to="/admin/approvals" icon={ClipboardCheck} label="Approvals" count={summary.adminPending} />
              <Item to="/admin/logs" icon={ScrollText} label="Logs" />
              <Item to="/admin/attendance" icon={Fingerprint} label="Attendance (eSSL / Solus)" />
              <Item to="/admin/settings" icon={Settings} label="Settings" />
            </>
          )}
          {!isGateLogin && (
            <>
              <div className="nav-group">My Gate Pass</div>
              <Item to="/requests" icon={FileText} label="Requests" count={summary.myPending} />
              {me.isAuthority && <Item to="/approvals" icon={CheckSquare} label="Approvals" count={summary.approvalsPending} />}
            </>
          )}
          {canGate && (
            <>
              <div className="nav-group">Security</div>
              <Item to="/gate" icon={DoorOpen} label="Gate Desk" count={summary.gateWaiting} />
              {(isSecAdmin || isAdmin) && <Item to="/security" icon={ShieldCheck} label="Security Setup" />}
            </>
          )}
        </nav>
        <div className="side-user">
          <NavLink to="/profile" style={{ display: 'contents' }}>
            <Avatar src={user.photo} name={user.name} />
            <div className="who">
              <b>{user.name}</b>
              <span>{user.emp_code} · {ROLE_LABEL[user.role] || user.role}</span>
            </div>
          </NavLink>
          <button onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <span className="wordmark">HARMAN</span>
          <span style={{ opacity: 0.7, fontSize: 13 }}>Gate Pass</span>
          <div className="spacer" />
          <NotificationBell />
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
