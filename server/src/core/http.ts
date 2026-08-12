import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ApiError } from './errors';
import { ids } from './ids';
import { techLog } from './logger';
import type { AppUser, PermissionCode, Role } from './types';
import { getDb } from './store';

// ---------- request context ----------
export interface RequestContext {
  correlationId: string;
  requestId: string;
  user?: AppUser;
  permissions: Set<PermissionCode>;
  roles: Role[];
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.header('x-correlation-id') as string) || ids.correlation();
  req.ctx = {
    correlationId,
    requestId: ids.request(),
    permissions: new Set(),
    roles: [],
  };
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-request-id', req.ctx.requestId);
  next();
}

// ---------- auth ----------
export function resolvePermissions(user: AppUser): { permissions: Set<PermissionCode>; roles: Role[] } {
  const db = getDb();
  const roles = db.roles.filter((r) => user.roleIds.includes(r.id));
  const permissions = new Set<PermissionCode>();
  roles.forEach((r) => r.permissions.forEach((p) => permissions.add(p)));
  return { permissions, roles };
}

/**
 * Mock Entra ID token validation.
 * In production this middleware validates the OIDC token signature/issuer/
 * audience against Microsoft Entra ID. In the demo the bearer token carries
 * the mock session user id issued by /auth/login.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer mock-entra.')) {
    const userId = header.substring('Bearer mock-entra.'.length);
    const user = getDb().users.find((u) => u.id === userId && u.enabled);
    if (user) {
      const { permissions, roles } = resolvePermissions(user);
      req.ctx.user = user;
      req.ctx.permissions = permissions;
      req.ctx.roles = roles;
    }
  }
  next();
}

export function requireAuth(req: Request): AppUser {
  if (!req.ctx.user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required');
  return req.ctx.user;
}

/** Backend authorization is authoritative - independent of frontend menu visibility. */
export function authorize(...required: PermissionCode[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.ctx.user;
    if (!user) return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required'));
    const ok = required.every((p) => req.ctx.permissions.has(p));
    if (!ok) {
      techLog({
        module: 'identity-access', event: 'AUTHORIZATION_DENIED', level: 'WARN',
        message: `User ${user.id} denied: requires ${required.join(', ')}`,
        correlationId: req.ctx.correlationId, requestId: req.ctx.requestId, status: 'DENIED',
      });
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action'));
    }
    next();
  };
}

// ---------- helpers ----------
export function asyncHandler(fn: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export interface PageParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
}

export function pageParams(req: Request, defaultSort?: string): PageParams {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(5, parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
  const sortBy = (req.query.sortBy as string) || defaultSort;
  const sortDir = (req.query.sortDir as string) === 'asc' ? 'asc' : 'desc';
  return { page, pageSize, sortBy, sortDir };
}

export function paginate<T>(items: T[], p: PageParams) {
  const total = items.length;
  const start = (p.page - 1) * p.pageSize;
  return {
    items: items.slice(start, start + p.pageSize),
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

export function sortItems<T>(items: T[], sortBy: string | undefined, dir: 'asc' | 'desc'): T[] {
  if (!sortBy) return items;
  const mul = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortBy];
    const bv = (b as Record<string, unknown>)[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
}

// ---------- error envelope ----------
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const correlationId = req.ctx?.correlationId ?? 'unknown';
  if (err instanceof ApiError) {
    res.status(err.status).json({
      errorCode: err.errorCode,
      message: err.message,
      detail: err.detail,
      correlationId,
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  techLog({
    module: 'http', event: 'UNHANDLED_ERROR', level: 'ERROR',
    message, correlationId, requestId: req.ctx?.requestId, errorCode: 'INTERNAL_ERROR',
  });
  res.status(500).json({
    errorCode: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred. Support can trace this with the correlation ID.',
    correlationId,
  });
}
