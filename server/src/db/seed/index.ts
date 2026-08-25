import type { Database } from '../../core/store';
import { getDb, markDirty, persist } from '../../core/store';
import { DAY, HOUR, ids, isoAgo } from '../../core/ids';
import { DOA_MATRIX, PERMISSIONS, ROLES, USERS } from './identity';
import { BUSINESS_CALENDARS, EXCEPTION_CODES, SLA_POLICIES } from './sla';
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
export const SEED_VERSION = 6;

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
    slaPolicies: structuredClone(SLA_POLICIES),
    businessCalendars: structuredClone(BUSINESS_CALENDARS),
    exceptionCodes: structuredClone(EXCEPTION_CODES),
    vendors: structuredClone(VENDORS),
    vendorControls: structuredClone(VENDOR_CONTROLS),
    // All five PAU vendors are enabled and none is negative-listed (sample
    // data). The history records their onboarding onto the AP automation.
    vendorControlHistory: [
      { id: 'vch-1', vendorCode: '30000956', action: 'ENABLED', reason: 'Onboarded — welding & fitting manpower contract PO 4203000546 (BAP)', by: 'u-suresh', byName: 'Surya Nugraha', at: '2025-07-01T02:15:00.000Z' },
      { id: 'vch-2', vendorCode: '30000731', action: 'ENABLED', reason: 'Onboarded — project services contract PO 4203000843 (BAP)', by: 'u-suresh', byName: 'Surya Nugraha', at: '2025-09-08T03:40:00.000Z' },
      { id: 'vch-3', vendorCode: '30000512', action: 'ENABLED', reason: 'Onboarded — catering PO 4203000502 and camp maintenance PO 4203001027', by: 'u-suresh', byName: 'Surya Nugraha', at: '2025-10-13T02:05:00.000Z' },
      { id: 'vch-4', vendorCode: '40000143', action: 'ENABLED', reason: 'Onboarded — foreign vendor (USD), Fisher spares PO 4202000128', by: 'u-suresh', byName: 'Surya Nugraha', at: '2026-01-19T04:30:00.000Z' },
      { id: 'vch-5', vendorCode: '30000318', action: 'ENABLED', reason: 'Onboarded — travel agent, Non-PO invoices with billing statements', by: 'u-suresh', byName: 'Surya Nugraha', at: '2026-02-02T02:50:00.000Z' },
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
  // One batch per vendor and service period, received when ESSA MIS pushed it
  // (two days after the period closed), so the integration page and the
  // invoices it feeds agree on the dates.
  const batches = new Map<string, { count: number; vendor: string; pushedAt: string }>();
  db.attendanceRecords.forEach((r) => {
    const b = batches.get(r.batchId) ?? { count: 0, vendor: r.vendorCode, pushedAt: r.pushedAt };
    b.count += 1;
    if (r.pushedAt > b.pushedAt) b.pushedAt = r.pushedAt;
    batches.set(r.batchId, b);
  });
  batches.forEach((v, k) => {
    db.attendanceBatches.push({
      id: k,
      source: 'ESSA-MIS',
      receivedAt: v.pushedAt,
      recordCount: v.count,
      accepted: v.count,
      duplicates: 0,
      rejected: 0,
      status: 'PROCESSED',
      correlationId: ids.correlation(),
    });
  });
  db.attendanceBatches.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  db.integrationHealth.biometricLastPushAt = db.attendanceBatches[0]?.receivedAt ?? db.integrationHealth.biometricLastPushAt;

  // ---- ingestion monitors ----
  // Every monitor row points at a seeded invoice by its real invoice number, so
  // the Email / SharePoint monitors, the invoice list and the documents tab all
  // tell the same story. Sender addresses are the vendors' own.
  const byNo = (invoiceNumber: string) => {
    const found = db.invoices.find((i) => i.invoiceNumber === invoiceNumber);
    if (!found) throw new Error(`Seed: monitor row refers to unknown invoice ${invoiceNumber}`);
    return found;
  };
  const mail = (id: string, invoiceNumber: string, sender: string, subject: string, attachments: { fileName: string; sizeKb: number }[]) => {
    const invoice = byNo(invoiceNumber);
    db.emailItems.push({ id, sender, subject, receivedAt: invoice.receivedAt, attachments, status: 'PROCESSED', invoiceId: invoice.id });
  };
  mail('em-1', '6581888', 'joycevenice.canonce@emerson.com', 'Emerson invoice 6581888 — PO 4202000128 (repair kits, Fisher)', [{ fileName: 'Invoice_6581888.pdf', sizeKb: 186 }, { fileName: 'PO_4202000128.pdf', sizeKb: 244 }, { fileName: 'GRN_5000001927.pdf', sizeKb: 122 }, { fileName: 'PIB_064581216.pdf', sizeKb: 310 }]);
  mail('em-2', '090/BBS-INV/04/2026', 'finance@baasithu.co.id', 'Invoice 090/BBS-INV/04/2026 — Camp Maintenance Service March 2026', [{ fileName: '090_BBS-INV_04_2026.pdf', sizeKb: 402 }, { fileName: 'SES_8000003051.pdf', sizeKb: 164 }, { fileName: 'Faktur_Pajak_090.pdf', sizeKb: 148 }]);
  mail('em-3', 'INV/TD/000591/2026', 'billing@wisatakawan.co.id', 'INV/TD/000591/2026 — Ticket domestic Batik Air ID 6295 (Tra_5840)', [{ fileName: 'INV_TD_000591_2026.pdf', sizeKb: 96 }, { fileName: 'Bill_State_010_FEBRUARI_2026.pdf', sizeKb: 1180 }]);
  mail('em-4', '010/FEBRUARI/2026', 'billing@wisatakawan.co.id', 'Billing statement 010/FEBRUARI/2026 — PAU travel 16–28 Feb 2026', [{ fileName: 'Bill_State_010_FEBRUARI_2026.pdf', sizeKb: 1180 }, { fileName: 'Vouchers_010_FEBRUARI_2026.pdf', sizeKb: 3860 }]);
  mail('em-5', '6604512', 'joycevenice.canonce@emerson.com', 'Emerson invoice 6604512 — PO 4202000141 (repair kits, Fisher)', [{ fileName: 'Invoice_6604512.pdf', sizeKb: 184 }, { fileName: 'PO_4202000141.pdf', sizeKb: 240 }, { fileName: 'GRN_5000002144.pdf', sizeKb: 120 }]);
  mail('em-6', '014/JUNI/2026', 'billing@wisatakawan.co.id', 'Billing statement 014/JUNI/2026 — PAU travel 16–30 June 2026', [{ fileName: 'Bill_State_014_JUNI_2026.pdf', sizeKb: 1210 }, { fileName: 'Vouchers_014_JUNI_2026.pdf', sizeKb: 3540 }]);
  mail('em-7', '017/JULI/2026', 'billing@wisatakawan.co.id', 'Billing statement 017/JULI/2026 — PAU travel 16–31 July 2026', [{ fileName: 'Bill_State_017_JULI_2026.pdf', sizeKb: 1195 }, { fileName: 'Vouchers_017_JULI_2026.pdf', sizeKb: 3610 }]);
  mail('em-8', '6609230', 'joycevenice.canonce@emerson.com', 'Emerson invoice 6609230 — PO 4202000141 (sales order 9301184)', [{ fileName: 'Invoice_6609230.pdf', sizeKb: 182 }, { fileName: 'PO_4202000141.pdf', sizeKb: 240 }]);
  mail('em-9', '018/AGUSTUS/2026', 'billing@wisatakawan.co.id', 'Billing statement 018/AGUSTUS/2026 — PAU travel 1–15 Aug 2026', [{ fileName: 'Bill_State_018_AGUSTUS_2026.pdf', sizeKb: 1174 }]);
  db.emailItems.push(
    { id: 'em-10', sender: 'no-reply@wetransfer.com', subject: 'Baasithu sent you files — invoice August', receivedAt: isoAgo(2 * DAY + 3 * HOUR), attachments: [], status: 'IGNORED', error: 'Cloud link attachments are not accepted per file security policy — vendor asked to resend the PDF' },
    { id: 'em-11', sender: 'billing@wisatakawan.co.id', subject: 'August vouchers — combined', receivedAt: isoAgo(1 * DAY + 5 * HOUR), attachments: [{ fileName: 'August_vouchers_combined.pdf', sizeKb: 5230 }], status: 'ERROR', error: 'PDF contains 6 invoices — rejected for resubmission (one PDF = one invoice)' },
    { id: 'em-12', sender: 'finance@baasithu.co.id', subject: 'Invoice 100/BBS-INV/08/2026 — Camp Maintenance Service August 2026', receivedAt: isoAgo(2 * HOUR), attachments: [{ fileName: '100_BBS-INV_08_2026.pdf', sizeKb: 398 }, { fileName: 'SES_8000003602.pdf', sizeKb: 162 }], status: 'PROCESSING' },
  );
  const spItem = (id: string, invoiceNumber: string, folder: string, fileName: string, sizeKb: number) => {
    const invoice = byNo(invoiceNumber);
    db.sharePointItems.push({ id, folder, fileName, modifiedAt: invoice.receivedAt, sizeKb, status: 'PROCESSED', invoiceId: invoice.id });
  };
  spItem('sp-1', '187/BBS-PI/XII/2025', '/AP-Inbox/Catering', 'Baasithu_187_BBS-PI_XII_2025_Meal_Nov2025.pdf', 640);
  spItem('sp-2', '190/BBS-PI/I/2026', '/AP-Inbox/Catering', 'Baasithu_190_BBS-PI_I_2026_Meal_Dec2025.pdf', 648);
  spItem('sp-3', '194/BBS-PI/II/2026', '/AP-Inbox/Catering', 'Baasithu_194_BBS-PI_II_2026_Meal_Jan2026.pdf', 652);
  spItem('sp-4', '214/BBS-PI/VII/2026', '/AP-Inbox/Catering', 'Baasithu_214_BBS-PI_VII_2026_Meal_Jun2026.pdf', 646);
  spItem('sp-5', '218/BBS-PI/VIII/2026', '/AP-Inbox/Catering', 'Baasithu_218_BBS-PI_VIII_2026_Meal_Jul2026.pdf', 650);
  db.sharePointItems.push(
    { id: 'sp-6', folder: '/AP-Inbox/Catering', fileName: 'scan_0004.pdf', modifiedAt: isoAgo(5 * HOUR), sizeKb: 90, status: 'ERROR' },
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
      d: 45, actor: USERS[5], type: 'CONFIG_CATEGORY_UPDATE', cat: 'CONFIGURATION', action: 'UPDATE',
      entity: 'INVOICE_CATEGORY', id: 'cat-catering', ref: 'Catering Invoice',
      reason: 'Guest allowance agreed with the site team',
      before: { 'Guest allowance': '0%' }, after: { 'Guest allowance': '5%' },
    },
    {
      d: 14, actor: USERS[5], type: 'CONFIG_WORKFLOW_UPDATE', cat: 'CONFIGURATION', action: 'UPDATE',
      entity: 'WORKFLOW_DEFINITION', id: 'wf-po', ref: 'PO Invoice Approval', reason: 'DoA alignment — Final Approval level for high-value PO invoices',
      before: { 'Final Approval threshold': 'IDR 500,000,000' }, after: { 'Final Approval threshold': 'IDR 1,000,000,000' },
    },
    {
      d: 9, actor: USERS[5], type: 'CONFIG_RULE_UPDATE', cat: 'CONFIGURATION', action: 'UPDATE',
      entity: 'VALIDATION_RULE', id: 'rule-mnp-001', ref: 'Manpower N-way tolerance',
      reason: 'Tightened after the July reconciliation review',
      before: { Tolerance: '2.0%' }, after: { Tolerance: '1.0%' },
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
  restampInvoiceAudit(db, seedStartedAt);

  // ---- SLA coherence -------------------------------------------------------
  // One SLA clock per invoice, resolved from the state it is actually in, so a
  // Paid or Rejected invoice never shows a breach and a breach always has a
  // stage behind it (ESSA EAPA SLA Matrix). Runs before the exceptions are
  // re-stamped so each exception carries its invoice's real due date.
  recomputeAllSla(db);
  restampExceptions(db, seedStartedAt);

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
function restampInvoiceAudit(db: Database, seedStartedAt: string): void {
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

  // An audit record that has a timeline entry of the same kind takes that
  // entry's time (extraction ↔ EXTRACTION_COMPLETED, validation ↔
  // VALIDATION_COMPLETED, ...); anything else is laid out across the invoice's
  // own history in the order it was written.
  const TIMELINE_FOR_AUDIT: Record<string, string> = {
    EXTRACTION_COMPLETED: 'EXTRACTION_COMPLETED', VALIDATION_COMPLETED: 'VALIDATION_COMPLETED', INVOICE_VALIDATED: 'VALIDATION_COMPLETED',
    EXCEPTION_CREATED: 'EXCEPTION_CREATED', DOCUMENT_CLASSIFIED: 'DOCUMENT_CLASSIFIED', COMPLETENESS_CHECKED: 'COMPLETENESS_CHECKED',
    APPROVAL_REQUESTED: 'APPROVAL_REQUESTED', WORKFLOW_STARTED: 'WORKFLOW_STARTED', DOWNSTREAM_HANDOFF_REQUESTED: 'WORKFLOW_COMPLETED',
  };
  for (const [invoiceId, events] of byInvoice) {
    const invoice = db.invoices.find((i) => i.id === invoiceId);
    if (!invoice) continue;
    const timeline = db.timelineEvents.filter((t) => t.invoiceId === invoiceId);
    const start = firstAt.get(invoiceId) ?? new Date(invoice.receivedAt).getTime();
    const end = Math.max(lastAt.get(invoiceId) ?? start, start + 5 * 60 * 1000);
    // db.auditEvents is newest-first, so walk this invoice's slice backwards to
    // lay the records out from the invoice's arrival to its latest activity.
    const ordered = [...events].reverse().filter((ev) => ev.eventTime >= seedStartedAt);
    const step = (end - start) / Math.max(1, ordered.length - 1);
    ordered.forEach((ev, i) => {
      const match = timeline.find((t) => t.event === TIMELINE_FOR_AUDIT[ev.eventType] && (!t.correlationId || t.correlationId === ev.correlationId));
      ev.eventTime = match ? match.at : new Date(start + step * i).toISOString();
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
function restampExceptions(db: Database, seedStartedAt: string): void {
  for (const ex of db.exceptions) {
    const invoice = db.invoices.find((i) => i.id === ex.invoiceId);
    if (!invoice) continue;
    // An exception is raised while the invoice is being processed, which is
    // within hours of it arriving — not on the day the demo data was built.
    const events = db.timelineEvents.filter((t) => t.invoiceId === ex.invoiceId).map((t) => t.at).sort();
    const raisedAt = events.find((at) => at > invoice.receivedAt) ?? invoice.receivedAt;
    ex.createdAt = raisedAt;
    ex.slaDueAt = invoice.slaDueAt || raisedAt;
    // Only the pipeline's own "created" entry carries the seeding clock; the
    // actions the AP team took on the exception are dated by the scenario.
    ex.actions?.forEach((a) => { if (a.at >= seedStartedAt) a.at = raisedAt; });
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
    // Approval steps the seed acted on carry the same "now" stamp. Move them
    // onto the invoice's timeline too, so the approval SLA clock (which starts
    // when the previous level acted) reads from the scenario's history and a
    // scenario meant to breach its approval SLA actually does.
    const lastAt = ordered[ordered.length - 1]?.at;
    for (const step of db.workflowSteps) {
      if (step.invoiceId !== invoiceId || !step.actedAt || step.actedAt < seedStartedAt) continue;
      step.actedAt = lastAt ?? new Date(Math.min(received + 6 * HOUR_MS, Date.now() - 60_000)).toISOString();
    }
    // The workflow instance started when the pipeline handed over — the first
    // approval step's clock (BPD §11.4 reminders) runs from that moment.
    const started = ordered.find((ev) => ev.event === 'WORKFLOW_STARTED')?.at ?? lastAt;
    for (const wf of db.workflowInstances) {
      if (wf.invoiceId !== invoiceId || wf.startedAt < seedStartedAt) continue;
      wf.startedAt = started ?? wf.startedAt;
    }
  }

  // "Last updated" is the latest thing that happened on the invoice's own
  // clock, not the moment the demo data was built.
  for (const invoice of db.invoices) {
    if (invoice.updatedAt < seedStartedAt) continue;
    const stamps = [
      ...db.timelineEvents.filter((t) => t.invoiceId === invoice.id).map((t) => t.at),
      ...db.workflowSteps.filter((s) => s.invoiceId === invoice.id && s.actedAt).map((s) => s.actedAt as string),
      ...db.exceptions.filter((e) => e.invoiceId === invoice.id).flatMap((e) => e.actions.map((a) => a.at)),
    ].filter((t) => t < seedStartedAt);
    invoice.updatedAt = stamps.length ? stamps.sort()[stamps.length - 1] : invoice.receivedAt;
  }
}
