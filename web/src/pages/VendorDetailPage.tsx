import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck, Mail, Phone, Landmark, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, DataTable, KeyValue, LoadingState, PageHeader, StatusBadge, useToast, type Column } from '@/components/ui';

interface VendorDetail {
  vendor: {
    code: string; name: string; legalName: string; address: string; city: string; state: string; country: string;
    gstin: string; pan: string; bankAccountMasked: string; bankName: string; paymentTerms: string; currency: string;
    companyCodes: string[]; classification: string; sapStatus: string; lastSyncAt: string; sapRef: string; email: string; phone: string;
  };
  control?: { negativeFlag: boolean; apEnabled: boolean; reason?: string; remarks?: string; updatedByName: string; updatedAt: string };
  history: { id: string; action: string; reason: string; byName: string; at: string }[];
  purchaseOrders: { poNumber: string; totalAmount: number; openAmount: number; validTo: string; status: string; poType: string }[];
  invoices: { id: string; invoiceNumber: string; invoiceDate: string; amount: number; currency: string; lifecycle: string; stage: string; categoryName?: string }[];
}

export default function VendorDetailPage() {
  const { code } = useParams();
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ field: 'negativeFlag' | 'apEnabled'; next: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['vendor', code],
    queryFn: () => api.get<VendorDetail>(`/vendors/${code}`),
  });

  const update = useMutation({
    mutationFn: (payload: { negativeFlag?: boolean; apEnabled?: boolean; reason?: string }) => api.post(`/vendors/${code}/control`, payload),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Vendor control updated', detail: 'The change is recorded in the vendor control history and audit trail.' });
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['vendor', code] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !data) return <LoadingState label="Loading vendor…" />;
  const v = data.vendor;
  const c = data.control;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Vendors', to: '/vendors' }, { label: v.code }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {v.name}
            <StatusBadge value={v.sapStatus} />
            {c?.negativeFlag && <Badge tone="error">Negative flag</Badge>}
            {c && !c.apEnabled && <Badge tone="warning">AP disabled</Badge>}
          </span>
        }
        description={`${v.code} · ${v.city}, ${v.state}`}
        actions={
          hasPerm('VENDOR_CONTROL') ? (
            <>
              <Button variant={c?.negativeFlag ? 'secondary' : 'warning'} size="sm" onClick={() => setConfirm({ field: 'negativeFlag', next: !c?.negativeFlag })}>
                <ShieldAlert size={14} /> {c?.negativeFlag ? 'Remove negative flag' : 'Mark negative'}
              </Button>
              <Button variant={c?.apEnabled === false ? 'primary' : 'secondary'} size="sm" onClick={() => setConfirm({ field: 'apEnabled', next: !(c?.apEnabled ?? true) })}>
                <ShieldCheck size={14} /> {c?.apEnabled === false ? 'Enable EAPA' : 'Disable EAPA'}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Review, 24 Aug: bank details must be visually separated from the
            rest of the vendor record so they cannot be misread as ordinary
            master data, and the read-only nature of the record is stated up
            front rather than in a footnote. */}
        <Card title="Vendor Information" className="lg:col-span-2">
          <p className="mb-3 flex items-start gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-2xs text-ink-muted">
            <Lock size={12} className="mt-0.5 shrink-0 text-ink-faint" />
            <span>
              Read-only. SAP is the vendor master and vendor data is added, changed or removed through the ESSA
              master-data process. Only the AP control overlay on the right is maintained in this portal.
            </span>
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
            <KeyValue label="Legal Name">{v.legalName}</KeyValue>
            <KeyValue label="Vendor Code">{v.code}</KeyValue>
            <KeyValue label="SAP Reference"><span className="font-mono text-xs">{v.sapRef}</span></KeyValue>
            <KeyValue label="Address">{v.address}, {v.city}, {v.state}, {v.country}</KeyValue>
            <KeyValue label="Tax Number"><span className="font-mono text-xs">{v.gstin}</span></KeyValue>
            {/* Company code removed — it is ESSA's entity (PO-based), not a vendor attribute. */}
            <KeyValue label="AP Contact">
              <span className="flex items-center gap-1.5"><Mail size={12} className="text-essa-600" /> {v.email}</span>
              <span className="mt-0.5 flex items-center gap-1.5"><Phone size={12} className="text-essa-600" /> {v.phone}</span>
            </KeyValue>
            <KeyValue label="Vendor SAP Sync">{fmtDateTime(v.lastSyncAt)}</KeyValue>
          </dl>

          <div className="mt-4 rounded-lg border border-line bg-canvas p-3">
            <p className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-secondary">
              <Landmark size={13} className="text-essa-600" /> Payment details
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <KeyValue label="Bank">{v.bankName}</KeyValue>
              <KeyValue label="Account Number"><span className="font-mono text-xs">{v.bankAccountMasked}</span></KeyValue>
              <KeyValue label="Payment Terms">{v.paymentTerms}</KeyValue>
              <KeyValue label="Currency">{v.currency}</KeyValue>
            </dl>
            <p className="mt-2 text-2xs text-ink-faint">
              The account number is masked. Payment is always made to the bank account held in the SAP vendor master.
            </p>
          </div>
        </Card>

        <Card title="Portal AP control overlay">
          <dl className="space-y-3">
            <KeyValue label="Negative Vendor Flag">{c?.negativeFlag ? <Badge tone="error">Enabled</Badge> : <Badge tone="success">Disabled</Badge>}</KeyValue>
            <KeyValue label="AP Automation Enabled">{c?.apEnabled === false ? <Badge tone="warning">No — EAPA disabled</Badge> : <Badge tone="success">Yes</Badge>}</KeyValue>
            {c?.reason && <KeyValue label="Reason">{c.reason}</KeyValue>}
            {c?.remarks && <KeyValue label="Remarks">{c.remarks}</KeyValue>}
            <KeyValue label="Last Status Update">{c ? `${c.updatedByName} · ${fmtDateTime(c.updatedAt)}` : '—'}</KeyValue>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Open purchase orders" pad={false}>
          <DataTable
            dense
            columns={[
              { key: 'po', header: 'PO', sortable: true, value: (p) => p.poNumber, render: (p) => <span className="font-medium">{p.poNumber}</span> },
              { key: 'type', header: 'Type', sortable: true, value: (p) => p.poType, render: (p) => <Badge tone="neutral">{p.poType}</Badge> },
              { key: 'total', header: 'Value', align: 'right', render: (p) => fmtMoney(p.totalAmount) },
              { key: 'open', header: 'Open', align: 'right', sortable: true, value: (p) => p.openAmount, render: (p) => <span className="font-medium">{fmtMoney(p.openAmount)}</span> },
              { key: 'valid', header: 'Valid To', render: (p) => <span className="text-xs">{fmtDate(p.validTo)}</span> },
              { key: 'status', header: 'Status', render: (p) => <StatusBadge value={p.status} /> },
            ] satisfies Column<VendorDetail['purchaseOrders'][0]>[]}
            rows={data.purchaseOrders}
            rowKey={(p) => p.poNumber}
          />
        </Card>

        <Card title="Recent invoices" pad={false}>
          <DataTable
            dense
            columns={[
              { key: 'no', header: 'Invoice', render: (i) => <Link to={`/invoices/${i.id}`} className="font-medium text-essa-700 hover:underline">{i.invoiceNumber}</Link> },
              { key: 'date', header: 'Date', render: (i) => <span className="text-xs">{fmtDate(i.invoiceDate)}</span> },
              { key: 'cat', header: 'Category', render: (i) => <span className="text-xs">{i.categoryName}</span> },
              { key: 'amount', header: 'Amount', align: 'right', render: (i) => fmtMoney(i.amount, i.currency) },
              { key: 'status', header: 'Status', render: (i) => <StatusBadge value={i.lifecycle} /> },
            ] satisfies Column<VendorDetail['invoices'][0]>[]}
            rows={data.invoices}
            rowKey={(i) => i.id}
          />
        </Card>
      </div>

      {/* Vendor Control History removed (design review) — audit history lives in the Audit Timeline; the PO and invoice lists use the space. */}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        loading={update.isPending}
        title={
          confirm?.field === 'negativeFlag'
            ? confirm.next ? 'Mark vendor as negative' : 'Remove negative flag'
            : confirm?.next ? 'Enable EAPA' : 'Disable EAPA'
        }
        tone={confirm?.next && confirm.field === 'negativeFlag' ? 'danger' : 'warning'}
        confirmLabel="Apply control change"
        requireReason={confirm?.next || confirm?.field === 'apEnabled' ? 'Reason (mandatory, audited)' : 'Reason (recommended)'}
        message={
          confirm?.field === 'negativeFlag' && confirm.next
            ? 'New invoices from this vendor will hard-fail validation (R-GLB-006) and route to AP review. This does not modify SAP master data.'
            : confirm?.field === 'apEnabled' && !confirm.next
              ? 'The vendor will be excluded from AP automation. Existing in-flight invoices are not cancelled.'
              : 'This restores normal AP automation processing for the vendor.'
        }
        onConfirm={(reason) => update.mutate({ [confirm!.field]: confirm!.next, reason })}
      />
    </div>
  );
}
