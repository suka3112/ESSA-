/**
 * ESSA AP Automation - Domain types (mirrors PostgreSQL schema in db/schema.sql)
 */

// ---------- Identity & Access ----------
export type PermissionCode =
  | 'DASHBOARD_VIEW'
  | 'INVOICE_VIEW'
  | 'INVOICE_EDIT'
  | 'INVOICE_UPLOAD'
  | 'INVOICE_REVALIDATE'
  | 'FIELD_CORRECT'
  | 'VALIDATION_OVERRIDE'
  | 'EXCEPTION_VIEW'
  | 'EXCEPTION_MANAGE'
  | 'APPROVAL_VIEW'
  | 'APPROVAL_ACT'
  | 'TAX_REVIEW'
  | 'VENDOR_VIEW'
  | 'VENDOR_CONTROL'
  | 'SAP_VIEW'
  | 'SAP_RETRY'
  | 'BIOMETRIC_VIEW'
  | 'CONFIG_VIEW'
  | 'CONFIG_EDIT'
  | 'CONFIG_PUBLISH'
  | 'USER_ADMIN'
  | 'AUDIT_VIEW'
  | 'TECH_LOG_VIEW'
  | 'REPORT_VIEW'
  | 'NOTIFICATION_VIEW';

export interface Permission {
  code: PermissionCode;
  description: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[];
  system: boolean;
}

export interface AppUser {
  id: string;
  entraObjectId: string;
  name: string;
  email: string;
  title: string;
  roleIds: string[];
  groups: string[];
  enabled: boolean;
  lastLoginAt?: string;
}

// ---------- Configuration ----------
export type ConfigStatus = 'DRAFT' | 'TESTING' | 'ACTIVE' | 'RETIRED';
export type RequirementType = 'MANDATORY' | 'OPTIONAL' | 'CONDITIONAL';
export type CheckMode = 'AVAILABILITY_ONLY' | 'EXTRACT_ONLY' | 'EXTRACT_AND_VALIDATE';
export type FieldDataType =
  | 'TEXT'
  | 'NUMBER'
  | 'CURRENCY'
  | 'DATE'
  | 'BOOLEAN'
  | 'CODE'
  | 'LIST'
  | 'PERCENTAGE';

export interface ConfigurationVersion {
  id: string;
  versionNo: string;
  label: string;
  status: ConfigStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
  notes?: string;
}

export interface InvoiceCategory {
  id: string;
  code: string;
  name: string;
  description: string;
  poBased: boolean;
  active: boolean;
}

export interface DocumentType {
  id: string;
  code: string;
  name: string;
  purpose: string;
  defaultExtractionMode: CheckMode;
  active: boolean;
}

export interface CategoryDocument {
  id: string;
  configVersionId: string;
  categoryId: string;
  documentTypeId: string;
  requirementType: RequirementType;
  condition?: string;
  /** Machine-readable version of `condition`, evaluated by the completeness check. */
  conditionRule?: 'PO_BASED' | 'DOMESTIC_VENDOR' | 'FOREIGN_VENDOR';
  checkMode: CheckMode;
  contentCheckRequired: boolean;
  availabilityCheckRequired: boolean;
  allowMultiple: boolean;
  missingSeverity: 'WARNING' | 'ERROR' | 'HARD_FAIL';
  blocking: boolean;
  overrideAllowed: boolean;
  sequence: number;
  active: boolean;
}

export interface DocumentField {
  id: string;
  configVersionId: string;
  categoryId: string;
  documentTypeId: string;
  fieldCode: string;
  label: string;
  dataType: FieldDataType;
  mandatory: boolean;
  extractionRequired: boolean;
  confidenceThreshold: number;
  manualEditAllowed: boolean;
  displayOrder: number;
  sapMapped: boolean;
  active: boolean;
}

export interface PromptTemplate {
  id: string;
  documentTypeId: string;
  name: string;
  version: string;
  status: ConfigStatus;
  systemInstruction: string;
  extractionInstruction: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  effectiveDate?: string;
  testSampleCount: number;
  createdBy: string;
  createdAt: string;
}

export interface ExtractionProfile {
  id: string;
  documentTypeId: string;
  engine: 'AZURE_OPENAI_GPT';
  modelDeployment: string;
  promptTemplateId: string;
  reviewThreshold: number;
  version: string;
  status: ConfigStatus;
}

export type MatchType =
  | 'EXACT_MATCH'
  | 'AMOUNT_MATCH'
  | 'DATE_MATCH'
  | 'CODE_MATCH'
  | 'LIST_MATCH'
  | 'RANGE_MATCH';

export interface FieldMapping {
  id: string;
  configVersionId: string;
  categoryId: string;
  documentTypeId: string;
  fieldCode: string;
  fieldLabel: string;
  sapField: string;
  sapDescription: string;
  matchType: MatchType;
  toleranceRule: string;
  mandatory: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
}

// ---------- Rule Engine ----------
export type RuleType =
  | 'PRESENCE'
  | 'EXACT_MATCH'
  | 'AMOUNT_TOLERANCE'
  | 'DATE_TOLERANCE'
  | 'RANGE'
  | 'LIST_MEMBERSHIP'
  | 'AGGREGATION'
  | 'CONDITIONAL'
  | 'FORMULA'
  | 'N_WAY'
  | 'CUSTOM';

export type RuleSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'HARD_FAIL';
export type RuleScope = 'GLOBAL' | 'CATEGORY' | 'DOCUMENT' | 'FIELD' | 'CROSS_DOCUMENT';

export type OperandSourceType =
  | 'DOCUMENT_FIELD'
  | 'SAP'
  | 'BIOMETRIC'
  | 'CONFIG'
  | 'MASTER'
  | 'CALCULATED';

export interface RuleOperand {
  id: string;
  ruleId: string;
  alias: string;
  label: string;
  sourceType: OperandSourceType;
  documentTypeCode?: string;
  fieldCode?: string;
  sapEntity?: 'PO' | 'PO_ITEM' | 'GRN' | 'SES' | 'VENDOR' | 'TAX' | 'PERIOD';
  sapField?: string;
  aggregation?: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX' | 'NONE';
  constantValue?: string | number;
  sequence: number;
}

export interface ValidationRule {
  id: string;
  configVersionId: string;
  ruleCode: string;
  ruleName: string;
  description: string;
  scope: RuleScope;
  categoryId?: string;
  documentTypeId?: string;
  ruleType: RuleType;
  comparator?: 'ALL_EQUAL' | 'LEFT_LTE_RIGHT' | 'LEFT_GTE_RIGHT' | 'DIFF_WITHIN_TOLERANCE';
  toleranceType?: 'NONE' | 'PERCENT' | 'ABSOLUTE' | 'DAYS';
  toleranceValue?: number;
  severity: RuleSeverity;
  blocking: boolean;
  overrideAllowed: boolean;
  overrideRole?: string;
  priority: number;
  handlerKey?: string;
  handlerParams?: Record<string, unknown>;
  effectiveFrom?: string;
  version: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
}

// ---------- Invoice & Documents ----------
export type InvoiceLifecycle = 'DRAFT' | 'VALIDATED' | 'IN_PROGRESS' | 'PARKED' | 'POSTED' | 'PAID';

export type InvoiceStage =
  | 'RECEIVED'
  | 'CLASSIFICATION'
  | 'COMPLETENESS'
  | 'EXTRACTION'
  | 'EXTRACTION_REVIEW'
  | 'VALIDATION'
  | 'EXCEPTION'
  | 'APPROVAL'
  | 'TAX_REVIEW'
  | 'SAP_HANDOFF'
  | 'SAP_PROCESSING'
  | 'COMPLETED';

export type ProcessingFlag =
  | 'MISSING_DOCUMENTS'
  | 'EXTRACTION_REVIEW'
  | 'VALIDATION_FAILED'
  | 'APPROVAL_PENDING'
  // UI/UX review (Aug 2026) §14: a rejected invoice is its own business state
  // and must not be presented as a generic validation failure.
  | 'REJECTED'
  | 'SAP_PENDING'
  | 'SAP_ERROR'
  | 'TECHNICAL_RETRY'
  | null;

export type IngestSource = 'EMAIL' | 'SHAREPOINT' | 'MANUAL_UPLOAD';

// ---------------------------------------------------------------- SLA model
/**
 * SLA administration model — ESSA EAPA SLA Administration UI Specification
 * (basis: BPD v0.1.4 SLA matrix page 13, §11.3 and §11.4).
 *
 * Configuration layer (sla_policy + sla_rule + business_calendar):
 *   · SlaPolicy      — header, scope, stage, trigger, timer, reminders,
 *                      escalation and (proposed) pause rules. Every published
 *                      version is immutable; a change creates a new version row
 *                      with the same `code`.
 *   · BusinessCalendar — working days/hours and holidays, used only by policies
 *                      measured in business days / business hours.
 * Runtime layer (sla_instance + sla_event) is derived from the invoices,
 * approval steps and document requests the platform already tracks — see
 * core/sla.ts — so a runtime clock can never disagree with the workbench.
 */

/** Processing stages an SLA policy can be attached to. */
export type SlaStage = 'INVOICE_CREATION' | 'TAX_REVIEW' | 'AP_APPROVAL' | 'PAYMENT' | 'DOCUMENT_REQUEST';

/** Where a policy applies (spec Screen 2 — Scope Type). */
export type SlaScopeType = 'INVOICE_CATEGORY' | 'WORKFLOW' | 'DOCUMENT_REQUEST' | 'GLOBAL';

/** Lifecycle of a policy version (spec Screen 9). */
export type SlaPolicyStatus = 'DRAFT' | 'TEST' | 'ACTIVE' | 'RETIRED';

/** Unit of the target duration. The BPD does not state the unit — see `unitConfirmed`. */
export type SlaDurationUnit = 'HOURS' | 'CALENDAR_DAYS' | 'BUSINESS_HOURS' | 'BUSINESS_DAYS';

/** Event that creates a runtime SLA instance (spec Screen 2 — Trigger Event). */
export type SlaTriggerEvent =
  | 'INVOICE_CREATED'
  | 'VALIDATION_COMPLETED'
  | 'TAX_REVIEW_ASSIGNED'
  | 'WORKFLOW_STEP_ASSIGNED'
  | 'INVOICE_APPROVED'
  | 'DOCUMENT_REQUEST_SENT';

export type SlaChannel = 'EMAIL' | 'TEAMS' | 'PORTAL';

export interface SlaDuration {
  value: number;
  unit: SlaDurationUnit;
}

export interface SlaTimer {
  /** Target duration. Null means the stage does not apply to this scope. */
  duration: number | null;
  unit: SlaDurationUnit;
  /** False until ESSA confirms calendar vs business-day interpretation (BPD gap). */
  unitConfirmed: boolean;
  /** Required when the unit is business days / business hours. */
  calendarId?: string;
  timezone: string;
  /** Optional pre-breach warning threshold (spec Screen 3). */
  warningBefore: SlaDuration | null;
  countdownOnWorkbench: boolean;
  dashboardIndicator: boolean;
}

/** One progressive reminder (spec Screen 4). */
export interface SlaReminderRule {
  id: string;
  seq: number;
  /** Sent this long after the SLA starts (or after the previous reminder when `repeat` is set). */
  after: SlaDuration;
  /** Repeat at the same interval while the SLA is still open (missing-document chase). */
  repeat: boolean;
  recipient: string;
  channels: SlaChannel[];
  template: string;
  enabled: boolean;
}

export type SlaBreachCondition = 'AFTER_FINAL_REMINDER' | 'AFTER_FIRST_UNANSWERED_REMINDER' | 'ON_DUE_TIME';

/** Escalation behaviour (spec Screen 5). */
export interface SlaEscalation {
  enabled: boolean;
  breachCondition: SlaBreachCondition;
  primaryTarget: string;
  fallbackTarget: string;
  channels: SlaChannel[];
  createAuditEvent: boolean;
  createBreachFlag: boolean;
}

/** Proposed stop-clock rule (spec Screen 6) — inert until ESSA confirms. */
export interface SlaPauseRule {
  code: string;
  label: string;
  pause: boolean;
  resumeEvent: string;
  reasonRequired: boolean;
}

export interface SlaPolicy {
  /** Row id of this version. */
  id: string;
  /** Stable SLA code shared by every version; immutable after first publish. */
  code: string;
  name: string;
  description?: string;
  scopeType: SlaScopeType;
  /** Invoice / activity type from the SLA matrix (MATERIAL, SERVICE, NON_PO, PIB_PAYMENT …). */
  activity?: string;
  stage: SlaStage;
  triggerEvent: SlaTriggerEvent;
  owner?: string;
  /** Tax Team SLA etc.: the BPD value is still to be confirmed. */
  provisional: boolean;
  provisionalNote?: string;

  version: number;
  status: SlaPolicyStatus;
  effectiveFrom: string;
  changedBy: string;
  changedAt: string;
  changeSummary?: string;
  publishedBy?: string;
  publishedAt?: string;
  retiredAt?: string;
  lastTestedAt?: string;

  timer: SlaTimer;
  reminders: SlaReminderRule[];
  escalation: SlaEscalation;
  pauseRules: SlaPauseRule[];
  manualPauseAllowed: boolean;
  maxPause: SlaDuration | null;
}

export type CalendarExceptionType = 'PUBLIC_HOLIDAY' | 'COMPANY_HOLIDAY' | 'WORKING_DAY_EXCEPTION';

export interface CalendarException {
  id: string;
  /** yyyy-mm-dd in the calendar's timezone. */
  date: string;
  name: string;
  type: CalendarExceptionType;
  /** Whether the day counts as working time. */
  working: boolean;
}

/** Working-time calendar (spec Screen 7). */
export interface BusinessCalendar {
  id: string;
  code: string;
  name: string;
  timezone: string;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  workStart: string;
  workEnd: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  version: number;
  effectiveFrom: string;
  changedBy: string;
  changedAt: string;
  exceptions: CalendarException[];
}

/** Recommended runtime statuses (spec §15.1). */
export type SlaInstanceStatus = 'PENDING' | 'RUNNING' | 'WARNING' | 'PAUSED' | 'COMPLETED' | 'BREACHED' | 'CANCELLED';

export type SlaEventType = 'STARTED' | 'WARNING' | 'REMINDER' | 'PAUSED' | 'RESUMED' | 'ESCALATED' | 'COMPLETED' | 'BREACHED' | 'CANCELLED';

export interface SlaEvent {
  type: SlaEventType;
  at: string;
  detail: string;
}

/** Runtime SLA instance — one per invoice stage / approval step / document request. */
export interface SlaInstance {
  id: string;
  objectType: 'INVOICE' | 'WORKFLOW_STEP' | 'DOCUMENT_REQUEST';
  objectId: string;
  /** Business reference shown to users (invoice number, request number). */
  reference: string;
  invoiceId?: string;
  invoiceNumber?: string;
  vendorName?: string;
  categoryId?: string;
  categoryName?: string;
  policyId?: string;
  policyCode: string;
  policyName: string;
  policyVersion?: number;
  stage: SlaStage;
  owner: string;
  startedAt: string;
  warningAt?: string | null;
  dueAt?: string | null;
  status: SlaInstanceStatus;
  /** Milliseconds remaining (positive) or overdue (negative); null when no clock. */
  remainingMs: number | null;
  note?: string;
  events: SlaEvent[];
}

/**
 * Exception code catalogue — one code per error type so the same failure always
 * carries the same code, whatever the invoice, category or vendor.
 */
export interface ExceptionCode {
  /** Equal to the code for the seeded catalogue; generated for codes added later. */
  id: string;
  code: string;
  type: ExceptionType;
  /** Set for missing-document codes: one code per required document type. */
  documentTypeId?: string;
  label: string;
  description: string;
  active: boolean;
}


export interface Invoice {
  id: string;
  invoiceNumber: string;
  vendorCode: string;
  vendorName: string;
  categoryId: string;
  invoiceDate: string;
  receivedAt: string;
  amount: number;
  subtotal: number;
  taxAmount: number;
  currency: string;
  /**
   * Amount in the reporting currency (IDR). Equal to `amount` for IDR invoices;
   * foreign-currency invoices are converted at `exchangeRate` (the customs
   * NDPBM rate for imports) so approval thresholds and dashboards compare like
   * with like.
   */
  amountIdr: number;
  exchangeRate?: number;
  poNumber?: string;
  companyCode: string;
  /** Service / claim period covered by the invoice (used for biometric and SES matching). */
  servicePeriodFrom?: string;
  servicePeriodTo?: string;
  /**
   * Ground truth read from the vendor documents (seeded demo data). The mock
   * extraction adapter returns these values instead of deriving them, so every
   * screen shows exactly what is printed on the sample invoices. Keys are
   * `DOCTYPE.FIELD` or `FIELD`. Not used by the production extractor.
   */
  facts?: Record<string, string>;
  source: IngestSource;
  stage: InvoiceStage;
  lifecycle: InvoiceLifecycle;
  processingFlag: ProcessingFlag;
  slaDueAt: string;
  slaBreached: boolean;
  assignedTo?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  configVersionId: string;
  correlationId: string;
  description: string;
  sapDocumentNo?: string;
  sapFiscalYear?: string;
  paymentStatus?: 'NOT_DUE' | 'DUE' | 'PAID';
  paymentDate?: string;
  paymentRef?: string;
  taxReviewRequired: boolean;
  extractionConfidence?: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  lineNo: number;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  amount: number;
  poItem?: string;
  taxCode?: string;
}

export type DocumentStatus = 'AVAILABLE' | 'MISSING' | 'SUPERSEDED' | 'REJECTED';
export type ExtractionStatus = 'NOT_REQUIRED' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'REVIEW';

export interface InvoiceDocument {
  id: string;
  invoiceId: string;
  documentTypeId: string;
  fileName: string;
  pages: number;
  sizeKb: number;
  mimeType: string;
  source: IngestSource;
  sharePointUrl: string;
  checksum: string;
  status: DocumentStatus;
  extractionStatus: ExtractionStatus;
  requirementType: RequirementType;
  checkMode: CheckMode;
  version: number;
  supersededById?: string;
  uploadedBy: string;
  uploadedAt: string;
}

// ---------- Extraction ----------
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';
export type FieldValidationStatus = 'PENDING' | 'VALID' | 'INVALID' | 'REVIEW' | 'CORRECTED' | 'ACCEPTED';

export interface ExtractionRun {
  id: string;
  invoiceId: string;
  documentId: string;
  documentTypeId: string;
  profileVersion: string;
  promptVersion: string;
  modelDeployment: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  fieldCount: number;
  lowConfidenceCount: number;
  correlationId: string;
  error?: string;
}

export interface FieldCorrection {
  previousValue: string;
  newValue: string;
  correctedBy: string;
  correctedByName: string;
  reason: string;
  correctedAt: string;
}

export interface ExtractedField {
  id: string;
  invoiceId: string;
  documentId: string;
  extractionRunId: string;
  documentTypeId: string;
  fieldCode: string;
  label: string;
  dataType: FieldDataType;
  rawValue: string;
  value: string;
  confidence: number;
  confidenceBand: ConfidenceBand;
  page: number;
  evidence: string;
  validationStatus: FieldValidationStatus;
  mandatory: boolean;
  corrections: FieldCorrection[];
}

// ---------- Validation ----------
export type RuleResultOutcome = 'PASS' | 'WARNING' | 'FAIL' | 'HARD_FAIL' | 'PENDING' | 'OVERRIDDEN' | 'SKIPPED';

export interface OperandValue {
  alias: string;
  label: string;
  source: string;
  value: string | number | null;
  detail?: string;
}

export interface ValidationOverride {
  by: string;
  byName: string;
  role: string;
  reason: string;
  at: string;
  previousResult: RuleResultOutcome;
}

export interface ValidationResult {
  id: string;
  runId: string;
  invoiceId: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  ruleType: RuleType;
  severity: RuleSeverity;
  blocking: boolean;
  overrideAllowed: boolean;
  result: RuleResultOutcome;
  expected: string;
  actual: string;
  tolerance: string;
  differencePct?: number;
  operandValues: OperandValue[];
  message: string;
  ruleVersion: string;
  override?: ValidationOverride;
}

export interface ValidationRun {
  id: string;
  invoiceId: string;
  configVersionId: string;
  trigger: 'PIPELINE' | 'REVALIDATION' | 'CORRECTION' | 'OVERRIDE' | 'DOCUMENT_REPLACED' | 'MANUAL';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  startedBy: string;
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    hardFailed: number;
    overridden: number;
    pending: number;
  };
  outcome: 'PASS' | 'FAIL' | 'PENDING';
  correlationId: string;
}

// ---------- Exceptions ----------
export type ExceptionType =
  | 'MISSING_DOCUMENT'
  | 'EXTRACTION_FAILURE'
  | 'LOW_CONFIDENCE'
  | 'VALIDATION_FAILURE'
  | 'MISSING_SAP_REFERENCE'
  | 'VENDOR_ISSUE'
  | 'TAX_ISSUE'
  | 'APPROVAL_ISSUE'
  | 'INTEGRATION_FAILURE'
  | 'TECHNICAL_FAILURE';

export type ExceptionStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';

export interface ExceptionAction {
  at: string;
  by: string;
  byName: string;
  action: string;
  note?: string;
}

export interface ExceptionRecord {
  id: string;
  code: string;
  invoiceId: string;
  type: ExceptionType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: ExceptionStatus;
  title: string;
  detail: string;
  ruleCode?: string;
  fieldCode?: string;
  documentTypeId?: string;
  assignedTo?: string;
  assignedToName?: string;
  createdAt: string;
  slaDueAt: string;
  resolvedAt?: string;
  resolution?: string;
  retryCount: number;
  technical: boolean;
  correlationId: string;
  actions: ExceptionAction[];
}

// ---------- Workflow ----------
export interface WorkflowStepDef {
  stepNo: number;
  name: string;
  role: string;
  approverType: 'ROLE' | 'USER' | 'GROUP' | 'DOA';
  approverRef?: string;
  amountThresholdMin?: number;
  amountThresholdMax?: number;
  taxStep?: boolean;
  slaHours: number;
  escalationTo?: string;
  skipIfEmpty?: boolean;
  notify: boolean;
}

export interface WorkflowDefinition {
  id: string;
  configVersionId: string;
  code: string;
  name: string;
  description: string;
  categoryId?: string;
  steps: WorkflowStepDef[];
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
  version: string;
}

export type StepStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT_BACK'
  | 'ESCALATED'
  | 'DELEGATED'
  | 'SKIPPED';

export interface WorkflowStepInstance {
  id: string;
  instanceId: string;
  invoiceId: string;
  stepNo: number;
  name: string;
  role: string;
  assignedTo?: string;
  assignedToName?: string;
  delegatedTo?: string;
  status: StepStatus;
  dueAt?: string;
  slaBreached: boolean;
  actedBy?: string;
  actedByName?: string;
  actedAt?: string;
  comment?: string;
  channel?: 'PORTAL' | 'TEAMS';
}

export interface WorkflowInstance {
  id: string;
  invoiceId: string;
  definitionId: string;
  definitionName: string;
  status: 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  currentStepNo: number;
  startedAt: string;
  completedAt?: string;
}

/**
 * One approval level inside an amount band — BPD v0.1.4 §11.2 "DoA Approval
 * Hierarchy". Approval authority is decided by the invoice amount alone;
 * department is not a concept in this platform (UI/UX review, 24 Aug 2026).
 */
export interface DoAEntry {
  id: string;
  level: number;
  /** Approval role that owns this level (HOS, HOD, HOF, OSH_STH, GFD). */
  role: string;
  minAmount: number;
  maxAmount: number | null;
  currency: string;
  active: boolean;
  approverUserId?: string;
  approverName?: string;
}

// ---------- Vendor ----------
export interface VendorSnapshot {
  code: string;
  name: string;
  legalName: string;
  address: string;
  city: string;
  state: string;
  country: string;
  gstin: string;
  pan: string;
  bankAccountMasked: string;
  bankName: string;
  paymentTerms: string;
  currency: string;
  companyCodes: string[];
  classification: string;
  sapStatus: 'ACTIVE' | 'BLOCKED';
  lastSyncAt: string;
  sapRef: string;
  email: string;
  phone: string;
}

export interface VendorPortalControl {
  vendorCode: string;
  negativeFlag: boolean;
  apEnabled: boolean;
  reason?: string;
  remarks?: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

export interface VendorControlHistory {
  id: string;
  vendorCode: string;
  action: 'NEGATIVE_MARKED' | 'NEGATIVE_REMOVED' | 'ENABLED' | 'DISABLED';
  reason: string;
  by: string;
  byName: string;
  at: string;
}

// ---------- SAP ----------
export interface SapPoItem {
  item: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  amount: number;
  grnQuantity: number;
  sesQuantity: number;
  openQuantity: number;
}

export interface SapPurchaseOrder {
  poNumber: string;
  vendorCode: string;
  vendorName: string;
  companyCode: string;
  currency: string;
  totalAmount: number;
  openAmount: number;
  validFrom: string;
  validTo: string;
  poType: 'MATERIAL' | 'SERVICE' | 'FRAMEWORK';
  items: SapPoItem[];
  status: 'OPEN' | 'CLOSED' | 'BLOCKED';
}

export interface SapGrn {
  grnNumber: string;
  poNumber: string;
  postingDate: string;
  totalQuantity: number;
  amount: number;
  movementType: string;
  items: { poItem: string; quantity: number; amount: number }[];
}

export interface SapSes {
  sesNumber: string;
  poNumber: string;
  postingDate: string;
  serviceDescription: string;
  quantity: number;
  uom: string;
  amount: number;
  acceptedAmount: number;
  status: 'ACCEPTED' | 'PENDING';
}

export type SapHandoffStatus =
  | 'QUEUED'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'PARKED'
  | 'POSTED'
  | 'FAILED'
  | 'DEAD_LETTER';

export interface SapHandoff {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  idempotencyKey: string;
  status: SapHandoffStatus;
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  acknowledgedAt?: string;
  sapDocumentNo?: string;
  sapFiscalYear?: string;
  message?: string;
  errorCode?: string;
  correlationId: string;
  payloadSummary: Record<string, unknown>;
}

export type SapConnectionState = 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE';

export interface IntegrationHealth {
  sapState: SapConnectionState;
  sapMessage: string;
  referenceDataSyncedAt: string;
  referenceDataStale: boolean;
  sharePointState: 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE';
  mailboxState: 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE';
  gptState: 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE';
  biometricLastPushAt: string;
  teamsState: 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE';
}

// ---------- Biometric ----------
export interface AttendanceRecord {
  id: string;
  batchId: string;
  source: string;
  site: string;
  vendorCode: string;
  employeeId: string;
  employeeName: string;
  date: string;
  present: boolean;
  hours: number;
  otHours: number;
  mealEligible: boolean;
  pushedAt: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
}

export interface AttendanceBatch {
  id: string;
  source: string;
  receivedAt: string;
  recordCount: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  status: 'PROCESSED' | 'FAILED';
  correlationId: string;
}

// ---------- Ingestion ----------
export interface EmailIngestionItem {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  attachments: { fileName: string; sizeKb: number }[];
  status: 'NEW' | 'PROCESSING' | 'PROCESSED' | 'ERROR' | 'IGNORED';
  invoiceId?: string;
  error?: string;
}

export interface SharePointMonitorItem {
  id: string;
  folder: string;
  fileName: string;
  modifiedAt: string;
  sizeKb: number;
  status: 'NEW' | 'PROCESSING' | 'PROCESSED' | 'ERROR';
  invoiceId?: string;
}

// ---------- Notifications ----------
export type NotificationCategory = 'APPROVAL' | 'EXCEPTION' | 'VALIDATION' | 'SAP' | 'SYSTEM' | 'CONFIGURATION';

export interface NotificationRecord {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  invoiceId?: string;
  entityRef?: string;
  read: boolean;
  createdAt: string;
  channel: 'IN_APP' | 'EMAIL' | 'TEAMS';
}

export interface NotificationRule {
  id: string;
  configVersionId: string;
  event: string;
  label: string;
  channels: ('EMAIL' | 'TEAMS' | 'IN_APP')[];
  recipients: string;
  template: string;
  active: boolean;
}

// ---------- Email templates (Administration → Email Templates) ----------
export interface EmailRecipients {
  /** Descriptive To audience — actual resolution stays with the sending scenario. */
  to: string;
  cc?: string;
  bcc?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  /** Scenario/event key this template serves, e.g. APPROVAL_REQUESTED. */
  scenario: string;
  description?: string;
  subject: string;
  bodyHtml: string;
  recipients: EmailRecipients;
  requiredPlaceholders: string[];
  status: 'ACTIVE' | 'INACTIVE';
  /** Seeded for a built-in scenario — cannot be deleted, only deactivated. */
  system: boolean;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface EmailTemplateVersion {
  id: string;
  templateId: string;
  version: number;
  action: 'CREATED' | 'UPDATED' | 'ACTIVATED' | 'DEACTIVATED' | 'DUPLICATED' | 'RESTORED';
  snapshot: Pick<EmailTemplate, 'name' | 'scenario' | 'description' | 'subject' | 'bodyHtml' | 'recipients' | 'requiredPlaceholders' | 'status'>;
  changedAt: string;
  changedBy: string;
  note?: string;
}

// ---------- Audit & Logs ----------
export interface AuditEvent {
  id: string;
  eventTime: string;
  actorType: 'USER' | 'SYSTEM' | 'INTEGRATION';
  actorId: string;
  actorName: string;
  actorRole?: string;
  eventType: string;
  category:
    | 'AUTHENTICATION'
    | 'INVOICE'
    | 'DOCUMENT'
    | 'EXTRACTION'
    | 'VALIDATION'
    | 'EXCEPTION'
    | 'APPROVAL'
    | 'SAP'
    | 'VENDOR'
    | 'ACCESS'
    | 'CONFIGURATION'
    | 'BIOMETRIC';
  action: string;
  module: string;
  entityType: string;
  /**
   * Extra context rendered as label / value rows when the record is expanded —
   * the things that only make sense for this kind of activity (which document,
   * which extraction profile, which prompt version).
   */
  details?: { label: string; value: string }[];
  entityId: string;
  entityRef?: string;
  invoiceId?: string;
  result: 'SUCCESS' | 'REJECTED' | 'PASS' | 'FAIL' | 'OVERRIDDEN' | 'DENIED';
  reason?: string;
  oldValue?: unknown;
  newValue?: unknown;
  correlationId: string;
  source: string;
  ip?: string;
}

export interface TechnicalLog {
  id: string;
  timestamp: string;
  level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  service: string;
  module: string;
  event: string;
  message: string;
  correlationId?: string;
  transactionId?: string;
  requestId?: string;
  jobId?: string;
  invoiceId?: string;
  integration?: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
  retryCount?: number;
  environment: string;
}

export interface IntegrationJob {
  id: string;
  type:
    | 'EXTRACTION'
    | 'CLASSIFICATION'
    | 'VALIDATION'
    | 'SAP_HANDOFF'
    | 'SAP_STATUS_SYNC'
    | 'SHAREPOINT_SYNC'
    | 'MAILBOX_POLL'
    | 'NOTIFICATION'
    | 'REPROCESS'
    | 'REFERENCE_SYNC';
  refId?: string;
  invoiceId?: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER' | 'RETRYING';
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  nextRetryAt?: string;
  correlationId: string;
  detail: string;
  error?: string;
}

// ---------- Timeline ----------
export interface TimelineEvent {
  id: string;
  invoiceId: string;
  at: string;
  actorType: 'USER' | 'SYSTEM' | 'INTEGRATION';
  actorName: string;
  event: string;
  title: string;
  detail?: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  reference?: string;
  correlationId?: string;
}
