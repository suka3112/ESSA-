/**
 * Invoice Detail — the single place where an invoice is understood and fixed.
 *
 * UI/UX review (Aug 2026):
 *  · Current Status and Next Status are shown in the header with the same
 *    wording and tooltips used everywhere else.
 *  · No separate "Exceptions" tab: failed checks are corrected in Extract &
 *    Validate, and anything that cannot be fixed there (missing document,
 *    rejection, technical failure) is handled in the panel above the tabs.
 *  · The document selector drop-down is gone — picking a document tab in
 *    Extract & Validate shows that document, exactly as in the reference build.
 *  · A rejected invoice explains what happens next instead of leaving the user
 *    to guess how resubmission works.
 */
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, PanelRightClose, PanelRightOpen, Plus, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { currentStatus, fmtDate, fmtDateTime, fmtMoney, isPreExtraction, nextStatus, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, ErrorState, Field, InvoiceStatusBadge, LoadingState, Modal, NotAvailable, Select, Tabs, useToast, Input,
} from '@/components/ui';
import type { DocumentRow, InvoiceDetail } from './invoice/types';
import { DocumentViewer } from './invoice/DocumentViewer';
import { ExtractValidateTab } from './invoice/ExtractValidate';
import { ApprovalsTab, TimelineTab } from './invoice/tabs2';
import { ExceptionActions } from './exceptions/ExceptionActions';

/** Legacy tab keys (old bookmarks / links) map onto the current tabs. */
const LEGACY_TABS: Record<string, string> = {
  overview: 'extract', documents: 'extract', fields: 'extract', validation: 'extract',
  mapping: 'extract', audit: 'timeline',
  // The Exceptions tab was removed — exception handling lives on this page.
  exceptions: 'extract',
};

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') ?? 'extract';
  const tab = LEGACY_TABS[rawTab] ?? rawTab;
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [showDoc, setShowDoc] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [highlightField, setHighlightField] = useState<string | null>(null);
  const [docModal, setDocModal] = useState<{ mode: 'add' | 'replace'; doc?: DocumentRow; documentTypeId?: string } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    refetchInterval: 10_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['invoice', id] });

  const handoff = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/sap-handoff`),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Sent to SAP for parking' });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Handoff failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading) return <LoadingState label="Loading invoice…" />;
  if (isError || !data) {
    const err = error instanceof ApiError ? error : undefined;
    return <ErrorState message={err?.body.message ?? 'Invoice could not be loaded'} correlationId={err?.body.correlationId} onRetry={() => refetch()} />;
  }
  const inv = data.invoice;
  const openExceptions = data.exceptions.filter((e) => !['RESOLVED', 'CLOSED'].includes(e.status));
  const activeSteps = data.workflow?.steps.filter((s) => s.status === 'ACTIVE').length ?? 0;
  const failedChecks = data.validationResults.filter((r) => ['FAIL', 'HARD_FAIL'].includes(r.result)).length;
  const state = { ...inv, openExceptions: openExceptions.length };
  const processing = isPreExtraction(inv);
  const rejected = currentStatus(state) === 'Rejected';

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/invoices')}>
            <ArrowLeft size={14} /> Invoices
          </Button>
          <h1 className="text-xl font-semibold text-ink">
            {inv.categoryName ? (/invoice$/i.test(inv.categoryName) ? inv.categoryName : `${inv.categoryName} Invoice`) : 'Invoice'}
          </h1>
          {/* Current Status → Next Status, in the shared vocabulary. */}
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Current</span>
            <InvoiceStatusBadge status={currentStatus(state)} />
            <ArrowRight size={12} className="text-ink-faint" />
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Next</span>
            <InvoiceStatusBadge status={nextStatus(state)} muted />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPerm('SAP_RETRY') && inv.lifecycle === 'VALIDATED' && (
            <Button size="sm" loading={handoff.isPending} onClick={() => handoff.mutate()}>
              <Send size={14} /> Send to SAP
            </Button>
          )}
          {hasPerm('INVOICE_EDIT') && (
            <Button size="sm" variant="secondary" onClick={() => setDocModal({ mode: 'add' })}>
              <Plus size={13} /> Add document
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setShowDoc((s) => !s)}>
            {showDoc ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            {showDoc ? 'Hide document' : 'View document'}
          </Button>
        </div>
      </div>

      {/* ---------------------------------------------------------- meta strip */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-xs font-semibold text-ink-secondary">Invoice number</span>
            {processing ? <NotAvailable label="Reading from document…" /> : <span className="text-lg font-bold text-ink">{inv.invoiceNumber}</span>}
            <span className="text-ink-faint">·</span>
            <span className="text-xs font-semibold text-ink-secondary">Vendor</span>
            {processing ? <NotAvailable /> : <span className="font-semibold text-ink">{inv.vendorName}</span>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-secondary">
            <span className="text-xs font-semibold text-ink-secondary">PO number</span>
            <span className="font-mono font-semibold text-essa-700">{inv.poNumber ?? '—'}</span>
            <span className="text-ink-faint">·</span>
            <span className="text-xs font-semibold text-ink-secondary">Invoice date</span>
            {processing ? <NotAvailable /> : <span className="flex items-center gap-1 font-medium"><CalendarDays size={12} /> {fmtDate(inv.invoiceDate)}</span>}
            <span className="text-ink-faint">·</span>
            <span className="text-xs font-semibold text-ink-secondary">SLA due</span>
            {inv.slaBreached ? <Badge tone="error">SLA Breached</Badge> : <span className="font-medium">{fmtDateTime(inv.slaDueAt)}</span>}
          </p>
        </div>
        <p className="text-right">
          <span className="mr-2 text-xs font-semibold text-ink-secondary">Invoice amount</span>
          {processing ? <NotAvailable /> : <span className="text-2xl font-bold text-ink">{fmtMoney(inv.amount, inv.currency)}</span>}
        </p>
      </div>

      {/* Still extracting — say so plainly instead of showing half-read values. */}
      {processing && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink-secondary">
          <span className="h-2 w-2 animate-pulse rounded-full bg-essa-500" />
          The invoice is being processed. Invoice number, vendor, category and amount appear once extraction finishes.
        </div>
      )}

      {/* A rejected invoice explains the resubmission route in plain language. */}
      {rejected && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-semantic-errorBg px-3 py-2 text-xs text-semantic-error">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">This invoice was rejected.</span>{' '}
            It stays in the system until corrected documents are received. When the vendor sends the corrected
            documents they replace the ones on this invoice and processing continues here. If the vendor issues a
            different invoice number, a new invoice record is created and this one is closed — the Timeline tab records
            both sides of that change.
          </span>
        </div>
      )}

      {/* Invoice-level exceptions that cannot be fixed by correcting a field —
          missing documents, rejections and technical failures (review §7). */}
      {openExceptions.length > 0 && (
        <Card
          title={<span className="text-semantic-error">Open exceptions ({openExceptions.length})</span>}
          pad={false}
        >
          <ul className="divide-y divide-line-soft">
            {openExceptions.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-essa-700">{e.code}</span>
                  <Badge tone="error">{titleCase(e.type)}</Badge>
                  <span className="text-2xs text-ink-muted">Raised {fmtDateTime(e.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs font-medium text-ink">{e.title}</p>
                <p className="text-xs text-ink-secondary">{e.detail}</p>
                <div className="mt-2">
                  <ExceptionActions
                    exception={e}
                    onChanged={invalidate}
                    onAddDocument={hasPerm('INVOICE_EDIT') ? () => setDocModal({ mode: 'add' }) : undefined}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------------------------------------- body */}
      <div className={showDoc ? 'grid grid-cols-1 gap-4 xl:grid-cols-5' : 'grid grid-cols-1'}>
        {showDoc && (
          <div className="xl:sticky xl:top-0 xl:col-span-2 xl:h-[calc(100vh-12rem)]">
            {/* No document drop-down (review): the document shown here follows
                the document tab selected in Extract & Validate. */}
            <div className="h-full">
              <DocumentViewer
                key={selectedDoc ?? 'first'}
                detail={data}
                documents={data.documents.filter((d) => d.status !== 'SUPERSEDED' || selectedDoc === d.id)}
                selectedId={selectedDoc}
                onSelect={setSelectedDoc}
                onReplace={hasPerm('INVOICE_EDIT') ? (doc) => setDocModal({ mode: 'replace', doc }) : undefined}
                fields={data.extractedFields}
                highlightField={highlightField}
              />
            </div>
          </div>
        )}

        <div className={showDoc ? 'min-w-0 xl:col-span-3' : 'min-w-0'}>
          <Card>
            {/* The Approvals tab shows only for Non-PO invoices — PO invoices
                need no approval. */}
            <Tabs
              tabs={[
                { key: 'extract', label: 'Extract & Validate' },
                { key: 'timeline', label: 'Timeline' },
                ...(!inv.poNumber ? [{ key: 'approvals', label: 'Approvals' }] : []),
              ]}
              counts={{ extract: failedChecks, approvals: activeSteps }}
              active={tab === 'approvals' && inv.poNumber ? 'extract' : tab}
              onChange={setTab}
            />
            <div className="mt-3">
              {tab === 'extract' && (
                <ExtractValidateTab
                  detail={data}
                  onAddDocument={(documentTypeId) => setDocModal({ mode: 'add', documentTypeId })}
                  onSelectDocument={setSelectedDoc}
                  onHighlight={setHighlightField}
                />
              )}
              {tab === 'timeline' && <TimelineTab timeline={data.timeline} />}
              {tab === 'approvals' && !inv.poNumber && <ApprovalsTab detail={data} />}
            </div>
          </Card>
        </div>
      </div>

      <DocumentModal state={docModal} onClose={() => setDocModal(null)} detail={data} onDone={invalidate} />
    </div>
  );
}

function DocumentModal({ state, onClose, detail, onDone }: { state: { mode: 'add' | 'replace'; doc?: DocumentRow; documentTypeId?: string } | null; onClose: () => void; detail: InvoiceDetail; onDone: () => void }) {
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [docTypeId, setDocTypeId] = useState('');
  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<{ documentTypes: { id: string; name: string }[] }>('/lookups'),
  });
  const effectiveType = state?.mode === 'replace' ? state.doc?.documentTypeId : state?.documentTypeId || docTypeId;

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/invoices/${detail.invoice.id}/documents`, {
        fileName,
        documentTypeId: effectiveType,
        replaceDocumentId: state?.mode === 'replace' ? state.doc?.id : undefined,
      }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: state?.mode === 'replace' ? 'Document replaced' : 'Document added', detail: 'Extraction and validation re-run automatically.' });
      setFileName('');
      setDocTypeId('');
      onClose();
      onDone();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Upload failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  return (
    <Modal
      open={Boolean(state)}
      onClose={onClose}
      title={state?.mode === 'replace' ? `Replace ${state.doc?.documentType?.name}` : 'Add document'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={submit.isPending} disabled={!fileName.trim() || !effectiveType} onClick={() => submit.mutate()}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {state?.mode === 'replace' && (
          <p className="rounded-md bg-canvas p-2.5 text-xs text-ink-secondary">
            Replacing <span className="font-medium">{state.doc?.fileName}</span> (v{state.doc?.version}). The previous version is kept for audit, and only the affected checks re-run.
          </p>
        )}
        {state?.mode === 'add' && !state.documentTypeId && (
          <Field label="Document type" required>
            <Select value={docTypeId} onChange={(e) => setDocTypeId(e.target.value)} className="w-full">
              <option value="">Select type…</option>
              {lookups?.documentTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="File name" required>
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="e.g. GRN_5000104211_signed.pdf" />
        </Field>
      </div>
    </Modal>
  );
}
