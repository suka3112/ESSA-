import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Pencil, Power, Trash2, Upload } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, KeyValue, LoadingState, Modal, PageHeader,
  Select, StatusBadge, Tabs, Textarea, useToast, type Column,
} from '@/components/ui';

interface ConfigBundle {
  version: { id: string; versionNo: string; label: string; status: string; effectiveFrom?: string; createdBy: string; createdAt: string; approvedBy?: string; publishedBy?: string; publishedAt?: string; notes?: string };
  categories: { id: string; code: string; name: string; description: string; poBased: boolean; active: boolean }[];
  documentTypes: { id: string; code: string; name: string; purpose: string; defaultExtractionMode: string; active: boolean }[];
  categoryDocuments: { id: string; categoryId: string; documentTypeId: string; requirementType: string; checkMode: string; contentCheckRequired: boolean; availabilityCheckRequired: boolean; allowMultiple: boolean; missingSeverity: string; blocking: boolean; overrideAllowed: boolean; sequence: number; active: boolean; condition?: string }[];
  documentFields: { id: string; categoryId: string; documentTypeId: string; fieldCode: string; label: string; dataType: string; mandatory: boolean; extractionRequired: boolean; confidenceThreshold: number; manualEditAllowed: boolean; displayOrder: number; sapMapped: boolean; active: boolean }[];
  promptTemplates: { id: string; documentTypeId: string; name: string; version: string; status: string; systemInstruction: string; extractionInstruction: string; confidenceThreshold: number; effectiveDate?: string; testSampleCount: number; createdBy: string }[];
  extractionProfiles: { id: string; documentTypeId: string; modelDeployment: string; promptTemplateId: string; reviewThreshold: number; version: string; status: string }[];
  fieldMappings: { id: string; categoryId: string; documentTypeId: string; fieldCode: string; fieldLabel: string; sapField: string; sapDescription: string; matchType: string; toleranceRule: string; mandatory: boolean; status: string }[];
  validationRules: { id: string; ruleCode: string; ruleName: string; description: string; scope: string; categoryId?: string; ruleType: string; comparator?: string; toleranceType?: string; toleranceValue?: number; severity: string; blocking: boolean; overrideAllowed: boolean; overrideRole?: string; priority: number; handlerKey?: string; version: string; status: string }[];
  ruleOperands: { id: string; ruleId: string; alias: string; label: string; sourceType: string; documentTypeCode?: string; fieldCode?: string; sapEntity?: string; sapField?: string; aggregation?: string; constantValue?: string | number; sequence: number }[];
  notificationRules: { id: string; event: string; label: string; channels: string[]; recipients: string; template: string; active: boolean }[];
}

interface VersionRow { id: string; versionNo: string; label: string; status: string; effectiveFrom?: string; effectiveTo?: string; createdBy: string; createdAt: string; approvedBy?: string; publishedBy?: string; publishedAt?: string; notes?: string }

const TABS = [
  { key: 'categories', label: 'Invoice Category' },
  { key: 'documents', label: 'Document Types' },
  { key: 'fields', label: 'Fields to Capture' },
  { key: 'prompts', label: 'Extraction / Prompts' },
  { key: 'mapping', label: 'SAP Field Mapping & Validation' },
  { key: 'rules', label: 'Validation Rules' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'history', label: 'History' },
];

export default function ConfigurationPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'categories';
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = hasPerm('CONFIG_EDIT');

  const versionsQ = useQuery({
    queryKey: ['config-versions'],
    queryFn: () => api.get<{ items: VersionRow[] }>('/configuration/versions'),
  });
  const versions = versionsQ.data?.items ?? [];
  const activeVersion = versions.find((v) => v.status === 'ACTIVE');
  const versionId = params.get('version') ?? activeVersion?.id;

  const bundleQ = useQuery({
    queryKey: ['config-bundle', versionId],
    queryFn: () => api.get<ConfigBundle>(`/configuration/versions/${versionId}`),
    enabled: Boolean(versionId),
  });
  const bundle = bundleQ.data;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['config-bundle'] });
    qc.invalidateQueries({ queryKey: ['config-versions'] });
  };

  const entityAction = useMutation({
    mutationFn: (p: { entity: string; op: string; row: Record<string, unknown> }) => api.post(`/configuration/entities/${p.entity}`, { op: p.op, row: p.row }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Configuration updated', detail: 'Change recorded in the audit trail.' });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const transition = useMutation({
    mutationFn: (p: { id: string; action: string; effectiveFrom?: string }) => api.post(`/configuration/versions/${p.id}/transition`, p),
    onSuccess: (_r, v) => {
      toast.push({ tone: 'success', title: `Version ${v.action === 'PUBLISH' ? 'published' : titleCase(v.action)}`, detail: v.action === 'PUBLISH' ? 'New invoices will process on this version from its effective date.' : undefined });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Transition failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const createDraft = useMutation({
    mutationFn: (p: { label: string; notes?: string }) => api.post('/configuration/versions', p),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Draft version created' });
      invalidate();
    },
  });

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };
  const setVersion = (v: string) => {
    const next = new URLSearchParams(params);
    next.set('version', v);
    setParams(next, { replace: true });
  };

  const [publishOpen, setPublishOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const editingLocked = bundle && ['ACTIVE', 'RETIRED'].includes(bundle.version.status);

  if (!versionId || !bundle) return <LoadingState label="Loading configuration…" />;

  const catName = (id?: string) => bundle.categories.find((c) => c.id === id)?.name ?? (id ? id : 'All');
  const docName = (id?: string) => bundle.documentTypes.find((d) => d.id === id)?.name ?? id;

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Invoice Configuration' }]}
        title="Invoice Configuration"
        description="Versioned configuration of categories, documents, fields, prompts, mappings, rules and notifications. Published versions are immutable — changes are prepared as a new draft, tested and published with an effective date."
        actions={
          <>
            <Select value={versionId} onChange={(e) => setVersion(e.target.value)} aria-label="Configuration version">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.versionNo} ({v.status === 'ACTIVE' ? `Active${v.effectiveFrom ? ` · ${v.effectiveFrom}` : ''}` : titleCase(v.status)})
                </option>
              ))}
            </Select>
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setDraftOpen(true)}>
                <CirclePlus size={14} /> New draft version
              </Button>
            )}
            {hasPerm('CONFIG_PUBLISH') && bundle.version.status === 'DRAFT' && (
              <Button variant="secondary" size="sm" onClick={() => transition.mutate({ id: versionId, action: 'TEST' })}>Move to testing</Button>
            )}
            {hasPerm('CONFIG_PUBLISH') && ['DRAFT', 'TESTING'].includes(bundle.version.status) && (
              <Button size="sm" onClick={() => setPublishOpen(true)}>
                <Upload size={14} /> Publish
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-card">
        <StatusBadge value={bundle.version.status} />
        <span className="font-medium">{bundle.version.versionNo} — {bundle.version.label}</span>
        <span className="text-ink-muted">Created by {bundle.version.createdBy} · {fmtDate(bundle.version.createdAt)}</span>
        {bundle.version.publishedBy && <span className="text-ink-muted">Published by {bundle.version.publishedBy} · {fmtDate(bundle.version.publishedAt)}</span>}
        {bundle.version.notes && <span className="text-ink-muted">· {bundle.version.notes}</span>}
        {editingLocked && <Badge tone="info" className="ml-auto">Immutable — create a draft to change</Badge>}
      </div>

      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
        {tab === 'categories' && <CategoriesTab bundle={bundle} canEdit={canEdit && !editingLocked} onAction={(op, row) => entityAction.mutate({ entity: 'categories', op, row })} />}
        {tab === 'documents' && <DocumentsConfigTab bundle={bundle} canEdit={canEdit && !editingLocked} onAction={(entity, op, row) => entityAction.mutate({ entity, op, row })} />}
        {tab === 'fields' && <FieldsConfigTab bundle={bundle} canEdit={canEdit && !editingLocked} onAction={(op, row) => entityAction.mutate({ entity: 'documentFields', op, row })} />}
        {tab === 'prompts' && <PromptsTab bundle={bundle} canEdit={canEdit && !editingLocked} onAction={(op, row) => entityAction.mutate({ entity: 'promptTemplates', op, row })} />}
        {tab === 'mapping' && <MappingTab bundle={bundle} canEdit={canEdit && !editingLocked} onAction={(op, row) => entityAction.mutate({ entity: 'fieldMappings', op, row })} />}
        {tab === 'rules' && <RulesTab bundle={bundle} canEdit={canEdit && !editingLocked} onAction={(op, row) => entityAction.mutate({ entity: 'validationRules', op, row })} />}
        {tab === 'notifications' && <NotificationsTab bundle={bundle} canEdit={canEdit} onAction={(op, row) => entityAction.mutate({ entity: 'notificationRules', op, row })} />}
        {tab === 'history' && <HistoryTab versions={versions} onRetire={(id) => transition.mutate({ id, action: 'RETIRE' })} canPublish={hasPerm('CONFIG_PUBLISH')} />}
      </Card>

      <ConfirmDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        loading={transition.isPending}
        title={`Publish configuration ${bundle.version.versionNo}`}
        confirmLabel="Publish version"
        message={
          <div className="space-y-1.5 text-xs">
            <p>Publishing activates this version from today and retires the currently active version. The published version becomes <span className="font-semibold">immutable</span>; every invoice records the configuration version used at processing time.</p>
            <p className="text-ink-muted">Requires configuration-approver authority. This action is audited (CONFIG_PUBLISHED).</p>
          </div>
        }
        onConfirm={() => transition.mutate({ id: versionId, action: 'PUBLISH' })}
      />

      <Modal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title="Create draft configuration version"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraftOpen(false)}>Cancel</Button>
            <Button
              loading={createDraft.isPending}
              disabled={!draftLabel.trim()}
              onClick={() => {
                createDraft.mutate({ label: draftLabel, notes: draftNotes || undefined });
                setDraftOpen(false);
              }}
            >
              Create draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Version label" required>
            <Input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="e.g. Housekeeping category rollout" />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
          </Field>
          <p className="rounded-md bg-canvas px-2.5 py-2 text-2xs text-ink-muted">
            The draft starts from the active baseline. Configure, run sample tests, then publish with an effective date. Active configuration is never modified directly.
          </p>
        </div>
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------- Categories
function CategoriesTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (op: string, row: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState<Partial<ConfigBundle['categories'][0]> | null>(null);
  return (
    <>
      <div className="flex items-center justify-between p-3">
        <p className="text-xs text-ink-muted">{bundle.categories.length} invoice categories · category-agnostic engine, extensible via configuration</p>
        {canEdit && <Button size="sm" onClick={() => setEditing({ poBased: true, active: true })}><CirclePlus size={13} /> Add Category</Button>}
      </div>
      <DataTable
        dense
        columns={[
          { key: 'sr', header: 'Sr No.', render: (c) => bundle.categories.indexOf(c) + 1 },
          { key: 'code', header: 'Category Code', render: (c) => <span className="font-mono text-xs">{c.code}</span> },
          { key: 'name', header: 'Category Name', render: (c) => <span className="font-medium">{c.name}</span> },
          { key: 'description', header: 'Description', render: (c) => <span className="block max-w-96 text-xs text-ink-secondary">{c.description}</span> },
          { key: 'po', header: 'PO Based', align: 'center', render: (c) => (c.poBased ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
          { key: 'docs', header: 'Documents', align: 'center', render: (c) => bundle.categoryDocuments.filter((d) => d.categoryId === c.id).length },
          { key: 'rules', header: 'Rules', align: 'center', render: (c) => bundle.validationRules.filter((r) => r.categoryId === c.id).length },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge value={c.active ? 'ACTIVE' : 'INACTIVE'} /> },
          {
            key: 'actions', header: 'Actions', render: (c) =>
              canEdit ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Toggle ${c.name}`} onClick={() => onAction('TOGGLE', { id: c.id })}><Power size={13} /></Button>
                </div>
              ) : null,
          },
        ] satisfies Column<ConfigBundle['categories'][0]>[]}
        rows={bundle.categories}
        rowKey={(c) => c.id}
      />
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit category — ${editing.name}` : 'Add invoice category'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.code || !editing?.name}
              onClick={() => {
                onAction(editing?.id ? 'UPDATE' : 'CREATE', editing as Record<string, unknown>);
                setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Code" required><Input value={editing?.code ?? ''} onChange={(e) => setEditing((p) => ({ ...p, code: e.target.value.toUpperCase() }))} disabled={Boolean(editing?.id)} /></Field>
          <Field label="Name" required><Input value={editing?.name ?? ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} /></Field>
          <div className="md:col-span-2"><Field label="Description"><Textarea rows={2} value={editing?.description ?? ''} onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} /></Field></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.poBased ?? false} onChange={(e) => setEditing((p) => ({ ...p, poBased: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> PO-based category</label>
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------- Document types tab
function DocumentsConfigTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (entity: string, op: string, row: Record<string, unknown>) => void }) {
  const [categoryId, setCategoryId] = useState(bundle.categories[0]?.id ?? '');
  const [selected, setSelected] = useState<ConfigBundle['categoryDocuments'][0] | null>(null);
  const [editing, setEditing] = useState<Partial<ConfigBundle['categoryDocuments'][0]> | null>(null);
  const rows = bundle.categoryDocuments.filter((d) => d.categoryId === categoryId).sort((a, b) => a.sequence - b.sequence);
  const docName = (id: string) => bundle.documentTypes.find((d) => d.id === id)?.name ?? id;
  const docPurpose = (id: string) => bundle.documentTypes.find((d) => d.id === id)?.purpose ?? '';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Field label="Invoice Category">
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSelected(null); }} className="w-56">
            {bundle.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="ml-auto self-end">
          {canEdit && <Button size="sm" onClick={() => setEditing({ categoryId, requirementType: 'MANDATORY', checkMode: 'EXTRACT_AND_VALIDATE', blocking: true, overrideAllowed: false, allowMultiple: false, active: true, sequence: rows.length + 1 })}><CirclePlus size={13} /> Add Document</Button>}
        </div>
      </div>
      <p className="px-3 pb-2 text-xs font-semibold text-essa-700">Document Types &amp; Availability Check</p>
      <DataTable
        dense
        columns={[
          { key: 'sr', header: 'Sr No.', render: (d) => rows.indexOf(d) + 1 },
          { key: 'cat', header: 'Invoice Category', render: () => bundle.categories.find((c) => c.id === categoryId)?.name },
          { key: 'title', header: 'Document Title', render: (d) => <span className="font-medium">{docName(d.documentTypeId)}</span> },
          { key: 'purpose', header: 'Document Purpose', render: (d) => <span className="block max-w-56 text-xs text-ink-secondary">{docPurpose(d.documentTypeId)}</span> },
          { key: 'mandatory', header: 'Mandatory', align: 'center', render: (d) => <StatusBadge value={d.requirementType === 'MANDATORY' ? 'PASS' : d.requirementType === 'CONDITIONAL' ? 'WARNING' : 'SKIPPED'} label={d.requirementType === 'MANDATORY' ? 'Yes' : d.requirementType === 'CONDITIONAL' ? 'Conditional' : 'No'} /> },
          { key: 'check', header: 'Check Type', render: (d) => <span className="text-xs">{d.checkMode === 'AVAILABILITY_ONLY' ? 'Availability Only' : d.checkMode === 'EXTRACT_ONLY' ? 'Extract Only' : 'Content + Availability'}</span> },
          { key: 'content', header: 'Content Check Required', align: 'center', render: (d) => <StatusBadge value={d.contentCheckRequired ? 'PASS' : 'FAIL'} label={d.contentCheckRequired ? 'Yes' : 'No'} /> },
          { key: 'avail', header: 'Availability Check Required', align: 'center', render: (d) => <StatusBadge value={d.availabilityCheckRequired ? 'PASS' : 'FAIL'} label={d.availabilityCheckRequired ? 'Yes' : 'No'} /> },
          { key: 'multiple', header: 'Allow Multiple', align: 'center', render: (d) => (d.allowMultiple ? 'Yes' : 'No') },
          { key: 'status', header: 'Status', render: (d) => <StatusBadge value={d.active ? 'ACTIVE' : 'INACTIVE'} /> },
          {
            key: 'actions', header: 'Actions', render: (d) =>
              canEdit ? (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(d)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label="Delete" className="text-semantic-error" onClick={() => onAction('categoryDocuments', 'DELETE', { id: d.id })}><Trash2 size={13} /></Button>
                </div>
              ) : null,
          },
        ] satisfies Column<ConfigBundle['categoryDocuments'][0]>[]}
        rows={rows}
        rowKey={(d) => d.id}
        onRowClick={setSelected}
      />
      <div className="grid gap-4 border-t border-line-soft p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-canvas p-3">
          <p className="mb-2 text-xs font-semibold text-essa-700">ⓘ Check Type Definition</p>
          <ul className="space-y-1.5 text-2xs text-ink-secondary">
            <li><span className="font-semibold">Content + Availability Check:</span> the document must be present in the invoice bundle and its fields are extracted and validated against SAP.</li>
            <li><span className="font-semibold">Availability Only Check:</span> the document must be present. No content extraction or field validation is performed — it bypasses Azure GPT entirely.</li>
            <li><span className="font-semibold">Optional Document:</span> not mandatory; if provided it may be validated based on the configured check type.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-essa-700">🗎 Selected Document Rule</p>
            {selected && <Badge tone="success">Selected: {docName(selected.documentTypeId)}</Badge>}
          </div>
          {selected ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <KeyValue label="Invoice Category">{bundle.categories.find((c) => c.id === categoryId)?.name}</KeyValue>
              <KeyValue label="Content Check">{selected.contentCheckRequired ? 'Yes' : <span className="font-semibold text-semantic-error">No</span>}</KeyValue>
              <KeyValue label="Document Title">{docName(selected.documentTypeId)}</KeyValue>
              <KeyValue label="Availability Check">{selected.availabilityCheckRequired ? <span className="font-semibold text-essa-700">Yes</span> : 'No'}</KeyValue>
              <KeyValue label="Mandatory">{selected.requirementType}</KeyValue>
              <KeyValue label="Blocking">{selected.blocking ? 'Yes' : 'No'}</KeyValue>
              <KeyValue label="Check Type">{titleCase(selected.checkMode)}</KeyValue>
              <KeyValue label="Override Allowed">{selected.overrideAllowed ? 'Yes' : 'No'}</KeyValue>
              {selected.condition && <KeyValue label="Condition">{selected.condition}</KeyValue>}
              <KeyValue label="Notes">{selected.checkMode === 'AVAILABILITY_ONLY' ? 'The document must be present, but no content extraction or SAP validation is required.' : 'Fields are extracted and validated per the field/mapping/rule configuration.'}</KeyValue>
            </dl>
          ) : (
            <p className="py-4 text-center text-2xs text-ink-muted">Select a row to view its full availability/content rule.</p>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit document rule' : 'Add document to category'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.documentTypeId}
              onClick={() => {
                const row = { ...editing, contentCheckRequired: editing?.checkMode !== 'AVAILABILITY_ONLY', availabilityCheckRequired: true, configVersionId: 'cfg-1' };
                onAction('categoryDocuments', editing?.id ? 'UPDATE' : 'CREATE', row as Record<string, unknown>);
                setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Document type" required>
            <Select value={editing?.documentTypeId ?? ''} onChange={(e) => setEditing((p) => ({ ...p, documentTypeId: e.target.value }))} className="w-full" disabled={Boolean(editing?.id)}>
              <option value="">Select…</option>
              {bundle.documentTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Requirement">
            <Select value={editing?.requirementType ?? 'MANDATORY'} onChange={(e) => setEditing((p) => ({ ...p, requirementType: e.target.value }))} className="w-full">
              {['MANDATORY', 'OPTIONAL', 'CONDITIONAL'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </Select>
          </Field>
          <Field label="Check type">
            <Select value={editing?.checkMode ?? 'EXTRACT_AND_VALIDATE'} onChange={(e) => setEditing((p) => ({ ...p, checkMode: e.target.value }))} className="w-full">
              <option value="EXTRACT_AND_VALIDATE">Content + Availability</option>
              <option value="EXTRACT_ONLY">Extract Only</option>
              <option value="AVAILABILITY_ONLY">Availability Only</option>
            </Select>
          </Field>
          {editing?.requirementType === 'CONDITIONAL' && (
            <Field label="Condition"><Input value={editing?.condition ?? ''} onChange={(e) => setEditing((p) => ({ ...p, condition: e.target.value }))} placeholder="e.g. On-site services (PO-based)" /></Field>
          )}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.blocking ?? false} onChange={(e) => setEditing((p) => ({ ...p, blocking: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Blocking when missing</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.allowMultiple ?? false} onChange={(e) => setEditing((p) => ({ ...p, allowMultiple: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Allow multiple documents</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.overrideAllowed ?? false} onChange={(e) => setEditing((p) => ({ ...p, overrideAllowed: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Override allowed</label>
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------- Fields tab
function FieldsConfigTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (op: string, row: Record<string, unknown>) => void }) {
  const [categoryId, setCategoryId] = useState(bundle.categories[0]?.id ?? '');
  const [docTypeId, setDocTypeId] = useState('');
  const [editing, setEditing] = useState<Partial<ConfigBundle['documentFields'][0]> | null>(null);
  const rows = bundle.documentFields
    .filter((f) => f.categoryId === categoryId && (!docTypeId || f.documentTypeId === docTypeId))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const docsInCategory = [...new Set(bundle.documentFields.filter((f) => f.categoryId === categoryId).map((f) => f.documentTypeId))];

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 p-3">
        <Field label="Invoice Category">
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setDocTypeId(''); }} className="w-52">
            {bundle.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Document Type">
          <Select value={docTypeId} onChange={(e) => setDocTypeId(e.target.value)} className="w-52">
            <option value="">All documents</option>
            {docsInCategory.map((id) => <option key={id} value={id}>{bundle.documentTypes.find((d) => d.id === id)?.name}</option>)}
          </Select>
        </Field>
        <div className="ml-auto">
          {canEdit && <Button size="sm" onClick={() => setEditing({ categoryId, documentTypeId: docTypeId || docsInCategory[0], dataType: 'TEXT', mandatory: false, extractionRequired: true, confidenceThreshold: 0.7, manualEditAllowed: true, active: true, displayOrder: rows.length + 1 })}><CirclePlus size={13} /> Add Field</Button>}
        </div>
      </div>
      <DataTable
        dense
        columns={[
          { key: 'order', header: '#', render: (f) => f.displayOrder },
          { key: 'doc', header: 'Document', render: (f) => <span className="text-xs">{bundle.documentTypes.find((d) => d.id === f.documentTypeId)?.name}</span> },
          { key: 'code', header: 'Field Code', render: (f) => <span className="font-mono text-2xs">{f.fieldCode}</span> },
          { key: 'label', header: 'Label', render: (f) => <span className="font-medium">{f.label}</span> },
          { key: 'type', header: 'Data Type', render: (f) => <Badge tone="neutral">{f.dataType}</Badge> },
          { key: 'mandatory', header: 'Mandatory', align: 'center', render: (f) => <StatusBadge value={f.mandatory ? 'PASS' : 'SKIPPED'} label={f.mandatory ? 'Yes' : 'No'} /> },
          { key: 'extract', header: 'Extraction', align: 'center', render: (f) => (f.extractionRequired ? <Badge tone="success">Required</Badge> : <Badge tone="neutral">No</Badge>) },
          { key: 'threshold', header: 'Conf. Threshold', align: 'center', render: (f) => `${Math.round(f.confidenceThreshold * 100)}%` },
          { key: 'manual', header: 'Manual Edit', align: 'center', render: (f) => (f.manualEditAllowed ? 'Allowed' : 'Locked') },
          { key: 'sap', header: 'SAP Mapped', align: 'center', render: (f) => (f.sapMapped ? <Badge tone="info">Yes</Badge> : 'No') },
          { key: 'status', header: 'Status', render: (f) => <StatusBadge value={f.active ? 'ACTIVE' : 'INACTIVE'} /> },
          {
            key: 'actions', header: 'Actions', render: (f) =>
              canEdit ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(f)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label="Delete" className="text-semantic-error" onClick={() => onAction('DELETE', { id: f.id })}><Trash2 size={13} /></Button>
                </div>
              ) : null,
          },
        ] satisfies Column<ConfigBundle['documentFields'][0]>[]}
        rows={rows}
        rowKey={(f) => f.id}
      />
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit field — ${editing.label}` : 'Add field to capture'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.fieldCode || !editing?.label}
              onClick={() => {
                onAction(editing?.id ? 'UPDATE' : 'CREATE', { ...editing, configVersionId: 'cfg-1' } as Record<string, unknown>);
                setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Field code" required><Input value={editing?.fieldCode ?? ''} onChange={(e) => setEditing((p) => ({ ...p, fieldCode: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} /></Field>
          <Field label="Label" required><Input value={editing?.label ?? ''} onChange={(e) => setEditing((p) => ({ ...p, label: e.target.value }))} /></Field>
          <Field label="Data type">
            <Select value={editing?.dataType ?? 'TEXT'} onChange={(e) => setEditing((p) => ({ ...p, dataType: e.target.value }))} className="w-full">
              {['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'CODE', 'LIST', 'PERCENTAGE'].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Confidence threshold" hint="Below this the field routes to HITL review">
            <Input type="number" step="0.05" min="0" max="1" value={editing?.confidenceThreshold ?? 0.7} onChange={(e) => setEditing((p) => ({ ...p, confidenceThreshold: Number(e.target.value) }))} />
          </Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.mandatory ?? false} onChange={(e) => setEditing((p) => ({ ...p, mandatory: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Mandatory</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.extractionRequired ?? true} onChange={(e) => setEditing((p) => ({ ...p, extractionRequired: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Extraction required</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.manualEditAllowed ?? true} onChange={(e) => setEditing((p) => ({ ...p, manualEditAllowed: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Manual edit allowed</label>
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------- Prompts tab
function PromptsTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (op: string, row: Record<string, unknown>) => void }) {
  const [viewing, setViewing] = useState<ConfigBundle['promptTemplates'][0] | null>(null);
  const [editing, setEditing] = useState<Partial<ConfigBundle['promptTemplates'][0]> | null>(null);
  return (
    <>
      <div className="flex items-center justify-between p-3">
        <p className="text-xs text-ink-muted">
          Versioned prompt templates for the Azure OpenAI GPT extraction adapter. Output is schema-constrained; changes are tested against samples before activation. Engine: <Badge tone="info">AZURE_OPENAI_GPT · essa-gpt4o-prod</Badge>
        </p>
      </div>
      <DataTable
        dense
        columns={[
          { key: 'name', header: 'Prompt', render: (p) => <span className="font-medium">{p.name}</span> },
          { key: 'doc', header: 'Document Type', render: (p) => bundle.documentTypes.find((d) => d.id === p.documentTypeId)?.name },
          { key: 'version', header: 'Version', render: (p) => <Badge tone="info">{p.version}</Badge> },
          { key: 'status', header: 'Status', render: (p) => <StatusBadge value={p.status} /> },
          { key: 'threshold', header: 'Conf. Threshold', align: 'center', render: (p) => `${Math.round(p.confidenceThreshold * 100)}%` },
          { key: 'effective', header: 'Effective', render: (p) => <span className="text-xs">{p.effectiveDate ?? '—'}</span> },
          { key: 'samples', header: 'Test Samples', align: 'center', render: (p) => p.testSampleCount },
          { key: 'by', header: 'Created By', render: (p) => <span className="text-xs">{p.createdBy}</span> },
          {
            key: 'actions', header: 'Actions', render: (p) => (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setViewing(p)}>View</Button>
                {canEdit && <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(p)}><Pencil size={13} /></Button>}
              </div>
            ),
          },
        ] satisfies Column<ConfigBundle['promptTemplates'][0]>[]}
        rows={bundle.promptTemplates}
        rowKey={(p) => p.id}
      />
      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title={`${viewing?.name} (${viewing?.version})`} wide>
        <div className="space-y-3 text-xs">
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">System instruction</p>
            <pre className="whitespace-pre-wrap rounded-md bg-canvas p-3 font-mono text-2xs">{viewing?.systemInstruction}</pre>
          </div>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Extraction instruction</p>
            <pre className="whitespace-pre-wrap rounded-md bg-canvas p-3 font-mono text-2xs">{viewing?.extractionInstruction}</pre>
          </div>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Output schema (typed JSON, generated from configured fields)</p>
            <pre className="max-h-48 overflow-auto rounded-md bg-canvas p-3 font-mono text-2xs scrollbar-thin">{`{
  "type": "object",
  "properties": {
    "fields": { "type": "array", "items": {
      "type": "object",
      "properties": {
        "fieldCode": { "type": "string" },
        "value": {},
        "confidence": { "type": "number" },
        "page": { "type": "integer" },
        "evidence": { "type": "string" }
      },
      "required": ["fieldCode", "value", "confidence", "page"]
    }}
  },
  "required": ["fields"]
}`}</pre>
          </div>
          <p className="text-2xs text-ink-muted">Prompt lifecycle: Draft → Test (sample documents) → Publish (effective date) → Retire. Model/prompt/config versions are stored with every extraction run.</p>
        </div>
      </Modal>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit prompt — ${editing?.name}`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const nextVersion = editing?.version ? `v${(parseFloat(editing.version.slice(1)) + 0.1).toFixed(1)}` : 'v1.0';
                onAction('UPDATE', { ...editing, version: nextVersion, status: 'ACTIVE' } as Record<string, unknown>);
                setEditing(null);
              }}
            >
              Save as new version
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="System instruction"><Textarea rows={4} value={editing?.systemInstruction ?? ''} onChange={(e) => setEditing((p) => ({ ...p, systemInstruction: e.target.value }))} /></Field>
          <Field label="Extraction instruction"><Textarea rows={4} value={editing?.extractionInstruction ?? ''} onChange={(e) => setEditing((p) => ({ ...p, extractionInstruction: e.target.value }))} /></Field>
          <Field label="Confidence threshold"><Input type="number" step="0.05" min="0" max="1" value={editing?.confidenceThreshold ?? 0.7} onChange={(e) => setEditing((p) => ({ ...p, confidenceThreshold: Number(e.target.value) }))} /></Field>
          <p className="rounded-md bg-semantic-warningBg px-2.5 py-1.5 text-2xs text-semantic-warning">Prompt changes are version-controlled — saving creates a new prompt version; historical extraction runs keep their original version reference.</p>
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------- Mapping tab
function MappingTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (op: string, row: Record<string, unknown>) => void }) {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<ConfigBundle['fieldMappings'][0]> | null>(null);
  const rows = bundle.fieldMappings.filter(
    (m) =>
      (!categoryId || m.categoryId === categoryId) &&
      (!search || [m.fieldCode, m.fieldLabel, m.sapField, m.sapDescription].some((v) => v.toLowerCase().includes(search.toLowerCase())))
  );
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 p-3">
        <Field label="Invoice Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-52">
            <option value="">All ({bundle.fieldMappings.length})</option>
            {bundle.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by field name or SAP field…" className="w-64" /></Field>
        <div className="ml-auto">
          {canEdit && <Button size="sm" onClick={() => setEditing({ categoryId: categoryId || bundle.categories[0]?.id, documentTypeId: bundle.documentTypes[0]?.id, matchType: 'EXACT_MATCH', toleranceRule: 'Exact', mandatory: true, status: 'ACTIVE' })}><CirclePlus size={13} /> Add Mapping</Button>}
        </div>
      </div>
      <DataTable
        dense
        columns={[
          { key: 'sr', header: 'Sr No.', render: (m) => rows.indexOf(m) + 1 },
          { key: 'cat', header: 'Invoice Category', render: (m) => <span className="text-xs">{bundle.categories.find((c) => c.id === m.categoryId)?.name}</span> },
          { key: 'doc', header: 'Document Title', render: (m) => <span className="text-xs">{bundle.documentTypes.find((d) => d.id === m.documentTypeId)?.name}</span> },
          { key: 'field', header: 'Field Name (Extracted)', render: (m) => <span className="font-medium">{m.fieldLabel}</span> },
          { key: 'sapField', header: 'SAP Field', render: (m) => <span className="font-mono text-xs">{m.sapField}</span> },
          { key: 'sapDesc', header: 'SAP Field Description', render: (m) => <span className="text-xs text-ink-secondary">{m.sapDescription}</span> },
          { key: 'match', header: 'Match Type', render: (m) => <Badge tone="neutral">{titleCase(m.matchType)}</Badge> },
          { key: 'tolerance', header: 'Tolerance / Rule', render: (m) => <span className="text-xs">{m.toleranceRule}</span> },
          { key: 'mandatory', header: 'Mandatory', align: 'center', render: (m) => (m.mandatory ? 'Yes' : 'No') },
          { key: 'status', header: 'Status', render: (m) => <StatusBadge value={m.status} /> },
          {
            key: 'actions', header: 'Actions', render: (m) =>
              canEdit ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(m)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label="Delete" className="text-semantic-error" onClick={() => onAction('DELETE', { id: m.id })}><Trash2 size={13} /></Button>
                </div>
              ) : null,
          },
        ] satisfies Column<ConfigBundle['fieldMappings'][0]>[]}
        rows={rows}
        rowKey={(m) => m.id}
      />
      <div className="grid gap-3 border-t border-line-soft p-4 text-2xs text-ink-secondary md:grid-cols-3">
        <div className="rounded-lg border border-line bg-canvas p-3">
          <p className="mb-1.5 font-semibold text-ink">Match Types</p>
          <ul className="space-y-1">
            <li><b>Exact Match</b>: value must be exactly the same as in SAP.</li>
            <li><b>Amount Match</b>: numeric values compared with tolerance.</li>
            <li><b>Date Match</b>: date values compared with allowed deviation.</li>
            <li><b>Code Match</b>: code values must match exactly.</li>
            <li><b>List Match</b>: value must exist in a SAP/master list.</li>
            <li><b>Range Match</b>: value must be within a defined range.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-canvas p-3">
          <p className="mb-1.5 font-semibold text-ink">Tolerance / Rule Examples</p>
          <ul className="space-y-1">
            <li><b>Exact</b>: no variation allowed.</li>
            <li><b>Diff &lt;= 2%</b>: difference allowed within 2 percent.</li>
            <li><b>+/- 3 days</b>: date can vary up to 3 days.</li>
            <li><b>Between 0 – 100</b>: value must be in range 0 to 100.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-canvas p-3">
          <p className="mb-1.5 font-semibold text-ink">Notes</p>
          <ul className="space-y-1">
            <li>Mappings and validation rules apply to new invoices per the effective date of the version.</li>
            <li>If multiple mappings exist for the same SAP field, the system uses the active mapping with highest priority.</li>
          </ul>
        </div>
      </div>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit SAP field mapping' : 'Add SAP field mapping'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.fieldCode || !editing?.sapField}
              onClick={() => {
                onAction(editing?.id ? 'UPDATE' : 'CREATE', { ...editing, fieldLabel: editing?.fieldLabel || editing?.fieldCode, configVersionId: 'cfg-1' } as Record<string, unknown>);
                setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Category">
            <Select value={editing?.categoryId ?? ''} onChange={(e) => setEditing((p) => ({ ...p, categoryId: e.target.value }))} className="w-full">
              {bundle.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Document type">
            <Select value={editing?.documentTypeId ?? ''} onChange={(e) => setEditing((p) => ({ ...p, documentTypeId: e.target.value }))} className="w-full">
              {bundle.documentTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Extracted field code" required><Input value={editing?.fieldCode ?? ''} onChange={(e) => setEditing((p) => ({ ...p, fieldCode: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} /></Field>
          <Field label="Field label"><Input value={editing?.fieldLabel ?? ''} onChange={(e) => setEditing((p) => ({ ...p, fieldLabel: e.target.value }))} /></Field>
          <Field label="SAP field" required><Input value={editing?.sapField ?? ''} onChange={(e) => setEditing((p) => ({ ...p, sapField: e.target.value.toUpperCase() }))} placeholder="e.g. BSEG-WRBTR" /></Field>
          <Field label="SAP description"><Input value={editing?.sapDescription ?? ''} onChange={(e) => setEditing((p) => ({ ...p, sapDescription: e.target.value }))} /></Field>
          <Field label="Match type">
            <Select value={editing?.matchType ?? 'EXACT_MATCH'} onChange={(e) => setEditing((p) => ({ ...p, matchType: e.target.value }))} className="w-full">
              {['EXACT_MATCH', 'AMOUNT_MATCH', 'DATE_MATCH', 'CODE_MATCH', 'LIST_MATCH', 'RANGE_MATCH'].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
            </Select>
          </Field>
          <Field label="Tolerance / rule"><Input value={editing?.toleranceRule ?? ''} onChange={(e) => setEditing((p) => ({ ...p, toleranceRule: e.target.value }))} placeholder="e.g. Diff <= 2%" /></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.mandatory ?? true} onChange={(e) => setEditing((p) => ({ ...p, mandatory: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Mandatory</label>
        </div>
      </Modal>
    </>
  );
}

// --------------------------------------------------------------- Rules tab
function RulesTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (op: string, row: Record<string, unknown>) => void }) {
  const [categoryId, setCategoryId] = useState('');
  const [selected, setSelected] = useState<ConfigBundle['validationRules'][0] | null>(null);
  const [editing, setEditing] = useState<Partial<ConfigBundle['validationRules'][0]> | null>(null);
  const rows = bundle.validationRules
    .filter((r) => !categoryId || r.categoryId === categoryId || (!r.categoryId && categoryId === 'GLOBAL'))
    .sort((a, b) => a.priority - b.priority);
  const operands = (ruleId: string) => bundle.ruleOperands.filter((o) => o.ruleId === ruleId).sort((a, b) => a.sequence - b.sequence);

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 p-3">
        <Field label="Scope / Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-56">
            <option value="">All rules ({bundle.validationRules.length})</option>
            <option value="GLOBAL">Global (common) rules</option>
            {bundle.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <p className="mb-1.5 ml-2 text-2xs text-ink-muted">
          Most rules use generic operators; only genuinely specialized algorithms use approved TypeScript plugins (handler keys). Rules are N-way: a header plus 2..N operands.
        </p>
        <div className="ml-auto">
          {canEdit && <Button size="sm" onClick={() => setEditing({ scope: 'CATEGORY', ruleType: 'AMOUNT_TOLERANCE', comparator: 'DIFF_WITHIN_TOLERANCE', toleranceType: 'PERCENT', toleranceValue: 2, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_MANAGER', priority: 100, status: 'ACTIVE' })}><CirclePlus size={13} /> Add Rule</Button>}
        </div>
      </div>
      <DataTable
        dense
        columns={[
          { key: 'priority', header: 'Priority', align: 'center', render: (r) => r.priority },
          { key: 'code', header: 'Rule Code', render: (r) => <span className="font-mono text-xs text-essa-700">{r.ruleCode}</span> },
          { key: 'name', header: 'Rule Name', render: (r) => <span className="font-medium">{r.ruleName}</span> },
          { key: 'scope', header: 'Scope', render: (r) => <Badge tone="neutral">{r.categoryId ? bundle.categories.find((c) => c.id === r.categoryId)?.code : 'GLOBAL'}</Badge> },
          { key: 'type', header: 'Type', render: (r) => <Badge tone={r.ruleType === 'N_WAY' ? 'info' : r.ruleType === 'CUSTOM' ? 'pending' : 'neutral'}>{titleCase(r.ruleType)}</Badge> },
          { key: 'operands', header: 'Operands', align: 'center', render: (r) => operands(r.id).length || '—' },
          { key: 'tolerance', header: 'Tolerance', render: (r) => <span className="text-xs">{r.toleranceType === 'PERCENT' ? `≤ ${r.toleranceValue}%` : r.toleranceType === 'DAYS' ? `± ${r.toleranceValue}d` : r.toleranceType === 'ABSOLUTE' ? `± ${r.toleranceValue}` : 'Exact'}</span> },
          { key: 'severity', header: 'Severity', render: (r) => <StatusBadge value={r.severity} /> },
          { key: 'blocking', header: 'Blocking', align: 'center', render: (r) => (r.blocking ? <Badge tone="error">Yes</Badge> : 'No') },
          { key: 'override', header: 'Override', render: (r) => (r.overrideAllowed ? <span className="text-xs">{titleCase(r.overrideRole ?? 'Allowed')}</span> : <span className="text-2xs text-ink-faint">Not allowed</span>) },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
          {
            key: 'actions', header: 'Actions', render: (r) =>
              canEdit ? (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(r)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label="Toggle" onClick={() => onAction('TOGGLE', { id: r.id })}><Power size={13} /></Button>
                </div>
              ) : null,
          },
        ] satisfies Column<ConfigBundle['validationRules'][0]>[]}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={setSelected}
      />

      {/* rule detail drawer */}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={`${selected?.ruleCode} — ${selected?.ruleName}`} wide>
        {selected && (
          <div className="space-y-4 text-xs">
            <p className="text-ink-secondary">{selected.description}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
              <KeyValue label="Type">{titleCase(selected.ruleType)}</KeyValue>
              <KeyValue label="Comparator">{selected.comparator ? titleCase(selected.comparator) : '—'}</KeyValue>
              <KeyValue label="Tolerance">{selected.toleranceType === 'PERCENT' ? `≤ ${selected.toleranceValue}%` : selected.toleranceType === 'DAYS' ? `± ${selected.toleranceValue} days` : selected.toleranceType ?? 'Exact'}</KeyValue>
              <KeyValue label="Severity"><StatusBadge value={selected.severity} /></KeyValue>
              <KeyValue label="Blocking">{selected.blocking ? 'Yes' : 'No'}</KeyValue>
              <KeyValue label="Override">{selected.overrideAllowed ? `Allowed (${titleCase(selected.overrideRole ?? '')})` : 'Not allowed'}</KeyValue>
              <KeyValue label="Priority">{selected.priority}</KeyValue>
              <KeyValue label="Version">{selected.version}</KeyValue>
              {selected.handlerKey && <KeyValue label="Custom plugin"><span className="font-mono">{selected.handlerKey}</span></KeyValue>}
            </dl>
            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Operands ({operands(selected.id).length}) — N-way structure</p>
              <div className="flex flex-wrap items-center gap-2">
                {operands(selected.id).map((o, i) => (
                  <div key={o.id} className="flex items-center gap-2">
                    {i > 0 && <span className="text-sm font-bold text-ink-faint">{selected.comparator === 'LEFT_LTE_RIGHT' ? '≤' : '='}</span>}
                    <div className="min-w-40 rounded-md border border-line bg-canvas p-2.5">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-essa-700">Operand {o.alias}</p>
                      <p className="font-medium text-ink">{o.label}</p>
                      <p className="text-2xs text-ink-muted">
                        {o.sourceType === 'DOCUMENT_FIELD' && `${o.documentTypeCode}.${o.fieldCode}`}
                        {o.sourceType === 'SAP' && `SAP ${o.sapEntity}.${o.sapField ?? ''} ${o.aggregation && o.aggregation !== 'NONE' ? `(${o.aggregation})` : ''}`}
                        {o.sourceType === 'BIOMETRIC' && `Biometric ${o.aggregation ?? 'SUM'}${o.fieldCode ? ` of ${o.fieldCode}` : ' of hours'}`}
                        {['CONFIG', 'MASTER', 'CALCULATED'].includes(o.sourceType) && `Configured: ${o.constantValue}`}
                      </p>
                      <Badge tone="neutral" className="mt-1">{titleCase(o.sourceType)}</Badge>
                    </div>
                  </div>
                ))}
                {!operands(selected.id).length && <p className="text-2xs text-ink-muted">No operands — this rule evaluates via its custom plugin over the validation context.</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* rule editor */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit rule — ${editing.ruleCode}` : 'Add validation rule'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.ruleCode || !editing?.ruleName}
              onClick={() => {
                onAction(editing?.id ? 'UPDATE' : 'CREATE', { ...editing, configVersionId: 'cfg-1', version: editing?.version ?? 'v1.0' } as Record<string, unknown>);
                setEditing(null);
              }}
            >
              Save rule
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Rule code" required><Input value={editing?.ruleCode ?? ''} onChange={(e) => setEditing((p) => ({ ...p, ruleCode: e.target.value.toUpperCase() }))} placeholder="R-XXX-000" /></Field>
          <div className="md:col-span-2"><Field label="Rule name" required><Input value={editing?.ruleName ?? ''} onChange={(e) => setEditing((p) => ({ ...p, ruleName: e.target.value }))} /></Field></div>
          <div className="md:col-span-3"><Field label="Description"><Textarea rows={2} value={editing?.description ?? ''} onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} /></Field></div>
          <Field label="Scope">
            <Select value={editing?.scope ?? 'CATEGORY'} onChange={(e) => setEditing((p) => ({ ...p, scope: e.target.value }))} className="w-full">
              {['GLOBAL', 'CATEGORY', 'DOCUMENT', 'FIELD', 'CROSS_DOCUMENT'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
          </Field>
          <Field label="Category (blank = global)">
            <Select value={editing?.categoryId ?? ''} onChange={(e) => setEditing((p) => ({ ...p, categoryId: e.target.value || undefined }))} className="w-full">
              <option value="">Global</option>
              {bundle.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Rule type">
            <Select value={editing?.ruleType ?? 'AMOUNT_TOLERANCE'} onChange={(e) => setEditing((p) => ({ ...p, ruleType: e.target.value }))} className="w-full">
              {['PRESENCE', 'EXACT_MATCH', 'AMOUNT_TOLERANCE', 'DATE_TOLERANCE', 'RANGE', 'LIST_MEMBERSHIP', 'AGGREGATION', 'CONDITIONAL', 'FORMULA', 'N_WAY', 'CUSTOM'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Comparator">
            <Select value={editing?.comparator ?? ''} onChange={(e) => setEditing((p) => ({ ...p, comparator: e.target.value || undefined }))} className="w-full">
              <option value="">—</option>
              {['ALL_EQUAL', 'LEFT_LTE_RIGHT', 'LEFT_GTE_RIGHT', 'DIFF_WITHIN_TOLERANCE'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
          </Field>
          <Field label="Tolerance type">
            <Select value={editing?.toleranceType ?? 'NONE'} onChange={(e) => setEditing((p) => ({ ...p, toleranceType: e.target.value }))} className="w-full">
              {['NONE', 'PERCENT', 'ABSOLUTE', 'DAYS'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Tolerance value"><Input type="number" value={editing?.toleranceValue ?? 0} onChange={(e) => setEditing((p) => ({ ...p, toleranceValue: Number(e.target.value) }))} /></Field>
          <Field label="Severity">
            <Select value={editing?.severity ?? 'ERROR'} onChange={(e) => setEditing((p) => ({ ...p, severity: e.target.value }))} className="w-full">
              {['INFO', 'WARNING', 'ERROR', 'HARD_FAIL'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Priority"><Input type="number" value={editing?.priority ?? 100} onChange={(e) => setEditing((p) => ({ ...p, priority: Number(e.target.value) }))} /></Field>
          <Field label="Override role">
            <Select value={editing?.overrideRole ?? ''} onChange={(e) => setEditing((p) => ({ ...p, overrideRole: e.target.value || undefined }))} className="w-full">
              <option value="">—</option>
              {['AP_REVIEWER', 'AP_MANAGER', 'ADMINISTRATOR'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </Select>
          </Field>
          {editing?.ruleType === 'CUSTOM' && (
            <Field label="Handler key (approved plugin)">
              <Select value={editing?.handlerKey ?? ''} onChange={(e) => setEditing((p) => ({ ...p, handlerKey: e.target.value || undefined }))} className="w-full">
                <option value="">Select plugin…</option>
                {['TOTALS_ARITHMETIC', 'VENDOR_NOT_NEGATIVE', 'MEAL_ARITHMETIC', 'CATERING_MEAL_ELIGIBILITY', 'MANPOWER_OT_CAP', 'NATURAL_GAS_CONTRACT_RATE'].map((h) => <option key={h} value={h}>{h}</option>)}
              </Select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.blocking ?? true} onChange={(e) => setEditing((p) => ({ ...p, blocking: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Blocking</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editing?.overrideAllowed ?? false} onChange={(e) => setEditing((p) => ({ ...p, overrideAllowed: e.target.checked }))} className="h-3.5 w-3.5 accent-essa-600" /> Override allowed</label>
        </div>
        <p className="mt-3 rounded-md bg-canvas px-2.5 py-2 text-2xs text-ink-muted">
          The database never stores executable code — CUSTOM rules reference approved handler keys with safe parameters only. Operand editing for existing rules mirrors the operand structure shown in the rule detail view.
        </p>
      </Modal>
    </>
  );
}

// -------------------------------------------------------- Notifications tab
function NotificationsTab({ bundle, canEdit, onAction }: { bundle: ConfigBundle; canEdit: boolean; onAction: (op: string, row: Record<string, unknown>) => void }) {
  return (
    <DataTable
      dense
      columns={[
        { key: 'event', header: 'Event', render: (n) => <span className="font-mono text-xs">{n.event}</span> },
        { key: 'label', header: 'Label', render: (n) => <span className="font-medium">{n.label}</span> },
        { key: 'channels', header: 'Channels', render: (n) => <span className="flex gap-1">{n.channels.map((c) => <Badge key={c} tone={c === 'TEAMS' ? 'info' : c === 'EMAIL' ? 'pending' : 'neutral'}>{c}</Badge>)}</span> },
        { key: 'recipients', header: 'Recipients', render: (n) => <span className="text-xs">{n.recipients}</span> },
        { key: 'template', header: 'Template', render: (n) => <span className="block max-w-80 truncate font-mono text-2xs text-ink-muted" title={n.template}>{n.template}</span> },
        { key: 'active', header: 'Status', render: (n) => <StatusBadge value={n.active ? 'ACTIVE' : 'INACTIVE'} /> },
        {
          key: 'actions', header: 'Actions', render: (n) =>
            canEdit ? <Button size="sm" variant="ghost" aria-label="Toggle" onClick={() => onAction('TOGGLE', { id: n.id })}><Power size={13} /></Button> : null,
        },
      ] satisfies Column<ConfigBundle['notificationRules'][0]>[]}
      rows={bundle.notificationRules}
      rowKey={(n) => n.id}
    />
  );
}

// -------------------------------------------------------------- History tab
function HistoryTab({ versions, onRetire, canPublish }: { versions: VersionRow[]; onRetire: (id: string) => void; canPublish: boolean }) {
  return (
    <DataTable
      dense
      columns={[
        { key: 'versionNo', header: 'Version', render: (v) => <span className="font-semibold">{v.versionNo}</span> },
        { key: 'label', header: 'Label', render: (v) => v.label },
        { key: 'status', header: 'Status', render: (v) => <StatusBadge value={v.status} /> },
        { key: 'effective', header: 'Effective', render: (v) => <span className="text-xs">{v.effectiveFrom ?? '—'}{v.effectiveTo ? ` → ${v.effectiveTo}` : ''}</span> },
        { key: 'created', header: 'Created', render: (v) => <span className="text-xs">{v.createdBy}<br /><span className="text-2xs text-ink-faint">{fmtDateTime(v.createdAt)}</span></span> },
        { key: 'approved', header: 'Approved By', render: (v) => <span className="text-xs">{v.approvedBy ?? '—'}</span> },
        { key: 'published', header: 'Published', render: (v) => <span className="text-xs">{v.publishedBy ?? '—'}{v.publishedAt ? <><br /><span className="text-2xs text-ink-faint">{fmtDateTime(v.publishedAt)}</span></> : null}</span> },
        { key: 'notes', header: 'Notes', render: (v) => <span className="block max-w-72 truncate text-2xs text-ink-muted" title={v.notes}>{v.notes ?? '—'}</span> },
        {
          key: 'actions', header: 'Actions', render: (v) =>
            v.status === 'ACTIVE' && canPublish ? <Button size="sm" variant="warning" onClick={() => onRetire(v.id)}>Retire</Button> : null,
        },
      ] satisfies Column<VersionRow>[]}
      rows={versions}
      rowKey={(v) => v.id}
    />
  );
}
