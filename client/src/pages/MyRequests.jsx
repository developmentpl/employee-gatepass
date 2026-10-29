import { useEffect, useState } from 'react';
import { Plus, Clock, LogOut, LogIn, Send, UserCheck, AlertTriangle, UserPlus } from 'lucide-react';
import { api, fmtTime, todayISO, nowHM } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Modal, Alert, Field, StatusBadge, Tabs, Pagination, Empty, useList, useMeta, useToast } from '../components/ui.jsx';
import { PassModal, shiftText } from '../components/GatePass.jsx';
import EmployeePicker from '../components/EmployeePicker.jsx';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NR_BADGE = {
  awaiting_reason: ['amber', 'Did not return — reason needed'],
  reason_submitted: ['amber', 'Did not return — reason sent'],
  approved: ['', 'Did not return — reason accepted'],
  rejected: ['red', 'Did not return — reason rejected'],
};

export function PassRow({ p, onClick, showEmployee, right }) {
  const [, m, d] = String(p.pass_date).split('-');
  const nr = NR_BADGE[p.nr_status];
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
          <span><Clock size={14} /> Shift {shiftText(p)}</span>
          <span><LogOut size={14} /> Out {fmtTime(p.out_time)}</span>
          <span><LogIn size={14} /> {p.coming_back ? `Back by ${fmtTime(p.expected_in_time)}` : 'Not returning today'}</span>
          {p.decided_by_name && p.status !== 'cancelled' && <span><UserCheck size={14} /> {p.decided_by_name}</span>}
          {p.raised_by_name && <span><UserPlus size={14} /> Raised by {p.raised_by_name}</span>}
        </div>
        <div className="small muted" style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.reason}
          {p.decision_remark && <span style={{ color: p.status === 'rejected' ? 'var(--red)' : undefined }}> · “{p.decision_remark}”</span>}
          {p.nr_reason && <span> · Not returned: “{p.nr_reason}”</span>}
        </div>
      </div>
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        {right}
        {nr ? (
          <span className={`badge ${nr[0]}`}><span className="dot" />{nr[1]}</span>
        ) : (
          p.status === 'approved' && p.gate_status !== 'not_left' && <StatusBadge status={p.gate_status} />
        )}
        <StatusBadge status={p.status} />
      </div>
    </div>
  );
}

/**
 * New gate pass. forOther = admin raising it on behalf of an employee (picks the employee;
 * their department, shift and authorities are used).
 */
export function NewPassModal({ onClose, onCreated, forOther = false }) {
  const { me, user } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const [emp, setEmp] = useState(null); // picked employee (forOther)
  const [info, setInfo] = useState(null); // their details + authorities
  const [f, setF] = useState({
    pass_date: todayISO(),
    shift: forOther ? '' : user.shift || '',
    reason_type: '',
    reason: '',
    out_time: nowHM(15),
    coming_back: true,
    expected_in_time: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!forOther) return;
    setInfo(null);
    if (!emp) return;
    api(`/users/${emp.id}/pass-info`)
      .then((x) => {
        setInfo(x);
        setF((cur) => ({ ...cur, shift: x.shift && meta.shiftList?.some((s) => s.name === x.shift) ? x.shift : cur.shift }));
      })
      .catch((e) => setErr(e.message));
  }, [emp?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = forOther ? info : user;
  const auths = forOther ? info?.authorities || [] : me.authorities || [];
  const noAuth = forOther ? !!info && !auths.length : !auths.length;
  const shift = meta.shiftList?.find((s) => s.name === f.shift);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (forOther && !info) throw new Error('Select the employee first');
      const p = await api('/passes', { method: 'POST', body: forOther ? { ...f, for_user_id: info.id } : f });
      toast(forOther ? `Gate pass ${p.pass_no} raised for ${info.name} and sent for approval` : `Gate pass ${p.pass_no} sent for approval`);
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
      title={forOther ? 'Raise gate pass for an employee' : 'New Employee Gate Pass'}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="newpass" disabled={busy || noAuth || (forOther && !info)}>
            <Send size={16} /> {busy ? 'Sending…' : 'Submit for approval'}
          </button>
        </>
      }
    >
      <form id="newpass" className="stack" onSubmit={submit}>
        {forOther && (
          <Field label="Employee" required hint="The gate pass is raised in this employee's name and goes to their authorities. They are notified.">
            <EmployeePicker value={emp} onChange={setEmp} />
          </Field>
        )}
        {noAuth && (
          <Alert type="warn">
            {forOther
              ? `No active approving authority is assigned to ${info.name}. Set it in User Access Management first.`
              : 'No approving authority is assigned to you yet. Ask the administrator to set it up in User Access Management.'}
          </Alert>
        )}
        {err && <Alert type="error">{err}</Alert>}
        <div className="grid3">
          <Field label="Date" required>
            <input className="input" type="date" min={todayISO()} value={f.pass_date} onChange={set('pass_date')} required />
          </Field>
          <Field label="Employee Name">
            <input className="input" value={who?.name || ''} placeholder={forOther ? 'Select the employee above' : ''} readOnly />
          </Field>
          <Field label="Employee ID">
            <input className="input" value={who?.emp_code || ''} readOnly />
          </Field>
          <Field label="Department">
            <input className="input" value={who ? who.department || '—' : ''} readOnly />
          </Field>
          <Field label="Shift" required hint={shift ? `Shift timing ${fmtTime(shift.start_time)} – ${fmtTime(shift.end_time)}` : forOther ? 'Select the shift' : 'Select your shift'}>
            <select className="input" value={f.shift} onChange={set('shift')} required>
              <option value="">Select…</option>
              {meta.shiftList?.map((s) => (
                <option key={s.name} value={s.name}>{s.name} ({fmtTime(s.start_time)} – {fmtTime(s.end_time)})</option>
              ))}
            </select>
          </Field>
          <Field label="Out Time" required>
            <input className="input" type="time" value={f.out_time} onChange={set('out_time')} required />
          </Field>
        </div>
        <div className="grid3">
          <Field label="Purpose" required>
            <select className="input" value={f.reason_type} onChange={set('reason_type')} required>
              <option value="">Select…</option>
              {meta.reasonTypes.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Reason for going out" required className="span2">
            <input className="input" value={f.reason} onChange={set('reason')} maxLength={500} required placeholder="e.g. Customer visit at Bajaj Auto, Chakan" />
          </Field>
        </div>
        <div className="radio-row">
          <label className={`radio-card ${f.coming_back ? 'on' : ''}`}>
            <input type="radio" checked={f.coming_back} onChange={() => setF({ ...f, coming_back: true })} />
            <span>{forOther ? 'Will come back to the factory today' : 'I will come back to the factory today'}</span>
          </label>
          <label className={`radio-card ${!f.coming_back ? 'on' : ''}`}>
            <input type="radio" checked={!f.coming_back} onChange={() => setF({ ...f, coming_back: false, expected_in_time: '' })} />
            <span>{forOther ? 'Will not come back to the factory today' : 'I will not come to the factory today'}</span>
          </label>
        </div>
        {f.coming_back && (
          <div className="grid3">
            <Field label="Expected time of arrival" required hint={forOther ? 'If they are not back in time, they will be asked for the reason.' : 'If you are not back in time, you will be asked for the reason.'}>
              <input className="input" type="time" value={f.expected_in_time} onChange={set('expected_in_time')} required />
            </Field>
          </div>
        )}
        {!noAuth && auths.length > 0 && (
          <div className="card card-pad" style={{ background: '#fafbfd' }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Goes to {forOther ? 'their' : 'your'} primary authority first. If not answered in time, it is also sent to the next authority.
            </div>
            <div className="row wrap">
              {auths.map((a, i) => (
                <span key={a.level} className="badge blue">{i + 1}. {a.level}: {a.name}</span>
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
  const { summary, refreshSummary, user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [creatingFor, setCreatingFor] = useState(false);
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
        {user.role === 'admin' && (
          <button className="btn" onClick={() => setCreatingFor(true)}>
            <UserPlus size={17} /> Raise for an employee
          </button>
        )}
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={17} /> New Gate Pass
        </button>
      </div>
      {summary.myActions > 0 && list.filters.status !== 'action' && (
        <div className="banner-action">
          <AlertTriangle size={20} color="var(--amber)" />
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>You have not returned to the plant on {summary.myActions === 1 ? 'a gate pass' : `${summary.myActions} gate passes`}.</b>
            <div className="small">Please state the reason. It will be sent to your authorities.</div>
          </div>
          <button className="btn primary sm" onClick={() => list.setFilter('status', 'action')}>State reason</button>
        </div>
      )}
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
              ...(summary.myActions > 0 || list.filters.status === 'action' ? [{ value: 'action', label: 'Reason needed', count: summary.myActions }] : []),
            ]}
          />
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={Clock} text="No requests yet. Click “New Gate Pass” to raise one." />
        ) : (
          <div className="req-list">
            {list.rows.map((p) => (
              <PassRow
                key={p.id}
                p={p}
                onClick={() => setViewId(p.id)}
                right={p.nr_status === 'awaiting_reason' && p.gate_status === 'out' ? <button className="btn sm primary">State reason</button> : null}
              />
            ))}
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
      </div>
      {creating && <NewPassModal onClose={() => setCreating(false)} onCreated={changed} />}
      {creatingFor && <NewPassModal forOther onClose={() => setCreatingFor(false)} onCreated={changed} />}
      {viewId && <PassModal id={viewId} onClose={() => setViewId(null)} onChanged={changed} />}
    </>
  );
}
