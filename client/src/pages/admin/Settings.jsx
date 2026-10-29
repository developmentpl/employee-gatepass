import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Clock, Timer, Save, Mail, Send } from 'lucide-react';
import { api, fmtTime } from '../../api.js';
import { Modal, Confirm, Alert, Field, Empty, useToast, PasswordInput } from '../../components/ui.jsx';
import { useAuth } from '../../auth.jsx';

function ShiftForm({ row, onClose, onSaved }) {
  const [f, setF] = useState({ name: row?.name || '', start_time: row?.start_time || '', end_time: row?.end_time || '', is_active: row ? !!row.is_active : true });
  const [err, setErr] = useState('');
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (row) await api(`/settings/shifts/${row.id}`, { method: 'PUT', body: f });
      else await api('/settings/shifts', { method: 'POST', body: f });
      toast(row ? 'Shift updated' : 'Shift added');
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <Modal
      title={row ? `Edit shift ${row.name}` : 'Add shift'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="shiftform">Save</button>
        </>
      }
    >
      <form id="shiftform" className="stack" onSubmit={save}>
        {err && <Alert type="error">{err}</Alert>}
        <Field label="Shift name" required hint={row?.users ? `Renaming moves its ${row.users} employee(s) to the new name.` : 'e.g. A, General, Night'}>
          <input className="input" value={f.name} onChange={set('name')} required autoFocus maxLength={50} />
        </Field>
        <div className="grid2">
          <Field label="Start time" required>
            <input className="input" type="time" value={f.start_time} onChange={set('start_time')} required />
          </Field>
          <Field label="End time" required hint="Can be after midnight, e.g. 22:00 to 06:00">
            <input className="input" type="time" value={f.end_time} onChange={set('end_time')} required />
          </Field>
        </div>
        <label className="row">
          <input type="checkbox" checked={f.is_active} onChange={set('is_active')} /> Active (employees can select it)
        </label>
      </form>
    </Modal>
  );
}

const PRESETS = {
  m365: { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: false },
  google: { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false },
  other: { label: 'Other (company mail server / hosting)', host: '', port: 587, secure: false },
};

function EmailSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [to, setTo] = useState(user.email || '');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    api('/settings/email').then(setS).catch((e) => toast(e.message, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const preset = (key) => {
    const p = PRESETS[key];
    setS({ ...s, host: p.host || s.host, port: p.port, secure: p.secure });
  };
  const save = async () => {
    setBusy('save');
    setResult(null);
    try {
      setS(await api('/settings/email', { method: 'PUT', body: s }));
      toast(s.host ? 'Email settings saved' : 'Emails turned off');
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    if (!(await save())) return;
    setBusy('test');
    try {
      const r = await api('/settings/email/test', { method: 'POST', body: { to } });
      setResult({ ok: true, text: `Test email sent to ${r.to}. Check the inbox (and the spam folder).` });
    } catch (e) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <Mail size={18} color="var(--blue)" />
        <h3>Email notifications</h3>
        <span className={`badge ${s.enabled ? 'green' : ''}`} style={{ marginLeft: 8 }}>{s.enabled ? 'On' : 'Off'}</span>
      </div>
      <div className="card-pad stack">
        <div className="small muted">
          Emails go out from one mailbox (e.g. gatepass@yourcompany.com, or your own while testing) through your mail provider's SMTP server.
          Leave “SMTP server” blank to turn emails off. In-app notifications (the bell) work either way.
          {s.source === 'env' && ' These values currently come from server\\.env; saving here overrides them.'}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="small muted">Fill in for:</span>
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} type="button" className="btn sm" onClick={() => preset(k)}>{p.label}</button>
          ))}
        </div>
        <div className="grid3">
          <Field label="SMTP server" hint="e.g. smtp.office365.com or smtp.gmail.com">
            <input className="input" value={s.host} onChange={set('host')} placeholder="smtp.office365.com" />
          </Field>
          <Field label="Port" hint="587 (usual) or 465">
            <input className="input" type="number" value={s.port} onChange={set('port')} />
          </Field>
          <Field label="Encryption">
            <select className="input" value={s.secure ? '1' : '0'} onChange={(e) => setS({ ...s, secure: e.target.value === '1' })}>
              <option value="0">STARTTLS (port 587)</option>
              <option value="1">SSL/TLS (port 465)</option>
            </select>
          </Field>
          <Field label="Username" hint="Usually the full email address">
            <input className="input" value={s.user} onChange={set('user')} autoComplete="off" placeholder="gatepass@yourcompany.com" />
          </Field>
          <Field label="Password" hint="Gmail / accounts with 2-step sign-in need an app password">
            <PasswordInput value={s.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
          <Field label="From" hint="Name and address the emails show">
            <input className="input" value={s.from} onChange={set('from')} placeholder="Gate Pass <gatepass@yourcompany.com>" />
          </Field>
        </div>
        {result && <Alert type={result.ok ? 'ok' : 'error'}>{result.text}</Alert>}
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <button className="btn primary" onClick={save} disabled={!!busy}><Save size={16} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
          <div className="spacer" />
          <Field label="Send a test email to">
            <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} style={{ minWidth: 240 }} />
          </Field>
          <button className="btn" onClick={test} disabled={!!busy || !s.host || !to}><Send size={16} /> {busy === 'test' ? 'Sending…' : 'Save and send test'}</button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [shifts, setShifts] = useState([]);
  const [general, setGeneral] = useState(null);
  const [edit, setEdit] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => {
    api('/settings/shifts').then(setShifts).catch((e) => toast(e.message, 'error'));
    api('/settings/general').then(setGeneral).catch((e) => toast(e.message, 'error'));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveGeneral = async () => {
    setSaving(true);
    try {
      await api('/settings/general', { method: 'PUT', body: general });
      toast('Settings saved');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const setG = (k) => (e) => setGeneral({ ...general, [k]: e.target.value });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Shifts and their timings, and the time rules for approvals and returns.</p>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <Clock size={18} color="var(--blue)" />
            <h3>Shifts</h3>
            <div className="spacer" />
            <button className="btn sm primary" onClick={() => setEdit('new')}><Plus size={15} /> Add shift</button>
          </div>
          <div className="card-pad small muted" style={{ paddingBottom: 0 }}>Employees pick their shift on each request; its start and end time show on the request and the gate pass.</div>
          {!shifts.length ? (
            <Empty icon={Clock} text="No shifts yet." />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Shift</th><th>Timing</th><th>Employees</th><th className="actions" /></tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                    <td><b>{s.name}</b>{!s.is_active && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}</td>
                    <td className="nowrap">{s.start_time ? `${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}` : <span className="badge amber">Timing not set</span>}</td>
                    <td>{s.users}</td>
                    <td className="actions">
                      <button className="icon-btn" title="Edit" onClick={() => setEdit(s)}><Pencil size={16} /></button>
                      <button
                        className="icon-btn danger"
                        title="Delete"
                        onClick={() =>
                          setConfirm({
                            title: 'Delete shift',
                            danger: true,
                            message: `Delete shift ${s.name}? Past gate passes keep their shift timing.`,
                            confirmText: 'Delete',
                            onConfirm: async () => {
                              await api(`/settings/shifts/${s.id}`, { method: 'DELETE' });
                              toast('Shift deleted');
                              load();
                            },
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <Timer size={18} color="var(--blue)" />
            <h3>Approval and return timing</h3>
          </div>
          {general && (
            <div className="card-pad stack">
              <Field
                label="Send to the next authority after (minutes)"
                hint="A request goes to the primary authority first. If nobody approves or rejects it in this time, the secondary authority also sees it, then the third after the same time again. Admins can also send a request on immediately."
              >
                <input className="input" type="number" min="1" max="1440" style={{ maxWidth: 140 }} value={general['approval.escalationMinutes']} onChange={setG('approval.escalationMinutes')} />
              </Field>
              <Field
                label="Cancel a request automatically if nobody answers it within (hours)"
                hint="A gate pass that no authority has approved or rejected in this time is cancelled. The employee is told and can raise a new one."
              >
                <input className="input" type="number" min="1" max="168" style={{ maxWidth: 140 }} value={general['approval.autoCancelHours']} onChange={setG('approval.autoCancelHours')} />
              </Field>
              <Field
                label="Mark as 'not returned' after (minutes past expected arrival)"
                hint="If an employee who said they would return is not checked in by then, they get a notification and email asking for the reason, which then goes to their authorities."
              >
                <input className="input" type="number" min="1" max="1440" style={{ maxWidth: 140 }} value={general['gate.notReturnedGraceMin']} onChange={setG('gate.notReturnedGraceMin')} />
              </Field>
              <div>
                <button className="btn primary" onClick={saveGeneral} disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <EmailSettings />
      {edit && <ShiftForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={load} />}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
