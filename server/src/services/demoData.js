/**
 * Demo employees, authorities, gate passes and today's punches, for trying the app.
 * All demo users have password  Demo@1234
 */
import bcrypt from 'bcryptjs';
import { q, one } from '../db.js';
import { todayStr, toDateTimeStr } from '../util.js';

const people = [
  ['H1001', 'Anil Deshmukh', 'Production', 'Plant Head', 'General'],
  ['H1002', 'Priya Joshi', 'Production', 'Manager', 'General'],
  ['H1003', 'Rahul Patil', 'Production', 'Engineer', 'A'],
  ['H1004', 'Sneha Kulkarni', 'Quality', 'Manager', 'General'],
  ['H1005', 'Vikram Shinde', 'Quality', 'Inspector', 'B'],
  ['H1006', 'Neha Pawar', 'HR', 'HR Manager', 'General'],
  ['H1007', 'Amit Jadhav', 'Maintenance', 'Supervisor', 'A'],
  ['H1008', 'Kiran More', 'Maintenance', 'Technician', 'C'],
  ['H1009', 'Pooja Gaikwad', 'Stores', 'Executive', 'General'],
  ['H1010', 'Sachin Bhosale', 'Production', 'Operator', 'B'],
  ['H1011', 'Ravi Chavan', 'Security', 'Security Officer', 'General'],
];

/** True when the demo employees are already in the database. */
export async function hasDemoData() {
  return !!(await one(`SELECT id FROM users WHERE emp_code='H1001'`));
}

export async function seedDemo() {
  const hash = await bcrypt.hash('Demo@1234', 10);
  for (const [code, name, dept, desig, shift] of people) {
    const email = name.toLowerCase().replace(/\s+/g, '.') + '@harman.com';
    await q(
      `INSERT IGNORE INTO users (emp_code, name, email, department, designation, shift, role, password_hash, must_change_password, phone)
       VALUES (?,?,?,?,?,?,?,?,0,?)`,
      [code, name, email, dept, desig, shift, dept === 'Security' ? 'security' : 'user', hash, '98' + code.slice(1) + '1234']
    );
  }
  const id = async (code) => (await one(`SELECT id FROM users WHERE emp_code=?`, [code])).id;
  const assign = async (emp, p, s, t) =>
    q(`INSERT IGNORE INTO authorities (user_id, primary_id, secondary_id, third_id) VALUES (?,?,?,?)`, [
      await id(emp), await id(p), s ? await id(s) : null, t ? await id(t) : null,
    ]);
  await assign('H1003', 'H1002', 'H1001');
  await assign('H1010', 'H1002', 'H1001');
  await assign('H1002', 'H1001');
  await assign('H1005', 'H1004', 'H1001');
  await assign('H1008', 'H1007', 'H1001', 'H1006');
  await assign('H1009', 'H1006');

  // punches for today
  const today = todayStr();
  const punch = [];
  for (const [code] of people) {
    const h = 7 + Math.floor(Math.random() * 2);
    const m = Math.floor(Math.random() * 59);
    punch.push([code, `${today} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`, 'in', 'push', 'DEMO-SN-01']);
  }
  await q(`INSERT IGNORE INTO attendance_punches (essl_code, punch_time, direction, source, device_sn) VALUES ?`, [punch]);

  // a few gate passes
  const mk = async (code, reason_type, reason, out, back, status, decider) => {
    const u = await one(`SELECT * FROM users WHERE emp_code=?`, [code]);
    const ins = await q(
      `INSERT INTO gate_passes (user_id, emp_code, emp_name, department, shift, pass_date, reason_type, reason, out_time, coming_back, expected_in_time, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id, u.emp_code, u.name, u.department, u.shift, today, reason_type, reason, out, back ? 1 : 0, back, 'pending', toDateTimeStr()]
    );
    await q(`UPDATE gate_passes SET pass_no=? WHERE id=?`, [`GP-${today.replace(/-/g, '').slice(2)}-${String(ins.insertId).padStart(5, '0')}`, ins.insertId]);
    const a = await one(`SELECT * FROM authorities WHERE user_id=?`, [u.id]);
    for (const [lvl, aid] of [['primary', a.primary_id], ['secondary', a.secondary_id], ['third', a.third_id]])
      if (aid) await q(`INSERT INTO pass_approvers (pass_id, approver_id, level) VALUES (?,?,?)`, [ins.insertId, aid, lvl]);
    if (status !== 'pending') {
      const d = await one(`SELECT id, name FROM users WHERE emp_code=?`, [decider]);
      await q(
        `UPDATE gate_passes SET status=?, decided_by=?, decided_by_name=?, decided_level='primary', decided_at=?, decision_remark=? WHERE id=?`,
        [status, d.id, d.name, toDateTimeStr(), status === 'rejected' ? 'Line trial scheduled at that time, please go after 4 PM' : null, ins.insertId]
      );
    }
  };
  await mk('H1003', 'Client Visit', 'Visit to Tata Motors Chakan for connector issue review', '11:30', '15:00', 'pending');
  await mk('H1010', 'Medical Emergency', 'Severe headache, visiting clinic in Chakan', '10:15', '12:00', 'approved', 'H1002');
  await mk('H1005', 'Bank Work', 'Home loan document submission', '13:00', '14:00', 'rejected', 'H1004');
  await mk('H1008', 'Lunch', 'Lunch outside with vendor', '13:00', '14:00', 'pending');
}
