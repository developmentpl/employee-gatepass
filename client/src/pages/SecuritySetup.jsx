import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound, UserRound, ShieldCheck } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { Modal, Confirm, Alert, Field, Empty, useToast, PasswordInput } from '../components/ui.jsx';

function LoginForm({ row, onClose, onSaved }) {
  const [f, setF] = useState({ login_id: row?.login_id || '', name: row?.name || '', phone: row?.phone || '', password: '', is_active: row ? !!row.is_active : true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (row) await api(`/security/logins/${row.id}`, { method: 'PUT', body: f });
      else await api('/security/logins', { method: 'POST', body: f });
      toast(row ? 'Security login updated' : 'Security login added');
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={row ? `Edit ${row.login_id}` : 'Add security login'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="secform" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="secform" className="stack" onSubmit={save}>
        {err && <Alert type="error">{err}</Alert>}
        <div className="grid2">
          <Field label="Login ID" required hint="Used to sign in, e.g. GATE1">
            <input className="input" value={f.login_id} onChange={set('login_id')} required />
          </Field>
          <Field label="Gate / login name" required hint="e.g. Main gate">
            <input className="input" value={f.name} onChange={set('name')} required />
          </Field>
          <Field label={row ? 'New password' : 'Password'} required={!row} hint={row ? 'Leave blank to keep the current password' : 'At least 6 characters'}>
            <PasswordInput value={f.password} onChange={set('password')} required={!row} autoComplete="new-password" />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={set('phone')} />
          </Field>
        </div>
        {row && (
          <label className="row">
            <input type="checkbox" checked={f.is_active} onChange={set('is_active')} /> Active (can sign in)
          </label>
        )}
      </form>
    </Modal>
  );
}

function PersonForm({ row, onClose, onSaved }) {
  const [f, setF] = useState({ name: row?.name || '', phone: row?.phone || '', is_active: row ? !!row.is_active : true });
  const [err, setErr] = useState('');
  const toast = useToast();
  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (row) await api(`/security/persons/${row.id}`, { method: 'PUT', body: f });
      else await api('/security/persons', { method: 'POST', body: f });
      toast(row ? 'Updated' : 'Security person added');
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <Modal
      title={row ? `Edit ${row.name}` : 'Add security person'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="pform">Save</button>
        </>
      }
    >
      <form id="pform" className="stack" onSubmit={save}>
        {err && <Alert type="error">{err}</Alert>}
        <Field label="Name" required>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label="Phone">
          <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        {row && (
          <label className="row">
            <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active (shown in the name list)
          </label>
        )}
      </form>
    </Modal>
  );
}

export default function SecuritySetup() {
  const [logins, setLogins] = useState([]);
  const [persons, setPersons] = useState([]);
  const [editLogin, setEditLogin] = useState(null);
  const [editPerson, setEditPerson] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [err, setErr] = useState('');
  const toast = useToast();

  const load = () => {
    api('/security/logins').then(setLogins).catch((e) => setErr(e.message));
    api('/security/persons', { query: { all: 1 } }).then(setPersons).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security Setup</h1>
          <p>Gate logins are shared accounts for each gate. Security persons are the guards; each one signs in on any gate login and enters their name.</p>
        </div>
      </div>
      {err && <Alert type="error">{err}</Alert>}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <ShieldCheck size={18} color="var(--blue)" />
            <h3>Security logins</h3>
            <span className="muted small">{logins.length}</span>
            <div className="spacer" />
            <button className="btn sm primary" onClick={() => setEditLogin('new')}><Plus size={15} /> Add login</button>
          </div>
          {!logins.length ? (
            <Empty icon={ShieldCheck} text="No security logins yet. Add one per gate, e.g. GATE1 – Main gate." />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Login ID</th><th>Name</th><th>Last sign-in</th><th className="actions" /></tr>
              </thead>
              <tbody>
                {logins.map((l) => (
                  <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.55 }}>
                    <td className="mono">{l.login_id}</td>
                    <td>{l.name}{!l.is_active && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}</td>
                    <td className="small muted">{l.last_login ? fmtDateTime(l.last_login) : 'Never'}</td>
                    <td className="actions">
                      <button className="icon-btn" title="Edit / change password" onClick={() => setEditLogin(l)}><KeyRound size={16} /></button>
                      <button
                        className="icon-btn danger"
                        title="Remove"
                        onClick={() =>
                          setConfirm({
                            title: 'Remove security login',
                            danger: true,
                            message: `Remove ${l.login_id} (${l.name})? It can no longer sign in. Past gate entries keep its name.`,
                            confirmText: 'Remove',
                            onConfirm: async () => {
                              await api(`/security/logins/${l.id}`, { method: 'DELETE' });
                              toast('Security login removed');
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
            <UserRound size={18} color="var(--blue)" />
            <h3>Security persons</h3>
            <span className="muted small">{persons.filter((p) => p.is_active).length} active</span>
            <div className="spacer" />
            <button className="btn sm primary" onClick={() => setEditPerson('new')}><Plus size={15} /> Add person</button>
          </div>
          <div className="card-pad small muted" style={{ paddingBottom: 0 }}>Names typed at the gate that are not in this list are added automatically.</div>
          {!persons.length ? (
            <Empty icon={UserRound} text="No security persons yet." />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Phone</th><th>Gate entries</th><th className="actions" /></tr>
              </thead>
              <tbody>
                {persons.map((p) => (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td>{p.name}{!p.is_active && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}</td>
                    <td className="small">{p.phone || '—'}</td>
                    <td>{p.entries}</td>
                    <td className="actions">
                      <button className="icon-btn" title="Edit" onClick={() => setEditPerson(p)}><Pencil size={16} /></button>
                      <button
                        className="icon-btn danger"
                        title="Remove"
                        onClick={() =>
                          setConfirm({
                            title: 'Remove security person',
                            danger: true,
                            message: `Remove ${p.name} from the list? Their past check-outs and check-ins keep their name.`,
                            confirmText: 'Remove',
                            onConfirm: async () => {
                              await api(`/security/persons/${p.id}`, { method: 'DELETE' });
                              toast('Removed');
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
      </div>
      {editLogin && <LoginForm row={editLogin === 'new' ? null : editLogin} onClose={() => setEditLogin(null)} onSaved={load} />}
      {editPerson && <PersonForm row={editPerson === 'new' ? null : editPerson} onClose={() => setEditPerson(null)} onSaved={load} />}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
