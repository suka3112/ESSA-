import type { Database } from '../../core/store';
import { getDb, markDirty, persist } from '../../core/store';
import { DAY, HOUR, ids, isoAgo } from '../../core/ids';
import { DOA_MATRIX, PERMISSIONS, ROLES, USERS } from './identity';
import { EXCEPTION_CODES, REMINDER_RULES, SLA_RULES } from './sla';
import { recomputeAllSla } from '../../core/sla';
import {
  CATEGORIES, CATEGORY_DOCUMENTS, CONFIG_VERSIONS, DOCUMENT_FIELDS, DOCUMENT_TYPES,
  EXTRACTION_PROFILES, FIELD_MAPPINGS, NOTIFICATION_RULES, PROMPT_TEMPLATES,
  RULE_OPERANDS, VALIDATION_RULES, WORKFLOW_DEFINITIONS,
} from './configuration';
import { SAP_GRNS, SAP_POS, SAP_SES, VENDORS, VENDOR_CONTROLS } from './sap';
import { SCENARIOS, seedInvoices } from './invoices';
import { audit } from '../../core/audit';
import { techLog } from '../../core/logger';

/**
 * Bump this whenever the seed dataset changes materially - existing local
 * snapshots reseed automatically on next server start.
 */
export const SEED_VERSION = 3;

export function buildBaseDb(): Database {
  return {
    _seedVersion: SEED_VERSION,
    users: structuredClone(USERS),
    roles: structuredClone(ROLES),
    permissions: structuredClone(PERMISSIONS),
    configVersions: structuredClone(CONFIG_VERSIONS),
    categories: structuredClone(CATEGORIES),
    documentTypes: structuredClone(DOCUMENT_TYPES),
    categoryDocuments: structuredClone(CATEGORY_DOCUMENTS),
    documentFields: structuredClone(DOCUMENT_FIELDS),
    promptTemplates: structuredClone(PROMPT_TEMPLATES),
    extractionProfiles: structuredClone(EXTRACTION_PROFILES),
    fieldMappings: structuredClone(FIELD_MAPPINGS),
    validationRules: structuredClone(VALIDATION_RULES),
    ruleOperands: structuredClone(RULE_OPERANDS),
    invoices: [],
    invoiceLines: [],
    invoiceDocuments: [],
    extractionRuns: [],
    extractedFields: [],
    validationRuns: [],
    validationResults: [],
    exceptions: [],
    workflowDefinitions: structuredClone(WORKFLOW_DEFINITIONS),
    workflowInstances: [],
    workflowSteps: [],
    doaMatrix: structuredClone(DOA_MATRIX),
    slaRules: structuredClone(SLA_RULES),
    reminderRules: structuredClone(REMINDER_RULES),
    exceptionCodes: structuredClone(EXCEPTION_CODES),
    vendors: structuredClone(VENDORS),
    vendorControls: structuredClone(VENDOR_CONTROLS),
    vendorControlHistory: [
      { id: 'vch-1', vendorCode: 'V700052', action: 'NEGATIVE_MARKED', reason: 'Repeated billing discrepancies under investigation (internal audit ref IA-2026-114)', by: 'u-meera', byName: 'Maya Puspita', at: isoAgo(14 * DAY) },
      { id: 'vch-2', vendorCode: 'V500033', action: 'DISABLED', reason: 'Pending contract renewal - AP automation suspended', by: 'u-meera', byName: 'Maya Puspita', at: isoAgo(21 * DAY) },
      { id: 'vch-3', vendorCode: 'V400018', action: 'ENABLED', reason: 'Onboarding completed after successful pilot', by: 'u-suresh', byName: 'Surya Nugraha', at: isoAgo(60 * DAY) },
    ],
    sapPurchaseOrders: structuredClone(SAP_POS),
    sapGrns: structuredClone(SAP_GRNS),
    sapSes: structuredClone(SAP_SES),
    sapHandoffs: [],
    integrationHealth: {
      sapState: 'CONNECTED',
      sapMessage: 'SAP interface responding normally',
      referenceDataSyncedAt: isoAgo(3 * HOUR),
      referenceDataStale: false,
      sharePointState: 'CONNECTED',
      mailboxState: 'CONNECTED',
      gptState: 'CONNECTED',
      biometricLastPushAt: isoAgo(11 * HOUR),
      teamsState: 'CONNECTED',
    },
    attendanceRecords: [],
    attendanceBatches: [],
    emailItems: [],
    sharePointItems: [],
    notifications: [],
    notificationRules: structuredClone(NOTIFICATION_RULES),
    auditEvents: [],
    technicalLogs: [],
    integrationJobs: [],
    timelineEvents: [],
  };
}

export function runScenarioSeed(): void {
  const db = getDb();
  // Everything the pipeline stamps while the seed runs carries this moment;
  // it is what tells the re-stamping passes below which records are "seeded
  // now" and therefore need to be moved onto the invoice's own history.
  const seedStartedAt = new Date().toISOString();

  seedInvoices(db, SCENARIOS);

  // attendance batches summary
  const batches = new Map<string, { count: number; vendor: string }>();
  db.attendanceRecords.forEach((r) => {
    const b = batches.get(r.batchId) ?? { count: 0, vendor: r.vendorCode };
    b.count += 1;
    batches.set(r.batchId, b);
  });
  let bi = 0;
  batches.forEach((v, k) => {
    bi += 1;
    db.attendanceBatches.push({
      id: k,
      source: 'ESSA-MIS',
      receivedAt: isoAgo((2 + bi) * DAY),
      recordCount: v.count,
      accepted: v.count,
      duplicates: 0,
      rejected: 0,
      status: 'PROCESSED',
      correlationId: ids.correlation(),
    });
  });

  // ---- ingestion monitors ----
  const inv = (key: number) => db.invoices[key];
  db.emailItems.push(
    { id: 'em-1', sender: 'billing@nusantaraindustrialsupplies.co.id', subject: `Tax Invoice ${inv(0)?.invoiceNumber ?? ''} - July supplies`, receivedAt: isoAgo(28 * DAY), attachments: [{ fileName: 'TaxInvoice.pdf', sizeKb: 412 }, { fileName: 'GRN.pdf', sizeKb: 188 }], status: 'PROCESSED', invoiceId: inv(0)?.id },
    { id: 'em-2', sender: 'accounts@teknoservisrekayasa.co.id', subject: 'Invoice - Rotating equipment maintenance June', receivedAt: isoAgo(26 * DAY), attachments: [{ fileName: 'ServiceInvoice.pdf', sizeKb: 356 }], status: 'PROCESSED', invoiceId: inv(1)?.id },
    { id: 'em-3', sender: 'ap-invoices@karyatenagamandiri.co.id', subject: 'Manpower invoice July with timesheets', receivedAt: isoAgo(5 * DAY), attachments: [{ fileName: 'ManpowerInvoice.pdf', sizeKb: 298 }, { fileName: 'Timesheet.pdf', sizeKb: 1240 }, { fileName: 'AttendanceSheet.pdf', sizeKb: 920 }], status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('plant operations (July)'))?.id },
    { id: 'em-4', sender: 'noreply@dropbox-share.com', subject: 'Your invoice is ready for download', receivedAt: isoAgo(2 * DAY), attachments: [], status: 'IGNORED', error: 'Cloud link attachments are not accepted per file security policy' },
    { id: 'em-5', sender: 'billing@sterlingpipanusantara.co.id', subject: 'Invoice SS fasteners - August', receivedAt: isoAgo(2 * DAY), attachments: [{ fileName: 'Invoice_scan.pdf', sizeKb: 3180 }], status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('SS fasteners'))?.id },
    { id: 'em-6', sender: 'accounts@sinartransluwuk.co.id', subject: 'Freight bills - multiple invoices combined', receivedAt: isoAgo(1 * DAY), attachments: [{ fileName: 'Combined_Bills.pdf', sizeKb: 5230 }], status: 'ERROR', error: 'PDF contains multiple invoices - rejected for resubmission (one PDF = one invoice)' },
    { id: 'em-7', sender: 'billing@daunhijaukantin.co.id', subject: 'Canteen billing August 1st fortnight', receivedAt: isoAgo(8 * HOUR), attachments: [{ fileName: 'CateringInvoice.pdf', sizeKb: 240 }], status: 'PROCESSING' },
  );
  db.sharePointItems.push(
    { id: 'sp-1', folder: '/AP-Inbox/Material', fileName: 'HindustanElectricals_CableInvoice_Aug.pdf', modifiedAt: isoAgo(10 * DAY), sizeKb: 640, status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('LT power cable'))?.id },
    { id: 'sp-2', folder: '/AP-Inbox/Services', fileName: 'Meridian_NDT_Unit3.pdf', modifiedAt: isoAgo(6 * DAY), sizeKb: 480, status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('NDT inspection'))?.id },
    { id: 'sp-3', folder: '/AP-Inbox/Services', fileName: 'Apex_AnalyzerAMC_Q2.pdf', modifiedAt: isoAgo(4 * DAY), sizeKb: 520, status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('Analyzer AMC'))?.id },
    { id: 'sp-4', folder: '/AP-Inbox/Material', fileName: 'KirloskarValves_ControlValveSpares.pdf', modifiedAt: isoAgo(1 * DAY), sizeKb: 2890, status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('Control valve spares'))?.id },
    { id: 'sp-5', folder: '/AP-Inbox/NonPO', fileName: 'CrystalClean_DeepClean_Aug.pdf', modifiedAt: isoAgo(9 * HOUR), sizeKb: 210, status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('Deep-clean'))?.id },
    { id: 'sp-6', folder: '/AP-Inbox/Material', fileName: 'corrupted_scan_004.pdf', modifiedAt: isoAgo(5 * HOUR), sizeKb: 90, status: 'ERROR' },
  );

  // ---- assorted access/config audit events ----
  // Each carries the before/after values it changed, because the Audit Log now
  // shows what actually changed as Field / Before / After rather than a bare
  // action name (review, 24 Aug — Pranay).
  const baseEvents: {
    d: number; actor: (typeof USERS)[number]; type: string; cat: 'CONFIGURATION' | 'VENDOR' | 'ACCESS';
    action: string; entity: string; id: string; ref: string; reason: string;
    before?: Record<string, unknown>; after?: Record<string, unknown>;
  }[] = [
    {
      d: 45, actor: USERS[5], type: 'CONFIG_PUBLISHED', cat: 'CONFIGURATION', action: 'PUBLISH',
      entity: 'CONFIGURATION', id: 'cfg-1', ref: 'v1.0', reason: 'Baseline configuration activated',
      before: { Status: 'Testing' }, after: { Status: 'Active' },
    },
    {
      d: 14, actor: USERS[4], type: 'VENDOR_NEGATIVE_MARKED', cat: 'VENDOR', action: 'NEGATIVE_FLAG',
      entity: 'VENDOR', id: 'V700052', ref: 'PT Sentosa Office Supplies', reason: 'Repeated billing discrepancies under investigation',
      before: { 'Negative vendor flag': 'No', 'AP automation': 'Enabled' },
      after: { 'Negative vendor flag': 'Yes', 'AP automation': 'Disabled' },
    },
    {
      d: 9, actor: USERS[5], type: 'CONFIG_DRAFT_CREATED', cat: 'CONFIGURATION', action: 'CREATE',
      entity: 'CONFIGURATION', id: 'cfg-2', ref: 'v1.1', reason: 'Draft for manpower tolerance tightening',
      after: { Version: 'v1.1', Status: 'Draft' },
    },
    {
      d: 7, actor: USERS[5], type: 'ROLE_ASSIGNED', cat: 'ACCESS', action: 'ASSIGN',
      entity: 'USER', id: 'u-ananya', ref: 'Ayu Lestari', reason: 'Access review - portal account closed',
      before: { Roles: 'AP Processor', Status: 'Active' }, after: { Roles: 'None', Status: 'Inactive' },
    },
    {
      d: 3, actor: USERS[5], type: 'USER_DISABLED', cat: 'ACCESS', action: 'DISABLE',
      entity: 'USER', id: 'u-deepak', ref: 'Dimas Prakoso', reason: 'On long leave - access suspended per policy',
      before: { Status: 'Active' }, after: { Status: 'Inactive' },
    },
  ];
  for (const e of baseEvents) {
    audit({
      eventTime: isoAgo(e.d * DAY),
      actorType: 'USER', actorId: e.actor.id, actorName: e.actor.name, actorRole: e.actor.title,
      eventType: e.type, category: e.cat, action: e.action, module: e.cat.toLowerCase(),
      entityType: e.entity, entityId: e.id, entityRef: e.ref,
      result: 'SUCCESS', reason: e.reason, oldValue: e.before, newValue: e.after,
      correlationId: ids.correlation(), source: 'PORTAL',
    });
  }

  // login events for demo users. Note the db holds a clone of USERS, so the
  // last-sign-in stamp has to be written onto the db record, not the constant.
  for (const u of db.users.slice(0, 6)) {
    audit({
      eventTime: isoAgo(Math.floor(Math.random() * 3) * DAY + 2 * HOUR),
      actorType: 'USER', actorId: u.id, actorName: u.name, actorRole: u.title,
      eventType: 'LOGIN_SUCCESS', category: 'AUTHENTICATION', action: 'LOGIN', module: 'identity-access',
      // The reference a person recognises is who signed in, not a session id.
      entityType: 'SESSION', entityId: ids.generic('SES'), entityRef: u.name, result: 'SUCCESS',
      correlationId: ids.correlation(), source: 'ENTRA_SSO',
    });
    u.lastLoginAt = isoAgo(Math.floor(Math.random() * 2) * DAY + HOUR);
  }

  // ---- Audit coherence -----------------------------------------------------
  // The pipeline stamps its audit records with the moment they ran, which for
  // seeded history is "now" — so an invoice received three weeks ago appeared
  // to have been extracted this morning. Re-stamp each invoice's audit trail
  // across its own timeline, keeping the recorded order, so the Audit Log reads
  // consistently with the invoice dates everywhere else in the product.
  restampInvoiceHistory(db, seedStartedAt);
  restampInvoiceAudit(db);
  restampExceptions(db);

  // ---- SLA coherence -------------------------------------------------------
  // One SLA clock per invoice, resolved from the state it is actually in, so a
  // Paid or Rejected invoice never shows a breach and a breach always has a
  // stage behind it (ESSA EAPA SLA Matrix).
  recomputeAllSla(db);

  techLog({ module: 'seed', event: 'SEED_COMPLETED', message: `Demo dataset seeded: ${db.invoices.length} invoices, ${db.vendors.length} vendors, ${db.exceptions.length} exceptions, ${db.validationRules.length} rules, ${db.attendanceRecords.length} attendance records` });
  markDirty();
  persist();
}

/**
 * Spread each invoice's audit records across that invoice's own history.
 *
 * The seed runs the real pipeline, so every audit record it produces carries
 * the seeding timestamp. Left alone, the Audit Log would claim that an invoice
 * received four weeks ago was extracted, validated and approved in the same
 * second this morning — which is exactly the kind of inconsistency the review
 * asked us to clear out of the synthetic data.
 *
 * Records keep the order the pipeline wrote them in; only the clock changes.
 */
function restampInvoiceAudit(db: Database): void {
  const firstAt = new Map<string, number>();
  const lastAt = new Map<string, number>();
  for (const ev of db.timelineEvents) {
    const t = new Date(ev.at).getTime();
    if (Number.isNaN(t)) continue;
    const lo = firstAt.get(ev.invoiceId);
    const hi = lastAt.get(ev.invoiceId);
    if (lo === undefined || t < lo) firstAt.set(ev.invoiceId, t);
    if (hi === undefined || t > hi) lastAt.set(ev.invoiceId, t);
  }

  const byInvoice = new Map<string, typeof db.auditEvents>();
  for (const ev of db.auditEvents) {
    if (!ev.invoiceId) continue;
    const list = byInvoice.get(ev.invoiceId) ?? [];
    list.push(ev);
    byInvoice.set(ev.invoiceId, list);
  }

  for (const [invoiceId, events] of byInvoice) {
    const invoice = db.invoices.find((i) => i.id === invoiceId);
    if (!invoice) continue;
    const start = firstAt.get(invoiceId) ?? new Date(invoice.receivedAt).getTime();
    const end = Math.max(lastAt.get(invoiceId) ?? start, start + 5 * 60 * 1000);
    // db.auditEvents is newest-first, so walk this invoice's slice backwards to
    // lay the records out from the invoice's arrival to its latest activity.
    const ordered = [...events].reverse();
    const step = (end - start) / Math.max(1, ordered.length - 1);
    ordered.forEach((ev, i) => {
      ev.eventTime = new Date(start + step * i).toISOString();
    });
  }

  db.auditEvents.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
}

/**
 * Exceptions are raised by the pipeline as the seed runs, so — like the audit
 * records — they all carried the seeding timestamp and an invoice received in
 * July appeared to have raised its exception this morning. Each exception is
 * moved onto its own invoice's clock instead.
 */
function restampExceptions(db: Database): void {
  for (const ex of db.exceptions) {
    const invoice = db.invoices.find((i) => i.id === ex.invoiceId);
    if (!invoice) continue;
    // An exception is raised while the invoice is being processed, which is
    // within hours of it arriving — not on the day the demo data was built.
    const events = db.timelineEvents.filter((t) => t.invoiceId === ex.invoiceId).map((t) => t.at).sort();
    const raisedAt = events.find((at) => at > invoice.receivedAt) ?? invoice.receivedAt;
    ex.createdAt = raisedAt;
    ex.slaDueAt = invoice.slaDueAt || raisedAt;
    ex.actions?.forEach((a) => { a.at = raisedAt; });
  }
}

/**
 * Move the timeline entries the pipeline wrote during seeding onto the
 * invoice's own history.
 *
 * Classification, extraction, completeness and validation all happen within
 * hours of an invoice arriving. Because the seed replays the real pipeline,
 * those entries were stamped with the moment the demo data was built — so an
 * invoice received in July showed "Extraction completed" today. They are laid
 * out across the first few hours after the invoice was received instead, in the
 * order they actually ran, which keeps the Timeline, the Audit Log and the
 * invoice dates telling the same story (review, 24 Aug: synthetic data must be
 * consistent).
 */
function restampInvoiceHistory(db: Database, seedStartedAt: string): void {
  const byInvoice = new Map<string, typeof db.timelineEvents>();
  for (const ev of db.timelineEvents) {
    if (ev.at < seedStartedAt) continue; // genuine historical entry — leave it
    const list = byInvoice.get(ev.invoiceId) ?? [];
    list.push(ev);
    byInvoice.set(ev.invoiceId, list);
  }

  const HOUR_MS = 60 * 60 * 1000;
  for (const [invoiceId, events] of byInvoice) {
    const invoice = db.invoices.find((i) => i.id === invoiceId);
    if (!invoice) continue;
    const received = new Date(invoice.receivedAt).getTime();
    // Keep the order the pipeline produced (oldest first) and lay the entries
    // out over the six hours after the invoice was received.
    const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
    const gap = (6 * HOUR_MS) / (ordered.length + 1);
    ordered.forEach((ev, i) => {
      const at = received + gap * (i + 1);
      // Never move an entry into the future.
      ev.at = new Date(Math.min(at, Date.now() - 60_000)).toISOString();
    });
  }
}
