import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtRelative, titleCase } from '@/lib/format';
import {
  Badge, Card, DataTable, Drawer, Input, KeyValue, NoResults, PageHeader, Pagination, Select, StatusBadge, type Column,
} from '@/components/ui';
import { ExceptionActions } from './exceptions/ExceptionActions';

interface ExceptionListRow {
  id: string; code: string; invoiceId: string; invoiceNumber?: string; vendorName?: string; amount?: number; currency?: string;
  type: string; severity: string; status: string; title: string; detail: string; ruleCode?: string;
  assignedToName?: string; createdAt: string; slaDueAt: string; ageHours: number; slaBreached: boolean;
  technical: boolean; retryCount: number; resolution?: string; correlationId: string;
  actions: { at: string; byName: string; action: string; note?: string }[];
}

export default function ExceptionsPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ExceptionListRow | null>(null);

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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['exceptions', query],
    queryFn: () => api.get<{ items: ExceptionListRow[]; page: number; pageSize: number; total: number; totalPages: number }>(`/exceptions${qs({ pageSize: 25, ...query })}`),
    refetchInterval: 15_000,
  });

  const columns: Column<ExceptionListRow>[] = [
    { key: 'code', header: 'Exception', render: (e) => <span className="font-medium text-essa-700">{e.code}</span> },
    {
      key: 'invoice', header: 'Invoice', render: (e) => (
        <div className="max-w-40">
          <Link to={`/invoices/${e.invoiceId}`} onClick={(ev) => ev.stopPropagation()} className="block truncate font-medium hover:text-essa-700 hover:underline">{e.invoiceNumber}</Link>
          <p className="truncate text-2xs text-ink-faint">{e.vendorName}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (e) => <span className="text-xs">{titleCase(e.type)}</span> },
    { key: 'severity', header: 'Severity', render: (e) => <StatusBadge value={e.severity} /> },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge value={e.status} /> },
    { key: 'title', header: 'Summary', render: (e) => <span className="block max-w-64 truncate text-xs" title={e.title}>{e.title}</span> },
    { key: 'assignedToName', header: 'Assigned To', render: (e) => e.assignedToName ?? <span className="text-ink-faint">Unassigned</span> },
    { key: 'createdAt', header: 'Created', sortable: true, render: (e) => <span className="whitespace-nowrap text-2xs">{fmtRelative(e.createdAt)}</span> },
    { key: 'age', header: 'Age', render: (e) => <span className="text-2xs">{e.ageHours < 24 ? `${e.ageHours}h` : `${Math.round(e.ageHours / 24)}d`}</span> },
    { key: 'sla', header: 'SLA', render: (e) => (e.slaBreached ? <Badge tone="error">Breached</Badge> : ['RESOLVED', 'CLOSED'].includes(e.status) ? <span className="text-ink-faint">—</span> : <span className="whitespace-nowrap text-2xs text-ink-muted">due {fmtRelative(e.slaDueAt)}</span>) },
    { key: 'class', header: 'Class', render: (e) => (e.technical ? <Badge tone="pending">Technical</Badge> : <Badge tone="neutral">Business</Badge>) },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoice Processing' }, { label: 'Exception Workbench' }]}
        title="Exception Workbench"
        description="Investigate, assign, correct, retry, override and resolve business and technical exceptions."
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setParam('search', String(fd.get('q') || '') || undefined);
            }}
          >
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input name="q" defaultValue={params.get('search') ?? ''} placeholder="Search code, invoice, rule…" className="w-64 pl-8" aria-label="Search exceptions" />
          </form>
          <Select value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value || undefined)} aria-label="Status filter">
            <option value="">All statuses</option>
            {['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </Select>
          <Select value={params.get('type') ?? ''} onChange={(e) => setParam('type', e.target.value || undefined)} aria-label="Type filter">
            <option value="">All types</option>
            {['MISSING_DOCUMENT', 'EXTRACTION_FAILURE', 'LOW_CONFIDENCE', 'VALIDATION_FAILURE', 'MISSING_SAP_REFERENCE', 'VENDOR_ISSUE', 'TAX_ISSUE', 'APPROVAL_ISSUE', 'INTEGRATION_FAILURE', 'TECHNICAL_FAILURE'].map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </Select>
          <Select value={params.get('severity') ?? ''} onChange={(e) => setParam('severity', e.target.value || undefined)} aria-label="Severity filter">
            <option value="">All severities</option>
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </Select>
          <Select value={params.get('technical') ?? ''} onChange={(e) => setParam('technical', e.target.value || undefined)} aria-label="Class filter">
            <option value="">Business + technical</option>
            <option value="false">Business only</option>
            <option value="true">Technical only</option>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <input type="checkbox" checked={params.get('open') === 'true'} onChange={(e) => setParam('open', e.target.checked ? 'true' : undefined)} className="h-3.5 w-3.5 accent-essa-600" />
            Open only
          </label>
        </div>
        <DataTable columns={columns} rows={data?.items ?? []} rowKey={(e) => e.id} loading={isLoading} onRowClick={setSelected} empty={<NoResults />} dense />
        {data && (
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => setParam('page', String(p))} onPageSize={(s) => setParam('pageSize', String(s))} />
        )}
      </Card>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={`Exception ${selected?.code}`} width="max-w-2xl">
        {selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
              <KeyValue label="Invoice">
                <Link to={`/invoices/${selected.invoiceId}`} className="text-essa-700 hover:underline">{selected.invoiceNumber}</Link>
              </KeyValue>
              <KeyValue label="Vendor">{selected.vendorName}</KeyValue>
              <KeyValue label="Amount">{fmtMoney(selected.amount, selected.currency)}</KeyValue>
              <KeyValue label="Type">{titleCase(selected.type)}</KeyValue>
              <KeyValue label="Severity"><StatusBadge value={selected.severity} /></KeyValue>
              <KeyValue label="Status"><StatusBadge value={selected.status} /></KeyValue>
              <KeyValue label="Created">{fmtDateTime(selected.createdAt)}</KeyValue>
              <KeyValue label="SLA Due">{fmtDateTime(selected.slaDueAt)}</KeyValue>
              <KeyValue label="Correlation"><span className="font-mono text-2xs">{selected.correlationId}</span></KeyValue>
            </dl>
            <div>
              <p className="text-xs font-semibold">{selected.title}</p>
              <p className="mt-1 text-xs text-ink-secondary">{selected.detail}</p>
              {selected.ruleCode && (
                <p className="mt-1 text-2xs text-ink-muted">
                  Failing rule <span className="font-mono">{selected.ruleCode}</span> — open the invoice's <Link to={`/invoices/${selected.invoiceId}?tab=validation`} className="text-essa-700 underline">validation tab</Link> to inspect operands, correct fields or override.
                </p>
              )}
              {selected.resolution && <p className="mt-2 rounded bg-semantic-successBg px-2 py-1.5 text-xs text-semantic-success">Resolution: {selected.resolution}</p>}
            </div>
            <ExceptionActions
              exception={selected}
              onChanged={() => {
                setSelected(null);
                refetch();
                qc.invalidateQueries({ queryKey: ['invoice', selected.invoiceId] });
              }}
            />
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Activity</p>
              <ul className="space-y-1.5">
                {selected.actions.slice().reverse().map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-essa-500" />
                    <span>
                      <span className="font-medium">{titleCase(a.action)}</span> by {a.byName}
                      <span className="text-ink-faint"> · {fmtDateTime(a.at)}</span>
                      {a.note && <span className="block text-ink-muted">{a.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
