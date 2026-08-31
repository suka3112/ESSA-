/**
 * Administration → Email Templates.
 *
 * Every outbound email scenario on the platform (approvals, exceptions,
 * rejections, reminders, configuration notices …) renders its subject and
 * body from the templates managed here — the sending infrastructure itself is
 * untouched. Admin-only: CONFIG_VIEW to look, CONFIG_EDIT to change.
 *
 * The page follows the product's admin patterns: searchable/filterable table
 * with pagination, a drawer editor with a live sample-data preview, required-
 * placeholder validation before save, and a per-template version history.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bold, CirclePlus, Copy, Eye, History, Italic, Link2, List, ListOrdered,
  Pencil, RotateCcw, Search, Send, Table as TableIcon, Trash2, Underline,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Drawer, Field, Input,
  LoadingState, Modal, PageHeader, Pagination, Select, StatusBadge, Tabs,
  Tooltip, useToast, type Column,
} from '@/components/ui';

// ------------------------------------------------------------ types

interface Recipients { to: string; cc?: string; bcc?: string }

interface TemplateRow {
  id: string;
  name: string;
  scenario: string;
  description?: string;
  subject: string;
  bodyHtml: string;
  recipients: Recipients;
  requiredPlaceholders: string[];
  status: 'ACTIVE' | 'INACTIVE';
  system: boolean;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

interface ScenarioVariable { name: string; label: string; sample: string }

interface ScenarioInfo {
  key: string;
  label: string;
  description: string;
  category: string;
  recipients: Recipients;
  variables: ScenarioVariable[];
  required: string[];
}

interface ListPayload { items: TemplateRow[]; scenarios: ScenarioInfo[] }

interface VersionRow {
  id: string;
  templateId: string;
  version: number;
  action: string;
  snapshot: Pick<TemplateRow, 'name' | 'scenario' | 'description' | 'subject' | 'bodyHtml' | 'recipients' | 'requiredPlaceholders' | 'status'>;
  changedAt: string;
  changedBy: string;
  note?: string;
}

// ------------------------------------------------------------ shared rendering helpers (mirror the server)

function renderString(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => ctx[name] ?? `{{${name}}}`);
}

function htmlToText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').trim();
}

function extractPlaceholders(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) for (const m of part.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}

function sampleCtx(scenario: ScenarioInfo | undefined): Record<string, string> {
  return Object.fromEntries((scenario?.variables ?? []).map((v) => [v.name, v.sample]));
}

/** Validation mirrors the server rules so problems surface before saving. */
function validateDraft(d: Draft, scenario: ScenarioInfo | undefined): string[] {
  const problems: string[] = [];
  if (!d.name.trim()) problems.push('Template name is required.');
  if (!d.scenario) problems.push('A scenario/event is required.');
  if (!d.subject.trim()) problems.push('Subject is required.');
  if (!htmlToText(d.bodyHtml)) problems.push('Email body is required.');
  if (!d.to.trim()) problems.push('A To recipient is required.');
  if (scenario) {
    const used = extractPlaceholders(d.subject, d.bodyHtml);
    const known = new Set(scenario.variables.map((v) => v.name));
    const missing = scenario.required.filter((r) => !used.includes(r));
    if (missing.length) problems.push(`Required placeholder${missing.length > 1 ? 's' : ''} missing: ${missing.map((m) => `{{${m}}}`).join(', ')}.`);
    const unknown = used.filter((u) => !known.has(u));
    if (unknown.length) problems.push(`Unknown placeholder${unknown.length > 1 ? 's' : ''} for this scenario: ${unknown.map((m) => `{{${m}}}`).join(', ')}.`);
  }
  return problems;
}

// ------------------------------------------------------------ rich text editor

/**
 * Lightweight rich-text editor on contentEditable — formatting, lists, links
 * and simple tables (the formats the product's emails use). Uncontrolled: the
 * parent remounts it (key=) when a different template is opened.
 */
function RichTextEditor({ defaultValue, onChange, editorRef }: {
  defaultValue: string;
  onChange: (html: string) => void;
  editorRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };
  const insertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url) exec('createLink', url);
  };
  const insertTable = () => {
    exec(
      'insertHTML',
      '<table style="border-collapse:collapse;width:100%"><tbody>' +
        '<tr><td style="border:1px solid #d1d5db;padding:4px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:4px 8px">&nbsp;</td></tr>' +
        '<tr><td style="border:1px solid #d1d5db;padding:4px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:4px 8px">&nbsp;</td></tr>' +
        '</tbody></table><p></p>'
    );
  };
  const tools: { icon: React.ReactNode; label: string; run: () => void }[] = [
    { icon: <Bold size={13} />, label: 'Bold', run: () => exec('bold') },
    { icon: <Italic size={13} />, label: 'Italic', run: () => exec('italic') },
    { icon: <Underline size={13} />, label: 'Underline', run: () => exec('underline') },
    { icon: <List size={13} />, label: 'Bulleted list', run: () => exec('insertUnorderedList') },
    { icon: <ListOrdered size={13} />, label: 'Numbered list', run: () => exec('insertOrderedList') },
    { icon: <Link2 size={13} />, label: 'Insert link', run: insertLink },
    { icon: <TableIcon size={13} />, label: 'Insert table', run: insertTable },
  ];
  return (
    <div className="overflow-hidden rounded-md border border-line focus-within:border-essa-600">
      <div className="flex items-center gap-0.5 border-b border-line-soft bg-canvas px-1.5 py-1">
        {tools.map((t) => (
          <Tooltip key={t.label} text={t.label}>
            <button
              type="button"
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.run}
              className="rounded p-1.5 text-ink-secondary hover:bg-line-soft"
            >
              {t.icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        className="prose-sm min-h-[160px] max-h-72 overflow-y-auto px-3 py-2 text-sm text-ink outline-none scrollbar-thin [&_a]:text-essablue-500 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: defaultValue }}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}

// ------------------------------------------------------------ editor drawer

interface Draft {
  name: string;
  scenario: string;
  description: string;
  subject: string;
  bodyHtml: string;
  to: string;
  cc: string;
  bcc: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const emptyDraft = (scenario = ''): Draft => ({
  name: '', scenario, description: '', subject: '', bodyHtml: '<p></p>', to: '', cc: '', bcc: '', status: 'ACTIVE',
});

const draftOf = (t: TemplateRow): Draft => ({
  name: t.name, scenario: t.scenario, description: t.description ?? '', subject: t.subject, bodyHtml: t.bodyHtml,
  to: t.recipients.to, cc: t.recipients.cc ?? '', bcc: t.recipients.bcc ?? '', status: t.status,
});

function EditorDrawer({ open, onClose, editing, scenarios, canEdit }: {
  open: boolean;
  onClose: () => void;
  /** null = create new. */
  editing: TemplateRow | null;
  scenarios: ScenarioInfo[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('edit');
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showProblems, setShowProblems] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const lastFocus = useRef<'subject' | 'body'>('body');

  useEffect(() => {
    if (!open) return;
    setTab('edit');
    setShowProblems(false);
    setDraft(editing ? draftOf(editing) : emptyDraft(scenarios[0]?.key ?? ''));
  }, [open, editing, scenarios]);

  const scenario = scenarios.find((s) => s.key === draft.scenario);
  const problems = validateDraft(draft, scenario);
  const ctx = sampleCtx(scenario);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name, scenario: draft.scenario, description: draft.description,
        subject: draft.subject, bodyHtml: draft.bodyHtml, status: draft.status,
        recipients: { to: draft.to, cc: draft.cc || undefined, bcc: draft.bcc || undefined },
      };
      return editing
        ? api.post(`/admin/email-templates/${editing.id}/update`, payload)
        : api.post('/admin/email-templates', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      qc.invalidateQueries({ queryKey: ['email-template-detail'] });
      toast.push({ tone: 'success', title: editing ? 'Template saved' : 'Template created', detail: draft.name });
      onClose();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not save the template', detail: e instanceof ApiError ? e.message : undefined }),
  });

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    if (lastFocus.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? draft.subject.length;
      const end = el.selectionEnd ?? start;
      const next = draft.subject.slice(0, start) + token + draft.subject.slice(end);
      setDraft((d) => ({ ...d, subject: next }));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    } else if (bodyRef.current) {
      bodyRef.current.focus();
      document.execCommand('insertText', false, token);
      setDraft((d) => ({ ...d, bodyHtml: bodyRef.current?.innerHTML ?? d.bodyHtml }));
    }
  };

  const previewHtml = renderString(draft.bodyHtml, ctx);
  const draftKey = `${editing?.id ?? 'new'}:${open}`;

  return (
    <Drawer open={open} onClose={onClose} title={editing ? (canEdit ? `Edit template — ${editing.name}` : editing.name) : 'New email template'} width="max-w-4xl">
      {editing && (
        <div className="-mt-1 mb-3">
          <Tabs tabs={[{ key: 'edit', label: canEdit ? 'Edit' : 'Details' }, { key: 'history', label: 'Version history' }]} active={tab} onChange={setTab} />
        </div>
      )}
      {tab === 'history' && editing ? (
        <VersionHistory template={editing} canEdit={canEdit} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Template name" required>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Approval requested" disabled={!canEdit} />
            </Field>
            <Field label="Scenario / event" required hint={editing?.system ? 'Built-in templates stay bound to their scenario.' : undefined}>
              <Select
                value={draft.scenario}
                onChange={(e) => setDraft((d) => ({ ...d, scenario: e.target.value }))}
                disabled={!canEdit || Boolean(editing?.system)}
              >
                {scenarios.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </Field>
          </div>
          {scenario && <p className="-mt-2 text-2xs text-ink-muted">{scenario.description}</p>}
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="To" required hint="Audience the platform resolves for this scenario.">
              <Input value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} disabled={!canEdit} />
            </Field>
            <Field label="CC">
              <Input value={draft.cc} onChange={(e) => setDraft((d) => ({ ...d, cc: e.target.value }))} disabled={!canEdit} />
            </Field>
            <Field label="BCC">
              <Input value={draft.bcc} onChange={(e) => setDraft((d) => ({ ...d, bcc: e.target.value }))} disabled={!canEdit} />
            </Field>
          </div>
          <Field label="Subject" required>
{/* Raw input (same styling as ui Input) — the shared Input doesn't forward refs,
                and the ref is what lets variable chips insert at the caret. */}
            <input
              ref={subjectRef}
              value={draft.subject}
              onFocus={() => { lastFocus.current = 'subject'; }}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              placeholder="e.g. Approval requested: {{invoiceNumber}}"
              disabled={!canEdit}
              className="h-9 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-essa-500 focus:outline-none focus:ring-2 focus:ring-essa-100 disabled:bg-line-soft"
            />
          </Field>
          {scenario && (
            <div className="rounded-md border border-line-soft bg-canvas px-3 py-2">
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                Available variables — click to insert{scenario.required.length ? ' (• = required)' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {scenario.variables.map((v) => (
                  <Tooltip key={v.name} text={`${v.label} — sample: ${v.sample}`}>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => insertVariable(v.name)}
                      className="rounded-full border border-essa-200 bg-essa-50 px-2 py-0.5 font-mono text-2xs text-essa-700 hover:bg-essa-100 disabled:cursor-default"
                    >
                      {scenario.required.includes(v.name) && <span className="mr-0.5 text-essa-600">•</span>}
                      {'{{'}{v.name}{'}}'}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
          <Field label="Email body" required>
            {canEdit ? (
              <div onFocusCapture={() => { lastFocus.current = 'body'; }}>
                <RichTextEditor key={draftKey} defaultValue={draft.bodyHtml} editorRef={bodyRef} onChange={(html) => setDraft((d) => ({ ...d, bodyHtml: html }))} />
              </div>
            ) : (
              <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm" dangerouslySetInnerHTML={{ __html: draft.bodyHtml }} />
            )}
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Status" hint={draft.status === 'INACTIVE' ? 'Inactive: the scenario falls back to its built-in default content.' : undefined}>
              <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Draft['status'] }))} disabled={!canEdit}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </Field>
          </div>

          <Card title="Live preview — rendered with sample data" className="bg-canvas">
            <div className="space-y-2 text-sm">
              <p className="text-xs text-ink-muted">
                To: <span className="text-ink-secondary">{draft.to || '—'}</span>
                {draft.cc && <> · CC: <span className="text-ink-secondary">{draft.cc}</span></>}
                {draft.bcc && <> · BCC: <span className="text-ink-secondary">{draft.bcc}</span></>}
              </p>
              <p className="border-b border-line-soft pb-2 font-semibold text-ink">{renderString(draft.subject, ctx) || <span className="font-normal text-ink-faint">Subject preview…</span>}</p>
              <div className="min-h-[48px] [&_a]:text-essablue-500 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </Card>

          {showProblems && problems.length > 0 && (
            <div className="rounded-md border border-semantic-error/30 bg-semantic-errorBg px-3 py-2">
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-semantic-error">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                loading={save.isPending}
                onClick={() => {
                  if (problems.length) { setShowProblems(true); return; }
                  save.mutate();
                }}
              >
                {editing ? 'Save changes' : 'Create template'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------ version history

function VersionHistory({ template, canEdit }: { template: TemplateRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['email-template-detail', template.id],
    queryFn: () => api.get<{ template: TemplateRow; versions: VersionRow[] }>(`/admin/email-templates/${template.id}`),
  });
  const restore = useMutation({
    mutationFn: (versionId: string) => api.post(`/admin/email-templates/${template.id}/restore`, { versionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      qc.invalidateQueries({ queryKey: ['email-template-detail', template.id] });
      toast.push({ tone: 'success', title: 'Version restored', detail: 'The template now carries the restored content as a new version.' });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not restore the version', detail: e instanceof ApiError ? e.message : undefined }),
  });
  if (isLoading || !data) return <LoadingState label="Loading version history…" />;
  const versions = data.versions;
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">Every save creates a new version. Restoring an older version applies its content as a new version — nothing is lost.</p>
      <ul className="divide-y divide-line-soft rounded-md border border-line">
        {versions.map((v, i) => (
          <li key={v.id} className="flex items-start gap-3 px-3 py-2.5">
            <Badge tone={v.action === 'CREATED' || v.action === 'DUPLICATED' ? 'info' : v.action === 'DEACTIVATED' ? 'draft' : v.action === 'RESTORED' ? 'pending' : 'success'} className="mt-0.5 shrink-0">v{v.version}</Badge>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">
                {v.action.charAt(0) + v.action.slice(1).toLowerCase()}
                {v.note && <span className="font-normal text-ink-muted"> — {v.note}</span>}
              </p>
              <p className="mt-0.5 truncate text-2xs text-ink-muted">Subject: {v.snapshot.subject}</p>
              <p className="mt-0.5 text-2xs text-ink-faint">{fmtDateTime(v.changedAt)} · {v.changedBy}</p>
            </div>
            {canEdit && i > 0 && (
              <Button size="sm" variant="secondary" loading={restore.isPending} onClick={() => restore.mutate(v.id)}>
                <RotateCcw size={12} /> Restore
              </Button>
            )}
          </li>
        ))}
        {versions.length === 0 && <li className="px-3 py-6 text-center text-xs text-ink-muted">No versions recorded yet.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ page

export default function EmailTemplatesPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['email-templates'], queryFn: () => api.get<ListPayload>('/admin/email-templates') });

  const [search, setSearch] = useState('');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [drawer, setDrawer] = useState<{ open: boolean; editing: TemplateRow | null }>({ open: false, editing: null });
  const [preview, setPreview] = useState<TemplateRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TemplateRow | null>(null);
  const [confirmTest, setConfirmTest] = useState<TemplateRow | null>(null);

  const templates = data?.items ?? [];
  const scenarios = data?.scenarios ?? [];
  const scenarioLabel = (key: string) => scenarios.find((s) => s.key === key)?.label ?? key;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) =>
      (!scenarioFilter || t.scenario === scenarioFilter) &&
      (!statusFilter || t.status === statusFilter) &&
      (!q || [t.name, scenarioLabel(t.scenario), t.subject, t.recipients.to, t.updatedBy].some((v) => v?.toLowerCase().includes(q)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, scenarios, search, scenarioFilter, statusFilter]);

  useEffect(() => { setPage(1); }, [search, scenarioFilter, statusFilter, pageSize]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const duplicate = useMutation({
    mutationFn: (t: TemplateRow) => api.post<{ template: TemplateRow }>(`/admin/email-templates/${t.id}/duplicate`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.push({ tone: 'success', title: 'Template duplicated', detail: `"${r.template.name}" created as Inactive — edit and activate it when ready.` });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not duplicate', detail: e instanceof ApiError ? e.message : undefined }),
  });
  const remove = useMutation({
    mutationFn: (t: TemplateRow) => api.post(`/admin/email-templates/${t.id}/delete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.push({ tone: 'success', title: 'Template deleted' });
      setConfirmDelete(null);
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not delete', detail: e instanceof ApiError ? e.message : undefined }),
  });
  const test = useMutation({
    mutationFn: (t: TemplateRow) => api.post<{ ok: boolean; to: string; subject: string }>(`/admin/email-templates/${t.id}/test`),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: 'Test email sent', detail: `"${r.subject}" queued to ${r.to} — check the notification bell.` });
      setConfirmTest(null);
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not send the test email', detail: e instanceof ApiError ? e.message : undefined }),
  });

  if (isLoading || !data) return <LoadingState />;

  const iconBtn = 'rounded p-1.5 text-ink-muted hover:bg-line-soft hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent';
  const columns: Column<TemplateRow>[] = [
    { key: 'name', header: 'Template Name', sortable: true, value: (t) => t.name, render: (t) => (
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-ink">{t.name}</p>
        {t.system && <span className="text-2xs text-ink-faint">Built-in scenario template</span>}
      </div>
    ) },
    { key: 'scenario', header: 'Scenario / Event', sortable: true, value: (t) => scenarioLabel(t.scenario), render: (t) => <Badge tone="info" className="whitespace-nowrap">{scenarioLabel(t.scenario)}</Badge> },
    { key: 'subject', header: 'Subject', sortable: true, value: (t) => t.subject, render: (t) => <span className="line-clamp-2 max-w-[260px] font-mono text-2xs text-ink-secondary">{t.subject}</span> },
    { key: 'to', header: 'To', sortable: true, value: (t) => t.recipients.to, render: (t) => <span className="text-xs">{t.recipients.to}</span> },
    { key: 'status', header: 'Status', sortable: true, value: (t) => t.status, render: (t) => <StatusBadge value={t.status} /> },
    { key: 'updatedAt', header: 'Last Updated', sortable: true, value: (t) => t.updatedAt, render: (t) => <span className="whitespace-nowrap text-2xs text-ink-muted">{fmtDateTime(t.updatedAt)}</span> },
    { key: 'updatedBy', header: 'Updated By', sortable: true, value: (t) => t.updatedBy, render: (t) => <span className="text-xs">{t.updatedBy}</span> },
    { key: 'actions', header: 'Action', sticky: true, render: (t) => (
      <div className="flex items-center">
        <Tooltip text={canEdit ? 'Edit' : 'View'}><button aria-label={`Edit ${t.name}`} className={iconBtn} onClick={() => setDrawer({ open: true, editing: t })}>{canEdit ? <Pencil size={14} /> : <Eye size={14} />}</button></Tooltip>
        <Tooltip text="Preview with sample data"><button aria-label={`Preview ${t.name}`} className={iconBtn} onClick={() => setPreview(t)}><Eye size={14} /></button></Tooltip>
        {canEdit && (
          <>
            <Tooltip text="Duplicate"><button aria-label={`Duplicate ${t.name}`} className={iconBtn} onClick={() => duplicate.mutate(t)}><Copy size={14} /></button></Tooltip>
            <Tooltip text="Send a test email to yourself"><button aria-label={`Test ${t.name}`} className={iconBtn} onClick={() => setConfirmTest(t)}><Send size={14} /></button></Tooltip>
            <Tooltip text={t.system ? 'Built-in templates cannot be deleted — deactivate instead' : 'Delete'}>
              <button aria-label={`Delete ${t.name}`} className={iconBtn} disabled={t.system} onClick={() => setConfirmDelete(t)}><Trash2 size={14} /></button>
            </Tooltip>
          </>
        )}
      </div>
    ) },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Email Templates' }]}
        title="Email Templates"
        description="Every email the platform sends — approvals, exceptions, rejections, reminders, configuration notices — renders from these templates. The active template for a scenario is what the system sends; an inactive one falls back to the built-in default."
        actions={canEdit ? (
          <Button onClick={() => setDrawer({ open: true, editing: null })}><CirclePlus size={14} /> New template</Button>
        ) : (
          <Badge tone="neutral"><History size={11} /> Read-only — Administrator manages templates</Badge>
        )}
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-3 py-2.5">
          <span className="flex flex-col gap-0.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Search</span>
            <span className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, scenario, subject or recipient" className="w-72 pl-8" aria-label="Search email templates" />
            </span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Scenario</span>
            <Select value={scenarioFilter} onChange={(e) => setScenarioFilter(e.target.value)} aria-label="Scenario filter">
              <option value="">All scenarios</option>
              {scenarios.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Status</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </span>
          <span className="ml-auto self-center text-2xs text-ink-muted">{filtered.length} of {templates.length} templates</span>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(t) => t.id} dense empty={<p className="py-8 text-center text-xs text-ink-muted">No template matches.</p>} />
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} unit="templates" />
      </Card>

      <EditorDrawer open={drawer.open} onClose={() => setDrawer({ open: false, editing: null })} editing={drawer.editing} scenarios={scenarios} canEdit={canEdit} />

      {/* Quick preview with sample data */}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={`Preview — ${preview?.name ?? ''}`} wide>
        {preview && (() => {
          const sc = scenarios.find((s) => s.key === preview.scenario);
          const ctx = sampleCtx(sc);
          return (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-ink-muted">
                To: <span className="text-ink-secondary">{preview.recipients.to}</span>
                {preview.recipients.cc && <> · CC: <span className="text-ink-secondary">{preview.recipients.cc}</span></>}
                {preview.recipients.bcc && <> · BCC: <span className="text-ink-secondary">{preview.recipients.bcc}</span></>}
              </p>
              <p className="border-b border-line-soft pb-2 text-sm font-semibold text-ink">{renderString(preview.subject, ctx)}</p>
              <div className="[&_a]:text-essablue-500 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: renderString(preview.bodyHtml, ctx) }} />
              {sc && (
                <div className="rounded-md border border-line-soft bg-canvas px-3 py-2">
                  <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Sample data used</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-ink-secondary">
                    {sc.variables.map((v) => <span key={v.name}><span className="font-mono text-ink-muted">{'{{'}{v.name}{'}}'}</span> → {v.sample}</span>)}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
        title="Delete this template?"
        message={<>“{confirmDelete?.name}” will be removed. Its version history stays in the audit trail. This cannot be undone.</>}
        confirmLabel="Delete template"
        tone="danger"
        loading={remove.isPending}
      />
      <ConfirmDialog
        open={Boolean(confirmTest)}
        onClose={() => setConfirmTest(null)}
        onConfirm={() => confirmTest && test.mutate(confirmTest)}
        title="Send a test email?"
        message={<>“{confirmTest?.name}” will be rendered with sample data and sent to you through the platform's email channel, marked [TEST].</>}
        confirmLabel="Send test"
        loading={test.isPending}
      />
    </div>
  );
}
