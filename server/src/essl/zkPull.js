import { HttpError, toDateTimeStr } from '../util.js';

/**
 * Pull attendance logs directly from an eSSL / ZKTeco device over the LAN
 * (the same protocol eTimeTrackLite uses, TCP/UDP port 4370).
 */
export async function pullFromDevice({ ip, port = 4370, timeoutMs = 15000 }) {
  if (!ip) throw new HttpError(400, 'Device IP address is not set');
  let ZKLib;
  try {
    ZKLib = (await import('node-zklib')).default;
  } catch {
    throw new HttpError(500, 'The device library (node-zklib) is not installed. Run "npm install node-zklib" in the server folder.');
  }
  const zk = new ZKLib(ip, Number(port) || 4370, timeoutMs, 4000);
  const withTimeout = (p, ms, msg) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  try {
    await withTimeout(zk.createSocket(), timeoutMs, `Could not connect to device at ${ip}:${port}`);
    let info = null;
    try {
      info = await withTimeout(zk.getInfo(), 8000, 'info timeout');
    } catch {
      /* optional */
    }
    const logs = await withTimeout(zk.getAttendances(), 120000, 'Timed out while reading attendance from device');
    const data = (logs && logs.data) || [];
    return {
      info,
      punches: data.map((l) => ({
        code: String(l.deviceUserId ?? l.userId ?? '').trim(),
        time: toDateTimeStr(new Date(l.recordTime)),
        direction: 'unknown',
        device: ip,
      })),
    };
  } catch (e) {
    const msg = e?.message || e?.err?.message || '';
    throw new HttpError(
      502,
      `Could not read from device at ${ip}:${port}${msg ? ` (${msg})` : ''}. Check the IP, that the device is on the network, and that no other software is connected to it.`
    );
  } finally {
    try {
      await zk.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/** Read the users enrolled on the device (ID, name, card). */
export async function pullUsersFromDevice({ ip, port = 4370, timeoutMs = 15000 }) {
  if (!ip) throw new HttpError(400, 'Device IP address is not set');
  let ZKLib;
  try {
    ZKLib = (await import('node-zklib')).default;
  } catch {
    throw new HttpError(500, 'The device library (node-zklib) is not installed. Run "npm install node-zklib" in the server folder.');
  }
  const zk = new ZKLib(ip, Number(port) || 4370, timeoutMs, 4000);
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  try {
    await withTimeout(zk.createSocket(), timeoutMs, `Could not connect to device at ${ip}:${port}`);
    const res = await withTimeout(zk.getUsers(), 60000, 'Timed out while reading users from device');
    return ((res && res.data) || []).map((u) => ({
      code: String(u.userId ?? u.uid ?? '').trim(),
      name: String(u.name || '').replace(/\0/g, '').trim(),
      card: u.cardno ? String(u.cardno) : '',
      privilege: u.role ?? null,
      device: ip,
    }));
  } catch (e) {
    const msg = e?.message || e?.err?.message || '';
    throw new HttpError(502, `Could not read users from device at ${ip}:${port}${msg ? ` (${msg})` : ''}.`);
  } finally {
    try {
      await zk.disconnect();
    } catch {
      /* ignore */
    }
  }
}
