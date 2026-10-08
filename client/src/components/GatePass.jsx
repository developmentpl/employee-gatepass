import { useEffect, useState } from 'react';
import { Printer, Check, X, Ban, Fingerprint } from 'lucide-react';
import { api, fmtDate, fmtTime, fmtDateTime } from '../api.js';
import { Avatar, Modal, Alert, Field, useToast } from './ui.jsx';

const LEVEL = { primary: 'Primary', secondary: 'Secondary', third: 'Third', admin: 'Admin' };

/** Digital version of the paper "Employee Gate Pass" form. */
export function GatePassDoc({ p }) {
  const decider = p.status === 'approved' || p.status === 'rejected';
  return (
    <div className="pass">
      <div className="pass-head">
        <div className="logo-word">HARMAN</div>
        <div className="co">
          <h2>HARMAN INTERNATIONAL (INDIA) PVT. LTD.</h2>
          <div>Gat No. 339/1/1B Village Mahalunge, Tal-Khed, Dist-Pune 410501</div>
        </div>
        <div className="no">
          <div className="muted">Pass No.</div>
          <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{p.pass_no}</div>
        </div>
      </div>
      <div className="pass-title">Employee Gate Pass</div>
      <div className="pass-body">
        <div className="pass-fields">
          <div className="pf"><div className="k">Date</div><div className="v">{fmtDate(p.pass_date)}</div></div>
          <div className="pf"><div className="k">Employee ID</div><div className="v">{p.emp_code}</div></div>
          <div className="pf full"><div className="k">Employee Name</div><div className="v">{p.emp_name}</div></div>
          <div className="pf"><div className="k">Department</div><div className="v">{p.department || '—'}</div></div>
          <div className="pf"><div className="k">Shift</div><div className="v">{p.shift || '—'}</div></div>
          <div className="pf full">
            <div className="k">Reason for going out</div>
            <div className="v">
              <span className="badge blue" style={{ marginRight: 6 }}>{p.reason_type}</span>
              {p.reason}
            </div>
          </div>
          <div className="pf"><div className="k">Out time</div><div className="v">{fmtTime(p.out_time)}</div></div>
          <div className="pf">
            <div className="k">Returning</div>
            <div className="v">{p.coming_back ? 'I will come back today' : 'I will not come to the factory today'}</div>
          </div>
          {!!p.coming_back && (
            <div className="pf"><div className="k">Expected time of arrival</div><div className="v">{fmtTime(p.expected_in_time)}</div></div>
          )}
          {p.decision_remark && (
            <div className="pf full"><div className="k">Authority remark</div><div className="v">{p.decision_remark}</div></div>
          )}
        </div>
        <div className="pass-side">
          <Avatar src={p.photo} name={p.emp_name} size="xl" />
          <div className={`stamp ${p.status}`}>{p.status.toUpperCase()}</div>
        </div>
      </div>
      <div className="pass-security">
        <span className="muted">For Security Personnel —</span>
        <span>Out: <b>{p.actual_out ? fmtTime(p.actual_out) : '—'}</b>{p.out_marked_by ? <span className="muted"> ({p.out_marked_by})</span> : null}</span>
        <span>In: <b>{p.actual_in ? fmtTime(p.actual_in) : '—'}</b>{p.in_marked_by ? <span className="muted"> ({p.in_marked_by})</span> : null}</span>
      </div>
      <div className="pass-signs">
        <div>
          <div className="k">Employee</div>
          <div className="sig">{p.emp_name}</div>
          <div className="small muted">Requested {fmtDateTime(p.created_at)}</div>
        </div>
        <div>
          <div className="k">Authority (HOD)</div>
          {decider ? (
            <>
              <div className="sig" style={{ color: p.status === 'approved' ? 'var(--green)' : 'var(--red)' }}>
                {p.status === 'approved' ? 'Approved' : 'Rejected'} by {p.decided_by_name}
              </div>
              <div className="small muted">{LEVEL[p.decided_level] || ''} · {fmtDateTime(p.decided_at)}</div>
            </>
          ) : p.approvers ? (
            <div className="approver-list">
              {p.approvers.map((a) => (
                <div key={a.approver_id} className="ap">
                  <span className="badge">{LEVEL[a.level]}</span> {a.name}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Awaiting</div>
          )}
        </div>
        <div>
          <div className="k">Security</div>
          <div className="sig">{p.out_marked_by || <span className="muted">—</span>}</div>
          {p.actual_out && <div className="small muted">Gate out {fmtDateTime(p.actual_out)}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Loads a pass by id and shows it with the actions the current user is allowed:
 * approve / reject (authority or admin) or cancel (requester).
 */
export function PassModal({ id, onClose, onChanged }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // 'reject'
  const toast = useToast();

  useEffect(() => {
    api(`/passes/${id}`).then(setP).catch((e) => setErr(e.message));
  }, [id]);

  const decide = async (decision) => {
    if (decision === 'rejected' && !remark.trim()) {
      setMode('reject');
      return toast('Please write the reason for rejection', 'error');
    }
    setBusy(true);
    try {
      await api(`/passes/${id}/decision`, { method: 'POST', body: { decision, remark } });
      toast(decision === 'approved' ? 'Gate pass approved' : 'Gate pass rejected');
      onChanged?.();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
      api(`/passes/${id}`).then(setP).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api(`/passes/${id}/cancel`, { method: 'POST' });
      toast('Request cancelled');
      onChanged?.();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const footer = p && (
    <>
      <button className="btn ghost no-print" onClick={() => window.print()}>
        <Printer size={16} /> Print
      </button>
      <div className="spacer" />
      {p.canCancel && (
        <button className="btn" onClick={cancel} disabled={busy}>
          <Ban size={16} /> Cancel request
        </button>
      )}
      {p.canDecide && (
        <>
          <button className="btn danger" onClick={() => decide('rejected')} disabled={busy}>
            <X size={16} /> Reject
          </button>
          <button className="btn success" onClick={() => decide('approved')} disabled={busy}>
            <Check size={16} /> Approve
          </button>
        </>
      )}
      {!p.canCancel && !p.canDecide && <button className="btn" onClick={onClose}>Close</button>}
    </>
  );

  return (
    <Modal title={p ? `Gate Pass · ${p.emp_name}` : 'Gate Pass'} onClose={onClose} size="wide" footer={footer}>
      {err && <Alert type="error">{err}</Alert>}
      {!p && !err && <div className="empty">Loading…</div>}
      {p && (
        <div className="stack">
          <div className="print-area">
            <GatePassDoc p={p} />
          </div>
          {(p.canDecide || p.punches?.length > 0) && (
            <div className="grid2 no-print">
              <div className="card card-pad">
                <div className="row" style={{ marginBottom: 8 }}>
                  <Fingerprint size={16} />
                  <b>Attendance on {fmtDate(p.pass_date)}</b>
                </div>
                {p.punches?.length ? (
                  <div className="timeline">
                    {p.punches.map((x) => (
                      <div key={x.punch_time} className="row">
                        <span className="mono">{fmtTime(x.punch_time)}</span>
                        {x.direction !== 'unknown' && <span className={`badge ${x.direction === 'in' ? 'green' : 'amber'}`}>{x.direction.toUpperCase()}</span>}
                        <span className="muted small">via {x.source}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No punches recorded yet.</div>
                )}
              </div>
              {p.canDecide && (
                <Field label={mode === 'reject' ? 'Reason for rejection' : 'Remark'} required={mode === 'reject'} hint="Required when rejecting; shown to the employee.">
                  <textarea className="input" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={500} placeholder="e.g. Please go after the line audit at 4 PM" />
                </Field>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
