import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null); // { user, isAuthority, authorities }
  const [loading, setLoading] = useState(!!getToken());
  const [summary, setSummary] = useState({});

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSummary = useCallback(() => {
    if (getToken()) api('/auth/summary').then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onLogout = () => setMe(null);
    window.addEventListener('gp-logout', onLogout);
    return () => window.removeEventListener('gp-logout', onLogout);
  }, [refresh]);

  useEffect(() => {
    if (!me) return;
    refreshSummary();
    const t = setInterval(refreshSummary, 30000);
    return () => clearInterval(t);
  }, [me, refreshSummary]);

  const loginWithToken = async (token) => {
    setToken(token);
    setLoading(true);
    await refresh();
  };
  const logout = () => {
    setToken(null);
    setMe(null);
  };

  return (
    <AuthCtx.Provider value={{ me, user: me?.user, loading, refresh, loginWithToken, logout, summary, refreshSummary }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
