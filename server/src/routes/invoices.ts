import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, pageParams, paginate, requireAuth, sortItems } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { ids, nowIso } from '../core/ids';
import { enqueueJob } from '../core/jobs';
import {
  buildValidationContext,
  createSapHandoff,
  evaluateCompleteness,
  ingestInvoice,
  runValidation,
  startWorkflow,
} from '../modules/pipeline/pipeline';
import { addTimeline } from '../modules/pipeline/helpers';
import { evaluateFieldMappings } from '../modules/pipeline/mapping';
import { SharePointMock } from '../integrations/sharepoint.mock';

export const invoiceRouter = Router();

// ------------------------------------------------------------------- list
invoiceRouter.get('/invoices', authorize('INVOICE_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const q = req.query;
  let items = [...db.invoices];

  const text = String(q.search ?? '').trim().toLowerCase();
  if (text) {
    items = items.filter((i) =>
      [i.invoiceNumber, i.id, i.vendorName, i.vendorCode, i.poNumber, i.sapDocumentNo, i.description]
        .some((v) => v?.toLowerCase().includes(text))
    );
  }
  const eq = (key: string, get: (i: (typeof items)[0]) => string | undefined) => {
    const val = String(q[key] ?? '');
    if (val) items = items.filter((i) => (get(i) ?? '') === val);
  };
  eq('lifecycle', (i) => i.lifecycle);
  eq('stage', (i) => i.stage);
  eq('categoryId', (i) => i.categoryId);
  eq('vendorCode', (i) => i.vendorCode);
  eq('department', (i) => i.department);
  eq('source', (i) => i.source);
  eq('assignedTo', (i) => i.assignedTo);
  eq('processingFlag', (i) => i.processingFlag ?? undefined);
  if (q.slaBreached === 'true') items = items.filter((i) => i.slaBreached || (i.slaDueAt < nowIso() && !['POSTED', 'PAID'].includes(i.lifecycle)));
  if (q.hasExceptions === 'true') {
    const withOpen = new Set(db.exceptions.filter((e) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status)).map((e) => e.invoiceId));
    items = items.filter((i) => withOpen.has(i.id));
  }
  const amountMin = Number(q.amountMin);
  const amountMax = Number(q.amountMax);
  if (!Number.isNaN(amountMin) && q.amountMin) items = items.filter((i) => i.amount >= amountMin);
  if (!Number.isNaN(amountMax) && q.amountMax) items = items.filter((i) => i.amount <= amountMax);
  if (q.dateFrom) items = items.filter((i) => i.invoiceDate >= String(q.dateFrom));
  if (q.dateTo) items = items.filter((i) => i.invoiceDate <= String(q.dateTo));

  const p = pageParams(req, 'receivedAt');
  items = sortItems(items, p.sortBy, p.sortDir);
  const page = paginate(items, p);
  const openExc = db.exceptions.filter((e) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status));
  res.json({
    ...page,
    items: page.items.map((i) => ({
      ...i,
      categoryName: db.categories.find((c) => c.id === i.categoryId)?.name ?? i.categoryId,
      openExceptions: openExc.filter((e) => e.invoiceId === i.id).length,
      assignedToName: db.users.find((u) => u.id === i.assignedTo)?.name,
    })),
  });
}));

// ------------------------------------------------------------------ upload
invoiceRouter.post('/invoices/upload', authorize('INVOICE_UPLOAD'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const body = req.body as {
    vendorCode?: string; categoryId?: string; amount?: number; poNumber?: string;
    department?: string; description?: string; invoiceDate?: string;
    files?: { fileName: string; documentTypeId: string; sizeKb?: number }[];
  };
  if (!body.vendorCode || !body.categoryId || !body.amount || !body.files?.length) {
    throw Errors.validation('vendorCode, categoryId, amount and at least one file are required');
  }
  const db = getDb();
  if (!db.vendors.some((v) => v.code === body.vendorCode)) throw Errors.badRequest('Unknown vendor code');
  if (!db.categories.some((c) => c.id === body.categoryId)) throw Errors.badRequest('Unknown invoice category');

  const invoice = ingestInvoice(
    {
      vendorCode: body.vendorCode,
      categoryId: body.categoryId,
      amount: body.amount,
      poNumber: body.poNumber || undefined,
      department: body.department,
      description: body.description,
      invoiceDate: body.invoiceDate,
      fileNames: body.files.map((f) => ({ fileName: f.fileName, documentTypeId: f.documentTypeId, sizeKb: f.sizeKb })),
    },
    'MANUAL_UPLOAD',
    { id: user.id, name: user.name }
  );
  res.status(201).json({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, correlationId: invoice.correlationId });
}));

// ------------------------------------------------------------------ detail
invoiceRouter.get('/invoices/:id', authorize('INVOICE_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id || i.invoiceNumber === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);

  const completeness = evaluateCompleteness(invoice);
  const docs = db.invoiceDocuments.filter((d) => d.invoiceId === invoice.id);
  const runs = db.validationRuns.filter((r) => r.invoiceId === invoice.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latestRun = runs[0];
  const instance = db.workflowInstances.find((w) => w.invoiceId === invoice.id);
  const po = invoice.poNumber ? db.sapPurchaseOrders.find((p) => p.poNumber === invoice.poNumber) : undefined;

  res.json({
    invoice: {
      ...invoice,
      categoryName: db.categories.find((c) => c.id === invoice.categoryId)?.name,
      assignedToName: db.users.find((u) => u.id === invoice.assignedTo)?.name,
    },
    vendor: db.vendors.find((v) => v.code === invoice.vendorCode),
    vendorControl: db.vendorControls.find((c) => c.vendorCode === invoice.vendorCode),
    lines: db.invoiceLines.filter((l) => l.invoiceId === invoice.id),
    documents: docs.map((d) => ({
      ...d,
      documentType: db.documentTypes.find((t) => t.id === d.documentTypeId),
    })),
    completeness: completeness.rows.map((r) => ({
      ...r.categoryDocument,
      documentType: db.documentTypes.find((t) => t.id === r.documentTypeId),
      available: r.available,
      applicable: r.applicable,
    })),
    extractionRuns: db.extractionRuns.filter((r) => r.invoiceId === invoice.id),
    extractedFields: db.extractedFields
      .filter((f) => f.invoiceId === invoice.id)
      .map((f) => ({ ...f, documentTypeCode: db.documentTypes.find((t) => t.id === f.documentTypeId)?.code })),
    validationRuns: runs,
    validationResults: latestRun ? db.validationResults.filter((r) => r.runId === latestRun.id) : [],
    mappingEvaluation: evaluateFieldMappings(invoice),
    exceptions: db.exceptions.filter((e) => e.invoiceId === invoice.id),
    workflow: instance
      ? { instance, steps: db.workflowSteps.filter((s) => s.instanceId === instance.id).sort((a, b) => a.stepNo - b.stepNo) }
      : null,
    sapHandoffs: db.sapHandoffs.filter((h) => h.invoiceId === invoice.id),
    sapReference: {
      po,
      grns: invoice.poNumber ? db.sapGrns.filter((g) => g.poNumber === invoice.poNumber) : [],
      ses: invoice.poNumber ? db.sapSes.filter((s) => s.poNumber === invoice.poNumber) : [],
    },
    timeline: db.timelineEvents.filter((t) => t.invoiceId === invoice.id).sort((a, b) => b.at.localeCompare(a.at)),
    auditEvents: db.auditEvents.filter((a) => a.invoiceId === invoice.id).slice(0, 100),
  });
}));

// ------------------------------------------------------------------ assign
invoiceRouter.post('/invoices/:id/assign', authorize('INVOICE_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  const { userId } = req.body as { userId?: string };
  const assignee = userId ? db.users.find((u) => u.id === userId) : undefined;
  if (userId && !assignee) throw Errors.badRequest('Unknown user');
  const old = invoice.assignedTo;
  invoice.assignedTo = assignee?.id;
  invoice.updatedAt = nowIso();
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: 'INVOICE_ASSIGNED', category: 'INVOICE', action: 'ASSIGN', module: 'invoice',
    entityType: 'Invoice', entityId: invoice.id, entityRef: invoice.invoiceNumber, invoiceId: invoice.id,
    result: 'SUCCESS', oldValue: { assignedTo: old }, newValue: { assignedTo: assignee?.id },
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
  res.json({ ok: true, assignedTo: assignee?.id ?? null, assignedToName: assignee?.name ?? null });
}));

// -------------------------------------------------------------- revalidate
invoiceRouter.post('/invoices/:id/revalidate', authorize('INVOICE_REVALIDATE'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  if (['POSTED', 'PAID', 'IN_PROGRESS', 'PARKED'].includes(invoice.lifecycle)) {
    throw Errors.conflict('Invoice already handed to SAP - revalidation is not applicable');
  }
  const run = runValidation(invoice, 'REVALIDATION', { id: user.id, name: user.name });
  if (run.outcome === 'PASS' && !db.workflowInstances.some((w) => w.invoiceId === invoice.id && w.status === 'RUNNING') && invoice.lifecycle === 'DRAFT') {
    startWorkflow(invoice);
  }
  res.json({ run });
}));

// --------------------------------------------------------------- reprocess
invoiceRouter.post('/invoices/:id/reprocess', authorize('INVOICE_REVALIDATE'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  addTimeline(invoice.id, 'REPROCESS_REQUESTED', 'Reprocessing requested', {
    actorType: 'USER', actorName: user.name, status: 'INFO', correlationId: invoice.correlationId,
  });
  const job = enqueueJob('REPROCESS', { invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Reprocess ${invoice.invoiceNumber}` });
  res.json({ jobId: job.id });
}));

// ---------------------------------------------------- documents add/replace
invoiceRouter.post('/invoices/:id/documents', authorize('INVOICE_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  const { fileName, documentTypeId, replaceDocumentId, sizeKb } = req.body as {
    fileName?: string; documentTypeId?: string; replaceDocumentId?: string; sizeKb?: number;
  };
  if (!fileName || !documentTypeId) throw Errors.validation('fileName and documentTypeId are required');
  if (!db.documentTypes.some((t) => t.id === documentTypeId)) throw Errors.badRequest('Unknown document type');

  let version = 1;
  if (replaceDocumentId) {
    const prev = db.invoiceDocuments.find((d) => d.id === replaceDocumentId && d.invoiceId === invoice.id);
    if (!prev) throw Errors.notFound('Document', replaceDocumentId);
    prev.status = 'SUPERSEDED';
    version = prev.version + 1;
  }
  const catDoc = db.categoryDocuments.find(
    (cd) => cd.configVersionId === invoice.configVersionId && cd.categoryId === invoice.categoryId && cd.documentTypeId === documentTypeId
  );
  const sp = SharePointMock.storeDocument(invoice.invoiceNumber, fileName);
  const doc = {
    id: ids.generic('DOC'),
    invoiceId: invoice.id,
    documentTypeId,
    fileName,
    pages: 1 + Math.floor(Math.random() * 4),
    sizeKb: sizeKb ?? 200 + Math.floor(Math.random() * 600),
    mimeType: 'application/pdf',
    source: 'MANUAL_UPLOAD' as const,
    sharePointUrl: sp.url,
    checksum: sp.checksum,
    status: 'AVAILABLE' as const,
    extractionStatus: (catDoc?.checkMode ?? 'AVAILABILITY_ONLY') === 'AVAILABILITY_ONLY' ? ('NOT_REQUIRED' as const) : ('PENDING' as const),
    requirementType: catDoc?.requirementType ?? ('OPTIONAL' as const),
    checkMode: catDoc?.checkMode ?? ('AVAILABILITY_ONLY' as const),
    version,
    supersededById: undefined,
    uploadedBy: user.name,
    uploadedAt: nowIso(),
  };
  if (replaceDocumentId) {
    const prev = db.invoiceDocuments.find((d) => d.id === replaceDocumentId)!;
    prev.supersededById = doc.id;
  }
  db.invoiceDocuments.push(doc);
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: replaceDocumentId ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
    category: 'DOCUMENT', action: replaceDocumentId ? 'REPLACE' : 'UPLOAD', module: 'document',
    entityType: 'InvoiceDocument', entityId: doc.id, entityRef: fileName, invoiceId: invoice.id,
    result: 'SUCCESS', correlationId: invoice.correlationId, source: 'PORTAL',
  });
  addTimeline(invoice.id, replaceDocumentId ? 'DOCUMENT_REPLACED' : 'DOCUMENT_ADDED',
    `${replaceDocumentId ? 'Replacement' : 'Additional'} document: ${fileName}`, {
      actorType: 'USER', actorName: user.name, status: 'INFO', correlationId: invoice.correlationId,
    });
  // resolve missing-document exceptions for this type
  db.exceptions
    .filter((e) => e.invoiceId === invoice.id && e.type === 'MISSING_DOCUMENT' && e.documentTypeId === documentTypeId && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(e.status))
    .forEach((e) => {
      e.status = 'RESOLVED';
      e.resolvedAt = nowIso();
      e.resolution = `Document supplied: ${fileName}`;
      e.actions.push({ at: nowIso(), by: user.id, byName: user.name, action: 'RESOLVED', note: `Document supplied: ${fileName}` });
    });
  if (invoice.processingFlag === 'MISSING_DOCUMENTS') {
    const { missingBlocking } = evaluateCompleteness(invoice);
    if (!missingBlocking.length) {
      invoice.processingFlag = null;
      enqueueJob('REPROCESS', { invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Reprocess after document completion` });
    }
  } else if (doc.checkMode !== 'AVAILABILITY_ONLY') {
    enqueueJob('REPROCESS', { invoiceId: invoice.id, correlationId: invoice.correlationId, detail: `Reprocess after document ${replaceDocumentId ? 'replacement' : 'addition'}` });
  }
  res.status(201).json({ document: doc });
}));

// ------------------------------------------------------- field corrections
invoiceRouter.post('/fields/:fieldId/correct', authorize('FIELD_CORRECT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const field = db.extractedFields.find((f) => f.id === req.params.fieldId);
  if (!field) throw Errors.notFound('Extracted field', req.params.fieldId);
  const { value, reason } = req.body as { value?: string; reason?: string };
  if (value == null || value === '') throw Errors.validation('A corrected value is required');
  if (!reason?.trim()) throw Errors.validation('A correction reason is required');

  const invoice = db.invoices.find((i) => i.id === field.invoiceId)!;
  const previous = field.value;
  field.corrections.push({
    previousValue: previous,
    newValue: value,
    correctedBy: user.id,
    correctedByName: user.name,
    reason,
    correctedAt: nowIso(),
  });
  field.value = value;
  field.validationStatus = 'CORRECTED';
  field.confidenceBand = 'HIGH';
  field.confidence = 1;
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: 'FIELD_VALUE_CHANGED', category: 'EXTRACTION', action: 'CORRECT', module: 'extraction',
    entityType: 'ExtractedField', entityId: field.id, entityRef: `${field.label} (${invoice.invoiceNumber})`,
    invoiceId: invoice.id, result: 'SUCCESS', reason,
    oldValue: { value: previous }, newValue: { value },
    correlationId: invoice.correlationId, source: 'PORTAL',
  });
  addTimeline(invoice.id, 'FIELD_CORRECTED', `Field corrected: ${field.label}`, {
    actorType: 'USER', actorName: user.name,
    detail: `"${previous}" → "${value}" · ${reason}`, status: 'INFO', correlationId: invoice.correlationId,
  });
  res.json({ field });
}));

invoiceRouter.post('/fields/:fieldId/accept', authorize('FIELD_CORRECT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const field = db.extractedFields.find((f) => f.id === req.params.fieldId);
  if (!field) throw Errors.notFound('Extracted field', req.params.fieldId);
  const invoice = db.invoices.find((i) => i.id === field.invoiceId)!;
  field.validationStatus = 'ACCEPTED';
  field.confidenceBand = field.confidenceBand === 'LOW' ? 'MEDIUM' : field.confidenceBand;
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: 'FIELD_VALUE_ACCEPTED', category: 'EXTRACTION', action: 'ACCEPT', module: 'extraction',
    entityType: 'ExtractedField', entityId: field.id, entityRef: `${field.label} (${invoice.invoiceNumber})`,
    invoiceId: invoice.id, result: 'SUCCESS',
    newValue: { value: field.value }, correlationId: invoice.correlationId, source: 'PORTAL',
  });
  res.json({ field });
}));

/** Complete HITL review: when no LOW fields remain, resume the pipeline. */
invoiceRouter.post('/invoices/:id/complete-review', authorize('FIELD_CORRECT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  const pending = db.extractedFields.filter((f) => f.invoiceId === invoice.id && f.validationStatus === 'REVIEW');
  if (pending.length) {
    throw Errors.conflict(`${pending.length} low-confidence field(s) still require review`);
  }
  db.exceptions
    .filter((e) => e.invoiceId === invoice.id && e.type === 'LOW_CONFIDENCE' && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(e.status))
    .forEach((e) => {
      e.status = 'RESOLVED';
      e.resolvedAt = nowIso();
      e.resolution = 'All low-confidence fields reviewed';
      e.actions.push({ at: nowIso(), by: user.id, byName: user.name, action: 'RESOLVED', note: 'HITL review completed' });
    });
  invoice.processingFlag = null;
  const run = runValidation(invoice, 'CORRECTION', { id: user.id, name: user.name });
  if (run.outcome === 'PASS') startWorkflow(invoice);
  res.json({ run });
}));

// ------------------------------------------------------------- overrides
invoiceRouter.post('/validation-results/:id/override', authorize('VALIDATION_OVERRIDE'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const result = db.validationResults.find((r) => r.id === req.params.id);
  if (!result) throw Errors.notFound('Validation result', req.params.id);
  if (!result.overrideAllowed) throw Errors.forbidden('override this rule - overrides are not permitted for it');
  if (!['FAIL', 'HARD_FAIL', 'WARNING'].includes(result.result)) {
    throw Errors.conflict('Only failed or warning results can be overridden');
  }
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) throw Errors.validation('An override reason is mandatory');

  const invoice = db.invoices.find((i) => i.id === result.invoiceId)!;
  const previous = result.result;
  result.override = {
    by: user.id, byName: user.name,
    role: req.ctx.roles.map((r) => r.name).join(', '),
    reason, at: nowIso(), previousResult: previous,
  };
  result.result = 'OVERRIDDEN';
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name, actorRole: req.ctx.roles.map((r) => r.code).join(','),
    eventType: 'VALIDATION_OVERRIDDEN', category: 'VALIDATION', action: 'OVERRIDE', module: 'rule-engine',
    entityType: 'ValidationResult', entityId: result.id, entityRef: `${result.ruleCode} (${invoice.invoiceNumber})`,
    invoiceId: invoice.id, result: 'OVERRIDDEN', reason,
    oldValue: { result: previous }, newValue: { result: 'OVERRIDDEN' },
    correlationId: invoice.correlationId, source: 'PORTAL',
  });
  addTimeline(invoice.id, 'VALIDATION_OVERRIDDEN', `Override: ${result.ruleCode} ${result.ruleName}`, {
    actorType: 'USER', actorName: user.name, detail: reason, status: 'WARNING', correlationId: invoice.correlationId,
  });
  // Revalidate to recompute overall outcome with the override applied
  const run = runValidation(invoice, 'OVERRIDE', { id: user.id, name: user.name });
  if (run.outcome === 'PASS') startWorkflow(invoice);
  res.json({ result, run });
}));

// -------------------------------------------------- manual SAP handoff kick
invoiceRouter.post('/invoices/:id/sap-handoff', authorize('SAP_RETRY'), asyncHandler((req, res) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  if (invoice.lifecycle !== 'VALIDATED') throw Errors.conflict('Only validated invoices can be handed off to SAP');
  createSapHandoff(invoice);
  res.json({ ok: true });
}));

// ----------------------------------------------------------- context values
invoiceRouter.get('/invoices/:id/validation-context', authorize('INVOICE_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === req.params.id);
  if (!invoice) throw Errors.notFound('Invoice', req.params.id);
  const ctx = buildValidationContext(invoice);
  res.json({ availableDocTypeCodes: [...ctx.availableDocTypeCodes], fieldCount: ctx.fields.length });
}));
