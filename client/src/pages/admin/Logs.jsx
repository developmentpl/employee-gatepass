import { useEffect, useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import { api, download, fmtDate, fmtTime, todayISO } from '../../api.js';
import { Alert, SearchBox, Pagination, Empty, useList, useToast } from '../../components/ui.jsx';

const MODULES = {
  auth: 'Sign-in',
  users: 'Users',
  access: 'Access',
  gatepass: 'Gate pass',
  gate: 'Gate desk',
  attendance: 'Attendance',
};
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const TONE = { approved: 'green', rejected: 'red', login_failed: 'red', removed: 'red', deactivated: 'amber', requested: 'blue', cancelled: '' };

export default function LogsPage() {
  const toast = useToast();
  const list = useList('/logs', { search: '', module: '', action: '', from: '', to: '' }, 25);
  const [actions, setActions] = useState([]);
  const f = list.filters;
  useEffect(() => {
    api('/logs/actions').then(setActions).catch(() => {});
  }, []);
  const acts = actions.filter((a) => !f.module || a.module === f.module);

  const quick = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.setFilter('from', iso);
    list.setFilter('to', todayISO());
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Logs</h1>
          <p>Every action in the system: sign-ins, requests, approvals, gate movements, user and access changes.</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => download('/logs/export', f, `gatepass-logs-${todayISO()}.csv`).catch((e) => toast(e.message, 'error'))}>
          <Download size={17} /> Export
        </button>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={f.search} onChange={(v) => list.setFilter('search', v)} placeholder="Search details, user, pass no." />
          <select
            className="input"
            value={f.module}
            onChange={(e) => {
              list.setFilter('module', e.target.value);
              list.setFilter('action', '');
            }}
          >
            <option value="">All modules</option>
            {Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" value={f.action} onChange={(e) => list.setFilter('action', e.target.value)}>
            <option value="">All actions</option>
            {[...new Set(acts.map((a) => a.action))].map((a) => <option key={a} value={a}>{label(a)}</option>)}
          </select>
          <div className="row">
            <input className="input" type="date" value={f.from} onChange={(e) => list.setFilter('from', e.target.value)} title="From" />
            <span className="muted">to</span>
            <input className="input" type="date" value={f.to} onChange={(e) => list.setFilter('to', e.target.value)} title="To" />
          </div>
          <div className="row">
            <button className="btn sm ghost" onClick={() => quick(0)}>Today</button>
            <button className="btn sm ghost" onClick={() => quick(6)}>7 days</button>
            <button className="btn sm ghost" onClick={() => quick(29)}>30 days</button>
            {(f.from || f.to) && (
              <button className="btn sm ghost" onClick={() => { list.setFilter('from', ''); list.setFilter('to', ''); }}>Clear dates</button>
            )}
          </div>
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={ScrollText} text="No log entries match." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date & time</th>
                  <th>User</th>
                  <th>Module</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">
                      {fmtDate(r.created_at)}
                      <div className="small muted">{fmtTime(r.created_at)}</div>
                    </td>
                    <td>
                      {r.actor_name || 'System'}
                      {r.actor_code && <div className="small muted">{r.actor_code}</div>}
                    </td>
                    <td>{MODULES[r.module] || r.module}</td>
                    <td><span className={`badge ${TONE[r.action] ?? ''}`}>{label(r.action)}</span></td>
                    <td style={{ maxWidth: 520 }}>{r.description}</td>
                    <td className="small muted mono">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>
    </>
  );
}
