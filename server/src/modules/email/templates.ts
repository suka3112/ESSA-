/**
 * Email Template Configuration — scenario catalogue, defaults and renderer.
 *
 * Every outbound email scenario in the platform draws its subject and body
 * from a configurable template (Administration → Email Templates) instead of
 * hardcoded strings. The transport itself is untouched: rendered content is
 * handed to the existing notification/email infrastructure exactly as before.
 *
 * Behaviour guarantee: the seeded default template for each scenario renders
 * byte-for-byte the same text the code used to hardcode, and if a scenario's
 * template is missing or inactive the renderer falls back to that built-in
 * default — so every current scenario keeps working, only the source of the
 * content changes.
 */
import type { Database } from '../../core/store';
import { getDb, markDirty } from '../../core/store';
import { ids, nowIso } from '../../core/ids';
import type { EmailTemplate, EmailTemplateVersion, NotificationCategory } from '../../core/types';

// ------------------------------------------------------------ scenario catalogue

export interface ScenarioVariable {
  name: string;
  label: string;
  sample: string;
}

export interface EmailScenario {
  key: string;
  label: string;
  description: string;
  category: NotificationCategory;
  /** Who the platform resolves the message to — informational, resolution stays in code. */
  recipients: { to: string; cc?: string; bcc?: string };
  variables: ScenarioVariable[];
  /** Placeholders that must appear in subject+body for the message to stay meaningful. */
  required: string[];
  defaults: { name: string; subject: string; bodyHtml: string };
}

const V = (name: string, label: string, sample: string): ScenarioVariable => ({ name, label, sample });

export const EMAIL_SCENARIOS: EmailScenario[] = [
  {
    key: 'INVOICE_RECEIVED',
    label: 'Invoice received',
    description: 'A new invoice entered the pipeline from any ingestion source.',
    category: 'SYSTEM',
    recipients: { to: 'AP Team' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('vendorName', 'Vendor name', 'PT Amanah Lestari Energy'), V('source', 'Ingestion source', 'Email ingestion')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Invoice received',
      subject: 'Invoice {{invoiceNumber}} received',
      bodyHtml: '<p>Invoice {{invoiceNumber}} received from {{vendorName}} via {{source}}.</p>',
    },
  },
  {
    key: 'EXCEPTION_CREATED',
    label: 'Exception created',
    description: 'A validation or matching exception was raised on an invoice.',
    category: 'EXCEPTION',
    recipients: { to: 'AP Team' },
    variables: [V('exceptionCode', 'Exception code', 'EX-201'), V('exceptionTitle', 'Exception title', 'PO quantity mismatch'), V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('detail', 'What happened', 'Line 2 quantity exceeds the remaining PO balance')],
    required: ['exceptionCode', 'invoiceNumber'],
    defaults: {
      name: 'Exception created',
      subject: 'Exception {{exceptionCode}}: {{exceptionTitle}}',
      bodyHtml: '<p>{{invoiceNumber}} · {{detail}}</p>',
    },
  },
  {
    key: 'APPROVAL_REQUESTED',
    label: 'Approval requested',
    description: 'An approval step became active and is waiting on the assigned approver.',
    category: 'APPROVAL',
    recipients: { to: 'Current approver' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('vendorName', 'Vendor name', 'PT Amanah Lestari Energy'), V('currency', 'Currency', 'IDR'), V('amount', 'Invoice amount', '184,500,000'), V('stepName', 'Approval step', 'AP Supervisor Review')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Approval requested',
      subject: 'Approval requested: {{invoiceNumber}}',
      bodyHtml: '<p>{{vendorName}} · {{currency}} {{amount}} · step "{{stepName}}"</p>',
    },
  },
  {
    key: 'APPROVAL_DELEGATED',
    label: 'Approval delegated',
    description: 'An approver handed their active approval step to a delegate.',
    category: 'APPROVAL',
    recipients: { to: 'Delegate' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('stepName', 'Approval step', 'AP Supervisor Review'), V('delegatedBy', 'Delegated by', 'Robinson Tan')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Approval delegated',
      subject: 'Approval delegated to you: {{invoiceNumber}}',
      bodyHtml: '<p>{{stepName}} · delegated by {{delegatedBy}}</p>',
    },
  },
  {
    key: 'APPROVAL_OVERDUE',
    label: 'Approval overdue (SLA reminder)',
    description: 'An approval passed its SLA due time and a reminder is sent.',
    category: 'APPROVAL',
    recipients: { to: 'Approver', cc: 'Escalation contact' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('stepName', 'Approval step', 'AP Supervisor Review'), V('slaHours', 'SLA (hours)', '24')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Approval overdue',
      subject: 'Approval overdue: {{invoiceNumber}}',
      bodyHtml: '<p>Approval for {{invoiceNumber}} is overdue (SLA {{slaHours}}h).</p>',
    },
  },
  {
    key: 'INVOICE_APPROVED',
    label: 'Invoice approved',
    description: 'All approval steps completed; the invoice is queued for SAP handoff.',
    category: 'APPROVAL',
    recipients: { to: 'AP Team' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Invoice approved',
      subject: 'Invoice approved: {{invoiceNumber}}',
      bodyHtml: '<p>{{invoiceNumber}} fully approved and queued for SAP handoff.</p>',
    },
  },
  {
    key: 'INVOICE_REJECTED',
    label: 'Invoice rejected',
    description: 'An approver rejected the invoice at one of the approval steps.',
    category: 'APPROVAL',
    recipients: { to: 'AP Team', cc: 'Requester' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('stepName', 'Approval step', 'AP Supervisor Review'), V('reason', 'Rejection reason', 'Missing tax invoice document')],
    required: ['invoiceNumber', 'reason'],
    defaults: {
      name: 'Invoice rejected',
      subject: 'Invoice rejected: {{invoiceNumber}}',
      bodyHtml: '<p>{{invoiceNumber}} rejected at {{stepName}}: {{reason}}.</p>',
    },
  },
  {
    key: 'SAP_FAILURE',
    label: 'SAP integration failure',
    description: 'Posting the invoice to SAP failed and needs attention.',
    category: 'SAP',
    recipients: { to: 'Support', cc: 'AP Supervisor' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('error', 'Error message', 'RFC connection timeout')],
    required: ['invoiceNumber', 'error'],
    defaults: {
      name: 'SAP integration failure',
      subject: 'SAP handoff failed: {{invoiceNumber}}',
      bodyHtml: '<p>SAP handoff for {{invoiceNumber}} failed: {{error}}.</p>',
    },
  },
  {
    key: 'SAP_POSTED',
    label: 'Invoice posted in SAP',
    description: 'The invoice was successfully posted in SAP.',
    category: 'SAP',
    recipients: { to: 'AP Team' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('sapDocumentNo', 'SAP document number', '5105609981')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Invoice posted in SAP',
      subject: 'Invoice posted: {{invoiceNumber}}',
      bodyHtml: '<p>{{invoiceNumber}} posted in SAP as {{sapDocumentNo}}.</p>',
    },
  },
  {
    key: 'INVOICE_PAID',
    label: 'Invoice paid',
    description: 'Payment for the invoice was released.',
    category: 'SAP',
    recipients: { to: 'Vendor communication queue' },
    variables: [V('invoiceNumber', 'Invoice number', 'INV-2026-00123'), V('paymentRef', 'Payment reference', 'PAY-2026-088123')],
    required: ['invoiceNumber'],
    defaults: {
      name: 'Invoice paid',
      subject: 'Payment released: {{invoiceNumber}}',
      bodyHtml: '<p>Payment released for {{invoiceNumber}} ({{paymentRef}}).</p>',
    },
  },
  {
    key: 'CONFIG_PUBLISHED_ADMIN',
    label: 'Configuration published — administrators',
    description: 'A configuration version was published; the administrator copy carries the processing note.',
    category: 'CONFIGURATION',
    recipients: { to: 'Administrators' },
    variables: [V('versionNo', 'Version number', 'v1.2'), V('label', 'Version label', 'Q3 validation rules'), V('effectiveFrom', 'Effective from', '2026-09-01')],
    required: ['versionNo'],
    defaults: {
      name: 'Configuration published (administrators)',
      subject: 'Configuration {{versionNo}} published',
      bodyHtml: '<p>{{label}} - effective {{effectiveFrom}}. New invoices will process on this version.</p>',
    },
  },
  {
    key: 'CONFIG_PUBLISHED_TEAM',
    label: 'Configuration published — AP team',
    description: 'A configuration version was published; the AP team copy.',
    category: 'CONFIGURATION',
    recipients: { to: 'AP Supervisor' },
    variables: [V('versionNo', 'Version number', 'v1.2'), V('label', 'Version label', 'Q3 validation rules'), V('effectiveFrom', 'Effective from', '2026-09-01')],
    required: ['versionNo'],
    defaults: {
      name: 'Configuration published (AP team)',
      subject: 'Configuration {{versionNo}} published',
      bodyHtml: '<p>{{label}} - effective {{effectiveFrom}}.</p>',
    },
  },
];

export function findScenario(key: string): EmailScenario | undefined {
  return EMAIL_SCENARIOS.find((s) => s.key === key);
}

// ------------------------------------------------------------ rendering

/** Replace {{placeholder}} tokens; unknown tokens stay visible so a gap is obvious. */
export function renderString(template: string, ctx: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => {
    const v = ctx[name];
    return v === undefined || v === null ? `{{${name}}}` : String(v);
  });
}

/** Minimal HTML → text conversion for the in-app notification body / plain-text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPlaceholders(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    for (const m of part.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  }
  return [...found];
}

export function sampleContext(scenario: EmailScenario): Record<string, string> {
  return Object.fromEntries(scenario.variables.map((v) => [v.name, v.sample]));
}

// ------------------------------------------------------------ template store

function defaultTemplate(s: EmailScenario, at: string): EmailTemplate {
  return {
    id: ids.generic('EMT'),
    name: s.defaults.name,
    scenario: s.key,
    description: s.description,
    subject: s.defaults.subject,
    bodyHtml: s.defaults.bodyHtml,
    recipients: { ...s.recipients },
    requiredPlaceholders: [...s.required],
    status: 'ACTIVE',
    system: true,
    version: 1,
    createdAt: at,
    createdBy: 'System seed',
    updatedAt: at,
    updatedBy: 'System seed',
  };
}

export function snapshotOf(t: EmailTemplate): EmailTemplateVersion['snapshot'] {
  return {
    name: t.name,
    scenario: t.scenario,
    description: t.description,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    recipients: { ...t.recipients },
    requiredPlaceholders: [...t.requiredPlaceholders],
    status: t.status,
  };
}

export function recordVersion(db: Database, t: EmailTemplate, action: EmailTemplateVersion['action'], by: string, note?: string): EmailTemplateVersion {
  const entry: EmailTemplateVersion = {
    id: ids.generic('EMV'),
    templateId: t.id,
    version: t.version,
    action,
    snapshot: snapshotOf(t),
    changedAt: nowIso(),
    changedBy: by,
    note,
  };
  db.emailTemplateVersions.unshift(entry);
  markDirty();
  return entry;
}

/**
 * Bootstrap / migrate: guarantees the collections exist and that every
 * built-in scenario has its system template. Runs at server start, so
 * existing local snapshots pick the feature up without a reseed.
 */
export function ensureEmailTemplates(db: Database): void {
  let touched = false;
  if (!Array.isArray(db.emailTemplates)) { db.emailTemplates = []; touched = true; }
  if (!Array.isArray(db.emailTemplateVersions)) { db.emailTemplateVersions = []; touched = true; }
  const at = nowIso();
  for (const s of EMAIL_SCENARIOS) {
    if (!db.emailTemplates.some((t) => t.scenario === s.key && t.system)) {
      const tpl = defaultTemplate(s, at);
      db.emailTemplates.push(tpl);
      recordVersion(db, tpl, 'CREATED', 'System seed', 'Seeded from the built-in scenario default');
      touched = true;
    }
  }
  if (touched) markDirty();
}

// ------------------------------------------------------------ content resolution

export interface RenderedEmail {
  /** Rendered subject — used as the notification title. */
  title: string;
  /** Rendered plain-text body — used as the notification body. */
  body: string;
  /** Rendered HTML body — for transports that send rich content. */
  html: string;
  /** Template the content came from (undefined = built-in fallback). */
  templateId?: string;
}

/**
 * Content for a scenario. Uses the ACTIVE template for the scenario (most
 * recently updated wins if several are active); falls back to the built-in
 * default so a deactivated or missing template can never silence a scenario.
 */
export function emailContent(scenarioKey: string, ctx: Record<string, string | number | undefined>): RenderedEmail {
  const scenario = findScenario(scenarioKey);
  const db = getDb();
  const candidates = (db.emailTemplates ?? [])
    .filter((t) => t.scenario === scenarioKey && t.status === 'ACTIVE')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const tpl = candidates[0];
  const subject = tpl?.subject ?? scenario?.defaults.subject ?? scenarioKey;
  const bodyHtml = tpl?.bodyHtml ?? scenario?.defaults.bodyHtml ?? '';
  const html = renderString(bodyHtml, ctx);
  return {
    title: renderString(subject, ctx),
    body: htmlToText(html),
    html,
    templateId: tpl?.id,
  };
}
