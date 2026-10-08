import { useEffect, useRef, useState, useCallback } from 'react';
import { Radio, Network, Usb, RefreshCw, Download, Upload, Save, Fingerprint } from 'lucide-react';
import { api, download, fmtDate, fmtTime, fmtDateTime, todayISO } from '../../api.js';
import { Avatar, Alert, Field, SearchBox, Pagination, Empty, useList, useMeta, useToast } from '../../components/ui.jsx';
import DeviceUsers from '../../components/DeviceUsers.jsx';

function Stat({ label, value, hint }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

function ImportResult({ r }) {
  return (
    <Alert type={r.inserted ? 'ok' : 'info'}>
      Read {r.valid} punches: <b>{r.inserted} new</b>, {r.duplicates} already present (skipped)
      {r.invalid ? `, ${r.invalid} unreadable lines` : ''}.
      {r.unknownCount > 0 && (
        <div className="small" style={{ marginTop: 4 }}>
          {r.unknownCount} device ID(s) don’t match any user: {r.unknownIds.join(', ')}
          {r.unknownCount > r.unknownIds.length ? '…' : ''}. Set their “eSSL User ID” in User Management.
        </div>
      )}
    </Alert>
  );
}

export default function AttendancePage() {
  const meta = useMeta();
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);
  const list = useList('/attendance/punches', { from: todayISO(), to: todayISO(), search: '', source: '', department: '' }, 25);
  const f = list.filters;

  const [serverInfo, setServerInfo] = useState(null);
  const loadSummary = useCallback(() => api('/attendance/summary').then(setSummary).catch(() => {}), []);
  useEffect(() => {
    loadSummary();
    api('/attendance/settings').then(setSettings).catch((e) => toast(e.message, 'error'));
    api('/attendance/server-info').then(setServerInfo).catch(() => {});
  }, [loadSummary, toast]);
  // refresh every 10 s while waiting for the first device, then every 30 s
  const waiting = !summary?.devices?.length;
  useEffect(() => {
    const t = setInterval(() => {
      loadSummary();
      if (waiting) list.reload();
    }, waiting ? 10000 : 30000);
    return () => clearInterval(t);
  }, [waiting, loadSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setSettings({ ...settings, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      await api('/attendance/settings', { method: 'PUT', body: settings });
      toast('eSSL settings saved');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const pull = async () => {
    setPulling(true);
    setPullResult(null);
    try {
      await api('/attendance/settings', { method: 'PUT', body: settings });
      const r = await api('/attendance/pull', { method: 'POST' });
      setPullResult(r);
      list.reload();
      loadSummary();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPulling(false);
      api('/attendance/settings').then(setSettings).catch(() => {});
    }
  };

  const importFile = async (file) => {
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api('/attendance/import', { method: 'POST', form });
      setImportResult(r);
      list.reload();
      loadSummary();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const port = serverInfo?.esslPort || serverInfo?.port || window.location.port || 80;
  const webPort = serverInfo?.port || window.location.port || 80;
  const ips = serverInfo?.ips || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Attendance (eSSL)</h1>
          <p>Punches from the eSSL biometric machines — received in real time, pulled over the network, or imported from a USB pen drive.</p>
        </div>
      </div>

      <div className="stats">
        <Stat label="Active employees" value={summary?.active} />
        <Stat label="Punched in today" value={summary?.present} hint={summary ? `${Math.round((summary.present / Math.max(1, summary.active)) * 100)}% of active` : ''} />
        <Stat label="Punches today" value={summary?.punches} hint={summary?.lastPunch ? `Last at ${fmtTime(summary.lastPunch.punch_time)} via ${summary.lastPunch.source}` : 'No punches yet'} />
        <Stat label="Out on gate pass now" value={summary?.outOnPass} />
      </div>

      {settings && (
        <div className="conn-grid">
          <div className="card">
            <div className="card-head"><Radio size={18} color="var(--blue)" /><h3>Real-time push (ADMS)</h3><span className="badge green">Recommended</span></div>
            <div className="card-pad stack">
              <div className="small">
                On each eSSL machine open <b>Menu → Comm. → Cloud Server Setting</b> and enter:
              </div>
              <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
                <dt>Server Mode</dt><dd>ADMS</dd>
                <dt>Server address</dt>
                <dd>
                  {ips.length ? (
                    <div className="stack" style={{ gap: 4 }}>
                      {ips.map((x) => (
                        <div key={x.ip}><code className="url">{x.ip}</code> <span className="muted small">{x.adapter}</span></div>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">Run <span className="mono">ipconfig</span> on this PC</span>
                  )}
                </dd>
                <dt>Server port</dt><dd><code className="url">{port}</code></dd>
                <dt>Domain name / HTTPS / Proxy</dt><dd>All Off</dd>
              </dl>
              {ips.length > 1 && <div className="small muted">Use the address on the same network as the machine (usually the Ethernet / Wi-Fi one, not VirtualBox / VPN).</div>}
              <Field label="Allowed device serial numbers" hint="Optional. Comma separated. Blank accepts any device on the network.">
                <input className="input" value={settings['essl.push.allowedSN']} onChange={set('essl.push.allowedSN')} placeholder="e.g. CQZ7224460" />
              </Field>
              <div>
                <b className="small">Devices seen</b>
                {summary?.devices?.length ? (
                  <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                    {summary.devices.map((d) => {
                      const mins = (Date.now() - new Date(d.lastSeen.replace(' ', 'T')).getTime()) / 60000;
                      return (
                        <div key={d.sn} className="row small">
                          <span className={`badge ${!d.allowed ? 'red' : mins < 3 ? 'green' : 'amber'}`}><span className="dot" />{!d.allowed ? 'Blocked' : mins < 3 ? 'Online' : 'Offline'}</span>
                          <span className="mono">{d.sn}</span>
                          <span className="muted">{d.ip?.replace('::ffff:', '')} · seen {fmtDateTime(d.lastSeen)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : serverInfo?.hosted ? (
                  <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                    <Alert type="info">
                      This is the online test site. eSSL machines on the plant network usually cannot reach it, so test attendance with the{' '}
                      <b>USB pen drive import</b>. Live push from the machines works on the on-premise server.
                    </Alert>
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                    <Alert type="warn">No machine has connected yet. This page checks every 10 seconds.</Alert>
                    <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      <li>Enter the address in <b>Cloud Server Setting</b>, not in Comm → Ethernet (that is the machine’s <i>own</i> IP and must stay different from this PC).</li>
                      <li>The machine and this PC must be on the same network, e.g. machine <span className="mono">192.168.0.x</span> when this PC is <span className="mono">192.168.0.101</span>.</li>
                      <li>Allow ports {webPort} and {port} in Windows Firewall (command below, run PowerShell as Administrator).</li>
                      <li>From a phone on the same Wi-Fi, open <span className="mono">http://{ips[0]?.ip || '<PC-IP>'}:{port}/api/health</span>. If it does not show <span className="mono">{'{"ok":true}'}</span>, the firewall or network is blocking it.</li>
                      <li>Restart the machine after saving. Each request it sends is printed in the server window as <span className="mono">[eSSL] …</span>.</li>
                    </ol>
                    <code className="url small" style={{ wordBreak: 'break-all' }}>netsh advfirewall firewall add rule name="GatePass" dir=in action=allow protocol=TCP localport={webPort === port ? port : `${webPort},${port}`}</code>
                  </div>
                )}
              </div>
              <div><button className="btn sm" onClick={save} disabled={saving}><Save size={15} /> Save</button></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><Network size={18} color="var(--blue)" /><h3>Network pull (TCP/IP)</h3></div>
            <div className="card-pad stack">
              <div className="small">Reads logs directly from the machine’s IP, like eTimeTrackLite does.</div>
              <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr' }}>
                <Field label="Device IP">
                  <input className="input" value={settings['essl.pull.ip']} onChange={set('essl.pull.ip')} placeholder="192.168.1.201" />
                </Field>
                <Field label="Port">
                  <input className="input" value={settings['essl.pull.port']} onChange={set('essl.pull.port')} />
                </Field>
              </div>
              <label className="row small">
                <input type="checkbox" checked={settings['essl.pull.auto'] === '1'} onChange={set('essl.pull.auto')} />
                Pull automatically every
                <input className="input" style={{ width: 64, height: 30 }} type="number" min="1" value={settings['essl.pull.intervalMin']} onChange={set('essl.pull.intervalMin')} />
                minutes
              </label>
              {settings['essl.pull.lastRun'] && (
                <div className="small muted">Last run {fmtDateTime(settings['essl.pull.lastRun'])}: {settings['essl.pull.lastResult']}</div>
              )}
              {pullResult && <ImportResult r={pullResult} />}
              <div className="row">
                <button className="btn sm" onClick={save} disabled={saving}><Save size={15} /> Save</button>
                <button className="btn sm primary" onClick={pull} disabled={pulling || !settings['essl.pull.ip']}>
                  <RefreshCw size={15} className={pulling ? 'spin' : ''} /> {pulling ? 'Pulling…' : 'Pull now'}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><Usb size={18} color="var(--blue)" /><h3>USB pen drive import</h3></div>
            <div className="card-pad stack">
              <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Insert a pen drive in the eSSL machine.</li>
                <li><b>Menu → USB Manager (Data Mgt.) → Download → Attendance Data</b>.</li>
                <li>Plug the pen drive into this PC and upload the <span className="mono">…attlog.dat</span> file.</li>
              </ol>
              <div className="small muted">Also accepts CSV / Excel attendance exports from eTimeTrackLite. Duplicate punches are skipped automatically.</div>
              <input ref={fileRef} type="file" hidden accept=".dat,.txt,.csv,.xlsx,.xls" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) importFile(x); }} />
              {importResult && <ImportResult r={importResult} />}
              <div>
                <button className="btn sm primary" onClick={() => fileRef.current.click()} disabled={importing}>
                  <Upload size={15} /> {importing ? 'Importing…' : 'Choose attendance file'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DeviceUsers hasPullIp={!!settings?.['essl.pull.ip']} />

      <div className="card">
        <div className="card-head">
          <Fingerprint size={18} />
          <h3>Punch log</h3>
          <div className="spacer" />
          <button className="btn sm" onClick={() => download('/attendance/punches', { ...f, format: 'csv' }, `attendance-${f.from}-to-${f.to}.csv`).catch((e) => toast(e.message, 'error'))}>
            <Download size={15} /> Export
          </button>
        </div>
        <div className="toolbar">
          <SearchBox value={f.search} onChange={(v) => list.setFilter('search', v)} placeholder="Name, employee or eSSL ID" />
          <select className="input" value={f.department} onChange={(e) => list.setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="input" value={f.source} onChange={(e) => list.setFilter('source', e.target.value)}>
            <option value="">All sources</option>
            <option value="push">Real-time push</option>
            <option value="pull">Network pull</option>
            <option value="usb">USB / file</option>
          </select>
          <div className="row">
            <input className="input" type="date" value={f.from} onChange={(e) => list.setFilter('from', e.target.value || todayISO())} />
            <span className="muted">to</span>
            <input className="input" type="date" value={f.to} onChange={(e) => list.setFilter('to', e.target.value || f.from)} />
          </div>
        </div>
        {!list.loading && !list.rows.length ? (
          <Empty icon={Fingerprint} text="No punches in this period." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Direction</th>
                  <th>Device</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtTime(r.punch_time)}<div className="small muted">{fmtDate(r.punch_time)}</div></td>
                    <td>
                      {r.user_id ? (
                        <div className="person">
                          <Avatar src={r.photo} name={r.name} />
                          <div><div className="nm">{r.name}</div><div className="sub">{r.emp_code}</div></div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.device_name || <span className="muted">Unknown</span>}</div>
                          <div className="small muted">Device ID <span className="mono">{r.essl_code}</span> · not in Gate Pass</div>
                        </div>
                      )}
                    </td>
                    <td>{r.department || '—'}</td>
                    <td>{r.direction === 'unknown' ? <span className="muted">—</span> : <span className={`badge ${r.direction === 'in' ? 'green' : 'amber'}`}>{r.direction.toUpperCase()}</span>}</td>
                    <td className="mono small">{r.device_sn || '—'}</td>
                    <td><span className="badge">{{ push: 'Push', pull: 'Pull', usb: 'USB', manual: 'Manual' }[r.source]}</span></td>
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
