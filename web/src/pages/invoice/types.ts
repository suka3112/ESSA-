export interface InvoiceDetail {
  invoice: {
    id: string; invoiceNumber: string; vendorCode: string; vendorName: string; categoryId: string; categoryName?: string;
    invoiceDate: string; receivedAt: string; amount: number; subtotal: number; taxAmount: number; currency: string;
    poNumber?: string; department: string; companyCode: string; source: string; stage: string; lifecycle: string;
    processingFlag: string | null; slaDueAt: string; slaBreached: boolean; assignedTo?: string; assignedToName?: string;
    priority: string; configVersionId: string; correlationId: string; description: string; sapDocumentNo?: string;
    paymentStatus?: string; paymentDate?: string; paymentRef?: string; taxReviewRequired: boolean; extractionConfidence?: number;
  };
  vendor?: { code: string; name: string; city: string; gstin: string; paymentTerms: string; sapStatus: string };
  vendorControl?: { negativeFlag: boolean; apEnabled: boolean; reason?: string };
  lines: { id: string; lineNo: number; description: string; quantity: number; uom: string; unitPrice: number; amount: number; poItem?: string }[];
  documents: DocumentRow[];
  completeness: CompletenessRow[];
  extractionRuns: { id: string; documentId: string; documentTypeId: string; profileVersion: string; promptVersion: string; modelDeployment: string; status: string; startedAt: string; durationMs?: number; tokensIn?: number; tokensOut?: number; fieldCount: number; lowConfidenceCount: number }[];
  extractedFields: FieldRow[];
  validationRuns: ValidationRunRow[];
  validationResults: ValidationResultRow[];
  mappingEvaluation: MappingRow[];
  exceptions: ExceptionRow[];
  workflow: { instance: { id: string; definitionName: string; status: string; currentStepNo: number; startedAt: string; completedAt?: string }; steps: StepRow[] } | null;
  sapHandoffs: { id: string; status: string; attempts: number; createdAt: string; lastAttemptAt?: string; sapDocumentNo?: string; message?: string; errorCode?: string; idempotencyKey: string; correlationId: string }[];
  sapReference: {
    po?: { poNumber: string; vendorCode: string; vendorName: string; totalAmount: number; openAmount: number; currency: string; validTo: string; status: string; items: { item: string; description: string; quantity: number; uom: string; unitPrice: number; amount: number }[] };
    grns: { grnNumber: string; postingDate: string; amount: number; totalQuantity: number }[];
    ses: { sesNumber: string; postingDate: string; serviceDescription: string; quantity: number; amount: number; status: string }[];
  };
  timeline: TimelineRow[];
  auditEvents: AuditRow[];
}

export interface DocumentRow {
  id: string; documentTypeId: string; fileName: string; pages: number; sizeKb: number; source: string;
  sharePointUrl: string; checksum: string; status: string; extractionStatus: string; requirementType: string;
  checkMode: string; version: number; uploadedBy: string; uploadedAt: string;
  documentType?: { id: string; code: string; name: string; purpose: string };
}

export interface CompletenessRow {
  id: string; documentTypeId: string; requirementType: string; checkMode: string; blocking: boolean;
  allowMultiple: boolean; available: boolean; applicable: boolean; contentCheckRequired: boolean; availabilityCheckRequired: boolean;
  documentType?: { id: string; code: string; name: string; purpose: string };
  condition?: string;
}

export interface FieldRow {
  id: string; documentId: string; documentTypeId: string; documentTypeCode?: string; fieldCode: string; label: string;
  dataType: string; rawValue: string; value: string; confidence: number; confidenceBand: string; page: number;
  evidence: string; validationStatus: string; mandatory: boolean;
  corrections: { previousValue: string; newValue: string; correctedByName: string; reason: string; correctedAt: string }[];
}

export interface MappingRow {
  id: string;
  documentTypeName: string;
  fieldCode: string;
  fieldLabel: string;
  extractedValue: string | null;
  confidence?: number;
  sapField: string;
  sapDescription: string;
  matchType: string;
  toleranceRule: string;
  mandatory: boolean;
  referenceSource: string;
  referenceValue: string | number | null;
  differencePct?: number;
  result: 'MATCHED' | 'MISMATCH' | 'CAPTURED' | 'AWAITING_SAP' | 'NOT_EXTRACTED';
  note: string;
}

export interface ValidationRunRow {
  id: string; trigger: string; status: string; startedAt: string; startedBy: string; outcome: string;
  summary: { total: number; passed: number; warnings: number; failed: number; hardFailed: number; overridden: number; pending: number };
}

export interface ValidationResultRow {
  id: string; ruleCode: string; ruleName: string; ruleType: string; severity: string; blocking: boolean;
  overrideAllowed: boolean; result: string; expected: string; actual: string; tolerance: string; differencePct?: number;
  operandValues: { alias: string; label: string; source: string; value: string | number | null; detail?: string }[];
  message: string; ruleVersion: string;
  override?: { byName: string; role: string; reason: string; at: string; previousResult: string };
}

export interface ExceptionRow {
  id: string; code: string; type: string; severity: string; status: string; title: string; detail: string;
  ruleCode?: string; assignedTo?: string; assignedToName?: string; createdAt: string; slaDueAt: string;
  resolvedAt?: string; resolution?: string; technical: boolean; retryCount: number;
  actions: { at: string; byName: string; action: string; note?: string }[];
}

export interface StepRow {
  id: string; stepNo: number; name: string; role: string; assignedTo?: string; assignedToName?: string;
  status: string; dueAt?: string; actedByName?: string; actedAt?: string; comment?: string; channel?: string; delegatedTo?: string;
}

export interface TimelineRow {
  id: string; at: string; actorType: string; actorName: string; event: string; title: string; detail?: string;
  status: string; reference?: string; correlationId?: string;
}

export interface AuditRow {
  id: string; eventTime: string; actorName: string; actorRole?: string; eventType: string; category: string;
  action: string; entityType: string; entityRef?: string; result: string; reason?: string;
  oldValue?: unknown; newValue?: unknown; correlationId: string; source: string;
}
