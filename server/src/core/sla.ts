/**
 * SLA resolution.
 *
 * An invoice only ever has ONE SLA running: the one for the stage it is
 * currently in (ESSA EAPA SLA Matrix). A terminal or vendor-blocked invoice has
 * no SLA at all — which is why a Rejected or Paid invoice can never show an SLA
 * breach, and an invoice sitting in validation is measured against the
 * Invoice Creation / Verification target rather than the approval target.
 */
import type { Database } from './store';
import type { Invoice, SlaStage } from './types';
import { currentStatus } from './status';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SLA_STAGE_LABEL: Record<SlaStage, string> = {
  INVOICE_CREATION: 'Invoice creation / verification',
  TAX_REVIEW: 'Tax review',
  AP_APPROVAL: 'Approval',
  PAYMENT: 'Payment',
};

/** Which SLA clock is running for this invoice right now. */
export function slaStageFor(inv: Pick<Invoice, 'lifecycle' | 'stage' | 'processingFlag'>, openExceptions = 0): SlaStage | null {
  switch (currentStatus(inv, openExceptions)) {
    case 'Draft':
    case 'Validation':
      return 'INVOICE_CREATION';
    case 'Approval Pending':
      return inv.stage === 'TAX_REVIEW' ? 'TAX_REVIEW' : 'AP_APPROVAL';
    case 'Approved':
    case 'Parked':
    case 'Posted':
      return 'PAYMENT';
    // Paid, Rejected, Cancelled and Failed are not on an SLA clock: the
    // invoice is either finished or waiting on someone outside the platform.
    default:
      return null;
  }
}

export function slaTargetDays(db: Database, categoryId: string, stage: SlaStage): number | null {
  const exact = db.slaRules.find((r) => r.active && r.categoryId === categoryId && r.stage === stage);
  if (exact) return exact.days;
  const generic = db.slaRules.find((r) => r.active && !r.categoryId && r.stage === stage);
  return generic ? generic.days : null;
}

export interface SlaState {
  stage: SlaStage | null;
  stageLabel: string | null;
  targetDays: number | null;
  dueAt: string | null;
  breached: boolean;
}

/**
 * Recompute the SLA for one invoice from the state it is actually in.
 * `since` is when the invoice entered its current state.
 */
export function computeSla(db: Database, inv: Invoice, openExceptions = 0, since?: string): SlaState {
  const stage = slaStageFor(inv, openExceptions);
  if (!stage) return { stage: null, stageLabel: null, targetDays: null, dueAt: null, breached: false };
  const targetDays = slaTargetDays(db, inv.categoryId, stage);
  if (targetDays == null) return { stage, stageLabel: SLA_STAGE_LABEL[stage], targetDays: null, dueAt: null, breached: false };
  // The clock starts when the invoice entered its current state; when that
  // moment is not known we fall back to when the invoice was received, never to
  // the record's last-touched timestamp (which would reset every clock).
  const base = new Date(since ?? inv.receivedAt).getTime();
  const dueAt = new Date(base + targetDays * DAY_MS).toISOString();
  return {
    stage,
    stageLabel: SLA_STAGE_LABEL[stage],
    targetDays,
    dueAt,
    breached: Date.now() > new Date(dueAt).getTime(),
  };
}

/** Apply the computed SLA back onto the invoice record. */
export function applySla(db: Database, inv: Invoice, openExceptions = 0, since?: string): SlaState {
  const s = computeSla(db, inv, openExceptions, since);
  inv.slaDueAt = s.dueAt ?? '';
  inv.slaBreached = s.breached;
  return s;
}

/**
 * Recompute every invoice — used after seeding, and after an SLA target is
 * changed in Administration, so the data stays coherent.
 */
export function recomputeAllSla(db: Database): void {
  const openByInvoice = new Map<string, number>();
  db.exceptions
    .filter((e) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status))
    .forEach((e) => openByInvoice.set(e.invoiceId, (openByInvoice.get(e.invoiceId) ?? 0) + 1));

  // When an invoice is waiting on approval or payment, its clock started when
  // it entered that state — the most recent thing that happened to it — not
  // when the invoice first arrived.
  const lastActionAt = new Map<string, string>();
  const note = (invoiceId: string, at?: string) => {
    if (!at) return;
    const prev = lastActionAt.get(invoiceId);
    if (!prev || at > prev) lastActionAt.set(invoiceId, at);
  };
  for (const step of db.workflowSteps) note(step.invoiceId, step.actedAt);
  for (const ev of db.timelineEvents) note(ev.invoiceId, ev.at);

  for (const inv of db.invoices) {
    const open = openByInvoice.get(inv.id) ?? 0;
    const stage = slaStageFor(inv, open);
    const since = stage === 'INVOICE_CREATION' ? inv.receivedAt : lastActionAt.get(inv.id) ?? inv.receivedAt;
    applySla(db, inv, open, since);
  }
}
