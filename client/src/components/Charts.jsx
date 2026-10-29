import { useRef, useState } from 'react';
import { Download, Table2, BarChart3 } from 'lucide-react';

/* Validated categorical order (dataviz reference palette, light mode). Colour follows the
   series, never its rank; text never wears a series colour. */
export const SERIES = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', s4: '#eda100' };
const INK = { primary: '#15202e', secondary: '#4a5a6e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#ffffff' };

function niceMax(v) {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
function ticks(max) {
  const top = niceMax(max);
  const count = top <= 4 ? top : 4;
  return Array.from({ length: count + 1 }, (_, i) => Math.round((top / count) * i * 100) / 100);
}
const compact = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v));

/** Rounded-top bar path: 4px radius at the data end, square at the baseline. */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}
function hbarPath(x, y, w, h, r = 4) {
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h - rr}Q${x + w} ${y + h} ${x + w - rr} ${y + h}H${x}Z`;
}

export function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}><span className="sw" style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="tt">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="tr">
          {r.color && <span className="key" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function useTip(boxRef) {
  const [tip, setTip] = useState(null);
  const show = (e, title, rows) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    let x = e.clientX - box.left + 14;
    const y = Math.max(0, e.clientY - box.top - 10);
    if (x > box.width - 170) x = e.clientX - box.left - 180;
    setTip({ x, y, title, rows });
  };
  return [tip, show, () => setTip(null)];
}

/**
 * Columns over a category axis (days, hours), optionally stacked.
 * series: [{ key, label, color }]; data: [{ [xKey]: …, [series.key]: number }]
 */
export function ColumnChart({ data, xKey, series, xLabel = (v) => v, height = 240, labelEvery }) {
  const box = useRef(null);
  const [tip, show, hide] = useTip(box);
  const W = 640;
  const H = height;
  const m = { l: 36, r: 8, t: 10, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const totals = data.map((d) => series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0));
  const tk = ticks(Math.max(...totals, 0));
  const top = tk[tk.length - 1] || 1;
  const band = pw / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(3, band * 0.62));
  const y = (v) => m.t + ph - (v / top) * ph;
  const every = labelEvery || Math.max(1, Math.ceil(data.length / 10));
  return (
    <div ref={box} style={{ position: 'relative' }} onMouseLeave={hide}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="column chart" fontFamily="Segoe UI, system-ui, sans-serif">
        {tk.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth="1" />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.l + band * i + band / 2;
          let acc = 0;
          const segs = series.map((s) => {
            const v = Number(d[s.key]) || 0;
            const y0 = y(acc);
            acc += v;
            return { s, v, y1: y(acc), y0 };
          }).filter((x) => x.v > 0);
          return (
            <g key={i}>
              {segs.map((g, j) => {
                const isTop = j === segs.length - 1;
                const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
                const h = Math.max(0, g.y0 - g.y1 - gap);
                return isTop ? (
                  <path key={g.s.key} d={barPath(cx - bw / 2, g.y1, bw, h)} fill={g.s.color} />
                ) : (
                  <rect key={g.s.key} x={cx - bw / 2} y={g.y1} width={bw} height={h} fill={g.s.color} />
                );
              })}
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={INK.muted}>{xLabel(d[xKey])}</text>
              )}
              <rect
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={ph}
                fill="transparent"
                onMouseMove={(e) => show(e, xLabel(d[xKey], true), [...series].reverse().map((s) => ({ label: s.label, value: Number(d[s.key]) || 0, color: s.color })))}
              />
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/** Horizontal bars, one series, value at the bar tip. data: [{ label, value }] */
export function BarList({ data, color = SERIES.s1, valueFormat = (v) => v, maxRows = 12 }) {
  const box = useRef(null);
  const [tip, show, hide] = useTip(box);
  const rows = data.slice(0, maxRows);
  const W = 640;
  const rowH = 30;
  const labelW = 170;
  const H = Math.max(rowH, rows.length * rowH) + 6;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const plotW = W - labelW - 60;
  return (
    <div ref={box} style={{ position: 'relative' }} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="bar chart" fontFamily="Segoe UI, system-ui, sans-serif">
        <line x1={labelW} x2={labelW} y1={0} y2={H - 4} stroke={INK.axis} strokeWidth="1" />
        {rows.map((r, i) => {
          const yy = i * rowH + 6;
          const w = (r.value / max) * plotW;
          const label = r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label;
          return (
            <g key={r.label} onMouseMove={(e) => show(e, r.label, [{ label: r.tipLabel || 'Count', value: valueFormat(r.value), color }])}>
              <rect x={0} y={yy - 3} width={W} height={rowH} fill="transparent" />
              <text x={labelW - 8} y={yy + 14} textAnchor="end" fontSize="12" fill={INK.secondary}>{label}</text>
              <path d={hbarPath(labelW, yy + 3, Math.max(w, r.value > 0 ? 2 : 0), 16)} fill={color} />
              <text x={labelW + w + 6} y={yy + 15} fontSize="12" fill={INK.primary} style={{ fontVariantNumeric: 'tabular-nums' }}>{valueFormat(r.value)}</text>
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/** Save the SVG inside a card as a PNG, with the chart title on top. */
async function downloadPng(cardEl, title, filename) {
  const svg = cardEl.querySelector('.chart-body svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const scale = 2;
  const legend = [...cardEl.querySelectorAll('.legend > span')].map((s) => ({ color: s.querySelector('.sw')?.style.background, text: s.textContent }));
  const head = 34 + (legend.length ? 22 : 0);
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', vb.width);
  clone.setAttribute('height', vb.height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = (vb.width + 32) * scale;
  canvas.height = (vb.height + head + 16) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, vb.width + 32, vb.height + head + 16);
  ctx.fillStyle = INK.primary;
  ctx.font = '600 15px Segoe UI, system-ui, sans-serif';
  ctx.fillText(title, 16, 24);
  let lx = 16;
  ctx.font = '12px Segoe UI, system-ui, sans-serif';
  for (const l of legend) {
    ctx.fillStyle = l.color;
    ctx.fillRect(lx, 38, 10, 10);
    ctx.fillStyle = INK.secondary;
    ctx.fillText(l.text, lx + 15, 47);
    lx += ctx.measureText(l.text).width + 34;
  }
  ctx.drawImage(img, 16, head, vb.width, vb.height);
  URL.revokeObjectURL(url);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}

/**
 * Card around a chart, with a table view (the accessible / exact-number view)
 * and a PNG download. table: { columns: [label…], rows: [[…]] }
 */
export function ChartCard({ title, sub, table, file, children, empty, png = true }) {
  const ref = useRef(null);
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="card chart-card" ref={ref}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="spacer" />
        {table && (
          <button className="icon-btn no-print" title={asTable ? 'Show chart' : 'Show table'} onClick={() => setAsTable((v) => !v)}>
            {asTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
          </button>
        )}
        {png && !asTable && !empty && (
          <button className="icon-btn no-print" title="Download chart as PNG" onClick={() => downloadPng(ref.current, title, `${file || 'chart'}.png`)}>
            <Download size={16} />
          </button>
        )}
      </div>
      <div className="chart-body">
        {empty ? (
          <div className="empty" style={{ padding: 30 }}>{empty}</div>
        ) : asTable && table ? (
          <div className="chart-table">
            <table>
              <thead>
                <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
