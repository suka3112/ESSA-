import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, pageParams, paginate, requireAuth, sortItems } from '../core/http';
import { ApiError, Errors } from '../core/errors';
import { audit } from '../core/audit';
import { ids, nowIso } from '../core/ids';
import { notifyRole } from '../modules/pipeline/helpers';
import { emailContent } from '../modules/email/templates';

export const adminRouter = Router();

// ------------------------------------------------------------ configuration
adminRouter.get('/configuration/versions', authorize('CONFIG_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({ items: db.configVersions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
}));

adminRouter.get('/configuration/versions/:id', authorize('CONFIG_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const version = db.configVersions.find((v) => v.id === req.params.id);
  if (!version) throw Errors.notFound('Configuration version', req.params.id);
  // Draft versions inherit the active baseline for display until edited (copy-on-write demo simplification)
  const effectiveId = ['ACTIVE', 'RETIRED'].includes(version.status) ? version.id : 'cfg-1';
  res.json({
    version,
    categories: db.categories,
    documentTypes: db.documentTypes,
    categoryDocuments: db.categoryDocuments.filter((c) => c.configVersionId === effectiveId),
    documentFields: db.documentFields.filter((f) => f.configVersionId === effectiveId),
    promptTemplates: db.promptTemplates,
    extractionProfiles: db.extractionProfiles,
    fieldMappings: db.fieldMappings.filter((m) => m.configVersionId === effectiveId),
    validationRules: db.validationRules.filter((r) => r.configVersionId === effectiveId),
    ruleOperands: db.ruleOperands,
    workflows: db.workflowDefinitions,
    notificationRules: db.notificationRules,
  });
}));

adminRouter.post('/configuration/versions', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const { label, notes } = req.body as { label?: string; notes?: string };
  if (!label?.trim()) throw Errors.validation('A version label is required');
  const maxNo = db.configVersions
    .map((v) => Number(v.versionNo.replace(/[^0-9.]/g, '')))
    .reduce((a, b) => Math.max(a, b), 0);
  const version = {
    id: ids.generic('CFG'),
    versionNo: `v${(maxNo + 0.1).toFixed(1)}`,
    label,
    status: 'DRAFT' as const,
    createdBy: user.name,
    createdAt: nowIso(),
    notes,
  };
  db.configVersions.unshift(version);
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: 'CONFIG_DRAFT_CREATED', category: 'CONFIGURATION', action: 'CREATE', module: 'configuration',
    entityType: 'CONFIGURATION', entityId: version.id, entityRef: version.versionNo,
    result: 'SUCCESS', correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
  res.status(201).json({ version });
}));

adminRouter.post('/configuration/versions/:id/transition', authorize('CONFIG_PUBLISH'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const version = db.configVersions.find((v) => v.id === req.params.id);
  if (!version) throw Errors.notFound('Configuration version', req.params.id);
  const { action, effectiveFrom } = req.body as { action?: 'TEST' | 'PUBLISH' | 'RETIRE' | 'BACK_TO_DRAFT'; effectiveFrom?: string };
  const old = version.status;
  if (action === 'TEST') {
    if (version.status !== 'DRAFT') throw Errors.conflict('Only draft versions can move to testing');
    version.status = 'TESTING';
  } else if (action === 'BACK_TO_DRAFT') {
    if (version.status !== 'TESTING') throw Errors.conflict('Only testing versions can move back to draft');
    version.status = 'DRAFT';
  } else if (action === 'PUBLISH') {
    if (!['TESTING', 'DRAFT'].includes(version.status)) throw Errors.conflict('Only draft/testing versions can be published');
    // retire currently active
    db.configVersions.filter((v) => v.status === 'ACTIVE').forEach((v) => {
      v.status = 'RETIRED';
      v.effectiveTo = effectiveFrom ?? nowIso().slice(0, 10);
    });
    version.status = 'ACTIVE';
    version.effectiveFrom = effectiveFrom ?? nowIso().slice(0, 10);
    version.approvedBy = user.name;
    version.approvedAt = nowIso();
    version.publishedBy = user.name;
    version.publishedAt = nowIso();
    // copy baseline configuration rows to the new version (immutable versions - copy-on-write)
    const clone = <T extends { id: string; configVersionId: string }>(rows: T[]): T[] =>
      rows.filter((r) => r.configVersionId === 'cfg-1').map((r) => ({ ...r, id: `${r.id}@${version.versionNo}`, configVersionId: version.id }));
    db.categoryDocuments.push(...clone(db.categoryDocuments));
    db.documentFields.push(...clone(db.documentFields));
    db.fieldMappings.push(...clone(db.fieldMappings));
    const ruleClones = db.validationRules.filter((r) => r.configVersionId === 'cfg-1').map((r) => ({ ...r, id: `${r.id}@${version.versionNo}`, configVersionId: version.id, version: version.versionNo }));
    db.validationRules.push(...ruleClones);
    db.ruleOperands.push(
      ...db.ruleOperands
        .filter((o) => db.validationRules.some((r) => r.id === o.ruleId && r.configVersionId === 'cfg-1'))
        .map((o) => ({ ...o, id: `${o.id}@${version.versionNo}`, ruleId: `${o.ruleId}@${version.versionNo}` }))
    );
    // Content comes from the configurable CONFIG_PUBLISHED_* email templates.
    const ctx = { versionNo: version.versionNo, label: version.label, effectiveFrom: version.effectiveFrom };
    const adminMsg = emailContent('CONFIG_PUBLISHED_ADMIN', ctx);
    const teamMsg = emailContent('CONFIG_PUBLISHED_TEAM', ctx);
    notifyRole('ADMINISTRATOR', 'CONFIGURATION', adminMsg.title, adminMsg.body);
    notifyRole('AP_REVIEWER', 'CONFIGURATION', teamMsg.title, teamMsg.body);
  } else if (action === 'RETIRE') {
    if (version.status !== 'ACTIVE') throw Errors.conflict('Only the active version can be retired');
    version.status = 'RETIRED';
    version.effectiveTo = nowIso().slice(0, 10);
  } else {
    throw Errors.badRequest('Unsupported action');
  }
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: action === 'PUBLISH' ? 'CONFIG_PUBLISHED' : `CONFIG_${action}`, category: 'CONFIGURATION',
    action: action ?? 'TRANSITION', module: 'configuration',
    entityType: 'CONFIGURATION', entityId: version.id, entityRef: version.versionNo,
    result: 'SUCCESS', oldValue: { status: old }, newValue: { status: version.status },
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
  res.json({ version });
}));

/** Object types for the configuration collections, as shown in the Audit Log. */
const ENTITY_LABEL: Record<string, string> = {
  categories: 'INVOICE_CATEGORY', documentTypes: 'DOCUMENT_TYPE',
  categoryDocuments: 'REQUIRED_DOCUMENT', documentFields: 'EXTRACTED_FIELD',
  promptTemplates: 'EXTRACTION_PROMPT', fieldMappings: 'SAP_FIELD_MAPPING',
  validationRules: 'VALIDATION_RULE', workflows: 'WORKFLOW',
  notificationRules: 'NOTIFICATION_RULE', doaMatrix: 'APPROVAL_HIERARCHY',
  roles: 'ROLE', exceptionCodes: 'EXCEPTION_CODE',
};

adminRouter.post('/configuration/entities/:entity', authorize('CONFIG_EDIT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const entity = req.params.entity;
  const { op, row } = req.body as { op?: 'CREATE' | 'UPDATE' | 'DELETE' | 'TOGGLE'; row?: Record<string, unknown> };
  if (!op || !row) throw Errors.validation('op and row are required');

  type Row = Record<string, unknown> & { id: string };
  const collections: Record<string, Row[]> = {
    categories: db.categories as unknown as Row[],
    documentTypes: db.documentTypes as unknown as Row[],
    categoryDocuments: db.categoryDocuments as unknown as Row[],
    documentFields: db.documentFields as unknown as Row[],
    promptTemplates: db.promptTemplates as unknown as Row[],
    fieldMappings: db.fieldMappings as unknown as Row[],
    validationRules: db.validationRules as unknown as Row[],
    workflows: db.workflowDefinitions as unknown as Row[],
    notificationRules: db.notificationRules as unknown as Row[],
    doaMatrix: db.doaMatrix as unknown as Row[],
    // SLA policies, reminders, escalations and calendars have their own
    // versioned lifecycle — see routes/sla.ts (Administration → SLA Management).
    // The exception-code catalogue is maintained there too (Exception Codes).
    exceptionCodes: db.exceptionCodes as unknown as Row[],
    // Role Management (design review, Aug 2026): admins can create/edit/
    // enable-disable custom roles and configure their permissions.
    roles: db.roles as unknown as Row[],
  };
  const coll = collections[entity];
  if (!coll) throw Errors.badRequest(`Unknown configuration entity ${entity}`);
  // The exception-code catalogue is fixed reference data (review, 25 Aug): one
  // code per error type, the same for every invoice, so history, reports and
  // vendor correspondence always mean the same thing. It is not edited in the
  // portal by any user — changes ship with a platform release.
  if (entity === 'exceptionCodes') throw new ApiError(403, 'FORBIDDEN', 'Exception codes are fixed reference data and cannot be changed in the portal');

  // Role safety rails: system roles cannot be deleted, and a role that is
  // still assigned to users must be unassigned before deletion.
  if (entity === 'roles' && op === 'DELETE') {
    const target = db.roles.find((r) => r.id === row.id);
    if (target?.system) throw Errors.badRequest('System roles cannot be deleted — disable them instead');
    if (db.users.some((u) => u.roleIds.includes(String(row.id)))) {
      throw Errors.conflict('This role is still assigned to users — remove the assignments first');
    }
  }

  let outcome: Row | undefined;
  let oldValue: Row | undefined;
  if (op === 'CREATE') {
    const id = (row.id as string) || ids.generic(entity.slice(0, 3).toUpperCase());
    outcome = { ...row, id } as Row;
    coll.push(outcome);
  } else {
    const idx = coll.findIndex((r) => r.id === row.id);
    if (idx < 0) throw Errors.notFound(entity, String(row.id));
    oldValue = { ...coll[idx] };
    if (op === 'DELETE') {
      coll.splice(idx, 1);
    } else if (op === 'TOGGLE') {
      const r = coll[idx] as Row & { active?: boolean; status?: string };
      if (typeof r.active === 'boolean') r.active = !r.active;
      else if (r.status === 'ACTIVE') r.status = 'INACTIVE';
      else if (r.status === 'INACTIVE') r.status = 'ACTIVE';
      outcome = coll[idx];
    } else {
      coll[idx] = { ...coll[idx], ...row };
      outcome = coll[idx];
    }
  }
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name,
    eventType: `CONFIG_${entity.toUpperCase()}_${op}`, category: 'CONFIGURATION', action: op, module: 'configuration',
    entityType: ENTITY_LABEL[entity] ?? entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase(), entityId: String(row.id ?? outcome?.id ?? ''),
    entityRef: String((row.name as string) ?? (row.ruleName as string) ?? (row.label as string) ?? (row.activityType as string) ?? (row.code as string) ?? ''),
    result: 'SUCCESS', oldValue, newValue: outcome,
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
  res.json({ row: outcome ?? null });
}));

// ---------------------------------------------------------------- users
adminRouter.get('/users', authorize('USER_ADMIN'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    users: db.users.map((u) => ({
      ...u,
      roleNames: db.roles.filter((r) => u.roleIds.includes(r.id)).map((r) => r.name),
    })),
    roles: db.roles,
    permissions: db.permissions,
  });
}));

/**
 * Add a portal user.
 *
 * People sign in with their ESSA corporate account, so this does not create a
 * credential — it registers the corporate identity with the platform and gives
 * it the roles it should hold. Until an administrator does this, a colleague
 * who signs in has no access to anything.
 */
adminRouter.post('/users', authorize('USER_ADMIN'), asyncHandler((req, res) => {
  const actor = requireAuth(req);
  const db = getDb();
  const { name, email, title, roleIds, enabled } = req.body as {
    name?: string; email?: string; title?: string; roleIds?: string[]; enabled?: boolean;
  };
  if (!name?.trim()) throw Errors.validation('A name is required');
  const normEmail = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail)) throw Errors.validation('A valid corporate email address is required');
  if (db.users.some((u) => u.email.toLowerCase() === normEmail)) {
    throw Errors.conflict('Someone with that email address already has access to this platform');
  }
  const roles = Array.isArray(roleIds) ? roleIds : [];
  if (roles.some((r) => !db.roles.some((x) => x.id === r))) throw Errors.badRequest('Unknown role in assignment');

  const user = {
    id: ids.generic('USR'),
    entraObjectId: `entra-${normEmail.replace(/[^a-z0-9]+/g, '-')}`,
    name: name.trim(),
    email: normEmail,
    title: title?.trim() || 'Portal user',
    roleIds: roles,
    groups: [] as string[],
    enabled: enabled !== false,
  };
  db.users.push(user);
  markDirty();
  const roleNames = db.roles.filter((r) => roles.includes(r.id)).map((r) => r.name).join(', ') || 'None';
  audit({
    actorType: 'USER', actorId: actor.id, actorName: actor.name,
    eventType: 'USER_ADDED', category: 'ACCESS', action: 'CREATE', module: 'identity-access',
    entityType: 'USER', entityId: user.id, entityRef: user.name,
    result: 'SUCCESS', reason: 'Portal access granted',
    newValue: { Name: user.name, Email: user.email, 'Job title': user.title, Roles: roleNames, Status: user.enabled ? 'Active' : 'Inactive' },
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
  res.status(201).json({ user });
}));

adminRouter.post('/users/:id', authorize('USER_ADMIN'), asyncHandler((req, res) => {
  const actor = requireAuth(req);
  const db = getDb();
  const target = db.users.find((u) => u.id === req.params.id);
  if (!target) throw Errors.notFound('User', req.params.id);
  const { enabled, roleIds, title } = req.body as { enabled?: boolean; roleIds?: string[]; title?: string };
  // The audit log shows these values to a person, so record them the way the
  // Users screen shows them — role names and Active/Inactive, never raw ids
  // (review, 24 Aug: "I have to see the proper value").
  const roleNames = (ids: string[]) => db.roles.filter((r) => ids.includes(r.id)).map((r) => r.name).join(', ') || 'None';
  const old = { Status: target.enabled ? 'Active' : 'Inactive', Roles: roleNames(target.roleIds) };
  if (typeof enabled === 'boolean') target.enabled = enabled;
  if (Array.isArray(roleIds)) {
    if (roleIds.some((r) => !db.roles.some((x) => x.id === r))) throw Errors.badRequest('Unknown role in assignment');
    target.roleIds = roleIds;
  }
  if (title) target.title = title;
  markDirty();
  audit({
    actorType: 'USER', actorId: actor.id, actorName: actor.name,
    eventType: typeof enabled === 'boolean' ? (enabled ? 'USER_ENABLED' : 'USER_DISABLED') : 'ROLE_ASSIGNED',
    category: 'ACCESS', action: 'UPDATE', module: 'identity-access',
    entityType: 'USER', entityId: target.id, entityRef: target.name,
    result: 'SUCCESS', oldValue: old,
    newValue: { Status: target.enabled ? 'Active' : 'Inactive', Roles: roleNames(target.roleIds) },
    correlationId: req.ctx.correlationId, source: 'PORTAL',
  });
  res.json({ user: target });
}));

// ---------------------------------------------------------------- audit
adminRouter.get('/audit', authorize('AUDIT_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  let items = [...db.auditEvents];
  const q = req.query;
  const text = String(q.search ?? '').trim().toLowerCase();
  if (text) {
    items = items.filter((a) =>
      [a.actorName, a.eventType, a.entityType, a.entityRef, a.entityId, a.correlationId, a.reason, a.action]
        .some((v) => v?.toLowerCase().includes(text))
    );
  }
  // Each filter matches exactly one column of the Audit Log, and its options
  // are the values that appear in that column (design reference, 24 Aug).
  if (q.entityType) items = items.filter((a) => a.entityType === q.entityType);
  if (q.eventType) items = items.filter((a) => a.eventType === q.eventType);
  if (q.source) items = items.filter((a) => sourceLabel(a.source) === q.source);
  if (q.result) items = items.filter((a) => a.result === q.result);
  if (q.category) items = items.filter((a) => a.category === q.category);
  if (q.actorId) items = items.filter((a) => a.actorId === q.actorId);
  if (q.actorName) items = items.filter((a) => a.actorName === q.actorName);
  if (q.invoiceId) items = items.filter((a) => a.invoiceId === q.invoiceId);
  if (q.dateFrom) items = items.filter((a) => a.eventTime >= String(q.dateFrom));
  if (q.dateTo) items = items.filter((a) => a.eventTime <= String(q.dateTo) + 'T23:59:59Z');

  const p = pageParams(req, 'eventTime');
  items = sortItems(items, p.sortBy, p.sortDir);
  const page = paginate(items, p);

  // Facets come from the whole log, not the filtered page, so the drop-downs
  // stay stable while the user narrows the list down.
  const uniq = <T,>(values: T[]) => [...new Set(values)].filter(Boolean).sort();
  res.json({
    ...page,
    items: page.items.map((a) => ({
      ...a,
      source: sourceLabel(a.source),
      // The expanded record names the role the person held, so it is resolved
      // here rather than being left to whatever the call site remembered.
      actorRole: a.actorRole ?? actorRoleOf(a.actorId, a.actorType),
    })),
    facets: {
      objectTypes: uniq(db.auditEvents.map((a) => a.entityType)),
      actions: uniq(db.auditEvents.map((a) => a.eventType)),
      sources: uniq(db.auditEvents.map((a) => sourceLabel(a.source))),
      results: uniq(db.auditEvents.map((a) => a.result)),
      users: uniq(db.auditEvents.map((a) => a.actorName)),
    },
  });
}));

/**
 * Where the activity came from. Anything the platform did on its own is SYSTEM;
 * anything a person did in the portal is PORTAL. The specific channel
 * (single sign-on, the V1 portal) is an implementation detail.
 */
function sourceLabel(source: string): string {
  if (source === 'BACKEND' || source === 'SYSTEM' || source === 'SCHEDULER') return 'SYSTEM';
  if (source === 'ENTRA_SSO' || source === 'V1_SWITCH') return 'PORTAL';
  return source;
}

/** The role the actor holds, for the expanded record. */
function actorRoleOf(actorId: string, actorType: string): string {
  if (actorType !== 'USER') return 'System';
  const db = getDb();
  const actor = db.users.find((u) => u.id === actorId);
  if (!actor) return '—';
  const roles = db.roles.filter((r) => actor.roleIds.includes(r.id)).map((r) => r.name);
  return roles.join(', ') || actor.title || '—';
}

// ------------------------------------------------------------- tech logs
adminRouter.get('/tech-logs', authorize('TECH_LOG_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  let items = [...db.technicalLogs];
  const q = req.query;
  const text = String(q.search ?? '').trim().toLowerCase();
  if (text) {
    items = items.filter((l) =>
      [l.event, l.message, l.correlationId, l.module, l.errorCode, l.invoiceId]
        .some((v) => v?.toLowerCase().includes(text))
    );
  }
  if (q.level) items = items.filter((l) => l.level === q.level);
  if (q.module) items = items.filter((l) => l.module === q.module);
  const p = pageParams(req, 'timestamp');
  items = sortItems(items, p.sortBy, p.sortDir);
  res.json(paginate(items, p));
}));
