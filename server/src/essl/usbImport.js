import { parseSheet } from '../services/sheet.js';
import { parseDateTime, statusToDirection } from './punches.js';
import { HttpError } from '../util.js';

/**
 * Parse an attendance file copied from the eSSL machine with a USB pen drive
 * (Menu → USB Manager / Data Mgt → Download → Attendance Data, gives e.g. "1_attlog.dat"),
 * or an attendance report exported to CSV / Excel from eTimeTrackLite.
 */
export function parseAttendanceFile(originalName, buffer) {
  const name = String(originalName || '').toLowerCase();
  if (/\.(xlsx|xls|csv)$/.test(name)) return parseSpreadsheet(buffer);
  return parseAttlog(buffer.toString('utf8'));
}

/**
 * attlog.dat lines (tab or space separated):
 *   PIN  YYYY-MM-DD HH:MM:SS  col3  col4  col5  col6
 * Different firmware put the in/out state in col3 or col4; we read col4 when col3 is the
 * machine number "1" on every line, otherwise col3.
 */
export function parseAttlog(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/.exec(line);
    if (!m) {
      parsed.push(null);
      continue;
    }
    const rest = m[3].split(/\s+/).filter(Boolean);
    parsed.push({ code: m[1], time: parseDateTime(m[2]), rest });
  }
  const good = parsed.filter(Boolean);
  if (!good.length) throw new HttpError(400, 'No attendance lines found. Expected the attlog.dat file from the eSSL USB download.');
  const col3AlwaysOne = good.every((p) => p.rest[0] === '1');
  return parsed.map((p) =>
    p
      ? {
          code: p.code,
          time: p.time,
          direction: statusToDirection(col3AlwaysOne ? p.rest[1] : p.rest[0]),
          verify: p.rest[col3AlwaysOne ? 2 : 1] ?? null,
          device: 'USB',
        }
      : null
  );
}

const HEADER_MAP = {
  code: ['Employee Code', 'Emp Code', 'EmpCode', 'Employee ID', 'Emp ID', 'User ID', 'UserId', 'PIN', 'eSSL ID', 'Enroll No', 'EnrollNo', 'Card No'],
  datetime: ['Log Date', 'LogDate', 'Date Time', 'DateTime', 'Punch Time', 'PunchTime', 'Log Time', 'Attendance Time'],
  date: ['Date', 'Punch Date', 'Att Date'],
  time: ['Time', 'Punch Time Only', 'In Time'],
  direction: ['Direction', 'In/Out', 'InOut', 'Status', 'Punch Type'],
  device: ['Device', 'Device Name', 'Serial Number', 'Device SN'],
};

function parseSpreadsheet(buffer) {
  const rows = parseSheet(buffer, HEADER_MAP, { dates: true });
  return rows.map((r) => {
    const time = r.datetime ? parseDateTime(r.datetime) : r.date && r.time ? parseDateTime(r.date, r.time) : null;
    if (!r.code || !time) return null;
    const d = String(r.direction || '').toLowerCase();
    const direction = /^(in|check-?in|0)$/.test(d) ? 'in' : /^(out|check-?out|1)$/.test(d) ? 'out' : 'unknown';
    return { code: r.code, time, direction, device: r.device || 'File' };
  });
}
