/**
 * Workflows & Approval Hierarchy.
 *
 * UI/UX review (Aug 2026) §13:
 *  · The approval hierarchy is shown the way the business defines it — an
 *    amount range with the approval role at Level 1 to Level 4. The four level
 *    columns are fixed; rows (amount ranges) can be added and amounts changed.
 *  · "From amount / To amount" are proper columns, not a free-text band.
 *  · No individual approver names anywhere: an approval level belongs to a
 *    role, and whoever holds that role can approve.
 *
 * Review, 24 Aug 2026: Department is not a concept in this platform. Approval
 * authority is decided by the invoice amount band alone, exactly as the DoA
 * table in BPD v0.1.4 §11.2 defines it.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Copy, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayRole, fmtMoney } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, useToast, type Column,
} from '@/components/ui';

interface DoARow { id: string; level: number; role: string; approverUserId: string; approverName: string; minAmount: number; maxAmount: number | null; currency: string; active: boolean }
interface StepDef { stepNo: number; name: string; role: string; approverType: string; amountThresholdMin?: number; taxStep?: boolean; slaHours: number; escalationTo?: string; notify: boolean }
interface WorkflowDef { id: string; code: string; name: string; description: string; categoryId?: string; status: string; version: string; steps: StepDef[] }

/**
 * The approval levels of the DoA hierarchy — BPD v0.1.4 §11.2.
 * HOS = Head of Section · HOD = Head of Department · HOF = Head of Function
 * OSH/STH = Operations & Site Head · GFD = Group Functional Director
 */
const DOA_ROLES = ['HOS', 'HOD', 'HOF', 'OSH_STH', 'GFD'];
/** Roles that can hold a step inside an invoice workflow. */
const APPROVAL_ROLES = ['AP_REVIEWER', 'TAX_REVIEWER'];
const ESCALATION_ROLES = ['', 'AP_REVIEWER', 'ADMINISTRATOR'];
/** The agreed four-level approval structure. */
const LEVELS = [1, 2, 3, 4] as const;

interface StepDraft {
  name: string; role: string; approverType: string; slaHours: number;
  amountThresholdMin: number | null; taxStep: boolean; escalationTo: string; notify: boolean; position: number;
}

/** One amount range with the role configured at each of the four levels. */
interface HierarchyRow {
  key: string;
  minAmount: number;
  maxAmount: number | null;
  active: boolean;
  levels: Record<number, DoARow | undefined>;
}

export default function WorkflowsPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const toast = useToast();
  const qc = useQueryClient();
  const [editingBand, setEditingBand] = useState<{ original?: HierarchyRow; minAmount: number; maxAmount: number | null; levelRoles: Record<number, string> } | null>(null);
  const [deletingBand, setDeletingBand] = useState<HierarchyRow | null>(null);
  const [stepModal, setStepModal] = useState<{ wf: WorkflowDef; original?: StepDef; draft: StepDraft } | null>(null);
  const [deletingStep, setDeletingStep] = useState<{ wf: WorkflowDef; step: StepDef } | null>(null);
  const [newWf, setNewWf] = useState<{ name: string; description: string; categoryId: string } | null>(null);
  const [deletingWf, setDeletingWf] = useState<WorkflowDef | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['approval-matrix'],
    queryFn: () => api.get<{ doa: DoARow[]; workflows: WorkflowDef[] }>('/approval-matrix'),
  });
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<{ categories: { id: string; name: string }[] }>('/lookups') });

  const entity = useMutation({
    mutationFn: (p: { entity: string; op: string; row: Record<string, unknown> }) => api.post(`/configuration/entities/${p.entity}`, { op: p.op, row: p.row }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Approval configuration updated', detail: 'Applies to invoices that enter approval from now on.' });
      qc.invalidateQueries({ queryKey: ['approval-matrix'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  /** Pivot the stored levels into one row per amount range (a DoA band). */
  const hierarchy = useMemo<HierarchyRow[]>(() => {
    const map = new Map<string, HierarchyRow>();
    for (const d of data?.doa ?? []) {
      const key = `${d.minAmount}|${d.maxAmount ?? ''}`;
      const row = map.get(key) ?? {
        key, minAmount: d.minAmount, maxAmount: d.maxAmount, active: d.active, levels: {},
      };
      row.levels[d.level] = d;
      row.active = row.active || d.active;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.minAmount - b.minAmount);
  }, [data?.doa]);

  /**
   * Every invoice amount must fall in exactly one band, so the editor warns
   * before a range is saved that overlaps one that already exists.
   */
  const bandOverlaps = useMemo(() => {
    if (!editingBand) return false;
    const min = editingBand.minAmount;
    const max = editingBand.maxAmount ?? Number.POSITIVE_INFINITY;
    if (max <= min) return true;
    return hierarchy.some((r) => {
      if (editingBand.original && r.key === editingBand.original.key) return false;
      const rMax = r.maxAmount ?? Number.POSITIVE_INFINITY;
      return min < rMax && r.minAmount < max;
    });
  }, [editingBand, hierarchy]);

  if (isLoading || !data) return <LoadingState />;

  const openBandEditor = (row?: HierarchyRow) =>
    setEditingBand({
      original: row,
      minAmount: row?.minAmount ?? 0,
      maxAmount: row?.maxAmount ?? null,
      levelRoles: Object.fromEntries(LEVELS.map((l) => [l, row?.levels[l]?.role ?? ''])) as Record<number, string>,
    });

  /** Save the whole amount range: one stored entry per level that has a role. */
  const saveBand = () => {
    if (!editingBand) return;
    const { original, minAmount, maxAmount, levelRoles } = editingBand;
    for (const level of LEVELS) {
      const role = levelRoles[level];
      const existing = original?.levels[level];
      if (role && existing) {
        entity.mutate({ entity: 'doaMatrix', op: 'UPDATE', row: { ...existing, minAmount, maxAmount, role, level } });
      } else if (role && !existing) {
        entity.mutate({
          entity: 'doaMatrix', op: 'CREATE',
          row: {
            minAmount, maxAmount, role, level, currency: 'IDR', active: true,
            // Routing resolves the actual approver from the role holders at run
            // time — no person is configured here.
            approverUserId: '', approverName: `${displayRole(role)} group`,
          },
        });
      } else if (!role && existing) {
        entity.mutate({ entity: 'doaMatrix', op: 'DELETE', row: { id: existing.id } });
      }
    }
    setEditingBand(null);
  };

  const deleteBand = () => {
    if (!deletingBand) return;
    Object.values(deletingBand.levels).forEach((d) => d && entity.mutate({ entity: 'doaMatrix', op: 'DELETE', row: { id: d.id } }));
    setDeletingBand(null);
  };

  /** Open the step editor for an existing step or a new step at `position` (1-based). */
  const openStepModal = (wf: WorkflowDef, original?: StepDef, position?: number) => {
    setStepModal({
      wf,
      original,
      draft: original
        ? {
            name: original.name, role: original.role, approverType: original.approverType, slaHours: original.slaHours,
            amountThresholdMin: original.amountThresholdMin ?? null, taxStep: Boolean(original.taxStep),
            escalationTo: original.escalationTo ?? '', notify: original.notify, position: original.stepNo,
          }
        : {
            name: '', role: 'AP_REVIEWER', approverType: 'ROLE', slaHours: 24,
            amountThresholdMin: null, taxStep: false, escalationTo: '', notify: true,
            position: position ?? wf.steps.length + 1,
          },
    });
  };

  const saveStep = () => {
    if (!stepModal) return;
    const { wf, original, draft } = stepModal;
    let steps = wf.steps.filter((s) => !(original && s.stepNo === original.stepNo));
    const step: StepDef = {
      stepNo: 0, name: draft.name.trim(), role: draft.role, approverType: draft.approverType,
      slaHours: Math.max(1, draft.slaHours), notify: draft.notify, taxStep: draft.taxStep || undefined,
      amountThresholdMin: draft.amountThresholdMin ?? undefined, escalationTo: draft.escalationTo || undefined,
    };
    const pos = Math.min(Math.max(1, draft.position), steps.length + 1);
    steps.splice(pos - 1, 0, step);
    steps = steps.map((s, i) => ({ ...s, stepNo: i + 1 }));
    entity.mutate({ entity: 'workflows', op: 'UPDATE', row: { id: wf.id, steps } });
    setStepModal(null);
  };

  const removeStep = () => {
    if (!deletingStep) return;
    const steps = deletingStep.wf.steps
      .filter((s) => s.stepNo !== deletingStep.step.stepNo)
      .map((s, i) => ({ ...s, stepNo: i + 1 }));
    entity.mutate({ entity: 'workflows', op: 'UPDATE', row: { id: deletingStep.wf.id, steps } });
    setDeletingStep(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Workflows & Approval Hierarchy' }]}
        title="Workflows & Approval Hierarchy"
        description="Approval applies to Non-PO invoices. Who approves is decided by the invoice amount alone — every level in the band approves in sequence and no level is skipped."
        actions={canEdit ? <Button size="sm" onClick={() => setNewWf({ name: '', description: '', categoryId: '' })}><CirclePlus size={13} /> Add workflow</Button> : undefined}
      />

      {/* --------------------------------------------- approval hierarchy */}
      <Card
        title="Approval hierarchy"
        pad={false}
        actions={canEdit ? <Button size="sm" variant="secondary" onClick={() => openBandEditor()}><Plus size={13} /> Add amount range</Button> : undefined}
      >
        <DataTable
          dense
          columns={[
            { key: 'band', header: 'Band', value: (r) => r.minAmount, render: (r) => <span className="font-medium">Band {hierarchy.findIndex((x) => x.key === r.key) + 1}</span> },
            { key: 'from', header: 'From Amount', align: 'right', sortable: true, value: (r) => r.minAmount, render: (r) => <span className="whitespace-nowrap">{fmtMoney(r.minAmount)}</span> },
            { key: 'to', header: 'To Amount', align: 'right', sortable: true, value: (r) => r.maxAmount ?? Number.MAX_SAFE_INTEGER, render: (r) => <span className="whitespace-nowrap">{r.maxAmount != null ? fmtMoney(r.maxAmount) : 'No limit'}</span> },
            ...LEVELS.map((l) => ({
              key: `level-${l}`,
              header: `Level ${l}`,
              align: 'center' as const,
              render: (r: HierarchyRow) =>
                r.levels[l]
                  ? <Badge tone="info">{displayRole(r.levels[l]!.role)}</Badge>
                  : <span className="text-2xs text-line-strong">—</span>,
            })),
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} label={r.active ? 'Enabled' : 'Disabled'} /> },
            {
              key: 'actions', header: 'Action', align: 'center', sticky: true, render: (r) =>
                canEdit ? (
                  <div className="flex justify-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Edit amount range" title="Edit this amount range and its levels" onClick={() => openBandEditor(r)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Delete amount range" title="Delete this amount range" className="text-semantic-error" onClick={() => setDeletingBand(r)}><Trash2 size={13} /></Button>
                  </div>
                ) : null,
            },
          ] satisfies Column<HierarchyRow>[]}
          rows={hierarchy}
          rowKey={(r) => r.key}
        />
      </Card>

      {/* --------------------------------------------- workflow definitions */}
      {data.workflows.map((wf) => (
        <Card
          key={wf.id}
          title={<span>{wf.name} <span className="ml-2 text-2xs font-normal text-ink-muted">{wf.categoryId ? lookups?.categories.find((c) => c.id === wf.categoryId)?.name : 'All Non-PO categories'}</span></span>}
          actions={
            <span className="flex items-center gap-2">
              <StatusBadge value={wf.status} />
              {canEdit && (
                <>
                  <Button
                    size="sm" variant="ghost"
                    title={wf.status === 'ACTIVE' ? 'Disable this workflow' : 'Enable this workflow'}
                    onClick={() => entity.mutate({ entity: 'workflows', op: 'TOGGLE', row: { id: wf.id } })}
                  >
                    <Power size={13} /> {wf.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    title="Copy this workflow as a starting point for a new one"
                    onClick={() => entity.mutate({
                      entity: 'workflows', op: 'CREATE',
                      row: {
                        code: `${wf.code}-COPY`, name: `${wf.name} (Copy)`, description: wf.description,
                        categoryId: wf.categoryId, status: 'INACTIVE', version: 'v1',
                        steps: wf.steps.map((s) => ({ ...s })),
                      },
                    })}
                  >
                    <Copy size={13} /> Copy
                  </Button>
                  <Button size="sm" variant="ghost" className="text-semantic-error" title="Delete this workflow" onClick={() => setDeletingWf(wf)}>
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
            </span>
          }
        >
          <p className="mb-3 text-xs text-ink-muted">{wf.description}</p>
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-center gap-0 py-1">
              <div className="rounded-md border-2 border-essa-600 bg-essa-600 px-3 py-1.5 text-xs font-bold text-white">START</div>
              {wf.steps.map((s) => (
                <div key={s.stepNo} className="flex items-center">
                  <span className="h-0.5 w-6 bg-essa-400" />
                  <div className="group relative w-48 rounded-lg border border-line bg-white p-2.5 shadow-card transition-colors hover:border-essa-300">
                    {canEdit && (
                      <span className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-white/90 group-hover:flex">
                        <Button size="sm" variant="ghost" aria-label={`Edit step ${s.name}`} onClick={() => openStepModal(wf, s)}><Pencil size={12} /></Button>
                        <Button size="sm" variant="ghost" aria-label={`Delete step ${s.name}`} className="text-semantic-error" onClick={() => setDeletingStep({ wf, step: s })}><Trash2 size={12} /></Button>
                      </span>
                    )}
                    <p className="text-xs font-semibold text-ink">Level {s.stepNo} · {s.name}</p>
                    <p className="text-2xs text-ink-muted">{s.approverType === 'DOA' ? 'By approval hierarchy (invoice amount)' : displayRole(s.role)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone="neutral">SLA {s.slaHours}h</Badge>
                      {s.taxStep && <Badge tone="info">Tax review</Badge>}
                      {s.amountThresholdMin != null && <Badge tone="warning">From {fmtMoney(s.amountThresholdMin)}</Badge>}
                      {s.escalationTo && <Badge tone="pending">Escalates to {displayRole(s.escalationTo)}</Badge>}
                    </div>
                  </div>
                </div>
              ))}
              {canEdit && (
                <div className="flex items-center">
                  <span className="h-0.5 w-6 bg-essa-400" />
                  <button
                    onClick={() => openStepModal(wf, undefined, wf.steps.length + 1)}
                    className="flex items-center gap-1 rounded-lg border-2 border-dashed border-essa-300 px-3 py-2 text-xs font-medium text-essa-700 transition-colors hover:border-essa-500 hover:bg-essa-50"
                  >
                    <Plus size={13} /> Add level
                  </button>
                </div>
              )}
              <span className="h-0.5 w-6 bg-essa-400" />
              <div className="rounded-md border-2 border-essa-600 bg-white px-3 py-1.5 text-xs font-bold text-essa-700">SAP PARKING</div>
            </div>
          </div>
          <p className="mt-2 text-2xs text-ink-muted">
            A level runs only when the invoice meets its conditions; levels that do not apply are skipped.
            {canEdit && ' Hover a level to edit or remove it. Changes apply to invoices that enter approval afterwards.'}
          </p>
        </Card>
      ))}

      {/* ------------------------------------------------ amount-range editor */}
      <Modal
        open={Boolean(editingBand)}
        onClose={() => setEditingBand(null)}
        title={editingBand?.original ? 'Edit amount range' : 'Add amount range'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingBand(null)}>Cancel</Button>
            <Button
              disabled={!LEVELS.some((l) => editingBand?.levelRoles[l]) || bandOverlaps}
              loading={entity.isPending}
              onClick={saveBand}
            >
              Save
            </Button>
          </>
        }
      >
        {editingBand && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="From amount" required>
                <Input type="number" min={0} value={editingBand.minAmount} onChange={(e) => setEditingBand((p) => p && ({ ...p, minAmount: Number(e.target.value) }))} />
              </Field>
              <Field label="To amount" hint="Leave blank for no upper limit">
                <Input
                  type="number" min={0}
                  value={editingBand.maxAmount ?? ''}
                  onChange={(e) => setEditingBand((p) => p && ({ ...p, maxAmount: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </Field>
            </div>
            {bandOverlaps && (
              <p className="rounded-md bg-semantic-warningBg px-2.5 py-1.5 text-2xs text-semantic-warning">
                This amount range overlaps another band. Adjust the From / To amounts so every invoice amount falls in exactly one band.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-4">
              {LEVELS.map((l) => (
                <Field key={l} label={`Level ${l}`} hint={l === 1 ? 'Whoever holds this role can approve' : undefined}>
                  <Select
                    value={editingBand.levelRoles[l] ?? ''}
                    onChange={(e) => setEditingBand((p) => p && ({ ...p, levelRoles: { ...p.levelRoles, [l]: e.target.value } }))}
                    className="w-full"
                  >
                    <option value="">Not required</option>
                    {DOA_ROLES.map((r) => <option key={r} value={r}>{displayRole(r)}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingBand)}
        onClose={() => setDeletingBand(null)}
        onConfirm={deleteBand}
        loading={entity.isPending}
        tone="danger"
        title="Delete amount range"
        confirmLabel="Delete"
        message={<p className="text-xs">The approval levels configured for invoices between {fmtMoney(deletingBand?.minAmount)} and {deletingBand?.maxAmount != null ? fmtMoney(deletingBand.maxAmount) : 'no limit'} are removed. Invoices already in approval are unaffected.</p>}
      />

      {/* ------------------------------------------------ new workflow */}
      <Modal
        open={Boolean(newWf)}
        onClose={() => setNewWf(null)}
        title="Add workflow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewWf(null)}>Cancel</Button>
            <Button
              disabled={!newWf?.name.trim()}
              loading={entity.isPending}
              onClick={() => {
                if (!newWf) return;
                entity.mutate({
                  entity: 'workflows', op: 'CREATE',
                  row: {
                    code: `WF-${newWf.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'CUSTOM'}`,
                    name: newWf.name.trim(),
                    description: newWf.description.trim(),
                    categoryId: newWf.categoryId || undefined,
                    status: 'ACTIVE', version: 'v1', steps: [],
                  },
                });
                setNewWf(null);
              }}
            >
              Create workflow
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Workflow name" required>
            <Input value={newWf?.name ?? ''} onChange={(e) => setNewWf((p) => p && ({ ...p, name: e.target.value }))} placeholder="e.g. Non-PO approval — high value" />
          </Field>
          <Field label="Description">
            <Input value={newWf?.description ?? ''} onChange={(e) => setNewWf((p) => p && ({ ...p, description: e.target.value }))} placeholder="e.g. four approval levels for high-value invoices" />
          </Field>
          <Field label="Category" hint="Leave blank to apply to all Non-PO categories">
            <Select value={newWf?.categoryId ?? ''} onChange={(e) => setNewWf((p) => p && ({ ...p, categoryId: e.target.value }))} className="w-full">
              <option value="">All Non-PO categories</option>
              {lookups?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingWf)}
        onClose={() => setDeletingWf(null)}
        onConfirm={() => {
          if (deletingWf) entity.mutate({ entity: 'workflows', op: 'DELETE', row: { id: deletingWf.id } });
          setDeletingWf(null);
        }}
        loading={entity.isPending}
        tone="danger"
        title={`Delete workflow — ${deletingWf?.name}`}
        confirmLabel="Delete workflow"
        message={<p className="text-xs">The workflow and its {deletingWf?.steps.length ?? 0} level(s) are removed. Invoices already in approval keep the levels they started with.</p>}
      />

      {/* ------------------------------------------------ workflow level editor */}
      <Modal
        open={Boolean(stepModal)}
        onClose={() => setStepModal(null)}
        title={stepModal?.original ? `Edit level — ${stepModal.original.name}` : `Add level — ${stepModal?.wf.name ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStepModal(null)}>Cancel</Button>
            <Button disabled={!stepModal?.draft.name.trim()} loading={entity.isPending} onClick={saveStep}>Save</Button>
          </>
        }
      >
        {stepModal && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Level name" required>
                <Input value={stepModal.draft.name} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, name: e.target.value } }))} placeholder="e.g. Finance review" />
              </Field>
              <Field label="Position" hint={`1 – ${stepModal.wf.steps.length + (stepModal.original ? 0 : 1)}`}>
                <Input
                  type="number" min={1} max={stepModal.wf.steps.length + (stepModal.original ? 0 : 1)}
                  value={stepModal.draft.position}
                  onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, position: Number(e.target.value) } }))}
                />
              </Field>
              <Field label="Approver" hint="By approval hierarchy uses the amount band table above">
                <Select value={stepModal.draft.approverType} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, approverType: e.target.value } }))} className="w-full">
                  <option value="ROLE">A role</option>
                  <option value="DOA">By approval hierarchy</option>
                </Select>
              </Field>
              <Field label="Role">
                <Select value={stepModal.draft.role} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, role: e.target.value } }))} className="w-full">
                  {APPROVAL_ROLES.map((r) => <option key={r} value={r}>{displayRole(r)}</option>)}
                </Select>
              </Field>
              <Field label="SLA (hours)">
                <Input type="number" min={1} value={stepModal.draft.slaHours} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, slaHours: Number(e.target.value) } }))} />
              </Field>
              <Field label="Applies from amount" hint="Leave blank to always run">
                <Input
                  type="number" min={0}
                  value={stepModal.draft.amountThresholdMin ?? ''}
                  onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, amountThresholdMin: e.target.value === '' ? null : Number(e.target.value) } }))}
                />
              </Field>
              <Field label="Escalate to when the SLA is breached">
                <Select value={stepModal.draft.escalationTo} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, escalationTo: e.target.value } }))} className="w-full">
                  {ESCALATION_ROLES.map((r) => <option key={r} value={r}>{r ? displayRole(r) : 'No escalation'}</option>)}
                </Select>
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-xs text-ink-secondary">
                  <input
                    type="checkbox" className="h-3.5 w-3.5 accent-essa-600"
                    checked={stepModal.draft.taxStep}
                    onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, taxStep: e.target.checked } }))}
                  />
                  Tax review level (runs only when tax review is required)
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-secondary">
                  <input
                    type="checkbox" className="h-3.5 w-3.5 accent-essa-600"
                    checked={stepModal.draft.notify}
                    onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, notify: e.target.checked } }))}
                  />
                  Notify the approver by Teams and email
                </label>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingStep)}
        onClose={() => setDeletingStep(null)}
        onConfirm={removeStep}
        loading={entity.isPending}
        tone="danger"
        title={`Remove level ${deletingStep?.step.stepNo} — ${deletingStep?.step.name}`}
        confirmLabel="Remove level"
        message={<p className="text-xs">The level is removed from <span className="font-semibold">{deletingStep?.wf.name}</span> and the remaining levels are renumbered. Invoices already in approval keep their current flow.</p>}
      />
    </div>
  );
}
