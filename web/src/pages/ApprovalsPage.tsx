/**
 * Approvals — invoices waiting for an approval decision.
 *
 * UI/UX review (Aug 2026) §9:
 *  · Only roles with approval permission reach this screen; the AP Processor
 *    never sees it (see the role permissions in the identity seed).
 *  · Columns are invoice facts — Invoice Number, Vendor, Category, Amount and
 *    Approval Status. The role is implicit in who is signed in, so it is not
 *    shown, and Department is not a concept in this platform (review, 24 Aug).
 *  · Every column sorts, and vendor / category / status carry column filters.
 *  · The History tab was removed: past decisions live in the Audit Log, which
 *    covers every transaction on the platform, not just approvals.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { currentStatus, fmtDateTime, fmtMoney } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, EmptyState, Field, InvoiceStatusBadge, Modal, PageHeader, Select, Textarea, useToast, type Column,
} from '@/components/ui';

interface ApprovalRow {
  id: string; invoiceId: string; invoiceNumber?: string; vendorName?: string; amount?: number; currency?: string;
  categoryName?: string; stepNo: number; name: string; role: string;
  status: string; dueAt?: string; overdue: boolean;
  lifecycle: string; stage?: string | null; processingFlag?: string | null; poNumber?: string;
}

export default function ApprovalsPage() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<{ row: ApprovalRow; kind: 'APPROVE' | 'REJECT' } | null>(null);
  const [comment, setComment] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['approvals', scope],
    queryFn: () => api.get<{ queue: ApprovalRow[] }>(`/approvals${qs({ scope })}`),
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: () => api.post(`/approvals/${action!.row.id}/action`, { action: action!.kind, comment: comment || undefined }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: action!.kind === 'APPROVE' ? 'Invoice approved' : 'Invoice rejected' });
      setAction(null);
      setComment('');
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const columns: Column<ApprovalRow>[] = [
    {
      key: 'invoiceNumber', header: 'Invoice Number', sortable: true, value: (r) => r.invoiceNumber ?? '', render: (r) => (
        <Link to={`/invoices/${r.invoiceId}?tab=approvals`} onClick={(e) => e.stopPropagation()} className="font-medium text-essa-700 hover:underline">{r.invoiceNumber}</Link>
      ),
    },
    { key: 'vendorName', header: 'Vendor Name', sortable: true, value: (r) => r.vendorName ?? '', render: (r) => <span className="block max-w-44 truncate text-xs">{r.vendorName}</span> },
    { key: 'categoryName', header: 'Category', sortable: true, value: (r) => r.categoryName ?? '', render: (r) => <span className="text-xs">{r.categoryName ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, value: (r) => r.amount ?? 0, render: (r) => <span className="whitespace-nowrap font-medium">{fmtMoney(r.amount, r.currency)}</span> },
    { key: 'status', header: 'Approval Status', sortable: true, value: (r) => currentStatus(r), render: (r) => <InvoiceStatusBadge status={currentStatus(r)} /> },
    {
      key: 'due', header: 'SLA Due', sortable: true, value: (r) => r.dueAt ?? '',
      render: (r) => (r.overdue ? <Badge tone="error">SLA Breached</Badge> : <span className="whitespace-nowrap text-2xs text-ink-muted">{fmtDateTime(r.dueAt)}</span>),
    },
    {
      key: 'actions', header: 'Action', sticky: true, render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={() => setAction({ row: r, kind: 'APPROVE' })}>Approve</Button>
          <Button size="sm" variant="danger" onClick={() => setAction({ row: r, kind: 'REJECT' })}>Reject</Button>
          <button
            aria-label={`Open ${r.invoiceNumber}`}
            title="Open the invoice"
            onClick={() => navigate(`/invoices/${r.invoiceId}?tab=approvals`)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-muted transition-colors hover:border-essa-400 hover:text-essa-700"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoice Processing' }, { label: 'Approvals' }]}
        title="Approvals"
        description="Invoices waiting for an approval decision. Approvals can also be given from Microsoft Teams or email."
        actions={
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} aria-label="Approval scope">
            <option value="mine">My approvals</option>
            <option value="all">All approvals</option>
          </Select>
        }
      />
      <Card pad={false}>
        <DataTable
          columns={columns}
          rows={data?.queue ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          onRowClick={(r) => navigate(`/invoices/${r.invoiceId}?tab=approvals`)}
          empty={<EmptyState title="No approvals waiting" hint={scope === 'mine' ? 'Nothing is waiting for you. Switch to "All approvals" to see the full queue.' : 'The approval queue is clear.'} />}
          dense
        />
      </Card>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={`${action?.kind === 'REJECT' ? 'Reject' : 'Approve'} — ${action?.row.invoiceNumber}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              variant={action?.kind === 'REJECT' ? 'danger' : 'primary'}
              loading={act.isPending}
              disabled={action?.kind === 'REJECT' && !comment.trim()}
              onClick={() => act.mutate()}
            >
              {action?.kind === 'REJECT' ? 'Reject invoice' : 'Approve invoice'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <p className="text-ink-secondary">
            {action?.row.vendorName} · <span className="font-semibold">{fmtMoney(action?.row.amount, action?.row.currency)}</span>
          </p>
          <Field label={action?.kind === 'REJECT' ? 'Reason for rejection (required)' : 'Comment (optional)'} required={action?.kind === 'REJECT'}>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
