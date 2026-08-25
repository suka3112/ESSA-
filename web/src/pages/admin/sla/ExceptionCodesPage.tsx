/**
 * Exception codes — the agreed catalogue (review, 24 Aug): ONE code per error
 * type, the same for every invoice, category and vendor. Lives under SLA
 * Management; the codes are a column and a filter on the Exception Workbench.
 *
 * The administrator can add, edit and enable / disable a code (review, 25
 * Aug). Nothing is deleted outright: a code that has already been applied to
 * an invoice stays readable in history.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Pencil, Power } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';
import { Button, Card, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, Textarea, useToast, type Column } from '@/components/ui';
import { SLA_BREADCRUMB, SlaSectionNav } from './shared';

interface ExceptionCodeRow { id: string; code: string; type: string; label: string; description: string; documentTypeId?: string; active: boolean }
interface Lookups { exceptionCodes: ExceptionCodeRow[]; documentTypes: { id: string; name: string }[] }
interface CodeDraft { original?: ExceptionCodeRow; code: string; type: string; label: string; description: string; documentTypeId: string }

const EXCEPTION_TYPES = [
  'MISSING_DOCUMENT', 'EXTRACTION_FAILURE', 'LOW_CONFIDENCE', 'VALIDATION_FAILURE',
  'MISSING_SAP_REFERENCE', 'VENDOR_ISSUE', 'TAX_ISSUE', 'APPROVAL_ISSUE',
  'INTEGRATION_FAILURE', 'TECHNICAL_FAILURE',
];
const EMPTY_CODE: CodeDraft = { code: '', type: 'VALIDATION_FAILURE', label: '', description: '', documentTypeId: '' };

export default function ExceptionCodesPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });
  const [draft, setDraft] = useState<CodeDraft | null>(null);

  const commit = useMutation({
    mutationFn: (p: { op: 'CREATE' | 'UPDATE' | 'TOGGLE'; row: Record<string, unknown>; title: string }) =>
      api.post('/configuration/entities/exceptionCodes', { op: p.op, row: p.row }).then(() => p.title),
    onSuccess: (title) => { toast.push({ tone: 'success', title }); qc.invalidateQueries({ queryKey: ['lookups'] }); },
    onError: (e) => toast.push({ tone: 'error', title: 'Save failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !data) return <LoadingState />;
  const codes = data.exceptionCodes ?? [];

  /** Next free code in the range that matches the type (E-11xx = missing document). */
  const suggestCode = (type: string) => {
    const prefix = type === 'MISSING_DOCUMENT' ? 11 : 10;
    const used = codes.map((c) => Number(c.code.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n) && Math.floor(n / 100) === prefix);
    return `E-${(used.length ? Math.max(...used) : prefix * 100) + 1}`;
  };
  const duplicate = Boolean(draft && draft.code.trim() && codes.some((c) => c.code.toLowerCase() === draft.code.trim().toLowerCase() && c.id !== draft.original?.id));

  const save = () => {
    if (!draft || duplicate) return;
    const { original, code, type, label, description, documentTypeId } = draft;
    const row = {
      ...(original ?? { active: true }),
      code: (code.trim() || suggestCode(type)).toUpperCase(), type, label: label.trim(), description: description.trim(),
      documentTypeId: type === 'MISSING_DOCUMENT' ? documentTypeId || undefined : undefined,
    };
    setDraft(null);
    commit.mutate({ op: original ? 'UPDATE' : 'CREATE', row, title: original ? 'Exception code updated' : 'Exception code added' });
  };

  const columns: Column<ExceptionCodeRow>[] = [
    { key: 'code', header: 'Exception Code', sortable: true, value: (r) => r.code, render: (r) => <span className="font-mono text-2xs font-semibold text-ink-secondary">{r.code}</span> },
    { key: 'type', header: 'Exception Type', sortable: true, value: (r) => titleCase(r.type), render: (r) => <span className="text-xs">{titleCase(r.type)}</span> },
    { key: 'label', header: 'Name', sortable: true, value: (r) => r.label, render: (r) => <span className="text-xs font-medium">{r.label}</span> },
    { key: 'description', header: 'What It Means', value: (r) => r.description, render: (r) => <span className="text-xs text-ink-secondary">{r.description}</span> },
    { key: 'active', header: 'Status', sortable: true, value: (r) => (r.active ? 'Enabled' : 'Disabled'), render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} label={r.active ? 'Enabled' : 'Disabled'} /> },
    {
      key: 'actions', header: 'Action', align: 'center', sticky: true,
      render: (r) => canEdit ? (
        <div className="flex justify-center gap-1">
          <Button size="sm" variant="ghost" aria-label={`Edit ${r.code}`} title="Edit this exception code" onClick={() => setDraft({ original: r, code: r.code, type: r.type, label: r.label, description: r.description, documentTypeId: r.documentTypeId ?? '' })}><Pencil size={13} /></Button>
          <Button size="sm" variant="ghost" aria-label={r.active ? `Disable ${r.code}` : `Enable ${r.code}`} title={r.active ? 'Stop using this code for new exceptions' : 'Use this code again'} onClick={() => commit.mutate({ op: 'TOGGLE', row: { id: r.id }, title: r.active ? 'Exception code disabled' : 'Exception code enabled' })}><Power size={13} /></Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[...SLA_BREADCRUMB, { label: 'Exception Codes' }]}
        title="Exception Codes"
        description="One code per error type — the same code whatever the invoice, category or vendor. Shown as a column and a filter on the Exception Workbench."
        actions={canEdit ? <Button onClick={() => setDraft({ ...EMPTY_CODE, code: suggestCode(EMPTY_CODE.type) })}><CirclePlus size={14} /> Add exception code</Button> : undefined}
      />
      <SlaSectionNav active="codes" />
      <Card pad={false}><DataTable columns={columns} rows={codes} rowKey={(r) => r.id} dense /></Card>

      <Modal
        open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.original ? `Edit ${draft.original.code}` : 'Add exception code'}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><Button loading={commit.isPending} disabled={!draft?.label.trim() || duplicate} onClick={save}>{draft?.original ? 'Save changes' : 'Add code'}</Button></>}
      >
        {draft && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Exception type" required hint="There is one code per error type — pick the type this code describes">
                <Select value={draft.type} className="w-full" onChange={(e) => setDraft((p) => p && ({ ...p, type: e.target.value, code: p.original ? p.code : suggestCode(e.target.value) }))}>
                  {EXCEPTION_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                </Select>
              </Field>
              <Field label="Exception code" required hint={duplicate ? undefined : 'Shown on the Exception Workbench and in vendor correspondence'}>
                <Input value={draft.code} placeholder={suggestCode(draft.type)} className="w-full font-mono" onChange={(e) => setDraft((p) => p && ({ ...p, code: e.target.value }))} />
              </Field>
            </div>
            {duplicate && (
              <p className="rounded-md bg-semantic-errorBg px-2.5 py-1.5 text-2xs text-semantic-error">
                {draft.code.trim().toUpperCase()} is already in use. Every code has to be unique so that filtering by a code returns one error type and nothing else.
              </p>
            )}
            {draft.type === 'MISSING_DOCUMENT' && (
              <Field label="Which document" hint="Missing-document errors carry one code per document, because which document is missing is the error">
                <Select value={draft.documentTypeId} className="w-full" onChange={(e) => setDraft((p) => p && ({ ...p, documentTypeId: e.target.value }))}>
                  <option value="">Any supporting document</option>
                  {(data.documentTypes ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Name" required hint="The short name the AP team sees on the Exception Workbench">
              <Input value={draft.label} className="w-full" placeholder="e.g. Goods receipt note missing" maxLength={80} onChange={(e) => setDraft((p) => p && ({ ...p, label: e.target.value }))} />
            </Field>
            <Field label="What it means" hint="Explains the error in plain language">
              <Textarea rows={2} value={draft.description} placeholder="e.g. The goods receipt note is missing from the bundle." onChange={(e) => setDraft((p) => p && ({ ...p, description: e.target.value }))} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
