import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Users, ShieldCheck, ClipboardCheck, ScrollText, Fingerprint, FileText, CheckSquare, DoorOpen, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Avatar } from './ui.jsx';
import { useEffect } from 'react';

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
  const isSecurity = user.role === 'security' || isAdmin;

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="wordmark">HARMAN</div>
          <div className="sub">Employee Gate Pass</div>
        </div>
        <nav className="nav">
          {isAdmin && (
            <>
              <div className="nav-group">Administration</div>
              <Item to="/admin/users" icon={Users} label="User Management" />
              <Item to="/admin/access" icon={ShieldCheck} label="Access Management" />
              <Item to="/admin/approvals" icon={ClipboardCheck} label="Approvals" count={summary.adminPending} />
              <Item to="/admin/logs" icon={ScrollText} label="Logs" />
              <Item to="/admin/attendance" icon={Fingerprint} label="Attendance (eSSL)" />
            </>
          )}
          <div className="nav-group">My Gate Pass</div>
          <Item to="/requests" icon={FileText} label="Requests" count={summary.myPending} />
          {me.isAuthority && <Item to="/approvals" icon={CheckSquare} label="Approvals" count={summary.approvalsPending} />}
          {isSecurity && (
            <>
              <div className="nav-group">Security</div>
              <Item to="/gate" icon={DoorOpen} label="Gate Desk" />
            </>
          )}
        </nav>
        <div className="side-user">
          <NavLink to="/profile" style={{ display: 'contents' }}>
            <Avatar src={user.photo} name={user.name} />
            <div className="who">
              <b>{user.name}</b>
              <span>{user.emp_code} · {user.role === 'user' ? 'Employee' : user.role[0].toUpperCase() + user.role.slice(1)}</span>
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
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
