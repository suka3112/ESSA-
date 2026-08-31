/**
 * Invoice processing orchestration.
 *
 * Implements the end-to-end lifecycle from the architecture (§8):
 * ingest -> classify -> completeness -> extract -> validate -> HITL ->
 * workflow -> SAP handoff -> track & close. Every stage writes append-only
 * audit events and structured technical logs sharing the same correlation ID.
 */
import type {
  AppUser,
  CategoryDocument,
  ExceptionRecord,
  ExceptionType,
  ExtractedField,
  Invoice,
  IngestSource,
  RuleResultOutcome,
  ValidationResult,
  ValidationRun,
  WorkflowStepInstance,
} from '../../core/types';
import { getDb, markDirty } from '../../core/store';
import { DAY, HOUR, ids, isoIn, nowIso } from '../../core/ids';
import { audit, systemAudit } from '../../core/audit';
import { techLog } from '../../core/logger';
import { enqueueJob, registerJobHandler } from '../../core/jobs';
import { evaluateInvoice, type ValidationContext } from '../rule-engine/engine';
import { mockExtractDocument } from '../../integrations/azure-gpt.mock';
import { SharePointMock } from '../../integrations/sharepoint.mock';
import { SapMock } from '../../integrations/sap.mock';
import { addTimeline, notifyRole, notifyUser, touchInvoice } from './helpers';
import { emailContent } from '../email/templates';

// ---------------------------------------------------------------- exceptions
export function createException(
  invoice: Invoice,
  type: ExceptionType,
  severity: ExceptionRecord['severity'],
  title: string,
  detail: string,
  opts: Partial<Pick<ExceptionRecord, 'ruleCode' | 'fieldCode' | 'documentTypeId' | 'technical' | 'slaDueAt'>> = {}
): ExceptionRecord {
  const db = getDb();
  // dedupe open exception of same type+rule+field for the invoice
  const existing = db.exceptions.find(
    (e) =>
      e.invoiceId === invoice.id &&
      e.type === type &&
      e.ruleCode === opts.ruleCode &&
      e.fieldCode === opts.fieldCode &&
      ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status)
  );
  if (existing) return existing;

  const exc: ExceptionRecord = {
    id: ids.generic('EXCID'),
    code: ids.exception(),
    invoiceId: invoice.id,
    type,
    severity,
    status: 'OPEN',
    title,
    detail,
    ruleCode: opts.ruleCode,
    fieldCode: opts.fieldCode,
    documentTypeId: opts.documentTypeId,
    createdAt: nowIso(),
    slaDueAt: opts.slaDueAt ?? isoIn(2 * DAY),
    retryCount: 0,
    technical: opts.technical ?? false,
    correlationId: invoice.correlationId,
    actions: [{ at: nowIso(), by: 'system', byName: 'AP Automation Engine', action: 'CREATED', note: title }],
  };
  db.exceptions.unshift(exc);
  markDirty();
  systemAudit({
    eventType: 'EXCEPTION_CREATED', category: 'EXCEPTION', action: 'CREATE',
    entityType: 'EXCEPTION', entityId: exc.code, invoiceId: invoice.id,
    entityRef: invoice.invoiceNumber, reason: title, correlationId: invoice.correlationId,
    module: 'exceptions', result: 'FAIL',
    details: [
      { label: 'Invoice', value: invoice.invoiceNumber },
      { label: 'Exception type', value: exc.type },
      { label: 'What happened', value: detail },
      ...(exc.ruleCode ? [{ label: 'Rule', value: exc.ruleCode }] : []),
    ],
  });
  addTimeline(invoice.id, 'EXCEPTION_CREATED', `Exception ${exc.code} created`, {
    detail: title, status: 'WARNING', reference: exc.code, correlationId: invoice.correlationId,
  });
  {
    // Content comes from the configurable EXCEPTION_CREATED email template.
    const msg = emailContent('EXCEPTION_CREATED', { exceptionCode: exc.code, exceptionTitle: title, invoiceNumber: invoice.invoiceNumber, detail });
    notifyRole('AP_PROCESSOR', 'EXCEPTION', msg.title, msg.body, { invoiceId: invoice.id });
  }
  return exc;
}

// ------------------------------------------------------------- completeness
export interface CompletenessRow {
  categoryDocument: CategoryDocument;
  documentTypeId: string;
  available: boolean;
  applicable: boolean;
}

/** Evaluate a conditional document requirement against the invoice. */
function conditionApplies(cd: CategoryDocument, invoice: Invoice): boolean {
  const db = getDb();
  const vendor = db.vendors.find((v) => v.code === invoice.vendorCode);
  const domestic = !vendor || vendor.country === 'Indonesia';
  switch (cd.conditionRule) {
    case 'DOMESTIC_VENDOR': return domestic;
    case 'FOREIGN_VENDOR': return !domestic;
    case 'PO_BASED': return Boolean(invoice.poNumber);
    default: return Boolean(invoice.poNumber);
  }
}

export function evaluateCompleteness(invoice: Invoice): { rows: CompletenessRow[]; missingBlocking: CompletenessRow[] } {
  const db = getDb();
  const catDocs = db.categoryDocuments.filter(
    (cd) => cd.configVersionId === invoice.configVersionId && cd.categoryId === invoice.categoryId && cd.active
  );
  const docs = db.invoiceDocuments.filter((d) => d.invoiceId === invoice.id && d.status === 'AVAILABLE');
  const rows: CompletenessRow[] = catDocs.map((cd) => {
    const available = docs.some((d) => d.documentTypeId === cd.documentTypeId);
    const applicable = cd.requirementType !== 'CONDITIONAL' || conditionApplies(cd, invoice);
    return { categoryDocument: cd, documentTypeId: cd.documentTypeId, available, applicable };
  });
  const missingBlocking = rows.filter(
    (r) => r.applicable && !r.available && r.categoryDocument.requirementType !== 'OPTIONAL' && r.categoryDocument.blocking
  );
  return { rows, missingBlocking };
}

export function runCompleteness(invoice: Invoice): boolean {
  const db = getDb();
  const { missingBlocking } = evaluateCompleteness(invoice);
  addTimeline(invoice.id, 'COMPLETENESS_CHECKED', 'Document completeness evaluated', {
    detail: missingBlocking.length
      ? `${missingBlocking.length} mandatory supporting document(s) missing`
      : 'All mandatory supporting documents available',
    status: missingBlocking.length ? 'WARNING' : 'SUCCESS',
    correlationId: invoice.correlationId,
  });
  if (missingBlocking.length) {
    invoice.stage = 'COMPLETENESS';
    invoice.lifecycle = 'DRAFT';
    invoice.processingFlag = 'MISSING_DOCUMENTS';
    missingBlocking.forEach((r) => {
      const dt = db.documentTypes.find((d) => d.id === r.documentTypeId);
      createException(
        invoice, 'MISSING_DOCUMENT', 'HIGH',
        `Missing mandatory supporting document: ${dt?.name ?? r.documentTypeId}`,
        `${dt?.name ?? 'Document'} is mandatory for this invoice category but was not found in the bundle. The invoice remains in Draft.`,
        { documentTypeId: r.documentTypeId }
      );
    });
    touchInvoice(invoice);
    return false;
  }
  return true;
}

// --------------------------------------------------------------- extraction
export function runExtraction(invoice: Invoice, opts: { degradeFieldCodes?: string[] } = {}): void {
  const db = getDb();
  const docs = db.invoiceDocuments.filter((d) => d.invoiceId === invoice.id && d.status === 'AVAILABLE');
  invoice.stage = 'EXTRACTION';
  let lowConfidenceTotal = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const doc of docs) {
    if (doc.checkMode === 'AVAILABILITY_ONLY') {
      doc.extractionStatus = 'NOT_REQUIRED';
      continue;
    }
    const docType = db.documentTypes.find((t) => t.id === doc.documentTypeId);
    const fields = db.documentFields.filter(
      (f) =>
        f.configVersionId === invoice.configVersionId &&
        f.categoryId === invoice.categoryId &&
        f.documentTypeId === doc.documentTypeId &&
        f.active &&
        f.extractionRequired
    );
    if (!fields.length) {
      doc.extractionStatus = 'NOT_REQUIRED';
      continue;
    }
    const profile = db.extractionProfiles.find((p) => p.documentTypeId === doc.documentTypeId && p.status === 'ACTIVE');
    const prompt = profile ? db.promptTemplates.find((p) => p.id === profile.promptTemplateId) : undefined;
    const result = mockExtractDocument(invoice, docType?.code ?? 'DOC', fields, { degradeFieldCodes: opts.degradeFieldCodes });

    const run = {
      id: ids.run(),
      invoiceId: invoice.id,
      documentId: doc.id,
      documentTypeId: doc.documentTypeId,
      profileVersion: profile?.version ?? 'v1.0',
      promptVersion: prompt?.version ?? 'v1.0',
      modelDeployment: profile?.modelDeployment ?? 'essa-gpt4o-prod',
      status: 'COMPLETED' as const,
      startedAt: nowIso(),
      completedAt: nowIso(),
      durationMs: result.durationMs,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      fieldCount: result.fields.length,
      lowConfidenceCount: 0,
      correlationId: invoice.correlationId,
    };

    // supersede previous fields for this document
    db.extractedFields = db.extractedFields.filter((f) => f.documentId !== doc.id);

    const threshold = profile?.reviewThreshold ?? 0.7;
    let low = 0;
    for (const f of result.fields) {
      const band = f.confidence >= 0.9 ? 'HIGH' : f.confidence >= threshold ? 'MEDIUM' : 'LOW';
      if (band === 'LOW') low += 1;
      confidenceSum += f.confidence;
      confidenceCount += 1;
      const ef: ExtractedField = {
        id: ids.generic('FLD'),
        invoiceId: invoice.id,
        documentId: doc.id,
        extractionRunId: run.id,
        documentTypeId: doc.documentTypeId,
        fieldCode: f.fieldCode,
        label: f.label,
        dataType: f.dataType,
        rawValue: f.value,
        value: f.value,
        confidence: f.confidence,
        confidenceBand: band,
        page: f.page,
        evidence: f.evidence,
        validationStatus: band === 'LOW' ? 'REVIEW' : 'PENDING',
        mandatory: f.mandatory,
        corrections: [],
      };
      db.extractedFields.push(ef);
    }
    run.lowConfidenceCount = low;
    lowConfidenceTotal += low;
    db.extractionRuns.unshift(run);
    doc.extractionStatus = low > 0 ? 'REVIEW' : 'COMPLETED';
    techLog({
      module: 'extraction', event: 'EXTRACTION_COMPLETED',
      message: `Extraction completed for ${docType?.code ?? doc.documentTypeId} (${result.fields.length} fields, ${low} low-confidence)`,
      correlationId: invoice.correlationId, invoiceId: invoice.id, integration: 'AZURE_OPENAI_GPT',
      durationMs: result.durationMs, status: 'SUCCESS',
    });
  }

  invoice.extractionConfidence = confidenceCount ? Math.round((confidenceSum / confidenceCount) * 1000) / 1000 : undefined;
  // The expanded record names which document, which stage, and which extraction
  // profile and prompt version produced the result (design reference, 24 Aug).
  const invoiceRuns = db.extractionRuns.filter((r) => r.invoiceId === invoice.id);
  // The vendor invoice is the document the record is about; the rest of the
  // bundle is summarised as a count rather than listed row by row.
  const primaryRun =
    invoiceRuns.find((r) => r.documentTypeId === 'dt-invoice') ?? invoiceRuns[invoiceRuns.length - 1];
  systemAudit({
    eventType: 'EXTRACTION_COMPLETED', category: 'EXTRACTION', action: 'EXTRACT',
    entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
    invoiceId: invoice.id, correlationId: invoice.correlationId, module: 'extraction',
    reason: 'Automatic extraction completed',
    details: [
      { label: 'Document', value: db.invoiceDocuments.find((d) => d.id === primaryRun?.documentId)?.fileName ?? '—' },
      { label: 'Documents read', value: String(invoiceRuns.length) },
      { label: 'Stage', value: 'EXTRACTION' },
      { label: 'Extraction profile', value: primaryRun?.profileVersion ?? '—' },
      { label: 'Prompt version', value: primaryRun?.promptVersion ?? '—' },
      { label: 'Average confidence', value: `${((invoice.extractionConfidence ?? 0) * 100).toFixed(1)}%` },
      { label: 'Fields needing review', value: String(lowConfidenceTotal) },
    ],
  });
  addTimeline(invoice.id, 'EXTRACTION_COMPLETED', 'AI extraction completed', {
    detail: `Average confidence ${(100 * (invoice.extractionConfidence ?? 0)).toFixed(1)}%${lowConfidenceTotal ? ` · ${lowConfidenceTotal} field(s) require review` : ''}`,
    status: lowConfidenceTotal ? 'WARNING' : 'SUCCESS',
    correlationId: invoice.correlationId,
  });

  if (lowConfidenceTotal > 0) {
    invoice.stage = 'EXTRACTION_REVIEW';
    invoice.processingFlag = 'EXTRACTION_REVIEW';
    createException(
      invoice, 'LOW_CONFIDENCE', 'MEDIUM',
      `${lowConfidenceTotal} extracted field(s) below confidence threshold`,
      'AI extraction returned low-confidence values that must be reviewed and accepted or corrected before validation can complete.',
    );
  }
  touchInvoice(invoice);
}

// --------------------------------------------------------------- validation
export function buildValidationContext(invoice: Invoice): ValidationContext {
  const db = getDb();
  const docs = db.invoiceDocuments.filter((d) => d.invoiceId === invoice.id && d.status === 'AVAILABLE');
  const codes = new Set<string>();
  docs.forEach((d) => {
    const t = db.documentTypes.find((x) => x.id === d.documentTypeId);
    if (t) codes.add(t.code);
  });
  return {
    invoice,
    fields: db.extractedFields.filter((f) => f.invoiceId === invoice.id),
    availableDocTypeCodes: codes,
  };
}

export function runValidation(
  invoice: Invoice,
  trigger: ValidationRun['trigger'],
  actor: { id: string; name: string } = { id: 'system', name: 'AP Automation Engine' }
): ValidationRun {
  const db = getDb();
  invoice.stage = 'VALIDATION';
  const ctx = buildValidationContext(invoice);
  const evaluations = evaluateInvoice(ctx);

  const run: ValidationRun = {
    id: ids.run(),
    invoiceId: invoice.id,
    configVersionId: invoice.configVersionId,
    trigger,
    status: 'COMPLETED',
    startedAt: nowIso(),
    completedAt: nowIso(),
    startedBy: actor.name,
    summary: { total: 0, passed: 0, warnings: 0, failed: 0, hardFailed: 0, overridden: 0, pending: 0 },
    outcome: 'PASS',
    correlationId: invoice.correlationId,
  };

  // carry forward overrides from the latest run
  const prevRun = db.validationRuns.filter((r) => r.invoiceId === invoice.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const prevResults = prevRun ? db.validationResults.filter((r) => r.runId === prevRun.id) : [];

  const results: ValidationResult[] = evaluations.map((ev) => {
    const prev = prevResults.find((p) => p.ruleCode === ev.rule.ruleCode);
    let result: RuleResultOutcome = ev.result;
    let override = undefined as ValidationResult['override'];
    if (prev?.override && (ev.result === 'FAIL' || ev.result === 'HARD_FAIL' || ev.result === 'WARNING')) {
      result = 'OVERRIDDEN';
      override = prev.override;
    }
    return {
      id: ids.generic('VRES'),
      runId: run.id,
      invoiceId: invoice.id,
      ruleId: ev.rule.id,
      ruleCode: ev.rule.ruleCode,
      ruleName: ev.rule.ruleName,
      ruleType: ev.rule.ruleType,
      severity: ev.rule.severity,
      blocking: ev.rule.blocking,
      overrideAllowed: ev.rule.overrideAllowed,
      result,
      expected: ev.expected,
      actual: ev.actual,
      tolerance: ev.tolerance,
      differencePct: ev.differencePct,
      operandValues: ev.operandValues,
      message: ev.message,
      ruleVersion: ev.rule.version,
      override,
    };
  });

  for (const r of results) {
    if (r.result === 'SKIPPED') continue;
    run.summary.total += 1;
    if (r.result === 'PASS') run.summary.passed += 1;
    else if (r.result === 'WARNING') run.summary.warnings += 1;
    else if (r.result === 'FAIL') run.summary.failed += 1;
    else if (r.result === 'HARD_FAIL') run.summary.hardFailed += 1;
    else if (r.result === 'OVERRIDDEN') run.summary.overridden += 1;
    else if (r.result === 'PENDING') run.summary.pending += 1;
  }

  const blockingFailures = results.filter(
    (r) => (r.result === 'FAIL' || r.result === 'HARD_FAIL') && r.blocking
  );
  const pendingBlocking = results.filter((r) => r.result === 'PENDING' && r.blocking);
  run.outcome = blockingFailures.length ? 'FAIL' : pendingBlocking.length ? 'PENDING' : 'PASS';

  db.validationRuns.unshift(run);
  db.validationResults.push(...results);
  markDirty();

  audit({
    actorType: actor.id === 'system' ? 'SYSTEM' : 'USER',
    actorId: actor.id, actorName: actor.name,
    eventType: 'VALIDATION_COMPLETED', category: 'VALIDATION',
    action: trigger === 'REVALIDATION' ? 'REVALIDATE' : 'VALIDATE',
    module: 'rule-engine',
    entityType: 'VALIDATION', entityId: run.id,
    entityRef: invoice.invoiceNumber, invoiceId: invoice.id,
    result: run.outcome === 'PASS' ? 'PASS' : 'FAIL',
    reason: `${run.summary.passed} of ${run.summary.total} checks passed`,
    details: [
      { label: 'Invoice', value: invoice.invoiceNumber },
      { label: 'Checks run', value: String(run.summary.total) },
      { label: 'Passed', value: String(run.summary.passed) },
      { label: 'Failed', value: String(run.summary.failed + run.summary.hardFailed) },
      { label: 'Warnings', value: String(run.summary.warnings) },
    ],
    correlationId: invoice.correlationId,
    source: 'BACKEND',
  });
  addTimeline(invoice.id, 'VALIDATION_COMPLETED', `Validation ${run.outcome === 'PASS' ? 'passed' : run.outcome === 'FAIL' ? 'failed' : 'pending reference data'}`, {
    detail: `${run.summary.passed}/${run.summary.total} passed · ${run.summary.failed + run.summary.hardFailed} failed · ${run.summary.warnings} warnings${run.summary.overridden ? ` · ${run.summary.overridden} overridden` : ''}`,
    status: run.outcome === 'PASS' ? 'SUCCESS' : run.outcome === 'FAIL' ? 'ERROR' : 'WARNING',
    reference: run.id,
    correlationId: invoice.correlationId,
    actorType: actor.id === 'system' ? 'SYSTEM' : 'USER',
    actorName: actor.name,
  });

  if (run.outcome === 'FAIL') {
    invoice.stage = 'EXCEPTION';
    invoice.lifecycle = 'DRAFT';
    invoice.processingFlag = 'VALIDATION_FAILED';
    blockingFailures.forEach((r) => {
      createException(
        invoice, 'VALIDATION_FAILURE', r.severity === 'HARD_FAIL' ? 'CRITICAL' : 'HIGH',
        `${r.ruleCode} failed: ${r.ruleName}`,
        r.message,
        { ruleCode: r.ruleCode }
      );
    });
  } else if (run.outcome === 'PENDING') {
    invoice.processingFlag = 'SAP_PENDING';
  } else {
    invoice.processingFlag = null;
    // resolve open validation exceptions
    db.exceptions
      .filter((e) => e.invoiceId === invoice.id && e.type === 'VALIDATION_FAILURE' && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(e.status))
      .forEach((e) => {
        e.status = 'RESOLVED';
        e.resolvedAt = nowIso();
        e.resolution = 'Validation passed on revalidation';
        e.actions.push({ at: nowIso(), by: 'system', byName: 'AP Automation Engine', action: 'AUTO_RESOLVED', note: 'Rule passed in latest validation run' });
      });
  }
  touchInvoice(invoice);
  return run;
}

// ----------------------------------------------------------------- workflow
export function startWorkflow(invoice: Invoice): void {
  const db = getDb();
  const existing = db.workflowInstances.find((w) => w.invoiceId === invoice.id && w.status === 'RUNNING');
  if (existing) return;

  const def =
    db.workflowDefinitions.find((w) => w.status === 'ACTIVE' && w.categoryId === invoice.categoryId) ??
    db.workflowDefinitions.find((w) => w.status === 'ACTIVE' && !w.categoryId);
  if (!def) return;

  const instance = {
    id: ids.generic('WFI'),
    invoiceId: invoice.id,
    definitionId: def.id,
    definitionName: def.name,
    status: 'RUNNING' as const,
    currentStepNo: 0,
    startedAt: nowIso(),
  };
  db.workflowInstances.unshift(instance);

  const applicable = def.steps
    .filter((s) => {
      if (s.amountThresholdMin != null && (invoice.amountIdr ?? invoice.amount) < s.amountThresholdMin) return false;
      if (s.taxStep && !invoice.taxReviewRequired) return false;
      return true;
    })
    .sort((a, b) => a.stepNo - b.stepNo);

  applicable.forEach((s) => {
    let assignedTo: string | undefined;
    let assignedToName: string | undefined;
    if (s.approverType === 'DOA') {
      // BPD §11.2: the approval band is chosen by amount alone. The level
      // belongs to a role, not a person — whoever holds it can approve.
      const doa = db.doaMatrix
        .filter((d) => d.active && (invoice.amountIdr ?? invoice.amount) >= d.minAmount && (d.maxAmount == null || (invoice.amountIdr ?? invoice.amount) <= d.maxAmount))
        .sort((a, b) => a.level - b.level)[0];
      if (doa) {
        const role = db.roles.find((r) => r.code === doa.role) ?? db.roles.find((r) => r.code === 'AP_REVIEWER');
        const holder = role ? db.users.find((x) => x.enabled && x.roleIds.includes(role.id)) : undefined;
        assignedTo = holder?.id;
        assignedToName = holder?.name;
      }
    } else if (s.approverType === 'USER' && s.approverRef) {
      const u = db.users.find((x) => x.id === s.approverRef);
      assignedTo = u?.id;
      assignedToName = u?.name;
    } else {
      const role = db.roles.find((r) => r.code === s.role);
      const u = role ? db.users.find((x) => x.enabled && x.roleIds.includes(role.id)) : undefined;
      assignedTo = u?.id;
      assignedToName = u?.name;
    }
    const step: WorkflowStepInstance = {
      id: ids.generic('WFS'),
      instanceId: instance.id,
      invoiceId: invoice.id,
      stepNo: s.stepNo,
      name: s.name,
      role: s.role,
      assignedTo,
      assignedToName,
      status: 'PENDING',
      slaBreached: false,
    };
    db.workflowSteps.push(step);
  });

  activateNextStep(invoice, instance.id);
  invoice.stage = 'APPROVAL';
  invoice.processingFlag = 'APPROVAL_PENDING';
  addTimeline(invoice.id, 'WORKFLOW_STARTED', `Approval workflow started (${def.name})`, {
    status: 'INFO', correlationId: invoice.correlationId,
  });
  touchInvoice(invoice);
}

export function activateNextStep(invoice: Invoice, instanceId: string): WorkflowStepInstance | undefined {
  const db = getDb();
  const instance = db.workflowInstances.find((w) => w.id === instanceId);
  if (!instance) return undefined;
  const steps = db.workflowSteps
    .filter((s) => s.instanceId === instanceId)
    .sort((a, b) => a.stepNo - b.stepNo);
  const next = steps.find((s) => s.status === 'PENDING');
  if (!next) {
    instance.status = 'COMPLETED';
    instance.completedAt = nowIso();
    markDirty();
    onWorkflowApproved(invoice);
    return undefined;
  }
  next.status = 'ACTIVE';
  next.dueAt = isoIn(24 * HOUR);
  instance.currentStepNo = next.stepNo;
  markDirty();
  if (next.assignedTo) {
    // Content comes from the configurable APPROVAL_REQUESTED email template.
    const msg = emailContent('APPROVAL_REQUESTED', { invoiceNumber: invoice.invoiceNumber, vendorName: invoice.vendorName, currency: invoice.currency, amount: invoice.amount.toLocaleString('en-US'), stepName: next.name });
    notifyUser(next.assignedTo, 'APPROVAL', msg.title, msg.body, { invoiceId: invoice.id });
  }
  addTimeline(invoice.id, 'APPROVAL_REQUESTED', `Approval requested: ${next.name}`, {
    detail: next.assignedToName ? `Assigned to ${next.assignedToName}` : `Role ${next.role}`,
    status: 'INFO', correlationId: invoice.correlationId,
  });
  if (next.name.toLowerCase().includes('tax')) invoice.stage = 'TAX_REVIEW';
  else invoice.stage = 'APPROVAL';
  touchInvoice(invoice);
  return next;
}

export function onWorkflowApproved(invoice: Invoice): void {
  invoice.lifecycle = 'VALIDATED';
  invoice.processingFlag = null;
  invoice.stage = 'SAP_HANDOFF';
  addTimeline(invoice.id, 'WORKFLOW_COMPLETED', 'All approvals completed', {
    detail: 'Invoice validated - queued for SAP handoff', status: 'SUCCESS', correlationId: invoice.correlationId,
  });
  systemAudit({
    eventType: 'INVOICE_VALIDATED', category: 'INVOICE', action: 'STATUS_CHANGE',
    entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
    invoiceId: invoice.id, oldValue: { lifecycle: 'DRAFT' }, newValue: { lifecycle: 'VALIDATED' },
    correlationId: invoice.correlationId, module: 'workflow',
  });
  touchInvoice(invoice);
  createSapHandoff(invoice);
}

export function actOnStep(
  invoice: Invoice,
  step: WorkflowStepInstance,
  user: AppUser,
  action: 'APPROVE' | 'REJECT' | 'SEND_BACK' | 'DELEGATE',
  comment?: string,
  delegateTo?: string
): void {
  const db = getDb();
  step.actedBy = user.id;
  step.actedByName = user.name;
  step.actedAt = nowIso();
  step.comment = comment;
  step.channel = 'PORTAL';

  const auditBase = {
    actorType: 'USER' as const,
    actorId: user.id,
    actorName: user.name,
    category: 'APPROVAL' as const,
    module: 'workflow',
    entityType: 'WORKFLOW',
    entityId: step.id,
    entityRef: invoice.invoiceNumber,
    invoiceId: invoice.id,
    correlationId: invoice.correlationId,
    source: 'PORTAL',
  };

  if (action === 'APPROVE') {
    step.status = 'APPROVED';
    audit({ ...auditBase, eventType: 'APPROVAL_APPROVED', action: 'APPROVE', result: 'SUCCESS', reason: comment });
    addTimeline(invoice.id, 'APPROVAL_COMPLETED', `${step.name} approved`, {
      actorType: 'USER', actorName: user.name, detail: comment, status: 'SUCCESS', correlationId: invoice.correlationId,
    });
    activateNextStep(invoice, step.instanceId);
  } else if (action === 'REJECT') {
    step.status = 'REJECTED';
    const instance = db.workflowInstances.find((w) => w.id === step.instanceId);
    if (instance) {
      instance.status = 'REJECTED';
      instance.completedAt = nowIso();
    }
    invoice.stage = 'EXCEPTION';
    // Rejected is a business state in its own right (UI/UX review §14): the
    // invoice stays in the system until corrected documents are resubmitted,
    // and must not be shown as a generic validation failure.
    invoice.processingFlag = 'REJECTED';
    audit({ ...auditBase, eventType: 'APPROVAL_REJECTED', action: 'REJECT', result: 'REJECTED', reason: comment });
    addTimeline(invoice.id, 'APPROVAL_REJECTED', `${step.name} rejected`, {
      actorType: 'USER', actorName: user.name, detail: comment, status: 'ERROR', correlationId: invoice.correlationId,
    });
    createException(invoice, 'APPROVAL_ISSUE', 'HIGH', `Approval rejected at "${step.name}"`, comment ?? 'Rejected without further detail', {});
  } else if (action === 'SEND_BACK') {
    step.status = 'SENT_BACK';
    invoice.stage = 'EXCEPTION';
    audit({ ...auditBase, eventType: 'APPROVAL_SENT_BACK', action: 'SEND_BACK', result: 'SUCCESS', reason: comment });
    addTimeline(invoice.id, 'APPROVAL_SENT_BACK', `${step.name}: sent back for clarification`, {
      actorType: 'USER', actorName: user.name, detail: comment, status: 'WARNING', correlationId: invoice.correlationId,
    });
    createException(invoice, 'APPROVAL_ISSUE', 'MEDIUM', `Sent back from "${step.name}"`, comment ?? 'Clarification requested', {});
  } else if (action === 'DELEGATE' && delegateTo) {
    const delegate = db.users.find((u) => u.id === delegateTo);
    step.status = 'ACTIVE';
    step.delegatedTo = delegateTo;
    step.assignedTo = delegateTo;
    step.assignedToName = delegate?.name;
    step.actedBy = undefined;
    step.actedByName = undefined;
    step.actedAt = undefined;
    audit({ ...auditBase, eventType: 'APPROVAL_DELEGATED', action: 'DELEGATE', result: 'SUCCESS', reason: comment, newValue: { delegatedTo: delegate?.name } });
    addTimeline(invoice.id, 'APPROVAL_DELEGATED', `${step.name} delegated to ${delegate?.name ?? delegateTo}`, {
      actorType: 'USER', actorName: user.name, status: 'INFO', correlationId: invoice.correlationId,
    });
    if (delegate) {
      // Content comes from the configurable APPROVAL_DELEGATED email template.
      const msg = emailContent('APPROVAL_DELEGATED', { invoiceNumber: invoice.invoiceNumber, stepName: step.name, delegatedBy: user.name });
      notifyUser(delegate.id, 'APPROVAL', msg.title, msg.body, { invoiceId: invoice.id });
    }
  }
  markDirty();
  touchInvoice(invoice);
}

// -------------------------------------------------------------- SAP handoff
export function createSapHandoff(invoice: Invoice): void {
  const db = getDb();
  const existing = db.sapHandoffs.find(
    (h) => h.invoiceId === invoice.id && !['FAILED', 'DEAD_LETTER'].includes(h.status)
  );
  if (existing) return;
  const handoff = {
    id: ids.handoff(),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    idempotencyKey: `${invoice.id}:${invoice.correlationId}`,
    status: 'QUEUED' as const,
    attempts: 0,
    createdAt: nowIso(),
    correlationId: invoice.correlationId,
    payloadSummary: {
      portalInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vendorCode: invoice.vendorCode,
      companyCode: invoice.companyCode,
      amount: invoice.amount,
      currency: invoice.currency,
      poNumber: invoice.poNumber ?? null,
      configVersion: invoice.configVersionId,
      lines: db.invoiceLines.filter((l) => l.invoiceId === invoice.id).length,
    },
  };
  db.sapHandoffs.unshift(handoff);
  markDirty();
  addTimeline(invoice.id, 'SAP_HANDOFF_REQUESTED', 'SAP handoff created', {
    detail: `Handoff ${handoff.id} queued (idempotent)`, status: 'INFO', reference: handoff.id, correlationId: invoice.correlationId,
  });
  systemAudit({
    eventType: 'DOWNSTREAM_HANDOFF_REQUESTED', category: 'SAP', action: 'HANDOFF',
    entityType: 'SAP', entityId: handoff.id, entityRef: invoice.invoiceNumber,
    invoiceId: invoice.id, correlationId: invoice.correlationId, module: 'sap-integration',
  });
  enqueueJob('SAP_HANDOFF', { refId: handoff.id, invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Handoff ${handoff.id} for ${invoice.invoiceNumber}`, delayMs: 1500 });
}

registerJobHandler('SAP_HANDOFF', (job) => {
  const db = getDb();
  const handoff = db.sapHandoffs.find((h) => h.id === job.refId);
  if (!handoff) return;
  const invoice = db.invoices.find((i) => i.id === handoff.invoiceId);
  if (!invoice) return;
  handoff.attempts += 1;
  handoff.lastAttemptAt = nowIso();

  const ack = SapMock.sendHandoff(invoice.invoiceNumber);
  if (!ack.accepted) {
    handoff.status = handoff.attempts >= 3 ? 'DEAD_LETTER' : 'QUEUED';
    handoff.message = ack.message;
    handoff.errorCode = ack.errorCode;
    invoice.processingFlag = handoff.status === 'DEAD_LETTER' ? 'SAP_ERROR' : 'TECHNICAL_RETRY';
    markDirty();
    techLog({
      module: 'sap-integration', event: 'SAP_HANDOFF_FAILED', level: 'WARN',
      message: `${ack.errorCode}: ${ack.message}`, correlationId: invoice.correlationId,
      invoiceId: invoice.id, integration: 'SAP', errorCode: ack.errorCode, retryCount: handoff.attempts,
    });
    if (handoff.status === 'DEAD_LETTER') {
      createException(invoice, 'INTEGRATION_FAILURE', 'HIGH',
        'SAP handoff failed after retries',
        `${ack.message}. The handoff moved to the dead-letter queue and requires manual reprocessing. This is a technical exception - not a business rejection.`,
        { technical: true });
      touchInvoice(invoice);
    } else {
      throw new Error(ack.message); // trigger retry with backoff
    }
    return;
  }

  handoff.status = 'ACKNOWLEDGED';
  handoff.acknowledgedAt = nowIso();
  handoff.sapDocumentNo = ack.sapDocumentNo;
  handoff.sapFiscalYear = ack.fiscalYear;
  handoff.message = ack.message;
  invoice.lifecycle = 'IN_PROGRESS';
  invoice.stage = 'SAP_PROCESSING';
  invoice.processingFlag = null;
  invoice.sapDocumentNo = ack.sapDocumentNo;
  invoice.sapFiscalYear = ack.fiscalYear;
  markDirty();
  addTimeline(invoice.id, 'SAP_ACKNOWLEDGED', 'SAP acknowledged handoff', {
    detail: `SAP document ${ack.sapDocumentNo}/${ack.fiscalYear}`, status: 'SUCCESS', reference: ack.sapDocumentNo, correlationId: invoice.correlationId,
  });
  systemAudit({
    eventType: 'EXTERNAL_STATUS_UPDATED', category: 'SAP', action: 'STATUS_SYNC',
    entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
    invoiceId: invoice.id, newValue: { lifecycle: 'IN_PROGRESS', sapDocumentNo: ack.sapDocumentNo },
    correlationId: invoice.correlationId, module: 'sap-integration',
  });
  touchInvoice(invoice);
  enqueueJob('SAP_STATUS_SYNC', { refId: handoff.id, invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Status sync for ${invoice.invoiceNumber}`, delayMs: 5000 });
});

registerJobHandler('SAP_STATUS_SYNC', (job) => {
  const db = getDb();
  const handoff = db.sapHandoffs.find((h) => h.id === job.refId);
  const invoice = db.invoices.find((i) => i.id === job.invoiceId);
  if (!handoff || !invoice) return;
  if (db.integrationHealth.sapState === 'UNAVAILABLE') {
    invoice.processingFlag = 'SAP_PENDING';
    markDirty();
    throw new Error('SAP status interface unavailable - sync deferred');
  }
  if (invoice.lifecycle === 'IN_PROGRESS') {
    const park = Math.random() < 0.35;
    invoice.lifecycle = park ? 'PARKED' : 'POSTED';
    handoff.status = park ? 'PARKED' : 'POSTED';
    invoice.stage = park ? 'SAP_PROCESSING' : 'COMPLETED';
    addTimeline(invoice.id, park ? 'SAP_PARKED' : 'SAP_POSTED', park ? 'Invoice parked in SAP' : 'Invoice posted in SAP', {
      detail: `SAP document ${invoice.sapDocumentNo}`, status: 'SUCCESS', reference: invoice.sapDocumentNo, correlationId: invoice.correlationId,
    });
    systemAudit({
      eventType: park ? 'PARKED' : 'POSTED', category: 'SAP', action: 'STATUS_SYNC',
      entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
      invoiceId: invoice.id, newValue: { lifecycle: invoice.lifecycle }, correlationId: invoice.correlationId,
      module: 'sap-integration',
    });
    touchInvoice(invoice);
    enqueueJob('SAP_STATUS_SYNC', { refId: handoff.id, invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Follow-up status sync for ${invoice.invoiceNumber}`, delayMs: 8000 });
  } else if (invoice.lifecycle === 'PARKED') {
    invoice.lifecycle = 'POSTED';
    handoff.status = 'POSTED';
    invoice.stage = 'COMPLETED';
    addTimeline(invoice.id, 'SAP_POSTED', 'Parked invoice posted in SAP', {
      detail: `SAP document ${invoice.sapDocumentNo}`, status: 'SUCCESS', correlationId: invoice.correlationId,
    });
    touchInvoice(invoice);
  } else if (invoice.lifecycle === 'POSTED') {
    invoice.paymentStatus = 'PAID';
    invoice.lifecycle = 'PAID';
    invoice.paymentDate = nowIso().slice(0, 10);
    invoice.paymentRef = `PAY-${invoice.sapDocumentNo}`;
    addTimeline(invoice.id, 'PAYMENT_SYNCED', 'Payment cleared in SAP', {
      detail: `Payment reference ${invoice.paymentRef}`, status: 'SUCCESS', correlationId: invoice.correlationId,
    });
    systemAudit({
      eventType: 'PAYMENT_SYNCED', category: 'SAP', action: 'STATUS_SYNC',
      entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
      invoiceId: invoice.id, newValue: { lifecycle: 'PAID', paymentRef: invoice.paymentRef },
      correlationId: invoice.correlationId, module: 'sap-integration',
    });
    touchInvoice(invoice);
  }
});

// ------------------------------------------------------------------ ingest
export interface IngestSpec {
  invoiceNumber?: string;
  vendorCode: string;
  categoryId: string;
  amount: number;
  taxRatePct?: number;
  currency?: string;
  poNumber?: string;
  description?: string;
  invoiceDate?: string;
  exchangeRate?: number;
  fileNames: { fileName: string; documentTypeId: string; sizeKb?: number; pages?: number }[];
  priority?: Invoice['priority'];
}

export function ingestInvoice(
  spec: IngestSpec,
  source: IngestSource,
  actor: { id: string; name: string }
): Invoice {
  const db = getDb();
  const vendor = db.vendors.find((v) => v.code === spec.vendorCode);
  const activeConfig = db.configVersions.find((c) => c.status === 'ACTIVE');
  const correlationId = ids.correlation();
  // Indonesian VAT (PPN) is 11% unless the upload says otherwise.
  const taxRate = spec.taxRatePct ?? 11;
  const subtotal = Math.round((spec.amount / (1 + taxRate / 100)) * 100) / 100;
  const now = nowIso();
  const invoice: Invoice = {
    id: ids.invoice(),
    invoiceNumber: spec.invoiceNumber ?? `${vendor?.code ?? 'VEN'}/${now.slice(0, 4)}/${Math.floor(1000 + Math.random() * 9000)}`,
    vendorCode: spec.vendorCode,
    vendorName: vendor?.name ?? spec.vendorCode,
    categoryId: spec.categoryId,
    invoiceDate: spec.invoiceDate ?? now.slice(0, 10),
    receivedAt: now,
    amount: spec.amount,
    subtotal,
    taxAmount: Math.round((spec.amount - subtotal) * 100) / 100,
    currency: spec.currency ?? 'IDR',
    amountIdr: (spec.currency ?? 'IDR') === 'IDR' ? spec.amount : Math.round(spec.amount * (spec.exchangeRate ?? 16_800)),
    exchangeRate: (spec.currency ?? 'IDR') === 'IDR' ? undefined : (spec.exchangeRate ?? 16_800),
    poNumber: spec.poNumber,
    companyCode: 'PAU',
    source,
    stage: 'RECEIVED',
    lifecycle: 'DRAFT',
    processingFlag: null,
    slaDueAt: isoIn(3 * DAY),
    slaBreached: false,
    priority: spec.priority ?? 'NORMAL',
    configVersionId: activeConfig?.id ?? 'cfg-1',
    correlationId,
    description: spec.description ?? 'Invoice received for processing',
    // Tax Team reviews withholding tax (PPh 23 / PPh 4(2)) on domestic services.
    taxReviewRequired: ['cat-service', 'cat-manpower', 'cat-catering'].includes(spec.categoryId),
    createdAt: now,
    updatedAt: now,
  };
  db.invoices.unshift(invoice);

  spec.fileNames.forEach((f, idx) => {
    const catDoc = db.categoryDocuments.find(
      (cd) => cd.configVersionId === invoice.configVersionId && cd.categoryId === invoice.categoryId && cd.documentTypeId === f.documentTypeId
    );
    const sp = SharePointMock.storeDocument(invoice.invoiceNumber, f.fileName);
    db.invoiceDocuments.push({
      id: ids.generic('DOC'),
      invoiceId: invoice.id,
      documentTypeId: f.documentTypeId,
      fileName: f.fileName,
      pages: f.pages ?? 1 + Math.floor(Math.random() * 5),
      sizeKb: f.sizeKb ?? 120 + Math.floor(Math.random() * 900),
      mimeType: 'application/pdf',
      source,
      sharePointUrl: sp.url,
      checksum: sp.checksum,
      status: 'AVAILABLE',
      extractionStatus: 'PENDING',
      requirementType: catDoc?.requirementType ?? 'OPTIONAL',
      checkMode: catDoc?.checkMode ?? 'AVAILABILITY_ONLY',
      version: 1,
      uploadedBy: actor.name,
      uploadedAt: now,
    });
  });
  markDirty();

  // Simulated SAP reference-data sync: when the referenced PO exists but has no
  // receipt/service-entry coverage yet, the mock SAP adapter surfaces matching
  // GRN/SES reference data so N-way reconciliation can execute end-to-end.
  if (invoice.poNumber) {
    const po = db.sapPurchaseOrders.find((p) => p.poNumber === invoice.poNumber);
    if (po) {
      const cat = db.categories.find((c) => c.id === invoice.categoryId);
      if (cat?.code === 'MATERIAL' && !db.sapGrns.some((g) => g.poNumber === po.poNumber)) {
        db.sapGrns.push({
          grnNumber: String(5000002100 + Math.floor(Math.random() * 899)),
          poNumber: po.poNumber,
          postingDate: invoice.invoiceDate,
          totalQuantity: 1,
          amount: invoice.subtotal,
          movementType: '101',
          items: [{ poItem: '00010', quantity: 1, amount: invoice.subtotal }],
        });
      } else if (cat && cat.code !== 'MATERIAL' && cat.code !== 'NON_PO' && !db.sapSes.some((s) => s.poNumber === po.poNumber)) {
        db.sapSes.push({
          sesNumber: String(8000003700 + Math.floor(Math.random() * 299)),
          poNumber: po.poNumber,
          postingDate: invoice.invoiceDate,
          serviceDescription: invoice.description,
          quantity: 1,
          uom: 'AU',
          amount: invoice.subtotal,
          acceptedAmount: invoice.subtotal,
          status: 'ACCEPTED',
        });
      }
      markDirty();
    }
  }

  audit({
    actorType: actor.id === 'system' ? 'SYSTEM' : 'USER', actorId: actor.id, actorName: actor.name,
    eventType: 'INVOICE_RECEIVED', category: 'INVOICE', action: 'CREATE', module: 'ingestion',
    entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber, invoiceId: invoice.id,
    result: 'SUCCESS', newValue: { source, amount: invoice.amount, vendor: invoice.vendorCode },
    correlationId, source: source === 'MANUAL_UPLOAD' ? 'PORTAL' : source,
  });
  addTimeline(invoice.id, 'INVOICE_RECEIVED', `Invoice received via ${source === 'MANUAL_UPLOAD' ? 'manual portal upload' : source === 'EMAIL' ? 'AP mailbox' : 'SharePoint monitor'}`, {
    detail: `${spec.fileNames.length} document(s) · correlation ${correlationId}`,
    status: 'SUCCESS', actorType: actor.id === 'system' ? 'SYSTEM' : 'USER', actorName: actor.name, correlationId,
  });
  techLog({
    module: 'ingestion', event: 'INVOICE_RECEIVED',
    message: `Invoice bundle created from ${source} (${spec.fileNames.length} documents)`,
    correlationId, invoiceId: invoice.id, status: 'SUCCESS',
  });

  enqueueJob('CLASSIFICATION', { invoiceId: invoice.id, correlationId, detail: `Classify ${invoice.invoiceNumber}`, delayMs: 1200 });
  return invoice;
}

registerJobHandler('CLASSIFICATION', (job) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === job.invoiceId);
  if (!invoice) return;
  invoice.stage = 'CLASSIFICATION';
  const cat = db.categories.find((c) => c.id === invoice.categoryId);
  addTimeline(invoice.id, 'DOCUMENT_CLASSIFIED', 'Documents classified', {
    detail: `Category resolved: ${cat?.name ?? invoice.categoryId} (Azure GPT, configuration hints)`,
    status: 'SUCCESS', correlationId: invoice.correlationId,
  });
  systemAudit({
    eventType: 'DOCUMENT_CLASSIFIED', category: 'DOCUMENT', action: 'CLASSIFY',
    entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
    invoiceId: invoice.id, newValue: { category: cat?.code }, correlationId: invoice.correlationId,
    module: 'extraction',
  });
  const complete = runCompleteness(invoice);
  touchInvoice(invoice);
  if (complete) {
    enqueueJob('EXTRACTION', { invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Extract ${invoice.invoiceNumber}`, delayMs: 1800 });
  } else {
    // Missing mandatory documents keep the invoice in Draft, but the
    // documents that ARE available are still extracted so reviewers can see
    // field values and SAP mapping while the missing document is chased.
    extractAvailableDocuments(invoice);
  }
});

/** Extract available documents without advancing the invoice past completeness. */
export function extractAvailableDocuments(invoice: Invoice): void {
  const stage = invoice.stage;
  const flag = invoice.processingFlag;
  runExtraction(invoice);
  invoice.stage = stage;
  invoice.processingFlag = flag;
  touchInvoice(invoice);
}

registerJobHandler('EXTRACTION', (job) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === job.invoiceId);
  if (!invoice) return;
  runExtraction(invoice);
  if (invoice.stage !== 'EXTRACTION_REVIEW') {
    enqueueJob('VALIDATION', { invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Validate ${invoice.invoiceNumber}`, delayMs: 1500 });
  }
});

registerJobHandler('VALIDATION', (job) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === job.invoiceId);
  if (!invoice) return;
  const run = runValidation(invoice, 'PIPELINE');
  if (run.outcome === 'PASS') {
    startWorkflow(invoice);
  }
});

registerJobHandler('REPROCESS', (job) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === job.invoiceId);
  if (!invoice) return;
  const complete = runCompleteness(invoice);
  if (!complete) return;
  runExtraction(invoice);
  if (invoice.stage !== 'EXTRACTION_REVIEW') {
    const run = runValidation(invoice, 'REVALIDATION');
    if (run.outcome === 'PASS') startWorkflow(invoice);
  }
});
