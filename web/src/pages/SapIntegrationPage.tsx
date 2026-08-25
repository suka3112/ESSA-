import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, RefreshCcw } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from '@/lib/format';
import { Badge, Button, Card, DataTable, Input, KeyValue, LoadingState, PageHeader, Select, StatusBadge, Tabs, useToast, type Column } from '@/components/ui';

interface SapData {
  health: { sapState: string; sapMessage: string; referenceDataSyncedAt: string; referenceDataStale: boolean };
  handoffs: { id: string; invoiceId: string; invoiceNumber: string; status: string; attempts: number; createdAt: string; lastAttemptAt?: string; sapDocumentNo?: string; message?: string; errorCode?: string; idempotencyKey: string; correlationId: string; lifecycle?: string }[];
  referenceCounts: { vendors: number; purchaseOrders: number; grns: number; ses: number };
  queuedInvoices: number;
}

export default function SapIntegrationPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'status';
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['sap'],
    queryFn: () => api.get<SapData>('/integrations/sap'),
    refetchInterval: 8_000,
  });

  const setState = useMutation({
    mutationFn: (state: string) => api.post('/integrations/sap/state', { state }),
    onSuccess: () => {
      toast.push({ tone: 'info', title: 'SAP connection state updated', detail: 'Queued handoffs resume automatically when the interface is back.' });
      qc.invalidateQueries({ queryKey: ['sap'] });
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/sap/handoffs/${id}/retry`),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Handoff re-queued' });
      qc.invalidateQueries({ queryKey: ['sap'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Retry failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !data) return <LoadingState label="Loading SAP integration status…" />;
  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Integrations' }, { label: 'SAP Integration' }]}
        title="SAP Integration"
        description="Application-side integration boundary: inbound reference data, outbound validated-invoice handoffs and returned status synchronization. SAP-side posting is owned by the SAP/integration workstream."
        actions={
          hasPerm('SAP_RETRY') ? (
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-ink-muted">Simulate interface:</span>
              {(['CONNECTED', 'DEGRADED', 'UNAVAILABLE'] as const).map((s) => (
                <Button key={s} size="sm" variant={data.health.sapState === s ? 'primary' : 'ghost'} onClick={() => setState.mutate(s)}>
                  {titleCase(s)}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Card>
          <p className="text-2xs font-medium uppercase text-ink-muted">SAP Interface</p>
          <div className="mt-1"><StatusBadge value={data.health.sapState} /></div>
          <p className="mt-1 text-2xs text-ink-muted">{data.health.sapMessage}</p>
        </Card>
        <Card>
          <p className="text-2xs font-medium uppercase text-ink-muted">Reference Data</p>
          <div className="mt-1"><StatusBadge value={data.health.referenceDataStale ? 'DEGRADED' : 'CONNECTED'} label={data.health.referenceDataStale ? 'STALE' : 'FRESH'} /></div>
          <p className="mt-1 text-2xs text-ink-muted">Synced {fmtDateTime(data.health.referenceDataSyncedAt)}</p>
        </Card>
        <Card>
          <p className="text-2xs font-medium uppercase text-ink-muted">Queued for SAP</p>
          <p className="mt-1 text-xl font-bold">{data.queuedInvoices}</p>
          <p className="text-2xs text-ink-muted">Waiting / retrying invoices</p>
        </Card>
        <Card>
          <p className="text-2xs font-medium uppercase text-ink-muted">Reference Objects</p>
          <p className="mt-1 text-xs text-ink-secondary">{data.referenceCounts.purchaseOrders} POs · {data.referenceCounts.grns} GRNs<br />{data.referenceCounts.ses} SES · {data.referenceCounts.vendors} vendors</p>
        </Card>
        <Card>
          <p className="text-2xs font-medium uppercase text-ink-muted">Degraded-mode policy</p>
          <p className="mt-1 text-2xs text-ink-muted">SAP unavailability never blocks the portal — SAP-dependent work queues and technical failures never become business rejections.</p>
        </Card>
      </div>

      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={[{ key: 'status', label: 'Handoffs & Status' }, { key: 'reference', label: 'Reference Data Browser' }]} active={tab} onChange={setTab} />
        </div>
        {tab === 'status' ? (
          <DataTable
            dense
            columns={[
              { key: 'id', header: 'Handoff', render: (h) => <span className="font-mono text-xs">{h.id}</span> },
              { key: 'invoice', header: 'Invoice', render: (h) => <Link to={`/invoices/${h.invoiceId}`} className="font-medium text-essa-700 hover:underline">{h.invoiceNumber}</Link> },
              { key: 'status', header: 'Handoff Status', render: (h) => <StatusBadge value={h.status} /> },
              { key: 'lifecycle', header: 'Invoice Lifecycle', render: (h) => <StatusBadge value={h.lifecycle ?? '—'} /> },
              { key: 'sapDoc', header: 'SAP Document', render: (h) => h.sapDocumentNo ?? '—' },
              { key: 'attempts', header: 'Attempts', align: 'center', render: (h) => (h.attempts > 1 ? <Badge tone="warning">{h.attempts}</Badge> : h.attempts) },
              { key: 'created', header: 'Created', render: (h) => <span className="whitespace-nowrap text-2xs">{fmtDateTime(h.createdAt)}</span> },
              { key: 'msg', header: 'Message', render: (h) => <span className="block max-w-56 truncate text-2xs text-ink-muted" title={h.message}>{h.errorCode ? `${h.errorCode}: ` : ''}{h.message ?? '—'}</span> },
              {
                key: 'actions', header: 'Actions', render: (h) =>
                  ['FAILED', 'DEAD_LETTER', 'QUEUED'].includes(h.status) && hasPerm('SAP_RETRY') ? (
                    <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate(h.id)}>
                      <RefreshCcw size={12} /> Retry
                    </Button>
                  ) : null,
              },
            ] satisfies Column<SapData['handoffs'][0]>[]}
            rows={data.handoffs}
            rowKey={(h) => h.id}
            empty={<p className="py-8 text-center text-xs text-ink-muted">No SAP handoffs yet.</p>}
          />
        ) : (
          <ReferenceBrowser />
        )}
      </Card>
    </div>
  );
}

function ReferenceBrowser() {
  const [params] = useSearchParams();
  const [type, setType] = useState<'PO' | 'GRN' | 'SES'>('PO');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const { data, isLoading } = useQuery({
    queryKey: ['sap-ref', type, search],
    queryFn: () => api.get<{ items: Record<string, unknown>[]; total: number }>(`/integrations/sap/reference${qs({ type, search })}`),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
        <Select value={type} onChange={(e) => setType(e.target.value as 'PO' | 'GRN' | 'SES')} aria-label="Reference type">
          <option value="PO">Purchase Orders</option>
          <option value="GRN">Goods Receipts (GRN)</option>
          <option value="SES">Service Entry Sheets</option>
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-64" aria-label="Search reference data" />
        <span className="ml-auto text-2xs text-ink-muted"><Database size={11} className="mr-1 inline" />Normalized read model — the rule engine consumes this data, never SAP screens directly</span>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : type === 'PO' ? (
        <DataTable
          dense
          columns={[
            { key: 'poNumber', header: 'PO Number', render: (r) => <span className="font-medium">{String(r.poNumber)}</span> },
            { key: 'vendorName', header: 'Vendor', render: (r) => <span className="block max-w-48 truncate text-xs">{String(r.vendorName)}</span> },
            { key: 'poType', header: 'Type', render: (r) => <Badge tone="neutral">{String(r.poType)}</Badge> },
            { key: 'totalAmount', header: 'Value', align: 'right', render: (r) => fmtMoney(Number(r.totalAmount)) },
            { key: 'openAmount', header: 'Open', align: 'right', render: (r) => <span className="font-medium">{fmtMoney(Number(r.openAmount))}</span> },
            { key: 'validTo', header: 'Valid To', render: (r) => <span className="text-xs">{fmtDate(String(r.validTo))}</span> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={String(r.status)} /> },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => String(r.poNumber)}
        />
      ) : type === 'GRN' ? (
        <DataTable
          dense
          columns={[
            { key: 'grnNumber', header: 'GRN', render: (r) => <span className="font-medium">{String(r.grnNumber)}</span> },
            { key: 'poNumber', header: 'PO', render: (r) => String(r.poNumber) },
            { key: 'postingDate', header: 'Posting Date', render: (r) => fmtDate(String(r.postingDate)) },
            { key: 'totalQuantity', header: 'Qty', align: 'right', render: (r) => String(r.totalQuantity) },
            { key: 'amount', header: 'Amount', align: 'right', render: (r) => fmtMoney(Number(r.amount)) },
            { key: 'movementType', header: 'Mvmt', render: (r) => <Badge tone="neutral">{String(r.movementType)}</Badge> },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => String(r.grnNumber)}
        />
      ) : (
        <DataTable
          dense
          columns={[
            { key: 'sesNumber', header: 'SES', render: (r) => <span className="font-medium">{String(r.sesNumber)}</span> },
            { key: 'poNumber', header: 'PO', render: (r) => String(r.poNumber) },
            { key: 'postingDate', header: 'Posting Date', render: (r) => fmtDate(String(r.postingDate)) },
            { key: 'serviceDescription', header: 'Service', render: (r) => <span className="block max-w-64 truncate text-xs">{String(r.serviceDescription)}</span> },
            { key: 'quantity', header: 'Qty', align: 'right', render: (r) => String(r.quantity) },
            { key: 'acceptedAmount', header: 'Accepted', align: 'right', render: (r) => fmtMoney(Number(r.acceptedAmount)) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={String(r.status)} /> },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => String(r.sesNumber)}
        />
      )}
    </div>
  );
}
