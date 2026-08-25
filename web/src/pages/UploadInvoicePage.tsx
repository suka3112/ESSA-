/**
 * Manual Portal Upload — V2 journey aligned with the V1 upload experience.
 *
 * Two-step flow, exactly as V1:
 *   Step 1 · Upload documents  — pick a document type, add each file to the batch,
 *                                review the "Document batch" table, then Next — Run OCR.
 *   Step 2 · OCR & validation  — per-file extraction progress + OCR status; a failure
 *                                shows the dismissible error banner and "Start over".
 *
 * The invoice header values the upload API requires (vendor, category, amount)
 * are auto-filled with defaults at submit time — matching V1, where the journey
 * is purely document-driven and header values come from OCR extraction.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, FileText, Layers, Trash2, UploadCloud, X } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, ProgressBar, Select, useToast } from '@/components/ui';

interface Lookups {
  categories: { id: string; code: string; name: string; poBased: boolean }[];
  documentTypes: { id: string; code: string; name: string }[];
  vendors: { code: string; name: string }[];
}

type OcrStatus = 'STAGED' | 'PROCESSING' | 'DONE' | 'FAILED';

interface BatchItem {
  fileName: string;
  sizeKb: number;
  documentTypeId: string;
  progress: number;
  ocrStatus: OcrStatus;
  detail?: string;
}

function guessDocType(fileName: string, types: Lookups['documentTypes']): string {
  const n = fileName.toLowerCase();
  const find = (code: string) => types.find((t) => t.code === code)?.id ?? '';
  if (/(invoice|inv[_-])/.test(n)) return find('INVOICE');
  if (/po|purchase/.test(n)) return find('PURCHASE_ORDER');
  if (/grn|receipt/.test(n)) return find('GRN');
  if (/ses|service.?entry/.test(n)) return find('SES');
  if (/timesheet/.test(n)) return find('TIMESHEET');
  if (/manhour/.test(n)) return find('MANHOUR_SUMMARY');
  if (/attendance/.test(n)) return find('ATTENDANCE_SHEET');
  if (/meal/.test(n)) return find('MEAL_SUMMARY');
  if (/tax|gst/.test(n)) return find('TAX_INVOICE');
  if (/challan|delivery/.test(n)) return find('DELIVERY_CHALLAN');
  if (/dept|confirmation/.test(n)) return find('DEPT_CONFIRMATION');
  return find('SUPPORTING_DOC');
}

/** V1-style numbered stepper across the top. */
function Stepper({ step }: { step: 1 | 2 }) {
  const steps = [
    { no: 1, title: 'Upload documents', hint: 'Pick a type and add each file to your batch' },
    { no: 2, title: 'OCR & validation', hint: 'Run extraction on all staged documents' },
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {steps.map((s, i) => {
        const done = step > s.no;
        const active = step === s.no;
        return (
          <div key={s.no} className="flex items-center gap-4">
            {i > 0 && <span className={clsx('hidden h-px w-16 sm:block', step === 2 ? 'bg-essa-500' : 'bg-line-strong')} />}
            <div className="flex items-center gap-2.5">
              {done ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-essa-500 text-essa-600">
                  <CheckCircle2 size={15} />
                </span>
              ) : (
                <span
                  className={clsx(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                    active ? 'bg-essa-600 text-white' : 'border border-line-strong bg-white text-ink-muted'
                  )}
                >
                  {s.no}
                </span>
              )}
              <span>
                <span className={clsx('block text-sm font-semibold leading-tight', active || done ? 'text-ink' : 'text-ink-muted')}>{s.title}</span>
                <span className="block text-2xs text-ink-muted">{s.hint}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function UploadInvoicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });

  const [step, setStep] = useState<1 | 2>(1);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [pickedType, setPickedType] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const usedTypeIds = new Set(batch.map((b) => b.documentTypeId));
  const remainingTypes = (lookups?.documentTypes ?? []).filter((t) => !usedTypeIds.has(t.id));
  const allTypesAdded = Boolean(lookups) && remainingTypes.length === 0;

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (!lookups) return;
      const incoming = Array.from(list);
      const accepted = incoming.filter((f) => /\.(pdf|png|jpe?g|tiff?)$/i.test(f.name));
      if (accepted.length < incoming.length) {
        toast.push({ tone: 'warning', title: `${incoming.length - accepted.length} file(s) rejected`, detail: 'Only PDF and image formats are accepted per file security policy.' });
      }
      setBatch((prev) => {
        const next = [...prev];
        for (const f of accepted) {
          if (next.some((b) => b.fileName === f.name)) {
            toast.push({ tone: 'warning', title: 'Duplicate file skipped', detail: f.name });
            continue;
          }
          const used = new Set(next.map((b) => b.documentTypeId));
          const preferred = pickedType && !used.has(pickedType) ? pickedType : '';
          const guessed = guessDocType(f.name, lookups.documentTypes);
          const fallback = lookups.documentTypes.find((t) => !used.has(t.id))?.id ?? '';
          const typeId = preferred || (guessed && !used.has(guessed) ? guessed : fallback);
          if (!typeId) {
            toast.push({ tone: 'warning', title: 'All document types have been added', detail: 'Remove a document from the batch to add a different type.' });
            break;
          }
          next.push({ fileName: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), documentTypeId: typeId, progress: 0, ocrStatus: 'STAGED' });
        }
        return next;
      });
      setPickedType('');
    },
    [lookups, pickedType, toast]
  );

  const typeName = (id: string) => lookups?.documentTypes.find((t) => t.id === id)?.name ?? '—';
  const batchValid = batch.length > 0 && batch.every((b) => b.documentTypeId);

  const submit = useMutation({
    // The upload API requires a vendor / category / amount to open the invoice
    // record. The V1-style journey is document-only, so sensible defaults are
    // sent and the real values come from OCR extraction downstream.
    mutationFn: () => {
      const defaultCategory = lookups?.categories.find((c) => c.poBased) ?? lookups?.categories[0];
      return api.post<{ invoiceId: string; invoiceNumber: string; correlationId: string }>('/invoices/upload', {
        vendorCode: lookups?.vendors[0]?.code,
        categoryId: defaultCategory?.id,
        amount: 100000,
        description: 'Manual upload — pending OCR extraction',
        files: batch.map((b) => ({ fileName: b.fileName, sizeKb: b.sizeKb, documentTypeId: b.documentTypeId })),
      });
    },
    onSuccess: (r) => {
      if (timer.current) window.clearInterval(timer.current);
      setBatch((prev) => prev.map((b) => ({ ...b, progress: 100, ocrStatus: 'DONE', detail: 'Extraction queued' })));
      toast.push({ tone: 'success', title: `Invoice ${r.invoiceNumber} created`, detail: `Classification and extraction started · ${r.correlationId}` });
      window.setTimeout(() => navigate(`/invoices/${r.invoiceId}?tab=timeline`), 650);
    },
    onError: (e) => {
      if (timer.current) window.clearInterval(timer.current);
      const msg = e instanceof ApiError ? e.body.message : String(e);
      setBatch((prev) => prev.map((b) => ({ ...b, ocrStatus: 'FAILED', detail: msg })));
      setBanner(`${batch[0]?.fileName ?? 'Batch'}: ${msg}`);
    },
  });

  const runOcr = () => {
    setBanner(null);
    setStep(2);
    setBatch((prev) => prev.map((b) => ({ ...b, progress: 4, ocrStatus: 'PROCESSING', detail: undefined })));
    timer.current = window.setInterval(() => {
      setBatch((prev) => prev.map((b) => (b.ocrStatus === 'PROCESSING' ? { ...b, progress: Math.min(92, b.progress + 6 + Math.random() * 8) } : b)));
    }, 350);
    submit.mutate();
  };

  const startOver = () => {
    if (timer.current) window.clearInterval(timer.current);
    setBanner(null);
    setStep(1);
    setBatch((prev) => prev.map((b) => ({ ...b, progress: 0, ocrStatus: 'STAGED', detail: undefined })));
  };

  const ocrBadge = (s: OcrStatus) => {
    const map: Record<OcrStatus, { label: string; cls: string }> = {
      STAGED: { label: '· Staged', cls: 'border-line bg-canvas text-ink-secondary' },
      PROCESSING: { label: '· Processing', cls: 'border-amber-200 bg-semantic-warningBg text-semantic-warning' },
      DONE: { label: '· Done', cls: 'border-essa-200 bg-semantic-successBg text-semantic-success' },
      FAILED: { label: '· Failed', cls: 'border-red-200 bg-semantic-errorBg text-semantic-error' },
    };
    const m = map[s];
    return <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', m.cls)}>{m.label}</span>;
  };

  const failed = batch.some((b) => b.ocrStatus === 'FAILED');

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Stepper step={step} />

      {/* Error banner — matches V1's dismissible red strip on step 2 */}
      {banner && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-semantic-errorBg px-3 py-2.5 text-xs text-semantic-error">
          <span className="flex min-w-0 items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words"><span className="font-semibold">Error:</span> {banner}</span>
          </span>
          <button aria-label="Dismiss error" onClick={() => setBanner(null)} className="shrink-0 rounded p-0.5 hover:bg-red-100">
            <X size={14} />
          </button>
        </div>
      )}

      {step === 1 && (
        <>
          {/* Add document */}
          <section className="rounded-xl border border-line bg-white shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Layers size={16} className="text-essa-600" /> Add document
              </h2>
              {!allTypesAdded && (
                <Select value={pickedType} onChange={(e) => setPickedType(e.target.value)} aria-label="Document type to add" className="!h-8 !text-xs">
                  <option value="">Auto-detect type…</option>
                  {remainingTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              )}
            </header>
            <div className="p-4">
              {allTypesAdded ? (
                <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-line-strong bg-canvas/60 px-6 py-12 text-center">
                  <UploadCloud size={30} className="text-ink-faint" />
                  <p className="text-sm font-medium text-ink-muted">All document types have been added</p>
                  <p className="text-xs text-ink-faint">Remove a document from the batch below to add a different type</p>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                  className={clsx(
                    'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                    dragOver ? 'border-essa-500 bg-essa-50' : 'border-line-strong bg-canvas/60'
                  )}
                >
                  <UploadCloud size={30} className="text-essa-600" />
                  <p className="text-sm font-medium text-ink">Drag &amp; drop a document, or browse</p>
                  <p className="text-xs text-ink-muted">PDF, PNG, JPG, TIFF · one document per type · file signature and malware checks apply</p>
                  <label className="mt-1 cursor-pointer">
                    <span className="inline-flex h-8 items-center rounded-md border border-essa-600 px-3 text-sm font-medium text-essa-700 hover:bg-essa-50">
                      <FileText size={14} className="mr-1.5" /> Browse files
                    </span>
                    <input type="file" multiple className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Document batch — shown on both steps, exactly like V1 */}
      <section className="rounded-xl border border-line bg-white shadow-card">
        <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileText size={16} className="text-essa-600" /> Document batch
            <span className="text-xs font-normal text-ink-muted">· {batch.length} document{batch.length === 1 ? '' : 's'}</span>
          </h2>
          {step === 1 && batch.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setBatch([])}>
              <X size={13} /> Clear all
            </Button>
          )}
        </header>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line-soft text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">File</th>
                <th className="px-4 py-2.5">Details</th>
                <th className="px-4 py-2.5">Extraction progress</th>
                <th className="px-4 py-2.5">OCR status</th>
                <th className="px-4 py-2.5">Validation</th>
                {step === 1 && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {batch.length === 0 ? (
                <tr>
                  <td colSpan={step === 1 ? 7 : 6} className="px-4 py-8 text-center text-xs text-ink-muted">
                    No documents staged yet — add the invoice PDF above to start a batch.
                  </td>
                </tr>
              ) : (
                batch.map((b, i) => (
                  <tr key={b.fileName} className="border-b border-line-soft">
                    <td className="px-4 py-2.5">
                      {step === 1 ? (
                        <Select
                          value={b.documentTypeId}
                          aria-label={`Document type for ${b.fileName}`}
                          onChange={(e) => setBatch((prev) => prev.map((p, pi) => (pi === i ? { ...p, documentTypeId: e.target.value } : p)))}
                          className="!h-7 !text-xs"
                        >
                          <option value="">Classify…</option>
                          {lookups?.documentTypes
                            .filter((t) => t.id === b.documentTypeId || !usedTypeIds.has(t.id))
                            .map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </Select>
                      ) : (
                        <span className="inline-flex rounded-md border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink-secondary">{typeName(b.documentTypeId)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-ink">{b.fileName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-muted">
                      {b.sizeKb} KB{b.detail && b.ocrStatus === 'FAILED' ? <span className="ml-1 text-semantic-error" title={b.detail}>· {b.detail.slice(0, 24)}…</span> : null}
                    </td>
                    <td className="w-56 px-4 py-2.5">
                      {b.ocrStatus === 'STAGED' ? (
                        <span className="text-xs text-ink-faint">—</span>
                      ) : b.ocrStatus === 'FAILED' ? (
                        <span className="text-xs font-medium text-semantic-error">Extraction failed</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-36"><ProgressBar value={b.progress} tone={b.ocrStatus === 'DONE' ? 'success' : 'success'} /></div>
                          <span className="text-2xs text-ink-muted">{Math.round(b.progress)}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{ocrBadge(b.ocrStatus)}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-faint">{b.ocrStatus === 'DONE' ? <Badge tone="success">Queued</Badge> : '—'}</td>
                    {step === 1 && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          aria-label={`Remove ${b.fileName}`}
                          onClick={() => setBatch((prev) => prev.filter((_, pi) => pi !== i))}
                          className="rounded-md border border-line p-1.5 text-ink-faint hover:bg-semantic-errorBg hover:text-semantic-error"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer — step 1 shows readiness + Next; step 2 shows Start over on failure */}
        {step === 1 ? (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-4 py-3">
            <p className="text-xs text-ink-muted">
              {batch.length === 0
                ? 'Stage at least one document to continue'
                : `${batch.length} document${batch.length === 1 ? '' : 's'} ready · add more unique types or click Next to run OCR`}
            </p>
            <Button disabled={!batchValid || !lookups} onClick={runOcr}>
              Next — Run OCR <UploadCloud size={15} />
            </Button>
          </footer>
        ) : (
          <footer className="flex items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
            {failed ? (
              <Button variant="secondary" onClick={startOver}>Start over</Button>
            ) : (
              <p className="text-xs text-ink-muted">{submit.isPending ? 'Running OCR & validation on all staged documents…' : 'Extraction complete — opening the invoice…'}</p>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
