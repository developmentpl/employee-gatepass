import { useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PhotoPicker from '../components/PhotoPicker.jsx';
import { useToast } from '../components/ui.jsx';
import { PasswordForm } from './ChangePassword.jsx';

export default function Profile() {
  const { me, user, refresh } = useAuth();
  const [photo, setPhoto] = useState(user.photo);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = photo !== user.photo && photo;

  const savePhoto = async () => {
    setBusy(true);
    try {
      await api('/auth/me/photo', { method: 'POST', body: { dataUrl: photo } });
      toast('Photo updated');
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ['Employee ID', user.emp_code],
    ['Email', user.email],
    ['Department', user.department],
    ['Designation', user.designation],
    ['Shift', user.shift],
    ['Phone', user.phone],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Profile</h1>
          <p>Your details are managed by the administrator. You can update your photo and password.</p>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>{user.name}</h3></div>
          <div className="card-pad stack">
            <PhotoPicker value={photo} onChange={setPhoto} />
            {dirty && (
              <div>
                <button className="btn primary" onClick={savePhoto} disabled={busy}>
                  <Save size={16} /> {busy ? 'Saving…' : 'Save photo'}
                </button>
              </div>
            )}
            <dl className="kv">
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{v || '—'}</dd>
                </div>
              ))}
              <dt>Approving authorities</dt>
              <dd>{me.authorities?.length ? me.authorities.map((a) => `${a.level}: ${a.name}`).join(' · ') : 'Not assigned'}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Change password</h3></div>
          <div className="card-pad">
            <PasswordForm />
          </div>
        </div>
      </div>
    </>
  );
}
