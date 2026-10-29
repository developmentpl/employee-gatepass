import { useEffect, useState } from 'react';
import { Plus, FileUp, Pencil, Trash2, KeyRound, Power, Users as UsersIcon, Info } from 'lucide-react';
import { api, fmtTime } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Avatar, Modal, Confirm, Alert, Field, SearchBox, Pagination, Empty, useList, useMeta, useToast, PasswordInput } from '../../components/ui.jsx';
import PhotoPicker from '../../components/PhotoPicker.jsx';
import BulkUpload from '../../components/BulkUpload.jsx';
import EmployeePicker from '../../components/EmployeePicker.jsx';

const ROLE_LABEL = { user: 'Employee', admin: 'Admin', security_admin: 'Security admin' };

function Presence({ u }) {
  if (!u.last_punch) return <span className="badge">No punch today</span>;
  const [t, dir] = u.last_punch.split('|');
  if (dir === 'out') return <span className="badge amber" title={`Last punch ${t}`}><span className="dot" />Out · {fmtTime(t)}</span>;
  return (
    <span className="badge green" title={`First punch ${u.first_punch}, last ${t}`}>
      <span className="dot" />In · {fmtTime(u.first_punch || t)}
    </span>
  );
}

function AuthCell({ name, code }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div style={{ fontWeight: 500 }}>{name}</div>
      <div className="small muted">{code}</div>
    </div>
  );
}

const pick = (id, name, code) => (id ? { id, name, emp_code: code } : null);

function UserForm({ user, onClose, onSaved }) {
  const meta = useMeta();
  const toast = useToast();
  const [f, setF] = useState({
    emp_code: user?.emp_code || '',
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    department: user?.department || '',
    designation: user?.designation || '',
    shift: user?.shift || '',
    role: user?.role || 'user',
    essl_code: user?.essl_code || '',
    solus_code: user?.solus_code || '',
  });
  const [photo, setPhoto] = useState(user?.photo || null);
  const [p, setP] = useState(user ? pick(user.primary_id, user.primary_name, user.primary_code) : null);
  const [s, setS] = useState(user ? pick(user.secondary_id, user.secondary_name, user.secondary_code) : null);
  const [t, setT] = useState(user ? pick(user.third_id, user.third_name, user.third_code) : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [chk, setChk] = useState({}); // live duplicate check: { emp_code, email, name }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ids = (...xs) => xs.filter(Boolean).map((x) => x.id).concat(user ? [user.id] : []);

  // Check Employee ID / email / name against existing users while typing.
  useEffect(() => {
    const t = setTimeout(() => {
      api('/users/check-unique', { query: { emp_code: f.emp_code.trim(), email: f.email.trim(), name: f.name.trim(), exceptId: user?.id || '' } })
        .then(setChk)
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [f.emp_code, f.email, f.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const clash = chk.emp_code || chk.email;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!p && (s || t)) return setErr('Choose the primary authority first');
    if (clash) return setErr(clash);
    setBusy(true);
    const body = { ...f, primary_id: p?.id || null, secondary_id: s?.id || null, third_id: t?.id || null };
    if (photo && photo.startsWith('data:')) body.dataUrl = photo;
    if (user && user.photo && !photo) body.removePhoto = '1';
    try {
      if (user) await api(`/users/${user.id}`, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      toast(user ? 'User updated' : 'User added');
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
      title={user ? `Edit ${user.name}` : 'Add user'}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="userform" disabled={busy || !!clash}>{busy ? 'Saving…' : user ? 'Save changes' : 'Add user'}</button>
        </>
      }
    >
      <form id="userform" className="stack" onSubmit={submit}>
        {err && <Alert type="error">{err}</Alert>}
        <PhotoPicker value={photo} onChange={setPhoto} />
        <div className="grid3">
          <Field label="Employee ID (login ID)" required error={chk.emp_code}>
            <input className={`input ${chk.emp_code ? 'bad' : ''}`} value={f.emp_code} onChange={set('emp_code')} required maxLength={50} />
          </Field>
          <Field label="Employee Name" required className="span2" warn={chk.name}>
            <input className="input" value={f.name} onChange={set('name')} required maxLength={150} />
          </Field>
          <Field label="Email ID" required error={chk.email}>
            <input className={`input ${chk.email ? 'bad' : ''}`} type="email" value={f.email} onChange={set('email')} required />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Role">
            <select className="input" value={f.role} onChange={set('role')}>
              <option value="user">Employee</option>
              <option value="security_admin">Security admin</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Department">
            <input className="input" list="dept-list" value={f.department} onChange={set('department')} />
            <datalist id="dept-list">{meta.departments.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Designation">
            <input className="input" value={f.designation} onChange={set('designation')} />
          </Field>
          <Field label="Shift" hint="Manage shifts under Settings">
            <select className="input" value={f.shift} onChange={set('shift')}>
              <option value="">Select…</option>
              {meta.shiftList?.map((x) => (
                <option key={x.name} value={x.name}>{x.name} ({x.start_time}–{x.end_time})</option>
              ))}
              {f.shift && !meta.shifts.includes(f.shift) && <option value={f.shift}>{f.shift} (not in shift list)</option>}
            </select>
          </Field>
          <Field label="eSSL User ID" hint="Blank = same as Employee ID">
            <input className="input" value={f.essl_code} onChange={set('essl_code')} />
          </Field>
          <Field label="Solus User ID" hint="Blank = same as Employee ID">
            <input className="input" value={f.solus_code} onChange={set('solus_code')} />
          </Field>
        </div>

        <div className="card card-pad" style={{ background: '#fafbfd' }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <b>Access — approving authorities</b>
            <span className="muted small">Requests go to Primary first, then Secondary and Third if not answered in time.</span>
          </div>
          <div className="grid3">
            <Field label="Primary authority">
              <EmployeePicker value={p} onChange={setP} exclude={ids(s, t)} />
            </Field>
            <Field label="Secondary authority" hint="Optional">
              <EmployeePicker value={s} onChange={setS} exclude={ids(p, t)} />
            </Field>
            <Field label="Third authority" hint="Optional">
              <EmployeePicker value={t} onChange={setT} exclude={ids(p, s)} />
            </Field>
          </div>
          <div className="small muted row" style={{ marginTop: 8 }}>
            <Info size={14} /> An authority must already be a user. Not in the list? Add them as a user first, then assign them here.
          </div>
        </div>
        {!user && <Alert type="info">The user can sign in with Microsoft, or with the default password set by IT (they will be asked to change it).</Alert>}
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }) {
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(null);
  const toast = useToast();
  return (
    <Modal
      title={`Reset password · ${user.name}`}
      onClose={onClose}
      footer={
        done ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  const r = await api(`/users/${user.id}/reset-password`, { method: 'POST', body: { password: pw } });
                  setDone(r.password);
                } catch (e) {
                  toast(e.message, 'error');
                }
              }}
            >
              Reset password
            </button>
          </>
        )
      }
    >
      {done ? (
        <Alert type="ok">
          Password reset. Share this temporary password with {user.name}: <b className="mono">{done}</b>. They must change it at next sign-in.
        </Alert>
      ) : (
        <Field label="Temporary password" hint="Leave blank to use the default password.">
          <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </Field>
      )}
    </Modal>
  );
}

const ref = (r, k) => (r[k] ? <>{r[`${k}_name`] || <span className="mono">{r[k]}</span>}{r[`${k}_name`] && <div className="small muted">{r[k]}</div>}</> : <span className="muted">—</span>);

export default function UsersPage() {
  const { user: me } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const list = useList('/users', { search: '', department: '', shift: '', role: '', status: '', assigned: '' });
  const [editing, setEditing] = useState(null); // user | 'new'
  const [bulk, setBulk] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [reset, setReset] = useState(null);
  const c = list.counts || {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Access Management</h1>
          <p>Employees, their details and who approves their gate passes.</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setBulk(true)}><FileUp size={17} /> Bulk upload</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={17} /> Add user</button>
      </div>

      <div className="card card-pad headcount" style={{ marginBottom: 16 }}>
        <div>
          <div className="lbl">Total employees</div>
          <div className="big">{c.total ?? '—'}</div>
        </div>
        <div><div className="lbl">Active</div><div style={{ fontSize: 20, fontWeight: 600 }}>{c.active ?? '—'}</div></div>
        <div><div className="lbl">Inactive</div><div style={{ fontSize: 20, fontWeight: 600 }}>{c.inactive ?? '—'}</div></div>
        <div>
          <div className="lbl">Without authority</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>
            {c.unassigned ?? '—'}{' '}
            {c.unassigned > 0 && (
              <button className="btn sm ghost" onClick={() => list.setFilter('assigned', 'no')}>Show</button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchBox value={list.filters.search} onChange={(v) => list.setFilter('search', v)} placeholder="Search name, ID, email, authority" />
          <select className="input" value={list.filters.department} onChange={(e) => list.setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="input" value={list.filters.shift} onChange={(e) => list.setFilter('shift', e.target.value)}>
            <option value="">All shifts</option>
            {meta.shifts.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="input" value={list.filters.role} onChange={(e) => list.setFilter('role', e.target.value)}>
            <option value="">All roles</option>
            <option value="user">Employee</option>
            <option value="security_admin">Security admin</option>
            <option value="admin">Admin</option>
          </select>
          <select className="input" value={list.filters.assigned} onChange={(e) => list.setFilter('assigned', e.target.value)}>
            <option value="">With & without authority</option>
            <option value="yes">Authority assigned</option>
            <option value="no">No authority</option>
          </select>
          <select className="input" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="">Active & inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={UsersIcon} text="No users match these filters." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department · Shift</th>
                  <th>Role</th>
                  <th>Primary</th>
                  <th>Secondary</th>
                  <th>Third</th>
                  <th>Today</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((u) => (
                  <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.6 }}>
                    <td>
                      <div className="person">
                        <Avatar src={u.photo} name={u.name} />
                        <div style={{ minWidth: 0 }}>
                          <div className="nm">{u.name}{!u.is_active && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}</div>
                          <div className="sub"><span className="mono">{u.emp_code}</span> · {u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {u.department || '—'}
                      <div className="small muted">{u.designation ? `${u.designation} · ` : ''}Shift {u.shift || '—'}</div>
                    </td>
                    <td><span className={`badge ${u.role === 'admin' ? 'blue' : u.role === 'security_admin' ? 'amber' : ''}`} style={{ whiteSpace: 'normal' }}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td>{u.primary_id ? <AuthCell name={u.primary_name} code={u.primary_code} /> : <span className="badge amber">Not assigned</span>}</td>
                    <td><AuthCell name={u.secondary_name} code={u.secondary_code} /></td>
                    <td><AuthCell name={u.third_name} code={u.third_code} /></td>
                    <td><Presence u={u} /></td>
                    <td className="actions">
                      <button className="icon-btn" title="Edit details and access" onClick={() => setEditing(u)}><Pencil size={16} /></button>
                      <button className="icon-btn" title="Reset password" onClick={() => setReset(u)}><KeyRound size={16} /></button>
                      {u.id !== me.id && (
                        <>
                          <button
                            className="icon-btn"
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() =>
                              setConfirm({
                                title: u.is_active ? 'Deactivate user' : 'Activate user',
                                message: u.is_active
                                  ? `${u.name} will not be able to sign in or raise gate passes. Their history is kept.`
                                  : `${u.name} will be able to sign in again.`,
                                confirmText: u.is_active ? 'Deactivate' : 'Activate',
                                onConfirm: async () => {
                                  await api(`/users/${u.id}/status`, { method: 'PATCH', body: { active: !u.is_active } });
                                  toast(u.is_active ? 'User deactivated' : 'User activated');
                                  list.reload();
                                },
                              })
                            }
                          >
                            <Power size={16} />
                          </button>
                          <button
                            className="icon-btn danger"
                            title="Remove"
                            onClick={() =>
                              setConfirm({
                                title: 'Remove user',
                                danger: true,
                                message: `Remove ${u.name} (${u.emp_code})? Where they are someone's authority, the next authority moves up. Past gate passes stay in the records.`,
                                confirmText: 'Remove',
                                onConfirm: async () => {
                                  await api(`/users/${u.id}`, { method: 'DELETE' });
                                  toast('User removed');
                                  list.reload();
                                },
                              })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>

      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
      {reset && <ResetPassword user={reset} onClose={() => setReset(null)} />}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
      {bulk && (
        <BulkUpload
          title="Bulk upload users and access"
          base="/users"
          sampleName="gatepass-users-and-access.xlsx"
          importable={['new', 'update']}
          onClose={() => setBulk(false)}
          onDone={list.reload}
          note="One file for both: employee details and their Primary / Secondary / Third authority (by Employee ID). Employees already in the system are flagged, and their details are left unchanged. An authority must already be a user, or be added as a new user in the same file."
          columns={[
            { key: 'emp_code', label: 'Emp ID' },
            { key: 'name', label: 'Name' },
            { key: 'shift', label: 'Shift' },
            { key: 'primary', label: 'Primary', render: (r) => ref({ ...r, primary_name: r.authNames?.primary }, 'primary') },
            { key: 'secondary', label: 'Secondary', render: (r) => ref({ ...r, secondary_name: r.authNames?.secondary }, 'secondary') },
            { key: 'third', label: 'Third', render: (r) => ref({ ...r, third_name: r.authNames?.third }, 'third') },
          ]}
        />
      )}
    </>
  );
}
