/**
 * SLA policies, business calendar and the exception-code catalogue.
 *
 * Source of truth:
 *  · ESSA_EAPA_SLA_Matrix.xlsx — "SLA Matrix" and "Workflow Timers" sheets,
 *    themselves drawn from BPD v0.1.4 page 13 and §11.3 / §11.4.
 *  · ESSA EAPA SLA Administration UI Specification (screens 1–13).
 *  · Exception codes follow the rule agreed in the 24 Aug review: ONE code per
 *    error type, identical for every invoice, category and vendor, so filtering
 *    by a code returns only that error.
 */
import type { BusinessCalendar, SlaChannel, SlaDurationUnit, SlaPolicy, SlaReminderRule, SlaStage, ExceptionCode } from '../../core/types';
import { DEFAULT_TIMEZONE, PAUSE_CONDITIONS } from '../../core/sla';
import { getDb } from '../../core/store';

const SEEDED_AT = '2026-08-01T01:00:00.000Z';
const SEEDED_BY = 'Surya Nugraha';

// ------------------------------------------------------------ calendars
/**
 * Business Calendar (spec Screen 7) — PROPOSED. Required only if ESSA confirms
 * that SLA targets are measured in working days / hours. Indonesian public
 * holidays for the remainder of 2026 are listed so the calendar is usable in
 * the demo; the list is maintained here, never in application logic.
 */
export const BUSINESS_CALENDARS: BusinessCalendar[] = [
  {
    id: 'cal-essa-wib', code: 'ESSA_WIB_STANDARD', name: 'ESSA Standard Calendar', timezone: DEFAULT_TIMEZONE,
    workingDays: [1, 2, 3, 4, 5], workStart: '08:00', workEnd: '17:00', status: 'ACTIVE', version: 1,
    effectiveFrom: '2026-08-01', changedBy: SEEDED_BY, changedAt: SEEDED_AT,
    exceptions: [
      { id: 'hol-1', date: '2026-08-17', name: 'Independence Day', type: 'PUBLIC_HOLIDAY', working: false },
      { id: 'hol-2', date: '2026-08-25', name: 'Maulid Nabi Muhammad', type: 'PUBLIC_HOLIDAY', working: false },
      { id: 'hol-3', date: '2026-12-24', name: 'Christmas Eve (joint leave)', type: 'PUBLIC_HOLIDAY', working: false },
      { id: 'hol-4', date: '2026-12-25', name: 'Christmas Day', type: 'PUBLIC_HOLIDAY', working: false },
      { id: 'hol-5', date: '2026-12-31', name: 'ESSA Company Holiday', type: 'COMPANY_HOLIDAY', working: false },
    ],
  },
];

// -------------------------------------------------------------- policies
/**
 * SLA policies, one per invoice/activity type and stage of the ESSA EAPA SLA
 * Matrix (BPD v0.1.4 page 13), plus the approval-response and missing-document
 * policies of BPD §11.4. Every BPD-derived value is seeded as a published
 * (ACTIVE) v1; anything the BPD leaves open (Tax Team SLA) stays a DRAFT.
 *
 * The BPD does not state whether the numeric values are calendar or business
 * days. They are seeded as BUSINESS DAYS on the ESSA Standard Calendar with
 * `unitConfirmed: false`, so every screen shows the unit as still to be
 * confirmed — the policy does not silently assume a unit (spec §4).
 */
const EMAIL: SlaChannel[] = ['EMAIL'];
const TEAMS_EMAIL: SlaChannel[] = ['TEAMS', 'EMAIL'];

const baseTimer = (duration: number | null, unit: SlaDurationUnit = 'BUSINESS_DAYS') => ({
  duration, unit, unitConfirmed: false,
  calendarId: unit === 'BUSINESS_DAYS' || unit === 'BUSINESS_HOURS' ? 'cal-essa-wib' : undefined,
  timezone: DEFAULT_TIMEZONE,
  warningBefore: duration == null ? null : { value: 8, unit: 'HOURS' as const },
  countdownOnWorkbench: true,
  dashboardIndicator: true,
});

const noEscalation = () => ({
  enabled: false, breachCondition: 'ON_DUE_TIME' as const, primaryTarget: 'AP_MANAGER', fallbackTarget: 'NONE', channels: EMAIL, createAuditEvent: true, createBreachFlag: true,
});

/** Proposed stop-clock rows, all OFF — the BPD does not define pause behaviour. */
const pauseRules = () => PAUSE_CONDITIONS.map((c) => ({ code: c.code, label: c.label, pause: false, resumeEvent: c.resumeEvent, reasonRequired: false }));

const STAGE_TRIGGER: Record<SlaStage, SlaPolicy['triggerEvent']> = {
  INVOICE_CREATION: 'INVOICE_CREATED', TAX_REVIEW: 'TAX_REVIEW_ASSIGNED', AP_APPROVAL: 'WORKFLOW_STEP_ASSIGNED', PAYMENT: 'INVOICE_APPROVED', DOCUMENT_REQUEST: 'DOCUMENT_REQUEST_SENT',
};
const STAGE_OWNER: Record<SlaStage, string> = {
  INVOICE_CREATION: 'AP_TEAM', TAX_REVIEW: 'TAX_TEAM', AP_APPROVAL: 'CURRENT_APPROVER', PAYMENT: 'AP_TEAM', DOCUMENT_REQUEST: 'VENDOR',
};
const STAGE_WORD: Record<SlaStage, string> = {
  INVOICE_CREATION: 'AP Verification', TAX_REVIEW: 'Tax Review', AP_APPROVAL: 'Approval', PAYMENT: 'Payment', DOCUMENT_REQUEST: 'Document Request',
};
const STAGE_DESC: Record<SlaStage, string> = {
  INVOICE_CREATION: 'Time allowed for the AP team to create and verify the invoice.',
  TAX_REVIEW: 'Time allowed for the Tax Team to review the invoice.',
  AP_APPROVAL: 'Time allowed for the approval hierarchy to complete.',
  PAYMENT: 'Time allowed from parking in SAP until payment is cleared.',
  DOCUMENT_REQUEST: 'Time allowed for the vendor to respond to a missing-document request.',
};

function policy(
  code: string, name: string, p: Partial<SlaPolicy> & { stage: SlaStage; scopeType: SlaPolicy['scopeType'] }, duration: number | null,
  opts: { provisional?: boolean; provisionalNote?: string; status?: SlaPolicy['status']; reminders?: SlaReminderRule[]; escalation?: SlaPolicy['escalation']; unit?: SlaDurationUnit; description?: string } = {}
): SlaPolicy {
  const provisional = Boolean(opts.provisional);
  return {
    id: `slap-${code.toLowerCase().replace(/_/g, '-')}-v1`, code, name,
    description: opts.description ?? STAGE_DESC[p.stage],
    scopeType: p.scopeType, activity: p.activity, stage: p.stage,
    triggerEvent: p.triggerEvent ?? STAGE_TRIGGER[p.stage], owner: p.owner ?? STAGE_OWNER[p.stage],
    provisional, provisionalNote: opts.provisionalNote,
    version: 1,
    // Anything the BPD leaves open stays a Draft until ESSA confirms it.
    status: opts.status ?? (provisional ? 'DRAFT' : 'ACTIVE'),
    effectiveFrom: '2026-08-01', changedBy: SEEDED_BY, changedAt: SEEDED_AT, changeSummary: 'Initial policy from BPD v0.1.4 SLA matrix',
    publishedBy: provisional ? undefined : SEEDED_BY, publishedAt: provisional ? undefined : SEEDED_AT,
    timer: baseTimer(duration, opts.unit),
    reminders: opts.reminders ?? [],
    escalation: opts.escalation ?? noEscalation(),
    pauseRules: pauseRules(),
    manualPauseAllowed: false,
    maxPause: null,
  };
}

/** The four matrix stages for one activity type, in lifecycle order. */
function matrixRow(prefix: string, label: string, activity: string, targets: { verification: number | null; taxReview: number | null; approval: number | null; payment: number | null }, taxProvisional?: string): SlaPolicy[] {
  const scope = { scopeType: 'INVOICE_CATEGORY' as const, activity };
  return [
    policy(`${prefix}_AP_VERIFICATION`, `${label} ${STAGE_WORD.INVOICE_CREATION}`, { ...scope, stage: 'INVOICE_CREATION' }, targets.verification),
    policy(`${prefix}_TAX_REVIEW`, `${label} ${STAGE_WORD.TAX_REVIEW}`, { ...scope, stage: 'TAX_REVIEW' }, targets.taxReview,
      taxProvisional ? { provisional: true, provisionalNote: taxProvisional } : {}),
    policy(`${prefix}_APPROVAL`, `${label} ${STAGE_WORD.AP_APPROVAL}`, { ...scope, stage: 'AP_APPROVAL' }, targets.approval),
    policy(`${prefix}_PAYMENT`, `${label} ${STAGE_WORD.PAYMENT}`, { ...scope, stage: 'PAYMENT' }, targets.payment),
  ];
}

const reminder = (seq: number, value: number, unit: 'HOURS' | 'CALENDAR_DAYS', recipient: string, template: string, extra: Partial<SlaReminderRule> = {}): SlaReminderRule => ({
  id: `rem-${seq}`, seq, after: { value, unit }, repeat: false, recipient, channels: EMAIL, template, enabled: true, ...extra,
});

const TAX_TBC = 'BPD §11.3: the final Tax Team SLA is still to be confirmed by ESSA. Keep this policy in Draft until confirmed.';

export const SLA_POLICIES: SlaPolicy[] = [
  // Generic fallback — "Create Draft Invoice" row of the SLA matrix.
  policy('DRAFT_INVOICE_CREATION', 'Draft Invoice Creation (all types)', { scopeType: 'GLOBAL', stage: 'INVOICE_CREATION' }, 1,
    { description: 'Default time allowed to create the draft invoice when no activity-specific verification policy applies.' }),

  ...matrixRow('MATERIAL', 'Material Invoice', 'MATERIAL', { verification: 3, taxReview: null, approval: 1, payment: 3 }),
  ...matrixRow('SERVICE', 'Service Invoice', 'SERVICE', { verification: 3, taxReview: 1, approval: 2, payment: 3 }, TAX_TBC),
  ...matrixRow('NONPO', 'Non-PO Invoice', 'NON_PO', { verification: 2, taxReview: 1, approval: 1, payment: 3 }, 'Tax Team SLA to be confirmed consistently with BPD §11.3.'),
  ...matrixRow('PIB', 'PIB Payment', 'PIB_PAYMENT', { verification: 1, taxReview: 1, approval: 1, payment: 1 }),
  ...matrixRow('MONTHLY_TAX', 'Monthly Tax Payment', 'MONTHLY_TAX_PAYMENT', { verification: 1, taxReview: 1, approval: 1, payment: 1 }),
  ...matrixRow('REIMBURSEMENT', 'Employee Reimbursement', 'EMPLOYEE_REIMBURSEMENT', { verification: 2, taxReview: null, approval: 1, payment: 3 }),

  // BPD §11.4 — approval reminders and escalation, one clock per assigned approval step.
  policy('NONPO_APPROVAL_RESPONSE', 'Non-PO Approval Response', { scopeType: 'WORKFLOW', activity: 'NON_PO', stage: 'AP_APPROVAL', owner: 'CURRENT_APPROVER' }, 5, {
    unit: 'CALENDAR_DAYS',
    description: 'Reminder and escalation rules attached to each active approval step of a Non-PO invoice (BPD §11.4).',
    reminders: [
      reminder(1, 24, 'HOURS', 'CURRENT_APPROVER', 'Approval Reminder 1'),
      reminder(2, 48, 'HOURS', 'CURRENT_APPROVER', 'Approval Reminder 2'),
      reminder(3, 3, 'CALENDAR_DAYS', 'APPROVER_AND_AP_MANAGER', 'Approval Reminder 3'),
      reminder(4, 5, 'CALENDAR_DAYS', 'APPROVER_AND_AP_MANAGER', 'Final Approval Reminder'),
    ],
    escalation: { enabled: true, breachCondition: 'AFTER_FINAL_REMINDER', primaryTarget: 'NEXT_DOA_LEVEL', fallbackTarget: 'AP_MANAGER', channels: TEAMS_EMAIL, createAuditEvent: true, createBreachFlag: true },
  }),
  policy('PO_APPROVAL_RESPONSE', 'PO Invoice Approval Response', { scopeType: 'WORKFLOW', stage: 'AP_APPROVAL', owner: 'CURRENT_APPROVER' }, 5, {
    unit: 'CALENDAR_DAYS',
    description: 'Reminder and escalation rules for AP review / finance exception approval steps of PO-based invoices, using the same BPD §11.4 schedule.',
    reminders: [
      reminder(1, 24, 'HOURS', 'CURRENT_APPROVER', 'Approval Reminder 1'),
      reminder(2, 48, 'HOURS', 'CURRENT_APPROVER', 'Approval Reminder 2'),
      reminder(3, 3, 'CALENDAR_DAYS', 'APPROVER_AND_AP_MANAGER', 'Approval Reminder 3'),
      reminder(4, 5, 'CALENDAR_DAYS', 'APPROVER_AND_AP_MANAGER', 'Final Approval Reminder'),
    ],
    escalation: { enabled: true, breachCondition: 'AFTER_FINAL_REMINDER', primaryTarget: 'NEXT_DOA_LEVEL', fallbackTarget: 'AP_MANAGER', channels: TEAMS_EMAIL, createAuditEvent: true, createBreachFlag: true },
  }),

  // BPD §11.4 — missing-document vendor chase (document-request lifecycle).
  policy('MISSING_DOCUMENT_RESPONSE', 'Missing Document Vendor Response', { scopeType: 'DOCUMENT_REQUEST', stage: 'DOCUMENT_REQUEST', owner: 'VENDOR' }, 7, {
    unit: 'CALENDAR_DAYS',
    description: 'Vendor chase for a mandatory document that is missing: the initial email is drafted by the system and reviewed/sent by AP, a reminder follows every 7 days, and the Head of Function is escalated to after the first unanswered reminder.',
    reminders: [
      reminder(1, 0, 'HOURS', 'VENDOR', 'Missing Document Request (drafted by system, AP reviews and sends)'),
      reminder(2, 7, 'CALENDAR_DAYS', 'VENDOR', 'Missing Document Reminder', { repeat: true }),
    ],
    escalation: { enabled: true, breachCondition: 'AFTER_FIRST_UNANSWERED_REMINDER', primaryTarget: 'HOF', fallbackTarget: 'AP_MANAGER', channels: EMAIL, createAuditEvent: true, createBreachFlag: true },
  }),
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
 * Administration → SLA Management → Exception Codes takes effect straight away.
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
