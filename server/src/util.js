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

export const ROLES = ['user', 'admin', 'security', 'security_admin'];
/** Roles an employee account can have (security gate logins are managed separately). */
export const EMPLOYEE_ROLES = ['user', 'admin', 'security_admin'];

export const REASON_TYPES = ['Official Purpose', 'Personal Purpose'];

/** SQL: does punch p belong to user u? eSSL punches match the eSSL ID, Solus punches the Solus ID (else the Employee ID). */
export const PUNCH_MATCH = (u = 'u', p = 'p') =>
  `((${p}.vendor='essl' AND ${p}.essl_code = COALESCE(NULLIF(${u}.essl_code,''), ${u}.emp_code)) OR (${p}.vendor='solus' AND ${p}.essl_code = COALESCE(NULLIF(${u}.solus_code,''), ${u}.emp_code)))`;

/** 'HH:MM' from a TIME or DATETIME string. */
export const hm = (t) => (t ? String(t).slice(t.length > 8 ? 11 : 0, (t.length > 8 ? 11 : 0) + 5) : '');
