import { useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Alert, SearchBox, Tabs, Pagination, Empty, useList } from '../components/ui.jsx';
import { PassModal } from '../components/GatePass.jsx';
import { PassRow } from './MyRequests.jsx';

const EMPTY = {
  pending: 'All caught up — nothing waiting for you.',
  not_returned: 'Nobody is waiting for a decision on not returning.',
  completed: 'No completed requests yet.',
};

export default function Approvals() {
  const list = useList('/passes/approvals', { tab: 'pending', search: '' }, 10);
  const { refreshSummary } = useAuth();
  const [viewId, setViewId] = useState(null);
  const tab = list.filters.tab;
  const counts = list.counts || {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Gate pass requests from employees you are an authority for. A request reaches you in turn: primary first, then secondary and third if not answered in time.</p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={tab}
            onChange={(v) => list.setFilter('tab', v)}
            items={[
              { value: 'pending', label: 'Pending', count: counts.pending },
              { value: 'not_returned', label: 'Did not return', count: counts.not_returned },
              { value: 'completed', label: 'Completed' },
            ]}
          />
          <div className="spacer" />
          <SearchBox value={list.filters.search} onChange={(v) => list.setFilter('search', v)} placeholder="Search name, ID, pass no." />
        </div>
        {tab === 'not_returned' && list.rows.length > 0 && (
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <Alert type="info">These employees did not come back as planned and have given a reason. Accept or reject it to close their gate entry.</Alert>
          </div>
        )}
        {list.error && <div className="card-pad"><Alert type="error">{list.error}</Alert></div>}
        {!list.loading && !list.rows.length ? (
          <Empty icon={CheckSquare} text={EMPTY[tab]} />
        ) : (
          <div className="req-list">
            {list.rows.map((p) => (
              <PassRow
                key={p.id}
                p={p}
                showEmployee
                onClick={() => setViewId(p.id)}
                right={tab !== 'completed' ? <button className="btn sm primary">Review</button> : null}
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
