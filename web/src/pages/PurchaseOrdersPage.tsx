/**
 * Purchase Orders — new top-level menu (design review §13).
 * Lists every PO from the SAP-injected reference data, with the open value
 * against each. CSV export exports exactly what is filtered on screen.
 *
 * Review, 25 Aug: this page now behaves exactly like the Invoice Workbench.
 * Filters, sorting and the page number live in the address bar; the server
 * pages and sorts, so a filter counts against every PO rather than the rows on
 * screen; the header stays put while the body scrolls; and the pager sits above
 * and below the table. The old page silently showed only the first 100 POs
 * while reporting the true total, so anything past row 100 was unreachable.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, RotateCcw, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, Input, NoResults, PageHeader, Pagination, Select, type Column,
} from '@/components/ui';

interface PoRow {
  poNumber: string;
  vendorCode: string;
  vendorName: string;
  poType: string;
  totalAmount: number;
  openAmount: number;
  currency: string;
  validTo: string;
  status: string;
  items?: unknown[];
}

interface PoResponse {
  items: PoRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  facets?: { statuses: string[]; poTypes: string[]; openStates: string[] };
}

/** Small labelled wrapper so every filter says what it filters (same as the workbench). */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </span>
  );
}

/**
 * A purchase order's status means something different from an exception's.
 * The shared lifecycle palette paints OPEN red because an open *exception*
 * needs work; an open *purchase order* is simply a live order still available
 * to invoice against, so it is shown as normal here.
 */
const PO_STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'error' | 'info'> = {
  OPEN: 'success',
  CLOSED: 'neutral',
  COMPLETED: 'neutral',
  BLOCKED: 'error',
  DELETED: 'error',
  EXPIRED: 'warning',
};

const FILTER_KEYS = ['search', 'status', 'poType', 'openOnly'] as const;

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(params.get('search') ?? '');

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const query = Object.fromEntries(params.entries());
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', query],
    queryFn: () => api.get<PoResponse>(`/integrations/sap/reference${qs({ type: 'PO', pageSize: 25, ...query })}`),
  });

  /**
   * Unsorted is the SAP reference data's own order, so no arrow shows until a
   * column is picked and the third click returns here.
   */
  const sortBy = params.get('sortBy') ?? undefined;
  const sortDir = (params.get('sortDir') as 'asc' | 'desc' | null) ?? undefined;
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

  const activeFilterCount = FILTER_KEYS.filter((k) => params.get(k)).length;
  const facets = data?.facets;

  /**
   * Export follows the filters, not the page: it asks the server for the whole
   * filtered list so the file is never just the 25 rows on screen.
   */
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.get<PoResponse>(
        `/integrations/sap/reference${qs({ type: 'PO', ...query, page: 1, pageSize: 200 })}`
      );
      const header = 'PO Number,Vendor Code,Vendor,Type,Total Amount,Open Amount,Currency,Valid To,Status';
      const rows = all.items.map((p) =>
        [p.poNumber, p.vendorCode, p.vendorName, p.poType, p.totalAmount, p.openAmount, p.currency, p.validTo, p.status]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
      );
      const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'eapa-purchase-orders.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<PoRow>[] = [
    { key: 'poNumber', header: 'PO Number', sortable: true, render: (p) => <span className="font-mono font-medium text-essa-700">{p.poNumber}</span> },
    {
      key: 'vendorName', header: 'Vendor', sortable: true, render: (p) => (
        <span>
          <span className="block max-w-52 truncate font-medium">{p.vendorName}</span>
          <span className="block text-2xs text-ink-faint">{p.vendorCode}</span>
        </span>
      ),
    },
    { key: 'poType', header: 'Type', sortable: true, render: (p) => <Badge tone="neutral">{p.poType}</Badge> },
    { key: 'totalAmount', header: 'Total Value', align: 'right', sortable: true, render: (p) => <span className="whitespace-nowrap font-medium">{fmtMoney(p.totalAmount, p.currency)}</span> },
    {
      key: 'openAmount', header: 'Open Value', align: 'right', sortable: true, render: (p) => (
        <span className="whitespace-nowrap">
          {p.openAmount > 0 ? <span className="font-medium text-essa-700">{fmtMoney(p.openAmount, p.currency)}</span> : <Badge tone="neutral">Fully invoiced</Badge>}
        </span>
      ),
    },
    { key: 'validTo', header: 'Valid To', sortable: true, render: (p) => <span className="whitespace-nowrap text-xs">{fmtDate(p.validTo)}</span> },
    { key: 'status', header: 'Status', sortable: true, render: (p) => <Badge tone={PO_STATUS_TONE[p.status] ?? 'neutral'}>{p.status.replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Purchase Orders' }]}
        title="Purchase Orders"
        description="All purchase orders from the SAP reference data, with open value against each. PO invoices match against these — no approval workflow applies to PO invoices."
        actions={
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={exporting} title="Downloads exactly what is filtered on screen, not only this page">
            <Download size={14} /> {exporting ? 'Preparing…' : 'Export'}
          </Button>
        }
      />
      <Card pad={false}>
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
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => setParam('search', searchDraft.trim() || undefined)}
                placeholder="Search PO number or vendor…"
                className="w-60 pl-8"
                aria-label="Search purchase orders"
              />
            </form>
          </FilterField>
          {/* Each filter is drawn only when the reference data actually holds
              more than one value for it, so the bar never offers a choice of
              one — and it appears on its own once SAP sends a second value. */}
          {(facets?.statuses.length ?? 0) > 1 && (
            <FilterField label="Status">
              <Select value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value || undefined)} aria-label="PO status filter">
                <option value="">Any</option>
                {facets!.statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </FilterField>
          )}
          {(facets?.poTypes.length ?? 0) > 1 && (
            <FilterField label="PO Type">
              <Select value={params.get('poType') ?? ''} onChange={(e) => setParam('poType', e.target.value || undefined)} aria-label="PO type filter">
                <option value="">Any</option>
                {facets!.poTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </FilterField>
          )}
          {(facets?.openStates.length ?? 0) > 1 && (
            <FilterField label="Open Value">
              <Select value={params.get('openOnly') ?? ''} onChange={(e) => setParam('openOnly', e.target.value || undefined)} aria-label="Open value filter">
                <option value="">Any</option>
                <option value="true">Still open</option>
                <option value="false">Fully invoiced</option>
              </Select>
            </FilterField>
          )}
          {activeFilterCount > 0 && (
            <Button
              variant="ghost" size="sm"
              onClick={() => {
                setSearchDraft('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              <RotateCcw size={13} /> Reset
            </Button>
          )}
          <span className="ml-auto self-center text-xs text-ink-muted">{data?.total ?? 0} purchase orders · SAP reference data</span>
        </div>

        {data && data.totalPages > 1 && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            unit="purchase orders"
            onPage={(p) => setParam('page', String(p))}
          />
        )}
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(p) => p.poNumber}
          loading={isLoading}
          onRowClick={(p) => navigate(`/invoices?search=${encodeURIComponent(p.poNumber)}`)}
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
            unit="purchase orders"
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(s) => setParam('pageSize', String(s))}
          />
        )}
      </Card>
    </div>
  );
}
