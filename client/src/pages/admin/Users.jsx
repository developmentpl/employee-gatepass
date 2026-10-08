import { useState } from 'react';
import { Plus, FileUp, Pencil, Trash2, KeyRound, Power, Users as UsersIcon } from 'lucide-react';
import { api, fmtTime } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Avatar, Modal, Confirm, Alert, Field, SearchBox, Pagination, Empty, StatusBadge, useList, useMeta, useToast } from '../../components/ui.jsx';
import PhotoPicker from '../../components/PhotoPicker.jsx';
import BulkUpload from '../../components/BulkUpload.jsx';

const ROLE_LABEL = { user: 'Employee', admin: 'Admin', security: 'Security' };

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
  });
  const [photo, setPhoto] = useState(user?.photo || null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const body = { ...f };
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
          <button className="btn primary" form="userform" disabled={busy}>{busy ? 'Saving…' : user ? 'Save changes' : 'Add user'}</button>
        </>
      }
    >
      <form id="userform" className="stack" onSubmit={submit}>
        {err && <Alert type="error">{err}</Alert>}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 16 }}>
          <PhotoPicker value={photo} onChange={setPhoto} />
        </div>
        <div className="grid3">
          <Field label="Employee ID" required>
            <input className="input" value={f.emp_code} onChange={set('emp_code')} required maxLength={50} />
          </Field>
          <Field label="Employee Name" required className="span2">
            <input className="input" value={f.name} onChange={set('name')} required maxLength={150} />
          </Field>
          <Field label="Email ID" required>
            <input className="input" type="email" value={f.email} onChange={set('email')} required />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Role" hint="Security can mark gate out / in">
            <select className="input" value={f.role} onChange={set('role')}>
              <option value="user">Employee</option>
              <option value="security">Security</option>
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
          <Field label="Shift">
            <input className="input" list="shift-list" value={f.shift} onChange={set('shift')} />
            <datalist id="shift-list">{meta.shifts.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="eSSL User ID" hint="ID on the biometric device. Leave blank if same as Employee ID.">
            <input className="input" value={f.essl_code} onChange={set('essl_code')} />
          </Field>
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
          <input className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const list = useList('/users', { search: '', department: '', shift: '', role: '', status: '' });
  const [editing, setEditing] = useState(null); // user | 'new'
  const [bulk, setBulk] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [reset, setReset] = useState(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Management</h1>
          <p>All employees who can use the gate pass system.</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setBulk(true)}><FileUp size={17} /> Bulk upload</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={17} /> Add user</button>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchBox value={list.filters.search} onChange={(v) => list.setFilter('search', v)} placeholder="Search name, ID, email, phone" />
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
            <option value="security">Security</option>
            <option value="admin">Admin</option>
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
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Shift</th>
                  <th>Role</th>
                  <th>Today (eSSL)</th>
                  <th>Status</th>
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
                          <div className="nm">{u.name}</div>
                          <div className="sub">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{u.emp_code}</td>
                    <td>
                      {u.department || '—'}
                      {u.designation && <div className="small muted">{u.designation}</div>}
                    </td>
                    <td>{u.shift || '—'}</td>
                    <td><span className={`badge ${u.role === 'admin' ? 'blue' : u.role === 'security' ? 'amber' : ''}`}>{ROLE_LABEL[u.role]}</span></td>
                    <td><Presence u={u} /></td>
                    <td><StatusBadge status={u.is_active ? 'approved' : 'cancelled'} label={u.is_active ? 'Active' : 'Inactive'} /></td>
                    <td className="actions">
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(u)}><Pencil size={16} /></button>
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
                                message: `Remove ${u.name} (${u.emp_code})? They will also be removed as an authority for other employees. Past gate passes stay in the records.`,
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
          title="Bulk upload users"
          base="/users"
          sampleName="gatepass-users-sample.xlsx"
          onClose={() => setBulk(false)}
          onDone={list.reload}
          note="Employees already in the system (same Employee ID or email) are detected and skipped, so no one is added twice. Photos can be added afterwards."
          columns={[
            { key: 'emp_code', label: 'Emp ID' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'department', label: 'Department' },
            { key: 'designation', label: 'Designation' },
            { key: 'shift', label: 'Shift' },
            { key: 'role', label: 'Role' },
          ]}
        />
      )}
    </>
  );
}
