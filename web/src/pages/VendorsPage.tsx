import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtMoney, fmtRelative } from '@/lib/format';
import { Badge, Card, DataTable, Input, NoResults, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';

interface VendorRow {
  code: string; name: string; city: string; state: string; gstin: string; classification: string; paymentTerms: string;
  sapStatus: string; lastSyncAt: string; invoiceCount: number; openInvoiceCount: number; totalBilled: number;
  control?: { negativeFlag: boolean; apEnabled: boolean; reason?: string };
}

export default function VendorsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('');
  const [flag, setFlag] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['vendors', search, classification, flag],
    queryFn: () => api.get<{ items: VendorRow[]; total: number }>(`/vendors${qs({ search, classification, negative: flag === 'negative' ? 'true' : undefined, disabled: flag === 'disabled' ? 'true' : undefined })}`),
  });

  const columns: Column<VendorRow>[] = [
    { key: 'code', header: 'Vendor Code', render: (v) => <span className="font-medium text-essa-700">{v.code}</span> },
    { key: 'name', header: 'Vendor Name', render: (v) => <span className="block max-w-52 truncate font-medium">{v.name}</span> },
    { key: 'city', header: 'Location', render: (v) => <span className="text-xs">{v.city}, {v.state}</span> },
    { key: 'gstin', header: 'GSTIN', render: (v) => <span className="font-mono text-2xs">{v.gstin}</span> },
    { key: 'classification', header: 'Class', render: (v) => <Badge tone="neutral">{v.classification}</Badge> },
    { key: 'terms', header: 'Terms', render: (v) => <span className="text-xs">{v.paymentTerms}</span> },
    { key: 'sap', header: 'SAP Status', render: (v) => <StatusBadge value={v.sapStatus} /> },
    {
      key: 'control', header: 'AP Control', render: (v) =>
        v.control?.negativeFlag ? <Badge tone="error">Negative</Badge> : v.control && !v.control.apEnabled ? <Badge tone="warning">Disabled</Badge> : <Badge tone="success">Enabled</Badge>,
    },
    { key: 'invoices', header: 'Invoices', align: 'center', render: (v) => <span className="text-xs">{v.invoiceCount} <span className="text-ink-faint">({v.openInvoiceCount} open)</span></span> },
    { key: 'billed', header: 'Total Billed', align: 'right', render: (v) => <span className="font-medium">{fmtMoney(v.totalBilled)}</span> },
    { key: 'sync', header: 'Synced', render: (v) => <span className="whitespace-nowrap text-2xs text-ink-muted">{fmtRelative(v.lastSyncAt)}</span> },
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
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, name, GSTIN…" className="w-64 pl-8" aria-label="Search vendors" />
          </div>
          <Select value={classification} onChange={(e) => setClassification(e.target.value)} aria-label="Classification filter">
            <option value="">All classifications</option>
            {['Material', 'Services', 'Manpower', 'Catering', 'Logistics', 'Housekeeping', 'Miscellaneous'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Select value={flag} onChange={(e) => setFlag(e.target.value)} aria-label="Control filter">
            <option value="">Any control state</option>
            <option value="negative">Negative-flagged</option>
            <option value="disabled">AP disabled</option>
          </Select>
          <span className="ml-auto text-xs text-ink-muted">{data?.total ?? 0} vendors · SAP snapshot</span>
        </div>
        <DataTable columns={columns} rows={data?.items ?? []} rowKey={(v) => v.code} loading={isLoading} onRowClick={(v) => navigate(`/vendors/${v.code}`)} empty={<NoResults query={search} />} dense />
      </Card>
    </div>
  );
}
