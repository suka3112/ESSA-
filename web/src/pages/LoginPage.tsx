/**
 * Sign-in gate — replaces the removed Login / 2FA screens (approved design:
 * authentication is Microsoft Entra ID; the Dashboard is the first product
 * screen, and there is no form and no password).
 *
 * In production (VITE_DEMO_PERSONAS=off) nothing is asked: the redirect to
 * Microsoft resolves the corporate identity and the person lands on their
 * dashboard.
 *
 * In the DEV/UAT build the screen waits (review, 25 Aug) — a reviewer chooses
 * which persona to continue as, and nothing is signed in until they pick one.
 * The same personas are then switchable from the account menu.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { DEMO_PERSONAS, useAuth } from '@/lib/auth';
import { displayRoles } from '@/lib/format';
import { Button, LoadingState } from '@/components/ui';

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
  const started = useRef(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<DirectoryUser[]>('/auth/directory'),
    enabled: DEMO_PERSONAS,
  });
  // Only identities that can actually be used: enabled, and holding a role.
  const personas = (users ?? []).filter((u) => u.enabled && u.roles.length);

  /**
   * Production only. The demo build never redirects on its own — it waits for
   * the reviewer to choose a persona.
   */
  useEffect(() => {
    if (DEMO_PERSONAS || started.current) return;
    started.current = true;
    const t = window.setTimeout(() => {
      ssoLogin()
        .then(() => navigate('/', { replace: true }))
        .catch((e) => setError(e instanceof Error ? e.message : 'Single sign-on failed'));
    }, 700);
    return () => window.clearTimeout(t);
  }, [ssoLogin, navigate]);

  const continueAs = async (id: string) => {
    setBusyUser(id);
    setError(null);
    try {
      await login(id);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setBusyUser(null);
    }
  };

  const retry = () => {
    setError(null);
    ssoLogin()
      .then(() => navigate('/', { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Single sign-on failed'));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-pop">
        <div className="text-center">
          <p className="text-2xl font-black tracking-tight text-essa-700">
            eapa<span className="align-super text-xs text-essa-400">●</span>
          </p>
          <p className="mt-0.5 text-2xs font-semibold uppercase tracking-widest text-ink-muted">ESSA Accounts Payable Automation</p>
        </div>

        {error && (
          <div className="mt-6 space-y-3 text-center">
            <p className="rounded-md bg-semantic-errorBg px-3 py-2 text-xs text-semantic-error">{error}</p>
            {!DEMO_PERSONAS && (
              <Button className="w-full" onClick={retry}>
                <MicrosoftMark /> Sign in with Microsoft
              </Button>
            )}
          </div>
        )}

        {DEMO_PERSONAS ? (
          <div className="mt-7">
            <p className="text-sm font-semibold text-ink">Continue as</p>
            <p className="mt-0.5 text-2xs leading-snug text-ink-muted">
              Choose the persona to review the platform as. What you can see and do is decided by the roles that persona holds.
            </p>

            {isLoading ? (
              <LoadingState label="Loading personas…" />
            ) : (
              <div className="mt-3 space-y-1.5">
                {personas.map((u) => (
                  <button
                    key={u.id}
                    disabled={busyUser !== null}
                    onClick={() => continueAs(u.id)}
                    className="group flex w-full items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-essa-400 hover:bg-essa-50 disabled:opacity-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-essa-600 text-2xs font-bold text-white">
                      {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">{u.name}</span>
                      <span className="block truncate text-2xs text-ink-muted">{displayRoles(u.roles).join(' · ')}</span>
                    </span>
                    {busyUser === u.id ? (
                      <Loader2 size={14} className="shrink-0 animate-spin text-essa-600" />
                    ) : (
                      <ArrowRight size={14} className="shrink-0 text-ink-faint transition-colors group-hover:text-essa-700" />
                    )}
                  </button>
                ))}
                {!personas.length && (
                  <p className="rounded-md bg-canvas px-3 py-2 text-2xs text-ink-muted">
                    No portal user has been given a role yet. An administrator assigns roles under Administration → Users &amp; Roles.
                  </p>
                )}
              </div>
            )}

            <p className="mt-5 rounded-md bg-canvas px-3 py-2 text-2xs leading-snug text-ink-muted">
              Demo environment. In production this screen does not appear — sign-in goes straight through your corporate
              Microsoft account and you are whoever it signs you in as.
            </p>
          </div>
        ) : (
          !error && (
            <div className="mt-8 flex flex-col items-center gap-3 text-center">
              <span className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-secondary">
                <MicrosoftMark /> Redirecting to Microsoft sign-in…
              </span>
              <Loader2 size={18} className="animate-spin text-essa-600" />
              <p className="max-w-xs text-2xs text-ink-muted">
                Authentication is handled by your corporate Microsoft account. You&apos;ll land on your dashboard automatically.
              </p>
            </div>
          )
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 border-t border-line-soft pt-4 text-2xs text-ink-faint">
          <ShieldCheck size={12} /> Microsoft Entra ID · corporate identity policies apply · no local passwords
        </p>
      </div>
    </div>
  );
}
