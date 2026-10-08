import { useState } from 'react';
import { Users, Download, RefreshCw, Send } from 'lucide-react';
import { api, download, fmtDateTime } from '../api.js';
import { Alert, SearchBox, Tabs, Pagination, Empty, useList, useToast } from './ui.jsx';

/** Users enrolled on the eSSL machines, and whether each already has a Gate Pass account. */
export default function DeviceUsers({ hasPullIp }) {
  const toast = useToast();
  const list = useList('/attendance/device-users', { search: '', matched: '' }, 10);
  const [busy, setBusy] = useState('');
  const counts = list.counts || { total: 0, matched: 0 };
  const unmatched = counts.total - counts.matched;

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <Users size={18} color="var(--blue)" />
        <h3>Users on the eSSL machine</h3>
        {counts.total > 0 && (
          <span className="muted small">
            {counts.total} found · {counts.matched} linked · {unmatched} not in Gate Pass
          </span>
        )}
        <div className="spacer" />
        <button
          className="btn sm"
          disabled={!!busy}
          title="Push-connected machines send their user list on their next check-in (within a few seconds)"
          onClick={() => run('ask', async () => {
            await api('/attendance/request-users', { method: 'POST' });
            toast('Asked connected machines for their user list. Refresh in a few seconds.');
            setTimeout(list.reload, 15000);
          })}
        >
          <Send size={15} /> Ask machine (push)
        </button>
        <button
          className="btn sm"
          disabled={!!busy || !hasPullIp}
          title={hasPullIp ? 'Read users over the network from the Device IP set above' : 'Set the Device IP under Network pull first'}
          onClick={() => run('pull', async () => {
            const r = await api('/attendance/pull-users', { method: 'POST' });
            toast(`Read ${r.saved} users from the machine`);
            list.reload();
          })}
        >
          <RefreshCw size={15} className={busy === 'pull' ? 'spin' : ''} /> Read via network
        </button>
        <button
          className="btn sm primary"
          disabled={!unmatched}
          onClick={() => download('/attendance/device-users/export', null, 'essl-device-users.xlsx').catch((e) => toast(e.message, 'error'))}
        >
          <Download size={15} /> Download for bulk upload
        </button>
      </div>
      {counts.total > 0 && unmatched > 0 && (
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <Alert type="info">
            To give these people Gate Pass accounts: click <b>Download for bulk upload</b>, fill in each person’s email, then upload the file in{' '}
            <b>User Management → Bulk upload</b>. Their punches will then show against their name.
          </Alert>
        </div>
      )}
      <div className="toolbar">
        <Tabs
          value={list.filters.matched}
          onChange={(v) => list.setFilter('matched', v)}
          items={[
            { value: '', label: 'All', count: counts.total },
            { value: 'no', label: 'Not in Gate Pass', count: unmatched },
            { value: 'yes', label: 'Linked', count: counts.matched },
          ]}
        />
        <div className="spacer" />
        <SearchBox value={list.filters.search} onChange={(v) => list.setFilter('search', v)} placeholder="Device ID or name" />
      </div>
      {!list.loading && !list.rows.length ? (
        <Empty
          icon={Users}
          text={counts.total ? 'No users match.' : 'No users received from a machine yet. They arrive automatically once the machine connects (push), or click “Read via network”.'}
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Device ID</th>
                <th>Name on machine</th>
                <th>Card</th>
                <th>Gate Pass account</th>
                <th>Machine</th>
                <th>Last received</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.essl_code}>
                  <td className="mono">{r.essl_code}</td>
                  <td>{r.name || <span className="muted">—</span>}</td>
                  <td className="mono small">{r.card_no || '—'}</td>
                  <td>
                    {r.user_id ? (
                      <span className="badge green"><span className="dot" />{r.app_name} · {r.emp_code}</span>
                    ) : (
                      <span className="badge amber"><span className="dot" />Not in Gate Pass</span>
                    )}
                  </td>
                  <td className="mono small">{r.device_sn || '—'}</td>
                  <td className="small muted">{fmtDateTime(r.last_seen)} · {r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
    </div>
  );
}
