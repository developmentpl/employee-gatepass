import { useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Alert, SearchBox, Tabs, Pagination, Empty, useList } from '../components/ui.jsx';
import { PassModal } from '../components/GatePass.jsx';
import { PassRow } from './MyRequests.jsx';

export default function Approvals() {
  const list = useList('/passes/approvals', { tab: 'pending', search: '' }, 10);
  const { summary, refreshSummary } = useAuth();
  const [viewId, setViewId] = useState(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Gate pass requests from employees you are an authority for.</p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={list.filters.tab}
            onChange={(v) => list.setFilter('tab', v)}
            items={[
              { value: 'pending', label: 'Pending', count: summary.approvalsPending },
              { value: 'completed', label: 'Completed' },
            ]}
          />
          <div className="spacer" />
          <SearchBox value={list.filters.search} onChange={(v) => list.setFilter('search', v)} placeholder="Search name, ID, pass no." />
        </div>
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={CheckSquare} text={list.filters.tab === 'pending' ? 'All caught up — nothing waiting for you.' : 'No completed requests yet.'} />
        ) : (
          <div className="req-list">
            {list.rows.map((p) => (
              <PassRow
                key={p.id}
                p={p}
                showEmployee
                onClick={() => setViewId(p.id)}
                right={p.status === 'pending' ? <button className="btn sm primary">Review</button> : null}
              />
            ))}
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
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
