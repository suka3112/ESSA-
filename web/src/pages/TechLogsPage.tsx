import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, Search, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '@/lib/api';
import { fmtDateTime, titleCase } from '@/lib/format';
import { Badge, Button, Card, DataTable, Input, NoResults, PageHeader, Pagination, Select, StatusBadge, Tabs, useToast, type Column } from '@/components/ui';

interface LogRow {
  id: string; timestamp: string; level: string; service: string; module: string; event: string; message: string;
  correlationId?: string; requestId?: string; jobId?: string; invoiceId?: string; integration?: string;
  status?: string; durationMs?: number; errorCode?: string; retryCount?: number; environment: string;
}
interface JobRow {
  id: string; type: string; refId?: string; invoiceId?: string; status: string; attempts: number; maxAttempts: number;
  createdAt: string; updatedAt: string; nextRetryAt?: string; correlationId: string; detail: string; error?: string;
}

const LEVEL_TONE: Record<string, string> = { ERROR: 'text-semantic-error', FATAL: 'text-semantic-error', WARN: 'text-semantic-warning', INFO: 'text-semantic-info', DEBUG: 'text-ink-muted', TRACE: 'text-ink-faint' };

export default function TechLogsPage() {
  const [tab, setTab] = useState('logs');
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const query = useMemo(() => {
    const obj: Record<string, string> = {};
    params.forEach((v, k) => (obj[k] = v));
    return obj;
  }, [params]);

  const logsQ = useQuery({
    queryKey: ['tech-logs', query],
    queryFn: () => api.get<{ items: LogRow[]; page: number; pageSize: number; total: number; totalPages: number }>(`/tech-logs${qs({ pageSize: 50, ...query })}`),
    refetchInterval: 10_000,
  });
  const jobsQ = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get<{ items: JobRow[] }>('/jobs'),
    refetchInterval: 8_000,
  });
  const retryJob = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Job re-queued' });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const jobColumns: Column<JobRow>[] = [
    { key: 'id', header: 'Job', render: (j) => <span className="font-mono text-xs">{j.id}</span> },
    { key: 'type', header: 'Type', render: (j) => <Badge tone="neutral">{titleCase(j.type)}</Badge> },
    { key: 'detail', header: 'Detail', render: (j) => <span className="block max-w-64 truncate text-xs" title={j.detail}>{j.detail}</span> },
    { key: 'invoice', header: 'Invoice', render: (j) => (j.invoiceId ? <Link to={`/invoices/${j.invoiceId}`} className="text-essa-700 hover:underline">{j.invoiceId}</Link> : '—') },
    { key: 'status', header: 'Status', render: (j) => <StatusBadge value={j.status} /> },
    { key: 'attempts', header: 'Attempts', align: 'center', render: (j) => `${j.attempts}/${j.maxAttempts}` },
    { key: 'updated', header: 'Updated', render: (j) => <span className="whitespace-nowrap text-2xs">{fmtDateTime(j.updatedAt)}</span> },
    { key: 'error', header: 'Error', render: (j) => <span className="block max-w-52 truncate text-2xs text-semantic-error" title={j.error}>{j.error ?? '—'}</span> },
    { key: 'cor', header: 'Correlation', render: (j) => <span className="font-mono text-2xs text-ink-muted">{j.correlationId}</span> },
    {
      key: 'actions', header: 'Actions', render: (j) =>
        ['FAILED', 'DEAD_LETTER'].includes(j.status) ? (
          <Button size="sm" variant="secondary" onClick={() => retryJob.mutate(j.id)}><RefreshCcw size={12} /> Retry</Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Technical Logs' }]}
        title="Technical Visibility"
        description="Structured backend logs and asynchronous job state for support investigation. Separate from the business audit store; linked by correlation IDs. Sensitive payloads are never logged."
      />
      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={[{ key: 'logs', label: 'Structured Logs' }, { key: 'jobs', label: 'Integration Jobs' }]} active={tab} onChange={setTab} />
        </div>
        {tab === 'jobs' ? (
          <DataTable dense columns={jobColumns} rows={jobsQ.data?.items ?? []} rowKey={(j) => j.id} loading={jobsQ.isLoading} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  setParam('search', String(new FormData(e.currentTarget).get('q') || '') || undefined);
                }}
              >
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input name="q" defaultValue={params.get('search') ?? ''} placeholder="Search event, message, correlation ID…" className="w-72 pl-8" aria-label="Search logs" />
              </form>
              <Select value={params.get('level') ?? ''} onChange={(e) => setParam('level', e.target.value || undefined)} aria-label="Level filter">
                <option value="">All levels</option>
                {['ERROR', 'WARN', 'INFO', 'DEBUG'].map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
              <Select value={params.get('module') ?? ''} onChange={(e) => setParam('module', e.target.value || undefined)} aria-label="Module filter">
                <option value="">All modules</option>
                {['ingestion', 'extraction', 'rule-engine', 'workflow', 'sap-integration', 'biometric-integration', 'jobs', 'identity-access', 'http', 'bootstrap', 'seed'].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <div className="overflow-x-auto font-mono text-2xs">
              {logsQ.isLoading ? (
                <p className="p-6 text-center text-ink-muted">Loading…</p>
              ) : !logsQ.data?.items.length ? (
                <NoResults />
              ) : (
                logsQ.data.items.map((l) => (
                  <div key={l.id} className="flex items-start gap-2 border-b border-line-soft px-3 py-1.5 hover:bg-canvas">
                    <span className="w-32 shrink-0 whitespace-nowrap text-ink-faint">{fmtDateTime(l.timestamp)}</span>
                    <span className={clsx('w-11 shrink-0 font-bold', LEVEL_TONE[l.level] ?? '')}>{l.level}</span>
                    <span className="w-36 shrink-0 truncate text-ink-muted">{l.module}</span>
                    <span className="w-56 shrink-0 truncate font-semibold text-ink-secondary" title={l.event}>{l.event}</span>
                    <span className="min-w-0 flex-1 text-ink-secondary">{l.message}</span>
                    <span className="hidden shrink-0 items-center gap-1.5 lg:flex">
                      {l.durationMs != null && <span className="text-ink-faint">{l.durationMs}ms</span>}
                      {l.errorCode && <Badge tone="error">{l.errorCode}</Badge>}
                      {l.correlationId && <span className="text-essa-700">{l.correlationId}</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
            {logsQ.data && (
              <Pagination page={logsQ.data.page} totalPages={logsQ.data.totalPages} total={logsQ.data.total} pageSize={logsQ.data.pageSize} onPage={(p) => setParam('page', String(p))} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
