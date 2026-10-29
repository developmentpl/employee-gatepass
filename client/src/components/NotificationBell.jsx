import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PassModal } from './GatePass.jsx';

/** Bell with unread count; opens a panel of recent notifications. Clicking one opens its gate pass. */
export default function NotificationBell() {
  const { summary, refreshSummary } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [passId, setPassId] = useState(null);
  const box = useRef(null);

  const load = () => api('/notifications').then(setItems).catch(() => {});
  useEffect(() => {
    if (open) load();
  }, [open]);
  useEffect(() => {
    const onDoc = (e) => open && box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openItem = async (n) => {
    if (!n.is_read) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    setOpen(false);
    refreshSummary();
    if (n.pass_id) setPassId(n.pass_id);
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
    load();
    refreshSummary();
  };

  return (
    <div className="bell" ref={box}>
      <button className="bell-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${summary.unread ? `, ${summary.unread} unread` : ''}`} title="Notifications">
        <Bell size={19} />
        {summary.unread > 0 && <span className="dot-count">{summary.unread > 99 ? '99+' : summary.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bp-head">
            <b>Notifications</b>
            <div className="spacer" />
            {items.some((n) => !n.is_read) && (
              <button className="btn sm ghost" onClick={readAll}>
                <CheckCheck size={15} /> Mark all read
              </button>
            )}
          </div>
          {!items.length && <div className="empty" style={{ padding: 28 }}>No notifications yet</div>}
          {items.map((n) => (
            <button key={n.id} className={`bell-item ${n.is_read ? '' : 'unread'}`} onClick={() => openItem(n)}>
              <div className="t">{n.title}</div>
              {n.body && <div className="b">{n.body}</div>}
              <div className="d">{fmtDateTime(n.created_at)}</div>
            </button>
          ))}
        </div>
      )}
      {passId && <PassModal id={passId} onClose={() => setPassId(null)} onChanged={refreshSummary} />}
    </div>
  );
}
