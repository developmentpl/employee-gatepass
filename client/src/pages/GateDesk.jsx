import { useEffect, useState, useCallback } from 'react';
import { DoorOpen, LogOut, LogIn, Eye } from 'lucide-react';
import { api, fmtTime, todayISO, fmtDate } from '../api.js';
import { Avatar, Alert, SearchBox, Tabs, Empty, StatusBadge, useToast } from '../components/ui.jsx';
import { PassModal } from '../components/GatePass.jsx';

export default function GateDesk() {
  const [date, setDate] = useState(todayISO());
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [viewId, setViewId] = useState(null);
  const [busy, setBusy] = useState(0);
  const toast = useToast();

  const load = useCallback(() => {
    api('/passes/gate/list', { query: { date, state, search } })
      .then((d) => {
        setRows(d.rows);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  }, [date, state, search]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const mark = async (p, action) => {
    setBusy(p.id);
    try {
      await api(`/passes/gate/${p.id}/${action}`, { method: 'POST' });
      toast(`${p.emp_name} marked ${action.toUpperCase()}`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(0);
    }
  };

  const isToday = date === todayISO();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gate Desk</h1>
          <p>Approved gate passes for {fmtDate(date)}. Mark employees out when they leave and in when they return.</p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={state}
            onChange={setState}
            items={[
              { value: '', label: 'All' },
              { value: 'not_left', label: 'To leave' },
              { value: 'out', label: 'Out of plant' },
              { value: 'returned', label: 'Returned' },
            ]}
          />
          <div className="spacer" />
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} />
          <SearchBox value={search} onChange={setSearch} placeholder="Name, ID or pass no." />
        </div>
        {err && <div className="card-pad"><Alert type="error">{err}</Alert></div>}
        {!rows.length ? (
          <Empty icon={DoorOpen} text="No approved gate passes match." />
        ) : (
          <div className="gate-grid">
            {rows.map((p) => (
              <div key={p.id} className="gate-card">
                <Avatar src={p.photo} name={p.emp_name} size="lg" />
                <div className="info">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="nm">{p.emp_name}</span>
                    <StatusBadge status={p.gate_status} />
                  </div>
                  <div className="small muted">{p.emp_code} · {p.department} · <span className="mono">{p.pass_no}</span></div>
                  <div className="times">
                    <span>Planned out: <b>{fmtTime(p.out_time)}</b></span>
                    <span>Expected in: <b>{p.coming_back ? fmtTime(p.expected_in_time) : 'Not returning'}</b></span>
                    <span>Actual out: <b>{p.actual_out ? fmtTime(p.actual_out) : '—'}</b></span>
                    <span>Actual in: <b>{p.actual_in ? fmtTime(p.actual_in) : '—'}</b></span>
                  </div>
                  <div className="small" style={{ marginBottom: 8 }}>
                    <span className="badge blue">{p.reason_type}</span> <span className="muted">Approved by {p.decided_by_name}</span>
                  </div>
                  <div className="row">
                    {p.gate_status === 'not_left' && (
                      <button className="btn sm primary" disabled={busy === p.id || !isToday} onClick={() => mark(p, 'out')}>
                        <LogOut size={15} /> Mark Out
                      </button>
                    )}
                    {p.gate_status === 'out' && (
                      <button className="btn sm success" disabled={busy === p.id} onClick={() => mark(p, 'in')}>
                        <LogIn size={15} /> Mark In
                      </button>
                    )}
                    <button className="btn sm ghost" onClick={() => setViewId(p.id)}>
                      <Eye size={15} /> View pass
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {viewId && <PassModal id={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}
