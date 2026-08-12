import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, useToast, type Column,
} from '@/components/ui';

interface DoARow { id: string; department: string; level: number; role: string; approverUserId: string; approverName: string; minAmount: number; maxAmount: number | null; currency: string; active: boolean }
interface StepDef { stepNo: number; name: string; role: string; approverType: string; amountThresholdMin?: number; taxStep?: boolean; slaHours: number; escalationTo?: string; notify: boolean }
interface WorkflowDef { id: string; code: string; name: string; description: string; categoryId?: string; status: string; version: string; steps: StepDef[] }

const STEP_ROLES = ['AP_REVIEWER', 'AP_APPROVER', 'AP_MANAGER', 'TAX_REVIEWER'];
const ESCALATION_ROLES = ['', 'AP_MANAGER', 'ADMINISTRATOR'];

interface StepDraft {
  name: string; role: string; approverType: string; slaHours: number;
  amountThresholdMin: number | null; taxStep: boolean; escalationTo: string; notify: boolean; position: number;
}

export default function WorkflowsPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const toast = useToast();
  const qc = useQueryClient();
  const [editingDoa, setEditingDoa] = useState<Partial<DoARow> | null>(null);
  const [stepModal, setStepModal] = useState<{ wf: WorkflowDef; original?: StepDef; draft: StepDraft } | null>(null);
  const [deletingStep, setDeletingStep] = useState<{ wf: WorkflowDef; step: StepDef } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['approval-matrix'],
    queryFn: () => api.get<{ doa: DoARow[]; workflows: WorkflowDef[] }>('/approval-matrix'),
  });
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<{ users: { id: string; name: string; enabled: boolean }[]; departments: string[]; categories: { id: string; name: string }[] }>('/lookups') });

  const entity = useMutation({
    mutationFn: (p: { entity: string; op: string; row: Record<string, unknown> }) => api.post(`/configuration/entities/${p.entity}`, { op: p.op, row: p.row }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Workflow configuration updated', detail: 'Changes apply to invoices entering approval from now on; in-flight approvals are unaffected.' });
      qc.invalidateQueries({ queryKey: ['approval-matrix'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !data) return <LoadingState />;

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
            name: '', role: 'AP_APPROVER', approverType: 'ROLE', slaHours: 24,
            amountThresholdMin: null, taxStep: false, escalationTo: '', notify: true,
            position: position ?? wf.steps.length + 1,
          },
    });
  };

  /** Rebuild the steps array (remove original, insert draft at position, renumber) and persist. */
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
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Workflows & DoA' }]}
        title="Workflow Configuration"
        description="Approval workflow definitions and the Delegation of Authority matrix. Steps route by role, DoA level, amount threshold, tax requirement and SLA with escalation — all editable per step."
        actions={canEdit ? <Button size="sm" onClick={() => setEditingDoa({ level: 1, role: 'AP_APPROVER', minAmount: 0, currency: 'INR', active: true })}><CirclePlus size={13} /> Add DoA Entry</Button> : undefined}
      />

      <Card title="Delegation of Authority matrix" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'department', header: 'Department', render: (r) => <span className="font-medium">{r.department}</span> },
            { key: 'level', header: 'Level', align: 'center', render: (r) => <Badge tone="info">L{r.level}</Badge> },
            { key: 'role', header: 'Role', render: (r) => titleCase(r.role) },
            { key: 'approver', header: 'Approver', render: (r) => r.approverName },
            { key: 'band', header: 'Amount Band', render: (r) => `${fmtMoney(r.minAmount)} – ${r.maxAmount != null ? fmtMoney(r.maxAmount) : 'Unlimited'}` },
            { key: 'active', header: 'Status', render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
            {
              key: 'actions', header: 'Actions', render: (r) =>
                canEdit ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditingDoa(r)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Delete" className="text-semantic-error" onClick={() => entity.mutate({ entity: 'doaMatrix', op: 'DELETE', row: { id: r.id } })}><Trash2 size={13} /></Button>
                  </div>
                ) : null,
            },
          ] satisfies Column<DoARow>[]}
          rows={data.doa}
          rowKey={(r) => r.id}
        />
      </Card>

      {data.workflows.map((wf) => (
        <Card
          key={wf.id}
          title={<span>{wf.name} <span className="ml-2 text-2xs font-normal text-ink-muted">{wf.code} · {wf.version} · {wf.categoryId ? lookups?.categories.find((c) => c.id === wf.categoryId)?.name : 'Default (all categories)'}</span></span>}
          actions={
            <span className="flex items-center gap-2">
              <StatusBadge value={wf.status} />
              {canEdit && (
                <Button
                  size="sm" variant="ghost"
                  title={wf.status === 'ACTIVE' ? 'Deactivate workflow' : 'Activate workflow'}
                  onClick={() => entity.mutate({ entity: 'workflows', op: 'TOGGLE', row: { id: wf.id } })}
                >
                  <Power size={13} /> {wf.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
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
                    <p className="text-xs font-semibold text-ink">{s.stepNo}. {s.name}</p>
                    <p className="text-2xs text-ink-muted">{s.approverType === 'DOA' ? 'DoA matrix (department + amount)' : titleCase(s.role)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone="neutral">SLA {s.slaHours}h</Badge>
                      {s.taxStep && <Badge tone="info">Tax review gate</Badge>}
                      {s.amountThresholdMin != null && <Badge tone="warning">≥ {fmtMoney(s.amountThresholdMin)}</Badge>}
                      {s.escalationTo && <Badge tone="pending">Esc → {titleCase(s.escalationTo)}</Badge>}
                      {s.notify && <Badge tone="neutral">Teams + Email</Badge>}
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
                    <Plus size={13} /> Add step
                  </button>
                </div>
              )}
              <span className="h-0.5 w-6 bg-essa-400" />
              <div className="rounded-md border-2 border-essa-600 bg-white px-3 py-1.5 text-xs font-bold text-essa-700">SAP HANDOFF</div>
            </div>
          </div>
          <p className="mt-2 text-2xs text-ink-muted">
            Conditional behaviour: tax step runs only when tax review is required (≥ ₹10,00,000); manager step only above its amount threshold; empty DoA levels are skipped to the next valid level. Approvals arrive via Microsoft Teams with the portal as controlled fallback.
            {canEdit && ' Hover a step to edit or remove it; changes apply to newly routed invoices.'}
          </p>
        </Card>
      ))}

      {/* ------------------------------------------------ DoA entry editor */}
      <Modal
        open={Boolean(editingDoa)}
        onClose={() => setEditingDoa(null)}
        title={editingDoa?.id ? 'Edit DoA entry' : 'Add DoA entry'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingDoa(null)}>Cancel</Button>
            <Button
              disabled={!editingDoa?.department || !editingDoa?.approverUserId}
              onClick={() => {
                const approver = lookups?.users.find((u) => u.id === editingDoa?.approverUserId);
                entity.mutate({ entity: 'doaMatrix', op: editingDoa?.id ? 'UPDATE' : 'CREATE', row: { ...editingDoa, approverName: approver?.name } as Record<string, unknown> });
                setEditingDoa(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Department" required>
            <Select value={editingDoa?.department ?? ''} onChange={(e) => setEditingDoa((p) => ({ ...p, department: e.target.value }))} className="w-full">
              <option value="">Select…</option>
              {lookups?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Approver" required>
            <Select value={editingDoa?.approverUserId ?? ''} onChange={(e) => setEditingDoa((p) => ({ ...p, approverUserId: e.target.value }))} className="w-full">
              <option value="">Select…</option>
              {lookups?.users.filter((u) => u.enabled).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Level"><Input type="number" min={1} value={editingDoa?.level ?? 1} onChange={(e) => setEditingDoa((p) => ({ ...p, level: Number(e.target.value) }))} /></Field>
          <Field label="Role">
            <Select value={editingDoa?.role ?? 'AP_APPROVER'} onChange={(e) => setEditingDoa((p) => ({ ...p, role: e.target.value }))} className="w-full">
              {['AP_APPROVER', 'AP_MANAGER', 'TAX_REVIEWER'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </Select>
          </Field>
          <Field label="Min amount"><Input type="number" value={editingDoa?.minAmount ?? 0} onChange={(e) => setEditingDoa((p) => ({ ...p, minAmount: Number(e.target.value) }))} /></Field>
          <Field label="Max amount (blank = unlimited)"><Input type="number" value={editingDoa?.maxAmount ?? ''} onChange={(e) => setEditingDoa((p) => ({ ...p, maxAmount: e.target.value === '' ? null : Number(e.target.value) }))} /></Field>
        </div>
      </Modal>

      {/* ------------------------------------------------ workflow step editor */}
      <Modal
        open={Boolean(stepModal)}
        onClose={() => setStepModal(null)}
        title={stepModal?.original ? `Edit step — ${stepModal.original.name}` : `Add step — ${stepModal?.wf.name ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStepModal(null)}>Cancel</Button>
            <Button disabled={!stepModal?.draft.name.trim()} loading={entity.isPending} onClick={saveStep}>
              Save step
            </Button>
          </>
        }
      >
        {stepModal && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Step name" required>
                <Input value={stepModal.draft.name} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, name: e.target.value } }))} placeholder="e.g. Finance Controller Review" />
              </Field>
              <Field label="Position" hint={`1 – ${stepModal.wf.steps.length + (stepModal.original ? 0 : 1)}; later steps shift down`}>
                <Input
                  type="number" min={1} max={stepModal.wf.steps.length + (stepModal.original ? 0 : 1)}
                  value={stepModal.draft.position}
                  onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, position: Number(e.target.value) } }))}
                />
              </Field>
              <Field label="Approver type" hint="DoA routes via the matrix above (department + amount)">
                <Select value={stepModal.draft.approverType} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, approverType: e.target.value } }))} className="w-full">
                  <option value="ROLE">Role queue</option>
                  <option value="DOA">DoA matrix</option>
                </Select>
              </Field>
              <Field label="Role">
                <Select value={stepModal.draft.role} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, role: e.target.value } }))} className="w-full">
                  {STEP_ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                </Select>
              </Field>
              <Field label="SLA (hours)">
                <Input type="number" min={1} value={stepModal.draft.slaHours} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, slaHours: Number(e.target.value) } }))} />
              </Field>
              <Field label="Amount threshold (blank = always runs)" hint="Step is skipped below this invoice amount">
                <Input
                  type="number" min={0}
                  value={stepModal.draft.amountThresholdMin ?? ''}
                  onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, amountThresholdMin: e.target.value === '' ? null : Number(e.target.value) } }))}
                />
              </Field>
              <Field label="Escalation on SLA breach">
                <Select value={stepModal.draft.escalationTo} onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, escalationTo: e.target.value } }))} className="w-full">
                  {ESCALATION_ROLES.map((r) => <option key={r} value={r}>{r ? titleCase(r) : 'No escalation'}</option>)}
                </Select>
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-xs text-ink-secondary">
                  <input
                    type="checkbox" className="h-3.5 w-3.5 accent-essa-600"
                    checked={stepModal.draft.taxStep}
                    onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, taxStep: e.target.checked } }))}
                  />
                  Tax review gate (runs only when tax review is required)
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-secondary">
                  <input
                    type="checkbox" className="h-3.5 w-3.5 accent-essa-600"
                    checked={stepModal.draft.notify}
                    onChange={(e) => setStepModal((p) => p && ({ ...p, draft: { ...p.draft, notify: e.target.checked } }))}
                  />
                  Notify via Teams + Email
                </label>
              </div>
            </div>
            <p className="rounded-md bg-canvas p-2.5 text-2xs text-ink-muted">
              Changes are recorded in the audit trail and apply to invoices that enter approval after saving. Invoices already in an approval flow keep the steps they started with.
            </p>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------ delete step confirm */}
      <ConfirmDialog
        open={Boolean(deletingStep)}
        onClose={() => setDeletingStep(null)}
        onConfirm={removeStep}
        loading={entity.isPending}
        tone="danger"
        title={`Remove step ${deletingStep?.step.stepNo} — ${deletingStep?.step.name}`}
        confirmLabel="Remove step"
        message={
          <p className="text-xs">
            The step is removed from <span className="font-semibold">{deletingStep?.wf.name}</span> and the remaining steps are renumbered.
            Invoices already in approval keep their current flow; the change is audited.
          </p>
        }
      />
    </div>
  );
}
