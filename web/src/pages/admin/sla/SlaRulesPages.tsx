/**
 * Reminder Rules and Escalation Rules navigation items (spec §1.2).
 *
 * Reminder and escalation rules belong to a policy version, so these two
 * screens are cross-policy views: every rule the platform will apply, with a
 * link into the policy tab where it is edited. Only the version in force (or
 * the latest draft when nothing is published) is listed.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, DataTable, LoadingState, PageHeader, type Column } from '@/components/ui';
import { PolicyStatusBadge, ProposedNote, SLA_BREADCRUMB, SlaSectionNav, durationLabel, label, scopeLabel, useSlaMeta, useSlaPolicies, type SlaPolicy, type SlaReminderRule } from './shared';

/** One row per SLA code: the version in force, else the latest draft. */
function useEffectivePolicies() {
  const q = useSlaPolicies();
  const effective = useMemo(() => {
    const byCode = new Map<string, SlaPolicy[]>();
    for (const p of q.data?.policies ?? []) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
    return [...byCode.values()].map((vs) => vs.find((v) => v.status === 'ACTIVE') ?? vs.sort((a, b) => b.version - a.version).find((v) => v.status !== 'RETIRED') ?? vs[0]);
  }, [q.data]);
  return { ...q, effective };
}

interface ReminderRow { policy: SlaPolicy; rule: SlaReminderRule }

export function ReminderRulesPage() {
  const meta = useSlaMeta();
  const { effective, isLoading } = useEffectivePolicies();
  if (isLoading || !meta.data) return <LoadingState />;
  const m = meta.data;
  const rows: ReminderRow[] = effective.flatMap((policy) => policy.reminders.map((rule) => ({ policy, rule })));
  const columns: Column<ReminderRow>[] = [
    { key: 'policy', header: 'SLA Policy', sortable: true, value: (r) => r.policy.code, render: (r) => <Link to={`/admin/sla/policies/${r.policy.id}?tab=reminders`} className="font-mono text-2xs font-semibold text-essa-700 hover:underline">{r.policy.code}</Link> },
    { key: 'scope', header: 'Scope', sortable: true, value: (r) => scopeLabel(r.policy, m), render: (r) => <span className="text-xs">{scopeLabel(r.policy, m)}</span> },
    { key: 'seq', header: '#', align: 'center', sortable: true, value: (r) => r.rule.seq, render: (r) => <span className="text-xs font-semibold">{r.rule.seq}</span> },
    { key: 'after', header: 'Trigger After', sortable: true, value: (r) => r.rule.after.value * (r.rule.after.unit.includes('HOUR') ? 1 : 24), render: (r) => <span className="whitespace-nowrap text-xs">{r.rule.after.value === 0 ? 'Immediately' : durationLabel(r.rule.after)}{r.rule.repeat && <span className="ml-1 text-2xs text-ink-muted">(repeats)</span>}</span> },
    { key: 'recipient', header: 'Recipient', sortable: true, value: (r) => label(m.recipients, r.rule.recipient), render: (r) => <span className="text-xs">{label(m.recipients, r.rule.recipient)}</span> },
    { key: 'channel', header: 'Channel', value: (r) => r.rule.channels.join(', '), render: (r) => <span className="text-xs">{r.rule.channels.map((c) => label(m.channels, c)).join(', ')}</span> },
    { key: 'template', header: 'Template', sortable: true, value: (r) => r.rule.template, render: (r) => <span className="text-xs text-ink-secondary">{r.rule.template}</span> },
    { key: 'enabled', header: 'Enabled', sortable: true, value: (r) => (r.rule.enabled ? 'Yes' : 'No'), render: (r) => <Badge tone={r.rule.enabled ? 'success' : 'neutral'}>{r.rule.enabled ? 'Yes' : 'No'}</Badge> },
    { key: 'status', header: 'Policy Status', sortable: true, value: (r) => r.policy.status, render: (r) => <PolicyStatusBadge status={r.policy.status} /> },
  ];
  return (
    <div className="space-y-3">
      <PageHeader breadcrumb={[...SLA_BREADCRUMB, { label: 'Reminder Rules' }]} title="Reminder Rules" description="Every reminder the scheduler will send while an SLA is open, across all policies. Edit a rule from its policy's Reminder Rules tab." />
      <SlaSectionNav active="reminders" />
      <ProposedNote tone="info">Approval reminders at 24h, 48h, 3 days and 5 days; missing-document follow-up every 7 days. Intervals are configurable here without a code change.</ProposedNote>
      <Card pad={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.policy.id}-${r.rule.id}`} dense empty={<p className="py-8 text-center text-xs text-ink-muted">No reminder rules configured.</p>} />
      </Card>
    </div>
  );
}

export function EscalationRulesPage() {
  const meta = useSlaMeta();
  const { effective, isLoading } = useEffectivePolicies();
  if (isLoading || !meta.data) return <LoadingState />;
  const m = meta.data;
  const rows = effective.filter((p) => p.escalation.enabled || p.scopeType !== 'INVOICE_CATEGORY');
  const columns: Column<SlaPolicy>[] = [
    { key: 'code', header: 'SLA Policy', sortable: true, value: (p) => p.code, render: (p) => <Link to={`/admin/sla/policies/${p.id}?tab=escalation`} className="font-mono text-2xs font-semibold text-essa-700 hover:underline">{p.code}</Link> },
    { key: 'scope', header: 'Scope', sortable: true, value: (p) => scopeLabel(p, m), render: (p) => <span className="text-xs">{scopeLabel(p, m)}</span> },
    { key: 'condition', header: 'Breach Condition', sortable: true, value: (p) => label(m.breachConditions, p.escalation.breachCondition), render: (p) => <span className="text-xs">{p.escalation.enabled ? label(m.breachConditions, p.escalation.breachCondition) : <span className="text-ink-faint">Escalation off</span>}</span> },
    { key: 'primary', header: 'Primary Escalation', sortable: true, value: (p) => label(m.escalationTargets, p.escalation.primaryTarget), render: (p) => <span className="text-xs font-medium">{p.escalation.enabled ? label(m.escalationTargets, p.escalation.primaryTarget) : '—'}</span> },
    { key: 'fallback', header: 'Fallback if No Next Level', sortable: true, value: (p) => label(m.escalationTargets, p.escalation.fallbackTarget), render: (p) => <span className="text-xs">{p.escalation.enabled ? label(m.escalationTargets, p.escalation.fallbackTarget) : '—'}</span> },
    { key: 'channels', header: 'Channels', value: (p) => p.escalation.channels.join(', '), render: (p) => <span className="text-xs">{p.escalation.enabled ? p.escalation.channels.map((c) => label(m.channels, c)).join(', ') : '—'}</span> },
    { key: 'audit', header: 'Audit Event', align: 'center', value: (p) => (p.escalation.createAuditEvent ? 'Yes' : 'No'), render: (p) => <Badge tone={p.escalation.createAuditEvent ? 'success' : 'neutral'}>{p.escalation.createAuditEvent ? 'Yes' : 'No'}</Badge> },
    { key: 'flag', header: 'Breach Flag', align: 'center', value: (p) => (p.escalation.createBreachFlag ? 'Yes' : 'No'), render: (p) => <Badge tone={p.escalation.createBreachFlag ? 'success' : 'neutral'}>{p.escalation.createBreachFlag ? 'Yes' : 'No'}</Badge> },
    { key: 'status', header: 'Policy Status', sortable: true, value: (p) => p.status, render: (p) => <PolicyStatusBadge status={p.status} /> },
  ];
  return (
    <div className="space-y-3">
      <PageHeader breadcrumb={[...SLA_BREADCRUMB, { label: 'Escalation Rules' }]} title="Escalation Rules" description="What EAPA does when an SLA threshold is breached or a reminder sequence is exhausted. Edit a rule from its policy's Escalation Rules tab." />
      <SlaSectionNav active="escalations" />
      <ProposedNote tone="info">
        Approval escalates to the next approval level after the final reminder, and to the AP Supervisor when no higher level exists; missing-document chase escalates to the Head of Function after the first unanswered reminder. Escalation is never an automatic approval.
      </ProposedNote>
      <Card pad={false}>
        <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} dense empty={<p className="py-8 text-center text-xs text-ink-muted">No escalation rules configured.</p>} />
        <p className="border-t border-line-soft px-3 py-2 text-2xs text-ink-muted">Stage-turnaround policies with escalation switched off (e.g. Payment) are not listed. Open any policy to enable it.</p>
      </Card>
    </div>
  );
}
