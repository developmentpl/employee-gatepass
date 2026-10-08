const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map((h) => cell(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => cell(typeof h.value === 'function' ? h.value(r) : r[h.key])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n'));
}
