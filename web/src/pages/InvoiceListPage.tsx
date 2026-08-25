/**
 * Invoice Workbench — the AP work queue.
 *
 * UI/UX review (Aug 2026):
 *  · Columns are the ones the business actually works with — Invoice Number,
 *    Vendor Name, Category, Invoice Date, Amount, PO, Current Status,
 *    Next Status, Exceptions, SLA, Action. Technical ids are gone.
 *  · "Next Action" is replaced by "Next Status": the next lifecycle state the
 *    invoice moves to, never a sentence describing what to do.
 *  · An invoice that has just been uploaded is shown immediately, with its
 *    header values blank until extraction produces them.
 *  · The Status column carries its own filter; the redundant "All" selects and
 *    the amount filter (approver-only) are gone from the processor's view.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Download, RotateCcw, Search, Upload } from 'lucide-react';
import { api, qs } from '@/lib/api';
import {
  currentStatus, CURRENCY, fmtDate, fmtDateTime, fmtMoney, fmtNumber, INVOICE_STATUSES, isPreExtraction, nextStatus, statusDetail,
} from '@/lib/format';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, DataTable, Input, InvoiceStatusBadge, NoResults, NotAvailable,
  PageHeader, Pagination, Select, Tabs, Tooltip, type Column,
} from '@/components/ui';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  vendorCode: string;
  vendorName: string;
  categoryName: string;
  invoiceDate: string;
  amount: number;
  currency: string;
  poNumber?: string;
  receivedAt: string;
  stage: string;
  lifecycle: string;
  processingFlag: string | null;
  slaDueAt: string;
  slaBreached: boolean;
  source: string;
  openExceptions: number;
  correlationId: string;
  extractionConfidence?: number | null;
  checksTotal?: number;
  checksPassed?: number;
  checksFailed?: number;
  slaStageLabel?: string | null;
}

interface Lookups {
  categories: { id: string; name: string; poBased: boolean }[];
  vendors: { code: string; name: string }[];
}

type PoType = 'ALL' | 'PO' | 'NON_PO';

const PO_TYPE_TABS: { key: PoType; label: string }[] = [
  { key: 'ALL', label: 'All Invoices' },
  { key: 'PO', label: 'PO Invoice' },
  { key: 'NON_PO', label: 'Non-PO Invoice' },
];

/** The invoice lifecycle states — BPD v0.1.4 §11.7 (see lib/format.ts). */
const STATUS_OPTIONS = INVOICE_STATUSES.map((s) => ({ value: s, label: s }));

/**
 * Amount filter as predefined ranges. Only shown to roles that work with
 * value (approvers) — the processor's queue is not value-driven.
 */
const AMOUNT_RANGES: { key: string; label: string; min?: number; max?: number }[] = [
  { key: 'lt100k', label: 'Less than 100K', max: 100_000 },
  { key: '100k-500k', label: '100K – 500K', min: 100_000, max: 500_000 },
  { key: '500k-1m', label: '500K – 1M', min: 500_000, max: 1_000_000 },
  { key: '1m-5m', label: '1M – 5M', min: 1_000_000, max: 5_000_000 },
  { key: 'gt5m', label: 'Above 5M', min: 5_000_000 },
];

/** Small labelled wrapper so every filter says what it filters. */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </span>
  );
}

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(params.get('search') ?? '');
  /** Value-based filtering belongs to approval roles, not the processor. */
  const showAmountFilter = hasPerm('APPROVAL_VIEW');

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const poType: PoType = (['PO', 'NON_PO'].includes(params.get('poType') ?? '') ? params.get('poType') : 'ALL') as PoType;
  const setPoType = (next: string) => {
    const value = next === 'ALL' ? undefined : next;
    const p = new URLSearchParams(params);
    if (value) p.set('poType', value);
    else p.delete('poType');
    // Category is scoped per tab, so a category picked on the other tab would yield an empty list.
    p.delete('categoryId');
    p.delete('page');
    setParams(p, { replace: true });
  };

  const query = useMemo(() => {
    const obj: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k !== 'view') obj[k] = v; // 'view' is UI-only (workbench vs ingestion tab)
    });
    return obj;
  }, [params]);

  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', query],
    queryFn: () =>
      api.get<{ items: InvoiceRow[]; page: number; pageSize: number; total: number; totalPages: number; poTypeCounts: Record<PoType, number> }>(
        `/invoices${qs({ pageSize: 25, ...query })}`
      ),
    // An invoice appears in the queue the moment it is uploaded; refresh so the
    // row moves on from "Processing" as extraction and validation complete.
    refetchInterval: 15_000,
  });

  /**
   * Newest first is the queue's own order, not a sort the reader chose, so the
   * header shows no arrow until a column is actually sorted and returns here on
   * the third click (review, 25 Aug).
   */
  const sortBy = params.get('sortBy') ?? undefined;
  const sortDir = (params.get('sortDir') as 'asc' | 'desc' | null) ?? undefined;
  /**
   * Both parameters have to move in a single update: two calls to setParam in a
   * row each rebuild from the same render's params, so the second silently
   * dropped the column being sorted and only the direction ever changed.
   */
  const onSort = (key: string, dir: 'asc' | 'desc' | null) => {
    const next = new URLSearchParams(params);
    if (dir) {
      next.set('sortBy', key);
      next.set('sortDir', dir);
    } else {
      next.delete('sortBy');
      next.delete('sortDir');
    }
    next.delete('page');
    setParams(next, { replace: true });
  };

  const columns: Column<InvoiceRow>[] = ([
    {
      key: 'invoiceNumber', header: 'Invoice Number', sortable: true,
      render: (r) =>
        isPreExtraction(r) ? (
          // Before extraction there is no invoice number yet — the record is
          // identified by its intake reference so the row is still traceable.
          <Tooltip text="The invoice number is read from the document; it appears once extraction finishes.">
            <span className="font-medium text-ink-muted">{r.correlationId}</span>
          </Tooltip>
        ) : (
          /* The invoice date sits with the invoice it belongs to rather than in
             a column of its own, so the queue fits on one screen without
             sideways scrolling (review §17). */
          <span className="block">
            <span className="block font-medium text-essa-700">{r.invoiceNumber}</span>
            <span className="block text-2xs text-ink-faint">{fmtDate(r.invoiceDate)}</span>
          </span>
        ),
    },
    {
      key: 'vendorName', header: 'Vendor Name', sortable: true,
      render: (r) =>
        isPreExtraction(r) ? <NotAvailable /> : (
          /* The vendor code is an internal reference and is not shown (review
             §16); the vendor name is what the AP team works with. */
          <p className="max-w-44 truncate">{r.vendorName}</p>
        ),
    },
    {
      key: 'categoryName', header: 'Category', sortable: true, value: (r) => r.categoryName,
      /* "Material Invoice" → "Material": the word Invoice on every row of an
         invoice table costs width and adds nothing (review §17). */
      render: (r) => (isPreExtraction(r) ? <NotAvailable /> : <span className="whitespace-nowrap text-xs">{r.categoryName.replace(/\s*Invoice$/i, '')}</span>),
    },
    {
      /* The currency is the same on every row, so it is stated once in the
         header instead of repeated 25 times (review §17 — concise tables). */
      key: 'amount', header: `Amount (${CURRENCY})`, sortable: true, align: 'right',
      render: (r) =>
        isPreExtraction(r) ? <NotAvailable /> : (
          <span className="whitespace-nowrap font-medium">
            {r.currency && r.currency !== CURRENCY ? fmtMoney(r.amount, r.currency) : fmtNumber(r.amount)}
          </span>
        ),
    },
    { key: 'poNumber', header: 'PO Number', sortable: true, value: (r) => r.poNumber ?? '', render: (r) => <span className="whitespace-nowrap text-2xs">{r.poNumber ?? '—'}</span> },
    {
      /* Sorting only in the header — the status filter lives in the filter bar
         above the table (review, 24 Aug). */
      key: 'status', header: 'Current Status', sortable: true,
      value: (r) => currentStatus(r),
      render: (r) => (
        <span className="block">
          <InvoiceStatusBadge status={currentStatus(r)} />
          {statusDetail(r) && <span className="mt-0.5 block text-2xs text-ink-muted">{statusDetail(r)}</span>}
        </span>
      ),
    },
    {
      key: 'nextStatus', header: 'Next Status', sortable: true,
      value: (r) => nextStatus(r),
      render: (r) => <InvoiceStatusBadge status={nextStatus(r)} muted />,
    },
    {
      /* Open exceptions on the invoice. It is always a count — "0 of 9" reads
         as "checked, nothing wrong", where a dash left the user guessing
         (review, 24 Aug) — and it always agrees with the note under the status,
         so an invoice that says "Exceptions to resolve" never reads "0" here.
         Which fields failed stays inside Invoice Detail (review §7). */
      key: 'exceptions', header: 'Exceptions', align: 'center', sortable: true,
      value: (r) => r.openExceptions ?? 0,
      render: (r) => {
        const total = r.checksTotal ?? 0;
        const open = r.openExceptions ?? 0;
        if (!total && !open) {
          return (
            <Tooltip text="Validation has not run on this invoice yet.">
              <span className="text-2xs text-ink-faint">Not checked</span>
            </Tooltip>
          );
        }
        const label = total ? `${open} of ${total}` : `${open} open`;
        const tip = total
          ? `${open} open exception(s) out of ${total} validation checks — open the invoice to see which fields`
          : `${open} open exception(s). Validation has not run yet — open the invoice to see what is outstanding`;
        return (
          <button
            onClick={(ev) => { ev.stopPropagation(); navigate(`/invoices/${r.id}`); }}
            title={tip}
            className={open > 0 ? 'whitespace-nowrap text-xs font-semibold text-semantic-error hover:underline' : 'whitespace-nowrap text-xs font-semibold text-essa-700 hover:underline'}
          >
            {label}
          </button>
        );
      },
    },
    {
      key: 'slaDueAt', header: 'SLA Due', sortable: true,
      value: (r) => r.slaDueAt ?? '',
      render: (r) => {
        if (!r.slaDueAt) {
          return (
            <Tooltip text="No SLA is running — the invoice is finished or waiting on someone outside the platform.">
              <span className="text-2xs text-ink-faint">No SLA</span>
            </Tooltip>
          );
        }
        const stage = r.slaStageLabel ? `${r.slaStageLabel} SLA` : 'SLA';
        return r.slaBreached ? (
          <Tooltip text={`${stage} was due ${fmtDateTime(r.slaDueAt)}`}><Badge tone="error">SLA Breached</Badge></Tooltip>
        ) : (
          <Tooltip text={`${stage}, due ${fmtDateTime(r.slaDueAt)}`}>
            <span className="whitespace-nowrap text-2xs text-ink-muted">{fmtDate(r.slaDueAt)}</span>
          </Tooltip>
        );
      },
    },
    {
      /* One action everywhere: open the invoice. Exceptions, corrections and
         approvals are all handled inside Invoice Detail (review §7/§8). */
      key: 'actions', header: 'Action', align: 'center', sticky: true,
      render: (r) => (
        <button
          aria-label={`Open ${isPreExtraction(r) ? r.correlationId : r.invoiceNumber}`}
          title="Open invoice"
          onClick={(ev) => { ev.stopPropagation(); navigate(`/invoices/${r.id}`); }}
          className="mx-auto flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-muted transition-colors hover:border-essa-400 hover:text-essa-700"
        >
          <ArrowRight size={14} />
        </button>
      ),
    },
  ] as Column<InvoiceRow>[]).filter((c) => !(poType === 'NON_PO' && c.key === 'poNumber'));

  const exportCsv = () => {
    if (!data) return;
    const header = 'Invoice Number,Vendor,Category,Invoice Date,Amount,Currency,PO Number,Current Status,Next Status,SLA Due';
    const rows = data.items.map((r) =>
      [
        isPreExtraction(r) ? r.correlationId : r.invoiceNumber,
        isPreExtraction(r) ? '' : r.vendorName,
        isPreExtraction(r) ? '' : r.categoryName,
        isPreExtraction(r) ? '' : r.invoiceDate,
        isPreExtraction(r) ? '' : r.amount,
        r.currency, r.poNumber ?? '', currentStatus(r), nextStatus(r), r.slaDueAt,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = poType === 'ALL' ? 'essa-invoices.csv' : `essa-invoices-${poType.toLowerCase().replace('_', '-')}.csv`;
    a.click();
  };

  const activeFilterCount = ['status', 'categoryId', 'slaBreached', 'hasExceptions', 'amountMin', 'amountMax', 'dateFrom', 'dateTo', 'search'].filter((k) => params.get(k)).length;

  // Selected amount band, derived from the amountMin/amountMax URL params.
  const amountRangeKey =
    AMOUNT_RANGES.find(
      (r) => String(r.min ?? '') === (params.get('amountMin') ?? '') && String(r.max ?? '') === (params.get('amountMax') ?? '')
    )?.key ?? '';
  const setAmountRange = (key: string) => {
    const r = AMOUNT_RANGES.find((x) => x.key === key);
    const next = new URLSearchParams(params);
    if (r?.min != null) next.set('amountMin', String(r.min));
    else next.delete('amountMin');
    if (r?.max != null) next.set('amountMax', String(r.max));
    else next.delete('amountMax');
    next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoice Processing' }, { label: 'Invoice Workbench' }]}
        title="Invoice Workbench"
        description="All invoices received through the AP mailbox, SharePoint and manual upload."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={exportCsv} title="Download the invoices currently filtered on screen">
              <Download size={14} /> Export
            </Button>
            {hasPerm('INVOICE_UPLOAD') && (
              <Button size="sm" onClick={() => navigate('/invoices/upload')}>
                <Upload size={14} /> Upload Invoice
              </Button>
            )}
          </>
        }
      />

      <Card pad={false}>
        {/* PO / Non-PO tabs — the same columns, filtered */}
        <Tabs
          tabs={PO_TYPE_TABS}
          active={poType}
          onChange={setPoType}
          counts={data?.poTypeCounts}
        />

        {/* Every filter is labelled with what it filters — no bare "All" controls. */}
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3">
          <FilterField label="Search">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                setParam('search', searchDraft.trim() || undefined);
              }}
            >
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              {/* Enter or leaving the field both search, so a typed term is never
                  silently ignored (same on Vendors and Purchase Orders). */}
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => setParam('search', searchDraft.trim() || undefined)}
                placeholder="Invoice, vendor or PO number…"
                className="w-60 pl-8"
                aria-label="Search invoices"
              />
            </form>
          </FilterField>
          <FilterField label="Current Status">
            <Select value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value || undefined)} aria-label="Current status filter">
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Category">
            <Select value={params.get('categoryId') ?? ''} onChange={(e) => setParam('categoryId', e.target.value || undefined)} aria-label="Category filter">
              <option value="">Any category</option>
              {lookups?.categories
                .filter((c) => (poType === 'ALL' ? true : poType === 'PO' ? c.poBased : !c.poBased))
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </Select>
          </FilterField>
          <FilterField label="Needs Attention">
            <Select
              value={params.get('slaBreached') === 'true' ? 'sla' : params.get('hasExceptions') === 'true' ? 'exc' : ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.delete('slaBreached');
                next.delete('hasExceptions');
                if (e.target.value === 'sla') next.set('slaBreached', 'true');
                if (e.target.value === 'exc') next.set('hasExceptions', 'true');
                next.delete('page');
                setParams(next, { replace: true });
              }}
              aria-label="Attention filter"
            >
              <option value="">No filter</option>
              <option value="sla">SLA Breached</option>
              <option value="exc">Has exceptions</option>
            </Select>
          </FilterField>
          {showAmountFilter && (
            <FilterField label="Amount">
              <Select value={amountRangeKey} onChange={(e) => setAmountRange(e.target.value)} aria-label="Amount range filter">
                <option value="">Any amount</option>
                {AMOUNT_RANGES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </Select>
            </FilterField>
          )}
          <FilterField label="Invoice Date">
            <span className="flex items-center gap-1.5 text-2xs text-ink-muted">
              <Input type="date" className="!h-9 w-36" value={params.get('dateFrom') ?? ''} onChange={(e) => setParam('dateFrom', e.target.value || undefined)} aria-label="Invoice date from" />
              –
              <Input type="date" className="!h-9 w-36" value={params.get('dateTo') ?? ''} onChange={(e) => setParam('dateTo', e.target.value || undefined)} aria-label="Invoice date to" />
            </span>
          </FilterField>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost" size="sm"
              onClick={() => {
                setSearchDraft('');
                setParams(poType === 'ALL' ? new URLSearchParams() : new URLSearchParams({ poType }), { replace: true });
              }}
            >
              <RotateCcw size={13} /> Reset
            </Button>
          )}
        </div>

        {data && data.totalPages > 1 && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPage={(p) => setParam('page', String(p))}
          />
        )}
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          onRowClick={(r) => navigate(`/invoices/${r.id}`)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          empty={<NoResults query={params.get('search') ?? undefined} />}
          dense
          stickyHeader
          maxBodyHeight="58vh"
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(s) => setParam('pageSize', String(s))}
          />
        )}
      </Card>
    </div>
  );
}
