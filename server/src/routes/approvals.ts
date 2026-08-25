import { Router } from 'express';
import { getDb } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { Errors } from '../core/errors';
import { actOnStep } from '../modules/pipeline/pipeline';
import { nowIso } from '../core/ids';

export const approvalRouter = Router();

/**
 * Workflow definitions that are not surfaced in the UI for any persona.
 * They stay in the store so existing routing/fallback behaviour is unaffected;
 * they are simply not returned to the approval-matrix and workflow config views.
 */
const HIDDEN_WORKFLOW_CODES = ['WF-PO-STD'];

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
      categoryName: db.categories.find((c) => c.id === inv?.categoryId)?.name,
      // The approval list shows the invoice's own status in the shared status
      // vocabulary (UI/UX review §9/§14), so these travel with the row.
      lifecycle: inv?.lifecycle,
      stage: inv?.stage,
      processingFlag: inv?.processingFlag ?? null,
      poNumber: inv?.poNumber,
      // One SLA clock per invoice (ESSA EAPA SLA Matrix): the approval queue
      // shows the invoice's own SLA due date rather than a second, separate
      // workflow-step timer that could disagree with it.
      dueAt: inv?.slaDueAt || s.dueAt,
      overdue: inv ? Boolean(inv.slaBreached) : Boolean(s.dueAt && s.dueAt < nowIso()),
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

// The approval hierarchy is configuration, maintained from Administration →
// Workflows & Approval Hierarchy, so it is gated on CONFIG_VIEW rather than on
// the permission to act on an approval (review, 24 Aug: roles stay separate).
approvalRouter.get('/approval-matrix', authorize('CONFIG_VIEW'), asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    doa: db.doaMatrix,
    workflows: db.workflowDefinitions.filter((w) => !HIDDEN_WORKFLOW_CODES.includes(w.code)),
  });
}));
