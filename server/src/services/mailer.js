import nodemailer from 'nodemailer';
import config from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { EMAIL_RE } from '../util.js';

/*
 * SMTP settings: entered by the admin under Settings → Email (stored in the settings table),
 * falling back to the SMTP_* values in server/.env for anything not set there.
 */
const MASK = '********';
const KEYS = { host: 'mail.host', port: 'mail.port', secure: 'mail.secure', user: 'mail.user', password: 'mail.password', from: 'mail.from' };

export async function emailSettings({ masked = false } = {}) {
  const v = {};
  for (const [k, key] of Object.entries(KEYS)) v[k] = await getSetting(key, null);
  const fromDb = v.host !== null;
  const s = {
    host: v.host ?? config.smtp.host,
    port: Number(v.port ?? config.smtp.port) || 587,
    secure: v.secure !== null ? v.secure === '1' : config.smtp.secure,
    user: v.user ?? config.smtp.user,
    password: v.password ?? config.smtp.password,
    from: v.from ?? config.smtp.from,
  };
  if (masked) {
    s.password = s.password ? MASK : '';
    s.source = fromDb ? 'settings' : s.host ? 'env' : 'none';
    s.enabled = !!s.host;
  }
  return s;
}

export async function saveEmailSettings(b) {
  const cur = await emailSettings();
  const host = String(b.host ?? '').trim();
  const port = Number(b.port || 587);
  if (host && (!Number.isInteger(port) || port < 1 || port > 65535)) throw Object.assign(new Error('Port must be a number, usually 587 or 465'), { status: 400 });
  const user = String(b.user ?? '').trim();
  const from = String(b.from ?? '').trim();
  if (host && !from && !user) throw Object.assign(new Error('Enter the sender address ("From")'), { status: 400 });
  const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];
  if (from && !EMAIL_RE.test(fromAddr)) throw Object.assign(new Error('"From" must be an email address, e.g. Gate Pass <gatepass@company.com>'), { status: 400 });
  const password = b.password === MASK ? cur.password : String(b.password ?? '');
  const secure = b.secure === true || b.secure === '1' || b.secure === 'true';
  await setSetting(KEYS.host, host);
  await setSetting(KEYS.port, port);
  await setSetting(KEYS.secure, secure ? '1' : '0');
  await setSetting(KEYS.user, user);
  await setSetting(KEYS.password, password);
  await setSetting(KEYS.from, from || (user ? `Gate Pass <${user}>` : ''));
  cached = null;
  return { host, port, user };
}

let cached = null; // { transport, from }
async function getTransport() {
  if (cached) return cached;
  const s = await emailSettings();
  cached = {
    from: s.from || s.user,
    transport: s.host
      ? nodemailer.createTransport({
          host: s.host,
          port: s.port,
          secure: s.secure,
          auth: s.user ? { user: s.user, pass: s.password } : undefined,
          connectionTimeout: 15000,
          greetingTimeout: 15000,
        })
      : null,
  };
  return cached;
}

/** Fire-and-forget email. Does nothing if SMTP is not configured. */
export function sendMail(to, subject, html) {
  if (!to || (Array.isArray(to) && !to.length)) return;
  getTransport()
    .then(({ transport, from }) => transport && transport.sendMail({ from, to, subject, html }))
    .catch((e) => console.error('[mail] failed:', e.message));
}

/** Sends a test message and waits for the result, so the admin sees any error. */
export async function sendTestMail(to) {
  cached = null;
  const { transport, from } = await getTransport();
  if (!transport) throw new Error('Email is not set up yet (no SMTP server entered)');
  await transport.verify();
  await transport.sendMail({
    from,
    to,
    subject: 'Gate Pass test email',
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">This is a test email from the Employee Gate Pass system.<br>If you can read this, email notifications are working.<br><br><a href="${config.appUrl}">Open Gate Pass</a></div>`,
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const t5 = (t) => String(t || '').slice(0, 5);

export function passSummaryHtml(p, intro) {
  const row = (k, v) => `<tr><td style="color:#4a5a6e"><b>${k}</b></td><td>${v}</td></tr>`;
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1b2430">
    <p>${intro}</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #dde3ea">
      ${row('Pass No.', esc(p.pass_no))}
      ${row('Employee', `${esc(p.emp_name)} (${esc(p.emp_code)})`)}
      ${row('Department', esc(p.department))}
      ${row('Date', esc(p.pass_date))}
      ${p.shift ? row('Shift', `${esc(p.shift)}${p.shift_start ? ` (${t5(p.shift_start)}–${t5(p.shift_end)})` : ''}`) : ''}
      ${row('Purpose', esc(p.reason_type))}
      ${row('Reason for going out', esc(p.reason))}
      ${row('Out time', t5(p.out_time))}
      ${row('Returning today', p.coming_back ? 'Yes, by ' + t5(p.expected_in_time) : 'No')}
      ${p.status !== 'pending' ? row('Status', `${esc(String(p.status).toUpperCase())}${p.decision_remark ? ' – ' + esc(p.decision_remark) : ''}`) : ''}
      ${p.actual_out ? row('Checked out', `${esc(p.actual_out)}${p.out_marked_by ? ' by ' + esc(p.out_marked_by) : ''}`) : ''}
      ${p.nr_reason ? row('Reason for not returning', esc(p.nr_reason)) : ''}
    </table>
    <p><a href="${config.appUrl}">Open Gate Pass</a></p>
  </div>`;
}
