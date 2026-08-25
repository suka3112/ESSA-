import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { Badge, Button, Card, DataTable, Input, NoResults, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';

interface VendorRow {
  code: string; name: string; city: string; state: string; gstin: string; classification: string; paymentTerms: string;
  sapStatus: string; lastSyncAt: string; invoiceCount: number; openInvoiceCount: number; totalBilled: number;
  control?: { negativeFlag: boolean; apEnabled: boolean; reason?: string };
}

export default function VendorsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pkp, setPkp] = useState('');
  const [flag, setFlag] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['vendors', search, flag],
    queryFn: () => api.get<{ items: VendorRow[]; total: number }>(`/vendors${qs({ search, negative: flag === 'negative' ? 'true' : undefined, disabled: flag === 'disabled' ? 'true' : undefined })}`),
  });
  // PKP / Non-PKP (tax-registered local vs foreign) is derived until SAP
  // supplies the flag: a vendor with a tax number registered locally = PKP.
  const rows = (data?.items ?? []).filter((v) => {
    if (pkp === 'pkp') return Boolean(v.gstin);
    if (pkp === 'nonpkp') return !v.gstin;
    return true;
  });

  const columns: Column<VendorRow>[] = [
    { key: 'code', header: 'Vendor Code', sortable: true, value: (v) => v.code, render: (v) => <span className="font-medium text-essa-700">{v.code}</span> },
    { key: 'name', header: 'Vendor Name', sortable: true, value: (v) => v.name, render: (v) => <span className="block max-w-52 truncate font-medium">{v.name}</span> },
    { key: 'city', header: 'Location', sortable: true, value: (v) => `${v.city}, ${v.state}`, render: (v) => <span className="text-xs">{v.city}, {v.state}</span> },
    /* "GSTIN" renamed to the country-neutral "Tax Number" (Indonesia = VAT);
       Class (invoice-dependent) and Terms (long paragraph) columns removed. */
    { key: 'gstin', header: 'Tax Number', sortable: true, value: (v) => v.gstin ?? '', render: (v) => <span className="font-mono text-2xs">{v.gstin || '—'}</span> },
    { key: 'sap', header: 'SAP Status', sortable: true, value: (v) => v.sapStatus, render: (v) => <StatusBadge value={v.sapStatus} /> },
    {
      key: 'control', header: 'AP Control', sortable: true,
      value: (v) => (v.control?.negativeFlag ? 'Negative' : v.control && !v.control.apEnabled ? 'Disabled' : 'Enabled'),
      render: (v) =>
        v.control?.negativeFlag ? <Badge tone="error">Negative</Badge> : v.control && !v.control.apEnabled ? <Badge tone="warning">Disabled</Badge> : <Badge tone="success">Enabled</Badge>,
    },
    { key: 'invoices', header: 'Invoices', align: 'center', sortable: true, value: (v) => v.invoiceCount, render: (v) => <span className="text-xs">{v.invoiceCount} <span className="text-ink-faint">({v.openInvoiceCount} open)</span></span> },
    { key: 'billed', header: 'Total Billed', align: 'right', sortable: true, value: (v) => v.totalBilled, render: (v) => <span className="font-medium">{fmtMoney(v.totalBilled)}</span> },
    {
      key: 'actions', header: 'Actions', sticky: true,
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
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, name or tax number…" className="w-64 pl-8" aria-label="Search vendors" />
          </div>
          {/* Category/classification filter removed — a vendor spans many
              categories. PKP / Non-PKP and control-state filters instead. */}
          <Select value={pkp} onChange={(e) => setPkp(e.target.value)} aria-label="PKP filter">
            <option value="">All (PKP & Non-PKP)</option>
            <option value="pkp">PKP · Domestic (tax-registered)</option>
            <option value="nonpkp">Non-PKP · International</option>
          </Select>
          <Select value={flag} onChange={(e) => setFlag(e.target.value)} aria-label="Control filter">
            <option value="">All</option>
            <option value="negative">Negative list</option>
            <option value="disabled">AP disabled</option>
          </Select>
          <span className="ml-auto text-xs text-ink-muted">{data?.total ?? 0} vendors · SAP snapshot</span>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(v) => v.code} loading={isLoading} onRowClick={(v) => navigate(`/vendors/${v.code}`)} empty={<NoResults query={search} />} dense />
      </Card>
    </div>
  );
}
