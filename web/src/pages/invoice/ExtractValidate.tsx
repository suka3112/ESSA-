/**
 * V1-style "Extract & Validate" composite view, restyled with the V2 design system.
 *
 * Layout follows the V1 vendor portal invoice page:
 *  - EXTRACTION section: one sub-tab per source document, transposed field table
 *    (fields as columns), inline Edit -> Save/Cancel on the table itself.
 *  - VALIDATION section: numbered checklist tabs (failing checks marked red),
 *    a detail panel per check with REFERENCE vs CAPTURED boxes, and a
 *    commercial-impact footer.
 *
 * Interactions preserved from V2: corrections are audited (reason required on
 * save), validation overrides remain available, re-validate re-runs the engine.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ChevronDown, FileText, Mail, Pencil, RefreshCcw, Save, ShieldCheck, ShieldOff, X, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { currentStatus, fmtDateTime, fmtMoney, fmtNumber, nextStatus, statusDetail } from '@/lib/format';
import { Badge, Button, ConfirmDialog, Field, Input, InvoiceStatusBadge, Modal, ScrollTabs, Textarea, useToast } from '@/components/ui';
import type { FieldRow, InvoiceDetail, ValidationResultRow } from './types';

const letter = (i: number) => String.fromCharCode(65 + i);

function shortRuleLabel(name: string): string {
  const cleaned = name.replace(/\bvalidation\b|\bcheck\b/gi, '').trim();
  const first = (cleaned || name).split(/\s+/)[0];
  return first.length > 12 ? `${first.slice(0, 12)}…` : first;
}

const RESULT_META: Record<string, { tone: 'success' | 'error' | 'warning' | 'pending' | 'neutral'; label: string; bar: string }> = {
  PASS: { tone: 'success', label: 'PASS', bar: 'bg-essa-500' },
  FAIL: { tone: 'error', label: 'FAIL', bar: 'bg-semantic-error' },
  HARD_FAIL: { tone: 'error', label: 'FAIL', bar: 'bg-semantic-error' },
  WARNING: { tone: 'warning', label: 'WARNING', bar: 'bg-amber-400' },
  OVERRIDDEN: { tone: 'warning', label: 'OVERRIDDEN', bar: 'bg-amber-400' },
  PENDING: { tone: 'pending', label: 'PENDING', bar: 'bg-line-strong' },
  SKIPPED: { tone: 'neutral', label: 'N/A', bar: 'bg-essa-300' },
};

interface DocTypeGroup {
  id: string;
  name: string;
  code?: string;
  available: boolean;
  mandatory: boolean;
  fields: FieldRow[];
}

export function ExtractValidateTab({
  detail,
  onAddDocument,
  onSelectDocument,
  onHighlight,
}: {
  detail: InvoiceDetail;
  onAddDocument?: (documentTypeId?: string) => void;
  onSelectDocument?: (documentId: string | null) => void;
  onHighlight?: (fieldId: string | null) => void;
}) {
  const inv = detail.invoice;
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['invoice', inv.id] });

  // ---------------------------------------------------------------- extraction
  const availableDocs = useMemo(() => detail.documents.filter((d) => d.status === 'AVAILABLE'), [detail.documents]);
  const docTypes = useMemo<DocTypeGroup[]>(() => {
    const seen = new Set<string>();
    const groups: DocTypeGroup[] = [];
    for (const c of detail.completeness.filter((r) => r.applicable)) {
      seen.add(c.documentTypeId);
      groups.push({
        id: c.documentTypeId,
        name: c.documentType?.name ?? c.documentTypeId,
        code: c.documentType?.code,
        available: c.available,
        mandatory: c.requirementType !== 'OPTIONAL',
        fields: [],
      });
    }
    for (const d of availableDocs) {
      if (!seen.has(d.documentTypeId)) {
        seen.add(d.documentTypeId);
        groups.push({ id: d.documentTypeId, name: d.documentType?.name ?? d.documentTypeId, code: d.documentType?.code, available: true, mandatory: false, fields: [] });
      }
    }
    const availableIds = new Set(availableDocs.map((d) => d.id));
    for (const g of groups) g.fields = detail.extractedFields.filter((f) => f.documentTypeId === g.id && availableIds.has(f.documentId));
    return groups;
  }, [detail.completeness, detail.extractedFields, availableDocs]);

  const [extractOpen, setExtractOpen] = useState(true);
  const [activeType, setActiveType] = useState<string | null>(null);
  const active = docTypes.find((g) => g.id === activeType) ?? docTypes.find((g) => g.fields.length) ?? docTypes[0];
  const activeIdx = active ? docTypes.indexOf(active) : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saveOpen, setSaveOpen] = useState(false);

  const startEdit = () => {
    if (!active) return;
    setDraft(Object.fromEntries(active.fields.map((f) => [f.id, f.value ?? ''])));
    setEditing(true);
  };
  const pendingChanges = active ? active.fields.filter((f) => (draft[f.id] ?? '').trim() !== (f.value ?? '') && (draft[f.id] ?? '').trim() !== '') : [];

  const saveAll = useMutation({
    mutationFn: async (reason: string) => {
      for (const f of pendingChanges) {
        await api.post(`/fields/${f.id}/correct`, { value: (draft[f.id] ?? '').trim(), reason });
      }
    },
    onSuccess: () => {
      toast.push({ tone: 'success', title: `${pendingChanges.length} field(s) corrected`, detail: 'Previous values are retained in the audit trail.' });
      setSaveOpen(false);
      setEditing(false);
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Correction failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const selectType = (g: DocTypeGroup) => {
    setActiveType(g.id);
    setEditing(false);
    const doc = availableDocs.find((d) => d.documentTypeId === g.id);
    onSelectDocument?.(doc?.id ?? null);
  };

  const isInvoiceDocType = active ? /^invoice$/i.test(active.name) || (Boolean(active.code) && /INV/i.test(active.code!) && !/TAX|FAKTUR/i.test(active.code!)) : false;

  // ---------------------------------------------------------------- validation
  const run = detail.validationRuns[0];
  const results = detail.validationResults;
  const failCount = results.filter((r) => ['FAIL', 'HARD_FAIL'].includes(r.result)).length;
  const passedLabel = `${results.length - failCount}/${results.length} PASSED`;
  const firstFail = results.findIndex((r) => ['FAIL', 'HARD_FAIL'].includes(r.result));
  const [checkIdx, setCheckIdx] = useState<number | null>(null);
  const selected: ValidationResultRow | undefined = results[checkIdx ?? (firstFail >= 0 ? firstFail : 0)];
  const [reportOpen, setReportOpen] = useState(false);
  const [overriding, setOverriding] = useState<ValidationResultRow | null>(null);

  const revalidate = useMutation({
    mutationFn: () => api.post<{ run: { outcome: string } }>(`/invoices/${inv.id}/revalidate`),
    onSuccess: (r) => {
      toast.push({ tone: r.run.outcome === 'PASS' ? 'success' : 'warning', title: `Revalidation ${r.run.outcome === 'PASS' ? 'passed' : r.run.outcome === 'FAIL' ? 'failed' : 'pending reference data'}` });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Revalidation failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });
  const override = useMutation({
    mutationFn: (reason: string) => api.post(`/validation-results/${overriding!.id}/override`, { reason }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Validation overridden', detail: 'Override recorded and revalidation executed.' });
      setOverriding(null);
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Override failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const failedChecks = results.filter((r) => ['FAIL', 'HARD_FAIL', 'WARNING'].includes(r.result));
  // V1-style draft email body: greeting, issue list with Expected/Found, sign-off.
  const reportText = [
    `Dear ${inv.vendorName},`,
    '',
    ...(failedChecks.length
      ? [
          `We have reviewed invoice ${inv.invoiceNumber}${inv.poNumber ? ` (PO ${inv.poNumber})` : ''} and identified the following validation issue(s) that require your attention before we can proceed with processing:`,
          '',
          ...failedChecks.flatMap((r, i) => [
            `${i + 1}. ${r.ruleName}`,
            `   ${r.message}`,
            `   Expected: ${r.expected || '—'}`,
            `   Found: ${r.actual || '—'}`,
          ]),
          '',
          'Please correct the above and resubmit the invoice with any supporting documents at your earliest convenience.',
        ]
      : [
          `We have reviewed invoice ${inv.invoiceNumber}${inv.poNumber ? ` (PO ${inv.poNumber})` : ''} and all validation checks passed (${passedLabel}). No action is required from your side; the invoice is proceeding through processing.`,
        ]),
    '',
    'Regards,',
    'ESSA Accounts Payable',
  ].join('\n');

  const canRevalidate = hasPerm('INVOICE_REVALIDATE') && !['IN_PROGRESS', 'PARKED', 'POSTED', 'PAID'].includes(inv.lifecycle);

  /** Pass / Passed with exceptions / Failed — the headline result of the run. */
  const warnCount = results.filter((r) => ['WARNING', 'OVERRIDDEN'].includes(r.result)).length;
  const overall: { label: string; tone: 'pass' | 'warn' | 'fail' } = !run
    ? { label: 'Not validated yet', tone: 'warn' }
    : failCount > 0
      ? { label: `Failed · ${failCount} check${failCount === 1 ? '' : 's'}`, tone: 'fail' }
      : warnCount > 0
        ? { label: 'Passed with exceptions', tone: 'warn' }
        : { label: 'Passed', tone: 'pass' };

  /** Fields the validation engine could not accept — shown in red, not just dotted. */
  const fieldFailed = (f: FieldRow) => f.validationStatus === 'INVALID';
  const fieldNeedsReview = (f: FieldRow) => f.validationStatus === 'REVIEW' || (!f.value && f.mandatory);

  return (
    <div className="space-y-4">

      {/* ============================================================ EXTRACTION */}
      <section className="rounded-lg border border-line bg-white shadow-card">
        <button className="flex w-full items-start justify-between gap-2 px-4 py-3 text-left" onClick={() => setExtractOpen((o) => !o)}>
          <span className="flex items-start gap-2">
            <FileText size={15} className="mt-0.5 text-essa-600" />
            <span>
              <span className="block text-xs font-bold uppercase tracking-wide text-ink">Extraction</span>
              <span className="block text-2xs text-ink-muted">Fields captured from each document · one tab per source document</span>
            </span>
          </span>
          <ChevronDown size={16} className={clsx('mt-1 text-ink-muted transition-transform', extractOpen && 'rotate-180')} />
        </button>

        {extractOpen && (
          <div className="px-4 pb-4">
            {/* per-document sub-tabs — one row; chevrons appear when tabs overflow */}
            <ScrollTabs className="border-b border-line-soft">
              <div className="flex flex-nowrap gap-1">
              {docTypes.map((g) => {
                const isActive = g.id === active?.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => selectType(g)}
                    className={clsx(
                      'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-xs transition-colors',
                      isActive ? 'border-essa-600 font-semibold text-essa-700' : 'border-transparent text-ink-secondary hover:text-ink'
                    )}
                  >
                    <span className={clsx(g.fields.some(fieldFailed) && 'font-semibold text-semantic-error')}>{g.name}</span>
                    <span
                      className={clsx(
                        'rounded-full px-1.5 py-0.5 text-2xs font-semibold leading-none',
                        g.fields.some(fieldFailed) ? 'bg-semantic-error text-white' : isActive ? 'bg-essa-600 text-white' : 'text-ink-muted'
                      )}
                    >
                      {g.fields.length}
                    </span>
                  </button>
                );
              })}
              </div>
            </ScrollTabs>

            {active && (
              <div className="mt-3 rounded-lg border border-line">
                {/* panel header */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-canvas px-3 py-2">
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="text-2xs font-bold uppercase tracking-wide text-essa-700">{letter(activeIdx)}. {active.name}</span>
                    {active.fields.length > 0 && (
                      <>
                        <span className="text-2xs font-medium text-essa-700">{active.fields.filter((f) => f.value).length} extracted</span>
                        {active.fields.filter((f) => !f.value).length > 0 && (
                          <span className="rounded bg-semantic-warningBg px-1.5 py-0.5 text-2xs font-medium text-semantic-warning">
                            {active.fields.filter((f) => !f.value).length} empty
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  {active.fields.length > 0 && hasPerm('FIELD_CORRECT') && (
                    <span className="flex gap-1.5">
                      {editing ? (
                        <>
                          <Button size="sm" disabled={pendingChanges.length === 0} onClick={() => setSaveOpen(true)}>
                            <Save size={13} /> Save
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                            <X size={13} /> Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={startEdit}>
                          <Pencil size={13} /> Edit
                        </Button>
                      )}
                    </span>
                  )}
                </div>

                {/* transposed field table */}
                {active.fields.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          {active.fields.map((f) => (
                            <th
                              key={f.id}
                              className={clsx(
                                'min-w-36 border-r px-3 py-2 text-left font-semibold text-white last:border-r-0',
                                fieldFailed(f) ? 'border-red-400/50 bg-semantic-error' : fieldNeedsReview(f) ? 'border-amber-400/50 bg-amber-500' : 'border-essa-500/40 bg-essa-600'
                              )}
                            >
                              <span className="flex items-center gap-1">
                                {fieldFailed(f) && <XCircle size={11} />}
                                {f.label}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {active.fields.map((f) => (
                            <td
                              key={f.id}
                              className={clsx(
                                'min-w-36 border-r border-line-soft px-3 py-2.5 align-top last:border-r-0',
                                fieldFailed(f) && 'bg-semantic-errorBg',
                                !fieldFailed(f) && fieldNeedsReview(f) && 'bg-semantic-warningBg'
                              )}
                              onMouseEnter={() => onHighlight?.(f.id)}
                              onMouseLeave={() => onHighlight?.(null)}
                            >
                              {editing ? (
                                <Input value={draft[f.id] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))} placeholder={`Enter ${f.label}`} className="w-full" />
                              ) : f.value ? (
                                <span className="flex items-start gap-1.5">
                                  <span className={clsx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', fieldFailed(f) ? 'bg-semantic-error' : fieldNeedsReview(f) ? 'bg-amber-400' : 'bg-essa-500')} />
                                  <span className={clsx(fieldFailed(f) ? 'font-semibold text-semantic-error' : 'text-ink')}>{f.value}</span>
                                </span>
                              ) : (
                                <span className="flex items-start gap-1.5">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                                  <span className="italic text-semantic-warning">Not extracted</span>
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-10 text-center">
                    <FileText size={22} className="mx-auto text-ink-faint" />
                    <p className="mt-2 text-sm font-semibold text-ink">No extracted data to show</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
                      Nothing was captured for {active.name}. The document may not have been included in the upload, or AI extraction did not detect readable content to display here.
                    </p>
                    {!active.available && active.mandatory && onAddDocument && hasPerm('INVOICE_EDIT') && (
                      <Button size="sm" variant="secondary" className="mt-3" onClick={() => onAddDocument(active.id)}>
                        Supply document
                      </Button>
                    )}
                  </div>
                )}

                {/* invoice line items (V1 shows them under the invoice tab) */}
                {isInvoiceDocType && detail.lines.length > 0 && (
                  <div className="border-t border-line-soft">
                    <p className="px-3 pt-2.5 text-2xs font-bold uppercase tracking-wide text-ink-secondary">{letter(activeIdx)}. Invoice — line items</p>
                    <table className="mt-2 w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-essa-600 text-white">
                          <th className="w-10 px-3 py-2 text-left font-semibold">#</th>
                          <th className="px-3 py-2 text-left font-semibold">Description</th>
                          <th className="px-3 py-2 text-right font-semibold">Qty</th>
                          <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((l) => (
                          <tr key={l.id} className="border-b border-line-soft last:border-b-0">
                            <td className="px-3 py-2">{l.lineNo}</td>
                            <td className="px-3 py-2">{l.description}</td>
                            <td className="px-3 py-2 text-right">{fmtNumber(l.quantity)} {l.uom}</td>
                            <td className="px-3 py-2 text-right font-medium">{fmtMoney(l.amount, inv.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ============================================================ VALIDATION */}
      <section className="rounded-lg border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
          <span className="flex items-start gap-2">
            <ShieldCheck size={15} className="mt-0.5 text-essa-600" />
            <span>
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink">
                Validation
                {run && (
                  <span className={clsx('rounded px-1.5 py-0.5 text-2xs font-bold', failCount ? 'bg-semantic-errorBg text-semantic-error' : 'bg-essa-50 text-essa-700')}>
                    {passedLabel}
                  </span>
                )}
              </span>
              <span className="block text-2xs text-ink-muted">
                {results.length || 12}-point checklist against master data, transaction data and supporting documents
              </span>
            </span>
          </span>
          {canRevalidate && (
            <Button size="sm" variant="secondary" loading={revalidate.isPending} onClick={() => revalidate.mutate()}>
              <RefreshCcw size={13} /> Re-validate
            </Button>
          )}
        </div>

        {!run ? (
          <p className="px-4 pb-6 pt-2 text-center text-xs text-ink-muted">
            {inv.processingFlag === 'MISSING_DOCUMENTS'
              ? 'Business validation is on hold — mandatory supporting document(s) are missing. Supply the missing supporting document and the pipeline resumes automatically.'
              : 'No validation run yet — validation executes after extraction completes.'}
          </p>
        ) : (
          <div className="mx-4 mb-4 rounded-lg border border-line">
            {/* chips + report */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="flex flex-wrap items-center gap-2">
                {/* One eye-catching overall result, so the user does not have to
                    scroll the checklist to learn where the invoice stands. */}
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wide',
                    overall.tone === 'fail' ? 'bg-semantic-error text-white'
                      : overall.tone === 'warn' ? 'bg-amber-500 text-white'
                        : 'bg-essa-600 text-white'
                  )}
                >
                  {overall.tone === 'fail' ? <XCircle size={13} /> : overall.tone === 'warn' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                  {overall.label}
                </span>
                <span className={clsx('rounded-md border px-2 py-1 text-2xs font-bold', failCount ? 'border-red-200 bg-semantic-errorBg text-semantic-error' : 'border-essa-200 bg-essa-50 text-essa-700')}>
                  • {passedLabel}
                </span>
                {inv.poNumber && <span className="rounded-md border border-line bg-canvas px-2 py-1 text-2xs font-semibold text-ink-secondary">PO {inv.poNumber}</span>}
                {detail.sapReference.ses[0] && (
                  <span className="rounded-md border border-essa-200 bg-essa-50 px-2 py-1 text-2xs font-semibold text-essa-700">SES {detail.sapReference.ses[0].sesNumber}</span>
                )}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
                <Mail size={13} /> Report to vendor
              </Button>
            </div>

            {/* numbered check tabs — one row; chevrons appear when tabs overflow */}
            <ScrollTabs className="border-b border-t border-line-soft px-2 pt-1">
              <div className="flex flex-nowrap gap-1">
              {results.map((r, i) => {
                const failing = ['FAIL', 'HARD_FAIL'].includes(r.result);
                const warning = ['WARNING', 'OVERRIDDEN'].includes(r.result);
                const isSel = selected?.id === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setCheckIdx(i)}
                    className={clsx(
                      'relative whitespace-nowrap border-b-2 px-2 py-1.5 text-2xs font-medium transition-colors',
                      isSel ? (failing ? 'border-semantic-error text-semantic-error' : 'border-essa-600 text-essa-700') : 'border-transparent',
                      !isSel && (failing ? 'text-semantic-error/80 hover:text-semantic-error' : warning ? 'text-semantic-warning hover:text-ink' : 'text-ink-secondary hover:text-ink')
                    )}
                  >
                    {/* Pass/fail is carried by an icon as well as colour so the
                        result is readable without relying on colour alone. */}
                    <span className="mr-1 inline-flex align-[-2px]">
                      {failing ? <XCircle size={12} /> : warning ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} className="text-essa-600" />}
                    </span>
                    {i + 1}. {shortRuleLabel(r.ruleName)}
                  </button>
                );
              })}
              </div>
            </ScrollTabs>

            {/* selected check detail */}
            {selected && (
              <div className="flex">
                <div className={clsx('w-1 shrink-0', RESULT_META[selected.result]?.bar ?? 'bg-line-strong')} />
                <div className="min-w-0 flex-1 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas text-2xs font-bold text-ink-secondary">
                        {(checkIdx ?? (firstFail >= 0 ? firstFail : 0)) + 1}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-ink">{selected.ruleName}</span>
                        <span className="mt-0.5 block max-w-2xl text-2xs leading-relaxed text-ink-muted">{selected.message}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {/* UI/UX review §7: a failed check is corrected here —
                          edit the field above and re-validate. There is no
                          separate exception screen for the same invoice. */}
                      {['FAIL', 'HARD_FAIL', 'WARNING'].includes(selected.result) && selected.overrideAllowed && hasPerm('VALIDATION_OVERRIDE') && (
                        <Button size="sm" variant="warning" onClick={() => setOverriding(selected)}>
                          <ShieldOff size={12} /> Override
                        </Button>
                      )}
                      <Badge tone={RESULT_META[selected.result]?.tone ?? 'neutral'}>{RESULT_META[selected.result]?.label ?? selected.result}</Badge>
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Reference</p>
                      <p className="mt-1 text-xs font-medium text-ink">{selected.expected || '—'}</p>
                    </div>
                    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Captured</p>
                      <p className="mt-1 text-xs font-medium text-ink">{selected.actual || '—'}</p>
                    </div>
                  </div>

                  {selected.operandValues.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {selected.operandValues.map((o) => (
                        <div key={o.alias} className="rounded-lg border border-line-soft bg-white px-3 py-2">
                          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{o.label} <span className="normal-case">({o.source})</span></p>
                          <p className="mt-0.5 text-sm font-semibold text-ink">{o.value == null ? '—' : typeof o.value === 'number' ? o.value.toLocaleString('en-US') : o.value}</p>
                          {o.detail && <p className="text-2xs text-ink-muted">{o.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-ink-muted">
                    <span>Tolerance: <span className="font-medium text-ink-secondary">{selected.tolerance || '—'}</span></span>
                    {selected.differencePct != null && (
                      <span>
                        Difference: <span className={clsx('font-medium', ['FAIL', 'HARD_FAIL'].includes(selected.result) ? 'text-semantic-error' : 'text-ink-secondary')}>{selected.differencePct}%</span>
                      </span>
                    )}
                    {selected.blocking && <Badge tone="error">Blocking</Badge>}
                  </p>

                  {selected.override && (
                    <p className="mt-2 rounded-md bg-semantic-warningBg px-2.5 py-1.5 text-2xs text-semantic-warning">
                      Overridden by {selected.override.byName} ({selected.override.role}) on {fmtDateTime(selected.override.at)} — “{selected.override.reason}”. Previous result: {selected.override.previousResult}.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* commercial impact footer */}
            <div className="rounded-b-lg border-t border-line-soft bg-canvas px-4 py-2.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Commercial impact</p>
              <p className="mt-0.5 text-xs font-bold text-ink">Net payable: {fmtMoney(inv.amount, inv.currency)}</p>
            </div>
          </div>
        )}
      </section>

      {/* save-corrections reason (auditable HITL) */}
      <ConfirmDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onConfirm={(reason) => reason && saveAll.mutate(reason)}
        loading={saveAll.isPending}
        title={`Save ${pendingChanges.length} correction(s) — ${active?.name ?? ''}`}
        confirmLabel="Save corrections"
        requireReason="Reason for correction (mandatory, audited)"
        message={
          <div className="space-y-1 text-xs">
            <p>The following fields will be corrected. Previous values are never overwritten — they remain in the audit trail.</p>
            <ul className="list-inside list-disc text-2xs text-ink-secondary">
              {pendingChanges.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.label}</span>: “{f.value || '—'}” → “{(draft[f.id] ?? '').trim()}”
                </li>
              ))}
            </ul>
          </div>
        }
      />

      {/* validation override (unchanged V2 interaction) */}
      <ConfirmDialog
        open={Boolean(overriding)}
        onClose={() => setOverriding(null)}
        onConfirm={(reason) => reason && override.mutate(reason)}
        loading={override.isPending}
        title={`Override ${overriding?.ruleCode} — ${overriding?.ruleName}`}
        tone="warning"
        confirmLabel="Record override"
        requireReason="Override reason (mandatory, audited)"
        message={
          <div className="space-y-1 text-xs">
            <p>You are overriding a <span className="font-semibold">{overriding?.result}</span> result. The override is recorded with your identity, role and reason, and the previous validation run is retained.</p>
            <p className="text-ink-muted">Reference {overriding?.expected} · Captured {overriding?.actual} · Tolerance {overriding?.tolerance}</p>
          </div>
        }
      />

      {/* Report to vendor — email compose (design review): CC field, standardized
          non-editable subject (vendor + invoice number + date so replies match
          back uniquely), template-prefilled editable body, Send + Cancel only. */}
      <ReportToVendorModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        vendorName={inv.vendorName}
        vendorCode={inv.vendorCode}
        invoiceNumber={inv.invoiceNumber}
        category={inv.categoryName}
        hasFailures={failedChecks.length > 0}
        reportText={reportText}
        onSent={() => toast.push({ tone: 'success', title: 'Report sent to vendor', detail: 'Email queued via the notification service and recorded in the audit trail.' })}
      />
    </div>
  );
}

/**
 * Report-to-vendor email compose. Vendor "To" addresses come from the vendor
 * master; the internal AP team can be CC'd. The subject is standardized and
 * non-editable so vendor replies can be uniquely matched back to the invoice.
 */
function ReportToVendorModal({
  open, onClose, vendorName, vendorCode, invoiceNumber, category, hasFailures, reportText, onSent,
}: {
  open: boolean;
  onClose: () => void;
  vendorName: string;
  vendorCode: string;
  invoiceNumber: string;
  category?: string;
  hasFailures: boolean;
  reportText: string;
  onSent: () => void;
}) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [body, setBody] = useState('');
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setBody(reportText);
    setTo(`${vendorCode.toLowerCase()}@vendor-master.essa.co.in`);
  }
  if (!open && seeded) {
    // reset for the next open
    setSeeded(false);
  }
  const today = new Date().toLocaleDateString('en-CA');
  const subject = `[EAPA] ${vendorName} · Invoice ${invoiceNumber}${category ? ` · ${category}` : ''} · ${hasFailures ? 'Validation failure' : 'Validation report'} ${today}`;
  return (
    /* V1-style emailer popup: To, CC, Subject (non-editable), Message, and
       Cancel + Send — opened from "Report to vendor" inside Validation. */
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span>
          Report to vendor
          <span className="mt-0.5 block text-xs font-normal text-ink-muted">
            {hasFailures ? 'Draft email with validation failures pre-filled. Edit before sending.' : 'Draft email with the validation report pre-filled. Edit before sending.'}
          </span>
        </span>
      }
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!to.trim() || !body.trim()}
            onClick={() => {
              onSent();
              onClose();
            }}
          >
            <Mail size={13} /> Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="To">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="vendor@company.com" />
        </Field>
        <Field label="CC">
          <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="ap.team@essa.co.in" />
        </Field>
        <Field label="Subject (non-editable)">
          <Input value={subject} disabled />
        </Field>
        <Field label="Message">
          <Textarea rows={11} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono !text-2xs" />
        </Field>
      </div>
    </Modal>
  );
}
