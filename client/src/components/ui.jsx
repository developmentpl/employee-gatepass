import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Search, ChevronLeft, ChevronRight, Inbox, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { api, initials } from '../api.js';

/* ---------------- toasts ---------------- */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------- modal ---------------- */
export function Modal({ title, onClose, children, footer, size = '', icon }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon}
          <h3>{title}</h3>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmText = 'Confirm', danger, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                toast(e.message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Please wait…' : confirmText}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
      {children}
    </Modal>
  );
}

/* ---------------- small bits ---------------- */
export function Avatar({ src, name, size = '' }) {
  return <span className={`avatar ${size}`}>{src ? <img src={src} alt="" /> : initials(name)}</span>;
}

export function Alert({ type = 'info', children }) {
  const Icon = type === 'error' ? AlertCircle : type === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`alert ${type}`}>
      <Icon size={17} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

const STATUS = {
  pending: ['amber', 'Pending'],
  approved: ['green', 'Approved'],
  rejected: ['red', 'Rejected'],
  cancelled: ['', 'Cancelled'],
  new: ['green', 'New'],
  update: ['blue', 'Update'],
  duplicate: ['amber', 'Duplicate'],
  error: ['red', 'Error'],
  not_left: ['', 'Not left'],
  out: ['amber', 'Out of plant'],
  returned: ['green', 'Returned'],
};
export function StatusBadge({ status, label }) {
  const [c, l] = STATUS[status] || ['', status];
  return (
    <span className={`badge ${c}`}>
      <span className="dot" />
      {label || l}
    </span>
  );
}

export function Field({ label, required, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label>
          {label} {required && <span className="reqmark">*</span>}
        </label>
      )}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  const [v, setV] = useState(value || '');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onChange(v), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className="search">
      <Search size={16} />
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
    </div>
  );
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} className={value === it.value ? 'on' : ''} onClick={() => onChange(it.value)} role="tab">
          {it.label}
          {it.count > 0 && <span className="pill">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span className="info">
        {from}–{to} of {total}
      </span>
      <div className="spacer" />
      {onPageSize && (
        <select className="input" style={{ height: 30 }} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {[10, 20, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      )}
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      <span className="small">
        Page {page} of {pages}
      </span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function Empty({ text = 'Nothing here yet', icon: Icon = Inbox }) {
  return (
    <div className="empty">
      <Icon size={36} />
      <div>{text}</div>
    </div>
  );
}

/* ---------------- data hooks ---------------- */

/** Paginated list with filters; refetches when filters/page change. */
export function useList(path, initialFilters = {}, defaultPageSize = 20) {
  const [filters, setFiltersState] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [data, setData] = useState({ rows: [], total: 0 });  // also keeps extra fields the API returns (e.g. counts)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(path, { query: { ...filters, page, pageSize } })
      .then((d) => alive && (setData(d), setError('')))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, JSON.stringify(filters), page, pageSize, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = useCallback((k, v) => {
    setFiltersState((f) => ({ ...f, [k]: v }));
    setPage(1);
  }, []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...data, filters, setFilter, page, setPage, pageSize, setPageSize: (n) => (setPageSize(n), setPage(1)), loading, error, reload };
}

export function useMeta() {
  const [meta, setMeta] = useState({ departments: [], shifts: [], reasonTypes: [], roles: [] });
  useEffect(() => {
    api('/meta').then(setMeta).catch(() => {});
  }, []);
  return meta;
}
