/**
 * Invoice lifecycle states — BPD v0.1.4 §11.7 (server side).
 *
 * IMPORTANT: this MUST stay in sync with `web/src/lib/format.ts`. The UI renders
 * the status from that file and filters through this one, so the two have to
 * agree on the wording.
 */
import type { Invoice } from './types';

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

export type InvoiceStatusLabel = (typeof INVOICE_STATUSES)[number];

export function currentStatus(
  inv: Pick<Invoice, 'lifecycle' | 'stage' | 'processingFlag'>,
  openExceptions = 0
): InvoiceStatusLabel {
  const stage = String(inv.stage ?? '');
  const flag = String(inv.processingFlag ?? '');
  if (inv.lifecycle === 'PAID') return 'Paid';
  if (inv.lifecycle === 'POSTED') return 'Posted';
  if (inv.lifecycle === 'PARKED') return 'Parked';
  if (flag === 'CANCELLED' || stage === 'CANCELLED') return 'Cancelled';
  if (flag === 'REJECTED' || stage === 'REJECTED') return 'Rejected';
  if (flag === 'SAP_ERROR' || flag === 'TECHNICAL_RETRY') return 'Failed';
  if (inv.lifecycle === 'VALIDATED' || inv.lifecycle === 'IN_PROGRESS' || stage === 'SAP_HANDOFF' || stage === 'SAP_PROCESSING') return 'Approved';
  if (flag === 'APPROVAL_PENDING' || stage === 'APPROVAL' || stage === 'TAX_REVIEW') return 'Approval Pending';
  if (stage === 'VALIDATION' || stage === 'EXCEPTION' || flag === 'VALIDATION_FAILED' || openExceptions > 0) return 'Validation';
  return 'Draft';
}
