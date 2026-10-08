import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, useToast } from '../components/ui.jsx';

export function PasswordForm({ onDone, forced }) {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (f.newPassword !== f.confirm) return setErr('New passwords do not match');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: f });
      toast('Password changed');
      setF({ currentPassword: '', newPassword: '', confirm: '' });
      onDone?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={submit}>
      {err && <Alert type="error">{err}</Alert>}
      <Field label={forced ? 'Current (temporary) password' : 'Current password'}>
        <input className="input" type="password" value={f.currentPassword} onChange={set('currentPassword')} required autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 8 characters with letters and numbers">
        <input className="input" type="password" value={f.newPassword} onChange={set('newPassword')} required autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <input className="input" type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" />
      </Field>
      <div>
        <button className="btn primary" disabled={busy}>
          <KeyRound size={16} /> {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

export default function ChangePassword() {
  const { refresh, logout, user } = useAuth();
  return (
    <div className="login-form" style={{ minHeight: '100%' }}>
      <div className="box card card-pad stack" style={{ maxWidth: 420 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>Set your password</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Welcome, {user.name}. For security, please choose your own password before continuing.
          </p>
        </div>
        <PasswordForm forced onDone={refresh} />
        <button className="btn ghost sm" onClick={logout} style={{ alignSelf: 'flex-start' }}>Sign out</button>
      </div>
    </div>
  );
}
