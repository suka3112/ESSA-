import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  permissions: string[];
  roleNames: string[];
}

interface AuthContextShape {
  user: SessionUser | null;
  loading: boolean;
  login: (userId: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (...perms: string[]) => boolean;
}

const AuthContext = createContext<AuthContextShape>({
  user: null,
  loading: true,
  login: async () => undefined,
  logout: async () => undefined,
  hasPerm: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // V1 -> V2 version-switch handoff: the POC (V1) passes the signed-in
    // identity in the URL; sign the same user in here without a second login.
    const sp = new URLSearchParams(window.location.search);
    const v1email = sp.get('v1email');
    if (v1email) {
      if (sp.get('back')) sessionStorage.setItem('essa.v1.back', sp.get('back')!);
      api
        .post<{ token: string; user: SessionUser }>('/auth/v1-handoff', {
          email: v1email,
          name: sp.get('v1name') || undefined,
          roleId: sp.get('v1role') || undefined,
        })
        .then((r) => {
          setToken(r.token);
          setUser(r.user);
        })
        .catch(() => setToken(null))
        .finally(() => {
          window.history.replaceState({}, '', window.location.pathname);
          setLoading(false);
        });
      return;
    }
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: SessionUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (userId: string) => {
    const r = await api.post<{ token: string; user: SessionUser }>('/auth/login', { userId });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  }, []);

  const hasPerm = useCallback(
    (...perms: string[]) => {
      if (!user) return false;
      return perms.every((p) => user.permissions.includes(p));
    },
    [user]
  );

  const value = useMemo(() => ({ user, loading, login, logout, hasPerm }), [user, loading, login, logout, hasPerm]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
