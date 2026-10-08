import { useState } from 'react';
import { Plus, FileUp, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { api, fmtDateTime } from '../../api.js';
import { Avatar, Modal, Confirm, Alert, Field, SearchBox, Pagination, Empty, useList, useMeta, useToast } from '../../components/ui.jsx';
import EmployeePicker from '../../components/EmployeePicker.jsx';
import BulkUpload from '../../components/BulkUpload.jsx';

function Auth({ name, code }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <div>
      <div style={{ fontWeight: 500 }}>{name}</div>
      <div className="small muted">{code}</div>
    </div>
  );
}

const pick = (id, name, code) => (id ? { id, name, emp_code: code } : null);

function AssignModal({ row, onClose, onSaved }) {
  const toast = useToast();
  const [emp, setEmp] = useState(row ? { id: row.id, name: row.name, emp_code: row.emp_code, department: row.department, photo: row.photo } : null);
  const [p, setP] = useState(row ? pick(row.primary_id, row.primary_name, row.primary_code) : null);
  const [s, setS] = useState(row ? pick(row.secondary_id, row.secondary_name, row.secondary_code) : null);
  const [t, setT] = useState(row ? pick(row.third_id, row.third_name, row.third_code) : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = (...xs) => xs.filter(Boolean).map((x) => x.id);

  const save = async () => {
    setErr('');
    if (!emp) return setErr('Select the employee');
    if (!p) return setErr('Primary authority is required');
    setBusy(true);
    try {
      await api(`/authorities/${emp.id}`, {
        method: 'PUT',
        body: { primary_id: p.id, secondary_id: s?.id || null, third_id: t?.id || null },
      });
      toast('Authorities saved');
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={row ? `Authorities for ${row.name}` : 'Assign authorities'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="stack">
        {err && <Alert type="error">{err}</Alert>}
        <Field label="Employee" required>
          {row ? (
            <div className="chosen" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}>
              <Avatar src={row.photo} name={row.name} />
              <div><b>{row.name}</b><div className="small muted">{row.emp_code} · {row.department}</div></div>
            </div>
          ) : (
            <EmployeePicker value={emp} onChange={setEmp} />
          )}
        </Field>
        <Field label="Primary authority" required>
          <EmployeePicker value={p} onChange={setP} exclude={ids(emp, s, t)} />
        </Field>
        <Field label="Secondary authority" hint="Optional">
          <EmployeePicker value={s} onChange={setS} exclude={ids(emp, p, t)} />
        </Field>
        <Field label="Third authority" hint="Optional">
          <EmployeePicker value={t} onChange={setT} exclude={ids(emp, p, s)} />
        </Field>
        <Alert type="info">Requests go to all assigned authorities at once. The first one to approve or reject decides it.</Alert>
      </div>
    </Modal>
  );
}

export default function AccessPage() {
  const meta = useMeta();
  const toast = useToast();
  const list = useList('/authorities', { search: '', department: '', assigned: '' });
  const [editing, setEditing] = useState(null); // row | 'new'
  const [bulk, setBulk] = useState(false);
  const [confirm, setConfirm] = useState(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Access Management</h1>
          <p>Who approves each employee’s gate pass. Primary is mandatory; secondary and third are optional.</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setBulk(true)}><FileUp size={17} /> Bulk upload</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={17} /> Assign authorities</button>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={list.filters.search} onChange={(v) => list.setFilter('search', v)} placeholder="Search employee or authority" />
          <select className="input" value={list.filters.department} onChange={(e) => list.setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="input" value={list.filters.assigned} onChange={(e) => list.setFilter('assigned', e.target.value)}>
            <option value="">Assigned & not assigned</option>
            <option value="yes">Assigned</option>
            <option value="no">Not assigned</option>
          </select>
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={ShieldCheck} text="No employees match." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Primary authority</th>
                  <th>Secondary authority</th>
                  <th>Third authority</th>
                  <th>Last updated</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.6 }}>
                    <td>
                      <div className="person">
                        <Avatar src={r.photo} name={r.name} />
                        <div>
                          <div className="nm">{r.name}</div>
                          <div className="sub">{r.emp_code}{r.department ? ` · ${r.department}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{r.primary_id ? <Auth name={r.primary_name} code={r.primary_code} /> : <span className="badge amber">Not assigned</span>}</td>
                    <td><Auth name={r.secondary_name} code={r.secondary_code} /></td>
                    <td><Auth name={r.third_name} code={r.third_code} /></td>
                    <td className="small muted">{r.updated_at ? fmtDateTime(r.updated_at) : '—'}</td>
                    <td className="actions">
                      <button className="icon-btn" title={r.primary_id ? 'Change' : 'Assign'} onClick={() => setEditing(r)}><Pencil size={16} /></button>
                      {r.primary_id && (
                        <button
                          className="icon-btn danger"
                          title="Remove authorities"
                          onClick={() =>
                            setConfirm({
                              title: 'Remove authorities',
                              danger: true,
                              message: `${r.name} will not be able to raise gate passes until new authorities are assigned.`,
                              confirmText: 'Remove',
                              onConfirm: async () => {
                                await api(`/authorities/${r.id}`, { method: 'DELETE' });
                                toast('Authorities removed');
                                list.reload();
                              },
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
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
      {editing && <AssignModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
      {bulk && (
        <BulkUpload
          title="Bulk upload authorities"
          base="/authorities"
          sampleName="gatepass-authorities-sample.xlsx"
          importable={['new', 'update']}
          onClose={() => setBulk(false)}
          onDone={list.reload}
          note="Use Employee IDs. Employees and authorities must already exist in User Management."
          columns={[
            { key: 'emp_code', label: 'Employee', render: (r) => <>{r.emp_name || r.emp_code}<div className="small muted">{r.emp_code}</div></> },
            { key: 'primary', label: 'Primary', render: (r) => <>{r.primary_name || r.primary || '—'}<div className="small muted">{r.primary}</div></> },
            { key: 'secondary', label: 'Secondary', render: (r) => (r.secondary ? <>{r.secondary_name || r.secondary}<div className="small muted">{r.secondary}</div></> : <span className="muted">—</span>) },
            { key: 'third', label: 'Third', render: (r) => (r.third ? <>{r.third_name || r.third}<div className="small muted">{r.third}</div></> : <span className="muted">—</span>) },
          ]}
        />
      )}
    </>
  );
}
