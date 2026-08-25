import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, requireAuth, resolvePermissions } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { ids, nowIso } from '../core/ids';

export const authRouter = Router();

/**
 * MOCK ENTRA AUTHENTICATION.
 * Production: OIDC redirect to Microsoft Entra ID (Fiori tile or direct URL),
 * token validated server-side; no local passwords (ADR-002).
 * Demo: pick an enabled portal user; the issued bearer token represents the
 * validated Entra session. The provider boundary is this router + the auth
 * middleware - swap both for real Entra without touching business modules.
 */
authRouter.get('/auth/directory', asyncHandler((req, res) => {
  const db = getDb();
  res.json(
    db.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      title: u.title,
      enabled: u.enabled,
      roles: db.roles.filter((r) => u.roleIds.includes(r.id)).map((r) => r.name),
    }))
  );
}));

authRouter.post('/auth/login', asyncHandler((req, res) => {
  const { userId } = req.body as { userId?: string };
  const db = getDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw Errors.badRequest('Unknown user');
  if (!user.enabled) {
    audit({
      actorType: 'USER', actorId: user.id, actorName: user.name,
      eventType: 'LOGIN_FAILED', category: 'AUTHENTICATION', action: 'LOGIN', module: 'identity-access',
      entityType: 'SESSION', entityId: ids.generic('SES'), entityRef: user.name, result: 'DENIED',
      reason: 'Portal user is disabled', correlationId: req.ctx.correlationId, source: 'ENTRA_SSO',
    });
    throw Errors.forbidden('sign in - this portal user is disabled');
  }
  user.lastLoginAt = nowIso();
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name, actorRole: user.title,
    eventType: 'LOGIN_SUCCESS', category: 'AUTHENTICATION', action: 'LOGIN', module: 'identity-access',
    entityType: 'SESSION', entityId: ids.generic('SES'), entityRef: user.name, result: 'SUCCESS',
    correlationId: req.ctx.correlationId, source: 'ENTRA_SSO',
  });
  const { permissions, roles } = resolvePermissions(user);
  res.json({
    token: `mock-entra.${user.id}`,
    user: { ...user, permissions: [...permissions], roleNames: roles.map((r) => r.name) },
  });
}));

/**
 * V1 -> V2 session handoff (version switcher).
 * The V1 POC hands over the already-authenticated identity (email/name/role);
 * V2 signs the same user in without a second login. V1 roles map onto the
 * V2 persona model; unknown users are provisioned on first switch.
 */
const V1_ROLE_TO_V2_ROLE: Record<string, { roleId: string; title: string }> = {
  '5': { roleId: 'role-ap-processor', title: 'AP Processor (V1: AP Team)' },
  '6': { roleId: 'role-ap-reviewer', title: 'AP Supervisor' },
  '14': { roleId: 'role-ap-reviewer', title: 'AP Supervisor (V1: AP Lead)' },
  '15': { roleId: 'role-ap-reviewer', title: 'AP Supervisor (V1: Finance Manager)' },
  '16': { roleId: 'role-ap-reviewer', title: 'AP Supervisor (V1: Head of Section)' },
  '17': { roleId: 'role-ap-reviewer', title: 'AP Supervisor' },
  '18': { roleId: 'role-ap-reviewer', title: 'AP Supervisor (V1: Head of Function)' },
  '19': { roleId: 'role-ap-reviewer', title: 'AP Supervisor (V1: Site Head)' },
  '20': { roleId: 'role-ap-reviewer', title: 'AP Supervisor (V1: Group Functional Director)' },
  '4': { roleId: 'role-admin', title: 'Administrator' },
  '2': { roleId: 'role-ap-processor', title: 'AP Processor (V1: Finance)' },
};

authRouter.post('/auth/v1-handoff', asyncHandler((req, res) => {
  const { email, name, roleId } = req.body as { email?: string; name?: string; roleId?: string | number };
  if (!email?.trim()) throw Errors.badRequest('V1 identity email is required');
  const db = getDb();
  const mapping = V1_ROLE_TO_V2_ROLE[String(roleId ?? '')] ?? { roleId: 'role-ap-processor', title: 'AP Processor' };
  const normEmail = email.trim().toLowerCase();

  let user = db.users.find((u) => u.email.toLowerCase() === normEmail);
  if (!user) {
    user = {
      id: 'v1-' + normEmail.replace(/[^a-z0-9]+/g, '-'),
      entraObjectId: 'v1-' + normEmail,
      name: name?.trim() || normEmail,
      email: normEmail,
      title: mapping.title,
      roleIds: [mapping.roleId],
      groups: ['V1 Portal Users'],
      enabled: true,
    };
    db.users.push(user);
  } else if (!user.roleIds.length) {
    user.roleIds = [mapping.roleId];
  }
  if (!user.enabled) throw Errors.forbidden('sign in - this portal user is disabled');
  user.lastLoginAt = nowIso();
  markDirty();
  audit({
    actorType: 'USER', actorId: user.id, actorName: user.name, actorRole: user.title,
    eventType: 'LOGIN_SUCCESS', category: 'AUTHENTICATION', action: 'LOGIN', module: 'identity-access',
    entityType: 'SESSION', entityId: ids.generic('SES'), entityRef: user.name, result: 'SUCCESS',
    reason: 'V1 -> V2 version switch (session handoff, no re-authentication)',
    correlationId: req.ctx.correlationId, source: 'V1_SWITCH',
  });
  const { permissions, roles } = resolvePermissions(user);
  res.json({
    token: `mock-entra.${user.id}`,
    user: { ...user, permissions: [...permissions], roleNames: roles.map((r) => r.name) },
  });
}));

authRouter.get('/auth/me', asyncHandler((req, res) => {
  const user = requireAuth(req);
  const { permissions, roles } = resolvePermissions(user);
  res.json({ user: { ...user, permissions: [...permissions], roleNames: roles.map((r) => r.name) } });
}));

authRouter.post('/auth/logout', asyncHandler((req, res) => {
  if (req.ctx.user) {
    audit({
      actorType: 'USER', actorId: req.ctx.user.id, actorName: req.ctx.user.name,
      eventType: 'LOGOUT', category: 'AUTHENTICATION', action: 'LOGOUT', module: 'identity-access',
      entityType: 'SESSION', entityId: ids.generic('SES'), entityRef: req.ctx.user.name, result: 'SUCCESS',
      correlationId: req.ctx.correlationId, source: 'PORTAL',
    });
  }
  res.json({ ok: true });
}));
