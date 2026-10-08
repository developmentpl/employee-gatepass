import nodemailer from 'nodemailer';
import config from '../config.js';

let transport = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
}

/** Fire-and-forget email. Does nothing if SMTP is not configured. */
export function sendMail(to, subject, html) {
  if (!transport || !to || (Array.isArray(to) && !to.length)) return;
  transport
    .sendMail({ from: config.smtp.from, to, subject, html })
    .catch((e) => console.error('[mail] failed:', e.message));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function passSummaryHtml(p, intro) {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1b2430">
    <p>${intro}</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #dde3ea">
      <tr><td><b>Pass No.</b></td><td>${esc(p.pass_no)}</td></tr>
      <tr><td><b>Employee</b></td><td>${esc(p.emp_name)} (${esc(p.emp_code)})</td></tr>
      <tr><td><b>Department</b></td><td>${esc(p.department)}</td></tr>
      <tr><td><b>Date</b></td><td>${esc(p.pass_date)}</td></tr>
      <tr><td><b>Out time</b></td><td>${esc(String(p.out_time).slice(0, 5))}</td></tr>
      <tr><td><b>Reason</b></td><td>${esc(p.reason_type)} – ${esc(p.reason)}</td></tr>
      <tr><td><b>Returning today</b></td><td>${p.coming_back ? 'Yes, by ' + esc(String(p.expected_in_time || '').slice(0, 5)) : 'No'}</td></tr>
      ${p.status !== 'pending' ? `<tr><td><b>Status</b></td><td>${esc(p.status.toUpperCase())}${p.decision_remark ? ' – ' + esc(p.decision_remark) : ''}</td></tr>` : ''}
    </table>
    <p><a href="${config.appUrl}">Open Gate Pass</a></p>
  </div>`;
}
