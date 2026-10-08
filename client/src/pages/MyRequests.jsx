import { useState } from 'react';
import { Plus, Clock, LogOut, LogIn, Send, UserCheck } from 'lucide-react';
import { api, fmtDate, fmtTime, todayISO, nowHM } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Modal, Alert, Field, StatusBadge, Tabs, Pagination, Empty, useList, useMeta, useToast } from '../components/ui.jsx';
import { PassModal } from '../components/GatePass.jsx';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PassRow({ p, onClick, showEmployee, right }) {
  const [, m, d] = String(p.pass_date).split('-');
  return (
    <div className="req" onClick={onClick}>
      <div className="row" style={{ gap: 10 }}>
        {showEmployee && <Avatar src={p.photo} name={p.emp_name} />}
        <div className="date-box">
          <b>{d}</b>
          <span>{MONTH[+m - 1]}</span>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="title">
          {showEmployee ? (
            <>
              {p.emp_name} <span className="muted small">{p.emp_code} · {p.department}</span>
            </>
          ) : (
            p.reason_type
          )}
          <span className="mono muted small">{p.pass_no}</span>
        </div>
        <div className="meta">
          {showEmployee && <span className="badge blue">{p.reason_type}</span>}
          <span><LogOut size={14} /> Out {fmtTime(p.out_time)}</span>
          <span><LogIn size={14} /> {p.coming_back ? `Back by ${fmtTime(p.expected_in_time)}` : 'Not returning today'}</span>
          {p.decided_by_name && p.status !== 'cancelled' && <span><UserCheck size={14} /> {p.decided_by_name}</span>}
        </div>
        <div className="small muted" style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.reason}
          {p.decision_remark && <span style={{ color: p.status === 'rejected' ? 'var(--red)' : undefined }}> · “{p.decision_remark}”</span>}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {right}
        {p.status === 'approved' && p.gate_status !== 'not_left' && <StatusBadge status={p.gate_status} />}
        <StatusBadge status={p.status} />
      </div>
    </div>
  );
}

function NewPassModal({ onClose, onCreated }) {
  const { me, user } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const [f, setF] = useState({
    pass_date: todayISO(),
    reason_type: '',
    reason: '',
    out_time: nowHM(15),
    coming_back: true,
    expected_in_time: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const noAuth = !me.authorities?.length;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const p = await api('/passes', { method: 'POST', body: f });
      toast(`Gate pass ${p.pass_no} sent for approval`);
      onCreated();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New Employee Gate Pass"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="newpass" disabled={busy || noAuth}>
            <Send size={16} /> {busy ? 'Sending…' : 'Submit for approval'}
          </button>
        </>
      }
    >
      <form id="newpass" className="stack" onSubmit={submit}>
        {noAuth && <Alert type="warn">No approving authority is assigned to you yet. Ask the administrator to set it up in Access Management.</Alert>}
        {err && <Alert type="error">{err}</Alert>}
        <div className="grid3">
          <Field label="Date" required>
            <input className="input" type="date" min={todayISO()} value={f.pass_date} onChange={set('pass_date')} required />
          </Field>
          <Field label="Employee Name">
            <input className="input" value={user.name} readOnly />
          </Field>
          <Field label="Employee ID">
            <input className="input" value={user.emp_code} readOnly />
          </Field>
          <Field label="Department">
            <input className="input" value={user.department || '—'} readOnly />
          </Field>
          <Field label="Shift">
            <input className="input" value={user.shift || '—'} readOnly />
          </Field>
          <Field label="Out Time" required>
            <input className="input" type="time" value={f.out_time} onChange={set('out_time')} required />
          </Field>
        </div>
        <div className="grid3">
          <Field label="Reason For Going Out" required>
            <select className="input" value={f.reason_type} onChange={set('reason_type')} required>
              <option value="">Select…</option>
              {meta.reasonTypes.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Details" required className="span2">
            <input className="input" value={f.reason} onChange={set('reason')} maxLength={500} required placeholder="e.g. Customer visit at Bajaj Auto, Chakan" />
          </Field>
        </div>
        <div className="radio-row">
          <label className={`radio-card ${f.coming_back ? 'on' : ''}`}>
            <input type="radio" checked={f.coming_back} onChange={() => setF({ ...f, coming_back: true })} />
            <span>I will come back to the factory today</span>
          </label>
          <label className={`radio-card ${!f.coming_back ? 'on' : ''}`}>
            <input type="radio" checked={!f.coming_back} onChange={() => setF({ ...f, coming_back: false, expected_in_time: '' })} />
            <span>I will not come to the factory today</span>
          </label>
        </div>
        {f.coming_back && (
          <div className="grid3">
            <Field label="Expected time of arrival" required>
              <input className="input" type="time" value={f.expected_in_time} onChange={set('expected_in_time')} required />
            </Field>
          </div>
        )}
        {!noAuth && (
          <div className="card card-pad" style={{ background: '#fafbfd' }}>
            <div className="small muted" style={{ marginBottom: 6 }}>This request goes to all your authorities. The first one to respond decides it.</div>
            <div className="row wrap">
              {me.authorities.map((a) => (
                <span key={a.level} className="badge blue">{a.level}: {a.name}</span>
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

export default function MyRequests() {
  const list = useList('/passes/mine', { status: '' }, 10);
  const { refreshSummary } = useAuth();
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState(null);
  const changed = () => {
    list.reload();
    refreshSummary();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Gate Pass Requests</h1>
          <p>Raise a new gate pass and track its approval.</p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={17} /> New Gate Pass
        </button>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={list.filters.status}
            onChange={(v) => list.setFilter('status', v)}
            items={[
              { value: '', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={Clock} text="No requests yet. Click “New Gate Pass” to raise one." />
        ) : (
          <div className="req-list">
            {list.rows.map((p) => <PassRow key={p.id} p={p} onClick={() => setViewId(p.id)} />)}
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
      </div>
      {creating && <NewPassModal onClose={() => setCreating(false)} onCreated={changed} />}
      {viewId && <PassModal id={viewId} onClose={() => setViewId(null)} onChanged={changed} />}
    </>
  );
}
