/**
 * Embedded persistence adapter.
 *
 * The production data architecture is PostgreSQL (see db/schema.sql for the full DDL).
 * For local/demo execution the same repository surface runs on an embedded
 * JSON-snapshot store so the application starts with zero infrastructure.
 * Replace this module with a PostgreSQL-backed implementation (same interface)
 * for DEV/UAT/PROD deployment.
 */
import fs from 'fs';
import path from 'path';
import type * as T from './types';
import { getCounters, initCounters } from './ids';

export interface Database {
  users: T.AppUser[];
  roles: T.Role[];
  permissions: T.Permission[];
  configVersions: T.ConfigurationVersion[];
  categories: T.InvoiceCategory[];
  documentTypes: T.DocumentType[];
  categoryDocuments: T.CategoryDocument[];
  documentFields: T.DocumentField[];
  promptTemplates: T.PromptTemplate[];
  extractionProfiles: T.ExtractionProfile[];
  fieldMappings: T.FieldMapping[];
  validationRules: T.ValidationRule[];
  ruleOperands: T.RuleOperand[];
  invoices: T.Invoice[];
  invoiceLines: T.InvoiceLine[];
  invoiceDocuments: T.InvoiceDocument[];
  extractionRuns: T.ExtractionRun[];
  extractedFields: T.ExtractedField[];
  validationRuns: T.ValidationRun[];
  validationResults: T.ValidationResult[];
  exceptions: T.ExceptionRecord[];
  workflowDefinitions: T.WorkflowDefinition[];
  workflowInstances: T.WorkflowInstance[];
  workflowSteps: T.WorkflowStepInstance[];
  doaMatrix: T.DoAEntry[];
  vendors: T.VendorSnapshot[];
  vendorControls: T.VendorPortalControl[];
  vendorControlHistory: T.VendorControlHistory[];
  sapPurchaseOrders: T.SapPurchaseOrder[];
  sapGrns: T.SapGrn[];
  sapSes: T.SapSes[];
  sapHandoffs: T.SapHandoff[];
  integrationHealth: T.IntegrationHealth;
  attendanceRecords: T.AttendanceRecord[];
  attendanceBatches: T.AttendanceBatch[];
  emailItems: T.EmailIngestionItem[];
  sharePointItems: T.SharePointMonitorItem[];
  notifications: T.NotificationRecord[];
  notificationRules: T.NotificationRule[];
  auditEvents: T.AuditEvent[];
  technicalLogs: T.TechnicalLog[];
  integrationJobs: T.IntegrationJob[];
  timelineEvents: T.TimelineEvent[];
  _counters?: Record<string, number>;
  _seedVersion?: number;
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db: Database | null = null;
let dirty = false;

export function getDb(): Database {
  if (!db) throw new Error('Database not initialised - call initStore() first');
  return db;
}

export function initStore(seedFactory: () => Database): { seeded: boolean } {
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Database;
      db = raw;
      initCounters(raw._counters);
      scheduleFlushLoop();
      return { seeded: false };
    } catch {
      // fall through to reseed on corrupt file
    }
  }
  db = seedFactory();
  persist();
  scheduleFlushLoop();
  return { seeded: true };
}

export function resetStore(seedFactory: () => Database): void {
  db = seedFactory();
  persist();
}

export function markDirty(): void {
  dirty = true;
}

export function persist(): void {
  if (!db) return;
  db._counters = getCounters();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  dirty = false;
}

let flushTimer: NodeJS.Timeout | null = null;
function scheduleFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (dirty) persist();
  }, 2000);
  flushTimer.unref();
}
