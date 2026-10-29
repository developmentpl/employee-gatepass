import { q, one } from '../db.js';
import { nowStr } from '../util.js';
import { visibleCond } from './approvals.js';
import { numSetting } from './settings.js';
import { notify } from './notify.js';
import { passSummaryHtml } from './mailer.js';
import { audit } from './audit.js';

/**
 * Runs every minute:
 *  1. When a pending request reaches the next authority (escalation time passed), tell them.
 *  2. A request nobody has approved or rejected within N hours (Settings) is cancelled
 *     automatically; the employee and the authorities who could see it are told.
 *  3. When an employee who said they would return is still out X minutes after their expected
 *     arrival, ask them for the reason (bell + email).
 */
export async function runPassJobs() {
  const hours = await numSetting('approval.autoCancelHours');
  const stale = await q(
    `SELECT * FROM gate_passes WHERE status='pending' AND TIMESTAMPADD(HOUR, ?, created_at) <= ?`,
    [hours, nowStr()]
  );
  for (const p of stale) {
    const remark = `Cancelled automatically: not approved or rejected within ${hours} hour${hours === 1 ? '' : 's'}`;
    const upd = await q(
      `UPDATE gate_passes SET status='cancelled', decided_at=?, decided_by=NULL, decided_by_name='System', decided_level=NULL, decision_remark=? WHERE id=? AND status='pending'`,
      [nowStr(), remark, p.id]
    );
    if (!upd.affectedRows) continue;
    const pass = { ...p, status: 'cancelled', decision_remark: remark };
    await notify(
      p.user_id,
      { type: 'auto_cancelled', title: 'Your gate pass was cancelled automatically', body: `${p.pass_no} · nobody approved or rejected it within ${hours} h. Raise a new one if you still need it.`, passId: p.id },
      { subject: `Gate pass ${p.pass_no} cancelled automatically`, html: passSummaryHtml(pass, `Your gate pass was not approved or rejected within ${hours} hours, so it has been cancelled automatically. Raise a new gate pass if you still need to go out.`) }
    );
    const seen = (await q(`SELECT approver_id FROM pass_approvers WHERE pass_id=? AND notified_at IS NOT NULL`, [p.id])).map((x) => x.approver_id);
    if (seen.length) {
      await notify(seen, { type: 'auto_cancelled', title: `Gate pass cancelled automatically: ${p.emp_name}`, body: `${p.pass_no} · not answered within ${hours} h`, passId: p.id });
    }
    await audit(null, { module: 'gatepass', action: 'auto_cancelled', entityId: p.pass_no, description: `Gate pass ${p.pass_no} of ${p.emp_name} (${p.emp_code}) cancelled automatically: not answered within ${hours} h`, actor: { name: 'System' } });
  }

  const vis = await visibleCond();
  const due = await q(
    `SELECT pa.pass_id, pa.approver_id, pa.seq, g.pass_no, g.emp_name
       FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id
      WHERE g.status='pending' AND pa.notified_at IS NULL AND ${vis.sql}`,
    vis.params
  );
  for (const d of due) {
    const upd = await q(`UPDATE pass_approvers SET notified_at=? WHERE pass_id=? AND approver_id=? AND notified_at IS NULL`, [nowStr(), d.pass_id, d.approver_id]);
    if (!upd.affectedRows) continue;
    const pass = await one(`SELECT * FROM gate_passes WHERE id=?`, [d.pass_id]);
    await notify(
      d.approver_id,
      { type: 'approval_needed', title: `Gate pass approval needed: ${d.emp_name}`, body: `${d.pass_no} · not answered by the earlier authority within ${vis.mins} min`, passId: d.pass_id },
      { subject: `Gate pass approval needed: ${d.emp_name} (${d.pass_no})`, html: passSummaryHtml(pass, `${d.emp_name}'s gate pass was not answered in time, so it has now been sent to you for approval.`) }
    );
  }

  const grace = await numSetting('gate.notReturnedGraceMin');
  const late = await q(
    `SELECT * FROM gate_passes
      WHERE status='approved' AND gate_status='out' AND coming_back=1 AND nr_status IS NULL AND expected_in_time IS NOT NULL
        AND TIMESTAMPADD(MINUTE, ?, TIMESTAMP(pass_date, expected_in_time)) <= ?`,
    [grace, nowStr()]
  );
  for (const p of late) {
    const upd = await q(`UPDATE gate_passes SET nr_status='awaiting_reason', nr_notified_at=? WHERE id=? AND nr_status IS NULL AND gate_status='out'`, [nowStr(), p.id]);
    if (!upd.affectedRows) continue;
    await notify(
      p.user_id,
      { type: 'not_returned', title: 'You have not returned to the plant — please state the reason', body: `${p.pass_no} · expected back by ${String(p.expected_in_time).slice(0, 5)}`, passId: p.id },
      {
        subject: `You have not returned to the plant (${p.pass_no}) — please state the reason`,
        html: passSummaryHtml(p, `You said you would return to the plant by <b>${String(p.expected_in_time).slice(0, 5)}</b>, but you have not been checked in. Please open Gate Pass and state the reason.`),
      }
    );
    await audit(null, { module: 'gatepass', action: 'not_returned', entityId: p.pass_no, description: `${p.emp_name} (${p.emp_code}) has not returned on ${p.pass_no}; asked for the reason`, actor: { name: 'System' } });
  }
  return { notified: due.length, autoCancelled: stale.length, notReturned: late.length };
}

let running = false;
export function startPassJobs() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPassJobs();
    } catch (e) {
      console.error('[jobs] failed:', e.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000).unref();
  setInterval(tick, 60000).unref();
}
