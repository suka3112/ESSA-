/**
 * Administration → Email Templates.
 *
 * Admin-only management surface for the configurable email templates behind
 * every outbound email scenario. Viewing requires CONFIG_VIEW, changing
 * anything requires CONFIG_EDIT — the same split the rest of Administration
 * uses (only the Administrator role holds either).
 *
 * Every change is versioned (emailTemplateVersions) and audited.
 */
import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { ids, nowIso } from '../core/ids';
import type { EmailTemplate } from '../core/types';
import {
  EMAIL_SCENARIOS, ensureEmailTemplates, extractPlaceholders, findScenario,
  htmlToText, recordVersion, renderString, sampleContext,
} from '../modules/email/templates';
import { notifyUser } from '../modules/pipeline/helpers';

export const emailTemplateRouter = Router();

function db() {
  const d = getDb();
  ensureEmailTemplates(d);
  return d;
}

function templateOr404(id: string): EmailTemplate {
  const t = db().emailTemplates.find((x) => x.id === id);
  if (!t) throw Errors.notFound('Email template', id);
  return t;
}

interface TemplateBody {
  name?: string;
  scenario?: string;
  description?: string;
  subject?: string;
  bodyHtml?: string;
  recipients?: { to?: string; cc?: string; bcc?: string };
  status?: 'ACTIVE' | 'INACTIVE';
}

/**
 * Validates a template payload. Rules:
 *  · name, scenario, subject and body are required;
 *  · the scenario must exist in the catalogue;
 *  · every placeholder the scenario marks as required must appear in the
 *    subject or the body;
 *  · every placeholder used must be a variable the scenario provides
 *    (an unknown one would render as a literal {{token}} in real emails).
 */
function validateTemplate(body: TemplateBody): { scenarioKey: string; problems: string[] } {
  const problems: string[] = [];
  if (!body.name?.trim()) problems.push('Template name is required.');
  const scenarioKey = body.scenario?.trim() ?? '';
  const scenario = findScenario(scenarioKey);
  if (!scenario) problems.push('A valid scenario/event is required.');
  if (!body.subject?.trim()) problems.push('Subject is required.');
  const html = body.bodyHtml ?? '';
  if (!htmlToText(html).trim()) problems.push('Email body is required.');
  if (!body.recipients?.to?.trim()) problems.push('A To recipient is required.');
  if (scenario) {
    const used = extractPlaceholders(body.subject ?? '', html);
    const known = new Set(scenario.variables.map((v) => v.name));
    const missing = scenario.required.filter((r) => !used.includes(r));
    if (missing.length) problems.push(`Required placeholder${missing.length > 1 ? 's' : ''} missing: ${missing.map((m) => `{{${m}}}`).join(', ')}.`);
    const unknown = used.filter((u) => !known.has(u));
    if (unknown.length) problems.push(`Unknown placeholder${unknown.length > 1 ? 's' : ''} for this scenario: ${unknown.map((m) => `{{${m}}}`).join(', ')}.`);
  }
  return { scenarioKey, problems };
}

function auditTemplate(userId: string, userName: string, eventType: string, action: string, t: EmailTemplate, reason?: string) {
  audit({
    actorType: 'USER', actorId: userId, actorName: userName,
    eventType, category: 'CONFIGURATION', action, module: 'email-templates',
    entityType: 'EMAIL_TEMPLATE', entityId: t.id, entityRef: t.name,
    result: 'SUCCESS', reason, correlationId: ids.correlation(), source: 'PORTAL',
    newValue: { scenario: t.scenario, subject: t.subject, status: t.status, version: t.version },
  });
}

// ------------------------------------------------------------ read

emailTemplateRouter.get('/admin/email-templates', authorize('CONFIG_VIEW'), asyncHandler((_req, res) => {
  const d = db();
  res.json({
    items: d.emailTemplates,
    scenarios: EMAIL_SCENARIOS.map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      category: s.category,
      recipients: s.recipients,
      variables: s.variables,
      required: s.required,
    })),
  });
}));

emailTemplateRouter.get('/admin/email-templates/:id', authorize('CONFIG_VIEW'), asyncHandler((req, res) => {
  const t = templateOr404(req.params.id);
  const versions = db().emailTemplateVersions
    .filter((v) => v.templateId === t.id)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  res.json({ template: t, versions });
}));

// ------------------------------------------------------------ preview (no persistence)

emailTemplateRouter.post('/admin/email-templates/preview', authorize('CONFIG_VIEW'), asyncHandler((req, res) => {
  const { scenario: key, subject, bodyHtml } = req.body as { scenario?: string; subject?: string; bodyHtml?: string };
  const scenario = key ? findScenario(key) : undefined;
  if (!scenario) throw Errors.badRequest('A valid scenario is required for the preview');
  const ctx = sampleContext(scenario);
  const html = renderString(bodyHtml ?? '', ctx);
  res.json({
    subject: renderString(subject ?? '', ctx),
    html,
    text: htmlToText(html),
    sample: ctx,
  });
}));

// ------------------------------------------------------------ create / update

emailTemplateRouter.post('/admin/email-templates', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const body = req.body as TemplateBody;
  const { scenarioKey, problems } = validateTemplate(body);
  if (problems.length) throw Errors.validation(problems.join(' '), { problems });
  const d = db();
  const scenario = findScenario(scenarioKey)!;
  const at = nowIso();
  const t: EmailTemplate = {
    id: ids.generic('EMT'),
    name: body.name!.trim(),
    scenario: scenarioKey,
    description: body.description?.trim() || scenario.description,
    subject: body.subject!.trim(),
    bodyHtml: body.bodyHtml ?? '',
    recipients: { to: body.recipients!.to!.trim(), cc: body.recipients?.cc?.trim() || undefined, bcc: body.recipients?.bcc?.trim() || undefined },
    requiredPlaceholders: [...scenario.required],
    status: body.status ?? 'ACTIVE',
    system: false,
    version: 1,
    createdAt: at, createdBy: user.name,
    updatedAt: at, updatedBy: user.name,
  };
  d.emailTemplates.push(t);
  recordVersion(d, t, 'CREATED', user.name);
  markDirty();
  auditTemplate(user.id, user.name, 'EMAIL_TEMPLATE_CREATED', 'CREATE', t);
  res.status(201).json({ template: t });
}));

emailTemplateRouter.post('/admin/email-templates/:id/update', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const t = templateOr404(req.params.id);
  const body = req.body as TemplateBody;
  // System templates stay bound to their scenario — that binding is what the pipeline resolves.
  const effective: TemplateBody = { ...body, scenario: t.system ? t.scenario : (body.scenario ?? t.scenario) };
  const { problems } = validateTemplate(effective);
  if (problems.length) throw Errors.validation(problems.join(' '), { problems });
  const statusChanged = body.status && body.status !== t.status;
  t.name = effective.name!.trim();
  t.scenario = effective.scenario!;
  t.description = effective.description?.trim() || t.description;
  t.subject = effective.subject!.trim();
  t.bodyHtml = effective.bodyHtml ?? '';
  t.recipients = { to: effective.recipients!.to!.trim(), cc: effective.recipients?.cc?.trim() || undefined, bcc: effective.recipients?.bcc?.trim() || undefined };
  if (body.status) t.status = body.status;
  t.version += 1;
  t.updatedAt = nowIso();
  t.updatedBy = user.name;
  recordVersion(db(), t, statusChanged ? (t.status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED') : 'UPDATED', user.name);
  markDirty();
  auditTemplate(user.id, user.name, 'EMAIL_TEMPLATE_UPDATED', 'UPDATE', t);
  res.json({ template: t });
}));

// ------------------------------------------------------------ duplicate / status / delete

emailTemplateRouter.post('/admin/email-templates/:id/duplicate', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const src = templateOr404(req.params.id);
  const d = db();
  const at = nowIso();
  const copy: EmailTemplate = {
    ...structuredClone(src),
    id: ids.generic('EMT'),
    name: `${src.name} (copy)`,
    system: false,
    // A duplicate starts INACTIVE so it can never silently take over the
    // scenario from the template it was copied from.
    status: 'INACTIVE',
    version: 1,
    createdAt: at, createdBy: user.name,
    updatedAt: at, updatedBy: user.name,
  };
  d.emailTemplates.push(copy);
  recordVersion(d, copy, 'DUPLICATED', user.name, `Duplicated from "${src.name}"`);
  markDirty();
  auditTemplate(user.id, user.name, 'EMAIL_TEMPLATE_DUPLICATED', 'CREATE', copy, `Duplicated from ${src.id}`);
  res.status(201).json({ template: copy });
}));

emailTemplateRouter.post('/admin/email-templates/:id/status', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const t = templateOr404(req.params.id);
  const { status } = req.body as { status?: 'ACTIVE' | 'INACTIVE' };
  if (status !== 'ACTIVE' && status !== 'INACTIVE') throw Errors.badRequest('status must be ACTIVE or INACTIVE');
  if (t.status === status) { res.json({ template: t }); return; }
  t.status = status;
  t.version += 1;
  t.updatedAt = nowIso();
  t.updatedBy = user.name;
  recordVersion(db(), t, status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED', user.name);
  markDirty();
  auditTemplate(user.id, user.name, `EMAIL_TEMPLATE_${status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED'}`, 'UPDATE', t);
  res.json({ template: t });
}));

emailTemplateRouter.post('/admin/email-templates/:id/delete', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const t = templateOr404(req.params.id);
  if (t.system) throw Errors.conflict('Built-in scenario templates cannot be deleted — deactivate the template instead (the scenario then falls back to its default content).');
  const d = db();
  d.emailTemplates = d.emailTemplates.filter((x) => x.id !== t.id);
  // Version history is kept — it is the audit trail of the template's life.
  markDirty();
  auditTemplate(user.id, user.name, 'EMAIL_TEMPLATE_DELETED', 'DELETE', t);
  res.json({ ok: true });
}));

// ------------------------------------------------------------ restore a previous version

emailTemplateRouter.post('/admin/email-templates/:id/restore', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const t = templateOr404(req.params.id);
  const { versionId } = req.body as { versionId?: string };
  const v = db().emailTemplateVersions.find((x) => x.id === versionId && x.templateId === t.id);
  if (!v) throw Errors.notFound('Template version', versionId ?? '');
  t.name = v.snapshot.name;
  t.description = v.snapshot.description;
  t.subject = v.snapshot.subject;
  t.bodyHtml = v.snapshot.bodyHtml;
  t.recipients = { ...v.snapshot.recipients };
  t.requiredPlaceholders = [...v.snapshot.requiredPlaceholders];
  t.status = v.snapshot.status;
  t.version += 1;
  t.updatedAt = nowIso();
  t.updatedBy = user.name;
  recordVersion(db(), t, 'RESTORED', user.name, `Restored version ${v.version}`);
  markDirty();
  auditTemplate(user.id, user.name, 'EMAIL_TEMPLATE_RESTORED', 'UPDATE', t, `Restored version ${v.version}`);
  res.json({ template: t });
}));

// ------------------------------------------------------------ test email

emailTemplateRouter.post('/admin/email-templates/:id/test', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const t = templateOr404(req.params.id);
  const scenario = findScenario(t.scenario);
  if (!scenario) throw Errors.conflict(`Scenario ${t.scenario} is not registered`);
  const ctx = sampleContext(scenario);
  const subject = renderString(t.subject, ctx);
  const html = renderString(t.bodyHtml, ctx);
  // Reuses the existing email infrastructure: the message is queued through
  // the same notification service every scenario sends with (EMAIL channel),
  // addressed to the administrator who asked for the test.
  notifyUser(user.id, scenario.category, `[TEST] ${subject}`, htmlToText(html), { channel: 'EMAIL', entityRef: t.id });
  auditTemplate(user.id, user.name, 'EMAIL_TEMPLATE_TEST_SENT', 'EXECUTE', t, `Test email sent to ${user.email}`);
  res.json({ ok: true, to: user.email, subject: `[TEST] ${subject}` });
}));
