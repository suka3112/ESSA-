/**
 * Vendor Master — the SAP vendor snapshot.
 *
 * Review, 25 Aug: this page now behaves exactly like the Invoice Workbench.
 * Filters, sorting and the page number live in the address bar, so a filtered
 * view can be shared or bookmarked; the server does the paging and sorting, so
 * a filter counts against the whole master rather than the rows on screen; the
 * header row stays put while the body scrolls; and the pager sits above and
 * below the table with the same "Showing x to y of n" wording.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, RotateCcw, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, Input, NoResults, PageHeader, Pagination, Select, StatusBadge, type Column,
} from '@/components/ui';

interface VendorRow {
  code: string; name: string; city: string; state: string; gstin: string; classification: string; paymentTerms: string;
  sapStatus: string; lastSyncAt: string; invoiceCount: number; openInvoiceCount: number; totalBilled: number;
  location: string; taxStatus: string; controlState: string;
  control?: { negativeFlag: boolean; apEnabled: boolean; reason?: string };
}

interface VendorResponse {
  items: VendorRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  facets?: { sapStatuses: string[]; controlStates: string[]; taxStatuses: string[] };
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

const FILTER_KEYS = ['search', 'taxStatus', 'controlState', 'sapStatus'] as const;

export default function VendorsPage() {
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
    queryKey: ['vendors', query],
    queryFn: () => api.get<VendorResponse>(`/vendors${qs({ pageSize: 25, ...query })}`),
  });

  /**
   * Unsorted is the SAP master's own order, so no arrow shows until a column is
   * picked and the third click returns here.
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

  const columns: Column<VendorRow>[] = [
    { key: 'code', header: 'Vendor Code', sortable: true, render: (v) => <span className="font-medium text-essa-700">{v.code}</span> },
    { key: 'name', header: 'Vendor Name', sortable: true, render: (v) => <span className="block max-w-52 truncate font-medium">{v.name}</span> },
    { key: 'location', header: 'Location', sortable: true, render: (v) => <span className="text-xs">{v.location || '—'}</span> },
    /* "GSTIN" renamed to the country-neutral "Tax Number" (Indonesia = VAT);
       Class (invoice-dependent) and Terms (long paragraph) columns removed. */
    { key: 'gstin', header: 'Tax Number', sortable: true, render: (v) => <span className="font-mono text-2xs">{v.gstin || '—'}</span> },
    { key: 'sapStatus', header: 'SAP Status', sortable: true, render: (v) => <StatusBadge value={v.sapStatus} /> },
    {
      key: 'controlState', header: 'AP Control', sortable: true,
      render: (v) =>
        v.controlState === 'Negative' ? <Badge tone="error">Negative</Badge>
          : v.controlState === 'Disabled' ? <Badge tone="warning">Disabled</Badge>
            : <Badge tone="success">Enabled</Badge>,
    },
    {
      key: 'invoiceCount', header: 'Invoices', align: 'center', sortable: true,
      render: (v) => <span className="text-xs">{v.invoiceCount} <span className="text-ink-faint">({v.openInvoiceCount} open)</span></span>,
    },
    { key: 'totalBilled', header: 'Total Billed', align: 'right', sortable: true, render: (v) => <span className="whitespace-nowrap font-medium">{fmtMoney(v.totalBilled)}</span> },
    {
      key: 'actions', header: 'Action', sticky: true,
      render: (v) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(ev) => {
            ev.stopPropagation();
            navigate(`/vendors/${v.code}`);
          }}
          title={`Open vendor ${v.code}`}
        >
          Open <ArrowRight size={12} />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Vendors' }]}
        title="Vendor Master"
        description="Read-only vendor snapshot synchronized from SAP (the vendor master source of truth) with the portal AP-control overlay. Master data changes are made in SAP, never here."
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
                placeholder="Search code, name or tax number…"
                className="w-60 pl-8"
                aria-label="Search vendors"
              />
            </form>
          </FilterField>
          {/* Category/classification filter removed — a vendor spans many
              categories. PKP / Non-PKP and control-state filters instead.
              Each filter is drawn only when the master actually holds more than
              one value for it, so the bar never offers a choice of one. */}
          {(facets?.taxStatuses.length ?? 0) > 1 && (
            <FilterField label="Tax Status">
              <Select value={params.get('taxStatus') ?? ''} onChange={(e) => setParam('taxStatus', e.target.value || undefined)} aria-label="Tax status filter">
                <option value="">All (PKP &amp; Non-PKP)</option>
                {facets!.taxStatuses.map((t) => (
                  <option key={t} value={t}>{t === 'PKP' ? 'PKP · Domestic (tax-registered)' : 'Non-PKP · International'}</option>
                ))}
              </Select>
            </FilterField>
          )}
          {(facets?.controlStates.length ?? 0) > 1 && (
            <FilterField label="AP Control">
              <Select value={params.get('controlState') ?? ''} onChange={(e) => setParam('controlState', e.target.value || undefined)} aria-label="AP control filter">
                <option value="">Any</option>
                {facets!.controlStates.map((c) => (
                  <option key={c} value={c}>{c === 'Negative' ? 'Negative list' : c === 'Disabled' ? 'AP disabled' : 'Enabled'}</option>
                ))}
              </Select>
            </FilterField>
          )}
          {(facets?.sapStatuses.length ?? 0) > 1 && (
            <FilterField label="SAP Status">
              <Select value={params.get('sapStatus') ?? ''} onChange={(e) => setParam('sapStatus', e.target.value || undefined)} aria-label="SAP status filter">
                <option value="">Any</option>
                {facets!.sapStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
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
          <span className="ml-auto self-center text-xs text-ink-muted">{data?.total ?? 0} vendors · SAP snapshot</span>
        </div>

        {data && data.totalPages > 1 && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            unit="vendors"
            onPage={(p) => setParam('page', String(p))}
          />
        )}
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(v) => v.code}
          loading={isLoading}
          onRowClick={(v) => navigate(`/vendors/${v.code}`)}
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
            unit="vendors"
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(s) => setParam('pageSize', String(s))}
          />
        )}
      </Card>
    </div>
  );
}
