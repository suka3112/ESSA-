/**
 * Administration → SLA & Reminders.
 *
 * Three tabs, because they are three different things an administrator
 * maintains and only one is being worked on at a time (review, 25 Aug):
 *
 *  · SLA Targets — the ESSA EAPA SLA Matrix (BPD v0.1.4 §11.3): one target per
 *    activity type and processing stage, in working days. Exactly one clock
 *    runs at a time, so the stage that is running is the stage the invoice is
 *    in. "Not applicable" is a real answer and is shown as such.
 *  · Reminders & Escalations — the workflow timers of BPD §11.4.
 *  · Exception Codes — the agreed catalogue: ONE code per error type, the same
 *    for every invoice, category and vendor (review, 24 Aug).
 *
 * Each tab can add a new record, edit an existing one, and enable or disable
 * it. Nothing is deleted outright: a target, timer or code that has already
 * been applied to an invoice stays readable in history.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Pencil, Power } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, Field, Input, LoadingState, Modal, PageHeader,
  Select, StatusBadge, Tabs, Textarea, Tooltip, useToast, type Column,
} from '@/components/ui';

type Stage = 'INVOICE_CREATION' | 'TAX_REVIEW' | 'AP_APPROVAL' | 'PAYMENT';

interface SlaRule {
  id: string; activityType: string; categoryId?: string; stage: Stage;
  days: number | null; confidence: 'DEFINED' | 'PROVISIONAL' | 'NOT_APPLICABLE';
  note?: string; active: boolean;
}
interface ReminderRule {
  id: string; name: string; trigger: string; afterHours: number;
  recipient: string; action: string; active: boolean;
}
interface ExceptionCodeRow {
  id: string; code: string; type: string; label: string; description: string;
  documentTypeId?: string; active: boolean;
}
interface Lookups {
  categories: { id: string; name: string }[];
  documentTypes: { id: string; name: string }[];
  slaRules: SlaRule[];
  reminderRules: ReminderRule[];
  exceptionCodes: ExceptionCodeRow[];
}

/** The four stages an SLA clock can run in, in lifecycle order. */
const STAGES: { key: Stage; label: string; tip: string }[] = [
  { key: 'INVOICE_CREATION', label: 'Invoice Creation', tip: 'From receiving the invoice until it is created and verified by the AP team.' },
  { key: 'TAX_REVIEW', label: 'Tax Review', tip: 'Time allowed for the Tax Team to review the invoice.' },
  { key: 'AP_APPROVAL', label: 'Approval', tip: 'Time allowed for the approval hierarchy to complete.' },
  { key: 'PAYMENT', label: 'Payment', tip: 'From parking in SAP until the payment is cleared.' },
];

/** The error types an exception code can describe (BPD §11.6). */
const EXCEPTION_TYPES = [
  'MISSING_DOCUMENT', 'EXTRACTION_FAILURE', 'LOW_CONFIDENCE', 'VALIDATION_FAILURE',
  'MISSING_SAP_REFERENCE', 'VENDOR_ISSUE', 'TAX_ISSUE', 'APPROVAL_ISSUE',
  'INTEGRATION_FAILURE', 'TECHNICAL_FAILURE',
];

const RECIPIENTS = ['Approver', 'Approver + AP Supervisor', 'AP Supervisor', 'Next approval level', 'Head of Function', 'Vendor', 'AP Team'];

/** One activity type, with its target at each stage. */
interface MatrixRow {
  key: string;
  activityType: string;
  categoryId?: string;
  categoryName: string;
  cells: Partial<Record<Stage, SlaRule>>;
}

type StageDays = Record<Stage, string>;
const BLANK_DAYS: StageDays = { INVOICE_CREATION: '', TAX_REVIEW: '', AP_APPROVAL: '', PAYMENT: '' };

interface SlaDraft { original?: MatrixRow; activityType: string; categoryId: string; days: StageDays }
interface TimerDraft { original?: ReminderRule; name: string; trigger: string; afterHours: string; recipient: string; action: string }
interface CodeDraft { original?: ExceptionCodeRow; code: string; type: string; label: string; description: string; documentTypeId: string }

const EMPTY_TIMER: TimerDraft = { name: '', trigger: '', afterHours: '24', recipient: 'Approver', action: 'Email reminder' };
const EMPTY_CODE: CodeDraft = { code: '', type: 'VALIDATION_FAILURE', label: '', description: '', documentTypeId: '' };

function daysLabel(rule?: SlaRule): string {
  if (!rule) return 'Not set';
  if (rule.days == null) return 'Not applicable';
  return `${rule.days} ${rule.days === 1 ? 'day' : 'days'}`;
}

function hoursLabel(hours: number): string {
  if (hours === 0) return 'Immediately';
  if (hours % 24 === 0) return `${hours / 24} ${hours / 24 === 1 ? 'day' : 'days'}`;
  return `${hours} hours`;
}

export default function SlaPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const toast = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'targets' | 'reminders' | 'codes'>('targets');
  const [slaDraft, setSlaDraft] = useState<SlaDraft | null>(null);
  const [timerDraft, setTimerDraft] = useState<TimerDraft | null>(null);
  const [codeDraft, setCodeDraft] = useState<CodeDraft | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });

  const save = useMutation({
    mutationFn: (p: { entity: string; op: string; row: Record<string, unknown> }) =>
      api.post(`/configuration/entities/${p.entity}`, { op: p.op, row: p.row }),
    onError: (e) => toast.push({ tone: 'error', title: 'Save failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  /** Save one or more rows, then refresh everything the change can affect. */
  const commit = async (rows: { entity: string; op: string; row: Record<string, unknown> }[], message: string) => {
    for (const r of rows) await save.mutateAsync(r).catch(() => undefined);
    toast.push({ tone: 'success', title: message, detail: 'Running SLA clocks were recalculated.' });
    qc.invalidateQueries({ queryKey: ['lookups'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['exceptions'] });
  };

  const matrix = useMemo<MatrixRow[]>(() => {
    const map = new Map<string, MatrixRow>();
    for (const r of data?.slaRules ?? []) {
      const key = `${r.activityType}|${r.categoryId ?? ''}`;
      const row = map.get(key) ?? {
        key,
        activityType: r.activityType,
        categoryId: r.categoryId,
        categoryName: r.categoryId
          ? data?.categories.find((c) => c.id === r.categoryId)?.name ?? '—'
          : 'All categories',
        cells: {},
      };
      row.cells[r.stage] = r;
      map.set(key, row);
    }
    return [...map.values()];
  }, [data?.slaRules, data?.categories]);

  if (isLoading || !data) return <LoadingState />;

  // ------------------------------------------------------------ SLA targets
  const openSlaEditor = (row?: MatrixRow) =>
    setSlaDraft({
      original: row,
      activityType: row?.activityType ?? '',
      categoryId: row?.categoryId ?? '',
      days: row
        ? (Object.fromEntries(STAGES.map((s) => [s.key, row.cells[s.key]?.days == null ? '' : String(row.cells[s.key]!.days)])) as StageDays)
        : { ...BLANK_DAYS },
    });

  const saveSla = async () => {
    if (!slaDraft) return;
    const { original, activityType, categoryId, days } = slaDraft;
    const rows: { entity: string; op: string; row: Record<string, unknown> }[] = [];
    for (const s of STAGES) {
      const raw = days[s.key].trim();
      const value = raw === '' ? null : Number(raw);
      const existing = original?.cells[s.key];
      const confidence = value == null ? 'NOT_APPLICABLE' : existing?.confidence === 'NOT_APPLICABLE' || !existing ? 'DEFINED' : existing.confidence;
      if (existing) {
        if (existing.days === value && existing.activityType === activityType.trim() && (existing.categoryId ?? '') === categoryId) continue;
        rows.push({ entity: 'slaRules', op: 'UPDATE', row: { ...existing, activityType: activityType.trim(), categoryId: categoryId || undefined, days: value, confidence } });
      } else {
        // A stage with no target yet is only created once it has been given one.
        if (value == null) continue;
        rows.push({
          entity: 'slaRules', op: 'CREATE',
          row: { activityType: activityType.trim(), categoryId: categoryId || undefined, stage: s.key, days: value, confidence, active: true },
        });
      }
    }
    setSlaDraft(null);
    if (rows.length) await commit(rows, original ? 'SLA targets updated' : 'SLA target added');
  };

  // ------------------------------------------------------------- reminders
  const openTimerEditor = (rule?: ReminderRule) =>
    setTimerDraft(rule
      ? { original: rule, name: rule.name, trigger: rule.trigger, afterHours: String(rule.afterHours), recipient: rule.recipient, action: rule.action }
      : { ...EMPTY_TIMER });

  const saveTimer = async () => {
    if (!timerDraft) return;
    const { original, name, trigger, afterHours, recipient, action } = timerDraft;
    const row = {
      ...(original ?? { active: true }),
      name: name.trim(), trigger: trigger.trim(), recipient, action: action.trim(),
      afterHours: Math.max(0, Number(afterHours) || 0),
    };
    setTimerDraft(null);
    await commit([{ entity: 'reminderRules', op: original ? 'UPDATE' : 'CREATE', row }], original ? 'Reminder updated' : 'Reminder added');
  };

  // -------------------------------------------------------- exception codes
  const openCodeEditor = (code?: ExceptionCodeRow) =>
    setCodeDraft(code
      ? { original: code, code: code.code, type: code.type, label: code.label, description: code.description, documentTypeId: code.documentTypeId ?? '' }
      : { ...EMPTY_CODE });

  /** Next free code in the range that matches the type (E-11xx = missing document). */
  const suggestCode = (type: string) => {
    const missing = type === 'MISSING_DOCUMENT';
    const prefix = missing ? 11 : 10;
    const used = (data.exceptionCodes ?? [])
      .map((c) => Number(c.code.replace(/\D/g, '')))
      .filter((n) => !Number.isNaN(n) && Math.floor(n / 100) === prefix);
    return `E-${(used.length ? Math.max(...used) : prefix * 100) + 1}`;
  };

  const duplicateCode = Boolean(
    codeDraft &&
    codeDraft.code.trim() &&
    (data.exceptionCodes ?? []).some((c) => c.code.toLowerCase() === codeDraft.code.trim().toLowerCase() && c.id !== codeDraft.original?.id)
  );

  const saveCode = async () => {
    if (!codeDraft || duplicateCode) return;
    const { original, code, type, label, description, documentTypeId } = codeDraft;
    const row = {
      ...(original ?? { active: true }),
      code: code.trim().toUpperCase(), type, label: label.trim(), description: description.trim(),
      documentTypeId: type === 'MISSING_DOCUMENT' ? documentTypeId || undefined : undefined,
    };
    setCodeDraft(null);
    await commit([{ entity: 'exceptionCodes', op: original ? 'UPDATE' : 'CREATE', row }], original ? 'Exception code updated' : 'Exception code added');
  };

  // ------------------------------------------------------------------ tables
  const slaColumns: Column<MatrixRow>[] = [
    { key: 'activityType', header: 'Invoice / Activity Type', sortable: true, value: (r) => r.activityType, render: (r) => <span className="font-medium">{r.activityType}</span> },
    { key: 'category', header: 'Invoice Category', sortable: true, value: (r) => r.categoryName, render: (r) => <span className="text-xs text-ink-muted">{r.categoryName}</span> },
    ...STAGES.map((s) => ({
      key: s.key,
      header: (<Tooltip text={s.tip}><span>{s.label}</span></Tooltip>),
      align: 'center' as const,
      value: (r: MatrixRow) => r.cells[s.key]?.days ?? -1,
      render: (r: MatrixRow) => {
        const rule = r.cells[s.key];
        if (!rule || rule.days == null) return <span className="text-2xs text-ink-faint">Not applicable</span>;
        return (
          <span className="inline-flex items-center gap-1">
            <span className="whitespace-nowrap text-xs font-medium">{daysLabel(rule)}</span>
            {rule.confidence === 'PROVISIONAL' && (
              <Tooltip text={rule.note ?? 'This target is provisional and still to be confirmed by ESSA.'}>
                <Badge tone="warning">Provisional</Badge>
              </Tooltip>
            )}
          </span>
        );
      },
    })),
    {
      key: 'actions', header: 'Action', align: 'center', sticky: true,
      render: (r) =>
        canEdit ? (
          <Button size="sm" variant="ghost" aria-label={`Edit SLA targets for ${r.activityType}`} title="Edit the targets for this activity type" onClick={() => openSlaEditor(r)}>
            <Pencil size={13} />
          </Button>
        ) : null,
    },
  ];

  const timerColumns: Column<ReminderRule>[] = [
    { key: 'name', header: 'Timer', sortable: true, value: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'trigger', header: 'Trigger', sortable: true, value: (r) => r.trigger, render: (r) => <span className="text-xs text-ink-secondary">{r.trigger}</span> },
    { key: 'afterHours', header: 'Sent After', align: 'right', sortable: true, value: (r) => r.afterHours, render: (r) => <span className="whitespace-nowrap text-xs">{hoursLabel(r.afterHours)}</span> },
    { key: 'recipient', header: 'Recipient', sortable: true, value: (r) => r.recipient, render: (r) => <span className="text-xs">{r.recipient}</span> },
    { key: 'action', header: 'What Happens', sortable: true, value: (r) => r.action, render: (r) => <span className="text-xs text-ink-secondary">{r.action}</span> },
    { key: 'active', header: 'Status', sortable: true, value: (r) => (r.active ? 'Enabled' : 'Disabled'), render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} label={r.active ? 'Enabled' : 'Disabled'} /> },
    {
      key: 'actions', header: 'Action', align: 'center', sticky: true,
      render: (r) =>
        canEdit ? (
          <div className="flex justify-center gap-1">
            <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} title="Change this reminder" onClick={() => openTimerEditor(r)}>
              <Pencil size={13} />
            </Button>
            <Button
              size="sm" variant="ghost"
              aria-label={r.active ? `Disable ${r.name}` : `Enable ${r.name}`}
              title={r.active ? 'Disable this reminder' : 'Enable this reminder'}
              onClick={() => commit([{ entity: 'reminderRules', op: 'TOGGLE', row: { id: r.id } }], r.active ? 'Reminder disabled' : 'Reminder enabled')}
            >
              <Power size={13} />
            </Button>
          </div>
        ) : null,
    },
  ];

  const codeColumns: Column<ExceptionCodeRow>[] = [
    { key: 'code', header: 'Exception Code', sortable: true, value: (r) => r.code, render: (r) => <span className="font-mono text-2xs font-semibold text-ink-secondary">{r.code}</span> },
    { key: 'type', header: 'Exception Type', sortable: true, value: (r) => titleCase(r.type), render: (r) => <span className="text-xs">{titleCase(r.type)}</span> },
    { key: 'label', header: 'Name', sortable: true, value: (r) => r.label, render: (r) => <span className="text-xs font-medium">{r.label}</span> },
    { key: 'description', header: 'What It Means', value: (r) => r.description, render: (r) => <span className="text-xs text-ink-secondary">{r.description}</span> },
    { key: 'active', header: 'Status', sortable: true, value: (r) => (r.active ? 'Enabled' : 'Disabled'), render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} label={r.active ? 'Enabled' : 'Disabled'} /> },
    {
      key: 'actions', header: 'Action', align: 'center', sticky: true,
      render: (r) =>
        canEdit ? (
          <div className="flex justify-center gap-1">
            <Button size="sm" variant="ghost" aria-label={`Edit ${r.code}`} title="Edit this exception code" onClick={() => openCodeEditor(r)}>
              <Pencil size={13} />
            </Button>
            <Button
              size="sm" variant="ghost"
              aria-label={r.active ? `Disable ${r.code}` : `Enable ${r.code}`}
              title={r.active ? 'Stop using this code for new exceptions' : 'Use this code again'}
              onClick={() => commit([{ entity: 'exceptionCodes', op: 'TOGGLE', row: { id: r.id } }], r.active ? 'Exception code disabled' : 'Exception code enabled')}
            >
              <Power size={13} />
            </Button>
          </div>
        ) : null,
    },
  ];

  const TABS = [
    { key: 'targets', label: 'SLA Targets' },
    { key: 'reminders', label: 'Reminders & Escalations' },
    { key: 'codes', label: 'Exception Codes' },
  ];
  const counts = { targets: matrix.length, reminders: data.reminderRules?.length ?? 0, codes: data.exceptionCodes?.length ?? 0 };

  const TAB_NOTE: Record<string, string> = {
    targets: 'Targets are in working days. One clock runs at a time — the stage the invoice is currently in.',
    reminders: 'Sent by email and Microsoft Teams.',
    codes: 'One code per error type — the same code whatever the invoice, category or vendor.',
  };
  const ADD_LABEL: Record<string, string> = {
    targets: 'Add SLA target',
    reminders: 'Add reminder',
    codes: 'Add exception code',
  };
  const onAdd = () => {
    if (tab === 'targets') openSlaEditor();
    else if (tab === 'reminders') openTimerEditor();
    else openCodeEditor();
  };

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'SLA & Reminders' }]}
        title="SLA & Reminders"
        description="How long each stage of invoice processing is allowed to take, when reminders and escalations are sent, and the exception codes the platform raises."
        actions={canEdit ? <Button size="sm" onClick={onAdd}><CirclePlus size={13} /> {ADD_LABEL[tab]}</Button> : undefined}
      />

      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as typeof tab)} counts={counts} />
        </div>
        <p className="px-4 py-2 text-2xs text-ink-muted">{TAB_NOTE[tab]}</p>

        {tab === 'targets' && <DataTable columns={slaColumns} rows={matrix} rowKey={(r) => r.key} dense />}
        {tab === 'reminders' && <DataTable columns={timerColumns} rows={data.reminderRules ?? []} rowKey={(r) => r.id} dense />}
        {tab === 'codes' && <DataTable columns={codeColumns} rows={data.exceptionCodes ?? []} rowKey={(r) => r.id} dense />}
      </Card>

      {/* ------------------------------------------------ SLA target editor */}
      <Modal
        open={Boolean(slaDraft)}
        onClose={() => setSlaDraft(null)}
        title={slaDraft?.original ? `SLA targets — ${slaDraft.original.activityType}` : 'Add SLA target'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSlaDraft(null)}>Cancel</Button>
            <Button
              loading={save.isPending}
              disabled={!slaDraft?.activityType.trim() || !STAGES.some((s) => slaDraft?.days[s.key].trim())}
              onClick={saveSla}
            >
              {slaDraft?.original ? 'Save targets' : 'Add SLA target'}
            </Button>
          </>
        }
      >
        {slaDraft && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Invoice / activity type" required hint="As it is named in the SLA matrix, e.g. Material or PIB Payments">
                <Input
                  value={slaDraft.activityType}
                  placeholder="e.g. Material import"
                  onChange={(e) => setSlaDraft((p) => p && ({ ...p, activityType: e.target.value }))}
                />
              </Field>
              <Field label="Invoice category" hint="Leave blank when the target applies whatever the category">
                <Select value={slaDraft.categoryId} onChange={(e) => setSlaDraft((p) => p && ({ ...p, categoryId: e.target.value }))} className="w-full">
                  <option value="">All categories</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-ink-secondary">
              Targets are in working days. Leave a stage blank when it does not apply to this activity type — no SLA clock
              will run for it.
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              {STAGES.map((s) => (
                <Field key={s.key} label={s.label} hint={s.tip}>
                  <Input
                    type="number" min={0} max={90}
                    value={slaDraft.days[s.key]}
                    placeholder="Not applicable"
                    onChange={(e) => setSlaDraft((p) => p && ({ ...p, days: { ...p.days, [s.key]: e.target.value } }))}
                  />
                </Field>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* -------------------------------------------------- reminder editor */}
      <Modal
        open={Boolean(timerDraft)}
        onClose={() => setTimerDraft(null)}
        title={timerDraft?.original ? `Reminder — ${timerDraft.original.name}` : 'Add reminder'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setTimerDraft(null)}>Cancel</Button>
            <Button
              loading={save.isPending}
              disabled={!timerDraft?.name.trim() || !timerDraft?.trigger.trim() || !timerDraft?.action.trim()}
              onClick={saveTimer}
            >
              {timerDraft?.original ? 'Save reminder' : 'Add reminder'}
            </Button>
          </>
        }
      >
        {timerDraft && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Timer name" required>
                <Input value={timerDraft.name} placeholder="e.g. Approval — 1st reminder" onChange={(e) => setTimerDraft((p) => p && ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="Sent after (hours)" required hint="0 sends the notice as soon as the trigger happens">
                <Input type="number" min={0} max={2000} value={timerDraft.afterHours} onChange={(e) => setTimerDraft((p) => p && ({ ...p, afterHours: e.target.value }))} />
              </Field>
            </div>
            <Field label="Trigger" required hint="What has to happen — or not happen — for this reminder to be sent">
              <Input value={timerDraft.trigger} placeholder="e.g. No approver action after the initial notification" onChange={(e) => setTimerDraft((p) => p && ({ ...p, trigger: e.target.value }))} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Recipient" required>
                <Select value={timerDraft.recipient} onChange={(e) => setTimerDraft((p) => p && ({ ...p, recipient: e.target.value }))} className="w-full">
                  {RECIPIENTS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="What happens" required>
                <Input value={timerDraft.action} placeholder="e.g. Email reminder" onChange={(e) => setTimerDraft((p) => p && ({ ...p, action: e.target.value }))} />
              </Field>
            </div>
          </div>
        )}
      </Modal>

      {/* -------------------------------------------- exception code editor */}
      <Modal
        open={Boolean(codeDraft)}
        onClose={() => setCodeDraft(null)}
        title={codeDraft?.original ? `Exception code — ${codeDraft.original.code}` : 'Add exception code'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCodeDraft(null)}>Cancel</Button>
            <Button
              loading={save.isPending}
              disabled={!codeDraft?.code.trim() || !codeDraft?.label.trim() || duplicateCode}
              onClick={saveCode}
            >
              {codeDraft?.original ? 'Save exception code' : 'Add exception code'}
            </Button>
          </>
        }
      >
        {codeDraft && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Exception type" required hint="There is one code per error type — pick the type this code describes">
                <Select
                  value={codeDraft.type}
                  onChange={(e) => setCodeDraft((p) => p && ({ ...p, type: e.target.value, code: p.code || suggestCode(e.target.value) }))}
                  className="w-full"
                >
                  {EXCEPTION_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                </Select>
              </Field>
              <Field label="Exception code" required hint={duplicateCode ? undefined : 'Shown on the Exception Workbench and in vendor correspondence'}>
                <Input
                  value={codeDraft.code}
                  placeholder={suggestCode(codeDraft.type)}
                  className="font-mono"
                  onChange={(e) => setCodeDraft((p) => p && ({ ...p, code: e.target.value }))}
                />
              </Field>
            </div>
            {duplicateCode && (
              <p className="rounded-md bg-semantic-errorBg px-2.5 py-1.5 text-2xs text-semantic-error">
                {codeDraft.code.trim().toUpperCase()} is already in use. Every code has to be unique so that filtering by a
                code returns one error type and nothing else.
              </p>
            )}
            {codeDraft.type === 'MISSING_DOCUMENT' && (
              <Field label="Which document" hint="Missing-document errors carry one code per document, because which document is missing is the error">
                <Select value={codeDraft.documentTypeId} onChange={(e) => setCodeDraft((p) => p && ({ ...p, documentTypeId: e.target.value }))} className="w-full">
                  <option value="">Any supporting document</option>
                  {(data.documentTypes ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Name" required hint="The short name the AP team sees on the Exception Workbench">
              <Input value={codeDraft.label} placeholder="e.g. Goods receipt note missing" onChange={(e) => setCodeDraft((p) => p && ({ ...p, label: e.target.value }))} />
            </Field>
            <Field label="What it means" hint="Explains the error in plain language">
              <Textarea
                rows={2}
                value={codeDraft.description}
                placeholder="e.g. The goods receipt note is missing from the bundle."
                onChange={(e) => setCodeDraft((p) => p && ({ ...p, description: e.target.value }))}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
