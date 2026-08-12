/**
 * Invoice scenario seeder.
 *
 * Creates ~32 realistic invoices across categories and lifecycle stages by
 * driving the REAL pipeline functions (completeness, extraction, rule engine,
 * workflow) so every screen shows internally consistent data. Advanced SAP
 * states (Parked/Posted/Paid) are written deterministically to avoid racing
 * the async job queue during seeding.
 */
import type { Database } from '../../core/store';
import { getDb, markDirty } from '../../core/store';
import { DAY, HOUR, ids, isoAgo, isoIn, nowIso } from '../../core/ids';
import type {
  AttendanceRecord,
  Invoice,
  InvoiceLifecycle,
  SapGrn,
  SapPurchaseOrder,
  SapSes,
} from '../../core/types';
import { SharePointMock } from '../../integrations/sharepoint.mock';
import {
  runCompleteness,
  runExtraction,
  runValidation,
  startWorkflow,
  actOnStep,
} from '../../modules/pipeline/pipeline';
import { addTimeline } from '../../modules/pipeline/helpers';

// -------------------------------------------------------------- SAP helpers
let poSeq = 4700009500;
function mkPo(db: Database, vendorCode: string, department: string, subtotal: number, opts: { openFactor?: number; poType?: SapPurchaseOrder['poType'] } = {}): SapPurchaseOrder {
  const vendor = db.vendors.find((v) => v.code === vendorCode)!;
  poSeq += 7;
  const open = Math.round(subtotal * (opts.openFactor ?? 1.15));
  const po: SapPurchaseOrder = {
    poNumber: String(poSeq),
    vendorCode,
    vendorName: vendor.name,
    companyCode: '1000',
    department,
    currency: 'INR',
    poType: opts.poType ?? 'SERVICE',
    status: 'OPEN',
    totalAmount: Math.round(open * 1.8),
    openAmount: open,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    items: [{
      item: '00010', description: 'As per contract scope', quantity: Math.max(1, Math.round(subtotal / 450)),
      uom: opts.poType === 'MATERIAL' ? 'EA' : 'AU', unitPrice: 450,
      amount: subtotal, grnQuantity: 0, sesQuantity: 0, openQuantity: Math.max(1, Math.round(subtotal / 450)),
    }],
  };
  db.sapPurchaseOrders.push(po);
  return po;
}

let grnSeq = 5000104200;
function mkGrn(db: Database, poNumber: string, amount: number, date: string): SapGrn {
  grnSeq += 3;
  const grn: SapGrn = {
    grnNumber: String(grnSeq),
    poNumber,
    postingDate: date,
    totalQuantity: Math.max(1, Math.round(amount / 6500)),
    amount,
    movementType: '101',
    items: [{ poItem: '00010', quantity: Math.max(1, Math.round(amount / 6500)), amount }],
  };
  db.sapGrns.push(grn);
  return grn;
}

let sesSeq = 1000203100;
function mkSes(db: Database, poNumber: string, amount: number, date: string, desc: string): SapSes {
  sesSeq += 3;
  const ses: SapSes = {
    sesNumber: String(sesSeq),
    poNumber,
    postingDate: date,
    serviceDescription: desc,
    quantity: Math.max(1, Math.round(amount / 450)),
    uom: 'AU',
    amount,
    acceptedAmount: amount,
    status: 'ACCEPTED',
  };
  db.sapSes.push(ses);
  return ses;
}

// -------------------------------------------------------- attendance helper
let attSeq = 0;
const EMP_NAMES = ['Ramesh Yadav', 'Sunil Pawar', 'Ganesh Kale', 'Vijay Singh', 'Santosh More', 'Anil Kumar', 'Dinesh Patil', 'Manoj Gupta', 'Prakash Jadhav', 'Sachin Shinde', 'Ravi Thakur', 'Ashok Chavan'];

function seedAttendanceHours(db: Database, vendorCode: string, month: string, targetHours: number, batchId: string) {
  let remaining = targetHours;
  let day = 1;
  let emp = 0;
  while (remaining > 0) {
    const hours = Math.min(8, remaining);
    attSeq += 1;
    const rec: AttendanceRecord = {
      id: `att-${attSeq}`,
      batchId,
      source: 'ESSA-MIS',
      site: 'Hazira Plant',
      vendorCode,
      employeeId: `EMP${String(3000 + (emp % 60)).padStart(5, '0')}`,
      employeeName: EMP_NAMES[emp % EMP_NAMES.length],
      date: `${month}-${String(1 + (day % 26)).padStart(2, '0')}`,
      present: true,
      hours,
      otHours: 0,
      mealEligible: true,
      pushedAt: isoAgo(2 * DAY),
      status: 'ACCEPTED',
    };
    db.attendanceRecords.push(rec);
    remaining -= hours;
    emp += 1;
    if (emp % 12 === 0) day += 1;
  }
}

function seedAttendanceMeals(db: Database, vendorCode: string, month: string, eligibleCount: number, batchId: string) {
  for (let i = 0; i < eligibleCount; i++) {
    attSeq += 1;
    db.attendanceRecords.push({
      id: `att-${attSeq}`,
      batchId,
      source: 'ESSA-MIS',
      site: 'Hazira Plant',
      vendorCode,
      employeeId: `EMP${String(4000 + (i % 80)).padStart(5, '0')}`,
      employeeName: EMP_NAMES[i % EMP_NAMES.length],
      date: `${month}-${String(1 + (i % 26)).padStart(2, '0')}`,
      present: true,
      hours: 8,
      otHours: 0,
      mealEligible: true,
      pushedAt: isoAgo(2 * DAY),
      status: 'ACCEPTED',
    });
  }
}

// ------------------------------------------------------------ invoice maker
export interface Scenario {
  key: string;
  categoryId: string;
  vendorCode: string;
  amount: number; // gross incl 18% GST
  daysAgo: number;
  department: string;
  description: string;
  poNumber?: string | 'AUTO';
  target:
    | 'RECEIVED'
    | 'MISSING_DOCS'
    | 'EXTRACTION_REVIEW'
    | 'VALIDATION_FAILED'
    | 'APPROVAL_STEP_1'
    | 'APPROVAL_STEP_2'
    | 'TAX_REVIEW'
    | 'REJECTED'
    | 'VALIDATED_QUEUED'
    | 'IN_PROGRESS'
    | 'PARKED'
    | 'POSTED'
    | 'PAID';
  failKind?: 'GRN_MISMATCH' | 'PO_EXCEEDED' | 'SES_MISMATCH' | 'MEAL_EXCESS' | 'HOURS_MISMATCH';
  degradeFields?: string[];
  omitDocs?: string[]; // documentTypeIds to omit
  priority?: Invoice['priority'];
  slaBreach?: boolean;
  assignTo?: string;
}

const DOC_FILES: Record<string, (inv: string) => { fileName: string; documentTypeId: string; pages: number }[]> = {
  'cat-material': (n) => [
    { fileName: `${n}_TaxInvoice.pdf`, documentTypeId: 'dt-invoice', pages: 2 },
    { fileName: `${n}_PO_Copy.pdf`, documentTypeId: 'dt-po', pages: 3 },
    { fileName: `${n}_GRN.pdf`, documentTypeId: 'dt-grn', pages: 1 },
    { fileName: `${n}_DeliveryChallan.pdf`, documentTypeId: 'dt-challan', pages: 1 },
    { fileName: `${n}_GST_Invoice.pdf`, documentTypeId: 'dt-tax', pages: 1 },
  ],
  'cat-service': (n) => [
    { fileName: `${n}_ServiceInvoice.pdf`, documentTypeId: 'dt-invoice', pages: 2 },
    { fileName: `${n}_PO_Copy.pdf`, documentTypeId: 'dt-po', pages: 2 },
    { fileName: `${n}_SES.pdf`, documentTypeId: 'dt-ses', pages: 2 },
    { fileName: `${n}_AttendanceSheet.pdf`, documentTypeId: 'dt-attendance', pages: 4 },
  ],
  'cat-manpower': (n) => [
    { fileName: `${n}_ManpowerInvoice.pdf`, documentTypeId: 'dt-invoice', pages: 2 },
    { fileName: `${n}_PO_Copy.pdf`, documentTypeId: 'dt-po', pages: 2 },
    { fileName: `${n}_Timesheet.pdf`, documentTypeId: 'dt-timesheet', pages: 8 },
    { fileName: `${n}_ManhourSummary.pdf`, documentTypeId: 'dt-manhour', pages: 2 },
    { fileName: `${n}_AttendanceSheet.pdf`, documentTypeId: 'dt-attendance', pages: 6 },
    { fileName: `${n}_SES.pdf`, documentTypeId: 'dt-ses', pages: 1 },
  ],
  'cat-catering': (n) => [
    { fileName: `${n}_CateringInvoice.pdf`, documentTypeId: 'dt-invoice', pages: 1 },
    { fileName: `${n}_PO_Copy.pdf`, documentTypeId: 'dt-po', pages: 2 },
    { fileName: `${n}_MealSummary.pdf`, documentTypeId: 'dt-meal', pages: 3 },
    { fileName: `${n}_AttendanceSheet.pdf`, documentTypeId: 'dt-attendance', pages: 5 },
  ],
  'cat-nonpo': (n) => [
    { fileName: `${n}_Invoice.pdf`, documentTypeId: 'dt-invoice', pages: 1 },
    { fileName: `${n}_DeptConfirmation.pdf`, documentTypeId: 'dt-dept', pages: 1 },
  ],
};

let invNoSeq = 740;

export function seedInvoices(db: Database, scenarios: Scenario[]) {
  for (const sc of scenarios) {
    const vendor = db.vendors.find((v) => v.code === sc.vendorCode)!;
    const receivedAt = isoAgo(sc.daysAgo * DAY + 5 * HOUR);
    const invoiceDate = receivedAt.slice(0, 10);
    const month = invoiceDate.slice(0, 7);
    const subtotal = Math.round((sc.amount / 1.18) * 100) / 100;
    const taxAmount = Math.round((sc.amount - subtotal) * 100) / 100;
    invNoSeq += 3;
    const vendorInvoiceNo = `${vendor.code.slice(0, 4)}/${month.replace('-', '/')}/${invNoSeq}`;
    const correlationId = ids.correlation();

    // SAP reference tuned per scenario
    let poNumber: string | undefined;
    if (sc.categoryId !== 'cat-nonpo') {
      const openFactor = sc.failKind === 'PO_EXCEEDED' ? 0.82 : 1.12;
      const po = mkPo(db, sc.vendorCode, sc.department, subtotal, {
        openFactor,
        poType: sc.categoryId === 'cat-material' ? 'MATERIAL' : 'SERVICE',
      });
      poNumber = po.poNumber;
      if (sc.categoryId === 'cat-material') {
        const grnAmount = sc.failKind === 'GRN_MISMATCH' ? Math.round(subtotal * 0.94) : subtotal;
        mkGrn(db, po.poNumber, Math.round(grnAmount * 0.6), invoiceDate);
        mkGrn(db, po.poNumber, grnAmount - Math.round(grnAmount * 0.6), invoiceDate);
      } else if (sc.categoryId === 'cat-service') {
        const sesAmount = sc.failKind === 'SES_MISMATCH' ? Math.round(subtotal * 0.93) : subtotal;
        mkSes(db, po.poNumber, sesAmount, invoiceDate, sc.description);
      } else {
        mkSes(db, po.poNumber, subtotal, invoiceDate, sc.description);
      }
    }

    // Attendance reference data (skip for missing-doc drafts; one vendor+month per invoice)
    if (sc.categoryId === 'cat-manpower' && sc.target !== 'MISSING_DOCS') {
      const targetHours = Math.round(subtotal / 450);
      const seeded = sc.failKind === 'HOURS_MISMATCH' ? Math.round(targetHours * 0.9) : targetHours;
      seedAttendanceHours(db, sc.vendorCode, month, seeded, `BATCH-${month}-${sc.vendorCode}`);
    }
    if (sc.categoryId === 'cat-catering' && sc.target !== 'MISSING_DOCS') {
      const billed = Math.max(50, Math.round(subtotal / 150));
      const eligible = sc.failKind === 'MEAL_EXCESS' ? Math.round(billed * 0.82) : billed;
      seedAttendanceMeals(db, sc.vendorCode, month, eligible, `BATCH-${month}-${sc.vendorCode}`);
    }

    const invoice: Invoice = {
      id: ids.invoice(),
      invoiceNumber: vendorInvoiceNo,
      vendorCode: sc.vendorCode,
      vendorName: vendor.name,
      categoryId: sc.categoryId,
      invoiceDate,
      receivedAt,
      amount: sc.amount,
      subtotal,
      taxAmount,
      currency: 'INR',
      poNumber,
      department: sc.department,
      companyCode: '1000',
      source: sc.daysAgo % 3 === 0 ? 'EMAIL' : sc.daysAgo % 3 === 1 ? 'SHAREPOINT' : 'MANUAL_UPLOAD',
      stage: 'RECEIVED',
      lifecycle: 'DRAFT',
      processingFlag: null,
      slaDueAt: sc.slaBreach ? isoAgo(1 * DAY) : isoIn(3 * DAY),
      slaBreached: sc.slaBreach ?? false,
      assignedTo: sc.assignTo,
      priority: sc.priority ?? (sc.amount > 2_000_000 ? 'HIGH' : 'NORMAL'),
      configVersionId: 'cfg-1',
      correlationId,
      description: sc.description,
      taxReviewRequired: sc.amount >= 1_000_000,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    };
    db.invoices.push(invoice);

    // lines
    db.invoiceLines.push({
      id: ids.generic('LIN'), invoiceId: invoice.id, lineNo: 1,
      description: sc.description, quantity: 1, uom: 'AU', unitPrice: subtotal, amount: subtotal,
      poItem: poNumber ? '00010' : undefined, taxCode: 'G18',
    });

    // documents
    const files = DOC_FILES[sc.categoryId](vendorInvoiceNo.replace(/\//g, '-'))
      .filter((f) => !(sc.omitDocs ?? []).includes(f.documentTypeId));
    for (const f of files) {
      const catDoc = db.categoryDocuments.find(
        (cd) => cd.configVersionId === 'cfg-1' && cd.categoryId === sc.categoryId && cd.documentTypeId === f.documentTypeId
      );
      const sp = SharePointMock.storeDocument(invoice.invoiceNumber, f.fileName);
      db.invoiceDocuments.push({
        id: ids.generic('DOC'),
        invoiceId: invoice.id,
        documentTypeId: f.documentTypeId,
        fileName: f.fileName,
        pages: f.pages,
        sizeKb: 140 + ((f.pages * 137) % 800),
        mimeType: 'application/pdf',
        source: invoice.source,
        sharePointUrl: sp.url,
        checksum: sp.checksum,
        status: 'AVAILABLE',
        extractionStatus: 'PENDING',
        requirementType: catDoc?.requirementType ?? 'OPTIONAL',
        checkMode: catDoc?.checkMode ?? 'AVAILABILITY_ONLY',
        version: 1,
        uploadedBy: invoice.source === 'MANUAL_UPLOAD' ? 'Priya Sharma' : 'AP Automation Engine',
        uploadedAt: receivedAt,
      });
    }

    addTimeline(invoice.id, 'INVOICE_RECEIVED', `Invoice received via ${invoice.source === 'EMAIL' ? 'AP mailbox' : invoice.source === 'SHAREPOINT' ? 'SharePoint monitor' : 'manual portal upload'}`, {
      at: receivedAt, detail: `${files.length} document(s) · correlation ${correlationId}`, status: 'SUCCESS', correlationId,
    });

    if (sc.target === 'RECEIVED') {
      invoice.stage = 'CLASSIFICATION';
      continue;
    }

    addTimeline(invoice.id, 'DOCUMENT_CLASSIFIED', 'Documents classified', {
      at: isoAgo(sc.daysAgo * DAY + 4 * HOUR),
      detail: `Category resolved: ${db.categories.find((c) => c.id === sc.categoryId)?.name}`,
      status: 'SUCCESS', correlationId,
    });

    const complete = runCompleteness(invoice);
    if (sc.target === 'MISSING_DOCS' || !complete) {
      // Extract the documents that ARE available so field values and SAP
      // mapping are visible while the missing document is chased.
      const stage = invoice.stage;
      const flag = invoice.processingFlag;
      runExtraction(invoice, { degradeFieldCodes: sc.degradeFields });
      invoice.stage = stage;
      invoice.processingFlag = flag;
      continue;
    }

    runExtraction(invoice, { degradeFieldCodes: sc.degradeFields });
    if (sc.target === 'EXTRACTION_REVIEW') {
      if (sc.assignTo) invoice.assignedTo = sc.assignTo;
      continue;
    }

    const run = runValidation(invoice, 'PIPELINE');
    if (sc.target === 'VALIDATION_FAILED') {
      if (sc.assignTo) invoice.assignedTo = sc.assignTo;
      continue;
    }
    if (run.outcome !== 'PASS') continue; // safety: scenario expected to pass but failed

    startWorkflow(invoice);
    const instance = db.workflowInstances.find((w) => w.invoiceId === invoice.id)!;
    const steps = () => db.workflowSteps.filter((s) => s.instanceId === instance.id).sort((a, b) => a.stepNo - b.stepNo);
    const userFor = (id: string) => db.users.find((u) => u.id === id)!;

    const approveActive = (comment: string) => {
      const active = steps().find((s) => s.status === 'ACTIVE');
      if (!active) return false;
      const approver = active.assignedTo ? userFor(active.assignedTo) : userFor('u-meera');
      actOnStep(invoice, active, approver, 'APPROVE', comment);
      return true;
    };

    if (sc.target === 'APPROVAL_STEP_1') continue;
    if (sc.target === 'APPROVAL_STEP_2') { approveActive('Reviewed - documents and validation in order.'); continue; }
    if (sc.target === 'TAX_REVIEW') {
      approveActive('AP review completed.');
      approveActive('Department confirms services received.');
      continue;
    }
    if (sc.target === 'REJECTED') {
      approveActive('AP review completed.');
      const active = steps().find((s) => s.status === 'ACTIVE');
      if (active) {
        const approver = active.assignedTo ? userFor(active.assignedTo) : userFor('u-kavitha');
        actOnStep(invoice, active, approver, 'REJECT', 'Quantity billed does not match the service completion certificate shared by site team. Please raise a credit note.');
      }
      continue;
    }

    // Advanced targets: complete workflow deterministically without async jobs
    for (const s of steps()) {
      if (s.status === 'ACTIVE' || s.status === 'PENDING') {
        s.status = 'APPROVED';
        s.actedBy = s.assignedTo ?? 'u-meera';
        s.actedByName = s.assignedToName ?? 'Meera Krishnan';
        s.actedAt = isoAgo(Math.max(0, sc.daysAgo - 1) * DAY);
        s.comment = 'Approved.';
        s.channel = s.stepNo % 2 === 0 ? 'TEAMS' : 'PORTAL';
      }
    }
    instance.status = 'COMPLETED';
    instance.completedAt = isoAgo(Math.max(0, sc.daysAgo - 1) * DAY);
    invoice.lifecycle = 'VALIDATED';
    invoice.processingFlag = null;
    invoice.stage = 'SAP_HANDOFF';
    addTimeline(invoice.id, 'WORKFLOW_COMPLETED', 'All approvals completed', {
      at: instance.completedAt, detail: 'Invoice validated - queued for SAP handoff', status: 'SUCCESS', correlationId,
    });

    if (sc.target === 'VALIDATED_QUEUED') {
      invoice.processingFlag = 'SAP_PENDING';
      db.sapHandoffs.unshift({
        id: ids.handoff(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
        idempotencyKey: `${invoice.id}:${correlationId}`, status: 'QUEUED', attempts: 2,
        createdAt: instance.completedAt!, lastAttemptAt: isoAgo(6 * HOUR),
        message: 'SAP interface degraded - handoff queued for retry', errorCode: 'SAP_RFC_BUSY',
        correlationId, payloadSummary: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, vendorCode: invoice.vendorCode },
      });
      addTimeline(invoice.id, 'SAP_HANDOFF_REQUESTED', 'SAP handoff queued (interface degraded)', {
        detail: 'Retrying with backoff - invoice remains safely queued', status: 'WARNING', correlationId,
      });
      continue;
    }

    // ACK + beyond
    const sapDoc = String(5100003700 + invNoSeq);
    const ackAt = isoAgo(Math.max(0, sc.daysAgo - 2) * DAY);
    const statusMap: Record<string, InvoiceLifecycle> = {
      IN_PROGRESS: 'IN_PROGRESS', PARKED: 'PARKED', POSTED: 'POSTED', PAID: 'PAID',
    };
    const lifecycle = statusMap[sc.target] ?? 'IN_PROGRESS';
    db.sapHandoffs.unshift({
      id: ids.handoff(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      idempotencyKey: `${invoice.id}:${correlationId}`,
      status: lifecycle === 'IN_PROGRESS' ? 'ACKNOWLEDGED' : lifecycle === 'PARKED' ? 'PARKED' : 'POSTED',
      attempts: 1, createdAt: instance.completedAt!, lastAttemptAt: ackAt, acknowledgedAt: ackAt,
      sapDocumentNo: sapDoc, sapFiscalYear: '2026', message: 'Handoff accepted for processing',
      correlationId, payloadSummary: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, vendorCode: invoice.vendorCode },
    });
    invoice.sapDocumentNo = sapDoc;
    invoice.sapFiscalYear = '2026';
    invoice.lifecycle = lifecycle;
    invoice.stage = lifecycle === 'IN_PROGRESS' || lifecycle === 'PARKED' ? 'SAP_PROCESSING' : 'COMPLETED';
    addTimeline(invoice.id, 'SAP_ACKNOWLEDGED', 'SAP acknowledged handoff', {
      at: ackAt, detail: `SAP document ${sapDoc}/2026`, status: 'SUCCESS', reference: sapDoc, correlationId,
    });
    if (lifecycle === 'PARKED') {
      addTimeline(invoice.id, 'SAP_PARKED', 'Invoice parked in SAP', { at: isoAgo(Math.max(0, sc.daysAgo - 3) * DAY), detail: `SAP document ${sapDoc}`, status: 'SUCCESS', correlationId });
    }
    if (lifecycle === 'POSTED' || lifecycle === 'PAID') {
      addTimeline(invoice.id, 'SAP_POSTED', 'Invoice posted in SAP', { at: isoAgo(Math.max(0, sc.daysAgo - 3) * DAY), detail: `SAP document ${sapDoc}`, status: 'SUCCESS', correlationId });
    }
    if (lifecycle === 'PAID') {
      invoice.paymentStatus = 'PAID';
      invoice.paymentDate = isoAgo(Math.max(0, sc.daysAgo - 6) * DAY).slice(0, 10);
      invoice.paymentRef = `PAY-${sapDoc}`;
      addTimeline(invoice.id, 'PAYMENT_SYNCED', 'Payment cleared in SAP', { at: isoAgo(Math.max(0, sc.daysAgo - 6) * DAY), detail: `Payment reference PAY-${sapDoc}`, status: 'SUCCESS', correlationId });
    } else {
      invoice.paymentStatus = 'NOT_DUE';
    }
  }
  markDirty();
}

export const SCENARIOS: Scenario[] = [
  // ---- fully completed lifecycle ----
  { key: 'paid-mat-1', categoryId: 'cat-material', vendorCode: 'V100012', amount: 1_534_000, daysAgo: 28, department: 'Operations', description: 'CS seamless pipes & gate valves - July delivery', target: 'PAID' },
  { key: 'paid-srv-1', categoryId: 'cat-service', vendorCode: 'V200015', amount: 590_000, daysAgo: 26, department: 'Operations', description: 'Rotating equipment maintenance - June cycle', target: 'PAID' },
  { key: 'paid-mnp-1', categoryId: 'cat-manpower', vendorCode: 'V300019', amount: 1_180_000, daysAgo: 32, department: 'Operations', description: 'Contract manpower - plant operations (June)', target: 'PAID' },
  { key: 'paid-mat-2', categoryId: 'cat-material', vendorCode: 'V100048', amount: 708_000, daysAgo: 24, department: 'Operations', description: 'Trunnion ball valves - partial supply', target: 'PAID' },
  { key: 'post-mat-1', categoryId: 'cat-material', vendorCode: 'V100034', amount: 1_180_000, daysAgo: 18, department: 'Projects', description: 'SS316 flanges DN80 - lot 2', target: 'POSTED' },
  { key: 'post-srv-1', categoryId: 'cat-service', vendorCode: 'V200023', amount: 472_000, daysAgo: 15, department: 'Projects', description: 'Instrument calibration & loop checking - phase 2', target: 'POSTED' },
  { key: 'post-cat-1', categoryId: 'cat-catering', vendorCode: 'V400011', amount: 94_400, daysAgo: 16, department: 'Admin & Facilities', description: 'Canteen services - July meal billing', target: 'POSTED' },
  { key: 'post-npo-1', categoryId: 'cat-nonpo', vendorCode: 'V600041', amount: 141_600, daysAgo: 40, department: 'Admin & Facilities', description: 'Office stationery & printer consumables', target: 'POSTED' },
  { key: 'park-mat-1', categoryId: 'cat-material', vendorCode: 'V100077', amount: 2_950_000, daysAgo: 10, department: 'Projects', description: 'LT power cable 3.5C x 300sqmm - drum 1-4', target: 'PARKED' },
  { key: 'park-mnp-1', categoryId: 'cat-manpower', vendorCode: 'V300027', amount: 944_000, daysAgo: 9, department: 'Admin & Facilities', description: 'Facility support manpower - July', target: 'PARKED' },
  { key: 'prog-srv-1', categoryId: 'cat-service', vendorCode: 'V200031', amount: 826_000, daysAgo: 6, department: 'Projects', description: 'NDT inspection services - unit 3 shutdown', target: 'IN_PROGRESS' },
  { key: 'prog-cat-1', categoryId: 'cat-catering', vendorCode: 'V400018', amount: 70_800, daysAgo: 5, department: 'Admin & Facilities', description: 'Night-shift canteen services - July', target: 'IN_PROGRESS' },
  { key: 'queue-srv-1', categoryId: 'cat-service', vendorCode: 'V200015', amount: 649_000, daysAgo: 4, department: 'Operations', description: 'Compressor overhaul support - July', target: 'VALIDATED_QUEUED' },

  // ---- approvals in flight ----
  { key: 'appr1-mat', categoryId: 'cat-material', vendorCode: 'V100012', amount: 1_003_000, daysAgo: 3, department: 'Operations', description: 'Pipe fittings & fasteners - August lot', target: 'APPROVAL_STEP_1', assignTo: 'u-arjun' },
  { key: 'appr2-srv', categoryId: 'cat-service', vendorCode: 'V200023', amount: 531_000, daysAgo: 4, department: 'Projects', description: 'Analyzer AMC - quarterly billing', target: 'APPROVAL_STEP_2', slaBreach: true },
  { key: 'tax-mnp', categoryId: 'cat-manpower', vendorCode: 'V300019', amount: 1_416_000, daysAgo: 5, department: 'Operations', description: 'Contract manpower - plant operations (July)', target: 'TAX_REVIEW', priority: 'HIGH' },
  { key: 'appr1-npo', categoryId: 'cat-nonpo', vendorCode: 'V500021', amount: 259_600, daysAgo: 2, department: 'Operations', description: 'Freight charges - urgent spares movement', target: 'APPROVAL_STEP_1' },
  { key: 'appr2-cat', categoryId: 'cat-catering', vendorCode: 'V400011', amount: 88_500, daysAgo: 3, department: 'Admin & Facilities', description: 'Canteen services - August 1st fortnight', target: 'APPROVAL_STEP_2' },
  { key: 'rej-srv', categoryId: 'cat-service', vendorCode: 'V200031', amount: 413_000, daysAgo: 7, department: 'Projects', description: 'RT film inspection - unit 2', target: 'REJECTED' },

  // ---- validation failures / exceptions ----
  { key: 'fail-grn', categoryId: 'cat-material', vendorCode: 'V100034', amount: 1_121_000, daysAgo: 2, department: 'Projects', description: 'SS fasteners & gaskets supply', target: 'VALIDATION_FAILED', failKind: 'GRN_MISMATCH', assignTo: 'u-priya', slaBreach: true },
  { key: 'fail-po', categoryId: 'cat-service', vendorCode: 'V200015', amount: 767_000, daysAgo: 3, department: 'Operations', description: 'Additional maintenance manhours - July', target: 'VALIDATION_FAILED', failKind: 'PO_EXCEEDED', assignTo: 'u-arjun' },
  { key: 'fail-ses', categoryId: 'cat-service', vendorCode: 'V200023', amount: 448_400, daysAgo: 1, department: 'Projects', description: 'Instrumentation cabling - tranche 3', target: 'VALIDATION_FAILED', failKind: 'SES_MISMATCH' },
  { key: 'fail-meal', categoryId: 'cat-catering', vendorCode: 'V400018', amount: 82_600, daysAgo: 12, department: 'Admin & Facilities', description: 'Canteen services - July supplementary', target: 'VALIDATION_FAILED', failKind: 'MEAL_EXCESS', assignTo: 'u-priya', slaBreach: true },
  { key: 'fail-hours', categoryId: 'cat-manpower', vendorCode: 'V300027', amount: 1_062_000, daysAgo: 13, department: 'Admin & Facilities', description: 'Facility manpower - July interim', target: 'VALIDATION_FAILED', failKind: 'HOURS_MISMATCH', priority: 'HIGH' },

  // ---- extraction review (HITL) ----
  { key: 'hitl-1', categoryId: 'cat-material', vendorCode: 'V100048', amount: 861_400, daysAgo: 1, department: 'Operations', description: 'Control valve spares - scanned copy', target: 'EXTRACTION_REVIEW', degradeFields: ['PO_NUMBER', 'INVOICE_DATE'], assignTo: 'u-priya' },
  { key: 'hitl-2', categoryId: 'cat-nonpo', vendorCode: 'V500021', amount: 194_700, daysAgo: 1, department: 'Projects', description: 'Detention & warehousing charges', target: 'EXTRACTION_REVIEW', degradeFields: ['INVOICE_AMOUNT', 'TAX_AMOUNT'] },
  { key: 'hitl-3', categoryId: 'cat-service', vendorCode: 'V200031', amount: 366_800, daysAgo: 0, department: 'Projects', description: 'PAUT inspection - handwritten SES', target: 'EXTRACTION_REVIEW', degradeFields: ['SES_NUMBER'] },

  // ---- missing documents ----
  { key: 'miss-1', categoryId: 'cat-material', vendorCode: 'V100077', amount: 590_000, daysAgo: 1, department: 'Projects', description: 'Cable trays & accessories', target: 'MISSING_DOCS', omitDocs: ['dt-grn', 'dt-tax'] },
  { key: 'miss-2', categoryId: 'cat-manpower', vendorCode: 'V300019', amount: 731_600, daysAgo: 2, department: 'Operations', description: 'Contract manpower - August interim', target: 'MISSING_DOCS', omitDocs: ['dt-attendance', 'dt-manhour'] },
  { key: 'miss-3', categoryId: 'cat-nonpo', vendorCode: 'V600041', amount: 129_800, daysAgo: 0, department: 'Admin & Facilities', description: 'Deep-clean services - admin block', target: 'MISSING_DOCS', omitDocs: ['dt-dept'] },

  // ---- just received ----
  { key: 'new-1', categoryId: 'cat-material', vendorCode: 'V100012', amount: 424_800, daysAgo: 0, department: 'Operations', description: 'Gasket kits - emergency purchase', target: 'RECEIVED' },
  { key: 'new-2', categoryId: 'cat-service', vendorCode: 'V200015', amount: 507_400, daysAgo: 0, department: 'Operations', description: 'HVAC maintenance - August', target: 'RECEIVED' },
];
