/**
 * Screens 12 + 13 — SLA Runtime Monitor with dashboard widgets.
 *
 * Live view of the SLA instances running against real invoices, approval
 * steps and document requests. The widgets (Open SLA, Due Today, At Risk,
 * Breached, Waiting Vendor, Approval Breach) drill into the same list.
 * Reads runtime data only — it never changes a policy. Every instance shows
 * the exact policy version it was resolved with.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Clock, Hourglass, ListFilter, RotateCcw, Search, ShieldAlert, Truck } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, DataTable, Drawer, ErrorState, InfoTip, Input, KeyValue, LoadingState, PageHeader, Select, Tooltip, type Column } from '@/components/ui';
import { FilterField, ProposedNote, RuntimeStatusBadge, SLA_BREADCRUMB, SlaSectionNav, label, remainingLabel, useSlaMeta, type SlaInstance } from './shared';

interface MonitorResponse {
  summary: {
    open: number; dueToday: number; atRisk: number; breached: number; paused: number; pending: number; waitingVendor: number; approvalBreach: number;
    completedWithinSla: number; completed: number; byStage: Record<string, number>; byCategory: Record<string, number>; byPolicy: Record<string, number>; byOwner: Record<string, number>;
  };
  items: SlaInstance[];
  generatedAt: string;
}

const FILTER_KEYS = ['q', 'status', 'stage', 'policy', 'owner', 'objectType', 'dueFrom', 'dueTo', 'includeClosed', 'widget'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const OBJECT_LABEL: Record<SlaInstance['objectType'], string> = { INVOICE: 'Invoice', WORKFLOW_STEP: 'Approval step', DOCUMENT_REQUEST: 'Document request' };

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'neutral';
function Widget({ label: text, value, caption, icon, tone = 'neutral', active, onClick, tip }: { label: string; value: number; caption: string; icon: React.ReactNode; tone?: Tone; active?: boolean; onClick: () => void; tip: string }) {
  const color: Record<Tone, string> = { green: 'text-essa-700', red: 'text-semantic-error', amber: 'text-semantic-warning', blue: 'text-semantic-info', neutral: 'text-ink' };
  const chip: Record<Tone, string> = { green: 'bg-essa-50 text-essa-600', red: 'bg-semantic-errorBg text-semantic-error', amber: 'bg-semantic-warningBg text-semantic-warning', blue: 'bg-semantic-infoBg text-semantic-info', neutral: 'bg-canvas text-ink-muted' };
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={clsx('group flex h-full min-w-0 cursor-pointer flex-col justify-between rounded-xl border bg-white p-3 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-essa-300 hover:shadow-pop focus-visible:outline-2', active ? 'border-essa-500 ring-2 ring-essa-100' : 'border-line')}>
      <div className="flex items-start justify-between gap-1.5">
        <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">{text} <InfoTip title={text} meaning={tip} action="Click to filter the list below." /></span>
        <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', chip[tone])}>{icon}</span>
      </div>
      <div className="mt-2"><p className={clsx('text-[22px] font-bold leading-none', color[tone])}>{value}</p><p className="mt-1 truncate text-2xs text-ink-muted">{caption}</p></div>
    </div>
  );
}

export default function SlaMonitorPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: FilterKey) => params.get(k) ?? '';
  const meta = useSlaMeta();
  const [draft, setDraft] = useState<Record<FilterKey, string>>(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<FilterKey, string>);
  const [selected, setSelected] = useState<SlaInstance | null>(null);

  // Widgets are a preset over the same filters, so the list and the tile can never disagree.
  const widget = get('widget');
  const widgetFilter = (w: string): Record<string, string> => {
    switch (w) {
      case 'dueToday': return { dueFrom: new Date().toISOString().slice(0, 10), dueTo: new Date().toISOString().slice(0, 10) };
      case 'atRisk': return { status: 'WARNING' };
      case 'breached': return { status: 'BREACHED' };
      case 'waitingVendor': return { objectType: 'DOCUMENT_REQUEST' };
      case 'approvalBreach': return { objectType: 'WORKFLOW_STEP', status: 'BREACHED' };
      default: return {};
    }
  };
  const query = { q: get('q'), status: get('status'), stage: get('stage'), policy: get('policy'), owner: get('owner'), objectType: get('objectType'), dueFrom: get('dueFrom'), dueTo: get('dueTo'), includeClosed: get('includeClosed'), ...widgetFilter(widget) };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sla-monitor', query],
    queryFn: () => api.get<MonitorResponse>(`/sla/monitor${qs(query)}`),
    refetchInterval: 60_000,
  });

  const apply = (extra: Partial<Record<FilterKey, string>> = {}) => {
    const next = new URLSearchParams();
    const merged = { ...draft, ...extra };
    for (const k of FILTER_KEYS) if (merged[k]) next.set(k, merged[k]);
    setParams(next);
    setDraft(merged);
  };
  const reset = () => { const empty = Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<FilterKey, string>; setDraft(empty); setParams(new URLSearchParams()); };
  const setWidget = (w: string) => apply({ widget: widget === w ? '' : w, status: '', objectType: '', dueFrom: '', dueTo: '' });

  const policies = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.policyCode))].sort(), [data?.items]);
  const owners = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.owner))].sort(), [data?.items]);
  const m = meta.data;

  const columns: Column<SlaInstance>[] = [
    {
      key: 'reference', header: 'Invoice / Ref', sortable: true, value: (i) => i.reference,
      render: (i) => (
        <span className="flex flex-col">
          {i.invoiceId ? <Link to={`/invoices/${i.invoiceId}`} className="text-xs font-semibold text-essa-700 hover:underline" onClick={(e) => e.stopPropagation()}>{i.reference}</Link> : <span className="text-xs font-semibold">{i.reference}</span>}
          <span className="text-2xs text-ink-muted">{OBJECT_LABEL[i.objectType]}{i.vendorName ? ` · ${i.vendorName}` : ''}</span>
        </span>
      ),
    },
    {
      key: 'policy', header: 'SLA Policy', sortable: true, value: (i) => i.policyCode,
      render: (i) => (
        <span className="flex flex-col">
          <Link to={i.policyId ? `/admin/sla/policies/${i.policyId}` : '/admin/sla'} className="font-mono text-2xs font-semibold text-essa-700 hover:underline" onClick={(e) => e.stopPropagation()}>{i.policyCode}</Link>
          <span className="text-2xs text-ink-muted">v{i.policyVersion} · {label(m?.stages, i.stage)}</span>
        </span>
      ),
    },
    { key: 'owner', header: 'Owner', sortable: true, value: (i) => i.owner, render: (i) => <span className="text-xs">{label(m?.recipients, i.owner)}</span> },
    { key: 'startedAt', header: 'Started', sortable: true, value: (i) => i.startedAt, render: (i) => <span className="whitespace-nowrap text-xs">{fmtDateTime(i.startedAt)}</span> },
    {
      key: 'dueAt', header: 'Due', sortable: true, value: (i) => i.dueAt ?? '',
      render: (i) => i.dueAt ? <span className="whitespace-nowrap text-xs">{fmtDateTime(i.dueAt)}</span> : <Tooltip text={i.note ?? 'No active policy'}><span className="text-2xs italic text-ink-faint">Pending config</span></Tooltip>,
    },
    { key: 'status', header: 'Status', sortable: true, value: (i) => i.status, render: (i) => <RuntimeStatusBadge status={i.status} meta={m} /> },
    {
      key: 'remaining', header: 'Remaining / Breach', align: 'right', sortable: true, value: (i) => i.remainingMs ?? Number.MAX_SAFE_INTEGER,
      render: (i) => {
        if (i.status === 'PENDING') return <Tooltip text={i.note ?? 'Waiting for an active policy'}><span className="text-2xs text-amber-700">{i.note?.includes('confirm') ? 'Tax SLA TBC' : 'Not started'}</span></Tooltip>;
        if (i.remainingMs == null) return <span className="text-2xs text-ink-faint">—</span>;
        return <span className={clsx('whitespace-nowrap text-xs font-semibold', i.remainingMs < 0 ? 'text-semantic-error' : i.status === 'WARNING' ? 'text-semantic-warning' : 'text-ink')}>{remainingLabel(i.remainingMs)}</span>;
      },
    },
  ];

  const hasFilters = FILTER_KEYS.some((k) => get(k));

  return (
    <div className="space-y-3">
      <PageHeader breadcrumb={[...SLA_BREADCRUMB, { label: 'SLA Instances / Monitor' }]} title="SLA Runtime Monitor" description="Operational view of the SLA instances created for invoices, approvals and document requests. Reads runtime data only — it does not change any policy." />
      <SlaSectionNav active="monitor" />

      {isLoading && !data ? <LoadingState /> : isError || !data ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} /> : (
        <>
          {/* --------------------------------------------- Screen 13 widgets */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <Widget label="Open SLA" value={data.summary.open} caption="active timers" icon={<Clock size={13} />} tone="green" active={widget === 'open'} onClick={() => setWidget('open')} tip="Every SLA instance that is pending, running, in warning, paused or breached." />
            <Widget label="Due Today" value={data.summary.dueToday} caption="prioritise current-day work" icon={<CalendarClock size={13} />} tone="blue" active={widget === 'dueToday'} onClick={() => setWidget('dueToday')} tip="Open instances whose due time falls today and that have not breached yet." />
            <Widget label="At Risk" value={data.summary.atRisk} caption="inside warning threshold" icon={<Hourglass size={13} />} tone="amber" active={widget === 'atRisk'} onClick={() => setWidget('atRisk')} tip="Open instances inside the policy's Warning Before Breach threshold." />
            <Widget label="Breached" value={data.summary.breached} caption="immediate action required" icon={<AlertTriangle size={13} />} tone="red" active={widget === 'breached'} onClick={() => setWidget('breached')} tip="Instances whose due time has passed without completion. The same count as the SLA Breached tile on the dashboard for invoices." />
            <Widget label="Waiting Vendor" value={data.summary.waitingVendor} caption="missing-document SLA subset" icon={<Truck size={13} />} tone="neutral" active={widget === 'waitingVendor'} onClick={() => setWidget('waitingVendor')} tip="Open missing-document requests on the vendor-response clock." />
            <Widget label="Approval Breach" value={data.summary.approvalBreach} caption="workflow SLA subset" icon={<ShieldAlert size={13} />} tone="red" active={widget === 'approvalBreach'} onClick={() => setWidget('approvalBreach')} tip="Approval steps that have passed their response SLA and escalated." />
          </div>

          {/* breakdowns */}
          <div className="grid gap-2.5 md:grid-cols-3">
            <Breakdown title="By stage" data={Object.fromEntries(Object.entries(data.summary.byStage).map(([k, v]) => [label(m?.stages, k), v]))} />
            <Breakdown title="By invoice category" data={data.summary.byCategory} />
            <Breakdown title="By SLA policy" data={data.summary.byPolicy} mono />
          </div>

          <Card pad={false}>
            <form className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3" onSubmit={(e) => { e.preventDefault(); apply(); }}>
              <FilterField label="Search" className="min-w-44 grow basis-44">
                <span className="relative block">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="Invoice, reference, vendor, policy" className="w-full pl-8" aria-label="Search SLA instances" />
                </span>
              </FilterField>
              <FilterField label="Status">
                <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value, widget: '' }))} aria-label="Status filter" className="w-32">
                  <option value="">Any status</option>
                  {(m?.runtimeStatuses ?? []).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </Select>
              </FilterField>
              <FilterField label="Stage">
                <Select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))} aria-label="Stage filter" className="w-40">
                  <option value="">Any stage</option>
                  {(m?.stages ?? []).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </Select>
              </FilterField>
              <FilterField label="Owner / Team">
                <Select value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} aria-label="Owner filter" className="w-40">
                  <option value="">Any owner</option>
                  {owners.map((o) => <option key={o} value={o}>{label(m?.recipients, o)}</option>)}
                </Select>
              </FilterField>
              <FilterField label="Policy">
                <Select value={draft.policy} onChange={(e) => setDraft((d) => ({ ...d, policy: e.target.value }))} aria-label="Policy filter" className="w-52">
                  <option value="">Any policy</option>
                  {policies.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </FilterField>
              <FilterField label="Due Date">
                <span className="flex items-center gap-1.5 text-2xs text-ink-muted">
                  <Input type="date" className="!h-9 w-32" value={draft.dueFrom} onChange={(e) => setDraft((d) => ({ ...d, dueFrom: e.target.value, widget: '' }))} aria-label="Due from" />–
                  <Input type="date" className="!h-9 w-32" value={draft.dueTo} onChange={(e) => setDraft((d) => ({ ...d, dueTo: e.target.value, widget: '' }))} aria-label="Due to" />
                </span>
              </FilterField>
              <FilterField label="Closed clocks">
                <label className="flex h-9 items-center gap-1.5 text-xs text-ink-secondary"><input type="checkbox" checked={draft.includeClosed === 'true'} onChange={(e) => setDraft((d) => ({ ...d, includeClosed: e.target.checked ? 'true' : '' }))} /> Include completed / cancelled</label>
              </FilterField>
              <span className="ml-auto flex items-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={!hasFilters}><RotateCcw size={13} /> Reset</Button>
                <Button type="submit" size="sm"><ListFilter size={13} /> Apply Filters</Button>
              </span>
            </form>
            <DataTable columns={columns} rows={data.items} rowKey={(i) => i.id} dense onRowClick={setSelected} empty={<p className="py-8 text-center text-xs text-ink-muted">No SLA instances match these filters.</p>} />
            <p className="border-t border-line-soft px-3 py-2 text-2xs text-ink-muted">{data.items.length} instance{data.items.length === 1 ? '' : 's'} · calculated {fmtDateTime(data.generatedAt)} · refreshes every minute. Click a row for its start / due time, reminder, pause and escalation history.</p>
          </Card>

          <ProposedNote tone="info"><span className="font-semibold">Runtime statuses.</span> {(m?.runtimeStatuses ?? []).map((s) => <span key={s.code} className="mr-2 inline-flex items-center gap-1"><Badge tone={s.code === 'BREACHED' ? 'error' : s.code === 'WARNING' ? 'warning' : s.code === 'COMPLETED' ? 'success' : s.code === 'RUNNING' ? 'info' : s.code === 'PENDING' ? 'draft' : 'neutral'}>{s.label}</Badge><span className="text-ink-muted">{s.hint}</span></span>)} Any authorised manual pause / resume or correction is permissioned and audited.</ProposedNote>
        </>
      )}

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `SLA instance — ${selected.reference}` : ''}>
        {selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3">
              <KeyValue label="Object">{OBJECT_LABEL[selected.objectType]}{selected.invoiceId && <> · <Link to={`/invoices/${selected.invoiceId}`} className="text-essa-700 hover:underline">{selected.invoiceNumber}</Link></>}</KeyValue>
              <KeyValue label="Status"><RuntimeStatusBadge status={selected.status} meta={m} /></KeyValue>
              <KeyValue label="SLA Policy"><span className="font-mono text-xs">{selected.policyCode}</span> <span className="text-2xs text-ink-muted">v{selected.policyVersion}</span><span className="block text-2xs text-ink-muted">{selected.policyName}</span></KeyValue>
              <KeyValue label="Stage">{label(m?.stages, selected.stage)}</KeyValue>
              <KeyValue label="Owner">{label(m?.recipients, selected.owner)}</KeyValue>
              <KeyValue label="Category">{selected.categoryName ?? '—'}</KeyValue>
              <KeyValue label="Started">{fmtDateTime(selected.startedAt)}</KeyValue>
              <KeyValue label="Due">{selected.dueAt ? fmtDateTime(selected.dueAt) : <span className="italic text-ink-faint">Pending configuration</span>}</KeyValue>
              <KeyValue label="Warning from">{selected.warningAt ? fmtDateTime(selected.warningAt) : '—'}</KeyValue>
              <KeyValue label="Remaining / Breach">{selected.status === 'PENDING' ? '—' : remainingLabel(selected.remainingMs)}</KeyValue>
            </dl>
            {selected.note && <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink-secondary">{selected.note}</p>}
            <div>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-secondary">Event history</h3>
              <ol className="space-y-1.5 border-l border-line pl-3">
                {selected.events.map((e, i) => (
                  <li key={i} className="relative text-xs">
                    <span className={clsx('absolute -left-[17px] top-1.5 h-2 w-2 rounded-full', e.type === 'BREACHED' ? 'bg-semantic-error' : e.type === 'ESCALATED' || e.type === 'WARNING' ? 'bg-semantic-warning' : e.type === 'COMPLETED' ? 'bg-semantic-success' : 'bg-essa-500')} />
                    <span className="font-semibold">{e.type.charAt(0) + e.type.slice(1).toLowerCase()}</span> <span className="text-ink-muted">{fmtDateTime(e.at)}</span>
                    <span className="block text-ink-secondary">{e.detail}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-2xs text-ink-muted">Events are STARTED / WARNING / REMINDER / PAUSED / RESUMED / ESCALATED / COMPLETED / BREACHED, retained with the policy version so the SLA decision can be reconstructed later.</p>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Breakdown({ title, data, mono }: { title: string; data: Record<string, number>; mono?: boolean }) {
  const rows = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-xs text-ink-muted">No open instances.</p> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 6).map(([k, v]) => (
            <li key={k} className="flex items-center gap-2 text-xs">
              <span className={clsx('w-40 shrink-0 truncate', mono && 'font-mono text-2xs')} title={k}>{k}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-essa-500" style={{ width: `${(v / max) * 100}%` }} /></span>
              <span className="w-6 text-right font-semibold">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
