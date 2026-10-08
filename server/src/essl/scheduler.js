import { getSetting } from '../db.js';
import { runPull } from '../routes/attendance.js';

let running = false;

/** Checks every minute whether an automatic device pull is due. */
export function startScheduler() {
  setInterval(async () => {
    if (running) return;
    try {
      if ((await getSetting('essl.pull.auto', '0')) !== '1') return;
      if (!(await getSetting('essl.pull.ip', ''))) return;
      const every = Math.max(1, Number(await getSetting('essl.pull.intervalMin', '15')) || 15);
      const last = await getSetting('essl.pull.lastRun', '');
      if (last && Date.now() - new Date(last.replace(' ', 'T')).getTime() < every * 60000) return;
      running = true;
      await runPull(null, 'automatic');
    } catch (e) {
      console.error('[essl] auto pull failed:', e.message);
    } finally {
      running = false;
    }
  }, 60000).unref();
}
