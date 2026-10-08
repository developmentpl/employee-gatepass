import express, { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { nowStr } from '../util.js';
import { insertPunches, parseDateTime, statusToDirection } from './punches.js';
import { parseUserLines, upsertDeviceUsers } from './deviceUsers.js';
import { audit } from '../services/audit.js';

/**
 * eSSL / ZKTeco "ADMS" (push SDK / iclock) receiver.
 * On the device: Menu → Comm. → Cloud Server Setting (ADMS):
 *   Server address = this server's IP, Server port = API_PORT (default 5124), HTTPS / domain name / proxy off.
 * The device then pushes every punch here in real time, plus its user list.
 */
const r = Router();
r.use(express.text({ type: '*/*', limit: '10mb' }));

// Print every device request in the server window so connection problems are easy to see
r.use((req, _res, next) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const table = req.query.table ? ` table=${req.query.table}` : '';
  console.log(`[eSSL] ${new Date().toLocaleTimeString()} ${req.method} ${req.path} from ${ip} SN=${req.query.SN || req.query.sn || '?'}${table}`);
  next();
});

const lastSeenWrite = new Map();
const userQuerySent = new Set();
let cmdId = 1;

async function touchDevice(req, extra = {}) {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  if (!sn) return { sn: '', allowed: false };
  const allowedList = String((await getSetting('essl.push.allowedSN', '')) || '')
    .split(/[,\s]+/)
    .filter(Boolean);
  const allowed = !allowedList.length || allowedList.includes(sn);
  const now = Date.now();
  if (extra.punches || extra.users || !lastSeenWrite.has(sn) || now - lastSeenWrite.get(sn) > 60000) {
    lastSeenWrite.set(sn, now);
    const key = `essl.device.${sn}`;
    const prev = JSON.parse((await getSetting(key, '{}')) || '{}');
    await setSetting(
      key,
      JSON.stringify({
        ...prev,
        sn,
        ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
        lastSeen: nowStr(),
        allowed,
        ...(req.query.pushver ? { pushver: req.query.pushver } : {}),
        ...(extra.punches ? { lastPunchAt: nowStr(), totalPunches: (prev.totalPunches || 0) + extra.punches } : {}),
        ...(extra.users ? { usersReceived: extra.users, usersAt: nowStr() } : {}),
      })
    );
  }
  return { sn, allowed };
}

const handshake = async (req, res) => {
  const { sn } = await touchDevice(req);
  res.type('text/plain').send(
    [
      `GET OPTION FROM: ${sn}`,
      // "None"/0 = send everything already stored on the device (old punches and the user list)
      'ATTLOGStamp=None',
      'OPERLOGStamp=None',
      'ATTPHOTOStamp=None',
      'ErrorDelay=30',
      'Delay=10',
      'TransTimes=00:00;14:05',
      'TransInterval=1',
      'TransFlag=TransData AttLog OpLog EnrollUser ChgUser',
      'Realtime=1',
      'Encrypt=None',
    ].join('\r\n')
  );
};

async function saveUsers(text, sn, req) {
  const users = parseUserLines(text, sn);
  if (users.length) {
    await upsertDeviceUsers(users, 'push');
    await touchDevice(req, { users: users.length });
    console.log(`[eSSL] received ${users.length} user(s) from ${sn}`);
  }
  return users.length;
}

const receive = async (req, res) => {
  const table = String(req.query.table || req.query.tablename || '').toUpperCase();
  const body = typeof req.body === 'string' ? req.body : '';
  const sn = String(req.query.SN || req.query.sn || '').trim();
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { allowed } = await touchDevice(req, table === 'ATTLOG' ? { punches: lines.length } : {});
  if (!allowed) return res.type('text/plain').send(`OK: ${lines.length}`);

  if (table === 'ATTLOG') {
    const punches = lines.map((line) => {
      const f = line.split('\t');
      return {
        code: (f[0] || '').trim(),
        time: parseDateTime(f[1]),
        direction: statusToDirection(f[2]),
        verify: f[3] ?? null,
        device: sn,
      };
    });
    const result = await insertPunches(punches, 'push');
    console.log(`[eSSL] ${sn}: ${result.inserted} new punch(es), ${result.duplicates} duplicate(s)`);
    if (result.inserted > 0 && (await getSetting('essl.push.logEach', '0')) === '1') {
      await audit(null, {
        module: 'attendance',
        action: 'push_received',
        entityId: sn,
        description: `Device ${sn} pushed ${result.inserted} punch(es)`,
        actor: { name: `eSSL ${sn}` },
      });
    }
  } else {
    // OPERLOG / USERINFO / USER tables carry the enrolled users
    await saveUsers(body, sn, req);
  }
  res.type('text/plain').send(`OK: ${lines.length}`);
};

/** Device polls here for commands. Once per device, ask it to upload its full user list. */
const getrequest = async (req, res) => {
  const { sn, allowed } = await touchDevice(req);
  if (sn && allowed && !userQuerySent.has(sn)) {
    userQuerySent.add(sn);
    return res.type('text/plain').send(`C:${cmdId++}:DATA QUERY USERINFO`);
  }
  res.type('text/plain').send('OK');
};

/** Newer firmware answers DATA QUERY here (type=tabledata&tablename=user). */
const querydata = async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  const body = typeof req.body === 'string' ? req.body : '';
  await saveUsers(body, sn, req);
  const count = body.split(/\r?\n/).filter(Boolean).length;
  res.type('text/plain').send(`${req.query.tablename || 'user'}=${count}`);
};

const ok = async (req, res) => {
  await touchDevice(req);
  res.type('text/plain').send('OK');
};

/** Clear the "already asked" flag so the next poll re-requests the user list. */
export function requestUsersAgain() {
  userQuerySent.clear();
}

r.get(['/cdata', '/cdata.aspx'], handshake);
r.post(['/cdata', '/cdata.aspx'], receive);
r.get(['/getrequest', '/getrequest.aspx'], getrequest);
r.post(['/querydata', '/querydata.aspx'], querydata);
r.post(['/devicecmd', '/devicecmd.aspx'], ok);
r.all('/{*rest}', (_req, res) => res.type('text/plain').send('OK'));

export default r;
