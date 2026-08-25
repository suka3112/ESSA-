import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, pageParams, paginate, requireAuth, sortItems } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { nowIso } from '../core/ids';
import { enqueueJob } from '../core/jobs';
import { addTimeline } from '../modules/pipeline/helpers';
import { exceptionCodeFor } from '../db/seed/sla';

export const exceptionRouter = Router();

exceptionRouter.get('/exceptions', authorize('EXCEPTION_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  let items = [...db.exceptions];
  const q = req.query;
  const text = String(q.search ?? '').trim().toLowerCase();
  if (text) {
    items = items.filter((e) => {
      const inv = db.invoices.find((i) => i.id === e.invoiceId);
      return [e.code, e.title, e.detail, e.ruleCode, inv?.invoiceNumber, inv?.vendorName]
        .some((v) => v?.toLowerCase().includes(text));
    });
  }
  if (q.type) items = items.filter((e) => e.type === q.type);
  // One code per error type (review, 24 Aug): filtering by a code returns only
  // that error, whatever the invoice, category or vendor.
  if (q.exceptionCode) {
    items = items.filter((e) => exceptionCodeFor(e.type, e.documentTypeId)?.code === String(q.exceptionCode));
  }
  if (q.status) items = items.filter((e) => e.status === q.status);
  if (q.severity) items = items.filter((e) => e.severity === q.severity);
  if (q.assignedTo) items = items.filter((e) => e.assignedTo === q.assignedTo);
  if (q.open === 'true') items = items.filter((e) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status));
  if (q.technical === 'true') items = items.filter((e) => e.technical);
  if (q.technical === 'false') items = items.filter((e) => !e.technical);

  const p = pageParams(req, 'createdAt');
  items = sortItems(items, p.sortBy, p.sortDir);
  const page = paginate(items, p);
  res.json({
    ...page,
    items: page.items.map((e) => {
      const inv = db.invoices.find((i) => i.id === e.invoiceId);
      return {
        ...e,
        invoiceNumber: inv?.invoiceNumber,
        vendorName: inv?.vendorName,
        amount: inv?.amount,
        currency: inv?.currency,
        exceptionCode: exceptionCodeFor(e.type, e.documentTypeId)?.code ?? '—',
        exceptionCodeLabel: exceptionCodeFor(e.type, e.documentTypeId)?.label ?? '',
        exceptionCodeDescription: exceptionCodeFor(e.type, e.documentTypeId)?.description ?? '',
        ageHours: Math.round((Date.now() - new Date(e.createdAt).getTime()) / 3600000),
        // One SLA clock per invoice (ESSA EAPA SLA Matrix): the workbench shows
        // the invoice's own SLA rather than a second timer on the exception,
        // so the two screens can never disagree about what is overdue.
        slaDueAt: inv?.slaDueAt || e.slaDueAt,
        slaBreached: inv
          ? Boolean(inv.slaBreached) && !['RESOLVED', 'CLOSED'].includes(e.status)
          : e.slaDueAt < nowIso() && !['RESOLVED', 'CLOSED'].includes(e.status),
      };
    }),
  });
}));

exceptionRouter.get('/exceptions/:id', authorize('EXCEPTION_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const exc = db.exceptions.find((e) => e.id === req.params.id || e.code === req.params.id);
  if (!exc) throw Errors.notFound('Exception', req.params.id);
  const inv = db.invoices.find((i) => i.id === exc.invoiceId);
  const rule = exc.ruleCode ? db.validationRules.find((r) => r.ruleCode === exc.ruleCode) : undefined;
  const latestRun = db.validationRuns.filter((r) => r.invoiceId === exc.invoiceId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  res.json({
    exception: exc,
    invoice: inv,
    rule,
    ruleResult: latestRun && exc.ruleCode
      ? db.validationResults.find((r) => r.runId === latestRun.id && r.ruleCode === exc.ruleCode)
      : undefined,
    documentType: exc.documentTypeId ? db.documentTypes.find((t) => t.id === exc.documentTypeId) : undefined,
  });
}));

exceptionRouter.post('/exceptions/:id/action', authorize('EXCEPTION_MANAGE'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const exc = db.exceptions.find((e) => e.id === req.params.id || e.code === req.params.id);
  if (!exc) throw Errors.notFound('Exception', req.params.id);
  const { action, note, userId } = req.body as { action?: string; note?: string; userId?: string };
  const invoice = db.invoices.find((i) => i.id === exc.invoiceId)!;

  const record = (a: string, n?: string) => {
    exc.actions.push({ at: nowIso(), by: user.id, byName: user.name, action: a, note: n });
    audit({
      actorType: 'USER', actorId: user.id, actorName: user.name,
      eventType: `EXCEPTION_${a}`, category: 'EXCEPTION', action: a, module: 'exceptions',
      entityType: 'EXCEPTION', entityId: exc.code, entityRef: invoice.invoiceNumber, invoiceId: invoice.id,
      result: 'SUCCESS', reason: n, correlationId: exc.correlationId, source: 'PORTAL',
    });
  };

  switch (action) {
    case 'ASSIGN': {
      const assignee = db.users.find((u) => u.id === userId);
      if (!assignee) throw Errors.badRequest('Unknown assignee');
      exc.assignedTo = assignee.id;
      exc.assignedToName = assignee.name;
      exc.status = 'ASSIGNED';
      record('ASSIGNED', `Assigned to ${assignee.name}${note ? ` - ${note}` : ''}`);
      break;
    }
    case 'INVESTIGATE':
      exc.status = 'IN_PROGRESS';
      if (!exc.assignedTo) { exc.assignedTo = user.id; exc.assignedToName = user.name; }
      record('INVESTIGATING', note);
      break;
    case 'WAIT':
      exc.status = 'WAITING';
      record('WAITING', note ?? 'Waiting on external input');
      break;
    case 'RETRY':
      if (!exc.technical) throw Errors.conflict('Retry applies to technical exceptions only');
      exc.retryCount += 1;
      exc.status = 'IN_PROGRESS';
      record('RETRIED', note);
      enqueueJob('REPROCESS', { invoiceId: invoice.id, correlationId: exc.correlationId, detail: `Retry after technical exception ${exc.code}` });
      break;
    case 'RESOLVE':
      if (!note?.trim()) throw Errors.validation('A resolution note is required');
      exc.status = 'RESOLVED';
      exc.resolvedAt = nowIso();
      exc.resolution = note;
      record('RESOLVED', note);
      addTimeline(invoice.id, 'EXCEPTION_RESOLVED', `Exception ${exc.code} resolved`, {
        actorType: 'USER', actorName: user.name, detail: note, status: 'SUCCESS', correlationId: exc.correlationId,
      });
      break;
    case 'CLOSE':
      if (!['RESOLVED'].includes(exc.status) && !note?.trim()) throw Errors.validation('A closing note is required to close an unresolved exception');
      exc.status = 'CLOSED';
      record('CLOSED', note);
      break;
    default:
      throw Errors.badRequest(`Unsupported action ${action}`);
  }
  markDirty();
  res.json({ exception: exc });
}));
