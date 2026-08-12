import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtRelative, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, useToast, type Column,
} from '@/components/ui';

interface ApprovalRow {
  id: string; invoiceId: string; invoiceNumber?: string; vendorName?: string; amount?: number; currency?: string;
  department?: string; categoryName?: string; stepNo: number; name: string; role: string;
  assignedToName?: string; status: string; dueAt?: string; overdue: boolean; actedByName?: string; actedAt?: string;
  comment?: string; priority?: string; channel?: string;
}

export default function ApprovalsPage() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [tab, setTab] = useState('queue');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<{ row: ApprovalRow; kind: 'APPROVE' | 'REJECT' | 'SEND_BACK' | 'DELEGATE' } | null>(null);
  const [comment, setComment] = useState('');
  const [delegateTo, setDelegateTo] = useState('');
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<{ users: { id: string; name: string; enabled: boolean }[] }>('/lookups') });

  const { data, isLoading } = useQuery({
    queryKey: ['approvals', scope],
    queryFn: () => api.get<{ queue: ApprovalRow[]; history: ApprovalRow[] }>(`/approvals${qs({ scope })}`),
    refetchInterval: 15_000,
  });

  const act = useMutation({
    mutationFn: () => api.post(`/approvals/${action!.row.id}/action`, { action: action!.kind, comment: comment || undefined, delegateTo: delegateTo || undefined }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Approval action recorded' });
      setAction(null);
      setComment('');
      setDelegateTo('');
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const queueColumns: Column<ApprovalRow>[] = [
    {
      key: 'invoice', header: 'Invoice', render: (r) => (
        <div>
          <Link to={`/invoices/${r.invoiceId}?tab=approvals`} onClick={(e) => e.stopPropagation()} className="font-medium text-essa-700 hover:underline">{r.invoiceNumber}</Link>
          <p className="text-2xs text-ink-faint">{r.categoryName}</p>
        </div>
      ),
    },
    { key: 'vendor', header: 'Vendor', render: (r) => <span className="block max-w-44 truncate text-xs">{r.vendorName}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-medium">{fmtMoney(r.amount, r.currency)}</span> },
    { key: 'department', header: 'Department', render: (r) => <span className="text-xs">{r.department}</span> },
    { key: 'step', header: 'Approval Step', render: (r) => <span className="text-xs">L{r.stepNo} · {r.name}</span> },
    { key: 'approver', header: 'Approver', render: (r) => <span className="text-xs">{r.assignedToName ?? titleCase(r.role)}</span> },
    { key: 'priority', header: 'Priority', render: (r) => <StatusBadge value={r.priority ?? 'NORMAL'} /> },
    {
      key: 'due', header: 'Due / SLA', render: (r) =>
        r.overdue ? <Badge tone="error">Overdue</Badge> : <span className="whitespace-nowrap text-2xs text-ink-muted"><Clock size={10} className="mr-0.5 inline" />{fmtRelative(r.dueAt)}</span>,
    },
    {
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={() => setAction({ row: r, kind: 'APPROVE' })}>Approve</Button>
          <Button size="sm" variant="danger" onClick={() => setAction({ row: r, kind: 'REJECT' })}>Reject</Button>
          <Button size="sm" variant="ghost" onClick={() => setAction({ row: r, kind: 'DELEGATE' })}>Delegate</Button>
        </div>
      ),
    },
  ];

  const historyColumns: Column<ApprovalRow>[] = [
    { key: 'invoice', header: 'Invoice', render: (r) => <Link to={`/invoices/${r.invoiceId}?tab=approvals`} className="font-medium text-essa-700 hover:underline">{r.invoiceNumber}</Link> },
    { key: 'vendor', header: 'Vendor', render: (r) => <span className="block max-w-44 truncate text-xs">{r.vendorName}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, r.currency) },
    { key: 'step', header: 'Step', render: (r) => <span className="text-xs">{r.name}</span> },
    { key: 'status', header: 'Decision', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'by', header: 'Acted By', render: (r) => <span className="text-xs">{r.actedByName}</span> },
    { key: 'at', header: 'Acted At', render: (r) => <span className="whitespace-nowrap text-2xs">{fmtDateTime(r.actedAt)}</span> },
    { key: 'channel', header: 'Channel', render: (r) => <Badge tone="neutral">{r.channel ?? 'PORTAL'}</Badge> },
    { key: 'comment', header: 'Comment', render: (r) => <span className="block max-w-56 truncate text-2xs text-ink-muted" title={r.comment}>{r.comment ?? '—'}</span> },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoice Processing' }, { label: 'Approvals' }]}
        title="Approval Queue"
        description="Delegation of Authority routing with SLA tracking. Approvals can also arrive via Microsoft Teams; the portal is the controlled fallback."
        actions={
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} aria-label="Approval scope">
            <option value="mine">My approvals</option>
            <option value="all">All approvals</option>
          </Select>
        }
      />
      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={[{ key: 'queue', label: 'Awaiting action' }, { key: 'history', label: 'History' }]} counts={{ queue: data?.queue.length }} active={tab} onChange={setTab} />
        </div>
        {tab === 'queue' ? (
          <DataTable
            columns={queueColumns}
            rows={data?.queue ?? []}
            rowKey={(r) => r.id}
            loading={isLoading}
            onRowClick={(r) => navigate(`/invoices/${r.invoiceId}?tab=approvals`)}
            empty={<EmptyState title="No approvals waiting" hint={scope === 'mine' ? 'Nothing is currently assigned to you. Switch to "All approvals" to see the full queue.' : 'The approval queue is clear.'} />}
            dense
          />
        ) : (
          <DataTable columns={historyColumns} rows={data?.history ?? []} rowKey={(r) => r.id} loading={isLoading} empty={<EmptyState title="No approval history yet" />} dense />
        )}
      </Card>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={`${titleCase(action?.kind ?? '')} — ${action?.row.invoiceNumber}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              variant={action?.kind === 'REJECT' ? 'danger' : 'primary'}
              loading={act.isPending}
              disabled={(['REJECT', 'SEND_BACK'].includes(action?.kind ?? '') && !comment.trim()) || (action?.kind === 'DELEGATE' && !delegateTo)}
              onClick={() => act.mutate()}
            >
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <p className="text-ink-secondary">
            {action?.row.name} · {action?.row.vendorName} · <span className="font-semibold">{fmtMoney(action?.row.amount, action?.row.currency)}</span>
          </p>
          {action?.kind === 'DELEGATE' && (
            <Field label="Delegate to" required>
              <Select value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)} className="w-full">
                <option value="">Select user…</option>
                {lookups?.users.filter((u) => u.enabled).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={['REJECT', 'SEND_BACK'].includes(action?.kind ?? '') ? 'Reason (mandatory)' : 'Comment (optional)'} required={['REJECT', 'SEND_BACK'].includes(action?.kind ?? '')}>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
