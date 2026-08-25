/**
 * Screen 1 — SLA Management list.
 *
 * One row per SLA code, showing the version that is in force (or the latest
 * draft when nothing is published). Search, scope / stage / status filters,
 * Create SLA, View, Edit (opens the draft, or offers a new version when the
 * policy is active), Clone and History.
 *
 * This screen never starts or stops a clock — it only manages the
 * configuration used when a qualifying event occurs.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, GitBranch, History, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, Tooltip, useToast, type Column } from '@/components/ui';
import {
  FilterField, PolicyStatusBadge, ProposedNote, SLA_BREADCRUMB, SlaSectionNav, label, scopeLabel, targetLabel,
  useSlaMeta, useSlaPolicies, type SlaPolicy,
} from './shared';

interface ListRow { policy: SlaPolicy; versions: SlaPolicy[]; draft?: SlaPolicy; live?: SlaPolicy }

export default function SlaPoliciesPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useSlaMeta();
  const { data, isLoading } = useSlaPolicies();

  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const [cloning, setCloning] = useState<{ source: SlaPolicy; code: string; name: string } | null>(null);
  const [history, setHistory] = useState<ListRow | null>(null);

  const rows = useMemo<ListRow[]>(() => {
    const byCode = new Map<string, SlaPolicy[]>();
    for (const p of data?.policies ?? []) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
    return [...byCode.values()].map((versions) => {
      versions.sort((a, b) => b.version - a.version);
      const live = versions.find((v) => v.status === 'ACTIVE');
      const draft = versions.find((v) => v.status === 'DRAFT' || v.status === 'TEST');
      return { policy: live ?? draft ?? versions[0], versions, draft, live };
    });
  }, [data?.policies]);

  const filtered = rows.filter((r) => {
    const p = r.policy;
    if (scope && p.scopeType !== scope) return false;
    if (stage && p.stage !== stage) return false;
    if (status && !r.versions.some((v) => v.status === status)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (![p.code, p.name, p.description ?? ''].some((v) => v.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const clone = useMutation({
    mutationFn: (p: { id: string; code: string; name: string }) => api.post<{ policy: SlaPolicy }>(`/sla/policies/${p.id}/clone`, { code: p.code, name: p.name }),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: 'Policy cloned', detail: `${r.policy.code} created as a draft.` });
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      setCloning(null);
      navigate(`/admin/sla/policies/${r.policy.id}`);
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Clone failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const newVersion = useMutation({
    mutationFn: (id: string) => api.post<{ policy: SlaPolicy }>(`/sla/policies/${id}/new-version`, {}),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: `Draft v${r.policy.version} created`, detail: 'The active version stays in force until this draft is published.' });
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      navigate(`/admin/sla/policies/${r.policy.id}`);
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not create a new version', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !data || !meta.data) return <LoadingState />;
  const m = meta.data;

  const columns: Column<ListRow>[] = [
    {
      key: 'code', header: 'SLA Code', sortable: true, value: (r) => r.policy.code,
      render: (r) => (
        <Link to={`/admin/sla/policies/${r.policy.id}`} className="font-mono text-2xs font-semibold text-essa-700 hover:underline">{r.policy.code}</Link>
      ),
    },
    {
      key: 'name', header: 'SLA Name', sortable: true, value: (r) => r.policy.name,
      render: (r) => <span className="text-xs font-medium" title={r.policy.description}>{r.policy.name}</span>,
    },
    { key: 'scope', header: 'Scope', sortable: true, value: (r) => scopeLabel(r.policy, m), render: (r) => <span className="text-xs">{scopeLabel(r.policy, m)}</span> },
    { key: 'stage', header: 'Stage', sortable: true, value: (r) => label(m.stages, r.policy.stage), render: (r) => <span className="text-xs">{label(m.stages, r.policy.stage)}</span> },
    {
      key: 'target', header: 'Target', sortable: true, value: (r) => r.policy.timer.duration ?? -1,
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1 whitespace-nowrap text-xs">
          {r.policy.timer.duration == null ? <span className="text-2xs text-ink-faint">Not applicable</span> : <span className="font-medium">{targetLabel(r.policy)}</span>}
          {r.policy.provisional && (
            <Tooltip text={r.policy.provisionalNote ?? 'Value still to be confirmed by ESSA.'}>
              <Badge tone="warning">TBC</Badge>
            </Tooltip>
          )}
          {r.policy.timer.duration != null && !r.policy.timer.unitConfirmed && (
            <Tooltip text="The BPD does not state whether SLA values are calendar or business days. Confirm the unit with ESSA before production use.">
              <span className="whitespace-nowrap text-2xs text-amber-700">unit TBC</span>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      key: 'effective', header: 'Effective From', sortable: true, value: (r) => r.policy.effectiveFrom,
      render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.policy.effectiveFrom)}</span>,
    },
    {
      key: 'status', header: 'Status', sortable: true, value: (r) => r.policy.status,
      render: (r) => (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <PolicyStatusBadge status={r.policy.status} />
          <span className="text-2xs text-ink-muted">v{r.policy.version}</span>
          {r.live && r.draft && (
            <Tooltip text={`A draft v${r.draft.version} is being prepared while v${r.live.version} stays in force.`}>
              <Badge tone="draft">Draft v{r.draft.version}</Badge>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'center', sticky: true,
      render: (r) => (
        <div className="flex justify-center gap-0.5">
          <Button size="sm" variant="ghost" aria-label={`View ${r.policy.code}`} title="View" onClick={() => navigate(`/admin/sla/policies/${r.policy.id}`)}><Eye size={13} /></Button>
          {canEdit && (
            r.draft ? (
              <Button size="sm" variant="ghost" aria-label={`Edit draft of ${r.policy.code}`} title={`Edit draft v${r.draft.version}`} onClick={() => navigate(`/admin/sla/policies/${r.draft!.id}`)}><Pencil size={13} /></Button>
            ) : (
              <Button size="sm" variant="ghost" aria-label={`Create a new version of ${r.policy.code}`} title="Create a new draft version (the active version is never edited in place)" loading={newVersion.isPending && newVersion.variables === r.policy.id} onClick={() => newVersion.mutate(r.policy.id)}><GitBranch size={13} /></Button>
            )
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" aria-label={`Clone ${r.policy.code}`} title="Clone into a new policy" onClick={() => setCloning({ source: r.policy, code: `${r.policy.code}_COPY`, name: `${r.policy.name} (copy)` })}><Copy size={13} /></Button>
          )}
          <Button size="sm" variant="ghost" aria-label={`Version history of ${r.policy.code}`} title="Version history" onClick={() => setHistory(r)}><History size={13} /></Button>
        </div>
      ),
    },
  ];

  const hasFilters = Boolean(search || scope || stage || status);

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[...SLA_BREADCRUMB.slice(0, 2), { label: 'SLA Management' }]}
        title="SLA Management"
        description="Search, filter, create, clone, activate and retire SLA policies. Policies define the rule; runtime clocks are created when a qualifying invoice, approval or document event occurs."
        actions={canEdit ? <Button onClick={() => navigate('/admin/sla/policies/new')}><Plus size={14} /> Create SLA</Button> : undefined}
      />
      <SlaSectionNav active="policies" />

      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3" onSubmit={(e) => e.preventDefault()}>
          <FilterField label="Search" className="min-w-44 grow basis-44">
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by SLA code or name" className="w-full pl-8" aria-label="Search SLA policies" />
            </span>
          </FilterField>
          <FilterField label="Type / Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope filter" className="w-44">
              <option value="">Any scope</option>
              {m.scopeTypes.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage filter" className="w-40">
              <option value="">Any stage</option>
              {m.stages.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter" className="w-32">
              <option value="">Any status</option>
              <option value="DRAFT">Draft</option>
              <option value="TEST">Tested</option>
              <option value="ACTIVE">Active</option>
              <option value="RETIRED">Retired</option>
            </Select>
          </FilterField>
          <span className="ml-auto flex items-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!hasFilters} onClick={() => { setSearch(''); setScope(''); setStage(''); setStatus(''); }}>
              <RotateCcw size={13} /> Reset
            </Button>
          </span>
        </form>
        <DataTable columns={columns} rows={filtered} rowKey={(r) => r.policy.code} dense empty={<p className="py-8 text-center text-xs text-ink-muted">No SLA policies match these filters.</p>} />
        <div className="border-t border-line-soft px-3 py-2 text-2xs text-ink-muted">
          Showing {filtered.length} of {rows.length} policies · Targets marked <span className="font-semibold text-amber-700">TBC</span> are still to be confirmed in the BPD (Tax Team SLA) and stay in Draft until confirmed.
        </div>
      </Card>

      <ProposedNote tone="info">
        <span className="font-semibold">Runtime effect.</span> When the configured trigger event occurs, EAPA resolves the active policy for the invoice's category and stage and creates one runtime SLA instance for it. See <Link to="/admin/sla/monitor" className="text-essa-700 hover:underline">SLA Instances / Monitor</Link> for the clocks running right now.
      </ProposedNote>

      {/* ------------------------------------------------------------ clone */}
      <Modal
        open={Boolean(cloning)}
        onClose={() => setCloning(null)}
        title={`Clone ${cloning?.source.code ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloning(null)}>Cancel</Button>
            <Button loading={clone.isPending} disabled={!cloning?.code.trim() || !cloning?.name.trim()} onClick={() => cloning && clone.mutate({ id: cloning.source.id, code: cloning.code.trim().toUpperCase(), name: cloning.name.trim() })}>Create draft</Button>
          </>
        }
      >
        {cloning && (
          <div className="space-y-3">
            <p className="text-xs text-ink-secondary">Copies the timer, reminders, escalation and pause rules of <span className="font-mono">{cloning.source.code}</span> v{cloning.source.version} into a new Draft policy. Change the scope on the General tab afterwards.</p>
            <Field label="New SLA Code" required hint="Upper-case letters, digits and underscores. Immutable after first publish.">
              <Input value={cloning.code} onChange={(e) => setCloning((c) => c && { ...c, code: e.target.value.toUpperCase() })} className="w-full font-mono" maxLength={50} />
            </Field>
            <Field label="New SLA Name" required>
              <Input value={cloning.name} onChange={(e) => setCloning((c) => c && { ...c, name: e.target.value })} className="w-full" maxLength={120} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ---------------------------------------------------------- history */}
      <Modal open={Boolean(history)} onClose={() => setHistory(null)} title={`Version history — ${history?.policy.code ?? ''}`} wide>
        {history && (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-wide text-ink-muted">
                <th className="py-1.5 pr-3">Version</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5 pr-3">Effective From</th><th className="py-1.5 pr-3">Changed By</th><th className="py-1.5 pr-3">Change Summary</th><th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {history.versions.map((v) => (
                <tr key={v.id} className="border-b border-line-soft">
                  <td className="py-1.5 pr-3 font-semibold">v{v.version}</td>
                  <td className="py-1.5 pr-3"><PolicyStatusBadge status={v.status} /></td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(v.effectiveFrom)}</td>
                  <td className="py-1.5 pr-3">{v.publishedBy ?? v.changedBy}</td>
                  <td className="py-1.5 pr-3 text-ink-secondary">{v.changeSummary || '—'}</td>
                  <td className="py-1.5 text-right"><Link to={`/admin/sla/policies/${v.id}?tab=versions`} className="text-essa-700 hover:underline">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}
