/**
 * SLA targets, reminder timers and the exception-code catalogue.
 *
 * Source of truth:
 *  · ESSA_EAPA_SLA_Matrix.xlsx — "SLA Matrix" and "Workflow Timers" sheets,
 *    themselves drawn from BPD v0.1.4 page 13 and §11.3 / §11.4.
 *  · Exception codes follow the rule agreed in the 24 Aug review: ONE code per
 *    error type, identical for every invoice, category and vendor, so filtering
 *    by a code returns only that error.
 */
import type { ExceptionCode, ReminderRule, SlaRule } from '../../core/types';
import { getDb } from '../../core/store';

const sla = (
  id: string,
  activityType: string,
  stage: SlaRule['stage'],
  days: number | null,
  confidence: SlaRule['confidence'],
  categoryId?: string,
  note?: string
): SlaRule => ({ id, activityType, categoryId, stage, days, confidence, note, active: true });

export const SLA_RULES: SlaRule[] = [
  sla('sla-draft', 'Create Draft Invoice', 'INVOICE_CREATION', 1, 'DEFINED'),

  sla('sla-mat-create', 'Material', 'INVOICE_CREATION', 3, 'DEFINED', 'cat-material'),
  sla('sla-mat-tax', 'Material', 'TAX_REVIEW', null, 'NOT_APPLICABLE', 'cat-material', 'Tax review does not apply to material invoices.'),
  sla('sla-mat-appr', 'Material', 'AP_APPROVAL', 1, 'DEFINED', 'cat-material'),
  sla('sla-mat-pay', 'Material', 'PAYMENT', 3, 'DEFINED', 'cat-material'),

  sla('sla-srv-create', 'Services', 'INVOICE_CREATION', 3, 'DEFINED', 'cat-service'),
  sla('sla-srv-tax', 'Services', 'TAX_REVIEW', 1, 'PROVISIONAL', 'cat-service', 'BPD §11.3: the final Tax Team SLA is still to be confirmed by ESSA.'),
  sla('sla-srv-appr', 'Services', 'AP_APPROVAL', 2, 'DEFINED', 'cat-service'),
  sla('sla-srv-pay', 'Services', 'PAYMENT', 3, 'DEFINED', 'cat-service'),

  sla('sla-mnp-create', 'Services', 'INVOICE_CREATION', 3, 'DEFINED', 'cat-manpower'),
  sla('sla-mnp-tax', 'Services', 'TAX_REVIEW', 1, 'PROVISIONAL', 'cat-manpower'),
  sla('sla-mnp-appr', 'Services', 'AP_APPROVAL', 2, 'DEFINED', 'cat-manpower'),
  sla('sla-mnp-pay', 'Services', 'PAYMENT', 3, 'DEFINED', 'cat-manpower'),

  sla('sla-cat-create', 'Services', 'INVOICE_CREATION', 3, 'DEFINED', 'cat-catering'),
  sla('sla-cat-tax', 'Services', 'TAX_REVIEW', 1, 'PROVISIONAL', 'cat-catering'),
  sla('sla-cat-appr', 'Services', 'AP_APPROVAL', 2, 'DEFINED', 'cat-catering'),
  sla('sla-cat-pay', 'Services', 'PAYMENT', 3, 'DEFINED', 'cat-catering'),

  sla('sla-npo-create', 'Non-PO', 'INVOICE_CREATION', 2, 'DEFINED', 'cat-nonpo'),
  sla('sla-npo-tax', 'Non-PO', 'TAX_REVIEW', 1, 'PROVISIONAL', 'cat-nonpo', 'Tax Team SLA to be confirmed consistently with §11.3.'),
  sla('sla-npo-appr', 'Non-PO', 'AP_APPROVAL', 1, 'DEFINED', 'cat-nonpo'),
  sla('sla-npo-pay', 'Non-PO', 'PAYMENT', 3, 'DEFINED', 'cat-nonpo'),

  sla('sla-pib-create', 'PIB Payments', 'INVOICE_CREATION', 1, 'DEFINED'),
  sla('sla-pib-tax', 'PIB Payments', 'TAX_REVIEW', 1, 'DEFINED'),
  sla('sla-pib-appr', 'PIB Payments', 'AP_APPROVAL', 1, 'DEFINED'),
  sla('sla-pib-pay', 'PIB Payments', 'PAYMENT', 1, 'DEFINED'),

  sla('sla-tax-create', 'Monthly Tax Payment', 'INVOICE_CREATION', 1, 'DEFINED'),
  sla('sla-tax-tax', 'Monthly Tax Payment', 'TAX_REVIEW', 1, 'DEFINED'),
  sla('sla-tax-appr', 'Monthly Tax Payment', 'AP_APPROVAL', 1, 'DEFINED'),
  sla('sla-tax-pay', 'Monthly Tax Payment', 'PAYMENT', 1, 'DEFINED'),

  sla('sla-rmb-create', 'Employee Reimbursements', 'INVOICE_CREATION', 2, 'DEFINED'),
  sla('sla-rmb-tax', 'Employee Reimbursements', 'TAX_REVIEW', null, 'NOT_APPLICABLE'),
  sla('sla-rmb-appr', 'Employee Reimbursements', 'AP_APPROVAL', 1, 'DEFINED'),
  sla('sla-rmb-pay', 'Employee Reimbursements', 'PAYMENT', 3, 'DEFINED'),
];

/** Reminder + escalation timers (SLA Matrix "Workflow Timers", BPD §11.4). */
export const REMINDER_RULES: ReminderRule[] = [
  { id: 'rem-1', name: 'Approval — 1st reminder', trigger: 'No approver action after the initial notification', afterHours: 24, recipient: 'Approver', action: 'Email reminder', active: true },
  { id: 'rem-2', name: 'Approval — 2nd reminder', trigger: 'No approver action', afterHours: 48, recipient: 'Approver', action: 'Email reminder', active: true },
  { id: 'rem-3', name: 'Approval — 3rd reminder', trigger: 'No approver action', afterHours: 72, recipient: 'Approver + AP Supervisor', action: 'Email reminder', active: true },
  { id: 'rem-4', name: 'Approval — final reminder', trigger: 'No approver action', afterHours: 120, recipient: 'Approver + AP Supervisor', action: 'Final email reminder', active: true },
  { id: 'rem-5', name: 'Approval — SLA breach escalation', trigger: 'No action after the final reminder', afterHours: 120, recipient: 'Next approval level', action: 'Auto-escalate via Teams and email', active: true },
  { id: 'rem-6', name: 'Approval — no further level', trigger: 'No higher approval level exists', afterHours: 120, recipient: 'AP Supervisor', action: 'Escalate via Teams and email', active: true },
  { id: 'rem-7', name: 'Missing document — first notice', trigger: 'A mandatory document is missing', afterHours: 0, recipient: 'Vendor', action: 'System drafts the email, AP reviews and sends', active: true },
  { id: 'rem-8', name: 'Missing document — reminder', trigger: 'Document still missing', afterHours: 168, recipient: 'Vendor', action: 'Email reminder every 7 days', active: true },
  { id: 'rem-9', name: 'Missing document — escalation', trigger: 'No response after the first reminder', afterHours: 336, recipient: 'Head of Function', action: 'Email escalation', active: true },
];

const ec = (code: string, type: ExceptionCode['type'], label: string, description: string, documentTypeId?: string): ExceptionCode =>
  ({ id: code, code, type, documentTypeId, label, description, active: true });

/**
 * One code per error type. Missing-document errors carry a code per document
 * type, because "which document is missing" is the error, not a detail of it.
 */
export const EXCEPTION_CODES: ExceptionCode[] = [
  ec('E-1001', 'EXTRACTION_FAILURE', 'Extraction failed', 'The document could not be read well enough to extract its fields.'),
  ec('E-1002', 'LOW_CONFIDENCE', 'Low confidence extraction', 'One or more fields were read with low confidence and need a human check.'),
  ec('E-1003', 'VALIDATION_FAILURE', 'Validation check failed', 'A validation check between documents or against SAP did not pass.'),
  ec('E-1004', 'MISSING_SAP_REFERENCE', 'SAP reference not found', 'The purchase order, goods receipt or service entry sheet is not yet available in SAP.'),
  ec('E-1005', 'VENDOR_ISSUE', 'Vendor issue', 'The vendor is blocked, negative-listed or its master data does not match.'),
  ec('E-1006', 'TAX_ISSUE', 'Tax issue', 'The tax invoice or withholding tax treatment needs the Tax Team.'),
  ec('E-1007', 'APPROVAL_ISSUE', 'Approval issue', 'The invoice was rejected or sent back during approval.'),
  ec('E-1008', 'INTEGRATION_FAILURE', 'Integration failure', 'A connected system did not respond as expected.'),
  ec('E-1009', 'TECHNICAL_FAILURE', 'Technical failure', 'The platform hit a technical error and will retry.'),

  ec('E-1101', 'MISSING_DOCUMENT', 'Invoice missing', 'The vendor invoice is missing from the bundle.', 'dt-invoice'),
  ec('E-1102', 'MISSING_DOCUMENT', 'Purchase order copy missing', 'The purchase order copy is missing from the bundle.', 'dt-po'),
  ec('E-1103', 'MISSING_DOCUMENT', 'Goods receipt note missing', 'The goods receipt note is missing from the bundle.', 'dt-grn'),
  ec('E-1104', 'MISSING_DOCUMENT', 'Service entry sheet missing', 'The service entry sheet is missing from the bundle.', 'dt-ses'),
  ec('E-1105', 'MISSING_DOCUMENT', 'Timesheet missing', 'The timesheet is missing from the bundle.', 'dt-timesheet'),
  ec('E-1106', 'MISSING_DOCUMENT', 'Manhour summary missing', 'The manhour summary is missing from the bundle.', 'dt-manhour'),
  ec('E-1107', 'MISSING_DOCUMENT', 'Attendance sheet missing', 'The attendance sheet is missing from the bundle.', 'dt-attendance'),
  ec('E-1108', 'MISSING_DOCUMENT', 'Meal summary missing', 'The meal summary is missing from the bundle.', 'dt-meal'),
  ec('E-1109', 'MISSING_DOCUMENT', 'Tax invoice missing', 'The tax invoice (Faktur Pajak) is missing from the bundle.', 'dt-tax'),
  ec('E-1110', 'MISSING_DOCUMENT', 'Delivery note missing', 'The delivery note is missing from the bundle.', 'dt-challan'),
  ec('E-1111', 'MISSING_DOCUMENT', 'HCIS clearing journal missing', 'The HCIS clearing journal reference is missing from the bundle.', 'dt-dept'),
  ec('E-1112', 'MISSING_DOCUMENT', 'Supporting document missing', 'A required supporting document is missing from the bundle.', 'dt-support'),
];

/**
 * Resolve the catalogue code for an exception.
 *
 * The live catalogue is read from the database rather than the seed constant, so
 * a code an administrator adds, renames or disables in
 * Administration → SLA & Reminders takes effect straight away.
 */
export function exceptionCodeFor(type: string, documentTypeId?: string): ExceptionCode | undefined {
  const catalogue = (getDb().exceptionCodes?.length ? getDb().exceptionCodes : EXCEPTION_CODES).filter((c) => c.active);
  if (type === 'MISSING_DOCUMENT') {
    return (
      catalogue.find((c) => c.type === 'MISSING_DOCUMENT' && c.documentTypeId === documentTypeId) ??
      catalogue.find((c) => c.code === 'E-1112')
    );
  }
  return catalogue.find((c) => c.type === type && !c.documentTypeId);
}
