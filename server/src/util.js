export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** Local date-time as 'YYYY-MM-DD HH:mm:ss' (server time zone). */
export function toDateTimeStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export const nowStr = () => toDateTimeStr(new Date());
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function paging(query, defSize = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(query.pageSize, 10) || defSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function clean(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

export function likeTerm(s) {
  return `%${String(s).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

export const ROLES = ['user', 'admin', 'security'];

export const REASON_TYPES = [
  'Client Visit',
  'Official Work',
  'Medical Emergency',
  'Lunch',
  'Personal Work',
  'Bank Work',
  'Other',
];
