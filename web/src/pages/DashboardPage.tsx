import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, BadgeCheck, Clock, FileWarning, FolderSync, Inbox, Mail, ScanEye, Upload } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '@/lib/api';
import { fmtMoney, fmtRelative } from '@/lib/format';
import { Card, ErrorState, Input, LoadingState, PageHeader, StatusBadge, Badge } from '@/components/ui';

/** Local-timezone yyyy-mm-dd. */
const iso = (d: Date) => d.toLocaleDateString('en-CA');

const RANGE_PRESETS: { key: string; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '6m', label: '6 months' },
  { key: '12m', label: '12 months' },
];

function presetDates(key: string): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'week': {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return { dateFrom: iso(monday), dateTo: iso(now) };
    }
    case 'month':
      return { dateFrom: iso(new Date(y, m, 1)), dateTo: iso(now) };
    case 'lastMonth':
      return { dateFrom: iso(new Date(y, m - 1, 1)), dateTo: iso(new Date(y, m, 0)) };
    case '6m':
      return { dateFrom: iso(new Date(y, m - 5, 1)), dateTo: iso(now) };
    case '12m':
      return { dateFrom: iso(new Date(y, m - 11, 1)), dateTo: iso(now) };
    default:
      return {};
  }
}

interface DashboardData {
  kpis: Record<string, number | null>;
  byLifecycle: Record<string, number>;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  trend: { date: string; received: number; completed: number }[];
  vendorSpend: { code: string; name: string; amount: number; count: number }[];
  funnel: { stage: string; count: number }[];
  approvalBacklog: { stepId: string; invoiceId: string; invoiceNumber?: string; name: string; assignedToName?: string; amount?: number; dueAt?: string; overdue: boolean }[];
  integrationHealth: { sapState: string; sapMessage: string; referenceDataSyncedAt: string; referenceDataStale: boolean; sharePointState: string; mailboxState: string; gptState: string; biometricLastPushAt: string; teamsState: string };
  slaBreaches: { id: string; invoiceNumber: string; vendorName: string; stage: string; slaDueAt: string }[];
}

function KpiCard({ label, value, tone, to, icon }: { label: string; value: number | string | null | undefined; tone?: 'green' | 'red' | 'amber' | 'blue' | 'neutral'; to?: string; icon?: React.ReactNode }) {
  const tones = {
    green: 'text-essa-700', red: 'text-semantic-error', amber: 'text-semantic-warning', blue: 'text-semantic-info', neutral: 'text-ink',
  };
  const body = (
    <div className="flex h-full flex-col justify-between bg-white p-3 transition-colors hover:bg-essa-50/70">
      <div className="flex items-center justify-between text-2xs font-medium uppercase tracking-wide text-ink-muted">
        {label} {icon}
      </div>
      <p className={clsx('mt-1 text-2xl font-bold leading-none', tones[tone ?? 'neutral'])}>{value ?? '—'}</p>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [workTab, setWorkTab] = useState<'approvals' | 'sla'>('approvals');
  const [range, setRange] = useState('all');
  const [custom, setCustom] = useState<{ dateFrom: string; dateTo: string }>({ dateFrom: '', dateTo: '' });
  const dates = range === 'custom'
    ? { dateFrom: custom.dateFrom || undefined, dateTo: custom.dateTo || undefined }
    : presetDates(range);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', dates],
    queryFn: () => api.get<DashboardData>(`/dashboard${qs(dates)}`),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

  if (isLoading) return <LoadingState label="Loading AP operations dashboard…" />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;

  const k = data.kpis;
  const health = data.integrationHealth;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home' }, { label: 'Dashboard' }]}
        title="AP Operations Dashboard"
        description="What requires attention right now across ingestion, extraction, validation, approvals and SAP processing."
      />

      {/* Date range filter — presets + custom From/To (scopes by received date) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-white p-1 shadow-card">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setRange(p.key)}
              className={clsx(
                'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                range === p.key ? 'bg-essa-600 text-white' : 'text-ink-secondary hover:bg-essa-50 hover:text-essa-700'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-2xs text-ink-muted">
          <span className="font-medium uppercase tracking-wide">Custom</span>
          <Input
            type="date" aria-label="From date" className="h-8"
            value={range === 'custom' ? custom.dateFrom : dates.dateFrom ?? ''}
            onChange={(e) => {
              setCustom((c) => ({ dateFrom: e.target.value, dateTo: range === 'custom' ? c.dateTo : dates.dateTo ?? '' }));
              setRange('custom');
            }}
          />
          <span>–</span>
          <Input
            type="date" aria-label="To date" className="h-8"
            value={range === 'custom' ? custom.dateTo : dates.dateTo ?? ''}
            onChange={(e) => {
              setCustom((c) => ({ dateFrom: range === 'custom' ? c.dateFrom : dates.dateFrom ?? '', dateTo: e.target.value }));
              setRange('custom');
            }}
          />
        </div>
      </div>

      {health.sapState !== 'CONNECTED' && (
        <div className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium', health.sapState === 'DEGRADED' ? 'border-amber-300 bg-semantic-warningBg text-semantic-warning' : 'border-red-300 bg-semantic-errorBg text-semantic-error')}>
          <AlertTriangle size={14} />
          SAP interface is {health.sapState.toLowerCase()} — {health.sapMessage}. Portal functions remain available; SAP-dependent work is safely queued.
        </div>
      )}

      {/* KPI band — one segmented strip instead of ten floating tiles */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line-soft shadow-card sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
        <KpiCard label="Total" value={k.total} to="/invoices" />
        <KpiCard label="In Pipeline" value={k.inValidation} tone="blue" to="/invoices?lifecycle=DRAFT" />
        <KpiCard label="Exceptions" value={k.exceptions} tone="red" to="/exceptions" />
        <KpiCard label="Approvals" value={k.pendingApproval} tone="amber" to="/approvals" />
        <KpiCard label="Validated" value={k.validated} tone="blue" to="/invoices?lifecycle=VALIDATED" />
        <KpiCard label="In Progress" value={k.inProgress} to="/invoices?lifecycle=IN_PROGRESS" />
        <KpiCard label="Parked" value={k.parked} tone="amber" to="/invoices?lifecycle=PARKED" />
        <KpiCard label="Posted" value={k.posted} tone="green" to="/invoices?lifecycle=POSTED" />
        <KpiCard label="Paid" value={k.paid} tone="green" to="/invoices?lifecycle=PAID" />
        <KpiCard label="SLA Breaches" value={k.slaBreaches} tone="red" to="/invoices?slaBreached=true" />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Review Exceptions', count: k.exceptions, to: '/exceptions?open=true', icon: <FileWarning size={16} />, tone: 'text-semantic-error' },
          { label: 'Pending Approvals', count: k.pendingApproval, to: '/approvals', icon: <BadgeCheck size={16} />, tone: 'text-semantic-info' },
          { label: 'Low-Confidence Review', count: k.extractionReview, to: '/invoices?processingFlag=EXTRACTION_REVIEW', icon: <ScanEye size={16} />, tone: 'text-semantic-warning' },
          { label: 'Missing Supporting Documents', count: k.missingDocuments, to: '/invoices?processingFlag=MISSING_DOCUMENTS', icon: <Inbox size={16} />, tone: 'text-semantic-warning' },
        ].map((a) => (
          <button key={a.label} onClick={() => navigate(a.to)} className="group flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-essa-400 hover:shadow-pop">
            <span className="flex items-center gap-2.5 text-xs font-medium text-ink-secondary">
              <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas', a.tone)}>{a.icon}</span> {a.label}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-base font-bold text-ink">{a.count ?? 0}</span>
              <ArrowRight size={13} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
        {/* Vendor spend */}
        <Card title="Vendor spend" className="flex flex-col">
          {/* Absolute positioning prevents the chart's measured size feeding back
              into the card's auto height (infinite grow loop). */}
          <div className="relative h-full min-h-72">
            <div className="absolute inset-0">
            <ResponsiveContainer>
              <BarChart data={data.vendorSpend} layout="vertical" margin={{ top: 4, left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${Math.round(v / 1000)}K`)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={104} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => fmtMoney(v)} />
                <Bar dataKey="amount" name="Billed value" fill="#1f7a41" radius={[0, 3, 3, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        </Card>

        {/* Funnel */}
        <Card title="Lifecycle funnel">
          <div className="space-y-2">
            {data.funnel.map((f, i) => {
              const max = data.funnel[0]?.count || 1;
              return (
                <div key={f.stage} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-ink-muted">{f.stage}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-line-soft">
                    <div className="h-full rounded bg-essa-600 transition-all" style={{ width: `${(f.count / max) * 100}%`, opacity: 1 - i * 0.08 }} />
                  </div>
                  <span className="w-6 text-right font-semibold">{f.count}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 border-t border-line-soft pt-2 text-2xs text-ink-muted">
            Avg extraction confidence: <span className="font-semibold text-ink">{k.avgConfidence != null ? `${k.avgConfidence}%` : '—'}</span>
          </p>

          {/* Intake mix — same data that used to sit in its own bottom card */}
          <div className="mt-3 border-t border-line-soft pt-2.5">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Intake channels</p>
            <div className="space-y-1.5">
              {([
                ['EMAIL', 'AP Mailbox', <Mail key="i" size={13} />, 'bg-essa-600'],
                ['SHAREPOINT', 'SharePoint Monitor', <FolderSync key="i" size={13} />, 'bg-essa-500'],
                ['MANUAL_UPLOAD', 'Manual Upload', <Upload key="i" size={13} />, 'bg-essa-300'],
              ] as const).map(([key, label, icon, barTone]) => {
                const count = data.bySource[key] ?? 0;
                const total = Object.values(data.bySource).reduce((a, b) => a + b, 0) || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <button
                    key={key}
                    onClick={() => navigate(`/invoices?source=${key}`)}
                    className="block w-full rounded-md p-1 text-left transition-colors hover:bg-essa-50/70"
                  >
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-ink-secondary">
                        <span className="text-essa-700">{icon}</span> {label}
                      </span>
                      <span className="whitespace-nowrap">
                        <span className="font-semibold text-ink">{count}</span>
                        <span className="ml-1 text-2xs text-ink-muted">{pct}%</span>
                      </span>
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line-soft">
                      <span className={clsx('block h-full rounded-full', barTone)} style={{ width: `${pct}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Approval backlog / SLA breaches — tabbed */}
        <Card className="flex flex-col">
        <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-line-soft pb-2">
          <div className="flex gap-1">
            {([
              ['approvals', `Approval backlog (${data.approvalBacklog.length})`],
              ['sla', `SLA breaches (${data.slaBreaches.length})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setWorkTab(key)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  workTab === key ? 'bg-essa-600 text-white' : 'text-ink-secondary hover:bg-essa-50 hover:text-essa-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Link to={workTab === 'approvals' ? '/approvals' : '/invoices?slaBreached=true'} className="text-xs font-medium text-essa-700 hover:underline">
            View all
          </Link>
        </div>

        {workTab === 'approvals' ? (
          data.approvalBacklog.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-muted">No approvals waiting.</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto">
              {data.approvalBacklog.map((a) => (
                <li key={a.stepId}>
                  <Link to={`/invoices/${a.invoiceId}?tab=approvals`} className="flex items-center justify-between gap-2 py-2 text-xs hover:bg-essa-50">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{a.invoiceNumber}</span>
                      <span className="block truncate text-2xs text-ink-muted">{a.name} · {a.assignedToName ?? 'Role queue'}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold">{fmtMoney(a.amount)}</span>
                      {a.overdue ? <Badge tone="error">Overdue</Badge> : <span className="text-2xs text-ink-faint"><Clock size={10} className="mr-0.5 inline" />{fmtRelative(a.dueAt)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : data.slaBreaches.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-muted">No SLA breaches. Great work.</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto">
            {data.slaBreaches.map((s) => (
              <li key={s.id}>
                <Link to={`/invoices/${s.id}`} className="flex items-center justify-between gap-2 py-2 text-xs hover:bg-essa-50">
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{s.invoiceNumber}</span>
                    <span className="block truncate text-2xs text-ink-muted">{s.vendorName}</span>
                  </span>
                  <span className="text-right">
                    <StatusBadge value={s.stage} />
                    <span className="block text-2xs text-semantic-error">due {fmtRelative(s.slaDueAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        </div>
        </Card>
      </div>

    </div>
  );
}
