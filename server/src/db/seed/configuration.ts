import type {
  CategoryDocument,
  ConfigurationVersion,
  DocumentField,
  DocumentType,
  ExtractionProfile,
  FieldMapping,
  InvoiceCategory,
  NotificationRule,
  PromptTemplate,
  RuleOperand,
  ValidationRule,
  WorkflowDefinition,
} from '../../core/types';
import { isoAgo, DAY } from '../../core/ids';

/**
 * The platform runs on one live configuration (review, 25 Aug). Draft/publish
 * versioning was removed from the product: administrators change the live
 * configuration directly and every change is audited. The single record is kept
 * so each invoice can still record which configuration processed it.
 */
export const CONFIG_VERSIONS: ConfigurationVersion[] = [
  {
    id: 'cfg-1', versionNo: 'v1.0', label: 'ESSA AP configuration', status: 'ACTIVE',
    effectiveFrom: '2026-05-01', createdBy: 'Surya Nugraha', createdAt: isoAgo(120 * DAY),
    approvedBy: 'Maya Puspita', approvedAt: isoAgo(105 * DAY),
    publishedBy: 'Surya Nugraha', publishedAt: isoAgo(103 * DAY),
    notes: 'Categories, documents, fields, prompts, mappings and rules from the requirement workshops.',
  },
];

export const CATEGORIES: InvoiceCategory[] = [
  { id: 'cat-material', code: 'MATERIAL', name: 'Material Invoice', description: 'PO/GRN backed goods invoices with quantity and price reconciliation', poBased: true, active: true },
  { id: 'cat-service', code: 'SERVICE', name: 'Service Invoice', description: 'PO/SES backed service invoices with service-entry reconciliation', poBased: true, active: true },
  { id: 'cat-manpower', code: 'MANPOWER', name: 'Manpower Invoice', description: 'Contract manpower with timesheet/manhour/attendance N-way reconciliation', poBased: true, active: true },
  { id: 'cat-catering', code: 'CATERING', name: 'Catering Invoice', description: 'Canteen/catering with meal-count and biometric eligibility checks', poBased: true, active: true },
  { id: 'cat-nonpo', code: 'NON_PO', name: 'Non-PO Invoice', description: 'Invoices without a purchase order, routed through the amount-based approval hierarchy', poBased: false, active: true },
];

export const DOCUMENT_TYPES: DocumentType[] = [
  { id: 'dt-invoice', code: 'INVOICE', name: 'Invoice', purpose: 'Primary invoice document from vendor', defaultExtractionMode: 'EXTRACT_AND_VALIDATE', active: true },
  { id: 'dt-po', code: 'PURCHASE_ORDER', name: 'Purchase Order', purpose: 'Customer purchase order reference copy', defaultExtractionMode: 'EXTRACT_AND_VALIDATE', active: true },
  { id: 'dt-grn', code: 'GRN', name: 'Goods Receipt Note (GRN)', purpose: 'Goods receipt evidence for material invoices', defaultExtractionMode: 'EXTRACT_ONLY', active: true },
  { id: 'dt-ses', code: 'SES', name: 'Service Entry Sheet (SES)', purpose: 'Details of services performed and accepted', defaultExtractionMode: 'EXTRACT_AND_VALIDATE', active: true },
  { id: 'dt-timesheet', code: 'TIMESHEET', name: 'Timesheet', purpose: 'Per-resource work hours for manpower invoices', defaultExtractionMode: 'EXTRACT_AND_VALIDATE', active: true },
  { id: 'dt-manhour', code: 'MANHOUR_SUMMARY', name: 'Manhour Summary', purpose: 'Summary of hours worked by resource', defaultExtractionMode: 'EXTRACT_AND_VALIDATE', active: true },
  { id: 'dt-attendance', code: 'ATTENDANCE_SHEET', name: 'Attendance Sheet', purpose: 'Attendance of resources on site', defaultExtractionMode: 'AVAILABILITY_ONLY', active: true },
  { id: 'dt-meal', code: 'MEAL_SUMMARY', name: 'Meal Summary', purpose: 'Daily/monthly meal count summary for catering', defaultExtractionMode: 'EXTRACT_AND_VALIDATE', active: true },
  { id: 'dt-tax', code: 'TAX_INVOICE', name: 'Tax Document', purpose: 'Tax invoice (Faktur Pajak) copy', defaultExtractionMode: 'AVAILABILITY_ONLY', active: true },
  { id: 'dt-challan', code: 'DELIVERY_CHALLAN', name: 'Delivery Challan', purpose: 'Delivery evidence accompanying material shipments', defaultExtractionMode: 'AVAILABILITY_ONLY', active: true },
  { id: 'dt-support', code: 'SUPPORTING_DOC', name: 'Supporting Document', purpose: 'Other supporting documents (optional)', defaultExtractionMode: 'AVAILABILITY_ONLY', active: true },
  { id: 'dt-dept', code: 'HCIS_CLEARING', name: 'HCIS Clearing Journal', purpose: 'HCIS / Darwinbox clearing journal backing a Non-PO invoice (BPD §10.5)', defaultExtractionMode: 'AVAILABILITY_ONLY', active: true },
];

const cd = (
  id: string, categoryId: string, documentTypeId: string, requirementType: CategoryDocument['requirementType'],
  checkMode: CategoryDocument['checkMode'], seq: number,
  opts: Partial<CategoryDocument> = {}
): CategoryDocument => ({
  id, configVersionId: 'cfg-1', categoryId, documentTypeId, requirementType,
  checkMode,
  contentCheckRequired: checkMode !== 'AVAILABILITY_ONLY',
  availabilityCheckRequired: true,
  allowMultiple: opts.allowMultiple ?? false,
  missingSeverity: opts.missingSeverity ?? (requirementType === 'MANDATORY' ? 'ERROR' : 'WARNING'),
  blocking: opts.blocking ?? requirementType === 'MANDATORY',
  overrideAllowed: opts.overrideAllowed ?? requirementType !== 'MANDATORY',
  sequence: seq,
  active: true,
  condition: opts.condition,
});

export const CATEGORY_DOCUMENTS: CategoryDocument[] = [
  // Material
  cd('cdoc-m1', 'cat-material', 'dt-invoice', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 1),
  cd('cdoc-m2', 'cat-material', 'dt-po', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 2, { allowMultiple: true }),
  cd('cdoc-m3', 'cat-material', 'dt-grn', 'MANDATORY', 'EXTRACT_ONLY', 3, { allowMultiple: true }),
  cd('cdoc-m4', 'cat-material', 'dt-challan', 'OPTIONAL', 'AVAILABILITY_ONLY', 4, { allowMultiple: true }),
  cd('cdoc-m5', 'cat-material', 'dt-tax', 'MANDATORY', 'AVAILABILITY_ONLY', 5),
  cd('cdoc-m6', 'cat-material', 'dt-support', 'OPTIONAL', 'AVAILABILITY_ONLY', 6, { allowMultiple: true }),
  // Service
  cd('cdoc-s1', 'cat-service', 'dt-invoice', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 1),
  cd('cdoc-s2', 'cat-service', 'dt-po', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 2),
  cd('cdoc-s3', 'cat-service', 'dt-ses', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 3, { allowMultiple: true }),
  cd('cdoc-s4', 'cat-service', 'dt-attendance', 'CONDITIONAL', 'AVAILABILITY_ONLY', 4, { condition: 'On-site services (PO-based)' }),
  cd('cdoc-s5', 'cat-service', 'dt-support', 'OPTIONAL', 'AVAILABILITY_ONLY', 5, { allowMultiple: true }),
  // Manpower
  cd('cdoc-p1', 'cat-manpower', 'dt-invoice', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 1),
  cd('cdoc-p2', 'cat-manpower', 'dt-po', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 2),
  cd('cdoc-p3', 'cat-manpower', 'dt-timesheet', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 3, { allowMultiple: true }),
  cd('cdoc-p4', 'cat-manpower', 'dt-manhour', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 4),
  cd('cdoc-p5', 'cat-manpower', 'dt-attendance', 'MANDATORY', 'AVAILABILITY_ONLY', 5),
  cd('cdoc-p6', 'cat-manpower', 'dt-ses', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 6),
  // Catering
  cd('cdoc-c1', 'cat-catering', 'dt-invoice', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 1),
  cd('cdoc-c2', 'cat-catering', 'dt-po', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 2),
  cd('cdoc-c3', 'cat-catering', 'dt-meal', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 3),
  cd('cdoc-c4', 'cat-catering', 'dt-attendance', 'MANDATORY', 'AVAILABILITY_ONLY', 4),
  // Non-PO
  cd('cdoc-n1', 'cat-nonpo', 'dt-invoice', 'MANDATORY', 'EXTRACT_AND_VALIDATE', 1),
  cd('cdoc-n2', 'cat-nonpo', 'dt-dept', 'MANDATORY', 'AVAILABILITY_ONLY', 2),
  cd('cdoc-n3', 'cat-nonpo', 'dt-support', 'OPTIONAL', 'AVAILABILITY_ONLY', 3, { allowMultiple: true }),
];

// ---------------- fields ----------------
let fieldSeq = 0;
const fld = (
  categoryId: string, documentTypeId: string, fieldCode: string, label: string,
  dataType: DocumentField['dataType'], mandatory: boolean, opts: Partial<DocumentField> = {}
): DocumentField => ({
  id: `fld-${++fieldSeq}`,
  configVersionId: 'cfg-1',
  categoryId, documentTypeId, fieldCode, label, dataType, mandatory,
  extractionRequired: opts.extractionRequired ?? true,
  confidenceThreshold: opts.confidenceThreshold ?? 0.7,
  manualEditAllowed: opts.manualEditAllowed ?? true,
  displayOrder: fieldSeq,
  sapMapped: opts.sapMapped ?? false,
  active: true,
});

function invoiceHeaderFields(categoryId: string, poBased: boolean): DocumentField[] {
  const f = [
    fld(categoryId, 'dt-invoice', 'INVOICE_NUMBER', 'Invoice Number', 'TEXT', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'INVOICE_DATE', 'Invoice Date', 'DATE', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'VENDOR_NAME', 'Vendor Name', 'TEXT', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'VENDOR_CODE', 'Vendor Code', 'CODE', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'VENDOR_TAX_NUMBER', 'Vendor Tax Number', 'CODE', false),
    fld(categoryId, 'dt-invoice', 'INVOICE_AMOUNT', 'Invoice Amount', 'CURRENCY', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'INVOICE_SUBTOTAL', 'Invoice Subtotal', 'CURRENCY', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'TAX_AMOUNT', 'Tax Amount', 'CURRENCY', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'CURRENCY', 'Currency', 'LIST', true, { sapMapped: true }),
    fld(categoryId, 'dt-invoice', 'DESCRIPTION', 'Description', 'TEXT', false),
  ];
  if (poBased) f.splice(5, 0, fld(categoryId, 'dt-invoice', 'PO_NUMBER', 'PO Number', 'CODE', true, { sapMapped: true }));
  return f;
}

export const DOCUMENT_FIELDS: DocumentField[] = [
  ...invoiceHeaderFields('cat-material', true),
  fld('cat-material', 'dt-po', 'PO_NUMBER', 'PO Number', 'CODE', true, { sapMapped: true }),
  fld('cat-material', 'dt-po', 'QUANTITY', 'Ordered Quantity', 'NUMBER', false),
  fld('cat-material', 'dt-po', 'UNIT_RATE', 'Unit Rate', 'CURRENCY', false),
  fld('cat-material', 'dt-grn', 'GRN_NUMBER', 'GRN Number', 'CODE', true, { sapMapped: true }),
  fld('cat-material', 'dt-grn', 'QUANTITY', 'Received Quantity', 'NUMBER', true),

  ...invoiceHeaderFields('cat-service', true),
  fld('cat-service', 'dt-po', 'PO_NUMBER', 'PO Number', 'CODE', true, { sapMapped: true }),
  fld('cat-service', 'dt-ses', 'SES_NUMBER', 'SES Number', 'CODE', true, { sapMapped: true }),
  fld('cat-service', 'dt-ses', 'QUANTITY', 'Service Quantity', 'NUMBER', true),
  fld('cat-service', 'dt-ses', 'PERIOD_FROM', 'Service Period From', 'DATE', false),
  fld('cat-service', 'dt-ses', 'PERIOD_TO', 'Service Period To', 'DATE', false),

  ...invoiceHeaderFields('cat-manpower', true),
  fld('cat-manpower', 'dt-po', 'PO_NUMBER', 'PO Number', 'CODE', true, { sapMapped: true }),
  fld('cat-manpower', 'dt-timesheet', 'TOTAL_HOURS', 'Total Hours', 'NUMBER', true),
  fld('cat-manpower', 'dt-timesheet', 'HEADCOUNT', 'Headcount', 'NUMBER', true),
  fld('cat-manpower', 'dt-manhour', 'TOTAL_HOURS', 'Total Manhours', 'NUMBER', true, { sapMapped: true }),
  fld('cat-manpower', 'dt-manhour', 'OT_HOURS', 'Overtime Hours', 'NUMBER', false),
  fld('cat-manpower', 'dt-ses', 'SES_NUMBER', 'SES Number', 'CODE', true, { sapMapped: true }),
  fld('cat-manpower', 'dt-ses', 'QUANTITY', 'Accepted Manhours', 'NUMBER', true),

  ...invoiceHeaderFields('cat-catering', true),
  fld('cat-catering', 'dt-po', 'PO_NUMBER', 'PO Number', 'CODE', true, { sapMapped: true }),
  fld('cat-catering', 'dt-meal', 'MEAL_COUNT', 'Billed Meal Count', 'NUMBER', true),
  fld('cat-catering', 'dt-meal', 'UNIT_RATE', 'Rate per Meal', 'CURRENCY', true),
  fld('cat-catering', 'dt-meal', 'PERIOD_FROM', 'Period From', 'DATE', false),
  fld('cat-catering', 'dt-meal', 'PERIOD_TO', 'Period To', 'DATE', false),

  ...invoiceHeaderFields('cat-nonpo', false),
  fld('cat-nonpo', 'dt-invoice', 'COST_CENTER', 'Cost Centre', 'TEXT', true),
];

// ---------------- prompts & profiles ----------------
const prompt = (id: string, documentTypeId: string, name: string, focus: string): PromptTemplate => ({
  id, documentTypeId, name, version: 'v1.2', status: 'ACTIVE',
  systemInstruction:
    'You are an accounts payable document extraction engine for ESSA. Extract only the requested fields from the supplied document. Return strictly valid JSON conforming to the provided schema. Never invent values - use null when a field is not present. Provide a confidence score (0-1) and page reference for every field.',
  extractionInstruction: `Extract the configured ${focus} fields. Normalise dates to ISO-8601 (YYYY-MM-DD), amounts to plain decimal numbers without thousand separators, and codes to uppercase. Quote the source text region as evidence for each field.`,
  outputSchema: {
    type: 'object',
    properties: { fields: { type: 'array', items: { type: 'object', properties: { fieldCode: { type: 'string' }, value: {}, confidence: { type: 'number' }, page: { type: 'integer' }, evidence: { type: 'string' } }, required: ['fieldCode', 'value', 'confidence', 'page'] } } },
    required: ['fields'],
  },
  confidenceThreshold: 0.7,
  effectiveDate: '2026-05-01',
  testSampleCount: 6,
  createdBy: 'Surya Nugraha',
  createdAt: isoAgo(120 * DAY),
});

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  prompt('pt-invoice', 'dt-invoice', 'Invoice header extraction', 'invoice header'),
  prompt('pt-po', 'dt-po', 'PO reference extraction', 'purchase order reference'),
  prompt('pt-grn', 'dt-grn', 'GRN extraction', 'goods receipt'),
  prompt('pt-ses', 'dt-ses', 'SES extraction', 'service entry sheet'),
  prompt('pt-timesheet', 'dt-timesheet', 'Timesheet extraction', 'timesheet'),
  prompt('pt-manhour', 'dt-manhour', 'Manhour summary extraction', 'manhour summary'),
  prompt('pt-meal', 'dt-meal', 'Meal summary extraction', 'meal summary'),
];

export const EXTRACTION_PROFILES: ExtractionProfile[] = PROMPT_TEMPLATES.map((p, i) => ({
  id: `xp-${i + 1}`,
  documentTypeId: p.documentTypeId,
  engine: 'AZURE_OPENAI_GPT',
  modelDeployment: 'essa-gpt4o-prod',
  promptTemplateId: p.id,
  reviewThreshold: 0.7,
  version: 'v1.2',
  status: 'ACTIVE',
}));

// ---------------- SAP field mappings ----------------
let mapSeq = 0;
const map = (categoryId: string, documentTypeId: string, fieldCode: string, fieldLabel: string, sapField: string, sapDescription: string, matchType: FieldMapping['matchType'], toleranceRule: string, mandatory = true): FieldMapping => ({
  id: `map-${++mapSeq}`,
  configVersionId: 'cfg-1',
  categoryId, documentTypeId, fieldCode, fieldLabel, sapField, sapDescription, matchType, toleranceRule, mandatory,
  status: 'ACTIVE',
});

export const FIELD_MAPPINGS: FieldMapping[] = [
  ...['cat-material', 'cat-service', 'cat-manpower', 'cat-catering'].flatMap((cat) => [
    map(cat, 'dt-invoice', 'INVOICE_NUMBER', 'Invoice Number', 'BKPF-XBLNR', 'Reference Document', 'EXACT_MATCH', 'Exact'),
    map(cat, 'dt-invoice', 'INVOICE_DATE', 'Invoice Date', 'BSEG-BLDAT', 'Document Date', 'DATE_MATCH', '+/- 3 days'),
    map(cat, 'dt-invoice', 'VENDOR_CODE', 'Vendor Code', 'LFA1-LIFNR', 'Vendor Code', 'EXACT_MATCH', 'Exact'),
    map(cat, 'dt-invoice', 'VENDOR_NAME', 'Vendor Name', 'LFA1-NAME1', 'Vendor Name', 'EXACT_MATCH', 'Exact'),
    map(cat, 'dt-invoice', 'PO_NUMBER', 'PO Number', 'EKPO-EBELN', 'Purchase Order Number', 'EXACT_MATCH', 'Exact'),
    map(cat, 'dt-invoice', 'INVOICE_AMOUNT', 'Invoice Amount', 'BSEG-WRBTR', 'Amount in Doc. Currency', 'AMOUNT_MATCH', 'Diff <= 2%'),
    map(cat, 'dt-invoice', 'INVOICE_SUBTOTAL', 'Invoice Subtotal', 'BSEG-NETWR', 'Net Value', 'AMOUNT_MATCH', 'Diff <= 2%'),
    map(cat, 'dt-invoice', 'CURRENCY', 'Currency', 'BKPF-WAERS', 'Currency Key', 'LIST_MATCH', 'IDR | USD'),
  ]),
  map('cat-material', 'dt-grn', 'GRN_NUMBER', 'GRN Number', 'MSEG-MBLNR', 'Material Document', 'EXACT_MATCH', 'Exact', false),
  map('cat-service', 'dt-ses', 'SES_NUMBER', 'SES Number', 'ESSR-LBLNI', 'Service Entry Sheet', 'EXACT_MATCH', 'Exact', false),
  map('cat-manpower', 'dt-manhour', 'TOTAL_HOURS', 'Total Manhours', 'ZESSA-TOT_HRS', 'Total Manhours', 'AMOUNT_MATCH', 'Exact', false),
  map('cat-nonpo', 'dt-invoice', 'INVOICE_NUMBER', 'Invoice Number', 'BKPF-XBLNR', 'Reference Document', 'EXACT_MATCH', 'Exact'),
  map('cat-nonpo', 'dt-invoice', 'INVOICE_AMOUNT', 'Invoice Amount', 'BSEG-WRBTR', 'Amount in Doc. Currency', 'AMOUNT_MATCH', 'Diff <= 2%'),
];

// ---------------- validation rules ----------------
interface RuleSpec {
  rule: Omit<ValidationRule, 'configVersionId' | 'version' | 'status'>;
  operands: Omit<RuleOperand, 'ruleId'>[];
}

let opSeq = 0;
const op = (alias: string, label: string, sourceType: RuleOperand['sourceType'], extra: Partial<RuleOperand> = {}): Omit<RuleOperand, 'ruleId'> => ({
  id: `rop-${++opSeq}`, alias, label, sourceType, sequence: extra.sequence ?? 0,
  documentTypeCode: extra.documentTypeCode, fieldCode: extra.fieldCode,
  sapEntity: extra.sapEntity, sapField: extra.sapField,
  aggregation: extra.aggregation, constantValue: extra.constantValue,
});

const RULE_SPECS: RuleSpec[] = [
  // ---- Global ----
  {
    rule: { id: 'rule-glb-001', ruleCode: 'R-GLB-001', ruleName: 'Invoice number present', description: 'Every invoice must carry a vendor invoice number.', scope: 'GLOBAL', ruleType: 'PRESENCE', severity: 'HARD_FAIL', blocking: true, overrideAllowed: false, priority: 10 },
    operands: [op('A', 'Invoice Number', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_NUMBER', sequence: 1 })],
  },
  {
    rule: { id: 'rule-glb-002', ruleCode: 'R-GLB-002', ruleName: 'Invoice date present', description: 'Invoice date must be extracted or corrected.', scope: 'GLOBAL', ruleType: 'PRESENCE', severity: 'ERROR', blocking: true, overrideAllowed: false, priority: 11 },
    operands: [op('A', 'Invoice Date', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_DATE', sequence: 1 })],
  },
  {
    rule: { id: 'rule-glb-003', ruleCode: 'R-GLB-003', ruleName: 'Vendor matches SAP master', description: 'Extracted vendor code must exactly match the SAP vendor master snapshot.', scope: 'GLOBAL', ruleType: 'EXACT_MATCH', severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 12 },
    operands: [
      op('A', 'Invoice Vendor Code', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'VENDOR_CODE', sequence: 1 }),
      op('B', 'SAP Vendor Code', 'SAP', { sapEntity: 'VENDOR', sapField: 'CODE', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-glb-004', ruleCode: 'R-GLB-004', ruleName: 'Currency in allowed list', description: 'Invoice currency must be an approved transaction currency.', scope: 'GLOBAL', ruleType: 'LIST_MEMBERSHIP', severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 13 },
    operands: [
      op('A', 'Invoice Currency', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'CURRENCY', sequence: 1 }),
      op('B', 'Allowed currencies', 'CONFIG', { constantValue: 'IDR|USD', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-glb-005', ruleCode: 'R-GLB-005', ruleName: 'Totals arithmetic (subtotal + tax = total)', description: 'Invoice amount must equal subtotal plus tax within 0.5%.', scope: 'GLOBAL', ruleType: 'CUSTOM', handlerKey: 'TOTALS_ARITHMETIC', handlerParams: { tolerancePct: 0.5 }, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 14 },
    operands: [
      op('TOTAL', 'Invoice Amount', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_AMOUNT', sequence: 1 }),
      op('SUBTOTAL', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 2 }),
      op('TAX', 'Tax Amount', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'TAX_AMOUNT', sequence: 3 }),
    ],
  },
  {
    rule: { id: 'rule-glb-006', ruleCode: 'R-GLB-006', ruleName: 'Vendor not negative-flagged', description: 'Invoices from negative-flagged vendors are blocked for AP review.', scope: 'GLOBAL', ruleType: 'CUSTOM', handlerKey: 'VENDOR_NOT_NEGATIVE', severity: 'HARD_FAIL', blocking: true, overrideAllowed: false, priority: 5 },
    operands: [],
  },
  // ---- Material ----
  {
    rule: { id: 'rule-mat-001', ruleCode: 'R-MAT-001', ruleName: 'PO number present', description: 'Material invoices must reference a purchase order.', scope: 'CATEGORY', categoryId: 'cat-material', ruleType: 'PRESENCE', severity: 'HARD_FAIL', blocking: true, overrideAllowed: false, priority: 20 },
    operands: [op('A', 'PO Number', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'PO_NUMBER', sequence: 1 })],
  },
  {
    rule: { id: 'rule-mat-002', ruleCode: 'R-MAT-002', ruleName: 'PO exists in SAP', description: 'Referenced PO must exist in the SAP reference data.', scope: 'CATEGORY', categoryId: 'cat-material', ruleType: 'EXACT_MATCH', severity: 'ERROR', blocking: true, overrideAllowed: false, priority: 21 },
    operands: [
      op('A', 'Invoice PO Number', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'PO_NUMBER', sequence: 1 }),
      op('B', 'SAP PO Number', 'SAP', { sapEntity: 'PO', sapField: 'PO_NUMBER', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-mat-003', ruleCode: 'R-MAT-003', ruleName: 'PO vendor matches invoice vendor', description: 'The PO vendor and invoice vendor must be identical.', scope: 'CATEGORY', categoryId: 'cat-material', ruleType: 'EXACT_MATCH', severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 22 },
    operands: [
      op('A', 'Invoice Vendor', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'VENDOR_CODE', sequence: 1 }),
      op('B', 'PO Vendor', 'SAP', { sapEntity: 'PO', sapField: 'VENDOR_CODE', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-mat-004', ruleCode: 'R-MAT-004', ruleName: 'Invoice within PO open value', description: 'Invoice subtotal must not exceed the open (un-invoiced) PO value.', scope: 'CATEGORY', categoryId: 'cat-material', ruleType: 'AMOUNT_TOLERANCE', comparator: 'LEFT_LTE_RIGHT', toleranceType: 'PERCENT', toleranceValue: 0, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 23 },
    operands: [
      op('A', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 1 }),
      op('B', 'PO Open Amount', 'SAP', { sapEntity: 'PO', sapField: 'OPEN_AMOUNT', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-mat-005', ruleCode: 'R-MAT-005', ruleName: '3-way match: Invoice = PO = GRN', description: 'Invoice subtotal, matched PO receipt value and GRN value must reconcile within 2%.', scope: 'CROSS_DOCUMENT', categoryId: 'cat-material', ruleType: 'N_WAY', comparator: 'DIFF_WITHIN_TOLERANCE', toleranceType: 'PERCENT', toleranceValue: 2, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 24 },
    operands: [
      op('A', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 1 }),
      op('B', 'GRN Value (SUM)', 'SAP', { sapEntity: 'GRN', sapField: 'AMOUNT', aggregation: 'SUM', sequence: 2 }),
    ],
  },
  // ---- Service ----
  {
    rule: { id: 'rule-srv-001', ruleCode: 'R-SRV-001', ruleName: '3-way match: Invoice = PO = SES', description: 'Invoice subtotal must reconcile with accepted SES value within 2%.', scope: 'CROSS_DOCUMENT', categoryId: 'cat-service', ruleType: 'N_WAY', comparator: 'DIFF_WITHIN_TOLERANCE', toleranceType: 'PERCENT', toleranceValue: 2, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 30 },
    operands: [
      op('A', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 1 }),
      op('B', 'SES Accepted Value (SUM)', 'SAP', { sapEntity: 'SES', sapField: 'AMOUNT', aggregation: 'SUM', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-srv-002', ruleCode: 'R-SRV-002', ruleName: 'Invoice within PO open value', description: 'Service invoice subtotal must not exceed open PO value.', scope: 'CATEGORY', categoryId: 'cat-service', ruleType: 'AMOUNT_TOLERANCE', comparator: 'LEFT_LTE_RIGHT', toleranceType: 'PERCENT', toleranceValue: 0, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 31 },
    operands: [
      op('A', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 1 }),
      op('B', 'PO Open Amount', 'SAP', { sapEntity: 'PO', sapField: 'OPEN_AMOUNT', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-srv-003', ruleCode: 'R-SRV-003', ruleName: 'SES posted within invoice period', description: 'SES posting date should fall within 30 days of the invoice date.', scope: 'CATEGORY', categoryId: 'cat-service', ruleType: 'DATE_TOLERANCE', toleranceType: 'DAYS', toleranceValue: 30, severity: 'WARNING', blocking: false, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 32 },
    operands: [
      op('A', 'Invoice Date', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_DATE', sequence: 1 }),
      op('B', 'SES Period To', 'DOCUMENT_FIELD', { documentTypeCode: 'SES', fieldCode: 'PERIOD_TO', sequence: 2 }),
    ],
  },
  // ---- Manpower ----
  {
    rule: { id: 'rule-mnp-001', ruleCode: 'R-MNP-001', ruleName: '4-way manhours: Timesheet = Summary = SES = Biometric', description: 'Timesheet hours, manhour summary, SES accepted manhours and biometric attendance hours must reconcile within 1%.', scope: 'CROSS_DOCUMENT', categoryId: 'cat-manpower', ruleType: 'N_WAY', comparator: 'DIFF_WITHIN_TOLERANCE', toleranceType: 'PERCENT', toleranceValue: 1, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 40 },
    operands: [
      op('A', 'Timesheet Hours', 'DOCUMENT_FIELD', { documentTypeCode: 'TIMESHEET', fieldCode: 'TOTAL_HOURS', sequence: 1 }),
      op('B', 'Manhour Summary Hours', 'DOCUMENT_FIELD', { documentTypeCode: 'MANHOUR_SUMMARY', fieldCode: 'TOTAL_HOURS', sequence: 2 }),
      op('C', 'SES Accepted Manhours', 'DOCUMENT_FIELD', { documentTypeCode: 'SES', fieldCode: 'QUANTITY', sequence: 3 }),
      op('D', 'Biometric Attendance Hours (SUM)', 'BIOMETRIC', { aggregation: 'SUM', sequence: 4 }),
    ],
  },
  {
    rule: { id: 'rule-mnp-002', ruleCode: 'R-MNP-002', ruleName: 'Overtime within cap', description: 'Overtime hours must not exceed 20% of regular hours (contract cap).', scope: 'CATEGORY', categoryId: 'cat-manpower', ruleType: 'CUSTOM', handlerKey: 'MANPOWER_OT_CAP', handlerParams: { capPct: 20 }, severity: 'WARNING', blocking: false, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 41 },
    operands: [
      op('REGULAR_HOURS', 'Regular Hours', 'DOCUMENT_FIELD', { documentTypeCode: 'MANHOUR_SUMMARY', fieldCode: 'TOTAL_HOURS', sequence: 1 }),
      op('OT_HOURS', 'Overtime Hours', 'DOCUMENT_FIELD', { documentTypeCode: 'MANHOUR_SUMMARY', fieldCode: 'OT_HOURS', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-mnp-003', ruleCode: 'R-MNP-003', ruleName: 'Invoice within PO open value', description: 'Manpower invoice subtotal must not exceed open PO value.', scope: 'CATEGORY', categoryId: 'cat-manpower', ruleType: 'AMOUNT_TOLERANCE', comparator: 'LEFT_LTE_RIGHT', toleranceType: 'PERCENT', toleranceValue: 0, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 42 },
    operands: [
      op('A', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 1 }),
      op('B', 'PO Open Amount', 'SAP', { sapEntity: 'PO', sapField: 'OPEN_AMOUNT', sequence: 2 }),
    ],
  },
  // ---- Catering ----
  {
    rule: { id: 'rule-cat-001', ruleCode: 'R-CAT-001', ruleName: 'Billed meals within biometric eligibility', description: 'Billed meal count must not exceed biometric-eligible headcount plus 5% guest allowance.', scope: 'CROSS_DOCUMENT', categoryId: 'cat-catering', ruleType: 'CUSTOM', handlerKey: 'CATERING_MEAL_ELIGIBILITY', handlerParams: { guestAllowancePct: 5 }, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 50 },
    operands: [
      op('BILLED_MEALS', 'Billed Meal Count', 'DOCUMENT_FIELD', { documentTypeCode: 'MEAL_SUMMARY', fieldCode: 'MEAL_COUNT', sequence: 1 }),
      op('ELIGIBLE_MEALS', 'Biometric Eligible Meals', 'BIOMETRIC', { fieldCode: 'MEAL_COUNT', aggregation: 'SUM', sequence: 2 }),
    ],
  },
  {
    rule: { id: 'rule-cat-002', ruleCode: 'R-CAT-002', ruleName: 'Meal arithmetic: count × rate = subtotal', description: 'Billed meal count multiplied by the contract rate must equal the invoice subtotal within 1%.', scope: 'CROSS_DOCUMENT', categoryId: 'cat-catering', ruleType: 'CUSTOM', handlerKey: 'MEAL_ARITHMETIC', handlerParams: { tolerancePct: 1 }, severity: 'ERROR', blocking: true, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 51 },
    operands: [
      op('MEALS', 'Billed Meal Count', 'DOCUMENT_FIELD', { documentTypeCode: 'MEAL_SUMMARY', fieldCode: 'MEAL_COUNT', sequence: 1 }),
      op('RATE', 'Rate per Meal', 'DOCUMENT_FIELD', { documentTypeCode: 'MEAL_SUMMARY', fieldCode: 'UNIT_RATE', sequence: 2 }),
      op('SUBTOTAL', 'Invoice Subtotal', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_SUBTOTAL', sequence: 3 }),
    ],
  },
  // ---- Non-PO ----
  {
    rule: { id: 'rule-npo-001', ruleCode: 'R-NPO-001', ruleName: 'HCIS clearing reference captured', description: 'Non-PO invoices must carry the HCIS clearing reference so the approval hierarchy can route them.', scope: 'CATEGORY', categoryId: 'cat-nonpo', ruleType: 'PRESENCE', severity: 'ERROR', blocking: true, overrideAllowed: false, priority: 60 },
    operands: [op('A', 'Cost Centre', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'COST_CENTER', sequence: 1 })],
  },
  {
    rule: { id: 'rule-npo-002', ruleCode: 'R-NPO-002', ruleName: 'Non-PO amount within policy limit', description: 'Non-PO invoices above IDR 2,500,000 require special procurement approval.', scope: 'CATEGORY', categoryId: 'cat-nonpo', ruleType: 'RANGE', severity: 'WARNING', blocking: false, overrideAllowed: true, overrideRole: 'AP_REVIEWER', priority: 61 },
    operands: [
      op('A', 'Invoice Amount', 'DOCUMENT_FIELD', { documentTypeCode: 'INVOICE', fieldCode: 'INVOICE_AMOUNT', sequence: 1 }),
      op('MIN', 'Minimum', 'CONFIG', { constantValue: 0, sequence: 2 }),
      op('MAX', 'Policy Limit', 'CONFIG', { constantValue: 2500000, sequence: 3 }),
    ],
  },
];

export const VALIDATION_RULES: ValidationRule[] = RULE_SPECS.map((s) => ({
  ...s.rule,
  configVersionId: 'cfg-1',
  version: 'v1.0',
  status: 'ACTIVE',
}));

export const RULE_OPERANDS: RuleOperand[] = RULE_SPECS.flatMap((s) =>
  s.operands.map((o) => ({ ...o, ruleId: s.rule.id }))
);

// ---------------- workflows ----------------
export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: 'wf-po', configVersionId: 'cfg-1', code: 'WF-PO-STD', name: 'PO Invoice Approval', version: 'v1.0',
    description: 'PO based: AP review, finance exception approval where needed, tax review for service invoices, then SAP parking.',
    status: 'ACTIVE',
    steps: [
      { stepNo: 1, name: 'AP Review', role: 'AP_REVIEWER', approverType: 'ROLE', slaHours: 24, notify: true },
      { stepNo: 2, name: 'Finance Exception Approval', role: 'AP_REVIEWER', approverType: 'ROLE', slaHours: 48, notify: true, escalationTo: 'AP_REVIEWER' },
      { stepNo: 3, name: 'Tax Review', role: 'TAX_REVIEWER', approverType: 'ROLE', taxStep: true, slaHours: 24, notify: true },
      { stepNo: 4, name: 'Final Approval', role: 'AP_REVIEWER', approverType: 'ROLE', amountThresholdMin: 2_500_000, slaHours: 24, notify: true },
    ],
  },
  {
    id: 'wf-nonpo', configVersionId: 'cfg-1', code: 'WF-NONPO', name: 'Non-PO Invoice Approval', version: 'v1.0',
    description: 'Non-PO: AP review, then the amount-based approval hierarchy, tax review for service invoices, and a final approval.',
    status: 'ACTIVE', categoryId: 'cat-nonpo',
    steps: [
      { stepNo: 1, name: 'AP Review', role: 'AP_REVIEWER', approverType: 'ROLE', slaHours: 24, notify: true },
      { stepNo: 2, name: 'Approval Hierarchy', role: 'AP_REVIEWER', approverType: 'DOA', slaHours: 48, notify: true, escalationTo: 'AP_REVIEWER' },
      { stepNo: 3, name: 'Tax Review', role: 'TAX_REVIEWER', approverType: 'ROLE', taxStep: true, slaHours: 24, notify: true },
      { stepNo: 4, name: 'Final Approval', role: 'AP_REVIEWER', approverType: 'ROLE', amountThresholdMin: 1_000_000, slaHours: 24, notify: true },
    ],
  },
];

export const NOTIFICATION_RULES: NotificationRule[] = [
  { id: 'nr-1', configVersionId: 'cfg-1', event: 'INVOICE_RECEIVED', label: 'Invoice received', channels: ['IN_APP'], recipients: 'AP Team', template: 'Invoice {invoiceNumber} received from {vendor} via {source}.', active: true },
  { id: 'nr-2', configVersionId: 'cfg-1', event: 'EXCEPTION_CREATED', label: 'Exception created', channels: ['IN_APP', 'EMAIL'], recipients: 'AP Team', template: 'Exception {code} raised on {invoiceNumber}: {title}.', active: true },
  { id: 'nr-3', configVersionId: 'cfg-1', event: 'APPROVAL_REQUESTED', label: 'Approval requested', channels: ['IN_APP', 'TEAMS', 'EMAIL'], recipients: 'Current approver', template: 'Approval requested for {invoiceNumber} ({amount}).', active: true },
  { id: 'nr-4', configVersionId: 'cfg-1', event: 'APPROVAL_OVERDUE', label: 'Approval overdue', channels: ['IN_APP', 'TEAMS'], recipients: 'Approver + escalation', template: 'Approval for {invoiceNumber} is overdue (SLA {sla}h).', active: true },
  { id: 'nr-5', configVersionId: 'cfg-1', event: 'INVOICE_APPROVED', label: 'Invoice approved', channels: ['IN_APP'], recipients: 'AP Team', template: '{invoiceNumber} fully approved and queued for SAP handoff.', active: true },
  { id: 'nr-6', configVersionId: 'cfg-1', event: 'INVOICE_REJECTED', label: 'Invoice rejected', channels: ['IN_APP', 'EMAIL'], recipients: 'AP Team + requester', template: '{invoiceNumber} rejected at {step}: {reason}.', active: true },
  { id: 'nr-7', configVersionId: 'cfg-1', event: 'SAP_FAILURE', label: 'SAP integration failure', channels: ['IN_APP', 'EMAIL'], recipients: 'Support + AP Supervisor', template: 'SAP handoff for {invoiceNumber} failed: {error}.', active: true },
  { id: 'nr-8', configVersionId: 'cfg-1', event: 'SAP_POSTED', label: 'Invoice posted', channels: ['IN_APP'], recipients: 'AP Team', template: '{invoiceNumber} posted in SAP as {sapDocumentNo}.', active: true },
  { id: 'nr-9', configVersionId: 'cfg-1', event: 'INVOICE_PAID', label: 'Invoice paid', channels: ['IN_APP', 'EMAIL'], recipients: 'Vendor communication queue', template: 'Payment released for {invoiceNumber} ({paymentRef}).', active: true },
  { id: 'nr-10', configVersionId: 'cfg-1', event: 'CONFIG_PUBLISHED', label: 'Configuration published', channels: ['IN_APP', 'EMAIL'], recipients: 'Administrators + AP Supervisor', template: 'Configuration {version} published, effective {effectiveFrom}.', active: true },
];
