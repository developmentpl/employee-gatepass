import XLSX from 'xlsx';
import { HttpError, toDateTimeStr } from '../util.js';

const norm = (h) => String(h || '').toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Parse an uploaded xlsx/xls/csv buffer into objects keyed by our field names.
 * headerMap: { fieldName: ['alias1', 'alias2', ...] } (aliases compared after normalisation)
 */
export function parseSheet(buffer, headerMap, { dates = false } = {}) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: dates, raw: false });
  } catch {
    throw new HttpError(400, 'Could not read the file. Upload an .xlsx, .xls or .csv file.');
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: dates });
  if (dates) {
    for (const r of raw)
      for (const k of Object.keys(r)) if (r[k] instanceof Date) r[k] = toDateTimeStr(r[k]);
  }
  if (!raw.length) throw new HttpError(400, 'The file has no data rows');

  const lookup = {};
  for (const [field, aliases] of Object.entries(headerMap)) {
    for (const a of [field, ...aliases]) lookup[norm(a)] = field;
  }
  const rows = raw.map((r, i) => {
    const o = { _row: i + 2 };
    for (const [k, v] of Object.entries(r)) {
      const f = lookup[norm(k)];
      if (f) o[f] = String(v ?? '').trim();
    }
    return o;
  });
  // drop fully empty rows
  return rows.filter((r) => Object.keys(r).some((k) => k !== '_row' && r[k]));
}

export function buildWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows, widths } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function sendXlsx(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
