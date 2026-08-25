/**
 * SSO gate — replaces the removed Login / 2FA screens (approved design:
 * authentication is Microsoft Azure SSO only; the Dashboard is the first
 * product screen).
 *
 * Unauthenticated users land here for a moment while the "redirect to
 * Microsoft sign-in" resolves, then continue straight to the dashboard.
 * In this demo environment Entra ID is simulated; a collapsed persona
 * switcher is kept for UAT walkthroughs only.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useAuth, wasExplicitlySignedOut } from '@/lib/auth';
import { Button } from '@/components/ui';

interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  title: string;
  enabled: boolean;
  roles: string[];
}

function MicrosoftMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, ssoLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  // After an explicit "Sign out" the SSO gate waits for the user instead of
  // auto-redirecting, so a different persona can be chosen (demo / UAT).
  const [signedOut] = useState(() => wasExplicitlySignedOut());
  const [personasOpen, setPersonasOpen] = useState(() => wasExplicitlySignedOut());
  const started = useRef(false);

  const { data: users } = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<DirectoryUser[]>('/auth/directory'),
    enabled: personasOpen,
  });

  // Automatic "redirect" to Microsoft sign-in — no form, no 2FA screen.
  useEffect(() => {
    if (started.current || signedOut) return;
    started.current = true;
    const t = window.setTimeout(() => {
      ssoLogin()
        .then(() => navigate('/', { replace: true }))
        .catch((e) => setError(e instanceof Error ? e.message : 'Single sign-on failed'));
    }, 700);
    return () => window.clearTimeout(t);
  }, [ssoLogin, navigate, signedOut]);

  const retry = () => {
    setError(null);
    ssoLogin()
      .then(() => navigate('/', { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Single sign-on failed'));
  };

  const loginAs = async (id: string) => {
    setBusyUser(id);
    setError(null);
    try {
      await login(id);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusyUser(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-pop">
        <p className="text-2xl font-black tracking-tight text-essa-700">
          eapa<span className="align-super text-xs text-essa-400">●</span>
        </p>
        <p className="mt-0.5 text-2xs font-semibold uppercase tracking-widest text-ink-muted">ESSA Accounts Payable Automation</p>

        {signedOut && !error ? (
          <div className="mt-8 space-y-3">
            <p className="text-xs text-ink-secondary">You have been signed out.</p>
            <Button className="w-full" onClick={retry}>
              <MicrosoftMark /> Sign in with Microsoft
            </Button>
          </div>
        ) : !error ? (
          <div className="mt-8 flex flex-col items-center gap-3">
            <span className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-secondary">
              <MicrosoftMark /> Redirecting to Microsoft sign-in…
            </span>
            <Loader2 size={18} className="animate-spin text-essa-600" />
            <p className="max-w-xs text-2xs text-ink-muted">
              Authentication is handled by your corporate Microsoft account. You'll land on your dashboard automatically.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            <p className="rounded-md bg-semantic-errorBg px-3 py-2 text-xs text-semantic-error">{error}</p>
            <Button className="w-full" onClick={retry}>
              <MicrosoftMark /> Sign in with Microsoft
            </Button>
          </div>
        )}

        <p className="mt-8 flex items-center justify-center gap-1.5 text-2xs text-ink-faint">
          <ShieldCheck size={12} /> Microsoft Entra ID · corporate identity policies apply · no local passwords
        </p>

        {/* Demo-only persona switcher (collapsed; Entra is simulated in this environment) */}
        <div className="mt-6 border-t border-line-soft pt-3">
          <button
            onClick={() => setPersonasOpen((o) => !o)}
            className="mx-auto flex items-center gap-1 text-2xs text-ink-faint hover:text-ink-secondary"
          >
            Demo environment · continue as a specific persona
            <ChevronDown size={12} className={clsx('transition-transform', personasOpen && 'rotate-180')} />
          </button>
          {personasOpen && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1 text-left scrollbar-thin">
              {users?.filter((u) => u.enabled).map((u) => (
                <button
                  key={u.id}
                  disabled={busyUser !== null}
                  onClick={() => loginAs(u.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:border-essa-300 hover:bg-canvas disabled:opacity-50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-essa-600 text-2xs font-bold text-white">
                    {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">{u.name}</span>
                    <span className="block truncate text-2xs text-ink-muted">{u.title}</span>
                  </span>
                  {busyUser === u.id && <Loader2 size={12} className="animate-spin text-essa-600" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
