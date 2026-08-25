/**
 * Invoice Configuration — redesigned admin flow (client-approved layout).
 *
 * Layout follows the approved design references (image 36–44):
 *   · Left rail   — searchable category tree, grouped PO / NON-PO, with the PO
 *                   number series beside each invoice type; in the Document Types
 *                   and Fields tabs the selected type expands into its document
 *                   catalog with enable toggles and field counts.
 *   · Centre pane — the working surface for the active tab (type editor,
 *                   document catalog table, fields-to-capture table, rules grid).
 *   · Right rail  — contextual detail/editor panel for the current selection.
 *   (The generated AI prompts are development artefacts and are not shown.)
 *
 * Everything structural stays wired to the existing configuration API
 * (the live configuration and its entity actions). A few presentation-only
 * attributes that the backend does not model yet (PO number series, content
 * classification signals, split behavior, classification hints, field alias
 * hints) are kept as local UI state, flagged in the right rail exactly like the
 * approved mockups do.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, ChevronRight, CirclePlus, Copy, GitBranch, Lock, Pencil, Plus, Save, Search, Trash2, Upload, X,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, LoadingState, Modal, PageHeader,
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

type Category = ConfigBundle['categories'][0];
type CatDoc = ConfigBundle['categoryDocuments'][0];
type DocField = ConfigBundle['documentFields'][0];

interface VersionRow { id: string; versionNo: string; label: string; status: string; effectiveFrom?: string; effectiveTo?: string; createdBy: string; createdAt: string; approvedBy?: string; publishedBy?: string; publishedAt?: string; notes?: string }

/**
 * Tab set per design review §15: Document Validation is the 3rd tab; the SAP
 * field-mapping columns merged into Fields to Capture (no separate mapping
 * tab / SAP field name columns); Notifications and History removed.
 */
const TABS = [
  { key: 'categories', label: 'Invoice Category' },
  { key: 'documents', label: 'Document Types' },
  { key: 'rules', label: 'Document Validation' },
  { key: 'fields', label: 'Fields to Capture' },
  { key: 'workflows', label: 'Workflows' },
];

// ------------------------------------------------------------ local helpers

/** Slug used by the page classifier for a document type (mirrors the mockup). */
const slugOf = (code: string) => code.toLowerCase();

/** Default PO number series preview per category (presentation-only until the backend models it). */
function defaultSeries(cat: Category, index: number): string {
  return cat.poBased ? String(4201 + (index % 4)) : 'Non-PO';
}

/** Small green switch used across the redesigned tabs. */
function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-essa-600' : 'bg-line-strong'
      )}
      style={{ height: 18, width: 32 }}
    >
      <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform" style={{ transform: checked ? 'translateX(15px)' : 'translateX(2px)' }} />
    </button>
  );
}

function SplitChip({ scattered }: { scattered: boolean }) {
  return (
    <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-2xs font-medium', scattered ? 'bg-essa-50 text-essa-600' : 'bg-essa-100 text-essa-800')}>
      {scattered ? 'Scattered' : 'Contiguous'}
    </span>
  );
}

function RequiredChip({ required }: { required: boolean }) {
  return (
    <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-2xs font-medium', required ? 'bg-semantic-errorBg text-semantic-error' : 'bg-line-soft text-ink-muted')}>
      {required ? 'Required' : 'Optional'}
    </span>
  );
}

function ActionPill({ kind }: { kind: 'Block' | 'Warning' }) {
  return (
    <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-2xs font-bold text-white', kind === 'Block' ? 'bg-semantic-error' : 'bg-semantic-warning')}>
      {kind}
    </span>
  );
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

// ------------------------------------------------------- prompt generators

function buildClassificationPrompt(cat: Category, docs: { name: string; slug: string; hint?: string; scattered: boolean; enabled: boolean }[]): string {
  const enabled = docs.filter((d) => d.enabled);
  return [
    `You are classifying PDF pages for a "${cat.name}" invoice (${cat.poBased ? 'PO' : 'Non-PO'}).`,
    '',
    'Read the page title/heading first. Assign exactly one categoryId from the catalog below.',
    'Never invent new slugs. Never use extraction field names as categoryIds.',
    '',
    'ALLOWED categoryIds (anything else is NOT an acceptable value):',
    ...enabled.map((d) => `  - ${d.slug}  // ${d.name}${d.hint ? ` — ${d.hint}` : ''}`),
    '',
    'Split behavior:',
    ...enabled.map((d) => `  - ${d.slug}: ${d.scattered ? 'SCATTERED — pages may appear interleaved within the bundle' : 'CONTIGUOUS — starts a new section on any page gap'}`),
    '',
    'Return JSON: [{ "page": <number>, "categoryId": "<slug>" }] for every page in the PDF.',
  ].join('\n');
}

function buildExtractionPrompt(cat: Category, docName: string, fields: { key: string; hint?: string }[]): string {
  return [
    `You are extracting structured data from documents belonging to a "${cat.name}" invoice (${cat.poBased ? 'PO' : 'Non-PO'}).`,
    '',
    'Scan the ENTIRE page (header, body tables, passenger/ticket detail blocks, bank footer, signature).',
    'Match labels by meaning (English / Bahasa Indonesia). Preserve printed values exactly (including thousand separators).',
    'Never invent values. Use null when a field is not present after a full-page scan.',
    '',
    `Document: ${docName}`,
    'Fields:',
    ...fields.map((f) => `  - ${f.key}${f.hint ? `  // ${f.hint}` : ''}`),
    '',
    'Return one JSON object with exactly these keys.',
  ].join('\n');
}

// ================================================================== page

export default function ConfigurationPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'categories';
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = hasPerm('CONFIG_EDIT');

  /**
   * One live configuration (review, 25 Aug). Draft / publish versioning was
   * removed from the product: administrators change the live configuration
   * directly and every change is recorded in the Audit Log. The single version
   * record survives so each invoice can still say which configuration
   * processed it.
   */
  const versionsQ = useQuery({
    queryKey: ['config-versions'],
    queryFn: () => api.get<{ items: VersionRow[] }>('/configuration/versions'),
  });
  const versionId = versionsQ.data?.items.find((v) => v.status === 'ACTIVE')?.id ?? versionsQ.data?.items[0]?.id;

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

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  const entityAction = useMutation({
    mutationFn: (p: { entity: string; op: string; row: Record<string, unknown> }) => api.post(`/configuration/entities/${p.entity}`, { op: p.op, row: p.row }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Configuration updated', detail: 'Change recorded in the audit trail.' });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });
  const act = (entity: string, op: string, row: Record<string, unknown>) => entityAction.mutate({ entity, op, row });

  // ---- shared selection + presentation-only state (survives tab switches)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedCatDocId, setSelectedCatDocId] = useState<string>('');
  const [treeSearch, setTreeSearch] = useState('');
  const [seriesMap, setSeriesMap] = useState<Record<string, string>>({});
  const [signalsMap, setSignalsMap] = useState<Record<string, string>>({});
  const [splitMap, setSplitMap] = useState<Record<string, boolean>>({}); // catDoc id -> scattered
  const [hintsMap, setHintsMap] = useState<Record<string, string>>({}); // doc type id -> classification hint
  const [fieldHints, setFieldHints] = useState<Record<string, string>>({}); // field id -> alias hint

  const mayEdit = canEdit;

  if (!versionId || !bundle) return <LoadingState label="Loading configuration…" />;

  const categoryId = selectedCategoryId && bundle.categories.some((c) => c.id === selectedCategoryId)
    ? selectedCategoryId
    : bundle.categories[0]?.id ?? '';
  const category = bundle.categories.find((c) => c.id === categoryId);
  const series = (c: Category) => seriesMap[c.id] ?? defaultSeries(c, bundle.categories.filter((x) => x.poBased).indexOf(c));
  const catDocs = (cid: string) => bundle.categoryDocuments.filter((d) => d.categoryId === cid).sort((a, b) => a.sequence - b.sequence);
  const docType = (id: string) => bundle.documentTypes.find((d) => d.id === id);
  const fieldsOf = (cid: string, dtid: string) => bundle.documentFields.filter((f) => f.categoryId === cid && f.documentTypeId === dtid).sort((a, b) => a.displayOrder - b.displayOrder);
  const fieldCount = (cid: string, dtid: string) => fieldsOf(cid, dtid).length;

  const sharedTabProps = {
    bundle, mayEdit, act, categoryId, category, series, catDocs, docType, fieldsOf, fieldCount,
    selectedCatDocId, setSelectedCatDocId, onAddCategory: () => undefined,
    seriesMap, setSeriesMap, signalsMap, setSignalsMap, splitMap, setSplitMap, hintsMap, setHintsMap, fieldHints, setFieldHints,
  };

  const treeMode: TreeMode = tab === 'categories' ? 'category' : 'documents';
  const showTree = ['categories', 'documents', 'fields'].includes(tab);

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Invoice Configuration' }]}
        title="Invoice Configuration"
        description="The invoice categories, documents, fields and validation rules the platform processes invoices with. Changes apply to invoices received from now on — invoices already in progress keep the settings they started on."
      />

      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        {showTree ? (
          <div className="flex flex-col gap-0 lg:flex-row">
            <CategoryTree
              bundle={bundle}
              mode={treeMode}
              activeTab={tab}
              mayEdit={mayEdit}
              search={treeSearch}
              onSearch={setTreeSearch}
              selectedCategoryId={categoryId}
              onSelectCategory={(id) => { setSelectedCategoryId(id); setSelectedCatDocId(''); }}
              selectedCatDocId={selectedCatDocId}
              onSelectCatDoc={setSelectedCatDocId}
              series={series}
              catDocs={catDocs}
              docType={docType}
              fieldCount={fieldCount}
              onAddCategory={() => undefined}
            />
            <div className="min-w-0 flex-1 border-t border-line-soft lg:border-l lg:border-t-0">
              {tab === 'categories' && <CategoryEditor {...sharedTabProps} />}
              {tab === 'documents' && <DocumentsCatalog {...sharedTabProps} />}
              {tab === 'fields' && <FieldsToCapture {...sharedTabProps} />}
            </div>
          </div>
        ) : (
          <>
            {tab === 'rules' && (
              <RulesGrid {...sharedTabProps} />
            )}
            {tab === 'workflows' && <WorkflowsPointer />}
          </>
        )}
      </Card>

    </div>
  );
}

// --------------------------------------------------------------- tab props

interface TabProps {
  bundle: ConfigBundle;
  mayEdit: boolean;
  act: (entity: string, op: string, row: Record<string, unknown>) => void;
  categoryId: string;
  category: Category | undefined;
  series: (c: Category) => string;
  catDocs: (cid: string) => CatDoc[];
  docType: (id: string) => ConfigBundle['documentTypes'][0] | undefined;
  fieldsOf: (cid: string, dtid: string) => DocField[];
  fieldCount: (cid: string, dtid: string) => number;
  selectedCatDocId: string;
  setSelectedCatDocId: (id: string) => void;
  onAddCategory: () => void;
  seriesMap: Record<string, string>;
  setSeriesMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  signalsMap: Record<string, string>;
  setSignalsMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  splitMap: Record<string, boolean>;
  setSplitMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  hintsMap: Record<string, string>;
  setHintsMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  fieldHints: Record<string, string>;
  setFieldHints: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

// ------------------------------------------------------------ left rail

type TreeMode = 'category' | 'documents';

function CategoryTree({
  bundle, mode, activeTab, mayEdit, search, onSearch,
  selectedCategoryId, onSelectCategory, selectedCatDocId, onSelectCatDoc,
  series, catDocs, docType, fieldCount, onAddCategory,
}: {
  bundle: ConfigBundle;
  mode: TreeMode;
  activeTab: string;
  mayEdit: boolean;
  search: string;
  onSearch: (v: string) => void;
  selectedCategoryId: string;
  onSelectCategory: (id: string) => void;
  selectedCatDocId: string;
  onSelectCatDoc: (id: string) => void;
  series: (c: Category) => string;
  catDocs: (cid: string) => CatDoc[];
  docType: (id: string) => ConfigBundle['documentTypes'][0] | undefined;
  fieldCount: (cid: string, dtid: string) => number;
  onAddCategory: () => void;
}) {
  const match = (c: Category) => !search || c.name.toLowerCase().includes(search.toLowerCase());
  const poCats = bundle.categories.filter((c) => c.poBased && match(c));
  const nonPoCats = bundle.categories.filter((c) => !c.poBased && match(c));

  const group = (label: string, cats: Category[]) => (
    <div className="mb-3">
      {/* Fixed category set (client-provided, hard-coded) — no add buttons;
          categories are only enabled/disabled. */}
      <div className="mb-1 px-1">
        <span className="text-2xs font-semibold uppercase tracking-widest text-ink-faint">{label}</span>
      </div>
      {cats.map((c) => {
        const active = c.id === selectedCategoryId;
        const docs = catDocs(c.id);
        const totalFields = docs.reduce((a, d) => a + fieldCount(c.id, d.documentTypeId), 0);
        return (
          <div key={c.id} className="mb-0.5">
            <button
              onClick={() => onSelectCategory(c.id)}
              className={clsx(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                active ? 'bg-essa-50 text-essa-700' : 'text-ink-secondary hover:bg-canvas',
                !c.active && 'opacity-50'
              )}
              title={c.active ? undefined : 'Disabled — this invoice type is not processed'}
            >
              {mode === 'documents' && active ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0 text-ink-faint" />}
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="shrink-0 font-mono text-2xs text-ink-faint">{mode === 'documents' ? totalFields || series(c) : series(c)}</span>
            </button>
            {mode === 'documents' && active && (
              <div className="ml-3 mt-0.5 space-y-0.5 border-l border-line-soft pl-2">
                {docs.map((d) => {
                  const dt = docType(d.documentTypeId);
                  const sel = d.id === selectedCatDocId;
                  return (
                    /* Enable/disable lives ONLY in the catalog table on the right —
                       the tree is for navigation, so no duplicate toggle here. */
                    <button
                      key={d.id}
                      onClick={() => onSelectCatDoc(d.id)}
                      className={clsx(
                        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left',
                        sel && 'bg-essa-50',
                        !d.active && 'opacity-50'
                      )}
                      title={d.active ? undefined : 'Disabled — enable it from the table'}
                    >
                      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', d.active ? 'bg-essa-500' : 'bg-line-strong')} aria-hidden />
                      <span className={clsx('min-w-0 flex-1 truncate text-xs', sel ? 'font-semibold text-essa-700' : 'text-ink-secondary')}>
                        {dt?.name ?? d.documentTypeId}
                      </span>
                      <span className="shrink-0 text-2xs text-ink-faint">{fieldCount(c.id, d.documentTypeId)}</span>
                    </button>
                  );
                })}
                {!docs.length && <p className="px-1.5 py-1 text-2xs text-ink-faint">No documents in this catalog yet.</p>}
                {activeTab === 'fields' && mayEdit && (
                  <p className="px-1.5 pt-1 text-2xs text-ink-faint">Add document types in the Document Types tab.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!cats.length && <p className="px-2 py-1 text-2xs text-ink-faint">No matches.</p>}
    </div>
  );

  return (
    <aside className="w-full shrink-0 p-3 lg:w-64">
      <div className="relative mb-3">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search category…"
          aria-label="Search invoice categories"
          className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-xs focus:border-essa-500 focus:outline-none focus:ring-2 focus:ring-essa-100"
        />
      </div>
      {group('PO', poCats)}
      {group('Non-PO', nonPoCats)}
      <p className="rounded-md bg-canvas px-2 py-1.5 text-2xs text-ink-muted">
        Fixed invoice-type set (client master). New types need an SAP change request — here they can only be enabled or disabled.
      </p>
    </aside>
  );
}

// -------------------------------------------------- Invoice Category editor

/**
 * The centre pane reads the invoice type; changing it happens in a dialog
 * (review, 25 Aug: editing and adding are pop-ups, not forms wedged into the
 * card that is showing the data).
 */
function CategoryEditor(p: TabProps) {
  const { bundle, mayEdit, act, category, series, seriesMap, setSeriesMap, signalsMap, setSignalsMap } = p;
  const [draft, setDraft] = useState<{ name: string; series: string; signals: string } | null>(null);
  const [toggleOpen, setToggleOpen] = useState(false);
  if (!category) return <EmptyPane text="Select an invoice type on the left." />;

  const catSeries = seriesMap[category.id] ?? series(category);
  const signals = signalsMap[category.id] ?? category.description ?? '';
  const sharing = bundle.categories.filter((c) => c.id !== category.id && c.poBased === category.poBased && series(c) === catSeries && category.poBased);

  const openEditor = () => setDraft({ name: category.name, series: category.poBased ? catSeries : '', signals });

  const saveDraft = () => {
    if (!draft) return;
    if (draft.name.trim() && draft.name.trim() !== category.name) act('categories', 'UPDATE', { ...category, name: draft.name.trim() });
    setSeriesMap((m) => ({ ...m, [category.id]: draft.series }));
    setSignalsMap((m) => ({ ...m, [category.id]: draft.signals }));
    setDraft(null);
  };

  return (
    <div className="flex flex-col xl:flex-row">
      <div className="min-w-0 flex-1 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-ink">{category.name}</h3>
            <p className="text-xs text-ink-muted">{category.poBased ? 'PO' : 'Non-PO'} · how the pipeline detects this invoice type before classifying pages</p>
          </div>
          {mayEdit && (
            <Button variant="secondary" size="sm" onClick={openEditor}>
              <Pencil size={13} /> Edit invoice type
            </Button>
          )}
        </div>

        <dl className="max-w-3xl space-y-3.5">
          <ReadField label="Invoice type name" value={category.name} hint="The name is used on every screen that shows this invoice type." />
          <ReadField
            label="PO number series"
            value={category.poBased ? catSeries : 'Not applicable — Non-PO'}
            mono={category.poBased}
            hint="SAP PO number prefix(es) that indicate this invoice type."
          />
          {sharing.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-semantic-errorBg/60 px-3 py-2.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-semantic-error">Shares this series with</p>
              <p className="mt-1 text-xs text-ink-secondary">
                {sharing.map((c) => c.name).join(', ')} — the PO number alone can&apos;t tell these apart, so the
                classification signals below resolve it.
              </p>
            </div>
          )}
          <ReadField
            label="Content classification signals"
            value={signals || 'Not set'}
            hint="Used to tell this type apart from the ones it shares a PO series with."
            multiline
          />
        </dl>

        {/* Enable/Disable only — the invoice-type set is fixed (SAP change request). */}
        <button
          disabled={!mayEdit}
          onClick={() => setToggleOpen(true)}
          className={clsx(
            'mt-4 w-full max-w-3xl rounded-md border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            category.active
              ? 'border-amber-300 text-semantic-warning hover:bg-semantic-warningBg'
              : 'border-essa-300 text-essa-700 hover:bg-essa-50'
          )}
        >
          {category.active ? 'Disable this invoice type — stop processing it' : 'Enable this invoice type'}
        </button>
      </div>

      {/* right rail */}
      <aside className="w-full shrink-0 border-t border-line-soft p-4 xl:w-72 xl:border-l xl:border-t-0">
        <h4 className="text-sm font-semibold text-ink">{category.name}</h4>
        <p className="mb-3 text-2xs text-ink-muted">{category.poBased ? 'PO' : 'Non-PO'} · detection summary</p>
        <RailField label="Current category" value={category.poBased ? 'PO' : 'Non-PO'} />
        <RailField label="PO series summary" value={category.poBased ? catSeries : 'Non-PO'} />
        <div className="mb-3">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Content disambiguation</p>
          <p className="text-2xs leading-relaxed text-ink-secondary">
            {sharing.length
              ? `Required because this type shares its PO series with ${sharing.map((c) => c.name).join(', ')}.`
              : 'Not required — no other invoice type shares this PO series.'}
          </p>
        </div>
        <div>
          {/* Review §16: no internal implementation talk in the UI. */}
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">How changes are saved</p>
          <p className="text-2xs leading-relaxed text-ink-muted">
            Changes are saved as they are made and recorded in the Audit Log. They apply to invoices received from
            now on, so invoices already in progress keep the settings they started on.
          </p>
        </div>
      </aside>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={`Edit invoice type — ${category.name}`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={!draft?.name.trim()} onClick={saveDraft}>Save changes</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            <Field label="Invoice type name" required hint="Used on every screen that shows this invoice type">
              <Input value={draft.name} onChange={(e) => setDraft((d) => d && ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label="PO number series" hint={category.poBased ? 'SAP PO number prefix(es) that indicate this invoice type' : 'Non-PO invoices have no PO series'}>
              <Input
                value={draft.series}
                disabled={!category.poBased}
                placeholder={category.poBased ? 'e.g. 4201' : 'Not applicable'}
                onChange={(e) => setDraft((d) => d && ({ ...d, series: e.target.value }))}
              />
            </Field>
            <Field label="Content classification signals" hint="What tells this type apart from the ones it shares a PO series with">
              <Textarea
                rows={4} maxLength={600}
                value={draft.signals}
                onChange={(e) => setDraft((d) => d && ({ ...d, signals: e.target.value }))}
              />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={toggleOpen}
        onClose={() => setToggleOpen(false)}
        tone={category.active ? 'warning' : 'primary'}
        title={`${category.active ? 'Disable' : 'Enable'} invoice type — ${category.name}`}
        confirmLabel={category.active ? 'Disable invoice type' : 'Enable invoice type'}
        message={
          <p className="text-xs">
            {category.active
              ? 'Disabling stops new invoices of this type from being processed. Historical invoices are unaffected. The type can be re-enabled at any time.'
              : 'Enabling resumes processing of this invoice type.'}
          </p>
        }
        onConfirm={() => { act('categories', 'TOGGLE', { id: category.id }); setToggleOpen(false); }}
      />
    </div>
  );
}

/** A configuration value as it reads when nobody is editing it. */
function ReadField({ label, value, hint, mono, multiline }: { label: string; value: string; hint?: string; mono?: boolean; multiline?: boolean }) {
  return (
    <div>
      <dt className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={clsx('rounded-md border border-line bg-canvas px-2.5 py-2 text-xs text-ink', mono && 'font-mono', multiline && 'whitespace-pre-wrap leading-relaxed')}>
        {value}
      </dd>
      {hint && <p className="mt-1 text-2xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function RailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink-secondary">{value}</div>
    </div>
  );
}

function EmptyPane({ text }: { text: string }) {
  return <p className="p-10 text-center text-xs text-ink-muted">{text}</p>;
}

// --------------------------------------------------- Document Types catalog

function DocumentsCatalog(p: TabProps) {
  const { bundle, mayEdit, act, categoryId, category, catDocs, docType, fieldCount, selectedCatDocId, setSelectedCatDocId, splitMap, setSplitMap, hintsMap, setHintsMap } = p;
  const [editing, setEditing] = useState<CatDoc | null>(null);
  const [adding, setAdding] = useState(false);
  const [newDoc, setNewDoc] = useState({ documentTypeId: '', mandatory: true, contentCheck: true });
  if (!category) return <EmptyPane text="Select an invoice type on the left." />;

  const rows = catDocs(categoryId);
  const selected = rows.find((d) => d.id === selectedCatDocId) ?? rows[0];
  const scattered = (d: CatDoc) => splitMap[d.id] ?? d.allowMultiple;
  const required = (d: CatDoc) => d.requirementType === 'MANDATORY';

  const prompt = buildClassificationPrompt(
    category,
    rows.map((d) => {
      const dt = docType(d.documentTypeId);
      return { name: dt?.name ?? '', slug: slugOf(dt?.code ?? ''), hint: hintsMap[d.documentTypeId] || dt?.purpose, scattered: scattered(d), enabled: d.active };
    })
  );


  return (
    <div className="flex flex-col">
      <div className="flex flex-col xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2 p-4 pb-2">
            <div>
              <h3 className="text-base font-semibold text-ink">{category.name}</h3>
              <p className="text-xs text-ink-muted">{category.poBased ? 'PO' : 'Non-PO'} · {rows.length} document types expected in this invoice bundle</p>
            </div>
            {mayEdit && (
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add document
              </Button>
            )}
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-line-soft text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2" />
                  <th className="px-2 py-2">Document</th>
                  <th className="px-2 py-2">Category ID</th>
                  <th className="px-2 py-2">Split behavior</th>
                  <th className="px-2 py-2">Required</th>
                  <th className="px-2 py-2 text-center">Fields</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const dt = docType(d.documentTypeId);
                  const sel = selected?.id === d.id;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedCatDocId(d.id)}
                      className={clsx('cursor-pointer border-b border-line-soft transition-colors', sel ? 'bg-essa-50/70 ring-1 ring-inset ring-essa-200' : 'hover:bg-canvas')}
                    >
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Toggle checked={d.active} disabled={!mayEdit} onChange={() => act('categoryDocuments', 'TOGGLE', { id: d.id })} label={`Enable ${dt?.name}`} />
                      </td>
                      <td className="px-2 py-2.5 text-xs font-semibold text-ink">{dt?.name}</td>
                      <td className="px-2 py-2.5 font-mono text-xs text-ink-secondary">{slugOf(dt?.code ?? '')}</td>
                      <td className="px-2 py-2.5"><SplitChip scattered={scattered(d)} /></td>
                      <td className="px-2 py-2.5"><RequiredChip required={required(d)} /></td>
                      <td className="px-2 py-2.5 text-center text-xs font-medium text-ink-secondary">{fieldCount(categoryId, d.documentTypeId)}</td>
                      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1 pr-2">
                          <button aria-label={`Edit ${dt?.name}`} disabled={!mayEdit} onClick={() => setEditing(d)} className="rounded border border-line p-1 text-ink-muted hover:bg-essa-50 hover:text-essa-700 disabled:opacity-40">
                            <Pencil size={12} />
                          </button>

                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-ink-muted">No document types configured for this invoice type yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* right rail — classification & split settings for the selected document */}
        <aside className="w-full shrink-0 border-t border-line-soft p-4 xl:w-72 xl:border-l xl:border-t-0">
          {selected ? (
            <>
              <h4 className="text-sm font-semibold text-ink">{docType(selected.documentTypeId)?.name}</h4>
              <p className="mb-3 text-2xs text-ink-muted">{category.name} · classification &amp; split settings</p>

              <div className="mb-3">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Category ID</p>
                <div className="rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink-secondary">{slugOf(docType(selected.documentTypeId)?.code ?? '')}</div>
                <p className="mt-1 text-2xs text-ink-muted">The slug the page classifier assigns to this document type. Must be unique within this invoice type's catalog.</p>
              </div>

              {/* Read-only summary — changing any of this happens in the Edit
                  dialog, so the card that shows the data is never also a form
                  (review, 25 Aug). */}
              <div className="mb-3">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Split behaviour</p>
                <p className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink">
                  {scattered(selected) ? 'Scattered' : 'Contiguous'}
                </p>
                <p className="mt-1 text-2xs text-ink-muted">
                  {scattered(selected)
                    ? 'Pages of this document interleave within the bundle, e.g. daily sheets.'
                    : 'This document is always one continuous block, e.g. the invoice or the PO.'}
                </p>
              </div>

              <div className="mb-3">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Required for extraction</p>
                <p className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink">
                  {required(selected) ? 'Required' : 'Optional'}
                </p>
                <p className="mt-1 text-2xs text-ink-muted">
                  {required(selected)
                    ? 'Extraction blocks if this document is absent from the upload.'
                    : 'Extraction continues if this document is absent from the upload.'}
                </p>
              </div>

              {mayEdit && (
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setEditing(selected)}>
                  <Pencil size={13} /> Edit document
                </Button>
              )}
            </>
          ) : (
            <p className="text-2xs text-ink-muted">Select a document row to see its classification and split settings.</p>
          )}
        </aside>
      </div>

      {/* UI/UX review: the generated AI prompt is a development artefact and is
          not shown to administrators. */}

      {/* Add document — an existing document type from the catalogue is added
          to this invoice type's expected bundle. */}
      <Modal
        open={adding}
        onClose={() => { setAdding(false); setNewDoc({ documentTypeId: '', mandatory: true, contentCheck: true }); }}
        title={`Add document — ${category.name}`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              disabled={!newDoc.documentTypeId}
              onClick={() => {
                act('categoryDocuments', 'CREATE', {
                  categoryId,
                  documentTypeId: newDoc.documentTypeId,
                  requirementType: newDoc.mandatory ? 'MANDATORY' : 'OPTIONAL',
                  checkMode: newDoc.contentCheck ? 'EXTRACT_AND_VALIDATE' : 'AVAILABILITY_ONLY',
                  contentCheckRequired: newDoc.contentCheck,
                  blocking: newDoc.mandatory,
                  allowMultiple: false,
                  sequence: rows.length + 1,
                  active: true,
                  configVersionId: 'cfg-1',
                });
                setAdding(false);
                setNewDoc({ documentTypeId: '', mandatory: true, contentCheck: true });
              }}
            >
              Add document
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Document type" required hint="Only document types that are not already expected for this invoice type">
            <Select value={newDoc.documentTypeId} onChange={(e) => setNewDoc((d) => ({ ...d, documentTypeId: e.target.value }))} className="w-full">
              <option value="">Select…</option>
              {bundle.documentTypes
                .filter((dt) => !rows.some((r) => r.documentTypeId === dt.id))
                .map((dt) => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
            </Select>
          </Field>
          <Field label="Required for extraction" hint="Required blocks the invoice when the document is missing; optional raises a warning">
            <Select value={newDoc.mandatory ? 'yes' : 'no'} onChange={(e) => setNewDoc((d) => ({ ...d, mandatory: e.target.value === 'yes' }))} className="w-full">
              <option value="yes">Required — block the invoice if it is missing</option>
              <option value="no">Optional — warn only</option>
            </Select>
          </Field>
          <Field label="What is checked" hint="Whether the platform reads the content of this document or only confirms it is present">
            <Select value={newDoc.contentCheck ? 'content' : 'availability'} onChange={(e) => setNewDoc((d) => ({ ...d, contentCheck: e.target.value === 'content' }))} className="w-full">
              <option value="content">Availability + content — read the document and validate it</option>
              <option value="availability">Availability only — confirm it is present</option>
            </Select>
          </Field>
        </div>
      </Modal>

      {/* Edit document modal — matches the approved dialog */}
      <EditDocumentModal
        open={Boolean(editing)}
        catDoc={editing}
        docType={editing ? docType(editing.documentTypeId) : undefined}
        scattered={editing ? scattered(editing) : false}
        hint={editing ? hintsMap[editing.documentTypeId] ?? '' : ''}
        mayEdit={mayEdit}
        onClose={() => setEditing(null)}
        onSave={({ name, requiredForExtraction, scattered: sc, hint }) => {
          if (!editing) return;
          const dt = docType(editing.documentTypeId);
          if (dt && name.trim() && name !== dt.name) act('documentTypes', 'UPDATE', { ...dt, name: name.trim() });
          if (requiredForExtraction !== required(editing)) act('categoryDocuments', 'UPDATE', { ...editing, requirementType: requiredForExtraction ? 'MANDATORY' : 'OPTIONAL' });
          setSplitMap((m) => ({ ...m, [editing.id]: sc }));
          setHintsMap((m) => ({ ...m, [editing.documentTypeId]: hint }));
          setEditing(null);
        }}
      />

    </div>
  );
}

function EditDocumentModal({
  open, catDoc, docType: dt, scattered, hint, mayEdit, onClose, onSave,
}: {
  open: boolean;
  catDoc: CatDoc | null;
  docType?: ConfigBundle['documentTypes'][0];
  scattered: boolean;
  hint: string;
  mayEdit: boolean;
  onClose: () => void;
  onSave: (v: { name: string; requiredForExtraction: boolean; scattered: boolean; hint: string }) => void;
}) {
  const [name, setName] = useState('');
  const [req, setReq] = useState(false);
  const [sc, setSc] = useState(false);
  const [h, setH] = useState('');
  // re-seed when a new document opens
  const key = catDoc?.id ?? '';
  const [seeded, setSeeded] = useState('');
  if (open && catDoc && seeded !== key) {
    setSeeded(key);
    setName(dt?.name ?? '');
    setReq(catDoc.requirementType === 'MANDATORY');
    setSc(scattered);
    setH(hint);
  }
  if (!open || !catDoc) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit document — ${dt?.name ?? ''}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!mayEdit || !name.trim()} onClick={() => onSave({ name, requiredForExtraction: req, scattered: sc, hint: h })}>Save</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Document name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <Field label="Category ID">
            <Input value={slugOf(dt?.code ?? '')} disabled className="font-mono" />
          </Field>
          <p className="mt-1 text-2xs text-ink-muted">The slug the page classifier assigns to this document type. Auto-fills from the name — edit if you need a specific slug.</p>
        </div>
        <Field label="Split behavior">
          <Select value={sc ? 'SCATTERED' : 'CONTIGUOUS'} onChange={(e) => setSc(e.target.value === 'SCATTERED')} className="w-full">
            <option value="CONTIGUOUS">Contiguous — starts a new section on any page gap</option>
            <option value="SCATTERED">Scattered — pages interleave within the bundle</option>
          </Select>
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-secondary">Required for extraction</p>
          <div className="flex items-start gap-2">
            <Toggle checked={req} onChange={setReq} label="Required for extraction" />
            <span className="text-2xs text-ink-secondary">{req ? 'Required — upload is blocked if this document is absent' : 'Optional — extraction continues if this document is absent'}</span>
          </div>
          <p className="mt-1 text-2xs text-ink-muted">Applies to this invoice type only. Toggle this on for documents that must be in the upload before Fields to Capture can run.</p>
        </div>
        <div>
          <Field label="Classification hints">
            <Textarea
              rows={4}
              maxLength={600}
              value={h}
              onChange={(e) => setH(e.target.value)}
              placeholder="What identifies this document on the page — headings, form titles, table columns, stamps. Mention anything similar-looking document types this could be confused with."
            />
          </Field>
          <p className="mt-1 text-2xs text-ink-muted">Used by the AI page classifier to recognize this document type and tell it apart from similar-looking ones — separate from the field-level hints in Fields to Capture.</p>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------- Fields to Capture tab

function FieldsToCapture(p: TabProps) {
  const { bundle, mayEdit, act, categoryId, category, catDocs, docType, fieldsOf, selectedCatDocId, setSelectedCatDocId, fieldHints, setFieldHints } = p;
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  // One draft drives both Add field and Edit field, and both open as a dialog
  // rather than turning the rail into a form (review, 25 Aug).
  const [draft, setDraft] = useState<{ original?: DocField; label: string; hint: string } | null>(null);
  const [promptOverride, setPromptOverride] = useState<Record<string, string>>({});
  if (!category) return <EmptyPane text="Select an invoice type on the left." />;

  const rows = catDocs(categoryId);
  const catDoc = rows.find((d) => d.id === selectedCatDocId) ?? rows[0];
  const dt = catDoc ? docType(catDoc.documentTypeId) : undefined;
  const fields = catDoc ? fieldsOf(categoryId, catDoc.documentTypeId) : [];
  // Merged "Field Validation & Mapping" columns (design review §15): match
  // type / tolerance / mandatory / status live here now. SAP field name and
  // description are intentionally NOT shown — comparison runs against the
  // CSV-injected DB values, not live SAP.
  const mappingOf = (f: DocField) =>
    bundle.fieldMappings.find(
      (m) => m.categoryId === categoryId && m.fieldCode.toLowerCase() === f.fieldCode.toLowerCase()
    );
  const selectedField = fields.find((f) => f.id === selectedFieldId);
  const required = catDoc?.requirementType === 'MANDATORY';

  // The hint is the wording the extractor looks for on the page, so it reads as
  // a keyword list rather than a technical "Aliases:" prefix (review, 24 Aug).
  const hintOf = (f: DocField) => fieldHints[f.id] ?? fieldHints[`${f.documentTypeId}:${f.fieldCode}`] ?? f.label.toLowerCase();
  const promptKey = catDoc?.id ?? '';
  const generatedPrompt = catDoc && dt
    ? buildExtractionPrompt(category, dt.name, fields.map((f) => ({ key: f.fieldCode, hint: hintOf(f) })))
    : '';
  const prompt = promptOverride[promptKey] ?? generatedPrompt;

  if (!catDoc || !dt) return <EmptyPane text="Add a document type to this invoice type first (Document Types tab)." />;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col xl:flex-row">
        <div className="min-w-0 flex-1">
          {/* header row */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
            <div>
              <h3 className="text-base font-semibold text-ink">{dt.name}</h3>
              <p className="text-xs text-ink-muted">{category.name} · {category.poBased ? 'PO' : 'Non-PO'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-2xs text-ink-muted">
                Required for extraction
                <Toggle
                  checked={required}
                  disabled={!mayEdit}
                  onChange={(v) => act('categoryDocuments', 'UPDATE', { ...catDoc, requirementType: v ? 'MANDATORY' : 'OPTIONAL' })}
                  label="Required for extraction"
                />
              </span>
              <Button variant="ghost" size="sm" disabled={!mayEdit} onClick={() => act('categoryDocuments', 'TOGGLE', { id: catDoc.id })}>
                {catDoc.active ? 'Exclude document' : 'Include document'}
              </Button>
              <Button variant="ghost" size="sm" disabled={!mayEdit} onClick={() => act('categoryDocuments', 'DELETE', { id: catDoc.id })}>Remove</Button>
              <Button size="sm" disabled={!mayEdit} onClick={() => setDraft({ label: '', hint: '' })}>
                <Plus size={13} /> Add field
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-line-soft text-2xs font-bold uppercase tracking-wide text-ink-secondary">
                  <th className="px-4 py-2">#</th>
                  {/* Review, 24 Aug: the internal key column is gone — the field
                      is named the way it is named on screen, and the hint is
                      called what it actually is: the keyword to look for in the
                      document. */}
                  <th className="px-2 py-2">Field name</th>
                  <th className="px-2 py-2">Keyword in document</th>
                  <th className="px-2 py-2">Match Type</th>
                  <th className="px-2 py-2">Tolerance / Rule</th>
                  <th className="px-2 py-2 text-center">Mandatory</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => {
                  const sel = selectedField?.id === f.id;
                  return (
                    <tr
                      key={f.id}
                      onClick={() => setSelectedFieldId(f.id)}
                      className={clsx('cursor-pointer border-b border-line-soft transition-colors', sel ? 'bg-essa-50/70 ring-1 ring-inset ring-essa-200' : 'hover:bg-canvas')}
                    >
                      <td className="px-4 py-2.5 text-xs text-ink-muted">{i + 1}</td>
                      <td className="px-2 py-2.5 text-xs font-semibold text-ink">{f.label}</td>
                      <td className="max-w-80 px-2 py-2.5 text-xs text-ink-muted"><span className="block truncate">{hintOf(f) || '—'}</span></td>
                      <td className="px-2 py-2.5">{(() => { const m = mappingOf(f); return m ? <Badge tone="neutral">{m.matchType.replace(/_/g, ' ')}</Badge> : <span className="text-2xs text-ink-faint">—</span>; })()}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-xs">{mappingOf(f)?.toleranceRule ?? <span className="text-2xs text-ink-faint">—</span>}</td>
                      <td className="px-2 py-2.5 text-center text-xs font-semibold">{(() => { const m = mappingOf(f); return m ? (m.mandatory ? <span className="text-essa-700">Yes</span> : <span className="text-ink-muted">No</span>) : <span className="text-2xs font-normal text-ink-faint">—</span>; })()}</td>
                      <td className="px-2 py-2.5">{(() => { const m = mappingOf(f); return m ? <StatusBadge value={m.status} /> : <span className="text-2xs text-ink-faint">—</span>; })()}</td>
                      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button
                            aria-label={`Edit ${f.label}`}
                            disabled={!mayEdit}
                            onClick={() => setDraft({ original: f, label: f.label, hint: hintOf(f) })}
                            className="rounded border border-line p-1 text-ink-muted hover:bg-essa-50 hover:text-essa-700 disabled:opacity-40"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            aria-label={`Remove ${f.label}`}
                            disabled={!mayEdit}
                            onClick={() => act('documentFields', 'DELETE', { id: f.id })}
                            className="rounded border border-line p-1 text-ink-muted hover:bg-semantic-errorBg hover:text-semantic-error disabled:opacity-40"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!fields.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-ink-muted">No fields configured — add the first field to capture.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* right rail — field editor */}
        <aside className="w-full shrink-0 border-t border-line-soft p-4 xl:w-72 xl:border-l xl:border-t-0">
          {selectedField ? (
            <>
              <h4 className="text-sm font-semibold text-ink">{selectedField.label}</h4>
              <p className="mb-3 text-2xs text-ink-muted">{dt.name} · {category.name}</p>
              <RailField label="Keyword in document" value={hintOf(selectedField) || 'Not set'} />
              <RailField label="Match type" value={mappingOf(selectedField)?.matchType.replace(/_/g, ' ') ?? 'Not compared'} />
              <RailField label="Tolerance / rule" value={mappingOf(selectedField)?.toleranceRule ?? 'None'} />
              <RailField label="Mandatory" value={mappingOf(selectedField)?.mandatory ? 'Yes' : 'No'} />
              {mayEdit && (
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setDraft({ original: selectedField, label: selectedField.label, hint: hintOf(selectedField) })}>
                  <Pencil size={13} /> Edit field
                </Button>
              )}
            </>
          ) : (
            <>
              <h4 className="text-sm font-semibold text-ink">{dt.name}</h4>
              <p className="mb-3 text-2xs text-ink-muted">{category.name}</p>
              <RailField label="Required for extraction" value={required ? 'Required' : 'Optional'} />
              <p className="mb-3 text-2xs text-ink-muted">
                {required
                  ? 'Extraction blocks if this document is absent from the upload.'
                  : 'Extraction continues if this document is absent from the upload.'}
              </p>
              <p className="mb-3 text-2xs text-ink-secondary">{fields.length} fields configured for this document. Select a row to see it, or use the pencil to change it.</p>
              <Link to="?tab=documents" className="block rounded-md border border-line px-3 py-2 text-center text-xs font-medium text-ink-secondary hover:bg-canvas">
                Classification &amp; split settings →
              </Link>
            </>
          )}
        </aside>
      </div>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.original ? `Edit field — ${draft.original.label}` : `Add field — ${dt.name}`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={!mayEdit || !draft?.label.trim()}
              onClick={() => {
                if (!draft) return;
                const label = draft.label.trim();
                if (draft.original) {
                  if (label !== draft.original.label) act('documentFields', 'UPDATE', { ...draft.original, label });
                  setFieldHints((m) => ({ ...m, [draft.original!.id]: draft.hint }));
                } else {
                  // The internal key is derived from the name — administrators
                  // name fields, they do not write keys (review, 24 Aug).
                  const fieldCode = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
                  act('documentFields', 'CREATE', {
                    categoryId,
                    documentTypeId: catDoc.documentTypeId,
                    fieldCode,
                    label,
                    dataType: 'TEXT',
                    mandatory: false,
                    extractionRequired: true,
                    confidenceThreshold: 0.7,
                    manualEditAllowed: true,
                    displayOrder: fields.length + 1,
                    sapMapped: false,
                    active: true,
                    configVersionId: 'cfg-1',
                  });
                  if (draft.hint) setFieldHints((m) => ({ ...m, [`${catDoc.documentTypeId}:${fieldCode}`]: draft.hint }));
                }
                setDraft(null);
              }}
            >
              {draft?.original ? 'Save field' : 'Add field'}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            <Field label="Field name" required hint="The name shown on screen and in the extracted values">
              <Input value={draft.label} placeholder="e.g. Invoice Number" onChange={(e) => setDraft((d) => d && ({ ...d, label: e.target.value }))} />
            </Field>
            <Field label="Keyword in document" hint="The wording to look for on the page — separate alternatives with a comma">
              <Input value={draft.hint} placeholder="e.g. invoice no, bill number, tax invoice no" onChange={(e) => setDraft((d) => d && ({ ...d, hint: e.target.value }))} />
            </Field>
            {draft.original && (
              <button
                onClick={() => { act('documentFields', 'DELETE', { id: draft.original!.id }); setSelectedFieldId(''); setDraft(null); }}
                className="w-full rounded-md border border-red-200 py-2 text-xs font-medium text-semantic-error hover:bg-semantic-errorBg"
              >
                Remove this field
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* UI/UX review: the generated extraction prompt is a development
          artefact and is not shown to administrators. */}
    </div>
  );
}

/** Right-rail editor for one capture field — buffered, saves on demand. */
// ------------------------------------------------------ Validation Rules

interface RuleRowVm {
  catDoc: CatDoc;
  srNo: number;
  categoryName: string;
  documentTitle: string;
  ruleName: string;
  availabilityContent: boolean;
  mandatory: boolean;
  missingAction: 'Block' | 'Warning';
  contentValidation: boolean;
  workflowImpact: string;
}

function RulesGrid(p: TabProps) {
  const { bundle, mayEdit, act, docType, catDocs } = p;
  const [catFilter, setCatFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CatDoc | null>(null);

  const cats = bundle.categories;
  const filterCat = cats.find((c) => c.id === catFilter) ?? cats[0];
  const rows: RuleRowVm[] = useMemo(() => {
    if (!filterCat) return [];
    return catDocs(filterCat.id).map((d, i) => {
      const dt = docType(d.documentTypeId);
      const availabilityContent = d.checkMode !== 'AVAILABILITY_ONLY';
      const name = availabilityContent
        ? `${dt?.name ?? 'Document'} ${/invoice/i.test(dt?.name ?? '') ? 'Presence Check' : 'Check'}`
        : `${dt?.name ?? 'Document'} Availability`;
      return {
        catDoc: d,
        srNo: i + 1,
        categoryName: filterCat.name,
        documentTitle: dt?.name ?? d.documentTypeId,
        ruleName: name,
        availabilityContent,
        mandatory: d.requirementType === 'MANDATORY',
        missingAction: d.blocking ? 'Block' as const : 'Warning' as const,
        contentValidation: d.contentCheckRequired,
        workflowImpact: d.blocking ? 'Exception + Hold' : 'Exception',
      };
    });
  }, [filterCat, catDocs, docType]);

  const selected = rows.find((r) => r.catDoc.id === selectedId) ?? rows[0];

  return (
    <div className="flex flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-end gap-3 p-4 pb-3">
        <Field label="Invoice Category">
          <Select value={filterCat?.id ?? ''} onChange={(e) => { setCatFilter(e.target.value); setSelectedId(''); }} className="w-52">
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="ml-auto flex gap-2">
          {/* Changes save as they are made, so there is no separate Save step. */}
          <Button size="sm" disabled={!mayEdit} onClick={() => setAddOpen(true)}><Plus size={13} /> Add rule</Button>
        </div>
      </div>

      <DataTable
        dense
        columns={[
          { key: 'sr', header: 'Sr No.', align: 'center', render: (r) => r.srNo },
          /* The invoice category is already chosen above the table, and the rule
             name already names the document it checks — repeating either on every
             row only cost width and pushed Status off screen (review §17). */
          { key: 'rule', header: 'Rule Name', sortable: true, value: (r) => r.ruleName, render: (r) => (
            <span className="block">
              <span className="block whitespace-nowrap text-xs font-medium">{r.ruleName}</span>
              <span className="block text-2xs text-ink-faint">{r.documentTitle}</span>
            </span>
          ) },
          {
            key: 'scope', header: 'Check Scope', sortable: true,
            value: (r) => (r.availabilityContent ? 'Availability + Content' : 'Availability Only'),
            render: (r) => (
              <span className={clsx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-2xs font-medium', r.availabilityContent ? 'bg-essa-100 text-essa-800' : 'bg-semantic-infoBg text-semantic-info')}>
                {r.availabilityContent ? 'Availability + Content' : 'Availability Only'}
              </span>
            ),
          },
          { key: 'mandatory', header: 'Mandatory', align: 'center', sortable: true, value: (r) => (r.mandatory ? 'Yes' : 'No'), render: (r) => <span className={clsx('text-xs font-semibold', r.mandatory ? 'text-essa-700' : 'text-semantic-error')}>{r.mandatory ? 'Yes' : 'No'}</span> },
          { key: 'missing', header: 'Missing Document Action', align: 'center', sortable: true, value: (r) => r.missingAction, render: (r) => <ActionPill kind={r.missingAction} /> },
          { key: 'content', header: 'Content Validation', align: 'center', sortable: true, value: (r) => (r.contentValidation ? 'Yes' : 'No'), render: (r) => <span className={clsx('text-xs font-semibold', r.contentValidation ? 'text-essa-700' : 'text-semantic-error')}>{r.contentValidation ? 'Yes' : 'No'}</span> },
          { key: 'impact', header: 'Workflow Impact', sortable: true, value: (r) => r.workflowImpact, render: (r) => <span className="whitespace-nowrap text-xs">{r.workflowImpact}</span> },
          {
            key: 'status', header: 'Status', sortable: true, value: (r) => (r.catDoc.active ? 'Active' : 'Off'), render: (r) => (
              <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Toggle checked={r.catDoc.active} disabled={!mayEdit} onChange={() => act('categoryDocuments', 'TOGGLE', { id: r.catDoc.id })} label={`Toggle ${r.ruleName}`} />
                <span className="text-2xs font-medium text-essa-700">{r.catDoc.active ? 'Active' : 'Off'}</span>
              </span>
            ),
          },
          {
            key: 'actions', header: 'Actions', render: (r) => (
              <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button aria-label={`Edit ${r.ruleName}`} disabled={!mayEdit} onClick={() => setEditing(r.catDoc)} className="rounded border border-line p-1 text-ink-muted hover:bg-essa-50 hover:text-essa-700 disabled:opacity-40"><Pencil size={12} /></button>
                <button aria-label={`Delete ${r.ruleName}`} disabled={!mayEdit} onClick={() => act('categoryDocuments', 'DELETE', { id: r.catDoc.id })} className="rounded border border-line p-1 text-ink-muted hover:bg-semantic-errorBg hover:text-semantic-error disabled:opacity-40"><Trash2 size={12} /></button>
              </span>
            ),
          },
        ] satisfies Column<RuleRowVm>[]}
        rows={rows}
        rowKey={(r) => r.catDoc.id}
        onRowClick={(r) => setSelectedId(r.catDoc.id)}
      />

      {/* bottom: rule logic + selected rule details */}
      <div className="grid gap-4 border-t border-line-soft p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-ink">Rule Logic</p>
          <p className="text-xs font-semibold text-ink-secondary">Availability + Content</p>
          <p className="mb-2 text-2xs text-ink-muted">The system verifies the document is present in the invoice PDF and extracts / validates its content against SAP.</p>
          <p className="text-xs font-semibold text-ink-secondary">Availability Only</p>
          <p className="text-2xs text-ink-muted">The system only checks that the document is present. Content is not extracted or compared with SAP.</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">Selected Rule Details</p>
            {selected && <Badge tone="success">Selected: {selected.ruleName}</Badge>}
          </div>
          {selected ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">Rule Name</dt><dd>{selected.ruleName}</dd></div>
              <div><dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">Document Title</dt><dd>{selected.documentTitle}</dd></div>
              <div><dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">Check Scope</dt><dd>{selected.availabilityContent ? 'Availability + Content' : 'Availability Only'}</dd></div>
              <div><dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">Content Validation</dt><dd>{selected.contentValidation ? 'Yes' : 'No'}</dd></div>
              <div><dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">Mandatory</dt><dd>{selected.mandatory ? 'Yes' : 'No'}</dd></div>
              <div><dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">Missing Document Action</dt><dd>{selected.missingAction === 'Block' ? 'Create exception and block workflow until uploaded.' : 'Create exception; workflow continues with a warning.'}</dd></div>
            </dl>
          ) : (
            <p className="py-4 text-center text-2xs text-ink-muted">Select a rule row to view its details.</p>
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 border-t border-line-soft bg-essa-50/50 px-4 py-2 text-2xs text-ink-secondary">
        ⓘ Supporting documents configured as Availability Only are checked for presence in the invoice PDF, but their content is not extracted or compared with SAP.
      </p>

      {/* Add / edit rule modal — matches the approved dialog */}
      <RuleModal
        open={addOpen || Boolean(editing)}
        cats={cats}
        defaultCategoryId={filterCat?.id ?? ''}
        editing={editing}
        docTypes={bundle.documentTypes}
        docTitleOf={(d) => docType(d.documentTypeId)?.name ?? ''}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSubmit={(v) => {
          if (editing) {
            act('categoryDocuments', 'UPDATE', {
              ...editing,
              requirementType: v.mandatory ? 'MANDATORY' : 'OPTIONAL',
              checkMode: v.availabilityContent ? 'EXTRACT_AND_VALIDATE' : 'AVAILABILITY_ONLY',
              contentCheckRequired: v.contentValidation,
              blocking: v.missingAction === 'Block',
              active: v.active,
            });
          } else {
            const dt = bundle.documentTypes.find((t) => t.name.toLowerCase() === v.documentTitle.trim().toLowerCase()) ?? bundle.documentTypes.find((t) => t.id === v.documentTypeId);
            if (!dt) return false;
            act('categoryDocuments', 'CREATE', {
              categoryId: v.categoryId,
              documentTypeId: dt.id,
              requirementType: v.mandatory ? 'MANDATORY' : 'OPTIONAL',
              checkMode: v.availabilityContent ? 'EXTRACT_AND_VALIDATE' : 'AVAILABILITY_ONLY',
              contentCheckRequired: v.contentValidation,
              availabilityCheckRequired: true,
              allowMultiple: false,
              blocking: v.missingAction === 'Block',
              overrideAllowed: false,
              active: v.active,
              sequence: rows.length + 1,
              configVersionId: 'cfg-1',
            });
          }
          setAddOpen(false);
          setEditing(null);
          return true;
        }}
      />
    </div>
  );
}

function RuleModal({
  open, cats, defaultCategoryId, editing, docTypes, docTitleOf, onClose, onSubmit,
}: {
  open: boolean;
  cats: Category[];
  defaultCategoryId: string;
  editing: CatDoc | null;
  docTypes: ConfigBundle['documentTypes'];
  docTitleOf: (d: CatDoc) => string;
  onClose: () => void;
  onSubmit: (v: { categoryId: string; documentTitle: string; documentTypeId: string; ruleName: string; availabilityContent: boolean; mandatory: boolean; missingAction: 'Block' | 'Warning'; contentValidation: boolean; active: boolean }) => boolean;
}) {
  const [v, setV] = useState({
    categoryId: defaultCategoryId,
    documentTypeId: '',
    documentTitle: '',
    ruleName: '',
    availabilityContent: true,
    mandatory: true,
    missingAction: 'Block' as 'Block' | 'Warning',
    contentValidation: true,
    active: true,
  });
  const [seeded, setSeeded] = useState('');
  const key = editing ? editing.id : open ? 'new' : '';
  if (open && seeded !== key) {
    setSeeded(key);
    if (editing) {
      setV({
        categoryId: editing.categoryId,
        documentTypeId: editing.documentTypeId,
        documentTitle: docTitleOf(editing),
        ruleName: `${docTitleOf(editing)} ${editing.checkMode === 'AVAILABILITY_ONLY' ? 'Availability' : 'Check'}`,
        availabilityContent: editing.checkMode !== 'AVAILABILITY_ONLY',
        mandatory: editing.requirementType === 'MANDATORY',
        missingAction: editing.blocking ? 'Block' : 'Warning',
        contentValidation: editing.contentCheckRequired,
        active: editing.active,
      });
    } else {
      setV((prev) => ({ ...prev, categoryId: defaultCategoryId, documentTypeId: '', documentTitle: '', ruleName: '' }));
    }
  }
  if (!open) return null;
  const workflowImpact = v.missingAction === 'Block' ? 'Exception + Hold' : 'Exception';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit rule — ${docTitleOf(editing)}` : 'Add rule'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!v.categoryId || (!editing && !v.documentTypeId && !v.documentTitle.trim())}
            onClick={() => onSubmit(v)}
          >
            {editing ? 'Save rule' : 'Add rule'}
          </Button>
        </>
      }
    >
      <p className="-mt-1 mb-3 text-2xs text-ink-muted">Define how a supporting document is checked during invoice validation.</p>
      <div className="space-y-3">
        <Field label="Invoice category">
          <Select value={v.categoryId} onChange={(e) => setV((s) => ({ ...s, categoryId: e.target.value }))} className="w-full" disabled={Boolean(editing)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!editing && (
          <Field label="Document title">
            <Select value={v.documentTypeId} onChange={(e) => setV((s) => ({ ...s, documentTypeId: e.target.value }))} className="w-full">
              <option value="">e.g. Attendance Sheet…</option>
              {docTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Rule name">
          <Input value={v.ruleName} placeholder="e.g. Attendance Sheet Availability" onChange={(e) => setV((s) => ({ ...s, ruleName: e.target.value }))} />
        </Field>
        <Field label="Check scope">
          <Select value={v.availabilityContent ? 'AC' : 'A'} onChange={(e) => setV((s) => ({ ...s, availabilityContent: e.target.value === 'AC', contentValidation: e.target.value === 'AC' ? s.contentValidation : false }))} className="w-full">
            <option value="AC">Availability + Content</option>
            <option value="A">Availability Only</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mandatory">
            <Select value={v.mandatory ? 'Yes' : 'No'} onChange={(e) => setV((s) => ({ ...s, mandatory: e.target.value === 'Yes' }))} className="w-full">
              <option>Yes</option><option>No</option>
            </Select>
          </Field>
          <Field label="Missing document action">
            <Select value={v.missingAction} onChange={(e) => setV((s) => ({ ...s, missingAction: e.target.value as 'Block' | 'Warning' }))} className="w-full">
              <option>Block</option><option>Warning</option>
            </Select>
          </Field>
          <Field label="Content validation">
            <Select value={v.contentValidation ? 'Yes' : 'No'} disabled={!v.availabilityContent} onChange={(e) => setV((s) => ({ ...s, contentValidation: e.target.value === 'Yes' }))} className="w-full">
              <option>Yes</option><option>No</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={v.active ? 'Active' : 'Inactive'} onChange={(e) => setV((s) => ({ ...s, active: e.target.value === 'Active' }))} className="w-full">
              <option>Active</option><option>Inactive</option>
            </Select>
          </Field>
        </div>
        <Field label="Workflow impact">
          <Input value={workflowImpact} disabled />
        </Field>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- Workflows

function WorkflowsPointer() {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <span className="rounded-full bg-essa-50 p-3 text-essa-600"><GitBranch size={22} /></span>
      <p className="text-sm font-semibold text-ink">Approval workflows &amp; approval hierarchy</p>
      <p className="max-w-md text-xs text-ink-muted">
        Approval workflows and the amount-based approval hierarchy are managed in Administration &rarr; Workflows &amp; Approval Hierarchy.
      </p>
      <Link to="/admin/workflows" className="inline-flex h-8 items-center rounded-md bg-essa-600 px-3 text-sm font-medium text-white hover:bg-essa-700">
        Open Workflows &amp; Approval Hierarchy →
      </Link>
    </div>
  );
}

