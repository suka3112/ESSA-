import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, KeyRound, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, LoadingState } from '@/components/ui';

interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  title: string;
  department: string;
  enabled: boolean;
  roles: string[];
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: users, isLoading } = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<DirectoryUser[]>('/auth/directory'),
  });

  const doLogin = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await login(selected);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-white shadow-pop">
        <div className="grid md:grid-cols-5">
          <div className="bg-essa-700 p-8 text-white md:col-span-2">
            <p className="text-3xl font-black tracking-tight">
              essa<span className="align-super text-sm text-essa-200">●</span>
            </p>
            <h1 className="mt-6 text-xl font-semibold leading-snug">AP Automation Platform</h1>
            <p className="mt-2 text-sm text-essa-100">
              Enterprise accounts payable orchestration — ingestion, AI extraction, N-way validation, approvals and SAP integration.
            </p>
            <div className="mt-8 space-y-3 text-xs text-essa-100">
              <p className="flex items-center gap-2"><ShieldCheck size={15} /> Microsoft Entra ID single sign-on</p>
              <p className="flex items-center gap-2"><Building2 size={15} /> Launch from SAP Fiori or direct URL</p>
              <p className="flex items-center gap-2"><KeyRound size={15} /> No local passwords — corporate identity policies apply</p>
            </div>
            <p className="mt-10 rounded-md bg-essa-800/70 p-3 text-2xs leading-relaxed text-essa-200">
              Demo environment: Entra ID SSO is simulated. Select a portal user to experience their role-based view. In production this screen is replaced by the corporate Microsoft sign-in.
            </p>
          </div>
          <div className="p-6 md:col-span-3">
            <h2 className="text-sm font-semibold text-ink">Sign in as</h2>
            <p className="mb-3 text-xs text-ink-muted">Authorization is resolved from portal roles, groups and scopes after Entra authentication.</p>
            {isLoading ? (
              <LoadingState label="Loading directory…" />
            ) : (
              <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                {users?.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => u.enabled && setSelected(u.id)}
                    disabled={!u.enabled}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                      selected === u.id ? 'border-essa-500 bg-essa-50 ring-2 ring-essa-100' : 'border-line hover:border-essa-300 hover:bg-canvas',
                      !u.enabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-essa-600 text-xs font-bold text-white">
                      {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{u.name}</span>
                      <span className="block truncate text-2xs text-ink-muted">
                        {u.title} · {u.department}
                      </span>
                      <span className="block truncate text-2xs text-essa-700">{u.roles.join(', ')}</span>
                    </span>
                    {!u.enabled && <span className="text-2xs font-semibold uppercase text-semantic-error">Disabled</span>}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="mt-3 rounded-md bg-semantic-errorBg px-3 py-2 text-xs text-semantic-error">{error}</p>}
            <Button className="mt-4 w-full" disabled={!selected} loading={busy} onClick={doLogin}>
              Continue with Microsoft Entra ID
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
