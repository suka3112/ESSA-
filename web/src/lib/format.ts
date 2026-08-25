/**
 * Shared formatting + the single invoice status vocabulary.
 *
 * UI/UX review (Aug 2026) — everything user-facing that describes "where an
 * invoice is" comes from here, so Dashboard, Invoice Workbench, Invoice Detail,
 * Approvals, Exception Workbench and Audit Log always use the same words,
 * the same badge tone and the same date/time format.
 */

/** Presentation currency for the platform (review: replace the ₹ symbol with IDR). */
export const CURRENCY = 'IDR';

export function fmtMoney(amount: number | undefined | null, currency: string = CURRENCY): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || CURRENCY,
    currencyDisplay: 'code',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function fmtNumber(n: number | undefined | null, digits = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** One date format across the application: 21 Aug 2026. */
export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One date/time format across the application: 21 Aug 2026, 14:35.
 * Review decision: never show relative timestamps ("7 minutes ago") — every
 * timestamp in a table, drawer or history row is an actual date and time.
 */
export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  if (v == null) return '—';
  return `${v.toFixed(digits)}%`;
}

// Display-label overrides for internal enum codes (code values stay unchanged).
const LABEL_OVERRIDES: Record<string, string> = {
  MISSING_DOCUMENTS: 'Missing Supporting Documents',
  MISSING_DOCUMENT: 'Missing Supporting Document',
  MISSING_SAP_REFERENCE: 'Missing SAP Reference',
  SAP_ERROR: 'SAP Error',
  SAP_HANDOFF: 'SAP Handoff',
  SAP_PROCESSING: 'SAP Processing',
};

export function titleCase(s: string | undefined | null): string {
  if (!s) return '—';
  if (LABEL_OVERRIDES[s]) return LABEL_OVERRIDES[s];
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // Acronyms are not words — keep them upper case wherever they appear.
    .replace(/\b(Sap|Po|Grn|Ses|Ap|Sla|Doa|Pib|Hcis|Id)\b/g, (w) => w.toUpperCase());
}

/**
 * Approved persona model (design review, Aug 2026): AP Processor, Tax Reviewer,
 * AP Supervisor and Administrator. The Reviewer / Approver / Manager personas
 * are presented as the single "AP Supervisor". Backend role codes are unchanged.
 */
const ROLE_DISPLAY: Record<string, string> = {
  'AP Reviewer': 'AP Supervisor',
  'AP Manager': 'AP Supervisor',
  AP_REVIEWER: 'AP Supervisor',
  AP_MANAGER: 'AP Supervisor',
  'AP Approver': 'AP Supervisor',
  AP_APPROVER: 'AP Supervisor',
  'DoA Approver': 'AP Supervisor',
  // Tax Reviewer is a persona in its own right (review: Anas — it must be shown).
  TAX_REVIEWER: 'Tax Reviewer',
  AP_PROCESSOR: 'AP Processor',
  ADMINISTRATOR: 'Administrator',
  // Approval-hierarchy levels, BPD v0.1.4 §11.2 legend.
  HOS: 'Head of Section',
  HOD: 'Head of Department',
  HOF: 'Head of Function',
  OSH_STH: 'Operations & Site Head',
  GFD: 'Group Functional Director',
};

export function displayRole(name: string | undefined | null): string {
  if (!name) return '—';
  return ROLE_DISPLAY[name] ?? name;
}

/** Maps a list of role names to the approved personas, de-duplicated. */
export function displayRoles(names: string[] | undefined | null): string[] {
  if (!names?.length) return [];
  return [...new Set(names.map((n) => displayRole(n)))];
}

// ---------------------------------------------------------------------------
// Invoice lifecycle status vocabulary
// ---------------------------------------------------------------------------

export type StatusTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'pending' | 'draft';

/**
 * The invoice lifecycle states, taken verbatim from BPD v0.1.4 §11.7.
 * These ten values are the ONLY statuses the product may show for an invoice.
 */
export const INVOICE_STATUSES = [
  'Draft',
  'Validation',
  'Approval Pending',
  'Approved',
  'Parked',
  'Posted',
  'Paid',
  'Rejected',
  'Failed',
  'Cancelled',
] as const;

export type InvoiceStatusLabel = (typeof INVOICE_STATUSES)[number] | 'No further action';

export interface InvoiceState {
  lifecycle: string;
  stage?: string | null;
  processingFlag?: string | null;
  openExceptions?: number;
  poNumber?: string | null;
  /** Null until extraction has produced values for this invoice. */
  extractionConfidence?: number | null;
}

const STATUS_TONE: Record<InvoiceStatusLabel, StatusTone> = {
  Draft: 'draft',
  Validation: 'pending',
  'Approval Pending': 'warning',
  Approved: 'success',
  Parked: 'info',
  Posted: 'success',
  Paid: 'success',
  Rejected: 'error',
  Failed: 'error',
  Cancelled: 'neutral',
  'No further action': 'neutral',
};

/** Plain-language explanation shown in the status tooltip (BPD §11.7 wording). */
export const STATUS_TIP: Record<InvoiceStatusLabel, string> = {
  Draft: 'Received and created in the system, waiting on the AP team — missing documents, low-confidence extraction, or a pre-check that did not pass.',
  Validation: 'Cross-document and SAP validation checks are running. Any failure is raised as an exception for the AP team to resolve or override.',
  'Approval Pending': 'Waiting for approval — the approval hierarchy for Non-PO invoices, or finance exception approval for PO-based invoices.',
  Approved: 'All required approval levels are complete. The invoice is cleared for parking in SAP.',
  Parked: 'Parked in SAP (MIRO for PO invoices, FB60 for Non-PO).',
  Posted: 'Posted to the SAP general ledger. The payment due date is calculated from here.',
  Paid: 'Payment cleared in SAP. This is the end of the invoice lifecycle.',
  Rejected: 'Rejected by an approver or the AP team. It stays in the system until corrected documents are resubmitted, or it is cancelled.',
  Failed: 'Parking or posting in SAP failed because of a technical error. The AP team is notified so it can be retried.',
  Cancelled: 'Closed without payment. Nothing further happens to this invoice.',
  'No further action': 'This invoice has reached the end of its lifecycle.',
};

export function statusTone(label: InvoiceStatusLabel): StatusTone {
  return STATUS_TONE[label] ?? 'neutral';
}

/**
 * True while the invoice record exists but OCR/extraction has not produced the
 * header data yet — invoice number, vendor and category stay blank instead of
 * showing placeholder values.
 */
export function isPreExtraction(inv: InvoiceState): boolean {
  const stage = inv.stage ?? '';
  return inv.extractionConfidence == null && ['RECEIVED', 'CLASSIFICATION', 'COMPLETENESS', 'EXTRACTION'].includes(stage);
}

/** Where the invoice is now — always one of the ten BPD lifecycle states. */
export function currentStatus(inv: InvoiceState): InvoiceStatusLabel {
  const stage = inv.stage ?? '';
  const flag = inv.processingFlag ?? '';
  if (inv.lifecycle === 'PAID') return 'Paid';
  if (inv.lifecycle === 'POSTED') return 'Posted';
  if (inv.lifecycle === 'PARKED') return 'Parked';
  if (flag === 'CANCELLED' || stage === 'CANCELLED') return 'Cancelled';
  if (flag === 'REJECTED' || stage === 'REJECTED') return 'Rejected';
  if (flag === 'SAP_ERROR' || flag === 'TECHNICAL_RETRY') return 'Failed';
  if (inv.lifecycle === 'VALIDATED' || inv.lifecycle === 'IN_PROGRESS' || stage === 'SAP_HANDOFF' || stage === 'SAP_PROCESSING') return 'Approved';
  if (flag === 'APPROVAL_PENDING' || stage === 'APPROVAL' || stage === 'TAX_REVIEW') return 'Approval Pending';
  if (stage === 'VALIDATION' || stage === 'EXCEPTION' || flag === 'VALIDATION_FAILED' || (inv.openExceptions ?? 0) > 0) return 'Validation';
  // BPD §11.7: Draft covers everything still pending AP team action before
  // validation — ingestion, missing documents and low-confidence extraction.
  return 'Draft';
}

/**
 * A short, plain-language note about what is actually happening inside the
 * current state. It never replaces the status — it explains it, so "Draft"
 * on a freshly uploaded invoice reads as "Extraction in progress".
 */
export function statusDetail(inv: InvoiceState): string | null {
  const stage = inv.stage ?? '';
  const flag = inv.processingFlag ?? '';
  const status = currentStatus(inv);
  if (status === 'Draft') {
    if (flag === 'MISSING_DOCUMENTS') return 'Waiting for documents';
    if (stage === 'EXTRACTION_REVIEW' || flag === 'EXTRACTION_REVIEW') return 'Extraction needs review';
    if (isPreExtraction(inv)) return 'Extraction in progress';
    return 'Waiting for the AP team';
  }
  if (status === 'Validation') {
    return (inv.openExceptions ?? 0) > 0 ? 'Exceptions to resolve' : 'Checks running';
  }
  if (status === 'Approval Pending') return stage === 'TAX_REVIEW' ? 'With the Tax Team' : 'With the approver';
  if (status === 'Approved') return inv.lifecycle === 'IN_PROGRESS' ? 'Sent to SAP for parking' : 'Ready for SAP parking';
  if (status === 'Failed') return 'Retry required';
  if (status === 'Rejected') return 'Waiting for corrected documents';
  return null;
}

/**
 * The next lifecycle state, following the "Next Possible State(s)" column of
 * BPD §11.7. PO-based invoices go straight to SAP parking once validation
 * passes (BPD §11.1); Non-PO invoices go through the approval hierarchy.
 */
export function nextStatus(inv: InvoiceState): InvoiceStatusLabel {
  const poBased = Boolean(inv.poNumber);
  switch (currentStatus(inv)) {
    case 'Draft':
      return 'Validation';
    case 'Validation':
      return poBased ? 'Parked' : 'Approval Pending';
    case 'Approval Pending':
      return 'Approved';
    case 'Approved':
      return 'Parked';
    case 'Parked':
      return 'Posted';
    case 'Posted':
      return 'Paid';
    case 'Rejected':
      return 'Draft';
    case 'Failed':
      return 'Parked';
    case 'Paid':
    case 'Cancelled':
    default:
      return 'No further action';
  }
}
