import { useEffect, useState, useCallback } from 'react';
import { DoorOpen, LogOut, LogIn, Eye, UserRound, ShieldCheck } from 'lucide-react';
import { api, fmtTime, todayISO, fmtDate, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Alert, SearchBox, Tabs, Empty, StatusBadge, Modal, Field, useToast } from '../components/ui.jsx';
import { PassModal, shiftText } from '../components/GatePass.jsx';

const DUTY_KEY = 'gp_duty_person';
const getDuty = () => {
  try {
    return sessionStorage.getItem(DUTY_KEY) || '';
  } catch {
    return '';
  }
};
const saveDuty = (n) => {
  try {
    sessionStorage.setItem(DUTY_KEY, n);
  } catch {
    /* ignore */
  }
};

/** Free-typing name box with the security persons list as suggestions. */
function PersonInput({ value, onChange, persons, autoFocus, id }) {
  return (
    <>
      <input
        className="input"
        list={id}
        value={value}
        autoFocus={autoFocus}
        placeholder="Type or pick your name"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>{persons.map((p) => <option key={p.id} value={p.name} />)}</datalist>
    </>
  );
}

function DutyDialog({ persons, initial, onSave, onClose }) {
  const [name, setName] = useState(initial || '');
  const { user } = useAuth();
  return (
    <Modal
      title="Who is on duty?"
      onClose={initial ? onClose : undefined}
      icon={<ShieldCheck size={20} color="var(--blue)" />}
      footer={
        <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim().replace(/\s+/g, ' '))}>
          Start duty
        </button>
      }
    >
      <div className="stack">
        <div className="muted">Signed in as <b>{user.emp_code} · {user.name}</b>. Enter your own name; it is recorded on every check-out and check-in you make.</div>
        <Field label="Your name" hint="Pick from the list or type it. A new name is added to the list automatically.">
          <PersonInput id="duty-persons" value={name} onChange={setName} persons={persons} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function GateCard({ p, tab, duty, persons, busy, onMark, onView }) {
  const [name, setName] = useState(duty);
  useEffect(() => setName(duty), [duty]);
  const late = p.nr_status === 'awaiting_reason' || p.nr_status === 'reason_submitted';
  return (
    <div className="gate-card">
      <Avatar src={p.photo} name={p.emp_name} size="lg" />
      <div className="info">
        <div className="nm-row">
          <span className="nm">{p.emp_name}</span>
          {late ? <span className="badge red"><span className="dot" />Overdue</span> : <StatusBadge status={p.gate_status} />}
        </div>
        <div className="small muted">
          {p.emp_code} · {p.department}{p.designation ? ` · ${p.designation}` : ''} · <span className="mono">{p.pass_no}</span>
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          <span className="badge blue">{p.reason_type}</span> <span className="muted">{p.reason}</span>
        </div>
        <div className="times">
          <span>Date: <b>{fmtDate(p.pass_date)}</b></span>
          <span>Shift: <b>{shiftText(p)}</b></span>
          <span>Planned out: <b>{fmtTime(p.out_time)}</b></span>
          <span>Expected in: <b>{p.coming_back ? fmtTime(p.expected_in_time) : 'Not returning'}</b></span>
          {p.actual_out && <span>Checked out: <b>{fmtTime(p.actual_out)}</b> · {p.out_marked_by}</span>}
          {p.actual_in && <span>Checked in: <b>{fmtTime(p.actual_in)}</b> · {p.in_marked_by}</span>}
        </div>
        <div className="small muted">
          <ShieldCheck size={13} style={{ verticalAlign: -2 }} /> Approved by {p.decided_by_name} · {fmtDateTime(p.decided_at)}
        </div>
        {late && <div className="small" style={{ color: 'var(--amber)', marginTop: 4 }}>Not back in time. {p.nr_status === 'reason_submitted' ? 'Reason sent to authorities.' : 'Employee asked for a reason.'} Check in if they arrive.</div>}
        {p.nr_status && ['approved', 'rejected'].includes(p.nr_status) && (
          <div className="small muted" style={{ marginTop: 4 }}>Did not return — reason {p.nr_status} by {p.nr_decided_by_name}</div>
        )}
        {tab !== 'completed' ? (
          <div className="act">
            <PersonInput id={`pn-${p.id}`} value={name} onChange={setName} persons={persons} />
            {tab === 'checkout' ? (
              <button className="btn sm primary" disabled={busy || !name.trim() || p.pass_date !== todayISO()} onClick={() => onMark(p, 'out', name)}>
                <LogOut size={15} /> Check out
              </button>
            ) : (
              <button className="btn sm success" disabled={busy || !name.trim()} onClick={() => onMark(p, 'in', name)}>
                <LogIn size={15} /> Check in
              </button>
            )}
            <button className="btn sm ghost" onClick={() => onView(p.id)}><Eye size={15} /> Pass</button>
          </div>
        ) : (
          <div className="act">
            <button className="btn sm ghost" onClick={() => onView(p.id)}><Eye size={15} /> View pass</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GateDesk() {
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState('checkout');
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ rows: [], counts: {} });
  const [err, setErr] = useState('');
  const [viewId, setViewId] = useState(null);
  const [busy, setBusy] = useState(0);
  const [persons, setPersons] = useState([]);
  const [duty, setDuty] = useState(getDuty());
  const [askDuty, setAskDuty] = useState(!getDuty());
  const { refreshSummary } = useAuth();
  const toast = useToast();

  const loadPersons = () => api('/security/persons').then(setPersons).catch(() => {});
  useEffect(() => {
    loadPersons();
  }, []);

  const load = useCallback(() => {
    api('/passes/gate/list', { query: { tab, date, search } })
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  }, [tab, date, search]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const mark = async (p, action, person) => {
    setBusy(p.id);
    try {
      await api(`/passes/gate/${p.id}/${action}`, { method: 'POST', body: { person } });
      toast(`${p.emp_name} checked ${action === 'out' ? 'out' : 'in'} by ${person.trim()}`);
      if (!persons.some((x) => x.name.toLowerCase() === person.trim().toLowerCase())) loadPersons();
      load();
      refreshSummary();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(0);
    }
  };

  const counts = data.counts || {};
  const datedTab = tab !== 'checkin';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gate Desk</h1>
          <p>Check employees out when they leave on an approved gate pass, and in when they return.</p>
        </div>
      </div>
      <div className="duty">
        <UserRound size={18} />
        <span>On duty:</span>
        <b>{duty || '—'}</b>
        <div className="spacer" />
        <button className="btn sm" onClick={() => setAskDuty(true)}>Change person</button>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'checkout', label: 'To check out', count: counts.checkout },
              { value: 'checkin', label: 'Awaiting check-in', count: counts.checkin },
              { value: 'completed', label: 'Completed' },
            ]}
          />
          <div className="spacer" />
          {datedTab && <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} title="Gate pass date" />}
          <SearchBox value={search} onChange={setSearch} placeholder="Name, ID or pass no." />
        </div>
        {tab === 'checkout' && date !== todayISO() && (
          <div className="card-pad" style={{ paddingBottom: 0 }}><Alert type="info">Showing {fmtDate(date)}. Employees can only be checked out on the date of their pass.</Alert></div>
        )}
        {tab === 'checkin' && (
          <div className="card-pad" style={{ paddingBottom: 0 }}><Alert type="info">Everyone who is out and said they will return, from any day. Entries move to Completed when checked in, or when an authority closes a not-returned case.</Alert></div>
        )}
        {err && <div className="card-pad"><Alert type="error">{err}</Alert></div>}
        {!data.rows.length ? (
          <Empty icon={DoorOpen} text={tab === 'checkout' ? 'No approved gate passes waiting to check out.' : tab === 'checkin' ? 'Nobody is waiting to check in.' : 'No completed entries for this date.'} />
        ) : (
          <div className="gate-grid">
            {data.rows.map((p) => (
              <GateCard key={p.id} p={p} tab={tab} duty={duty} persons={persons} busy={busy === p.id} onMark={mark} onView={setViewId} />
            ))}
          </div>
        )}
      </div>
      {askDuty && (
        <DutyDialog
          persons={persons}
          initial={duty}
          onClose={() => setAskDuty(false)}
          onSave={(n) => {
            saveDuty(n);
            setDuty(n);
            setAskDuty(false);
          }}
        />
      )}
      {viewId && <PassModal id={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}
