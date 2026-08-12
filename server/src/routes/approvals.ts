import { Router } from 'express';
import { getDb } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { Errors } from '../core/errors';
import { actOnStep } from '../modules/pipeline/pipeline';
import { nowIso } from '../core/ids';

export const approvalRouter = Router();

approvalRouter.get('/approvals', authorize('APPROVAL_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const scope = String(req.query.scope ?? 'mine');
  const user = requireAuth(req);
  let steps = db.workflowSteps.filter((s) => s.status === 'ACTIVE');
  if (scope === 'mine') {
    const myRoles = req.ctx.roles.map((r) => r.code);
    steps = steps.filter((s) => s.assignedTo === user.id || (!s.assignedTo && myRoles.includes(s.role)));
  }
  const history = db.workflowSteps
    .filter((s) => ['APPROVED', 'REJECTED', 'SENT_BACK'].includes(s.status) && (scope !== 'mine' || s.actedBy === user.id))
    .sort((a, b) => (b.actedAt ?? '').localeCompare(a.actedAt ?? ''))
    .slice(0, 50);

  const decorate = (s: (typeof steps)[0]) => {
    const inv = db.invoices.find((i) => i.id === s.invoiceId);
    return {
      ...s,
      invoiceNumber: inv?.invoiceNumber,
      vendorName: inv?.vendorName,
      amount: inv?.amount,
      currency: inv?.currency,
      department: inv?.department,
      categoryName: db.categories.find((c) => c.id === inv?.categoryId)?.name,
      priority: inv?.priority,
      overdue: Boolean(s.dueAt && s.dueAt < nowIso()),
    };
  };
  res.json({ queue: steps.map(decorate), history: history.map(decorate) });
}));

approvalRouter.post('/approvals/:stepId/action', authorize('APPROVAL_ACT'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const step = db.workflowSteps.find((s) => s.id === req.params.stepId);
  if (!step) throw Errors.notFound('Approval step', req.params.stepId);
  if (step.status !== 'ACTIVE') throw Errors.conflict('This step is no longer awaiting action');

  // Two checks (architecture §16.1): permission AND current assignment/eligibility
  const myRoles = req.ctx.roles.map((r) => r.code);
  const eligible = step.assignedTo === user.id || (!step.assignedTo && myRoles.includes(step.role)) || myRoles.includes('ADMINISTRATOR');
  if (!eligible) throw Errors.forbidden('act on this approval - you are not the current assignee');

  const { action, comment, delegateTo } = req.body as { action?: string; comment?: string; delegateTo?: string };
  if (!['APPROVE', 'REJECT', 'SEND_BACK', 'DELEGATE'].includes(action ?? '')) throw Errors.badRequest('Unsupported action');
  if ((action === 'REJECT' || action === 'SEND_BACK') && !comment?.trim()) {
    throw Errors.validation(`A reason is required to ${action === 'REJECT' ? 'reject' : 'send back'}`);
  }
  if (action === 'DELEGATE' && !delegateTo) throw Errors.validation('Select a delegate');

  const invoice = db.invoices.find((i) => i.id === step.invoiceId)!;
  actOnStep(invoice, step, user, action as 'APPROVE' | 'REJECT' | 'SEND_BACK' | 'DELEGATE', comment, delegateTo);
  res.json({ ok: true, step });
}));

approvalRouter.get('/approval-matrix', authorize('APPROVAL_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({ doa: db.doaMatrix, workflows: db.workflowDefinitions });
}));
