/**
 * Administration → SLA Management (SLA Administration UI Specification).
 *
 *  · /sla/meta        vocabularies shared with the UI (scopes, stages, triggers,
 *                     units, recipients, channels, pause conditions …)
 *  · /sla/policies    every policy version + lifecycle actions (save draft,
 *                     clone, new version, test, publish, retire, delete draft)
 *  · /sla/calendars   business calendars + lifecycle
 *  · /sla/simulate    read-only timeline for a policy (published or unsaved draft)
 *  · /sla/monitor     runtime SLA instances derived from live data + widget counts
 *
 * Published versions are immutable: editing an ACTIVE policy is refused and
 * the admin is pointed at "Create new version" instead (spec Screen 9).
 */
import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { nowIso } from '../core/ids';
import type { BusinessCalendar, SlaInstance, SlaPolicy } from '../core/types';
import {
  ACTIVITIES, DEFAULT_TIMEZONE, PAUSE_CONDITIONS, SLA_RECIPIENT_LABEL, SLA_STAGE_DESCRIPTION, SLA_STAGE_LABEL,
  activeVersion, buildSlaInstances, categoryIdsForActivity, recomputeAllSla, simulatePolicy,
} from '../core/sla';

export const slaRouter = Router();

const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ meta
slaRouter.get('/sla/meta', authorize('CONFIG_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    scopeTypes: [
      { code: 'INVOICE_CATEGORY', label: 'Invoice Category', hint: 'Runs one clock per invoice for the stage it is in.' },
      { code: 'WORKFLOW', label: 'Workflow Approval', hint: 'Runs one clock per assigned approval step — reminders and escalation.' },
      { code: 'DOCUMENT_REQUEST', label: 'Document Request', hint: 'Runs one clock per missing-document request sent to the vendor.' },
      { code: 'GLOBAL', label: 'Global (all types)', hint: 'Fallback when no activity-specific policy exists for the stage.' },
    ],
    stages: (Object.keys(SLA_STAGE_LABEL) as (keyof typeof SLA_STAGE_LABEL)[]).map((code) => ({ code, label: SLA_STAGE_LABEL[code], hint: SLA_STAGE_DESCRIPTION[code] })),
    activities: ACTIVITIES.map((a) => ({ ...a, categoryIds: categoryIdsForActivity(db, a.code) })),
    triggerEvents: [
      { code: 'INVOICE_CREATED', label: 'Invoice created', stages: ['INVOICE_CREATION'] },
      { code: 'VALIDATION_COMPLETED', label: 'Validation completed', stages: ['INVOICE_CREATION', 'AP_APPROVAL'] },
      { code: 'TAX_REVIEW_ASSIGNED', label: 'Tax review assigned', stages: ['TAX_REVIEW'] },
      { code: 'WORKFLOW_STEP_ASSIGNED', label: 'Approval step assigned', stages: ['AP_APPROVAL'] },
      { code: 'INVOICE_APPROVED', label: 'Invoice approved (ready for parking)', stages: ['PAYMENT'] },
      { code: 'DOCUMENT_REQUEST_SENT', label: 'Document request sent to vendor', stages: ['DOCUMENT_REQUEST'] },
    ],
    owners: ['AP_TEAM', 'TAX_TEAM', 'CURRENT_APPROVER', 'AP_MANAGER', 'VENDOR'].map((code) => ({ code, label: SLA_RECIPIENT_LABEL[code] })),
    recipients: ['CURRENT_APPROVER', 'APPROVER_AND_AP_MANAGER', 'AP_TEAM', 'AP_MANAGER', 'TAX_TEAM', 'HOF', 'VENDOR'].map((code) => ({ code, label: SLA_RECIPIENT_LABEL[code] })),
    escalationTargets: ['NEXT_DOA_LEVEL', 'AP_MANAGER', 'HOF', 'AP_TEAM', 'TAX_TEAM', 'NONE'].map((code) => ({ code, label: SLA_RECIPIENT_LABEL[code] })),
    units: [
      { code: 'HOURS', label: 'Hours' },
      { code: 'CALENDAR_DAYS', label: 'Calendar Days' },
      { code: 'BUSINESS_DAYS', label: 'Business Days' },
      { code: 'BUSINESS_HOURS', label: 'Business Hours' },
    ],
    channels: [
      { code: 'EMAIL', label: 'Email' },
      { code: 'TEAMS', label: 'Microsoft Teams' },
      { code: 'PORTAL', label: 'In-platform' },
    ],
    breachConditions: [
      { code: 'AFTER_FINAL_REMINDER', label: 'After the final reminder' },
      { code: 'AFTER_FIRST_UNANSWERED_REMINDER', label: 'After the first unanswered reminder' },
      { code: 'ON_DUE_TIME', label: 'Immediately when the due time is exceeded' },
    ],
    // Notification templates are selected by name; wording lives in the
    // Notification configuration (spec Screen 4 — configurable without code).
    templates: [
      'Approval Reminder 1', 'Approval Reminder 2', 'Approval Reminder 3', 'Final Approval Reminder',
      'Missing Document Request (drafted by system, AP reviews and sends)', 'Missing Document Reminder',
      'AP Verification Reminder', 'Tax Review Reminder', 'Payment Follow-up Reminder',
      ...db.notificationRules.map((n) => n.label),
    ].filter((v, i, a) => v && a.indexOf(v) === i),
    timezones: [DEFAULT_TIMEZONE, 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'UTC'],
    pauseConditions: PAUSE_CONDITIONS.map(({ code, label, resumeEvent }) => ({ code, label, resumeEvent })),
    statuses: ['DRAFT', 'TEST', 'ACTIVE', 'RETIRED'],
    runtimeStatuses: [
      { code: 'PENDING', label: 'Pending', hint: 'Created but the timer has not started — usually waiting for a policy to be published.' },
      { code: 'RUNNING', label: 'Running', hint: 'The timer is actively counting.' },
      { code: 'WARNING', label: 'Warning', hint: 'Inside the configured pre-breach threshold.' },
      { code: 'PAUSED', label: 'Paused', hint: 'Stopped by an approved pause condition (only if ESSA approves stop-clock logic).' },
      { code: 'COMPLETED', label: 'Completed', hint: 'The activity completed; the actual duration is retained.' },
      { code: 'BREACHED', label: 'Breached', hint: 'The due time passed before completion.' },
      { code: 'CANCELLED', label: 'Cancelled', hint: 'The business process was cancelled.' },
    ],
  });
}));

// -------------------------------------------------------------- policies
slaRouter.get('/sla/policies', authorize('CONFIG_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({ policies: db.slaPolicies, calendars: db.businessCalendars });
}));

const CODE_RE = /^[A-Z][A-Z0-9_]{2,49}$/;

/** Validate a draft before it is saved, tested or published. Returns human-readable problems. */
function validatePolicy(db: ReturnType<typeof getDb>, p: SlaPolicy, forPublish = false): string[] {
  const problems: string[] = [];
  if (!CODE_RE.test(p.code)) problems.push('SLA Code must be upper-case letters, digits and underscores (3–50 characters).');
  if (!p.name?.trim()) problems.push('SLA Name is required.');
  if (!p.scopeType) problems.push('Scope Type is required.');
  if (!p.stage) problems.push('Stage is required.');
  if (!p.triggerEvent) problems.push('Trigger Event is required.');
  if (!p.effectiveFrom) problems.push('Effective From is required.');
  if (p.scopeType === 'INVOICE_CATEGORY' && !p.activity) problems.push('Category / Activity is required for an Invoice Category policy.');
  if (p.scopeType === 'DOCUMENT_REQUEST' && p.stage !== 'DOCUMENT_REQUEST') problems.push('A Document Request policy must use the Document Request stage.');
  if (p.scopeType !== 'DOCUMENT_REQUEST' && p.stage === 'DOCUMENT_REQUEST') problems.push('The Document Request stage is only valid for Document Request scope.');
  const t = p.timer;
  if (!t) problems.push('Timer configuration is missing.');
  else {
    if (t.duration != null && (!Number.isFinite(t.duration) || t.duration < 0)) problems.push('Target Duration must be zero or more.');
    if (!t.unit) problems.push('Unit is required.');
    if ((t.unit === 'BUSINESS_DAYS' || t.unit === 'BUSINESS_HOURS') && t.duration != null && !db.businessCalendars.some((c) => c.id === t.calendarId)) {
      problems.push('A Business Calendar is required when the unit is Business Days or Business Hours.');
    }
    if (!t.timezone) problems.push('Timezone is required.');
    if (t.warningBefore && t.warningBefore.value < 0) problems.push('Warning Before Breach cannot be negative.');
  }
  for (const r of p.reminders ?? []) {
    if (!r.recipient) problems.push(`Reminder ${r.seq}: recipient is required.`);
    if (!r.channels?.length) problems.push(`Reminder ${r.seq}: at least one channel is required.`);
    if (!r.template) problems.push(`Reminder ${r.seq}: a notification template is required.`);
    if (!r.after || r.after.value < 0) problems.push(`Reminder ${r.seq}: trigger time must be zero or more.`);
  }
  if (p.escalation?.enabled) {
    if (!p.escalation.primaryTarget || p.escalation.primaryTarget === 'NONE') problems.push('Primary Escalation is required when escalation is enabled.');
    if (!p.escalation.channels?.length) problems.push('Escalation needs at least one channel.');
  }
  if (forPublish) {
    if (p.provisional) problems.push(`${p.name} is marked provisional (${p.provisionalNote ?? 'value to be confirmed'}). Clear the provisional flag once ESSA confirms the target.`);
    if (!p.lastTestedAt) problems.push('Run Test on this version before publishing.');
    if (p.effectiveFrom < '2020-01-01') problems.push('Effective From date is not valid.');
  }
  return problems;
}

function nextVersionId(code: string, version: number) {
  return `slap-${code.toLowerCase().replace(/_/g, '-')}-v${version}`;
}

function stripIncoming(body: Partial<SlaPolicy>): Partial<SlaPolicy> {
  // Lifecycle fields are owned by the server.
  const { id, version, status, changedBy, changedAt, publishedBy, publishedAt, retiredAt, lastTestedAt, ...rest } = body;
  void id; void version; void status; void changedBy; void changedAt; void publishedBy; void publishedAt; void retiredAt; void lastTestedAt;
  return rest;
}

function logPolicy(req: Parameters<typeof requireAuth>[0], action: string, p: SlaPolicy, oldValue?: unknown, detail?: string) {
  const user = requireAuth(req);
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: `SLA_POLICY_${action}`, category: 'CONFIGURATION', action, module: 'sla',
    entityType: 'SLA_POLICY', entityId: p.id, entityRef: `${p.code} v${p.version}`,
    result: 'SUCCESS', oldValue, newValue: { status: p.status, effectiveFrom: p.effectiveFrom, changeSummary: p.changeSummary },
    details: detail ? [{ label: 'Detail', value: detail }] : undefined,
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
}

/** Create a new Draft policy (v1 of a new code). */
slaRouter.post('/sla/policies', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const body = stripIncoming(req.body as Partial<SlaPolicy>);
  const code = String(body.code ?? '').trim().toUpperCase();
  if (db.slaPolicies.some((p) => p.code === code)) throw Errors.conflict(`SLA code ${code} already exists — open it and create a new version instead`);
  const p: SlaPolicy = {
    ...(body as SlaPolicy),
    code, id: nextVersionId(code, 1), version: 1, status: 'DRAFT',
    changedBy: user.name, changedAt: nowIso(), changeSummary: body.changeSummary ?? 'New policy',
    reminders: body.reminders ?? [], pauseRules: body.pauseRules ?? PAUSE_CONDITIONS.map((c) => ({ code: c.code, label: c.label, pause: false, resumeEvent: c.resumeEvent, reasonRequired: false })),
    escalation: body.escalation ?? { enabled: false, breachCondition: 'ON_DUE_TIME', primaryTarget: 'AP_MANAGER', fallbackTarget: 'NONE', channels: ['EMAIL'], createAuditEvent: true, createBreachFlag: true },
    manualPauseAllowed: Boolean(body.manualPauseAllowed), maxPause: body.maxPause ?? null,
    provisional: Boolean(body.provisional),
  };
  const problems = validatePolicy(db, p);
  if (problems.length) throw Errors.validation(problems[0], problems);
  db.slaPolicies.push(p);
  markDirty();
  logPolicy(req, 'CREATE', p);
  res.json({ policy: p });
}));

/** Update a Draft / Test version in place. Published versions are immutable. */
slaRouter.post('/sla/policies/:id', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const idx = db.slaPolicies.findIndex((p) => p.id === req.params.id);
  if (idx < 0) throw Errors.notFound('SLA policy', req.params.id);
  const current = db.slaPolicies[idx];
  // Versioning removed from the product UI (review, 25 Aug): an active policy
  // is edited in place and stays active. Only retired policies are locked.
  if (current.status === 'RETIRED') {
    throw Errors.conflict('This policy is retired and cannot be edited');
  }
  const body = stripIncoming(req.body as Partial<SlaPolicy>);
  const codeLocked = db.slaPolicies.some((p) => p.code === current.code && p.id !== current.id);
  const code = codeLocked ? current.code : String(body.code ?? current.code).trim().toUpperCase();
  if (code !== current.code && db.slaPolicies.some((p) => p.code === code)) throw Errors.conflict(`SLA code ${code} already exists`);
  const updated: SlaPolicy = {
    ...current, ...body, code, id: current.id, version: current.version,
    // An active policy stays active when edited in place; a draft edit
    // invalidates the previous test run.
    status: current.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
    lastTestedAt: current.status === 'ACTIVE' ? current.lastTestedAt : undefined,
    changedBy: user.name, changedAt: nowIso(),
  };
  const problems = validatePolicy(db, updated);
  if (problems.length) throw Errors.validation(problems[0], problems);
  const oldValue = { ...current };
  db.slaPolicies[idx] = updated;
  markDirty();
  logPolicy(req, 'UPDATE', updated, oldValue);
  res.json({ policy: updated });
}));

/** Clone a policy into a brand-new Draft with a different code. */
slaRouter.post('/sla/policies/:id/clone', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const source = db.slaPolicies.find((p) => p.id === req.params.id);
  if (!source) throw Errors.notFound('SLA policy', req.params.id);
  const { code: rawCode, name } = req.body as { code?: string; name?: string };
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw Errors.validation('SLA Code must be upper-case letters, digits and underscores (3–50 characters).');
  if (db.slaPolicies.some((p) => p.code === code)) throw Errors.conflict(`SLA code ${code} already exists`);
  const clone: SlaPolicy = {
    ...structuredClone(source), id: nextVersionId(code, 1), code, name: name?.trim() || `${source.name} (copy)`,
    version: 1, status: 'DRAFT', changedBy: user.name, changedAt: nowIso(), changeSummary: `Cloned from ${source.code} v${source.version}`,
    publishedBy: undefined, publishedAt: undefined, retiredAt: undefined, lastTestedAt: undefined, effectiveFrom: today(),
  };
  db.slaPolicies.push(clone);
  markDirty();
  logPolicy(req, 'CLONE', clone, undefined, `Cloned from ${source.code} v${source.version}`);
  res.json({ policy: clone });
}));

/** Copy the latest version of a code into a new Draft version. */
slaRouter.post('/sla/policies/:id/new-version', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const source = db.slaPolicies.find((p) => p.id === req.params.id);
  if (!source) throw Errors.notFound('SLA policy', req.params.id);
  const versions = db.slaPolicies.filter((p) => p.code === source.code);
  const open = versions.find((p) => p.status === 'DRAFT' || p.status === 'TEST');
  if (open) throw Errors.conflict(`${source.code} already has an open draft (v${open.version}) — edit that version instead`);
  const latest = versions.sort((a, b) => b.version - a.version)[0];
  const version = latest.version + 1;
  const next: SlaPolicy = {
    ...structuredClone(latest), id: nextVersionId(source.code, version), version, status: 'DRAFT',
    changedBy: user.name, changedAt: nowIso(), changeSummary: (req.body as { changeSummary?: string }).changeSummary ?? '',
    publishedBy: undefined, publishedAt: undefined, retiredAt: undefined, lastTestedAt: undefined, effectiveFrom: today(),
  };
  db.slaPolicies.push(next);
  markDirty();
  logPolicy(req, 'NEW_VERSION', next, undefined, `Copied from v${latest.version}`);
  res.json({ policy: next });
}));

/** Run the simulation against a version and mark it as tested. */
slaRouter.post('/sla/policies/:id/test', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const p = db.slaPolicies.find((x) => x.id === req.params.id);
  if (!p) throw Errors.notFound('SLA policy', req.params.id);
  const problems = validatePolicy(db, p);
  if (problems.length) throw Errors.validation(problems[0], problems);
  const startAt = (req.body as { startAt?: string }).startAt ?? nowIso();
  const result = simulatePolicy(db, p, new Date(startAt).toISOString());
  if (p.status === 'DRAFT' || p.status === 'TEST') {
    p.status = 'TEST';
    p.lastTestedAt = nowIso();
    markDirty();
    logPolicy(req, 'TEST', p, undefined, `Simulated from ${startAt}`);
  }
  res.json({ policy: p, simulation: result });
}));

/** Publish a tested version: it becomes ACTIVE and the previous ACTIVE version is retired. */
slaRouter.post('/sla/policies/:id/publish', authorize('CONFIG_PUBLISH'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const p = db.slaPolicies.find((x) => x.id === req.params.id);
  if (!p) throw Errors.notFound('SLA policy', req.params.id);
  if (p.status === 'ACTIVE') throw Errors.conflict('This version is already published');
  if (p.status === 'RETIRED') throw Errors.conflict('A retired version cannot be published — create a new version');
  const { effectiveFrom, changeSummary } = req.body as { effectiveFrom?: string; changeSummary?: string };
  if (effectiveFrom) p.effectiveFrom = effectiveFrom;
  if (changeSummary !== undefined) p.changeSummary = changeSummary;
  const problems = validatePolicy(db, p, true);
  if (problems.length) throw Errors.validation(problems[0], problems);
  const previous = activeVersion(db, p.code);
  if (previous && previous.id !== p.id) {
    previous.status = 'RETIRED';
    previous.retiredAt = nowIso();
  }
  p.status = 'ACTIVE';
  p.publishedBy = user.name;
  p.publishedAt = nowIso();
  p.changedBy = user.name;
  p.changedAt = nowIso();
  // Published rules move every running clock, so the invoices are recomputed
  // straight away rather than drifting until the next seed.
  recomputeAllSla(db);
  markDirty();
  logPolicy(req, 'PUBLISH', p, previous ? { retiredVersion: previous.version } : undefined, previous ? `Replaces v${previous.version}` : 'First published version');
  res.json({ policy: p });
}));

/** Retire the active version: no new instances; existing runtime clocks keep their history. */
slaRouter.post('/sla/policies/:id/retire', authorize('CONFIG_PUBLISH'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const p = db.slaPolicies.find((x) => x.id === req.params.id);
  if (!p) throw Errors.notFound('SLA policy', req.params.id);
  if (p.status !== 'ACTIVE') throw Errors.conflict('Only an active version can be retired');
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) throw Errors.validation('A reason is required to retire a policy');
  p.status = 'RETIRED';
  p.retiredAt = nowIso();
  p.changedBy = user.name;
  p.changedAt = nowIso();
  p.changeSummary = `${p.changeSummary ? `${p.changeSummary} · ` : ''}Retired: ${reason.trim()}`;
  recomputeAllSla(db);
  markDirty();
  logPolicy(req, 'RETIRE', p, undefined, reason.trim());
  res.json({ policy: p });
}));

/** Delete a policy. Versioning removed (review, 25 Aug): any policy can be
 * deleted; running SLA clocks are recomputed and keep their history. */
slaRouter.post('/sla/policies/:id/delete', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const idx = db.slaPolicies.findIndex((x) => x.id === req.params.id);
  if (idx < 0) throw Errors.notFound('SLA policy', req.params.id);
  const p = db.slaPolicies[idx];
  db.slaPolicies.splice(idx, 1);
  recomputeAllSla(db);
  markDirty();
  logPolicy(req, 'DELETE', p);
  res.json({ ok: true });
}));

// ------------------------------------------------------------- simulate
/** Read-only simulation of a saved policy or an unsaved draft body. */
slaRouter.post('/sla/simulate', authorize('CONFIG_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const { policyId, policy: draft, startAt } = req.body as { policyId?: string; policy?: SlaPolicy; startAt?: string };
  const policy = policyId ? db.slaPolicies.find((p) => p.id === policyId) : draft;
  if (!policy) throw Errors.notFound('SLA policy', policyId ?? 'draft');
  const start = startAt ? new Date(startAt) : new Date();
  if (Number.isNaN(start.getTime())) throw Errors.validation('Start Date/Time is not a valid date');
  res.json({ policy: { id: policy.id, code: policy.code, name: policy.name, version: policy.version, status: policy.status }, startAt: start.toISOString(), ...simulatePolicy(db, policy, start.toISOString()) });
}));

// ------------------------------------------------------------- calendars
function validateCalendar(c: BusinessCalendar): string[] {
  const problems: string[] = [];
  if (!CODE_RE.test(c.code ?? '')) problems.push('Calendar Code must be upper-case letters, digits and underscores.');
  if (!c.name?.trim()) problems.push('Calendar Name is required.');
  if (!c.timezone) problems.push('Timezone is required.');
  if (!c.workingDays?.length) problems.push('At least one working day is required.');
  if (!/^\d{2}:\d{2}$/.test(c.workStart ?? '') || !/^\d{2}:\d{2}$/.test(c.workEnd ?? '')) problems.push('Working hours must be in HH:MM format.');
  else if (c.workStart >= c.workEnd) problems.push('Working hours must end after they start.');
  const seen = new Set<string>();
  for (const e of c.exceptions ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) problems.push(`Holiday date ${e.date || '(blank)'} is not valid.`);
    if (!e.name?.trim()) problems.push(`Holiday on ${e.date} needs a name.`);
    if (seen.has(e.date)) problems.push(`${e.date} is listed twice.`);
    seen.add(e.date);
  }
  return problems;
}

function logCalendar(req: Parameters<typeof requireAuth>[0], action: string, c: BusinessCalendar, oldValue?: unknown) {
  const user = requireAuth(req);
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: `BUSINESS_CALENDAR_${action}`, category: 'CONFIGURATION', action, module: 'sla',
    entityType: 'BUSINESS_CALENDAR', entityId: c.id, entityRef: `${c.code} v${c.version}`,
    result: 'SUCCESS', oldValue, newValue: { status: c.status, workingDays: c.workingDays, workStart: c.workStart, workEnd: c.workEnd, exceptions: c.exceptions.length },
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
}

slaRouter.get('/sla/calendars', authorize('CONFIG_VIEW'), asyncHandler((_req, res) => {
  res.json({ calendars: getDb().businessCalendars });
}));

slaRouter.post('/sla/calendars', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const body = req.body as Partial<BusinessCalendar>;
  const code = String(body.code ?? '').trim().toUpperCase();
  if (db.businessCalendars.some((c) => c.code === code)) throw Errors.conflict(`Calendar code ${code} already exists`);
  const cal: BusinessCalendar = {
    id: `cal-${code.toLowerCase().replace(/_/g, '-')}-v1`, code, name: body.name ?? '', timezone: body.timezone ?? DEFAULT_TIMEZONE,
    workingDays: body.workingDays ?? [1, 2, 3, 4, 5], workStart: body.workStart ?? '08:00', workEnd: body.workEnd ?? '17:00',
    status: 'DRAFT', version: 1, effectiveFrom: body.effectiveFrom ?? today(), changedBy: user.name, changedAt: nowIso(),
    exceptions: (body.exceptions ?? []).map((e, i) => ({ ...e, id: e.id || `hol-${Date.now()}-${i}` })),
  };
  const problems = validateCalendar(cal);
  if (problems.length) throw Errors.validation(problems[0], problems);
  db.businessCalendars.push(cal);
  markDirty();
  logCalendar(req, 'CREATE', cal);
  res.json({ calendar: cal });
}));

slaRouter.post('/sla/calendars/:id', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const idx = db.businessCalendars.findIndex((c) => c.id === req.params.id);
  if (idx < 0) throw Errors.notFound('Business calendar', req.params.id);
  const current = db.businessCalendars[idx];
  const body = req.body as Partial<BusinessCalendar>;
  // Holiday / working-hour changes to the ACTIVE calendar are allowed — they
  // are effective-dated data, not policy logic — but bump the version so the
  // audit trail shows what runtime calculation was in force when.
  const updated: BusinessCalendar = {
    ...current,
    name: body.name ?? current.name, timezone: body.timezone ?? current.timezone,
    workingDays: body.workingDays ?? current.workingDays, workStart: body.workStart ?? current.workStart, workEnd: body.workEnd ?? current.workEnd,
    effectiveFrom: body.effectiveFrom ?? current.effectiveFrom,
    exceptions: (body.exceptions ?? current.exceptions).map((e, i) => ({ ...e, id: e.id || `hol-${Date.now()}-${i}` })),
    version: current.status === 'ACTIVE' ? current.version + 1 : current.version,
    changedBy: user.name, changedAt: nowIso(),
  };
  const problems = validateCalendar(updated);
  if (problems.length) throw Errors.validation(problems[0], problems);
  const oldValue = { ...current, exceptions: current.exceptions.length };
  db.businessCalendars[idx] = updated;
  recomputeAllSla(db);
  markDirty();
  logCalendar(req, 'UPDATE', updated, oldValue);
  res.json({ calendar: updated });
}));

slaRouter.post('/sla/calendars/:id/publish', authorize('CONFIG_PUBLISH'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const cal = db.businessCalendars.find((c) => c.id === req.params.id);
  if (!cal) throw Errors.notFound('Business calendar', req.params.id);
  if (cal.status === 'ACTIVE') throw Errors.conflict('This calendar is already active');
  cal.status = 'ACTIVE';
  cal.changedBy = user.name;
  cal.changedAt = nowIso();
  recomputeAllSla(db);
  markDirty();
  logCalendar(req, 'PUBLISH', cal);
  res.json({ calendar: cal });
}));

slaRouter.post('/sla/calendars/:id/retire', authorize('CONFIG_PUBLISH'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const cal = db.businessCalendars.find((c) => c.id === req.params.id);
  if (!cal) throw Errors.notFound('Business calendar', req.params.id);
  const inUse = db.slaPolicies.filter((p) => p.status === 'ACTIVE' && p.timer.calendarId === cal.id);
  if (inUse.length) throw Errors.conflict(`${inUse.length} active polic${inUse.length === 1 ? 'y uses' : 'ies use'} this calendar (${inUse.map((p) => p.code).join(', ')}) — point them at another calendar first`);
  cal.status = 'RETIRED';
  cal.changedBy = user.name;
  cal.changedAt = nowIso();
  markDirty();
  logCalendar(req, 'RETIRE', cal);
  res.json({ calendar: cal });
}));

// --------------------------------------------------------------- monitor
const OPEN: SlaInstance['status'][] = ['PENDING', 'RUNNING', 'WARNING', 'PAUSED', 'BREACHED'];

slaRouter.get('/sla/monitor', authorize('CONFIG_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const all = buildSlaInstances(db);
  const q = req.query as Record<string, string | undefined>;
  const open = all.filter((i) => OPEN.includes(i.status));
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const summary = {
    open: open.length,
    dueToday: open.filter((i) => i.dueAt && i.dueAt.slice(0, 10) === todayStr && i.status !== 'BREACHED').length,
    atRisk: open.filter((i) => i.status === 'WARNING').length,
    breached: open.filter((i) => i.status === 'BREACHED').length,
    paused: open.filter((i) => i.status === 'PAUSED').length,
    pending: open.filter((i) => i.status === 'PENDING').length,
    waitingVendor: open.filter((i) => i.objectType === 'DOCUMENT_REQUEST').length,
    approvalBreach: open.filter((i) => i.objectType === 'WORKFLOW_STEP' && i.status === 'BREACHED').length,
    completedWithinSla: all.filter((i) => i.status === 'COMPLETED' && (!i.dueAt || (i.events.find((e) => e.type === 'COMPLETED')?.at ?? '') <= i.dueAt)).length,
    completed: all.filter((i) => i.status === 'COMPLETED').length,
    byStage: Object.fromEntries((Object.keys(SLA_STAGE_LABEL) as (keyof typeof SLA_STAGE_LABEL)[]).map((s) => [s, open.filter((i) => i.stage === s).length])),
    byCategory: open.reduce<Record<string, number>>((acc, i) => { const k = i.categoryName ?? 'Other'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
    byPolicy: open.reduce<Record<string, number>>((acc, i) => { acc[i.policyCode] = (acc[i.policyCode] ?? 0) + 1; return acc; }, {}),
    byOwner: open.reduce<Record<string, number>>((acc, i) => { acc[i.owner] = (acc[i.owner] ?? 0) + 1; return acc; }, {}),
  };

  let items = q.includeClosed === 'true' ? all : open;
  if (q.status) items = items.filter((i) => i.status === q.status);
  if (q.stage) items = items.filter((i) => i.stage === q.stage);
  if (q.policy) items = items.filter((i) => i.policyCode === q.policy);
  if (q.owner) items = items.filter((i) => i.owner === q.owner);
  if (q.objectType) items = items.filter((i) => i.objectType === q.objectType);
  if (q.categoryId) items = items.filter((i) => i.categoryId === q.categoryId);
  if (q.dueFrom) items = items.filter((i) => i.dueAt && i.dueAt.slice(0, 10) >= q.dueFrom!);
  if (q.dueTo) items = items.filter((i) => i.dueAt && i.dueAt.slice(0, 10) <= q.dueTo!);
  if (q.q) {
    const needle = q.q.toLowerCase();
    items = items.filter((i) => [i.reference, i.invoiceNumber, i.vendorName, i.policyCode, i.policyName, i.owner].some((v) => v?.toLowerCase().includes(needle)));
  }
  res.json({ summary, items, generatedAt: now.toISOString() });
}));
