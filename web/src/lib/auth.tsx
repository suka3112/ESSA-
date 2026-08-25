import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  title: string;
  permissions: string[];
  roleNames: string[];
}

interface AuthContextShape {
  user: SessionUser | null;
  loading: boolean;
  login: (userId: string) => Promise<void>;
  /** Simulated Microsoft Entra ID SSO: signs in the corporate identity without a login form. */
  ssoLogin: () => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (...perms: string[]) => boolean;
}

const AuthContext = createContext<AuthContextShape>({
  user: null,
  loading: true,
  login: async () => undefined,
  ssoLogin: async () => undefined,
  logout: async () => undefined,
  hasPerm: () => false,
});

/** Remembers which directory identity "Entra" resolved to, so refreshes and sign-in/out cycles stay on the same user. */
const SSO_HINT_KEY = 'essa.sso.user';

/**
 * Persona selection for demos and UAT.
 *
 * Authentication is Microsoft Entra ID, so in production a person is whoever
 * their corporate account signs them in as: sign-in redirects straight through
 * and there is nothing to choose. In the DEV/UAT build the reviewer picks which
 * persona to look at the platform as — on the sign-in screen, and from the
 * account menu afterwards. Set VITE_DEMO_PERSONAS=off to get the production
 * behaviour.
 */
export const DEMO_PERSONAS = import.meta.env.VITE_DEMO_PERSONAS !== 'off';

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
    try {
      localStorage.setItem(SSO_HINT_KEY, userId);
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Azure SSO stand-in (approved design: no Login/2FA screens — authentication
   * is Microsoft Entra ID). In this demo environment there is no real Entra
   * tenant, so the "redirect" resolves the corporate identity from the
   * directory: the previously used identity if one is remembered, otherwise
   * the first enabled directory user.
   */
  const ssoLogin = useCallback(async () => {
    const directory = await api.get<{ id: string; enabled: boolean }[]>('/auth/directory');
    let hint: string | null = null;
    try {
      hint = localStorage.getItem(SSO_HINT_KEY);
    } catch {
      /* ignore */
    }
    const target = directory.find((u) => u.id === hint && u.enabled) ?? directory.find((u) => u.enabled);
    if (!target) throw new Error('No enabled portal user is mapped to this corporate identity.');
    await login(target.id);
  }, [login]);

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

  const value = useMemo(() => ({ user, loading, login, ssoLogin, logout, hasPerm }), [user, loading, login, ssoLogin, logout, hasPerm]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
