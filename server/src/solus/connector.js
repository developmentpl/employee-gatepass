import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { getSetting, setSetting } from '../db.js';
import { HttpError, nowStr } from '../util.js';
import { insertPunches, parseDateTime } from '../essl/punches.js';

/**
 * Solus (iSOLUS ATTENDANCE) connector.
 * Solus does not publish its machine protocol, so three ways in are provided:
 *   1. File import   – attendance export from the iSOLUS software (CSV / Excel)
 *   2. Push URL      – POST /solus/punches with an API key (for Solus or an integrator to call)
 *   3. Database pull – a SQL query run against the iSOLUS database (SQL Server or MySQL)
 * Punches are stored with vendor 'solus' and matched to users by their Solus User ID (else Employee ID).
 */

export const SOLUS_KEYS = {
  'solus.push.apiKey': '',
  'solus.db.engine': 'mssql',
  'solus.db.host': '',
  'solus.db.port': '1433',
  'solus.db.database': '',
  'solus.db.user': '',
  'solus.db.password': '',
  'solus.db.encrypt': '0',
  'solus.db.query': 'SELECT EmployeeCode AS code, PunchTime AS time, Direction AS direction, DeviceName AS device\nFROM <attendance table>\nWHERE PunchTime > {since}\nORDER BY PunchTime',
  'solus.db.auto': '0',
  'solus.db.intervalMin': '15',
  'solus.db.lastRun': '',
  'solus.db.lastResult': '',
  'solus.db.since': '',
};

export async function getSolusSettings() {
  const out = {};
  for (const [k, d] of Object.entries(SOLUS_KEYS)) out[k] = await getSetting(k, d);
  return out;
}

export async function ensureApiKey() {
  let key = await getSetting('solus.push.apiKey', '');
  if (!key) {
    key = crypto.randomBytes(24).toString('hex');
    await setSetting('solus.push.apiKey', key);
  }
  return key;
}

/* ---------- turning anything Solus sends into punches ---------- */

const pickKey = (o, names) => {
  const lower = Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]));
  for (const n of names) if (lower[n] !== undefined && lower[n] !== null && lower[n] !== '') return lower[n];
  return undefined;
};
const CODE_KEYS = ['code', 'employeeid', 'employeecode', 'empcode', 'empid', 'userid', 'pin', 'enrollno', 'cardno', 'cardnumber', 'staffid', 'solusid'];
const TIME_KEYS = ['time', 'datetime', 'punchtime', 'logtime', 'logdatetime', 'eventtime', 'attendancetime', 'swipetime', 'timestamp'];
const DATE_KEYS = ['date', 'punchdate', 'logdate', 'attdate'];
const CLOCK_KEYS = ['clock', 'punchclock', 'intime'];
const DIR_KEYS = ['direction', 'inout', 'io', 'status', 'punchtype', 'type'];
const DEV_KEYS = ['device', 'deviceid', 'devicename', 'reader', 'readername', 'terminal', 'door', 'serialnumber'];

function toDirection(v) {
  const d = String(v ?? '').trim().toLowerCase();
  if (/^(in|i|entry|checkin|check-in|0)$/.test(d)) return 'in';
  if (/^(out|o|exit|checkout|check-out|1)$/.test(d)) return 'out';
  return 'unknown';
}

export function normalizePunch(o, fallbackDevice = 'Solus') {
  const code = pickKey(o, CODE_KEYS);
  let t = pickKey(o, TIME_KEYS);
  let time = null;
  if (t instanceof Date) time = parseDateTime(t);
  else if (t !== undefined) time = parseDateTime(String(t).replace('T', ' ').replace(/\.\d+Z?$|Z$/, ''));
  if (!time) {
    const d = pickKey(o, DATE_KEYS);
    const c = pickKey(o, CLOCK_KEYS);
    if (d && c) time = parseDateTime(d instanceof Date ? parseDateTime(d).slice(0, 10) : String(d), String(c));
  }
  return code !== undefined && time
    ? { code: String(code).trim(), time, direction: toDirection(pickKey(o, DIR_KEYS)), device: String(pickKey(o, DEV_KEYS) ?? fallbackDevice).slice(0, 60) }
    : null;
}

/** Push body: JSON array, {punches:[…]}, a single object, or CSV text with a header row. */
export function parsePushBody(body, contentType = '') {
  let items = [];
  if (typeof body === 'string') {
    const text = body.trim();
    if (text.startsWith('[') || text.startsWith('{')) body = JSON.parse(text);
    else {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new HttpError(400, 'Send JSON, or CSV with a header row');
      const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
      const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
      items = lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [head[i], v.trim().replace(/^"|"$/g, '')])));
      return items.map((o) => normalizePunch(o));
    }
  }
  if (Array.isArray(body)) items = body;
  else if (body && Array.isArray(body.punches)) items = body.punches;
  else if (body && Array.isArray(body.data)) items = body.data;
  else if (body && typeof body === 'object') items = [body];
  return items.map((o) => normalizePunch(o));
}

/* ---------- database pull ---------- */

async function runQuery(s, { preview = false } = {}) {
  if (!s['solus.db.host'] || !s['solus.db.database']) throw new HttpError(400, 'Enter the Solus database server and database name');
  const query = String(s['solus.db.query'] || '').trim();
  if (!/^\s*(select|with)\b/i.test(query)) throw new HttpError(400, 'The query must be a SELECT statement');
  const since = s['solus.db.since'] || '2000-01-01 00:00:00';
  const engine = s['solus.db.engine'];
  const port = Number(s['solus.db.port']) || (engine === 'mysql' ? 3306 : 1433);
  if (engine === 'mysql') {
    const conn = await mysql.createConnection({
      host: s['solus.db.host'], port, user: s['solus.db.user'], password: s['solus.db.password'], database: s['solus.db.database'],
      dateStrings: true, connectTimeout: 15000,
    });
    try {
      const params = [];
      const sql = query.replace(/\{since\}/g, () => (params.push(since), '?'));
      const [rows] = await conn.query(preview ? `SELECT * FROM (${sql}) x LIMIT 10` : sql, params);
      return rows;
    } finally {
      await conn.end();
    }
  }
  let mssql;
  try {
    mssql = (await import('mssql')).default;
  } catch {
    throw new HttpError(500, 'The SQL Server library (mssql) is not installed. Run "npm install mssql" in the server folder.');
  }
  const pool = await new mssql.ConnectionPool({
    server: s['solus.db.host'], port, user: s['solus.db.user'], password: s['solus.db.password'], database: s['solus.db.database'],
    options: { encrypt: s['solus.db.encrypt'] === '1', trustServerCertificate: true, useUTC: false },
    connectionTimeout: 15000, requestTimeout: 120000,
  }).connect();
  try {
    const request = pool.request();
    request.input('since', mssql.NVarChar, since);
    const sql = query.replace(/\{since\}/g, '@since');
    const result = await request.query(preview ? `SELECT TOP 10 * FROM (${sql.replace(/\border\s+by[\s\S]*$/i, '')}) x` : sql);
    return result.recordset || [];
  } finally {
    await pool.close();
  }
}

export async function testSolusQuery() {
  const s = await getSolusSettings();
  const rows = await runQuery(s, { preview: true });
  return { rows: rows.slice(0, 10), punches: rows.slice(0, 10).map((r) => normalizePunch(r)) };
}

export async function pullSolus() {
  const s = await getSolusSettings();
  try {
    const rows = await runQuery(s);
    const punches = rows.map((r) => normalizePunch(r, 'Solus DB'));
    const result = await insertPunches(punches, 'solus_db', 'solus');
    const latest = punches.filter(Boolean).reduce((m, p) => (p.time > m ? p.time : m), s['solus.db.since'] || '');
    if (latest) await setSetting('solus.db.since', latest);
    await setSetting('solus.db.lastRun', nowStr());
    await setSetting('solus.db.lastResult', `OK – ${result.inserted} new, ${result.duplicates} already present${result.invalid ? `, ${result.invalid} rows without employee/time` : ''}`);
    return result;
  } catch (e) {
    await setSetting('solus.db.lastRun', nowStr());
    await setSetting('solus.db.lastResult', `Failed – ${e.message}`);
    throw e.status ? e : new HttpError(502, `Could not read the Solus database: ${e.message}`);
  }
}
