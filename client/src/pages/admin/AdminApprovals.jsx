import { useState } from 'react';
import { Download, ClipboardCheck } from 'lucide-react';
import { download, fmtDate, fmtTime, fmtDateTime, todayISO } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, SearchBox, Tabs, Pagination, Empty, StatusBadge, useList, useMeta, useToast } from '../../components/ui.jsx';
import { PassModal } from '../../components/GatePass.jsx';

export default function AdminApprovals() {
  const meta = useMeta();
  const toast = useToast();
  const { summary, refreshSummary } = useAuth();
  const list = useList('/passes/all', { tab: 'pending', search: '', department: '', status: '', from: '', to: '' });
  const [viewId, setViewId] = useState(null);
  const f = list.filters;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Every gate pass request in the plant. Admins can approve or reject on behalf of authorities if needed.</p>
        </div>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() => download('/passes/all', { ...f, format: 'csv' }, `gate-passes-${todayISO()}.csv`).catch((e) => toast(e.message, 'error'))}
        >
          <Download size={17} /> Export
        </button>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={f.tab}
            onChange={(v) => {
              list.setFilter('tab', v);
              list.setFilter('status', '');
            }}
            items={[
              { value: 'pending', label: 'Pending', count: summary.adminPending },
              { value: 'completed', label: 'Completed' },
              { value: 'all', label: 'All' },
            ]}
          />
          <SearchBox value={f.search} onChange={(v) => list.setFilter('search', v)} placeholder="Name, ID, pass no., reason" />
          <select className="input" value={f.department} onChange={(e) => list.setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d}>{d}</option>)}
          </select>
          {f.tab !== 'pending' && (
            <select className="input" value={f.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Any status</option>
              {f.tab === 'all' && <option value="pending">Pending</option>}
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}
          <div className="row">
            <input className="input" type="date" value={f.from} onChange={(e) => list.setFilter('from', e.target.value)} title="From date" />
            <span className="muted">to</span>
            <input className="input" type="date" value={f.to} onChange={(e) => list.setFilter('to', e.target.value)} title="To date" />
          </div>
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={ClipboardCheck} text="No requests match." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pass</th>
                  <th>Employee</th>
                  <th>Reason</th>
                  <th>Out → In</th>
                  <th>Authorities</th>
                  <th>Status</th>
                  <th>Decided</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setViewId(p.id)}>
                    <td>
                      <div className="mono nowrap">{p.pass_no}</div>
                      <div className="small muted">{fmtDate(p.pass_date)}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.emp_name}</div>
                      <div className="small muted">{p.emp_code} · {p.department}</div>
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <span className="badge blue">{p.reason_type}</span>
                      <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.reason}</div>
                    </td>
                    <td className="nowrap">
                      {fmtTime(p.out_time)} → {p.coming_back ? fmtTime(p.expected_in_time) : <span className="muted">not returning</span>}
                    </td>
                    <td className="small">{p.approvers}</td>
                    <td>
                      <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                        <StatusBadge status={p.status} />
                        {p.status === 'approved' && p.gate_status !== 'not_left' && <StatusBadge status={p.gate_status} />}
                      </div>
                    </td>
                    <td className="small">
                      {p.decided_by_name ? (
                        <>
                          {p.decided_by_name}
                          <div className="muted">{fmtDateTime(p.decided_at)}</div>
                        </>
                      ) : p.status === 'cancelled' ? (
                        <span className="muted">Cancelled by employee</span>
                      ) : (
                        <span className="muted">—</span>
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
      {viewId && (
        <PassModal
          id={viewId}
          onClose={() => setViewId(null)}
          onChanged={() => {
            list.reload();
            refreshSummary();
          }}
        />
      )}
    </>
  );
}
