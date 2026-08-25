/**
 * Exception Workbench — the one central list of invoices stopped by an exception.
 *
 * UI/UX review (Aug 2026) §8:
 *  · Summary, Assigned To, Age, Severity, Status and Class columns are gone —
 *    the workbench lists open exceptions only, and work belongs to a role.
 *  · Timestamps are real date/times, never "7 minutes ago".
 *  · The case identifier (Exception ID) and the exception code are two clearly
 *    separated columns. There is exactly ONE code per error type, so filtering
 *    by a code returns only that error whatever the invoice or vendor.
 *  · Every column sorts; vendor, type and code carry column filters.
 *  · Clicking a row opens the invoice, where the failed fields can actually be
 *    corrected — there is no second exception screen.
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDateTime, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, Input, NoResults, PageHeader, Pagination, Select, Tooltip, type Column,
} from '@/components/ui';

interface ExceptionListRow {
  id: string; code: string; invoiceId: string; invoiceNumber?: string; vendorName?: string;
  type: string; title: string; detail: string; ruleCode?: string;
  exceptionCode: string; exceptionCodeLabel: string; exceptionCodeDescription: string;
  createdAt: string; slaDueAt: string; slaBreached: boolean; correlationId: string;
}

interface ExceptionCodeRow { code: string; type: string; label: string; description: string }

const EXCEPTION_TYPES = [
  'MISSING_DOCUMENT', 'EXTRACTION_FAILURE', 'LOW_CONFIDENCE', 'VALIDATION_FAILURE',
  'MISSING_SAP_REFERENCE', 'VENDOR_ISSUE', 'TAX_ISSUE', 'APPROVAL_ISSUE',
  'INTEGRATION_FAILURE', 'TECHNICAL_FAILURE',
];

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </span>
  );
}

export default function ExceptionsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

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
    // The workbench is a work queue: an exception leaves it once it is resolved.
    obj.open = 'true';
    return obj;
  }, [params]);

  const codesQ = useQuery({
    queryKey: ['exception-codes'],
    queryFn: () => api.get<{ exceptionCodes: ExceptionCodeRow[] }>('/lookups'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['exceptions', query],
    queryFn: () => api.get<{ items: ExceptionListRow[]; page: number; pageSize: number; total: number; totalPages: number }>(`/exceptions${qs({ pageSize: 25, ...query })}`),
    refetchInterval: 30_000,
  });

  const columns: Column<ExceptionListRow>[] = [
    {
      key: 'code', header: 'Exception ID', sortable: true, value: (e) => e.code,
      render: (e) => (
        <Tooltip text="Case reference for this exception. Use it when discussing the case with the team.">
          <span className="font-medium text-essa-700">{e.code}</span>
        </Tooltip>
      ),
    },
    { key: 'invoiceNumber', header: 'Invoice Number', sortable: true, value: (e) => e.invoiceNumber ?? '', render: (e) => <span className="font-medium">{e.invoiceNumber ?? '—'}</span> },
    { key: 'vendorName', header: 'Vendor Name', sortable: true, value: (e) => e.vendorName ?? '', render: (e) => <span className="block max-w-44 truncate text-xs">{e.vendorName ?? '—'}</span> },
    {
      /* The plain-language reason — this is the user-facing explanation. */
      key: 'type', header: 'Exception Type', sortable: true, value: (e) => titleCase(e.type),
      render: (e) => (
        <Tooltip text={e.detail || e.title}>
          <span className="text-xs font-medium">{titleCase(e.type)}</span>
        </Tooltip>
      ),
    },
    {
      /* One code per error type: the same failure always carries the same code,
         whatever the invoice, category or vendor (review, 24 Aug). */
      key: 'exceptionCode', header: 'Exception Code', sortable: true,
      value: (e) => e.exceptionCode,
      render: (e) => (
        <Tooltip text={`${e.exceptionCodeLabel} — ${e.exceptionCodeDescription}`}>
          <span className="font-mono text-2xs font-semibold text-ink-secondary">{e.exceptionCode}</span>
        </Tooltip>
      ),
    },
    { key: 'createdAt', header: 'Raised On', sortable: true, value: (e) => e.createdAt, render: (e) => <span className="whitespace-nowrap text-2xs">{fmtDateTime(e.createdAt)}</span> },
    {
      key: 'slaDueAt', header: 'SLA Due', sortable: true, value: (e) => e.slaDueAt,
      render: (e) =>
        e.slaBreached
          ? <Tooltip text={`SLA was due ${fmtDateTime(e.slaDueAt)}`}><Badge tone="error">SLA Breached</Badge></Tooltip>
          : <span className="whitespace-nowrap text-2xs text-ink-muted">{fmtDateTime(e.slaDueAt)}</span>,
    },
    {
      key: 'actions', header: 'Action', align: 'center', sticky: true,
      render: (e) => (
        <button
          aria-label={`Open invoice ${e.invoiceNumber}`}
          title="Open the invoice to see and correct the failed fields"
          onClick={(ev) => { ev.stopPropagation(); navigate(`/invoices/${e.invoiceId}`); }}
          className="mx-auto flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-muted transition-colors hover:border-essa-400 hover:text-essa-700"
        >
          <ArrowRight size={14} />
        </button>
      ),
    },
  ];

  const activeFilters = ['search', 'type', 'exceptionCode'].filter((k) => params.get(k)).length;

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoice Processing' }, { label: 'Exception Workbench' }]}
        title="Exception Workbench"
        description="Invoices that could not be processed. Open an invoice to correct the failed fields and revalidate."
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3">
          <FilterField label="Search">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setParam('search', String(fd.get('q') || '') || undefined);
              }}
            >
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input name="q" defaultValue={params.get('search') ?? ''} placeholder="Exception ID, invoice or vendor…" className="w-64 pl-8" aria-label="Search exceptions" />
            </form>
          </FilterField>
          <FilterField label="Exception Type">
            <Select value={params.get('type') ?? ''} onChange={(e) => setParam('type', e.target.value || undefined)} aria-label="Exception type filter">
              <option value="">Any type</option>
              {EXCEPTION_TYPES.map((t) => (
                <option key={t} value={t}>{titleCase(t)}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Exception Code">
            <Select value={params.get('exceptionCode') ?? ''} onChange={(e) => setParam('exceptionCode', e.target.value || undefined)} aria-label="Exception code filter">
              <option value="">Any code</option>
              {(codesQ.data?.exceptionCodes ?? []).map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.label}</option>
              ))}
            </Select>
          </FilterField>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Reset</Button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(e) => e.id}
          loading={isLoading}
          onRowClick={(e) => navigate(`/invoices/${e.invoiceId}`)}
          empty={<NoResults />}
          dense
        />
        {data && (
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => setParam('page', String(p))} onPageSize={(s) => setParam('pageSize', String(s))} />
        )}
      </Card>
    </div>
  );
}
