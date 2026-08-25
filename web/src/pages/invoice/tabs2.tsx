/**
 * Invoice workbench tabs: Approvals and Timeline.
 *
 * UI/UX review (Aug 2026):
 *  · Approvals show the approval role / group, never an individual's name.
 *  · Delegate and Send back are gone — the agreed actions are Approve and
 *    Reject (with a mandatory reason).
 *  · Channel and other workflow internals are not shown; the full record of who
 *    did what lives in the Audit Log.
 *  · The Exceptions tab was removed — exception handling happens on the invoice
 *    page itself (see InvoiceDetailPage).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GitBranch, User2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayRole, fmtDateTime, fmtMoney } from '@/lib/format';
import { Badge, Button, Card, DataTable, Modal, StatusBadge, Textarea, useToast, Field as FormField, type Column } from '@/components/ui';
import type { InvoiceDetail, StepRow, TimelineRow } from './types';

// ---------------------------------------------------------------- Approvals
export function ApprovalsTab({ detail }: { detail: InvoiceDetail }) {
  const { user, hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<{ step: StepRow; kind: 'APPROVE' | 'REJECT' } | null>(null);
  const [comment, setComment] = useState('');

  const act = useMutation({
    mutationFn: () =>
      api.post(`/approvals/${action!.step.id}/action`, {
        action: action!.kind,
        comment: comment || undefined,
      }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: action!.kind === 'APPROVE' ? 'Invoice approved' : 'Invoice rejected' });
      setAction(null);
      setComment('');
      qc.invalidateQueries({ queryKey: ['invoice', detail.invoice.id] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (!detail.workflow) {
    return <Card><p className="py-8 text-center text-xs text-ink-muted">Approval has not started — it begins once validation passes.</p></Card>;
  }
  const { instance, steps } = detail.workflow;

  return (
    <div className="space-y-4">
      <Card title={instance.definitionName} actions={<StatusBadge value={instance.status} />}>
        {/* Level stepper — the approval level and the group that owns it. */}
        <ol className="flex flex-wrap items-center gap-y-3">
          {steps.map((s, i) => (
            <li key={s.id} className="flex items-center">
              <div className="flex flex-col items-center px-1 text-center">
                <span
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold',
                    s.status === 'APPROVED' && 'border-essa-600 bg-essa-600 text-white',
                    s.status === 'ACTIVE' && 'border-essa-600 bg-white text-essa-700 ring-4 ring-essa-100',
                    s.status === 'REJECTED' && 'border-semantic-error bg-semantic-error text-white',
                    ['PENDING', 'SKIPPED', 'SENT_BACK', 'DELEGATED', 'ESCALATED'].includes(s.status) && 'border-line-strong bg-white text-ink-faint'
                  )}
                >
                  {s.status === 'APPROVED' ? <CheckCircle2 size={15} /> : s.status === 'REJECTED' ? <XCircle size={15} /> : s.stepNo}
                </span>
                <span className="mt-1 w-24 text-2xs font-medium leading-tight text-ink-secondary">Level {s.stepNo}</span>
                <span className="w-24 text-2xs text-ink-faint">{displayRole(s.role)}</span>
              </div>
              {i < steps.length - 1 && <span className={clsx('mx-1 mb-8 h-0.5 w-8 sm:w-14', steps[i].status === 'APPROVED' ? 'bg-essa-600' : 'bg-line-strong')} />}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Approval history" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'stepNo', header: 'Level', align: 'center', render: (s) => s.stepNo },
            { key: 'role', header: 'Approval Role / Group', render: (s) => <span className="text-xs">{displayRole(s.role)}</span> },
            { key: 'status', header: 'Decision', render: (s) => <StatusBadge value={s.status} /> },
            {
              key: 'at', header: 'Decision Date / Time',
              render: (s) => <span className="whitespace-nowrap text-2xs">{s.actedAt ? fmtDateTime(s.actedAt) : s.dueAt ? `Due ${fmtDateTime(s.dueAt)}` : '—'}</span>,
            },
            { key: 'comment', header: 'Comment', render: (s) => <span className="block max-w-52 truncate text-2xs text-ink-muted" title={s.comment}>{s.comment ?? '—'}</span> },
            {
              key: 'actions', header: 'Action', sticky: true, render: (s) => {
                const canAct = s.status === 'ACTIVE' && hasPerm('APPROVAL_ACT') && (s.assignedTo === user?.id || !s.assignedTo || hasPerm('USER_ADMIN'));
                if (!canAct) {
                  return (
                    <span className="whitespace-nowrap text-2xs text-ink-faint">
                      {s.status === 'ACTIVE' ? 'With another approver' : 'No action'}
                    </span>
                  );
                }
                return (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => setAction({ step: s, kind: 'APPROVE' })}>Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => setAction({ step: s, kind: 'REJECT' })}>Reject</Button>
                  </div>
                );
              },
            },
          ] satisfies Column<StepRow>[]}
          rows={steps}
          rowKey={(s) => s.id}
        />
      </Card>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={`${action?.kind === 'REJECT' ? 'Reject' : 'Approve'} — Level ${action?.step.stepNo}`}
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
            {detail.invoice.invoiceNumber} · {detail.invoice.vendorName} · <span className="font-semibold">{fmtMoney(detail.invoice.amount, detail.invoice.currency)}</span>
          </p>
          <FormField label={action?.kind === 'REJECT' ? 'Reason for rejection (required)' : 'Comment (optional)'} required={action?.kind === 'REJECT'}>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={action?.kind === 'REJECT' ? 'Why is this invoice being rejected?' : 'Add context for the audit log'} />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Timeline
export function TimelineTab({ timeline }: { timeline: TimelineRow[] }) {
  return (
    <Card title="Invoice timeline">
      <ol className="relative ml-2 space-y-4 border-l-2 border-line pl-5">
        {timeline.map((t) => (
          <li key={t.id} className="relative">
            <span
              className={clsx(
                'absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white',
                t.status === 'SUCCESS' && 'border-essa-500',
                t.status === 'ERROR' && 'border-semantic-error',
                t.status === 'WARNING' && 'border-amber-500',
                t.status === 'INFO' && 'border-semantic-info'
              )}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full', t.status === 'SUCCESS' ? 'bg-essa-500' : t.status === 'ERROR' ? 'bg-semantic-error' : t.status === 'WARNING' ? 'bg-amber-500' : 'bg-semantic-info')} />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-ink">{t.title}</p>
              <Badge tone="neutral">{t.event.replace(/_/g, ' ')}</Badge>
            </div>
            {t.detail && <p className="mt-0.5 text-xs text-ink-secondary">{t.detail}</p>}
            <p className="mt-0.5 flex items-center gap-2 text-2xs text-ink-faint">
              {t.actorType === 'USER' ? <User2 size={11} /> : <GitBranch size={11} />} {t.actorName} · {fmtDateTime(t.at)}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
