/**
 * Demo employees, authorities, security logins, two weeks of gate passes and today's punches,
 * for trying the app. All demo accounts use the password  Demo@1234
 */
import bcrypt from 'bcryptjs';
import { q, one } from '../db.js';
import { todayStr, toDateTimeStr } from '../util.js';

const people = [
  ['H1001', 'Anil Deshmukh', 'Production', 'Plant Head', 'General', 'user'],
  ['H1002', 'Priya Joshi', 'Production', 'Manager', 'General', 'user'],
  ['H1003', 'Rahul Patil', 'Production', 'Engineer', 'A', 'user'],
  ['H1004', 'Sneha Kulkarni', 'Quality', 'Manager', 'General', 'user'],
  ['H1005', 'Vikram Shinde', 'Quality', 'Inspector', 'B', 'user'],
  ['H1006', 'Neha Pawar', 'HR', 'HR Manager', 'General', 'user'],
  ['H1007', 'Amit Jadhav', 'Maintenance', 'Supervisor', 'A', 'user'],
  ['H1008', 'Kiran More', 'Maintenance', 'Technician', 'C', 'user'],
  ['H1009', 'Pooja Gaikwad', 'Stores', 'Executive', 'General', 'user'],
  ['H1010', 'Sachin Bhosale', 'Production', 'Operator', 'B', 'user'],
  ['H1011', 'Ravi Chavan', 'Security', 'Security Officer', 'General', 'security_admin'],
];

const reasons = {
  'Official Purpose': ['Visit to Tata Motors Chakan for connector issue review', 'Supplier audit at Bhosari MIDC', 'Bank work for company account', 'Courier pickup at Chakan post office', 'Customer meeting at Hinjewadi'],
  'Personal Purpose': ['Doctor appointment in Chakan', 'Lunch outside with family', 'Child school meeting', 'Home loan document submission', 'Personal bank work'],
};

/** True when the demo employees are already in the database. */
/** Bump when the demo data changes, so SEED_DEMO=reset reloads it once on the next start. */
export const DEMO_VERSION = '2';

/**
 * Test sites only (SEED_DEMO=reset): wipes all gate passes, punches, logs and users except the admin(s),
 * then loads the current demo data. Runs once per DEMO_VERSION, so later restarts keep test data.
 */
export async function resetDemoIfNeeded() {
  const done = await one(`SELECT v FROM settings WHERE k='demo.resetVersion'`);
  if (done && done.v === DEMO_VERSION) return false;
  for (const t of ['notifications', 'pass_approvers', 'gate_passes', 'attendance_punches', 'device_users', 'audit_logs', 'authorities', 'security_persons']) {
    await q(`DELETE FROM ${t}`);
  }
  await q(`DELETE FROM users WHERE role<>'admin' OR emp_code LIKE 'H10%'`);
  await seedDemo();
  await q(`INSERT INTO settings (k, v) VALUES ('demo.resetVersion', ?) ON DUPLICATE KEY UPDATE v=VALUES(v)`, [DEMO_VERSION]);
  return true;
}

export async function hasDemoData() {
  return !!(await one(`SELECT id FROM users WHERE emp_code='H1001'`));
}

const pad = (x) => String(x).padStart(2, '0');
const addMin = (hhmm, m) => {
  const [h, mm] = hhmm.split(':').map(Number);
  const t = Math.min(23 * 60 + 30, h * 60 + mm + m);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

export async function seedDemo() {
  const hash = await bcrypt.hash('Demo@1234', 10);
  for (const [code, name, dept, desig, shift, role] of people) {
    const email = name.toLowerCase().replace(/\s+/g, '.') + '@harman.com';
    await q(
      `INSERT IGNORE INTO users (emp_code, name, email, department, designation, shift, role, password_hash, must_change_password, phone)
       VALUES (?,?,?,?,?,?,?,?,0,?)`,
      [code, name, email, dept, desig, shift, role, hash, '98' + code.slice(1) + '1234']
    );
  }
  // security gate logins (Login ID + password) and the guards who use them
  for (const [login, name] of [['GATE1', 'Main gate'], ['GATE2', 'Material gate']]) {
    await q(`INSERT IGNORE INTO users (emp_code, name, email, role, password_hash, must_change_password, department) VALUES (?,?,NULL,'security',?,0,'Security')`, [login, name, hash]);
  }
  for (const n of ['Suresh Kale', 'Mahesh Pawar', 'Ganesh Shinde', 'Rekha Jadhav']) await q(`INSERT IGNORE INTO security_persons (name) VALUES (?)`, [n]);

  const id = async (code) => (await one(`SELECT id FROM users WHERE emp_code=?`, [code])).id;
  const assign = async (emp, p, s, t) =>
    q(`INSERT IGNORE INTO authorities (user_id, primary_id, secondary_id, third_id) VALUES (?,?,?,?)`, [
      await id(emp), await id(p), s ? await id(s) : null, t ? await id(t) : null,
    ]);
  await assign('H1003', 'H1002', 'H1001');
  await assign('H1010', 'H1002', 'H1001');
  await assign('H1002', 'H1001');
  await assign('H1005', 'H1004', 'H1001');
  await assign('H1007', 'H1001', 'H1006');
  await assign('H1008', 'H1007', 'H1001', 'H1006');
  await assign('H1009', 'H1006');

  // punches for today
  const today = todayStr();
  const punch = [];
  for (const [code] of people) {
    const h = 7 + Math.floor(Math.random() * 2);
    const m = Math.floor(Math.random() * 59);
    punch.push([code, `${today} ${pad(h)}:${pad(m)}:00`, 'in', 'push', 'DEMO-SN-01', 'essl']);
  }
  await q(`INSERT IGNORE INTO attendance_punches (essl_code, punch_time, direction, source, device_sn, vendor) VALUES ?`, [punch]);

  const shifts = new Map((await q(`SELECT name, start_time, end_time FROM shifts`)).map((s) => [s.name, s]));
  const guards = ['Suresh Kale', 'Mahesh Pawar', 'Ganesh Shinde', 'Rekha Jadhav'];
  const gates = ['GATE1 · Main gate', 'GATE2 · Material gate'];

  // one gate pass: status = pending | approved | rejected | cancelled; gate = not_left | out | returned | nr_reason | nr_closed
  const mk = async (code, date, purpose, reason, out, back, status, gate = 'not_left', decider = null) => {
    const u = await one(`SELECT * FROM users WHERE emp_code=?`, [code]);
    const sh = shifts.get(u.shift) || {};
    const created = `${date} ${addMin(out, -90)}:00`;
    const ins = await q(
      `INSERT INTO gate_passes (user_id, emp_code, emp_name, department, shift, shift_start, shift_end, pass_date, reason_type, reason, out_time, coming_back, expected_in_time, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id, u.emp_code, u.name, u.department, u.shift, sh.start_time || null, sh.end_time || null, date, purpose, reason, out, back ? 1 : 0, back, status === 'cancelled' ? 'cancelled' : 'pending', created]
    );
    const pid = ins.insertId;
    await q(`UPDATE gate_passes SET pass_no=? WHERE id=?`, [`GP-${date.replace(/-/g, '').slice(2)}-${String(pid).padStart(5, '0')}`, pid]);
    const a = await one(`SELECT * FROM authorities WHERE user_id=?`, [u.id]);
    let seq = 0;
    for (const [lvl, aid] of [['primary', a.primary_id], ['secondary', a.secondary_id], ['third', a.third_id]]) {
      if (aid) await q(`INSERT INTO pass_approvers (pass_id, approver_id, level, seq, notified_at) VALUES (?,?,?,?,?)`, [pid, aid, lvl, seq, seq === 0 || status !== 'pending' ? created : null]), seq++;
    }
    if (status === 'approved' || status === 'rejected') {
      const d = await one(`SELECT id, name FROM users WHERE id=?`, [decider ? await id(decider) : a.primary_id]);
      await q(
        `UPDATE gate_passes SET status=?, decided_by=?, decided_by_name=?, decided_level='primary', decided_at=?, decision_remark=? WHERE id=?`,
        [status, d.id, d.name, `${date} ${addMin(out, -60)}:00`, status === 'rejected' ? 'Line trial scheduled at that time, please go after 4 PM' : null, pid]
      );
    }
    if (status === 'approved' && gate !== 'not_left') {
      const g = guards[pid % guards.length];
      const gl = gates[pid % gates.length];
      await q(`UPDATE gate_passes SET gate_status='out', actual_out=?, out_marked_by=?, out_security_login=? WHERE id=?`, [`${date} ${addMin(out, 4)}:00`, g, gl, pid]);
      if (gate === 'returned' && back)
        await q(`UPDATE gate_passes SET gate_status='returned', actual_in=?, in_marked_by=?, in_security_login=? WHERE id=?`, [`${date} ${addMin(back, -10)}:00`, guards[(pid + 1) % guards.length], gl, pid]);
      if (gate === 'nr_reason')
        await q(`UPDATE gate_passes SET nr_status='reason_submitted', nr_notified_at=?, nr_reason=?, nr_reason_at=? WHERE id=?`, [`${date} ${addMin(back, 60)}:00`, 'Client meeting extended, went home directly from Chakan', `${date} ${addMin(back, 75)}:00`, pid]);
      if (gate === 'nr_closed')
        await q(
          `UPDATE gate_passes SET gate_status='not_returned', nr_status='approved', nr_notified_at=?, nr_reason=?, nr_reason_at=?, nr_decided_by=?, nr_decided_by_name=?, nr_decided_at=? WHERE id=?`,
          [`${date} ${addMin(back, 60)}:00`, 'Felt unwell, went home', `${date} ${addMin(back, 70)}:00`, a.primary_id, (await one(`SELECT name FROM users WHERE id=?`, [a.primary_id])).name, `${date} ${addMin(back, 90)}:00`, pid]
        );
    }
    return pid;
  };

  // two weeks of history for the dashboards
  const employees = ['H1003', 'H1005', 'H1007', 'H1008', 'H1009', 'H1010', 'H1002'];
  const outs = ['10:15', '11:30', '12:45', '13:00', '14:30', '15:15', '16:00'];
  let k = 0;
  for (let back = 14; back >= 1; back--) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    if (d.getDay() === 0) continue; // Sundays off
    const date = todayStr(d);
    const count = 2 + (k % 4);
    for (let i = 0; i < count; i++, k++) {
      const code = employees[k % employees.length];
      const purpose = k % 3 === 0 ? 'Personal Purpose' : 'Official Purpose';
      const reason = reasons[purpose][k % 5];
      const out = outs[k % outs.length];
      const ret = k % 5 === 4 ? null : addMin(out, 60 + (k % 3) * 45);
      const roll = k % 10;
      if (roll === 7) await mk(code, date, purpose, reason, out, ret, 'rejected');
      else if (roll === 9) await mk(code, date, purpose, reason, out, ret, 'cancelled');
      else await mk(code, date, purpose, reason, out, ret, 'approved', ret ? (k % 23 === 5 ? 'nr_closed' : 'returned') : 'out');
    }
  }

  // today: one of each state
  await mk('H1003', today, 'Official Purpose', 'Visit to Tata Motors Chakan for connector issue review', '11:30', '15:00', 'pending');
  await mk('H1008', today, 'Personal Purpose', 'Lunch outside with family', '13:00', '14:00', 'pending');
  await mk('H1010', today, 'Personal Purpose', 'Doctor appointment in Chakan', '10:15', '12:00', 'approved', 'out', 'H1002');
  await mk('H1007', today, 'Official Purpose', 'Courier pickup at Chakan post office', '09:30', '10:30', 'approved', 'returned', 'H1001');
  await mk('H1009', today, 'Official Purpose', 'Bank work for company account', '16:30', '17:15', 'approved', 'not_left', 'H1006');
  await mk('H1005', today, 'Personal Purpose', 'Home loan document submission', '13:00', '14:00', 'rejected', 'not_left', 'H1004');
}
