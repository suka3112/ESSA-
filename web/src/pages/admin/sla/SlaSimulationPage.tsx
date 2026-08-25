/**
 * Screen 8 — SLA Test / Simulation (PROPOSED, strongly recommended).
 *
 * Pick any policy version and a representative start date/time; the engine
 * returns the calculated due date, warning, reminders and escalation points
 * using the same calendar, duration and rules the runtime uses. Read-only —
 * nothing is created, sent or changed. Marking a version as tested is done
 * from the policy's own Test tab.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Field, Input, LoadingState, PageHeader, Select, useToast } from '@/components/ui';
import { PolicyStatusBadge, ProposedNote, SLA_BREADCRUMB, SlaSectionNav, label, scopeLabel, targetLabel, useSlaMeta, useSlaPolicies, type SimulationResult } from './shared';
import { SimulationTable } from './SlaPolicyEditor';

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SlaSimulationPage() {
  const toast = useToast();
  const meta = useSlaMeta();
  const { data, isLoading } = useSlaPolicies();
  const [policyId, setPolicyId] = useState('');
  const [startAt, setStartAt] = useState(localNow);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const sorted = useMemo(() => [...(data?.policies ?? [])].sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version), [data?.policies]);
  const policy = sorted.find((p) => p.id === policyId) ?? sorted.find((p) => p.status === 'ACTIVE') ?? sorted[0];
  const calendar = data?.calendars.find((c) => c.id === policy?.timer.calendarId);

  const run = useMutation({
    mutationFn: () => api.post<SimulationResult>('/sla/simulate', { policyId: policy!.id, startAt: new Date(startAt).toISOString() }),
    onSuccess: setResult,
    onError: (e) => toast.push({ tone: 'error', title: 'Simulation failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !meta.data || !policy) return <LoadingState />;
  const m = meta.data;

  return (
    <div className="space-y-3">
      <PageHeader breadcrumb={[...SLA_BREADCRUMB, { label: 'Simulation / Test' }]} title="SLA Policy Test / Simulation" description="Verify expected due dates, reminders and escalation before publishing. Simulation is read-only: no operational SLA instance, notification or invoice change." />
      <SlaSectionNav active="simulation" />
      <ProposedNote tone="info">Simulation is proposed design. It is strongly recommended because SLA calculations become difficult to validate once business calendars, holidays, reminders and pause logic are combined.</ProposedNote>
      <Card title="Simulation input">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <Field label="Policy" required>
            <Select value={policy.id} className="w-80" onChange={(e) => { setPolicyId(e.target.value); setResult(null); }}>
              {sorted.map((p) => <option key={p.id} value={p.id}>{p.code} · v{p.version} ({p.status.toLowerCase()})</option>)}
            </Select>
          </Field>
          <Field label="Start Date/Time" required><Input type="datetime-local" value={startAt} className="w-56" onChange={(e) => setStartAt(e.target.value)} /></Field>
          <Field label="Sample Category"><Input value={scopeLabel(policy, m)} disabled readOnly className="w-48" /></Field>
          <Field label="Calendar"><Input value={calendar ? calendar.name : 'Calendar time (24 hours)'} disabled readOnly className="w-56" /></Field>
          <Button type="submit" loading={run.isPending}><Play size={14} /> Run calculation</Button>
        </form>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-2xs text-ink-muted sm:grid-cols-4">
          <div><span className="font-semibold text-ink-secondary">Status:</span> <PolicyStatusBadge status={policy.status} /></div>
          <div><span className="font-semibold text-ink-secondary">Stage:</span> {label(m.stages, policy.stage)}</div>
          <div><span className="font-semibold text-ink-secondary">Target:</span> {targetLabel(policy)}</div>
          <div><span className="font-semibold text-ink-secondary">Reminders:</span> {policy.reminders.filter((r) => r.enabled).length} · <span className="font-semibold text-ink-secondary">Escalation:</span> {policy.escalation.enabled ? label(m.escalationTargets, policy.escalation.primaryTarget) : 'off'} · <Link to={`/admin/sla/policies/${policy.id}`} className="text-essa-700 hover:underline">Open policy</Link></div>
        </dl>
      </Card>
      {result && <Card title="Calculated timeline" pad={false}><SimulationTable result={result} /></Card>}
    </div>
  );
}
