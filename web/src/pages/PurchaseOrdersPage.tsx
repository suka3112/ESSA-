/**
 * Purchase Orders — new top-level menu (design review §13).
 * Lists every PO from the SAP-injected reference data, searchable, with CSV
 * export (exports exactly what is filtered on screen).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Badge, Button, Card, DataTable, Input, NoResults, PageHeader, StatusBadge, type Column } from '@/components/ui';

interface PoRow {
  poNumber: string;
  vendorCode: string;
  vendorName: string;
  totalAmount: number;
  openAmount: number;
  currency: string;
  validTo: string;
  status: string;
  items?: unknown[];
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', applied],
    queryFn: () => api.get<{ items: PoRow[]; total: number }>(`/integrations/sap/reference${qs({ type: 'PO', search: applied })}`),
  });

  const exportCsv = () => {
    if (!data) return;
    const header = 'PO Number,Vendor Code,Vendor,Total Amount,Open Amount,Currency,Valid To,Status';
    const rows = data.items.map((p) =>
      [p.poNumber, p.vendorCode, p.vendorName, p.totalAmount, p.openAmount, p.currency, p.validTo, p.status]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'eapa-purchase-orders.csv';
    a.click();
  };

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Purchase Orders' }]}
        title="Purchase Orders"
        description="All purchase orders from the SAP reference data, with open value against each. PO invoices match against these — no approval workflow applies to PO invoices."
        actions={
          <Button variant="secondary" size="sm" onClick={exportCsv} title="Downloads exactly what is filtered on screen">
            <Download size={14} /> Export
          </Button>
        }
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(search);
            }}
          >
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO number or vendor…" className="w-72 pl-8" aria-label="Search purchase orders" />
          </form>
          {data && <span className="text-2xs text-ink-muted">{data.items.length} of {data.total} POs</span>}
        </div>
        <DataTable
          dense
          loading={isLoading}
          columns={[
            { key: 'poNumber', header: 'PO Number', sortable: true, value: (p) => p.poNumber, render: (p) => <span className="font-mono font-medium text-essa-700">{p.poNumber}</span> },
            {
              key: 'vendor', header: 'Vendor', sortable: true, value: (p) => p.vendorName, render: (p) => (
                <span>
                  <span className="block font-medium">{p.vendorName}</span>
                  <span className="block text-2xs text-ink-faint">{p.vendorCode}</span>
                </span>
              ),
            },
            { key: 'total', header: 'Total Value', align: 'right', sortable: true, value: (p) => p.totalAmount, render: (p) => <span className="whitespace-nowrap font-medium">{fmtMoney(p.totalAmount, p.currency)}</span> },
            {
              key: 'open', header: 'Open Value', align: 'right', sortable: true, value: (p) => p.openAmount, render: (p) => (
                <span className="whitespace-nowrap">
                  {p.openAmount > 0 ? <span className="font-medium text-essa-700">{fmtMoney(p.openAmount, p.currency)}</span> : <Badge tone="neutral">Fully invoiced</Badge>}
                </span>
              ),
            },
            { key: 'validTo', header: 'Valid To', sortable: true, value: (p) => p.validTo, render: (p) => <span className="whitespace-nowrap text-xs">{fmtDate(p.validTo)}</span> },
            { key: 'status', header: 'Status', sortable: true, value: (p) => p.status, render: (p) => <StatusBadge value={p.status} /> },
          ] satisfies Column<PoRow>[]}
          rows={data?.items ?? []}
          rowKey={(p) => p.poNumber}
          onRowClick={(p) => navigate(`/invoices?search=${encodeURIComponent(p.poNumber)}`)}
          empty={<NoResults query={applied || undefined} />}
        />
      </Card>
    </div>
  );
}
