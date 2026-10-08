import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload, ArrowLeft } from 'lucide-react';
import { api, download } from '../api.js';
import { Modal, Alert, StatusBadge, Tabs, useToast } from './ui.jsx';

/**
 * Generic bulk upload: download sample → choose file → preview with duplicate/error check → import.
 * columns: [{ key, label, render? }]
 */
export default function BulkUpload({ title, base, sampleName, columns, importable = ['new'], onClose, onDone, note }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const toast = useToast();

  const runPreview = async (f) => {
    setFile(f);
    setErr('');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      setPreview(await api(`${base}/bulk/preview`, { method: 'POST', form }));
      setTab('all');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    const rows = preview.rows.filter((r) => importable.includes(r.status));
    setBusy(true);
    try {
      const res = await api(`${base}/bulk/commit`, { method: 'POST', body: { rows } });
      const parts = Object.entries(res).map(([k, v]) => `${v} ${k}`);
      toast(`Import finished: ${parts.join(', ')}`);
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const okCount = preview ? preview.rows.filter((r) => importable.includes(r.status)).length : 0;
  const shown = preview ? preview.rows.filter((r) => tab === 'all' || r.status === tab) : [];
  const statuses = preview ? Object.entries(preview.counts).filter(([k, v]) => k !== 'total' && v > 0) : [];

  return (
    <Modal
      title={title}
      onClose={onClose}
      size={preview ? 'xwide' : 'wide'}
      icon={<FileSpreadsheet size={20} color="var(--green)" />}
      footer={
        preview ? (
          <>
            <button className="btn" onClick={() => { setPreview(null); setFile(null); }}><ArrowLeft size={16} /> Choose another file</button>
            <div className="spacer" />
            <button className="btn primary" disabled={!okCount || busy} onClick={commit}>
              <Upload size={16} /> {busy ? 'Importing…' : `Import ${okCount} row${okCount === 1 ? '' : 's'}`}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>Close</button>
        )
      }
    >
      <div className="stack">
        {err && <Alert type="error">{err}</Alert>}
        {!preview && (
          <>
            <div className="card card-pad row wrap" style={{ background: '#fafbfd' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <b>Step 1 · Download the sample file</b>
                <div className="muted small">Fill your data in the same columns. The second sheet explains each column.</div>
              </div>
              <button
                className="btn"
                onClick={() => download(`${base}/bulk/sample`, null, sampleName).catch((e) => toast(e.message, 'error'))}
              >
                <Download size={16} /> Download sample
              </button>
            </div>
            <div>
              <b>Step 2 · Upload the filled file</b>
              <div
                className={`dropzone ${over ? 'over' : ''}`}
                style={{ marginTop: 8 }}
                onClick={() => input.current.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) runPreview(f);
                }}
              >
                <Upload size={26} />
                <div style={{ marginTop: 6 }}>{busy ? 'Reading file…' : file ? file.name : 'Drop the .xlsx / .csv file here or click to browse'}</div>
              </div>
              <input
                ref={input}
                type="file"
                hidden
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) runPreview(f);
                }}
              />
            </div>
            {note && <Alert type="info">{note}</Alert>}
          </>
        )}
        {preview && (
          <>
            <div className="row wrap">
              <b>{file?.name}</b>
              <span className="muted">· {preview.counts.total} rows read</span>
              <div className="spacer" />
              <Tabs
                value={tab}
                onChange={setTab}
                items={[{ value: 'all', label: 'All', count: preview.counts.total }, ...statuses.map(([k, v]) => ({ value: k, label: k[0].toUpperCase() + k.slice(1), count: v }))]}
              />
            </div>
            {preview.counts.duplicate > 0 && (
              <Alert type="warn">{preview.counts.duplicate} row(s) are duplicates and will be skipped, so nothing is entered twice.</Alert>
            )}
            {preview.counts.error > 0 && <Alert type="error">{preview.counts.error} row(s) have errors and will be skipped. Fix them in the file and upload again if needed.</Alert>}
            <div className="card table-wrap" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r._row}>
                      <td className="muted">{r._row}</td>
                      <td><StatusBadge status={r.status} /></td>
                      {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key] || <span className="muted">—</span>}</td>)}
                      <td className="small" style={{ color: r.status === 'error' ? 'var(--red)' : 'var(--ink-2)' }}>{r.messages?.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
