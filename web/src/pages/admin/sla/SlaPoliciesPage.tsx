/**
 * Screen 1 — SLA Management list.
 *
 * One row per SLA code. Versioning was removed from the UI (review, 25 Aug):
 * the user sees and edits a single policy — no version chips, no version
 * history. Search, scope / stage / status filters, Create SLA, View, Edit
 * and Clone.
 *
 * This screen never starts or stops a clock — it only manages the
 * configuration used when a qualifying event occurs.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { Button, Card, ConfirmDialog, DataTable, Input, LoadingState, PageHeader, Select, useToast, type Column } from '@/components/ui';
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
  const [deleting, setDeleting] = useState<ListRow | null>(null);

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

  const del = useMutation({
    mutationFn: (r: ListRow) => Promise.all(r.versions.map((v) => api.post(`/sla/policies/${v.id}/delete`, {}))),
    onSuccess: (_d, r) => {
      toast.push({ tone: 'success', title: 'SLA policy deleted', detail: `${r.policy.code} removed. Existing runtime clocks keep their history.` });
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      setDeleting(null);
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Delete failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
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
        </span>
      ),
    },
    {
      key: 'effective', header: 'Effective From', sortable: true, value: (r) => r.policy.effectiveFrom,
      render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.policy.effectiveFrom)}</span>,
    },
    {
      key: 'status', header: 'Status', sortable: true, value: (r) => r.policy.status,
      render: (r) => <PolicyStatusBadge status={r.policy.status} />,
    },
    {
      key: 'actions', header: 'Actions', align: 'center', sticky: true,
      render: (r) => (
        <div className="flex justify-center gap-0.5">
          {canEdit && (
            <Button size="sm" variant="ghost" aria-label={`Edit ${r.policy.code}`} title="Edit" onClick={() => navigate(`/admin/sla/policies/${(r.draft ?? r.policy).id}`)}><Pencil size={13} /></Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${r.policy.code}`} title="Delete" className="text-semantic-error" onClick={() => setDeleting(r)}><Trash2 size={13} /></Button>
          )}
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
          Showing {filtered.length} of {rows.length} policies
        </div>
      </Card>

      <ProposedNote tone="info">
        <span className="font-semibold">Runtime effect.</span> When the configured trigger event occurs, EAPA resolves the active policy for the invoice's category and stage and creates one runtime SLA instance for it. See <Link to="/admin/sla/monitor" className="text-essa-700 hover:underline">SLA Instances / Monitor</Link> for the clocks running right now.
      </ProposedNote>

      {/* ----------------------------------------------------------- delete */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
        loading={del.isPending}
        tone="danger"
        title={`Delete ${deleting?.policy.code ?? ''}`}
        confirmLabel="Delete policy"
        message={<p className="text-xs">The SLA policy <span className="font-mono font-semibold">{deleting?.policy.code}</span> is removed and no new SLA clocks will be created from it. Existing runtime clocks keep their history. This action is recorded in the Audit Log.</p>}
      />
    </div>
  );
}
