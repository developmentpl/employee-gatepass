import { Router } from 'express';
import { q, one, getSetting, setSetting } from '../db.js';
import { HttpError, paging, likeTerm, todayStr, nowStr } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { memUpload } from '../services/photos.js';
import { sendCsv } from '../services/csv.js';
import { insertPunches } from '../essl/punches.js';
import { parseAttendanceFile } from '../essl/usbImport.js';
import os from 'os';
import config from '../config.js';
import { pullFromDevice, pullUsersFromDevice } from '../essl/zkPull.js';
import { upsertDeviceUsers } from '../essl/deviceUsers.js';
import { requestUsersAgain } from '../essl/adms.js';
import { buildWorkbook, sendXlsx } from '../services/sheet.js';

const r = Router();
r.use(requireRole('admin'));

const USER_KEY = `COALESCE(NULLIF(u.essl_code,''), u.emp_code)`;

function filters(query) {
  const where = ['1=1'];
  const params = [];
  const from = query.from || todayStr();
  const to = query.to || from;
  where.push('p.punch_time BETWEEN ? AND ?');
  params.push(from + ' 00:00:00', to + ' 23:59:59');
  if (query.source) {
    where.push('p.source=?');
    params.push(query.source);
  }
  if (query.search) {
    const t = likeTerm(query.search);
    where.push('(p.essl_code LIKE ? OR u.name LIKE ? OR u.emp_code LIKE ? OR dn.name LIKE ?)');
    params.push(t, t, t, t);
  }
  if (query.department) {
    where.push('u.department=?');
    params.push(query.department);
  }
  return { w: where.join(' AND '), params };
}

r.get('/punches', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 25);
  const { w, params } = filters(req.query);
  const base = `FROM attendance_punches p LEFT JOIN users u ON ${USER_KEY}=p.essl_code AND u.is_deleted=0 LEFT JOIN device_users dn ON dn.essl_code=p.essl_code WHERE ${w}`;
  if (req.query.format === 'csv') {
    const rows = await q(`SELECT p.*, u.name, u.emp_code, u.department ${base} ORDER BY p.punch_time DESC LIMIT 100000`, params);
    return sendCsv(res, `attendance-${todayStr()}.csv`, [
      { label: 'Punch Time', key: 'punch_time' },
      { label: 'eSSL ID', key: 'essl_code' },
      { label: 'Employee ID', key: 'emp_code' },
      { label: 'Name', key: 'name' },
      { label: 'Department', key: 'department' },
      { label: 'Direction', key: 'direction' },
      { label: 'Device', key: 'device_sn' },
      { label: 'Source', key: 'source' },
    ], rows);
  }
  const total = (await one(`SELECT COUNT(*) c ${base}`, params)).c;
  const rows = await q(
    `SELECT p.id, p.essl_code, p.punch_time, p.direction, p.device_sn, p.source, u.id user_id, u.name, u.emp_code, u.department, u.photo, dn.name device_name
       ${base} ORDER BY p.punch_time DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ rows, total, page, pageSize });
});

r.get('/summary', async (_req, res) => {
  const start = todayStr() + ' 00:00:00';
  const active = (await one(`SELECT COUNT(*) c FROM users WHERE is_active=1 AND is_deleted=0`)).c;
  const present = (await one(
    `SELECT COUNT(DISTINCT u.id) c FROM users u JOIN attendance_punches p ON p.essl_code=${USER_KEY}
      WHERE u.is_active=1 AND u.is_deleted=0 AND p.punch_time>=?`,
    [start]
  )).c;
  const punches = (await one(`SELECT COUNT(*) c FROM attendance_punches WHERE punch_time>=?`, [start])).c;
  const lastPunch = await one(`SELECT punch_time, source FROM attendance_punches ORDER BY id DESC LIMIT 1`);
  const outOnPass = (await one(
    `SELECT COUNT(*) c FROM gate_passes WHERE status='approved' AND gate_status='out' AND pass_date=?`,
    [todayStr()]
  )).c;
  const devices = (await q(`SELECT v FROM settings WHERE k LIKE 'essl.device.%'`)).map((x) => JSON.parse(x.v));
  res.json({ active, present, punches, lastPunch, outOnPass, devices });
});

/* ---------------- settings ---------------- */

const SETTING_KEYS = {
  'essl.push.allowedSN': '',
  'essl.push.logEach': '0',
  'essl.pull.ip': '',
  'essl.pull.port': '4370',
  'essl.pull.auto': '0',
  'essl.pull.intervalMin': '15',
  'essl.pull.lastRun': '',
  'essl.pull.lastResult': '',
};

r.get('/settings', async (_req, res) => {
  const out = {};
  for (const [k, def] of Object.entries(SETTING_KEYS)) out[k] = await getSetting(k, def);
  res.json(out);
});

r.put('/settings', async (req, res) => {
  const b = req.body || {};
  const editable = ['essl.push.allowedSN', 'essl.push.logEach', 'essl.pull.ip', 'essl.pull.port', 'essl.pull.auto', 'essl.pull.intervalMin'];
  if (b['essl.pull.ip'] && !/^[A-Za-z0-9.\-]+$/.test(b['essl.pull.ip'])) throw new HttpError(400, 'Device IP is not valid');
  if (b['essl.pull.intervalMin'] && !(Number(b['essl.pull.intervalMin']) >= 1)) throw new HttpError(400, 'Interval must be at least 1 minute');
  for (const k of editable) if (k in b) await setSetting(k, String(b[k] ?? '').trim());
  await audit(req, { module: 'attendance', action: 'settings_updated', description: 'Updated eSSL connection settings', meta: b });
  res.json({ ok: true });
});

/* ---------------- pull from device (LAN) ---------------- */

export async function runPull(req, trigger = 'manual') {
  const ip = await getSetting('essl.pull.ip', '');
  const port = await getSetting('essl.pull.port', '4370');
  try {
    const { punches, info } = await pullFromDevice({ ip, port });
    const result = await insertPunches(punches, 'pull');
    const summary = `${result.inserted} new, ${result.duplicates} already present`;
    await setSetting('essl.pull.lastRun', nowStr());
    await setSetting('essl.pull.lastResult', `OK – ${summary}`);
    await audit(req, {
      module: 'attendance',
      action: 'device_pull',
      entityId: ip,
      description: `Pulled attendance from ${ip} (${trigger}): ${summary}`,
      actor: req?.user || { name: 'Scheduler' },
    });
    return { ...result, info };
  } catch (e) {
    await setSetting('essl.pull.lastRun', nowStr());
    await setSetting('essl.pull.lastResult', `Failed – ${e.message}`);
    throw e;
  }
}

r.post('/pull', async (req, res) => {
  res.json(await runPull(req, 'manual'));
});

/* ---------------- USB / file import ---------------- */

r.post('/import', memUpload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose the attendance file from the USB drive');
  const punches = parseAttendanceFile(req.file.originalname, req.file.buffer);
  const result = await insertPunches(punches, 'usb');
  await audit(req, {
    module: 'attendance',
    action: 'usb_import',
    entityId: req.file.originalname,
    description: `Imported ${req.file.originalname}: ${result.inserted} new punches, ${result.duplicates} duplicates skipped, ${result.invalid} unreadable lines`,
  });
  res.json(result);
});

/* ---------------- server address (what to type into the device) ---------------- */

r.get('/server-info', (_req, res) => {
  if (config.hosted) {
    // Test site on Railway: the machine would need to reach the public web address (HTTPS, port 443)
    const host = process.env.RAILWAY_PUBLIC_DOMAIN || '';
    return res.json({ ips: host ? [{ ip: host, adapter: 'Railway public address' }] : [], port: 443, esslPort: 443, appPort: 443, hosted: true });
  }
  const ips = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) ips.push({ ip: a.address, adapter: name });
    }
  }
  res.json({ ips, port: config.apiPort, esslPort: config.apiPort, appPort: config.appPort });
});

/* ---------------- users enrolled on the device ---------------- */

const DU_FROM = `FROM device_users d
  LEFT JOIN users u ON u.is_deleted=0 AND COALESCE(NULLIF(u.essl_code,''), u.emp_code) = d.essl_code`;

function duFilters(query) {
  const where = ['1=1'];
  const params = [];
  if (query.search) {
    const t = likeTerm(query.search);
    where.push('(d.essl_code LIKE ? OR d.name LIKE ? OR u.name LIKE ?)');
    params.push(t, t, t);
  }
  if (query.matched === 'yes') where.push('u.id IS NOT NULL');
  if (query.matched === 'no') where.push('u.id IS NULL');
  return { w: where.join(' AND '), params };
}

r.get('/device-users', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 10);
  const { w, params } = duFilters(req.query);
  const total = (await one(`SELECT COUNT(*) c ${DU_FROM} WHERE ${w}`, params)).c;
  const counts = await one(
    `SELECT COUNT(*) total, SUM(u.id IS NOT NULL) matched ${DU_FROM}`
  );
  const rows = await q(
    `SELECT d.essl_code, d.name, d.card_no, d.device_sn, d.source, d.last_seen, u.id user_id, u.name app_name, u.emp_code
       ${DU_FROM} WHERE ${w} ORDER BY (u.id IS NOT NULL), LENGTH(d.essl_code), d.essl_code LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ rows, total, page, pageSize, counts: { total: Number(counts.total || 0), matched: Number(counts.matched || 0) } });
});

/** Excel in the User Management bulk-upload format, pre-filled with device users not yet in the app. */
r.get('/device-users/export', async (_req, res) => {
  const rows = await q(`SELECT d.essl_code, d.name ${DU_FROM} WHERE u.id IS NULL ORDER BY LENGTH(d.essl_code), d.essl_code`);
  const buf = buildWorkbook([
    {
      name: 'Users',
      widths: [14, 24, 30, 18, 18, 22, 10, 10, 14],
      rows: [
        ['Employee ID*', 'Employee Name*', 'Email*', 'Phone', 'Department', 'Designation', 'Shift', 'Role', 'eSSL User ID'],
        ...rows.map((r) => [r.essl_code, r.name || '', '', '', '', '', '', 'user', r.essl_code]),
      ],
    },
    {
      name: 'Instructions',
      widths: [100],
      rows: [
        ['Users found on the eSSL machine that are not yet in Gate Pass.'],
        ['• Fill in Email (mandatory) and any other details, then upload this file in User Management → Bulk upload.'],
        ['• Change Employee ID to the HR employee code if it differs from the device ID — keep "eSSL User ID" as the device ID so punches still match.'],
        ['• Delete rows for people who should not get an account.'],
      ],
    },
  ]);
  sendXlsx(res, 'essl-device-users.xlsx', buf);
});

r.post('/pull-users', async (req, res) => {
  const ip = await getSetting('essl.pull.ip', '');
  const port = await getSetting('essl.pull.port', '4370');
  const users = await pullUsersFromDevice({ ip, port });
  const result = await upsertDeviceUsers(users, 'pull');
  await audit(req, { module: 'attendance', action: 'device_users_pulled', entityId: ip, description: `Read ${result.saved} users from device ${ip}` });
  res.json(result);
});

/** Ask push-connected devices to upload their user list again on their next poll. */
r.post('/request-users', async (req, res) => {
  requestUsersAgain();
  await audit(req, { module: 'attendance', action: 'device_users_requested', description: 'Requested user list from push devices' });
  res.json({ ok: true });
});

export default r;
