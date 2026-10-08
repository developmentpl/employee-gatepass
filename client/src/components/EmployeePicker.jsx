import { useEffect, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { api } from '../api.js';
import { Avatar } from './ui.jsx';

/** Type-ahead employee selector. value: {id, name, emp_code} | null */
export default function EmployeePicker({ value, onChange, placeholder = 'Search by name or employee ID', exclude = [] }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api('/users/lookup', { query: { q } })
        .then((rows) => {
          setOpts(rows.filter((r) => !exclude.includes(r.id)));
          setHi(0);
        })
        .catch(() => setOpts([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, exclude.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onDoc = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (o) => {
    onChange(o);
    setOpen(false);
    setQ('');
  };

  if (value) {
    return (
      <div className="chosen">
        <Avatar src={value.photo} name={value.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{value.name}</div>
          <div className="small muted">{value.emp_code}{value.department ? ` · ${value.department}` : ''}</div>
        </div>
        <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label="Clear">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="picker" ref={box}>
      <div className="search" style={{ maxWidth: 'none' }}>
        <Search size={16} />
        <input
          className="input"
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, opts.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter' && opts[hi]) { e.preventDefault(); choose(opts[hi]); }
          }}
        />
      </div>
      {open && (
        <div className="menu">
          {opts.length === 0 && <div className="opt muted">No matching active employees</div>}
          {opts.map((o, i) => (
            <div key={o.id} className={`opt ${i === hi ? 'hi' : ''}`} onMouseDown={() => choose(o)}>
              <Avatar src={o.photo} name={o.name} />
              <div>
                <div style={{ fontWeight: 600 }}>{o.name}</div>
                <div className="small muted">{o.emp_code}{o.department ? ` · ${o.department}` : ''}{o.designation ? ` · ${o.designation}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
