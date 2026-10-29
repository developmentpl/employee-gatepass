import { useEffect, useRef, useState } from 'react';
import { Send, Database, Upload, RefreshCw, Save, Copy, KeyRound, FlaskConical } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { Alert, Field, Confirm, useToast, PasswordInput } from './ui.jsx';

function ImportResult({ r }) {
  return (
    <Alert type={r.inserted ? 'ok' : 'info'}>
      Read {r.valid} punches: <b>{r.inserted} new</b>, {r.duplicates} already present (skipped)
      {r.invalid ? `, ${r.invalid} rows without employee or time` : ''}.
      {r.unknownCount > 0 && (
        <div className="small" style={{ marginTop: 4 }}>
          {r.unknownCount} Solus ID(s) don’t match any user: {r.unknownIds.join(', ')}{r.unknownCount > r.unknownIds.length ? '…' : ''}. Set their “Solus User ID” in User Access Management.
        </div>
      )}
    </Alert>
  );
}

/**
 * Solus (iSOLUS ATTENDANCE) has no published machine protocol, so three ways in are offered,
 * ready for testing once Solus / IT share their details.
 */
export default function SolusPanel({ ips, port, onData }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState({});
  const [preview, setPreview] = useState(null);
  const [confirmKey, setConfirmKey] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  const load = () => api('/attendance/solus/settings').then(setS).catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });
  const run = async (key, fn) => {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const saveDb = () => run('save', async () => {
    const body = Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('solus.db.') && !['solus.db.lastRun', 'solus.db.lastResult'].includes(k)));
    await api('/attendance/solus/settings', { method: 'PUT', body });
    toast('Solus settings saved');
    return true;
  });

  if (!s) return <div className="empty">Loading…</div>;
  const host = ips[0]?.ip || '<server IP>';
  const pushUrl = port === 443 ? `https://${host}/solus/punches` : `http://${host}:${port}/solus/punches`;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => {});

  return (
    <>
      <Alert type="info">
        Solus (iSOLUS ATTENDANCE) does not publish how its machines talk to other software, so there are three ways to bring its punches in. Ask Solus or IT which one suits you. Solus punches are matched to employees by their <b>Solus User ID</b>, or by Employee ID if that is blank.
      </Alert>
      <div className="conn-grid" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-head"><Send size={18} color="var(--blue)" /><h3>Push URL (API)</h3></div>
          <div className="card-pad stack">
            <div className="small">Solus or an integrator sends each punch to this address with the API key in the <span className="mono">X-API-Key</span> header.</div>
            <dl className="kv" style={{ gridTemplateColumns: '70px 1fr' }}>
              <dt>URL</dt>
              <dd><code className="key">{pushUrl}</code> <button className="icon-btn" title="Copy" onClick={() => copy(pushUrl)}><Copy size={14} /></button></dd>
              <dt>API key</dt>
              <dd><code className="key">{s['solus.push.apiKey']}</code> <button className="icon-btn" title="Copy" onClick={() => copy(s['solus.push.apiKey'])}><Copy size={14} /></button></dd>
            </dl>
            <div className="small muted">
              Body (JSON): <span className="mono">{'[{"employeeId":"10234","time":"2026-10-24 09:01:00","direction":"IN","device":"Main gate"}]'}</span>, or CSV text with a header row.
            </div>
            {s['solus.push.lastAt'] ? (
              <div className="small muted">Last received {fmtDateTime(s['solus.push.lastAt'])}: {s['solus.push.lastResult']}</div>
            ) : (
              <div className="small muted">Nothing received yet.</div>
            )}
            <div><button className="btn sm" onClick={() => setConfirmKey(true)}><KeyRound size={15} /> New API key</button></div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><Database size={18} color="var(--blue)" /><h3>Read from iSOLUS database</h3></div>
          <div className="card-pad stack">
            <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Database type">
                <select className="input" value={s['solus.db.engine']} onChange={set('solus.db.engine')}>
                  <option value="mssql">SQL Server</option>
                  <option value="mysql">MySQL</option>
                </select>
              </Field>
              <Field label="Server / IP">
                <input className="input" value={s['solus.db.host']} onChange={set('solus.db.host')} placeholder="192.168.0.20" />
              </Field>
              <Field label="Port">
                <input className="input" value={s['solus.db.port']} onChange={set('solus.db.port')} />
              </Field>
              <Field label="Database name">
                <input className="input" value={s['solus.db.database']} onChange={set('solus.db.database')} />
              </Field>
              <Field label="User">
                <input className="input" value={s['solus.db.user']} onChange={set('solus.db.user')} autoComplete="off" />
              </Field>
              <Field label="Password">
                <PasswordInput value={s['solus.db.password']} onChange={set('solus.db.password')} autoComplete="new-password" />
              </Field>
            </div>
            <Field
              label="Query"
              hint="Must return an employee column (code) and a punch time column (time); direction and device are optional. {since} is replaced with the last punch already read, so each run only picks up new punches."
            >
              <textarea className="input mono" rows={4} value={s['solus.db.query']} onChange={set('solus.db.query')} />
            </Field>
            <label className="row small">
              <input type="checkbox" checked={s['solus.db.auto'] === '1'} onChange={set('solus.db.auto')} />
              Read automatically every
              <input className="input" style={{ width: 64, height: 30 }} type="number" min="1" value={s['solus.db.intervalMin']} onChange={set('solus.db.intervalMin')} />
              minutes
            </label>
            {s['solus.db.lastRun'] && <div className="small muted">Last run {fmtDateTime(s['solus.db.lastRun'])}: {s['solus.db.lastResult']}</div>}
            {preview && (
              <Alert type={preview.punches.some(Boolean) ? 'ok' : 'warn'}>
                Test read {preview.rows.length} row(s).{' '}
                {preview.punches.some(Boolean)
                  ? `First punch: ${preview.punches.find(Boolean).code} at ${preview.punches.find(Boolean).time}.`
                  : `No usable punches. Columns returned: ${Object.keys(preview.rows[0] || {}).join(', ') || 'none'}.`}
              </Alert>
            )}
            {result.pull && <ImportResult r={result.pull} />}
            <div className="row wrap">
              <button className="btn sm" onClick={saveDb} disabled={!!busy}><Save size={15} /> Save</button>
              <button
                className="btn sm"
                disabled={!!busy || !s['solus.db.host']}
                onClick={() => run('test', async () => {
                  if (await saveDb()) setPreview(await api('/attendance/solus/test', { method: 'POST' }));
                })}
              >
                <FlaskConical size={15} /> Test query
              </button>
              <button
                className="btn sm primary"
                disabled={!!busy || !s['solus.db.host']}
                onClick={() => run('pull', async () => {
                  if (!(await saveDb())) return;
                  const r = await api('/attendance/solus/pull', { method: 'POST' });
                  setResult({ ...result, pull: r });
                  onData?.();
                  load();
                })}
              >
                <RefreshCw size={15} className={busy === 'pull' ? 'spin' : ''} /> Read now
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><Upload size={18} color="var(--blue)" /><h3>Import Solus export file</h3></div>
          <div className="card-pad stack">
            <div className="small">Export the attendance / punch report from the iSOLUS software as CSV or Excel and upload it here. Duplicate punches are skipped.</div>
            <div className="small muted">Columns are recognised by name, e.g. <i>Employee Code</i> + <i>Punch Time</i>, or <i>Emp ID</i> + <i>Date</i> + <i>Time</i>; optional <i>Direction / In-Out</i> and <i>Reader / Device</i>.</div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,.xlsx,.xls,.txt"
              onChange={(e) => {
                const x = e.target.files?.[0];
                e.target.value = '';
                if (!x) return;
                run('file', async () => {
                  const form = new FormData();
                  form.append('file', x);
                  const r = await api('/attendance/solus/import', { method: 'POST', form });
                  setResult({ ...result, file: r });
                  onData?.();
                });
              }}
            />
            {result.file && <ImportResult r={result.file} />}
            <div>
              <button className="btn sm primary" onClick={() => fileRef.current.click()} disabled={!!busy}>
                <Upload size={15} /> {busy === 'file' ? 'Importing…' : 'Choose Solus file'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmKey && (
        <Confirm
          title="Generate a new API key?"
          message="The current key stops working immediately. Anything sending punches with it must be updated."
          confirmText="Generate new key"
          danger
          onClose={() => setConfirmKey(false)}
          onConfirm={async () => {
            const r = await api('/attendance/solus/new-key', { method: 'POST' });
            setS({ ...s, 'solus.push.apiKey': r.key });
            toast('New API key generated');
          }}
        />
      )}
    </>
  );
}
