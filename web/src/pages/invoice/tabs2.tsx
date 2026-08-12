/** Invoice workbench tabs: Exceptions, Approvals, Timeline, Audit. */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Clock, GitBranch, User2, XCircle, AlertCircle, Cpu } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtMoney, fmtRelative, titleCase } from '@/lib/format';
import { Badge, Button, Card, DataTable, KeyValue, Modal, Select, StatusBadge, Textarea, useToast, Field as FormField, type Column } from '@/components/ui';
import type { AuditRow, ExceptionRow, InvoiceDetail, StepRow, TimelineRow } from './types';
import { ExceptionActions } from '../exceptions/ExceptionActions';

// ---------------------------------------------------------------- Exceptions
export function ExceptionsTab({ detail }: { detail: InvoiceDetail }) {
  const [selected, setSelected] = useState<ExceptionRow | null>(null);
  const open = detail.exceptions.filter((e) => !['RESOLVED', 'CLOSED'].includes(e.status));
  const closed = detail.exceptions.filter((e) => ['RESOLVED', 'CLOSED'].includes(e.status));
  const qc = useQueryClient();

  const section = (title: string, rows: ExceptionRow[]) => (
    <Card title={title} pad={false}>
      <DataTable
        dense
        columns={[
          { key: 'code', header: 'Exception', render: (e) => <span className="font-medium text-essa-700">{e.code}</span> },
          { key: 'type', header: 'Type', render: (e) => <span className="text-xs">{titleCase(e.type)}</span> },
          { key: 'severity', header: 'Severity', render: (e) => <StatusBadge value={e.severity} /> },
          { key: 'status', header: 'Status', render: (e) => <StatusBadge value={e.status} /> },
          { key: 'title', header: 'Summary', render: (e) => <span className="block max-w-72 truncate text-xs">{e.title}</span> },
          { key: 'assigned', header: 'Assigned To', render: (e) => e.assignedToName ?? <span className="text-ink-faint">Unassigned</span> },
          { key: 'created', header: 'Created', render: (e) => <span className="text-2xs">{fmtRelative(e.createdAt)}</span> },
          { key: 'tech', header: 'Class', render: (e) => (e.technical ? <Badge tone="pending"><Cpu size={11} /> Technical</Badge> : <Badge tone="neutral">Business</Badge>) },
        ] satisfies Column<ExceptionRow>[]}
        rows={rows}
        rowKey={(e) => e.id}
        onRowClick={(e) => setSelected(e)}
        empty={<p className="py-6 text-center text-xs text-ink-muted">None</p>}
      />
    </Card>
  );

  return (
    <div className="space-y-4">
      {section(`Open exceptions (${open.length})`, open)}
      {closed.length > 0 && section(`Resolved / closed (${closed.length})`, closed)}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={`Exception ${selected?.code}`} wide>
        {selected && (
          <ExceptionDetailBody
            exception={selected}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ['invoice', detail.invoice.id] });
              setSelected(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

export function ExceptionDetailBody({ exception, onChanged }: { exception: ExceptionRow; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        <KeyValue label="Type">{titleCase(exception.type)}</KeyValue>
        <KeyValue label="Severity"><StatusBadge value={exception.severity} /></KeyValue>
        <KeyValue label="Status"><StatusBadge value={exception.status} /></KeyValue>
        <KeyValue label="Class">{exception.technical ? 'Technical (retryable)' : 'Business'}</KeyValue>
        <KeyValue label="Created">{fmtDateTime(exception.createdAt)}</KeyValue>
        <KeyValue label="SLA Due">{fmtDateTime(exception.slaDueAt)}</KeyValue>
        <KeyValue label="Assigned To">{exception.assignedToName ?? '—'}</KeyValue>
        <KeyValue label="Rule">{exception.ruleCode ?? '—'}</KeyValue>
      </dl>
      <div>
        <p className="text-xs font-semibold text-ink">{exception.title}</p>
        <p className="mt-1 text-xs text-ink-secondary">{exception.detail}</p>
        {exception.resolution && (
          <p className="mt-2 rounded bg-semantic-successBg px-2 py-1.5 text-xs text-semantic-success">Resolution: {exception.resolution}</p>
        )}
      </div>
      <ExceptionActions exception={exception} onChanged={onChanged} />
      <div>
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Activity</p>
        <ul className="space-y-1.5">
          {exception.actions.slice().reverse().map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-essa-500" />
              <span>
                <span className="font-medium">{titleCase(a.action)}</span> by {a.byName}
                <span className="text-ink-faint"> · {fmtDateTime(a.at)}</span>
                {a.note && <span className="block text-ink-muted">{a.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Approvals
export function ApprovalsTab({ detail }: { detail: InvoiceDetail }) {
  const { user, hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<{ step: StepRow; kind: 'APPROVE' | 'REJECT' | 'SEND_BACK' | 'DELEGATE' } | null>(null);
  const [comment, setComment] = useState('');
  const [delegateTo, setDelegateTo] = useState('');

  const act = useMutation({
    mutationFn: () =>
      api.post(`/approvals/${action!.step.id}/action`, {
        action: action!.kind,
        comment: comment || undefined,
        delegateTo: delegateTo || undefined,
      }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: `Step ${titleCase(action!.kind)}${action!.kind === 'APPROVE' ? 'd' : action!.kind === 'DELEGATE' ? 'd' : ''}` });
      setAction(null);
      setComment('');
      qc.invalidateQueries({ queryKey: ['invoice', detail.invoice.id] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (!detail.workflow) {
    return <Card><p className="py-8 text-center text-xs text-ink-muted">Approval workflow has not started — it begins once validation passes.</p></Card>;
  }
  const { instance, steps } = detail.workflow;

  return (
    <div className="space-y-4">
      <Card title={`${instance.definitionName}`} actions={<StatusBadge value={instance.status} />}>
        {/* visual stepper */}
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
                    s.status === 'SENT_BACK' && 'border-amber-500 bg-amber-500 text-white',
                    ['PENDING', 'SKIPPED', 'DELEGATED', 'ESCALATED'].includes(s.status) && 'border-line-strong bg-white text-ink-faint'
                  )}
                >
                  {s.status === 'APPROVED' ? <CheckCircle2 size={15} /> : s.status === 'REJECTED' ? <XCircle size={15} /> : s.stepNo}
                </span>
                <span className="mt-1 w-24 text-2xs font-medium leading-tight text-ink-secondary">{s.name}</span>
                <span className="text-2xs text-ink-faint">{s.assignedToName ?? s.role}</span>
              </div>
              {i < steps.length - 1 && <span className={clsx('mx-1 mb-8 h-0.5 w-8 sm:w-14', steps[i].status === 'APPROVED' ? 'bg-essa-600' : 'bg-line-strong')} />}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Approval steps" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'stepNo', header: '#', render: (s) => s.stepNo },
            { key: 'name', header: 'Step', render: (s) => <span className="font-medium">{s.name}</span> },
            { key: 'role', header: 'Role', render: (s) => <Badge tone="neutral">{titleCase(s.role)}</Badge> },
            { key: 'assigned', header: 'Approver', render: (s) => s.assignedToName ?? <span className="text-ink-faint">Role queue</span> },
            { key: 'status', header: 'Status', render: (s) => <StatusBadge value={s.status} /> },
            {
              key: 'due', header: 'Due / Acted', render: (s) =>
                s.actedAt ? (
                  <span className="text-2xs">{s.actedByName}<br />{fmtDateTime(s.actedAt)}{s.channel ? ` · ${s.channel}` : ''}</span>
                ) : s.dueAt ? (
                  <span className={clsx('text-2xs', new Date(s.dueAt) < new Date() ? 'font-semibold text-semantic-error' : 'text-ink-muted')}>
                    <Clock size={10} className="mr-0.5 inline" /> {fmtRelative(s.dueAt)}
                  </span>
                ) : '—',
            },
            { key: 'comment', header: 'Comment', render: (s) => <span className="block max-w-52 truncate text-2xs text-ink-muted" title={s.comment}>{s.comment ?? '—'}</span> },
            {
              key: 'actions', header: 'Actions', render: (s) => {
                const canAct = s.status === 'ACTIVE' && hasPerm('APPROVAL_ACT') && (s.assignedTo === user?.id || !s.assignedTo || hasPerm('USER_ADMIN'));
                if (!canAct) return null;
                return (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => setAction({ step: s, kind: 'APPROVE' })}>Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => setAction({ step: s, kind: 'REJECT' })}>Reject</Button>
                    <Button size="sm" variant="warning" onClick={() => setAction({ step: s, kind: 'SEND_BACK' })}>Send back</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAction({ step: s, kind: 'DELEGATE' })}>Delegate</Button>
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
        title={`${titleCase(action?.kind ?? '')} — ${action?.step.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              variant={action?.kind === 'REJECT' ? 'danger' : action?.kind === 'SEND_BACK' ? 'warning' : 'primary'}
              loading={act.isPending}
              disabled={(['REJECT', 'SEND_BACK'].includes(action?.kind ?? '') && !comment.trim()) || (action?.kind === 'DELEGATE' && !delegateTo)}
              onClick={() => act.mutate()}
            >
              Confirm {titleCase(action?.kind ?? '')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <p className="text-ink-secondary">
            {detail.invoice.invoiceNumber} · {detail.invoice.vendorName} · <span className="font-semibold">{fmtMoney(detail.invoice.amount, detail.invoice.currency)}</span>
          </p>
          {action?.kind === 'DELEGATE' && (
            <FormField label="Delegate to" required>
              <DelegateSelect value={delegateTo} onChange={setDelegateTo} />
            </FormField>
          )}
          <FormField label={['REJECT', 'SEND_BACK'].includes(action?.kind ?? '') ? 'Reason (mandatory)' : 'Comment (optional)'} required={['REJECT', 'SEND_BACK'].includes(action?.kind ?? '')}>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={action?.kind === 'REJECT' ? 'Why is this invoice being rejected?' : 'Add context for the audit trail'} />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

function DelegateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [users, setUsers] = useState<{ id: string; name: string; title: string; enabled: boolean }[]>([]);
  useEffect(() => {
    api.get<{ users: { id: string; name: string; title: string; enabled: boolean }[] }>('/lookups').then((r) => setUsers(r.users.filter((u) => u.enabled)));
  }, []);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
      <option value="">Select a user…</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.name} — {u.title}</option>
      ))}
    </Select>
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
              <Badge tone="neutral">{t.event}</Badge>
              {t.reference && <span className="font-mono text-2xs text-ink-muted">{t.reference}</span>}
            </div>
            {t.detail && <p className="mt-0.5 text-xs text-ink-secondary">{t.detail}</p>}
            <p className="mt-0.5 flex items-center gap-2 text-2xs text-ink-faint">
              {t.actorType === 'USER' ? <User2 size={11} /> : <GitBranch size={11} />} {t.actorName} · {fmtDateTime(t.at)}
              {t.correlationId && <span className="font-mono">· {t.correlationId}</span>}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------- Audit
export function AuditTab({ events }: { events: AuditRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card title="Audit trail (append-only)" pad={false}>
      <div className="divide-y divide-line-soft">
        {events.length === 0 && <p className="py-8 text-center text-xs text-ink-muted">No audit events for this invoice yet.</p>}
        {events.map((a) => (
          <div key={a.id} className="px-4 py-2">
            <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
              <span className="w-32 shrink-0 text-2xs text-ink-muted">{fmtDateTime(a.eventTime)}</span>
              <Badge tone="neutral">{a.category}</Badge>
              <span className="text-xs font-medium">{titleCase(a.eventType)}</span>
              <span className="text-2xs text-ink-muted">{a.actorName}</span>
              <StatusBadge value={a.result} />
              <ChevronDown size={13} className={clsx('ml-auto text-ink-faint transition-transform', expanded === a.id && 'rotate-180')} />
            </button>
            {expanded === a.id && (
              <div className="mt-2 grid gap-2 rounded-md bg-canvas p-2.5 text-2xs md:grid-cols-2">
                <p><span className="text-ink-muted">Entity:</span> {a.entityType} {a.entityRef ? `· ${a.entityRef}` : ''}</p>
                <p><span className="text-ink-muted">Source:</span> {a.source} · <span className="font-mono">{a.correlationId}</span></p>
                {a.reason && <p className="md:col-span-2"><span className="text-ink-muted">Reason:</span> {a.reason}</p>}
                {a.oldValue != null && <p className="break-all"><span className="text-ink-muted">Before:</span> <span className="font-mono">{JSON.stringify(a.oldValue)}</span></p>}
                {a.newValue != null && <p className="break-all"><span className="text-ink-muted">After:</span> <span className="font-mono">{JSON.stringify(a.newValue)}</span></p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
