import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '@/lib/api';
import { fmtDateTime, titleCase } from '@/lib/format';
import { Badge, Card, Input, NoResults, PageHeader, Pagination, Select, StatusBadge, LoadingState } from '@/components/ui';

interface AuditRow {
  id: string; eventTime: string; actorType: string; actorName: string; actorRole?: string; eventType: string;
  category: string; action: string; module: string; entityType: string; entityId: string; entityRef?: string;
  invoiceId?: string; result: string; reason?: string; oldValue?: unknown; newValue?: unknown; correlationId: string; source: string;
}

export default function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const { data, isLoading } = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.get<{ items: AuditRow[]; page: number; pageSize: number; total: number; totalPages: number }>(`/audit${qs({ pageSize: 50, ...query })}`),
  });

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Audit Logs' }]}
        title="Business & Security Audit Trail"
        description="Unified append-only audit events with actor, entity, before/after values and correlation IDs. Records cannot be edited or deleted."
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setParam('search', String(new FormData(e.currentTarget).get('q') || '') || undefined);
            }}
          >
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input name="q" defaultValue={params.get('search') ?? ''} placeholder="Search actor, event, entity, correlation ID…" className="w-72 pl-8" aria-label="Search audit events" />
          </form>
          <Select value={params.get('category') ?? ''} onChange={(e) => setParam('category', e.target.value || undefined)} aria-label="Category filter">
            <option value="">All categories</option>
            {['AUTHENTICATION', 'INVOICE', 'DOCUMENT', 'EXTRACTION', 'VALIDATION', 'EXCEPTION', 'APPROVAL', 'SAP', 'VENDOR', 'ACCESS', 'CONFIGURATION', 'BIOMETRIC'].map((c) => (
              <option key={c} value={c}>{titleCase(c)}</option>
            ))}
          </Select>
          <Select value={params.get('result') ?? ''} onChange={(e) => setParam('result', e.target.value || undefined)} aria-label="Result filter">
            <option value="">All results</option>
            {['SUCCESS', 'FAILURE', 'PASS', 'FAIL', 'OVERRIDDEN', 'DENIED'].map((r) => (
              <option key={r} value={r}>{titleCase(r)}</option>
            ))}
          </Select>
          <Input type="date" value={params.get('dateFrom') ?? ''} onChange={(e) => setParam('dateFrom', e.target.value || undefined)} aria-label="From date" />
          <Input type="date" value={params.get('dateTo') ?? ''} onChange={(e) => setParam('dateTo', e.target.value || undefined)} aria-label="To date" />
          <span className="ml-auto flex items-center gap-1 text-2xs text-ink-muted"><ShieldCheck size={12} className="text-essa-600" /> Append-only store</span>
        </div>
        {isLoading ? (
          <LoadingState />
        ) : !data?.items.length ? (
          <NoResults />
        ) : (
          <div className="divide-y divide-line-soft">
            {data.items.map((a) => (
              <div key={a.id}>
                <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left hover:bg-essa-50/50">
                  <span className="w-36 shrink-0 whitespace-nowrap text-2xs text-ink-muted">{fmtDateTime(a.eventTime)}</span>
                  <span className="w-14 font-mono text-2xs text-ink-faint">{a.id}</span>
                  <Badge tone="neutral">{a.category}</Badge>
                  <span className="min-w-44 text-xs font-medium">{titleCase(a.eventType)}</span>
                  <span className="text-xs text-ink-secondary">{a.actorName}{a.actorRole ? ` (${a.actorRole})` : ''}</span>
                  <span className="hidden max-w-52 truncate text-2xs text-ink-muted lg:block">{a.entityType}{a.entityRef ? ` · ${a.entityRef}` : ''}</span>
                  <span className="ml-auto"><StatusBadge value={a.result} /></span>
                </button>
                {expanded === a.id && (
                  <div className="grid gap-2 border-t border-line-soft bg-canvas px-5 py-3 text-2xs md:grid-cols-2">
                    <p><span className="text-ink-muted">Entity:</span> {a.entityType} / {a.entityId} {a.entityRef ? `(${a.entityRef})` : ''}</p>
                    <p><span className="text-ink-muted">Module / Source:</span> {a.module} · {a.source} · actor type {a.actorType}</p>
                    <p><span className="text-ink-muted">Correlation:</span> <span className="font-mono">{a.correlationId}</span></p>
                    {a.invoiceId && (
                      <p><span className="text-ink-muted">Invoice:</span> <Link className="text-essa-700 underline" to={`/invoices/${a.invoiceId}`}>{a.invoiceId}</Link></p>
                    )}
                    {a.reason && <p className="md:col-span-2"><span className="text-ink-muted">Reason:</span> {a.reason}</p>}
                    {a.oldValue != null && (
                      <p className="break-all md:col-span-2"><span className="text-ink-muted">Before:</span> <span className="rounded bg-semantic-errorBg px-1 font-mono">{JSON.stringify(a.oldValue)}</span></p>
                    )}
                    {a.newValue != null && (
                      <p className="break-all md:col-span-2"><span className="text-ink-muted">After:</span> <span className="rounded bg-semantic-successBg px-1 font-mono">{JSON.stringify(a.newValue)}</span></p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {data && (
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => setParam('page', String(p))} onPageSize={(s) => setParam('pageSize', String(s))} />
        )}
      </Card>
    </div>
  );
}
