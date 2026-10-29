import { useEffect, useState } from 'react';
import { Printer, Check, X, Ban, Send, MessageSquareWarning, Route } from 'lucide-react';
import { api, fmtDate, fmtTime, fmtDateTime } from '../api.js';
import { Avatar, Modal, Alert, Field, useToast } from './ui.jsx';

const LEVEL = { primary: 'Primary', secondary: 'Secondary', third: 'Third', admin: 'Admin' };

export const shiftText = (p) => (p.shift ? `${p.shift}${p.shift_start ? ` (${fmtTime(p.shift_start)} – ${fmtTime(p.shift_end)})` : ''}` : '—');

const NR_TEXT = {
  awaiting_reason: 'Did not return — waiting for the employee’s reason',
  reason_submitted: 'Did not return — reason sent to authorities',
  approved: 'Did not return — reason accepted',
  rejected: 'Did not return — reason rejected',
  returned_late: 'Returned late',
};

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
          <div className="pf"><div className="k">Shift</div><div className="v">{shiftText(p)}</div></div>
          <div className="pf"><div className="k">Purpose</div><div className="v">{p.reason_type}</div></div>
          <div className="pf"><div className="k">Out time</div><div className="v">{fmtTime(p.out_time)}</div></div>
          <div className="pf full"><div className="k">Reason for going out</div><div className="v">{p.reason}</div></div>
          <div className="pf">
            <div className="k">Returning</div>
            <div className="v">{p.coming_back ? 'I will come back today' : 'I will not come to the factory today'}</div>
          </div>
          {!!p.coming_back && (
            <div className="pf"><div className="k">Expected time of arrival</div><div className="v">{fmtTime(p.expected_in_time)}</div></div>
          )}
          {p.decision_remark && (
            <div className="pf full"><div className="k">{p.decided_by_name === 'System' ? 'Note' : 'Authority remark'}</div><div className="v">{p.decision_remark}</div></div>
          )}
        </div>
        <div className="pass-side">
          <Avatar src={p.photo} name={p.emp_name} size="xl" />
          <div className={`stamp ${p.status}`}>{p.status.toUpperCase()}</div>
        </div>
      </div>
      <div className="pass-signs two">
        <div>
          <div className="k">Employee</div>
          <div className="sig">{p.emp_name}</div>
          <div className="small muted">Requested {fmtDateTime(p.created_at)}</div>
          {p.raised_by_name && <div className="small muted">Raised by {p.raised_by_name} (admin) on behalf of the employee</div>}
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
          ) : p.status === 'cancelled' ? (
            <>
              <div className="sig muted">{p.decided_by_name === 'System' ? 'Cancelled automatically' : 'Cancelled'}</div>
              {p.decided_at && <div className="small muted">{fmtDateTime(p.decided_at)}</div>}
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
      </div>
      <div className="pass-security">
        <div className="sec-title">For Security Personnel</div>
        <div className="sec-grid">
          <div>
            <div className="k">Check out</div>
            {p.actual_out ? (
              <>
                <div className="sig">{fmtTime(p.actual_out)} · {p.out_marked_by}</div>
                <div className="small muted">{fmtDate(p.actual_out)}{p.out_security_login ? ` · ${p.out_security_login}` : ''}</div>
              </>
            ) : (
              <div className="muted">—</div>
            )}
          </div>
          <div>
            <div className="k">Check in</div>
            {!p.coming_back ? (
              <div className="muted">Not applicable — not returning today</div>
            ) : p.actual_in ? (
              <>
                <div className="sig">{fmtTime(p.actual_in)} · {p.in_marked_by}</div>
                <div className="small muted">{fmtDate(p.actual_in)}{p.in_security_login ? ` · ${p.in_security_login}` : ''}</div>
              </>
            ) : (
              <div className="muted">—</div>
            )}
          </div>
        </div>
        {p.nr_status && (
          <div className="nr-box">
            <b>{NR_TEXT[p.nr_status] || p.nr_status}</b>
            {p.nr_reason && <div>Reason: {p.nr_reason}</div>}
            {p.nr_decided_by_name && (
              <div className="small muted">
                {p.nr_status === 'approved' ? 'Accepted' : 'Rejected'} by {p.nr_decided_by_name} · {fmtDateTime(p.nr_decided_at)}
                {p.nr_remark ? ` · “${p.nr_remark}”` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Who sees the request and when (staged approvals). */
function ApprovalRoute({ p }) {
  if (!p.approvers?.length) return null;
  const pending = p.status === 'pending';
  return (
    <div className="card card-pad no-print">
      <div className="row" style={{ marginBottom: 8 }}>
        <Route size={16} />
        <b>Approval route</b>
        <span className="muted small">· next authority sees it after {p.escalationMinutes} min without a decision</span>
      </div>
      <div className="route">
        {p.approvers.map((a, i) => (
          <div key={a.approver_id} className={`route-step ${a.visible ? 'on' : ''}`}>
            <span className="route-n">{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{a.name} <span className="muted small">{LEVEL[a.level]}</span></div>
              <div className="small muted">
                {!pending
                  ? p.decided_by === a.approver_id
                    ? `${p.status === 'approved' ? 'Approved' : 'Rejected'} ${fmtDateTime(p.decided_at)}`
                    : a.visible || a.notified_at
                      ? 'Could see it'
                      : 'Not needed'
                  : a.visible
                    ? `Can see it since ${fmtTime(a.visible_from)}`
                    : `Sees it at ${fmtTime(a.visible_from)} if still pending`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loads a pass by id and shows it with the actions the current user is allowed:
 * approve / reject, send on to the next authority (admin), cancel (requester),
 * state a reason for not returning (requester), accept / reject that reason (authority).
 */
export function PassModal({ id, onClose, onChanged }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  const [remark, setRemark] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // 'reject'
  const toast = useToast();

  const load = () => api(`/passes/${id}`).then(setP).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, msg, close = true) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onChanged?.();
      if (close) onClose();
      else load();
    } catch (e) {
      toast(e.message, 'error');
      load();
    } finally {
      setBusy(false);
    }
  };

  const decide = (decision) => {
    if (decision === 'rejected' && !remark.trim()) {
      setMode('reject');
      return toast('Please write the reason for rejection', 'error');
    }
    act(() => api(`/passes/${id}/decision`, { method: 'POST', body: { decision, remark } }), decision === 'approved' ? 'Gate pass approved' : 'Gate pass rejected');
  };
  const decideNr = (decision) => {
    if (decision === 'rejected' && !remark.trim()) return toast('Please write a remark when rejecting the reason', 'error');
    act(() => api(`/passes/${id}/not-returned-decision`, { method: 'POST', body: { decision, remark } }), decision === 'approved' ? 'Reason accepted' : 'Reason rejected');
  };

  const footer = p && (
    <>
      <button className="btn ghost no-print" onClick={() => window.print()}>
        <Printer size={16} /> Print
      </button>
      <div className="spacer" />
      {p.canEscalate && (
        <button className="btn" disabled={busy} onClick={() => act(() => api(`/passes/${id}/escalate`, { method: 'POST' }), 'Sent to the next authority', false)}>
          <Send size={16} /> Send to next authority
        </button>
      )}
      {p.canCancel && (
        <button className="btn" onClick={() => act(() => api(`/passes/${id}/cancel`, { method: 'POST' }), 'Request cancelled')} disabled={busy}>
          <Ban size={16} /> Cancel request
        </button>
      )}
      {p.canStateReason && (
        <button
          className="btn primary"
          disabled={busy || !reason.trim()}
          onClick={() => act(() => api(`/passes/${id}/not-returned-reason`, { method: 'POST', body: { reason } }), 'Reason sent to your authorities')}
        >
          <Send size={16} /> Send reason
        </button>
      )}
      {p.canDecideNotReturned && (
        <>
          <button className="btn danger" onClick={() => decideNr('rejected')} disabled={busy}><X size={16} /> Reject reason</button>
          <button className="btn success" onClick={() => decideNr('approved')} disabled={busy}><Check size={16} /> Accept reason</button>
        </>
      )}
      {p.canDecide && (
        <>
          <button className="btn danger" onClick={() => decide('rejected')} disabled={busy}><X size={16} /> Reject</button>
          <button className="btn success" onClick={() => decide('approved')} disabled={busy}><Check size={16} /> Approve</button>
        </>
      )}
      {!p.canCancel && !p.canDecide && !p.canStateReason && !p.canDecideNotReturned && <button className="btn" onClick={onClose}>Close</button>}
    </>
  );

  return (
    <Modal title={p ? `Gate Pass · ${p.emp_name}` : 'Gate Pass'} onClose={onClose} size="wide" footer={footer}>
      {err && <Alert type="error">{err}</Alert>}
      {!p && !err && <div className="empty">Loading…</div>}
      {p && (
        <div className="stack">
          {p.canStateReason && (
            <div className="card card-pad no-print" style={{ borderColor: 'var(--amber)', background: 'var(--amber-50)' }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <MessageSquareWarning size={18} color="var(--amber)" />
                <b>You have not returned to the plant. Please state the reason.</b>
              </div>
              <textarea className="input" style={{ width: '100%' }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. The client meeting ran late, so I went home directly" />
              <div className="small muted" style={{ marginTop: 4 }}>Your authorities will be notified and will accept or reject it.</div>
            </div>
          )}
          <div className="print-area">
            <GatePassDoc p={p} />
          </div>
          <ApprovalRoute p={p} />
          {(p.canDecide || p.canDecideNotReturned) && (
            <Field
              label={p.canDecideNotReturned ? 'Remark on the reason' : mode === 'reject' ? 'Reason for rejection' : 'Remark'}
              required={mode === 'reject'}
              hint="Required when rejecting; shown to the employee."
            >
              <textarea className="input no-print" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={500} placeholder={p.canDecideNotReturned ? 'e.g. Noted, please inform in advance next time' : 'e.g. Please go after the line audit at 4 PM'} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
