import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { Errors } from '../core/errors';
import { audit, systemAudit } from '../core/audit';
import { ids, nowIso } from '../core/ids';
import { enqueueJob, retryJob } from '../core/jobs';
import { techLog } from '../core/logger';
import { ingestInvoice } from '../modules/pipeline/pipeline';

export const integrationRouter = Router();

// ------------------------------------------------------------------- SAP
integrationRouter.get('/integrations/sap', authorize('SAP_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    health: db.integrationHealth,
    handoffs: db.sapHandoffs.slice(0, 100).map((h) => ({
      ...h,
      lifecycle: db.invoices.find((i) => i.id === h.invoiceId)?.lifecycle,
    })),
    referenceCounts: {
      vendors: db.vendors.length,
      purchaseOrders: db.sapPurchaseOrders.length,
      grns: db.sapGrns.length,
      ses: db.sapSes.length,
    },
    queuedInvoices: db.invoices.filter((i) => i.processingFlag === 'SAP_PENDING' || i.processingFlag === 'TECHNICAL_RETRY').length,
  });
}));

integrationRouter.get('/integrations/sap/reference', authorize('SAP_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const type = String(req.query.type ?? 'PO');
  const search = String(req.query.search ?? '').toLowerCase();
  if (type === 'PO') {
    let items = db.sapPurchaseOrders;
    if (search) items = items.filter((p) => [p.poNumber, p.vendorName, p.vendorCode, p.department].some((v) => v.toLowerCase().includes(search)));
    res.json({ items: items.slice(0, 100), total: items.length });
  } else if (type === 'GRN') {
    let items = db.sapGrns;
    if (search) items = items.filter((g) => [g.grnNumber, g.poNumber].some((v) => v.toLowerCase().includes(search)));
    res.json({ items: items.slice(0, 100), total: items.length });
  } else {
    let items = db.sapSes;
    if (search) items = items.filter((s) => [s.sesNumber, s.poNumber, s.serviceDescription].some((v) => v.toLowerCase().includes(search)));
    res.json({ items: items.slice(0, 100), total: items.length });
  }
}));

/** Demo control: simulate SAP connection state (degraded-mode behaviour §17.6). */
integrationRouter.post('/integrations/sap/state', authorize('SAP_RETRY'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const { state } = req.body as { state?: 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE' };
  if (!state || !['CONNECTED', 'DEGRADED', 'UNAVAILABLE'].includes(state)) throw Errors.badRequest('state must be CONNECTED | DEGRADED | UNAVAILABLE');
  const old = db.integrationHealth.sapState;
  db.integrationHealth.sapState = state;
  db.integrationHealth.sapMessage =
    state === 'CONNECTED' ? 'SAP interface responding normally'
      : state === 'DEGRADED' ? 'SAP interface intermittent - retries with backoff in effect'
        : 'SAP interface unreachable - SAP-dependent work is queued; portal remains available';
  db.integrationHealth.referenceDataStale = state !== 'CONNECTED';
  if (state === 'CONNECTED') db.integrationHealth.referenceDataSyncedAt = nowIso();
  markDirty();
  techLog({
    module: 'sap-integration', event: 'SAP_STATE_CHANGED', level: state === 'CONNECTED' ? 'INFO' : 'WARN',
    message: `SAP connection state changed ${old} -> ${state} (simulated by ${user.name})`,
    integration: 'SAP', correlationId: req.ctx.correlationId,
  });
  // resume queued handoffs when back online
  if (state === 'CONNECTED') {
    db.sapHandoffs.filter((h) => h.status === 'QUEUED').forEach((h) => {
      enqueueJob('SAP_HANDOFF', { refId: h.id, invoiceId: h.invoiceId, correlationId: h.correlationId, detail: `Resume handoff ${h.id}`, delayMs: 1000 });
    });
  }
  res.json({ health: db.integrationHealth });
}));

integrationRouter.post('/integrations/sap/handoffs/:id/retry', authorize('SAP_RETRY'), asyncHandler((req, res) => {
  const db = getDb();
  const handoff = db.sapHandoffs.find((h) => h.id === req.params.id);
  if (!handoff) throw Errors.notFound('Handoff', req.params.id);
  if (!['FAILED', 'DEAD_LETTER', 'QUEUED'].includes(handoff.status)) throw Errors.conflict('Handoff is not in a retryable state');
  handoff.status = 'QUEUED';
  markDirty();
  enqueueJob('SAP_HANDOFF', { refId: handoff.id, invoiceId: handoff.invoiceId, correlationId: handoff.correlationId, detail: `Manual retry of handoff ${handoff.id}` });
  res.json({ ok: true });
}));

// -------------------------------------------------------------- biometric
integrationRouter.get('/integrations/biometric', authorize('BIOMETRIC_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const vendor = String(req.query.vendorCode ?? '');
  const month = String(req.query.month ?? '');
  let records = db.attendanceRecords;
  if (vendor) records = records.filter((r) => r.vendorCode === vendor);
  if (month) records = records.filter((r) => r.date.startsWith(month));
  const byVendor = new Map<string, { records: number; hours: number; meals: number }>();
  records.forEach((r) => {
    const v = byVendor.get(r.vendorCode) ?? { records: 0, hours: 0, meals: 0 };
    v.records += 1;
    v.hours += r.hours;
    v.meals += r.present && r.mealEligible ? 1 : 0;
    byVendor.set(r.vendorCode, v);
  });
  res.json({
    batches: db.attendanceBatches.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    lastPushAt: db.integrationHealth.biometricLastPushAt,
    summary: [...byVendor.entries()].map(([code, v]) => ({
      vendorCode: code,
      vendorName: db.vendors.find((x) => x.code === code)?.name,
      ...v,
    })),
    sample: records.slice(0, 200),
    total: records.length,
  });
}));

/**
 * Inbound push API: ESSA MIS pushes attendance/availability data.
 * The platform never polls the biometric system (architecture §23.2).
 */
integrationRouter.post('/integrations/biometric/push', asyncHandler((req, res) => {
  const db = getDb();
  const { records, source } = req.body as {
    source?: string;
    records?: { vendorCode: string; employeeId: string; employeeName?: string; date: string; present?: boolean; hours?: number; otHours?: number; mealEligible?: boolean; site?: string }[];
  };
  if (!Array.isArray(records) || !records.length) throw Errors.validation('records[] is required');
  const correlationId = req.ctx.correlationId;
  const batchId = ids.generic('BATCH');
  let accepted = 0, duplicates = 0, rejected = 0;
  for (const r of records) {
    if (!r.vendorCode || !r.employeeId || !r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { rejected += 1; continue; }
    const dup = db.attendanceRecords.some((x) => x.vendorCode === r.vendorCode && x.employeeId === r.employeeId && x.date === r.date);
    if (dup) { duplicates += 1; continue; }
    db.attendanceRecords.push({
      id: ids.generic('ATT'), batchId, source: source ?? 'ESSA-MIS', site: r.site ?? 'Hazira Plant',
      vendorCode: r.vendorCode, employeeId: r.employeeId, employeeName: r.employeeName ?? r.employeeId,
      date: r.date, present: r.present ?? true, hours: r.hours ?? 8, otHours: r.otHours ?? 0,
      mealEligible: r.mealEligible ?? true, pushedAt: nowIso(), status: 'ACCEPTED',
    });
    accepted += 1;
  }
  const batch = {
    id: batchId, source: source ?? 'ESSA-MIS', receivedAt: nowIso(),
    recordCount: records.length, accepted, duplicates, rejected,
    status: 'PROCESSED' as const, correlationId,
  };
  db.attendanceBatches.unshift(batch);
  db.integrationHealth.biometricLastPushAt = nowIso();
  markDirty();
  systemAudit({
    eventType: 'BIOMETRIC_BATCH_RECEIVED', category: 'BIOMETRIC', action: 'INGEST',
    entityType: 'AttendanceBatch', entityId: batchId, module: 'biometric-integration',
    newValue: { accepted, duplicates, rejected }, correlationId, actorType: 'INTEGRATION',
    actorId: 'essa-mis', actorName: 'ESSA MIS',
  });
  techLog({
    module: 'biometric-integration', event: 'ATTENDANCE_PUSH_PROCESSED',
    message: `Attendance batch processed: ${accepted} accepted, ${duplicates} duplicates, ${rejected} rejected`,
    correlationId, integration: 'ESSA_MIS', status: 'SUCCESS',
  });
  res.status(201).json({ batch });
}));

// -------------------------------------------------------------- ingestion
integrationRouter.get('/ingestion/email', authorize('INVOICE_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    items: db.emailItems.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((e) => ({
      ...e,
      invoiceNumber: db.invoices.find((i) => i.id === e.invoiceId)?.invoiceNumber,
    })),
    mailbox: 'invoice@essa.co.in',
    state: db.integrationHealth.mailboxState,
  });
}));

integrationRouter.get('/ingestion/sharepoint', authorize('INVOICE_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    items: db.sharePointItems.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).map((s) => ({
      ...s,
      invoiceNumber: db.invoices.find((i) => i.id === s.invoiceId)?.invoiceNumber,
    })),
    monitoredFolders: ['/AP-Inbox/Material', '/AP-Inbox/Services', '/AP-Inbox/NonPO'],
    state: db.integrationHealth.sharePointState,
  });
}));

/** Demo control: simulate an inbound vendor email with attachments. */
integrationRouter.post('/ingestion/email/simulate', authorize('INVOICE_UPLOAD'), asyncHandler((req, res) => {
  const db = getDb();
  const vendors = db.vendors.filter((v) => {
    const c = db.vendorControls.find((x) => x.vendorCode === v.code);
    return c?.apEnabled && !c.negativeFlag;
  });
  const vendor = vendors[Math.floor(Math.random() * vendors.length)];
  const category = db.categories.find((c) => c.id === 'cat-service')!;
  const amount = Math.round((250_000 + Math.random() * 900_000) / 100) * 100;
  const emailId = ids.generic('EM');
  const item = {
    id: emailId,
    sender: vendor.email,
    subject: `Invoice submission - ${vendor.name}`,
    receivedAt: nowIso(),
    attachments: [
      { fileName: 'ServiceInvoice.pdf', sizeKb: 320 },
      { fileName: 'PO_Copy.pdf', sizeKb: 180 },
      { fileName: 'SES.pdf', sizeKb: 240 },
      { fileName: 'AttendanceSheet.pdf', sizeKb: 410 },
    ],
    status: 'PROCESSING' as const,
    invoiceId: undefined as string | undefined,
  };
  db.emailItems.unshift(item);
  markDirty();
  const invoice = ingestInvoice(
    {
      vendorCode: vendor.code,
      categoryId: category.id,
      amount,
      poNumber: db.sapPurchaseOrders.find((p) => p.vendorCode === vendor.code)?.poNumber,
      department: 'Operations',
      description: 'Service invoice received via AP mailbox (simulated)',
      fileNames: item.attachments.map((a, i) => ({
        fileName: a.fileName,
        documentTypeId: ['dt-invoice', 'dt-po', 'dt-ses', 'dt-attendance'][i],
        sizeKb: a.sizeKb,
      })),
    },
    'EMAIL',
    { id: 'system', name: 'M365 Mailbox Monitor' }
  );
  item.status = 'PROCESSED' as never;
  item.invoiceId = invoice.id;
  markDirty();
  res.status(201).json({ email: item, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber });
}));

// ---------------------------------------------------------- jobs / retries
integrationRouter.get('/jobs', authorize('TECH_LOG_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  let items = db.integrationJobs;
  if (req.query.status) items = items.filter((j) => j.status === req.query.status);
  if (req.query.type) items = items.filter((j) => j.type === req.query.type);
  res.json({ items: items.slice(0, 200), total: items.length });
}));

integrationRouter.post('/jobs/:id/retry', authorize('SAP_RETRY'), asyncHandler((req, res) => {
  const job = retryJob(req.params.id);
  if (!job) throw Errors.notFound('Job', req.params.id);
  res.json({ job });
}));
