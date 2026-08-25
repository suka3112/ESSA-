import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCcw, ZoomIn, ZoomOut } from 'lucide-react';
import clsx from 'clsx';
import { fmtMoney } from '@/lib/format';
import { StatusBadge } from '@/components/ui';
import type { DocumentRow, FieldRow, InvoiceDetail } from './types';

/**
 * Mock document viewer: renders a synthetic preview of the selected document
 * (in production this pane streams the PDF from SharePoint via Graph).
 * Extracted fields are highlighted with confidence colouring.
 */
export function DocumentViewer({
  detail,
  documents,
  selectedId,
  onSelect,
  onReplace,
  fields,
  highlightField,
}: {
  detail: InvoiceDetail;
  documents: DocumentRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReplace?: (doc: DocumentRow) => void;
  fields: FieldRow[];
  highlightField?: string | null;
}) {
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const doc = documents.find((d) => d.id === selectedId) ?? documents[0];
  const docFields = useMemo(() => fields.filter((f) => f.documentId === doc?.id), [fields, doc?.id]);
  const inv = detail.invoice;

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-line bg-white p-8 text-center text-xs text-ink-muted">
        No documents available for this invoice.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card">
      {/* Document pills removed (design review) — selection moved to the
          dropdown beside "+ Add document" on the page above the viewer. */}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line-soft px-2 py-1.5 text-xs">
        <span className="mr-auto flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{doc.fileName}</span>
          <span className="text-2xs text-ink-faint">v{doc.version} · {doc.sizeKb} KB</span>
          {/* UI/UX review: "mandatory / optional" is internal configuration and
              is not shown to the reader of a document. Only a document that is
              missing or superseded carries a badge. */}
          {doc.status !== 'AVAILABLE' && <StatusBadge value={doc.status} />}
        </span>
        {/* Related controls are grouped so each set wraps together as one unit
            (zoom −/%/+ · prev/page/next · open/download/replace) — fixes the
            "Page 1 of 5 + arrows split onto the next line" responsive bug. */}
        <span className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
          <button aria-label="Zoom out" className="rounded p-1 hover:bg-line-soft" onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))}><ZoomOut size={14} /></button>
          <span className="w-10 text-center text-2xs text-ink-muted">{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" className="rounded p-1 hover:bg-line-soft" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))}><ZoomIn size={14} /></button>
        </span>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
          <button aria-label="Previous page" className="rounded p-1 hover:bg-line-soft disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
          <span className="text-2xs text-ink-muted">Page {page}/{doc.pages}</span>
          <button aria-label="Next page" className="rounded p-1 hover:bg-line-soft disabled:opacity-40" disabled={page >= doc.pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
        </span>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
          <a href={doc.sharePointUrl} target="_blank" rel="noreferrer" title="Open in new tab" className="rounded p-1 text-ink-secondary hover:bg-line-soft"><ExternalLink size={14} /></a>
          <button title="Download PDF" className="rounded p-1 text-ink-secondary hover:bg-line-soft"><Download size={14} /></button>
          {onReplace && (
            <button title="Replace this document" onClick={() => onReplace(doc)} className="rounded p-1 text-ink-secondary hover:bg-line-soft">
              <RefreshCcw size={14} />
            </button>
          )}
        </span>
      </div>

      {/* synthetic page */}
      <div className="flex-1 overflow-auto bg-line-soft/60 p-4 scrollbar-thin">
        <div
          className="mx-auto flex min-h-[540px] w-[420px] origin-top flex-col gap-3 rounded-sm border border-line bg-white p-6 shadow-card"
          style={{ transform: `scale(${zoom})` }}
        >
          <div className="flex items-start justify-between border-b-2 border-essa-600 pb-3">
            <div>
              <p className="text-sm font-bold text-ink">{inv.vendorName}</p>
              <p className="text-2xs text-ink-muted">Tax No. {detail.vendor?.gstin} · {detail.vendor?.city}</p>
            </div>
            <p className="text-right text-2xs text-ink-muted">
              <span className="block text-xs font-bold uppercase text-essa-700">{doc.documentType?.name}</span>
              {doc.fileName}
            </p>
          </div>
          {page === 1 ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-2xs">
                {[
                  ['Invoice No.', inv.invoiceNumber],
                  ['Invoice Date', inv.invoiceDate],
                  ['PO Reference', inv.poNumber ?? '—'],
                  ['Currency', inv.currency],
                ].map(([l, v]) => (
                  <div key={l as string}>
                    <p className="font-semibold uppercase tracking-wide text-ink-faint">{l}</p>
                    <p className="text-xs text-ink">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded border border-line">
                <div className="grid grid-cols-12 gap-1 border-b border-line bg-canvas px-2 py-1 text-2xs font-semibold text-ink-secondary">
                  <span className="col-span-6">Description</span>
                  <span className="col-span-2 text-right">Qty</span>
                  <span className="col-span-2 text-right">Rate</span>
                  <span className="col-span-2 text-right">Amount</span>
                </div>
                {detail.lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-12 gap-1 px-2 py-1.5 text-2xs text-ink">
                    <span className="col-span-6">{l.description}</span>
                    <span className="col-span-2 text-right">{l.quantity} {l.uom}</span>
                    <span className="col-span-2 text-right">{l.unitPrice.toLocaleString('en-US')}</span>
                    <span className="col-span-2 text-right">{l.amount.toLocaleString('en-US')}</span>
                  </div>
                ))}
                <div className="space-y-0.5 border-t border-line px-2 py-1.5 text-right text-2xs">
                  <p>Subtotal: <span className="font-medium">{fmtMoney(inv.subtotal, inv.currency)}</span></p>
                  <p>GST (18%): <span className="font-medium">{fmtMoney(inv.taxAmount, inv.currency)}</span></p>
                  <p className="text-xs font-bold text-ink">Total: {fmtMoney(inv.amount, inv.currency)}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-2.5 rounded bg-line-soft" style={{ width: `${88 - (i * 17) % 40}%` }} />
              ))}
              <p className="mt-auto text-center text-2xs text-ink-faint">Supporting content · page {page} of {doc.pages}</p>
            </div>
          )}
          {/* extracted highlights */}
          {docFields.length > 0 && page === 1 && (
            <div className="mt-auto border-t border-dashed border-line pt-2">
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">AI-extracted regions</p>
              <div className="flex flex-wrap gap-1">
                {docFields.map((f) => (
                  <span
                    key={f.id}
                    className={clsx(
                      'rounded-sm border px-1 py-0.5 text-2xs',
                      highlightField === f.id && 'ring-2 ring-essa-500',
                      f.confidenceBand === 'HIGH' && 'border-essa-300 bg-essa-50 text-essa-800',
                      f.confidenceBand === 'MEDIUM' && 'border-amber-300 bg-semantic-warningBg text-semantic-warning',
                      f.confidenceBand === 'LOW' && 'border-red-300 bg-semantic-errorBg text-semantic-error'
                    )}
                    title={`${f.label}: ${f.value} (${Math.round(f.confidence * 100)}%)`}
                  >
                    {f.label}: {String(f.value).slice(0, 18)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer metadata strip removed (design review): uploader, check-mode
          badge and checksum added noise without user value — provenance lives
          in the Timeline tab. */}
    </div>
  );
}
