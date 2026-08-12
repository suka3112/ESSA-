/**
 * Invoice detail page — V1 vendor-portal layout, V2 design system.
 *
 * Layout mirrors V1: back button + title header, invoice meta strip with the
 * amount on the right, a collapsible document pane on the left (Hide/View
 * document), and a tabbed card on the right whose first tab is the combined
 * "Extract & Validate" view. V2-only capabilities (SAP Mapping, Exceptions,
 * Approvals, Audit) remain available as additional tabs.
 */
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, PanelRightClose, PanelRightOpen, Plus, Send, UserPlus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtMoney, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, ErrorState, Field, LoadingState, Modal, Select, StatusBadge, Tabs, useToast, Input,
} from '@/components/ui';
import type { DocumentRow, InvoiceDetail } from './invoice/types';
import { DocumentViewer } from './invoice/DocumentViewer';
import { ExtractValidateTab } from './invoice/ExtractValidate';
import { ApprovalsTab, AuditTab, ExceptionsTab, TimelineTab } from './invoice/tabs2';
import { MappingTab } from './invoice/MappingTab';

/** Legacy tab keys (old bookmarks / links) map onto the new V1-style tabs. */
const LEGACY_TABS: Record<string, string> = {
  overview: 'extract', documents: 'extract', fields: 'extract', validation: 'extract',
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
  const [assignOpen, setAssignOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    refetchInterval: 10_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['invoice', id] });

  const handoff = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/sap-handoff`),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'SAP handoff queued' });
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Handoff failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading) return <LoadingState label="Loading invoice workbench…" />;
  if (isError || !data) {
    const err = error instanceof ApiError ? error : undefined;
    return <ErrorState message={err?.body.message ?? 'Invoice could not be loaded'} correlationId={err?.body.correlationId} onRetry={() => refetch()} />;
  }
  const inv = data.invoice;
  const openExceptions = data.exceptions.filter((e) => !['RESOLVED', 'CLOSED'].includes(e.status)).length;
  const activeSteps = data.workflow?.steps.filter((s) => s.status === 'ACTIVE').length ?? 0;
  const failedChecks = data.validationResults.filter((r) => ['FAIL', 'HARD_FAIL'].includes(r.result)).length;

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
          <h1 className="text-xl font-semibold text-ink">{inv.categoryName ? `${inv.categoryName} Invoice` : 'Invoice'}</h1>
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge value={inv.lifecycle} />
            <StatusBadge value={inv.stage} />
            {inv.processingFlag && <Badge tone="warning">{titleCase(inv.processingFlag)}</Badge>}
            {inv.priority !== 'NORMAL' && <StatusBadge value={inv.priority} />}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPerm('INVOICE_EDIT') && (
            <Button variant="ghost" size="sm" onClick={() => setAssignOpen(true)}>
              <UserPlus size={14} /> Assign
            </Button>
          )}
          {hasPerm('SAP_RETRY') && inv.lifecycle === 'VALIDATED' && (
            <Button size="sm" loading={handoff.isPending} onClick={() => handoff.mutate()}>
              <Send size={14} /> SAP Handoff
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
            <span className="text-2xs text-ink-muted">Invoice no.</span>
            <span className="text-lg font-bold text-ink">{inv.invoiceNumber}</span>
            <span className="text-ink-faint">·</span>
            <span className="text-2xs text-ink-muted">Vendor</span>
            <span className="font-semibold text-ink">{inv.vendorName}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-secondary">
            <span className="text-2xs text-ink-muted">PO no.</span>
            <span className="font-mono font-semibold text-essa-700">{inv.poNumber ?? '—'}</span>
            <span className="text-ink-faint">·</span>
            <span className="text-2xs text-ink-muted">Invoice date</span>
            <span className="flex items-center gap-1 font-medium"><CalendarDays size={12} /> {fmtDate(inv.invoiceDate)}</span>
            {inv.slaBreached && <Badge tone="error">SLA breached</Badge>}
            {inv.assignedToName && <span className="text-2xs text-ink-muted">· Assigned to <span className="font-medium text-ink-secondary">{inv.assignedToName}</span></span>}
          </p>
        </div>
        <p className="text-right">
          <span className="mr-2 text-2xs text-ink-muted">Invoice amount</span>
          <span className="text-2xl font-bold text-ink">{fmtMoney(inv.amount, inv.currency)}</span>
        </p>
      </div>

      {/* ---------------------------------------------------------- body */}
      <div className={showDoc ? 'grid grid-cols-1 gap-4 xl:grid-cols-5' : 'grid grid-cols-1'}>
        {showDoc && (
          <div className="xl:sticky xl:top-0 xl:col-span-2 xl:h-[calc(100vh-12rem)]">
            <div className="flex h-full flex-col gap-2">
              {hasPerm('INVOICE_EDIT') && (
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setDocModal({ mode: 'add' })}>
                    <Plus size={13} /> Add document
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <DocumentViewer
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
          </div>
        )}

        <div className={showDoc ? 'min-w-0 xl:col-span-3' : 'min-w-0'}>
          <Card>
            <Tabs
              tabs={[
                { key: 'extract', label: 'Extract & Validate' },
                { key: 'timeline', label: 'Timeline' },
                { key: 'mapping', label: 'SAP Mapping' },
                { key: 'exceptions', label: 'Exceptions' },
                { key: 'approvals', label: 'Approvals' },
                { key: 'audit', label: 'Audit' },
              ]}
              counts={{ extract: failedChecks, exceptions: openExceptions, approvals: activeSteps }}
              active={tab}
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
              {tab === 'mapping' && <MappingTab detail={data} />}
              {tab === 'exceptions' && <ExceptionsTab detail={data} />}
              {tab === 'approvals' && <ApprovalsTab detail={data} />}
              {tab === 'audit' && <AuditTab events={data.auditEvents} />}
            </div>
          </Card>
        </div>
      </div>

      <DocumentModal state={docModal} onClose={() => setDocModal(null)} detail={data} onDone={invalidate} />
      <AssignModal open={assignOpen} onClose={() => setAssignOpen(false)} invoiceId={inv.id} onDone={invalidate} />
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
      toast.push({ tone: 'success', title: state?.mode === 'replace' ? 'Document replaced' : 'Document added', detail: 'Affected extraction/validation will re-run automatically.' });
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
            Upload to SharePoint
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {state?.mode === 'replace' && (
          <p className="rounded-md bg-canvas p-2.5 text-xs text-ink-secondary">
            Replacing <span className="font-medium">{state.doc?.fileName}</span> (v{state.doc?.version}). The previous version is retained as superseded for audit, and only affected extraction/validation re-runs.
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
        <Field label="File name" required hint="Demo environment: the file binary is simulated; metadata and repository references are stored (SharePoint is the document repository).">
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="e.g. GRN_5000104211_signed.pdf" />
        </Field>
      </div>
    </Modal>
  );
}

function AssignModal({ open, onClose, invoiceId, onDone }: { open: boolean; onClose: () => void; invoiceId: string; onDone: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<{ users: { id: string; name: string; title: string; enabled: boolean }[] }>('/lookups'),
  });
  const assign = useMutation({
    mutationFn: () => api.post(`/invoices/${invoiceId}/assign`, { userId: userId || undefined }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: userId ? 'Invoice assigned' : 'Invoice unassigned' });
      onClose();
      onDone();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Assignment failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign invoice"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={assign.isPending} onClick={() => assign.mutate()}>Save</Button>
        </>
      }
    >
      <Field label="Assign to">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full">
          <option value="">Unassigned</option>
          {lookups?.users.filter((u) => u.enabled).map((u) => (
            <option key={u.id} value={u.id}>{u.name} — {u.title}</option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
