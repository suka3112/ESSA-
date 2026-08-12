import type { Database } from '../../core/store';
import { getDb, markDirty, persist } from '../../core/store';
import { DAY, HOUR, ids, isoAgo } from '../../core/ids';
import { DOA_MATRIX, PERMISSIONS, ROLES, USERS } from './identity';
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
export const SEED_VERSION = 2;

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
    vendors: structuredClone(VENDORS),
    vendorControls: structuredClone(VENDOR_CONTROLS),
    vendorControlHistory: [
      { id: 'vch-1', vendorCode: 'V700052', action: 'NEGATIVE_MARKED', reason: 'Repeated billing discrepancies under investigation (internal audit ref IA-2026-114)', by: 'u-meera', byName: 'Meera Krishnan', at: isoAgo(14 * DAY) },
      { id: 'vch-2', vendorCode: 'V500033', action: 'DISABLED', reason: 'Pending contract renewal - AP automation suspended', by: 'u-meera', byName: 'Meera Krishnan', at: isoAgo(21 * DAY) },
      { id: 'vch-3', vendorCode: 'V400018', action: 'ENABLED', reason: 'Onboarding completed after successful pilot', by: 'u-suresh', byName: 'Suresh Iyer', at: isoAgo(60 * DAY) },
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
    { id: 'em-1', sender: 'billing@bharatindustrial.co.in', subject: `Tax Invoice ${inv(0)?.invoiceNumber ?? ''} - July supplies`, receivedAt: isoAgo(28 * DAY), attachments: [{ fileName: 'TaxInvoice.pdf', sizeKb: 412 }, { fileName: 'GRN.pdf', sizeKb: 188 }], status: 'PROCESSED', invoiceId: inv(0)?.id },
    { id: 'em-2', sender: 'accounts@techserveng.co.in', subject: 'Invoice - Rotating equipment maintenance June', receivedAt: isoAgo(26 * DAY), attachments: [{ fileName: 'ServiceInvoice.pdf', sizeKb: 356 }], status: 'PROCESSED', invoiceId: inv(1)?.id },
    { id: 'em-3', sender: 'ap-invoices@secureforce.in', subject: 'Manpower invoice July with timesheets', receivedAt: isoAgo(5 * DAY), attachments: [{ fileName: 'ManpowerInvoice.pdf', sizeKb: 298 }, { fileName: 'Timesheet.pdf', sizeKb: 1240 }, { fileName: 'AttendanceSheet.pdf', sizeKb: 920 }], status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('plant operations (July)'))?.id },
    { id: 'em-4', sender: 'noreply@dropbox-share.com', subject: 'Your invoice is ready for download', receivedAt: isoAgo(2 * DAY), attachments: [], status: 'IGNORED', error: 'Cloud link attachments are not accepted per file security policy' },
    { id: 'em-5', sender: 'billing@sterlingpipes.co.in', subject: 'Invoice SS fasteners - August', receivedAt: isoAgo(2 * DAY), attachments: [{ fileName: 'Invoice_scan.pdf', sizeKb: 3180 }], status: 'PROCESSED', invoiceId: db.invoices.find((i) => i.description.includes('SS fasteners'))?.id },
    { id: 'em-6', sender: 'accounts@omsaitransport.in', subject: 'Freight bills - multiple invoices combined', receivedAt: isoAgo(1 * DAY), attachments: [{ fileName: 'Combined_Bills.pdf', sizeKb: 5230 }], status: 'ERROR', error: 'PDF contains multiple invoices - rejected for resubmission (one PDF = one invoice)' },
    { id: 'em-7', sender: 'billing@greenleafcanteen.in', subject: 'Canteen billing August 1st fortnight', receivedAt: isoAgo(8 * HOUR), attachments: [{ fileName: 'CateringInvoice.pdf', sizeKb: 240 }], status: 'PROCESSING' },
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
  const baseEvents = [
    { d: 45, actor: USERS[5], type: 'CONFIG_PUBLISHED', cat: 'CONFIGURATION' as const, action: 'PUBLISH', entity: 'ConfigurationVersion', id: 'cfg-1', ref: 'v1.0', reason: 'Baseline configuration activated' },
    { d: 14, actor: USERS[4], type: 'VENDOR_NEGATIVE_MARKED', cat: 'VENDOR' as const, action: 'NEGATIVE_FLAG', entity: 'Vendor', id: 'V700052', ref: 'Deccan Office Supplies', reason: 'Repeated billing discrepancies under investigation' },
    { d: 9, actor: USERS[5], type: 'CONFIG_DRAFT_CREATED', cat: 'CONFIGURATION' as const, action: 'CREATE', entity: 'ConfigurationVersion', id: 'cfg-2', ref: 'v1.1', reason: 'Draft for manpower tolerance tightening' },
    { d: 7, actor: USERS[5], type: 'ROLE_ASSIGNED', cat: 'ACCESS' as const, action: 'ASSIGN', entity: 'AppUser', id: 'u-ananya', ref: 'Ananya Das', reason: 'Granted Auditor (view only) role' },
    { d: 3, actor: USERS[5], type: 'USER_DISABLED', cat: 'ACCESS' as const, action: 'DISABLE', entity: 'AppUser', id: 'u-deepak', ref: 'Deepak Malhotra', reason: 'On long leave - access suspended per policy' },
  ];
  for (const e of baseEvents) {
    audit({
      eventTime: isoAgo(e.d * DAY),
      actorType: 'USER', actorId: e.actor.id, actorName: e.actor.name, actorRole: e.actor.title,
      eventType: e.type, category: e.cat, action: e.action, module: e.cat.toLowerCase(),
      entityType: e.entity, entityId: e.id, entityRef: e.ref,
      result: 'SUCCESS', reason: e.reason, correlationId: ids.correlation(), source: 'PORTAL',
    });
  }

  // login events for demo users
  for (const u of USERS.slice(0, 6)) {
    audit({
      eventTime: isoAgo(Math.floor(Math.random() * 3) * DAY + 2 * HOUR),
      actorType: 'USER', actorId: u.id, actorName: u.name, actorRole: u.title,
      eventType: 'LOGIN_SUCCESS', category: 'AUTHENTICATION', action: 'LOGIN', module: 'identity-access',
      entityType: 'Session', entityId: ids.generic('SES'), result: 'SUCCESS',
      correlationId: ids.correlation(), source: 'ENTRA_SSO',
    });
    u.lastLoginAt = isoAgo(Math.floor(Math.random() * 2) * DAY + HOUR);
  }

  techLog({ module: 'seed', event: 'SEED_COMPLETED', message: `Demo dataset seeded: ${db.invoices.length} invoices, ${db.vendors.length} vendors, ${db.exceptions.length} exceptions, ${db.validationRules.length} rules, ${db.attendanceRecords.length} attendance records` });
  markDirty();
  persist();
}
