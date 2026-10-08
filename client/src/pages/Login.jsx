import { useEffect, useState } from 'react';
import { CheckCircle2, LogIn } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/ui.jsx';

function MsLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Login() {
  const { loginWithToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState(null);

  useEffect(() => {
    api('/auth/config').then((c) => setMs(c.microsoft)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const { token } = await api('/auth/login', { method: 'POST', body: { email, password } });
      await loginWithToken(token);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const microsoft = async () => {
    setErr('');
    setBusy(true);
    try {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const pca = new PublicClientApplication({
        auth: {
          clientId: ms.clientId,
          authority: `https://login.microsoftonline.com/${ms.tenantId}`,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'sessionStorage' },
      });
      await pca.initialize();
      const result = await pca.loginPopup({ scopes: ['openid', 'profile', 'email'], prompt: 'select_account' });
      const { token } = await api('/auth/microsoft', { method: 'POST', body: { idToken: result.idToken } });
      await loginWithToken(token);
    } catch (e2) {
      if (!/user_cancelled|popup_window_error/i.test(e2.errorCode || e2.message)) setErr(e2.message || 'Microsoft sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="wordmark">HARMAN</div>
        <div>
          <h1>Employee Gate Pass</h1>
          <p style={{ maxWidth: 420, marginTop: 12 }}>
            Raise a gate pass, get it approved by your authority, and show it at the gate — no paper slips.
          </p>
          <ul style={{ marginTop: 28 }}>
            {['Request in under a minute', 'Approval from any assigned authority', 'Real-time attendance from eSSL'].map((t) => (
              <li key={t}>
                <CheckCircle2 size={18} color="#5ea2ff" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Harman International (India) Pvt. Ltd. · Mahalunge, Chakan, Pune</div>
      </div>
      <div className="login-form">
        <form className="box stack" onSubmit={submit}>
          <div>
            <h2 style={{ fontSize: 22 }}>Sign in</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Use your company email</p>
          </div>
          {err && <Alert type="error">{err}</Alert>}
          {ms?.enabled && (
            <>
              <button type="button" className="btn ms-btn" onClick={microsoft} disabled={busy}>
                <MsLogo /> Sign in with Microsoft
              </button>
              <div className="or">or with password</div>
            </>
          )}
          <Field label="Email ID">
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn primary" style={{ height: 42, justifyContent: 'center' }} disabled={busy}>
            <LogIn size={17} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted small" style={{ margin: 0 }}>Forgot your password? Ask the administrator to reset it.</p>
        </form>
      </div>
    </div>
  );
}
