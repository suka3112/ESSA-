/** Invoice workbench tabs: Overview, Documents & Completeness, Extracted Fields, Validation. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Pencil, ShieldOff } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, ConfidenceBadge, ConfirmDialog, DataTable, Field as FormField, KeyValue, Modal,
  StatusBadge, Textarea, Input, useToast, type Column,
} from '@/components/ui';
import type { CompletenessRow, DocumentRow, FieldRow, InvoiceDetail, ValidationResultRow } from './types';

// ---------------------------------------------------------------- Overview
export function OverviewTab({ detail }: { detail: InvoiceDetail }) {
  const inv = detail.invoice;
  return (
    <div className="space-y-4">
      <Card title="Invoice summary">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <KeyValue label="Invoice Number">{inv.invoiceNumber}</KeyValue>
          <KeyValue label="Invoice Date">{fmtDate(inv.invoiceDate)}</KeyValue>
          <KeyValue label="Received">{fmtDateTime(inv.receivedAt)}</KeyValue>
          <KeyValue label="Channel"><StatusBadge value={inv.source} /></KeyValue>
          <KeyValue label="Amount"><span className="font-semibold">{fmtMoney(inv.amount, inv.currency)}</span></KeyValue>
          <KeyValue label="Subtotal">{fmtMoney(inv.subtotal, inv.currency)}</KeyValue>
          <KeyValue label="Tax">{fmtMoney(inv.taxAmount, inv.currency)}</KeyValue>
          <KeyValue label="PO Number">{inv.poNumber ?? '—'}</KeyValue>
          <KeyValue label="Category">{inv.categoryName}</KeyValue>
          <KeyValue label="Company Code">{inv.companyCode}</KeyValue>
          <KeyValue label="Priority"><StatusBadge value={inv.priority} /></KeyValue>
          <KeyValue label="Config Version">{inv.configVersionId}</KeyValue>
          <KeyValue label="Correlation ID"><span className="font-mono text-xs">{inv.correlationId}</span></KeyValue>
          <KeyValue label="SAP Document">{inv.sapDocumentNo ?? '—'}</KeyValue>
          <KeyValue label="Payment">{inv.paymentRef ? `${inv.paymentRef} · ${fmtDate(inv.paymentDate)}` : titleCase(inv.paymentStatus ?? '—')}</KeyValue>
        </dl>
        <p className="mt-3 border-t border-line-soft pt-2 text-xs text-ink-secondary">{inv.description}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Vendor">
          {detail.vendor ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <KeyValue label="Vendor">{detail.vendor.name}</KeyValue>
              <KeyValue label="Code">{detail.vendor.code}</KeyValue>
              <KeyValue label="Tax Number (NPWP)">{detail.vendor.gstin}</KeyValue>
              <KeyValue label="Payment Terms">{detail.vendor.paymentTerms}</KeyValue>
              <KeyValue label="SAP Status"><StatusBadge value={detail.vendor.sapStatus} /></KeyValue>
              <KeyValue label="AP Control">
                {detail.vendorControl?.negativeFlag ? (
                  <Badge tone="error">Negative flag</Badge>
                ) : detail.vendorControl && !detail.vendorControl.apEnabled ? (
                  <Badge tone="warning">AP disabled</Badge>
                ) : (
                  <Badge tone="success">Enabled</Badge>
                )}
              </KeyValue>
            </dl>
          ) : (
            <p className="text-xs text-ink-muted">Vendor not found in SAP snapshot.</p>
          )}
        </Card>

        <Card title="SAP reference data">
          {detail.sapReference.po ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <KeyValue label="PO">{detail.sapReference.po.poNumber}</KeyValue>
              <KeyValue label="PO Status"><StatusBadge value={detail.sapReference.po.status} /></KeyValue>
              <KeyValue label="PO Value">{fmtMoney(detail.sapReference.po.totalAmount, detail.sapReference.po.currency)}</KeyValue>
              <KeyValue label="Open Value">{fmtMoney(detail.sapReference.po.openAmount, detail.sapReference.po.currency)}</KeyValue>
              <KeyValue label="GRNs">{detail.sapReference.grns.length ? `${detail.sapReference.grns.length} · ${fmtMoney(detail.sapReference.grns.reduce((s, g) => s + g.amount, 0), detail.sapReference.po.currency)}` : '—'}</KeyValue>
              <KeyValue label="SES">{detail.sapReference.ses.length ? `${detail.sapReference.ses.length} · ${fmtMoney(detail.sapReference.ses.reduce((s, g) => s + g.amount, 0), detail.sapReference.po.currency)}` : '—'}</KeyValue>
            </dl>
          ) : (
            <p className="text-xs text-ink-muted">Non-PO invoice — there is no purchase order to validate against. It is routed through the approval hierarchy by invoice amount.</p>
          )}
        </Card>
      </div>

      <Card title="Invoice lines" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'lineNo', header: '#', render: (l) => l.lineNo },
            { key: 'description', header: 'Description', render: (l) => l.description },
            { key: 'quantity', header: 'Qty', align: 'right', render: (l) => `${fmtNumber(l.quantity, Number.isInteger(l.quantity) ? 0 : 1)} ${l.uom}` },
            { key: 'unitPrice', header: 'Unit Price', align: 'right', render: (l) => fmtNumber(l.unitPrice, 2) },
            { key: 'amount', header: 'Amount', align: 'right', render: (l) => <span className="font-medium">{fmtMoney(l.amount, inv.currency)}</span> },
            { key: 'poItem', header: 'PO Item', render: (l) => l.poItem ?? '—' },
          ] satisfies Column<InvoiceDetail['lines'][0]>[]}
          rows={detail.lines}
          rowKey={(l) => l.id}
        />
      </Card>
    </div>
  );
}

// ------------------------------------------------------- Documents & completeness
export function DocumentsTab({ detail, onReplace, onAdd }: { detail: InvoiceDetail; onReplace: (doc: DocumentRow) => void; onAdd: (documentTypeId?: string) => void }) {
  const { hasPerm } = useAuth();
  return (
    <div className="space-y-4">
      <Card
        title="Document completeness"
        actions={<span className="text-2xs text-ink-muted">Availability check is independent of field validation</span>}
        pad={false}
      >
        <DataTable
          dense
          columns={[
            { key: 'doc', header: 'Document', render: (r) => <span className="font-medium">{r.documentType?.name}</span> },
            { key: 'purpose', header: 'Purpose', render: (r) => <span className="text-xs text-ink-muted">{r.documentType?.purpose}</span> },
            { key: 'req', header: 'Requirement', render: (r) => <StatusBadge value={r.requirementType} /> },
            { key: 'mode', header: 'Check Type', render: (r) => <span className="text-xs">{titleCase(r.checkMode)}</span> },
            { key: 'content', header: 'Content Check', align: 'center', render: (r) => (r.contentCheckRequired ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
            { key: 'avail', header: 'Availability', align: 'center', render: (r) => (r.availabilityCheckRequired ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
            { key: 'multiple', header: 'Multiple', align: 'center', render: (r) => (r.allowMultiple ? 'Yes' : 'No') },
            {
              key: 'status', header: 'Status', render: (r) =>
                !r.applicable ? <Badge tone="neutral">Not applicable</Badge>
                  : r.available ? <Badge tone="success"><CheckCircle2 size={11} /> Available</Badge>
                    : r.requirementType === 'OPTIONAL' ? <Badge tone="neutral">Not provided</Badge>
                      : <Badge tone="error"><CircleAlert size={11} /> Missing</Badge>,
            },
            {
              key: 'actions', header: 'Actions', render: (r) =>
                !r.available && r.applicable && r.requirementType !== 'OPTIONAL' && hasPerm('INVOICE_EDIT') ? (
                  <Button size="sm" variant="secondary" onClick={() => onAdd(r.documentTypeId)}>Supply document</Button>
                ) : null,
            },
          ] satisfies Column<CompletenessRow>[]}
          rows={detail.completeness}
          rowKey={(r) => r.id}
        />
      </Card>

      <Card
        title="Received documents"
        actions={hasPerm('INVOICE_EDIT') ? <Button size="sm" variant="secondary" onClick={() => onAdd()}>Add supporting document</Button> : undefined}
        pad={false}
      >
        <DataTable
          dense
          columns={[
            { key: 'fileName', header: 'File', render: (d) => (
              <div>
                <a href={d.sharePointUrl} target="_blank" rel="noreferrer" className="font-medium text-essa-700 hover:underline">{d.fileName}</a>
                <p className="text-2xs text-ink-faint">v{d.version} · {d.pages} pages · {d.sizeKb} KB</p>
              </div>
            ) },
            { key: 'type', header: 'Type', render: (d) => d.documentType?.name },
            { key: 'source', header: 'Source', render: (d) => <StatusBadge value={d.source} /> },
            { key: 'status', header: 'Status', render: (d) => <StatusBadge value={d.status} /> },
            { key: 'extraction', header: 'Extraction', render: (d) => <StatusBadge value={d.extractionStatus} /> },
            { key: 'uploaded', header: 'Uploaded', render: (d) => <span className="text-xs">{d.uploadedBy}<br /><span className="text-2xs text-ink-faint">{fmtDateTime(d.uploadedAt)}</span></span> },
            {
              key: 'actions', header: 'Actions', render: (d) =>
                d.status === 'AVAILABLE' && hasPerm('INVOICE_EDIT') ? (
                  <Button size="sm" variant="ghost" onClick={() => onReplace(d)}>Replace</Button>
                ) : null,
            },
          ] satisfies Column<DocumentRow>[]}
          rows={detail.documents}
          rowKey={(d) => d.id}
        />
      </Card>

      <Card title="Extraction runs" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'id', header: 'Run', render: (r) => <span className="font-mono text-2xs">{r.id}</span> },
            { key: 'doc', header: 'Document', render: (r) => detail.documents.find((d) => d.id === r.documentId)?.documentType?.name ?? r.documentTypeId },
            { key: 'model', header: 'Model / Prompt', render: (r) => <span className="text-xs">{r.modelDeployment}<br /><span className="text-2xs text-ink-faint">prompt {r.promptVersion} · profile {r.profileVersion}</span></span> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'fields', header: 'Fields', align: 'center', render: (r) => `${r.fieldCount}` },
            { key: 'low', header: 'Low conf.', align: 'center', render: (r) => (r.lowConfidenceCount ? <Badge tone="warning">{r.lowConfidenceCount}</Badge> : '0') },
            { key: 'tokens', header: 'Tokens', align: 'right', render: (r) => <span className="text-2xs text-ink-muted">{fmtNumber(r.tokensIn)} in / {fmtNumber(r.tokensOut)} out</span> },
            { key: 'time', header: 'Duration', align: 'right', render: (r) => <span className="text-2xs">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</span> },
          ]}
          rows={detail.extractionRuns}
          rowKey={(r) => r.id}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------- Extracted fields / HITL
export function FieldsTab({ detail, onHighlight }: { detail: InvoiceDetail; onHighlight: (fieldId: string | null) => void }) {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FieldRow | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['invoice', detail.invoice.id] });

  const correct = useMutation({
    mutationFn: () => api.post(`/fields/${editing!.id}/correct`, { value, reason }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Field corrected', detail: 'A new auditable value was recorded.' });
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Correction failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });
  const accept = useMutation({
    mutationFn: (fieldId: string) => api.post(`/fields/${fieldId}/accept`),
    onSuccess: () => invalidate(),
  });
  const completeReview = useMutation({
    mutationFn: () => api.post(`/invoices/${detail.invoice.id}/complete-review`),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Review completed', detail: 'Validation re-run with the reviewed values.' });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Cannot complete review', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const reviewPending = detail.extractedFields.filter((f) => f.validationStatus === 'REVIEW');
  const grouped = detail.documents
    .filter((d) => d.status === 'AVAILABLE')
    .map((d) => ({ doc: d, fields: detail.extractedFields.filter((f) => f.documentId === d.id) }))
    .filter((g) => g.fields.length);

  return (
    <div className="space-y-4">
      {detail.invoice.stage === 'EXTRACTION_REVIEW' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-semantic-warningBg px-3 py-2.5">
          <p className="text-xs font-medium text-semantic-warning">
            Human-in-the-loop review required — {reviewPending.length} low-confidence field(s) must be accepted or corrected before validation resumes.
          </p>
          {hasPerm('FIELD_CORRECT') && (
            <Button size="sm" disabled={reviewPending.length > 0} loading={completeReview.isPending} onClick={() => completeReview.mutate()}>
              Complete review &amp; revalidate
            </Button>
          )}
        </div>
      )}

      {grouped.map(({ doc, fields }) => (
        <Card key={doc.id} title={<span>{doc.documentType?.name} <span className="ml-1 text-2xs font-normal text-ink-muted">{doc.fileName}</span></span>} pad={false}>
          <DataTable
            dense
            columns={[
              {
                key: 'label', header: 'Field', render: (f) => (
                  <button className="text-left" onMouseEnter={() => onHighlight(f.id)} onMouseLeave={() => onHighlight(null)}>
                    <span className="font-medium">{f.label}</span>
                    {f.mandatory && <span className="ml-1 text-semantic-error">*</span>}
                    <span className="block text-2xs text-ink-faint">{f.fieldCode} · {f.dataType}</span>
                  </button>
                ),
              },
              {
                key: 'value', header: 'Value', render: (f) => (
                  <div className="max-w-52">
                    <p className="truncate font-medium">{f.value || <span className="text-ink-faint">empty</span>}</p>
                    {f.corrections.length > 0 && (
                      <p className="truncate text-2xs text-ink-muted" title={`Original: ${f.rawValue}`}>
                        was “{f.corrections[f.corrections.length - 1].previousValue}”
                      </p>
                    )}
                  </div>
                ),
              },
              { key: 'confidence', header: 'Confidence', render: (f) => <ConfidenceBadge band={f.confidenceBand} value={f.confidence} /> },
              { key: 'page', header: 'Page', align: 'center', render: (f) => f.page },
              { key: 'evidence', header: 'Evidence', render: (f) => <span className="block max-w-56 truncate text-2xs text-ink-muted" title={f.evidence}>{f.evidence}</span> },
              { key: 'status', header: 'Status', render: (f) => <StatusBadge value={f.validationStatus} /> },
              {
                key: 'actions', header: 'Actions', render: (f) =>
                  hasPerm('FIELD_CORRECT') ? (
                    <div className="flex gap-1">
                      {f.validationStatus === 'REVIEW' && (
                        <Button size="sm" variant="secondary" onClick={() => accept.mutate(f.id)}>Accept</Button>
                      )}
                      <Button
                        size="sm" variant="ghost" aria-label={`Correct ${f.label}`}
                        onClick={() => {
                          setEditing(f);
                          setValue(f.value);
                          setReason('');
                        }}
                      >
                        <Pencil size={13} />
                      </Button>
                    </div>
                  ) : null,
              },
            ] satisfies Column<FieldRow>[]}
            rows={fields}
            rowKey={(f) => f.id}
          />
        </Card>
      ))}
      {grouped.length === 0 && <Card><p className="py-6 text-center text-xs text-ink-muted">No extracted fields yet — extraction runs after document completeness passes.</p></Card>}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Correct field: ${editing?.label}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={correct.isPending} disabled={!value.trim() || !reason.trim()} onClick={() => correct.mutate()}>
              Save correction
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md bg-canvas p-2.5 text-xs">
            <p><span className="text-ink-muted">Extracted value:</span> <span className="font-medium">{editing?.rawValue}</span></p>
            <p className="mt-1 text-2xs text-ink-muted">Evidence: {editing?.evidence} (page {editing?.page}, confidence {Math.round((editing?.confidence ?? 0) * 100)}%)</p>
          </div>
          <FormField label="Corrected value" required>
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
          </FormField>
          <FormField label="Reason for correction" required hint="Corrections never overwrite history — the previous value is retained in the audit trail.">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. OCR misread the PO number on a scanned copy" />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Validation
export function ValidationTab({ detail }: { detail: InvoiceDetail }) {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [overriding, setOverriding] = useState<ValidationResultRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const run = detail.validationRuns[0];

  const override = useMutation({
    mutationFn: (reason: string) => api.post(`/validation-results/${overriding!.id}/override`, { reason }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Validation overridden', detail: 'Override recorded and revalidation executed.' });
      setOverriding(null);
      qc.invalidateQueries({ queryKey: ['invoice', detail.invoice.id] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Override failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (!run) {
    return (
      <Card>
        <p className="py-8 text-center text-xs text-ink-muted">
          {detail.invoice.processingFlag === 'MISSING_DOCUMENTS'
            ? 'Business validation is on hold — mandatory supporting document(s) are missing. Available documents have been extracted (see Extracted Fields / SAP Mapping); supply the missing supporting document from the Documents tab and the pipeline resumes automatically.'
            : 'No validation run yet — validation executes after extraction completes.'}
        </p>
      </Card>
    );
  }

  const groups: { key: string; label: string; tone: 'success' | 'warning' | 'error' | 'pending' | 'neutral' }[] = [
    { key: 'FAIL', label: 'Failed', tone: 'error' },
    { key: 'HARD_FAIL', label: 'Hard Failed', tone: 'error' },
    { key: 'WARNING', label: 'Warnings', tone: 'warning' },
    { key: 'OVERRIDDEN', label: 'Overridden', tone: 'warning' },
    { key: 'PENDING', label: 'Pending', tone: 'pending' },
    { key: 'PASS', label: 'Passed', tone: 'success' },
    { key: 'SKIPPED', label: 'Not applicable', tone: 'neutral' },
  ];

  return (
    <div className="space-y-4">
      <Card title={`Latest validation run — ${run.id}`} actions={<StatusBadge value={run.outcome} label={run.outcome === 'PASS' ? 'PASSED' : run.outcome === 'FAIL' ? 'FAILED' : 'PENDING'} />}>
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-secondary">
          <span>Trigger: <span className="font-medium">{titleCase(run.trigger)}</span></span>
          <span>By: <span className="font-medium">{run.startedBy}</span></span>
          <span>At: <span className="font-medium">{fmtDateTime(run.startedAt)}</span></span>
          <span className="ml-auto flex gap-2">
            <Badge tone="success">{run.summary.passed} passed</Badge>
            {run.summary.warnings > 0 && <Badge tone="warning">{run.summary.warnings} warnings</Badge>}
            {(run.summary.failed > 0 || run.summary.hardFailed > 0) && <Badge tone="error">{run.summary.failed + run.summary.hardFailed} failed</Badge>}
            {run.summary.overridden > 0 && <Badge tone="warning">{run.summary.overridden} overridden</Badge>}
            {run.summary.pending > 0 && <Badge tone="pending">{run.summary.pending} pending</Badge>}
          </span>
        </div>
        {detail.validationRuns.length > 1 && (
          <p className="mt-2 border-t border-line-soft pt-2 text-2xs text-ink-muted">
            {detail.validationRuns.length - 1} previous run(s) retained for audit: {detail.validationRuns.slice(1, 5).map((r) => `${r.id} (${r.outcome}, ${titleCase(r.trigger)})`).join(', ')}
          </p>
        )}
      </Card>

      {groups.map((g) => {
        const rows = detail.validationResults.filter((r) => r.result === g.key);
        if (!rows.length) return null;
        return (
          <Card key={g.key} title={<span className="flex items-center gap-2">{g.label} <Badge tone={g.tone}>{rows.length}</Badge></span>} pad={false}>
            <div className="divide-y divide-line-soft">
              {rows.map((r) => (
                <div key={r.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <StatusBadge value={r.result} />
                      <span className="font-mono text-2xs text-ink-muted">{r.ruleCode}</span>
                      <span className="truncate text-xs font-medium text-ink">{r.ruleName}</span>
                      <Badge tone="neutral">{titleCase(r.ruleType)}</Badge>
                      {r.blocking && <Badge tone="error">Blocking</Badge>}
                    </button>
                    {['FAIL', 'HARD_FAIL', 'WARNING'].includes(r.result) && r.overrideAllowed && hasPerm('VALIDATION_OVERRIDE') && (
                      <Button size="sm" variant="warning" onClick={() => setOverriding(r)}>
                        <ShieldOff size={12} /> Override
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-secondary">{r.message}</p>
                  {r.override && (
                    <p className="mt-1 rounded bg-semantic-warningBg px-2 py-1 text-2xs text-semantic-warning">
                      Overridden by {r.override.byName} ({r.override.role}) on {fmtDateTime(r.override.at)} — “{r.override.reason}”. Previous result: {r.override.previousResult}.
                    </p>
                  )}
                  {expanded === r.id && (
                    <div className="mt-2 overflow-x-auto rounded-md border border-line-soft bg-canvas p-2.5">
                      <div className="mb-2 grid grid-cols-2 gap-2 text-2xs md:grid-cols-4">
                        <span><span className="text-ink-muted">Expected:</span> <span className="font-medium">{r.expected}</span></span>
                        <span><span className="text-ink-muted">Actual:</span> <span className="font-medium">{r.actual}</span></span>
                        <span><span className="text-ink-muted">Tolerance:</span> <span className="font-medium">{r.tolerance}</span></span>
                        <span><span className="text-ink-muted">Difference:</span> <span className={clsx('font-medium', (r.differencePct ?? 0) > 0 && r.result !== 'PASS' ? 'text-semantic-error' : '')}>{r.differencePct != null ? `${r.differencePct}%` : '—'}</span></span>
                      </div>
                      {r.operandValues.length > 0 && (
                        <div className="flex flex-wrap items-stretch gap-2">
                          {r.operandValues.map((o, i) => (
                            <div key={o.alias} className="flex items-center gap-2">
                              {i > 0 && <span className="self-center text-xs font-bold text-ink-faint">=</span>}
                              <div className="min-w-32 rounded-md border border-line bg-white p-2">
                                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Operand {o.alias} · {o.source}</p>
                                <p className="text-sm font-semibold text-ink">{o.value == null ? '—' : typeof o.value === 'number' ? o.value.toLocaleString('en-US') : o.value}</p>
                                <p className="text-2xs text-ink-muted">{o.label}{o.detail ? ` · ${o.detail}` : ''}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-2xs text-ink-faint">Rule version {r.ruleVersion} · severity {r.severity} · override {r.overrideAllowed ? 'allowed' : 'not allowed'}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        );
      })}

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
            <p className="text-ink-muted">Expected {overriding?.expected} · Actual {overriding?.actual} · Tolerance {overriding?.tolerance}</p>
          </div>
        }
      />
    </div>
  );
}
