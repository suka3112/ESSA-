import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { nowIso } from '../core/ids';
import { currentStatus } from '../core/status';

export const miscRouter = Router();

/** Fallback for role codes with no configured role record: AP_REVIEWER → "Ap Reviewer". */
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------- dashboard
miscRouter.get('/dashboard', authorize('DASHBOARD_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const now = nowIso();

  // Optional date-range scope (receivedAt, inclusive yyyy-mm-dd bounds).
  const dateFrom = typeof req.query.dateFrom === 'string' && req.query.dateFrom ? req.query.dateFrom : null;
  const dateTo = typeof req.query.dateTo === 'string' && req.query.dateTo ? req.query.dateTo : null;
  const invoices = db.invoices.filter(
    (i) => (!dateFrom || i.receivedAt.slice(0, 10) >= dateFrom) && (!dateTo || i.receivedAt.slice(0, 10) <= dateTo)
  );
  const invoiceIds = new Set(invoices.map((i) => i.id));

  const openStatuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'];
  const openExceptions = db.exceptions.filter((e) => openStatuses.includes(e.status) && invoiceIds.has(e.invoiceId));
  const activeSteps = db.workflowSteps.filter((s) => s.status === 'ACTIVE' && invoiceIds.has(s.invoiceId));

  const byLifecycle: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  invoices.forEach((i) => {
    byLifecycle[i.lifecycle] = (byLifecycle[i.lifecycle] ?? 0) + 1;
    byStage[i.stage] = (byStage[i.stage] ?? 0) + 1;
    const cat = db.categories.find((c) => c.id === i.categoryId)?.name ?? i.categoryId;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    bySource[i.source] = (bySource[i.source] ?? 0) + 1;
  });

  // 30-day received trend
  const trend: { date: string; received: number; completed: number }[] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    trend.push({
      date: day,
      received: invoices.filter((i) => i.receivedAt.slice(0, 10) === day).length,
      completed: invoices.filter((i) => (i.lifecycle === 'POSTED' || i.lifecycle === 'PAID') && i.updatedAt.slice(0, 10) === day).length,
    });
  }

  const confidences = invoices.map((i) => i.extractionConfidence).filter((c): c is number => c != null);
  // The SLA is recomputed from the state the invoice is actually in, so this
  // list and the "SLA Breached" tile can never disagree with the workbench.
  const slaBreaches = invoices.filter((i) => i.slaBreached);
  const openByInvoice = new Map<string, number>();
  openExceptions.forEach((e) => openByInvoice.set(e.invoiceId, (openByInvoice.get(e.invoiceId) ?? 0) + 1));
  const statusOf = (i: (typeof invoices)[0]) => currentStatus(i, openByInvoice.get(i.id) ?? 0);
  const byStatus: Record<string, number> = {};
  invoices.forEach((i) => { const st = statusOf(i); byStatus[st] = (byStatus[st] ?? 0) + 1; });
  // Everything the AP team still has to act on: exactly what the work queue lists.
  const apWorkQueue = invoices.filter((i) => ['Draft', 'Validation'].includes(statusOf(i)));

  // Vendor spend (total billed value per vendor)
  const vendorSpendMap = new Map<string, { name: string; amount: number; count: number }>();
  invoices.forEach((i) => {
    const v = vendorSpendMap.get(i.vendorCode) ?? { name: i.vendorName, amount: 0, count: 0 };
    v.amount += i.amount;
    v.count += 1;
    vendorSpendMap.set(i.vendorCode, v);
  });
  const vendorSpend = [...vendorSpendMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const latestRuns = new Map<string, string>();
  db.validationRuns.forEach((r) => {
    if (!invoiceIds.has(r.invoiceId)) return;
    if (!latestRuns.has(r.invoiceId)) latestRuns.set(r.invoiceId, r.id);
  });
  const latestResults = db.validationResults.filter((r) => latestRuns.get(r.invoiceId) === r.runId);
  const failedRules: Record<string, number> = {};
  latestResults.filter((r) => r.result === 'FAIL' || r.result === 'HARD_FAIL').forEach((r) => {
    failedRules[`${r.ruleCode} ${r.ruleName}`] = (failedRules[`${r.ruleCode} ${r.ruleName}`] ?? 0) + 1;
  });

  res.json({
    kpis: {
      total: invoices.length,
      draft: byLifecycle.DRAFT ?? 0,
      validated: byLifecycle.VALIDATED ?? 0,
      inProgress: byLifecycle.IN_PROGRESS ?? 0,
      parked: byLifecycle.PARKED ?? 0,
      posted: byLifecycle.POSTED ?? 0,
      paid: byLifecycle.PAID ?? 0,
      inValidation: (byStage.VALIDATION ?? 0) + (byStage.CLASSIFICATION ?? 0) + (byStage.COMPLETENESS ?? 0) + (byStage.EXTRACTION ?? 0) + (byStage.RECEIVED ?? 0),
      // Tile counts that the lists can be filtered down to, one for one.
      apWorkQueue: apWorkQueue.length,
      approvalPending: byStatus['Approval Pending'] ?? 0,
      readyToPark: byStatus.Approved ?? 0,
      exceptions: openExceptions.length,
      invoicesWithExceptions: new Set(openExceptions.map((e) => e.invoiceId)).size,
      pendingApproval: activeSteps.length,
      extractionReview: invoices.filter((i) => i.stage === 'EXTRACTION_REVIEW').length,
      missingDocuments: invoices.filter((i) => i.processingFlag === 'MISSING_DOCUMENTS').length,
      // Rejected invoices are waiting for the vendor to resubmit (UI/UX review §2).
      rejected: byStatus.Rejected ?? 0,
      slaBreaches: slaBreaches.length,
      sapErrors: invoices.filter((i) => i.processingFlag === 'SAP_ERROR' || i.processingFlag === 'TECHNICAL_RETRY').length,
      avgConfidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 10 : null,
      myApprovals: activeSteps.filter((s) => s.assignedTo === user.id).length,
      myExceptions: openExceptions.filter((e) => e.assignedTo === user.id).length,
    },
    byLifecycle,
    byStatus,
    byStage,
    byCategory,
    bySource,
    trend,
    vendorSpend,
    funnel: [
      { stage: 'Received', count: invoices.length },
      { stage: 'Extraction', count: invoices.filter((i) => !['RECEIVED', 'CLASSIFICATION', 'COMPLETENESS'].includes(i.stage)).length },
      { stage: 'Validation', count: invoices.filter((i) => !['RECEIVED', 'CLASSIFICATION', 'COMPLETENESS', 'EXTRACTION', 'EXTRACTION_REVIEW'].includes(i.stage)).length },
      { stage: 'Approval', count: invoices.filter((i) => ['APPROVAL', 'TAX_REVIEW', 'SAP_HANDOFF', 'SAP_PROCESSING', 'COMPLETED'].includes(i.stage)).length },
      { stage: 'SAP', count: invoices.filter((i) => ['IN_PROGRESS', 'PARKED', 'POSTED', 'PAID'].includes(i.lifecycle)).length },
      { stage: 'Posted', count: (byLifecycle.POSTED ?? 0) + (byLifecycle.PAID ?? 0) },
      { stage: 'Paid', count: byLifecycle.PAID ?? 0 },
    ],
    exceptionsByType: openExceptions.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {}),
    approvalBacklog: activeSteps.map((s) => {
      const inv = db.invoices.find((i) => i.id === s.invoiceId);
      // Who is this actually sitting with? Prefer the named approver (direct
      // assignment or DoA resolution); fall back to the step's role queue.
      const approver = s.assignedTo ? db.users.find((u) => u.id === s.assignedTo) : undefined;
      const roleName = db.roles.find((r) => r.code === s.role)?.name ?? titleCase(s.role);
      return {
        stepId: s.id, invoiceId: s.invoiceId, invoiceNumber: inv?.invoiceNumber, name: s.name,
        stepNo: s.stepNo,
        assignedToName: s.assignedToName ?? approver?.name,
        // Job title reads better than the raw role code ("Senior AP Analyst"),
        // but we always keep the workflow role so the queue case still makes sense.
        approverTitle: approver?.title,
        role: s.role, roleName,
        delegated: Boolean(s.delegatedTo),
        unassigned: !(s.assignedToName ?? approver?.name),
        amount: inv?.amount, currency: inv?.currency,
        // Same single SLA clock as the Approvals screen and the workbench.
        dueAt: inv?.slaDueAt || s.dueAt,
        // The approval list is invoice-centric (UI/UX review §9): vendor,
        // category and the invoice's own state, not workflow internals.
        vendorName: inv?.vendorName,
        categoryName: db.categories.find((c) => c.id === inv?.categoryId)?.name,
        lifecycle: inv?.lifecycle,
        stage: inv?.stage,
        processingFlag: inv?.processingFlag ?? null,
        poNumber: inv?.poNumber,
        overdue: inv ? Boolean(inv.slaBreached) : Boolean(s.dueAt && s.dueAt < now),
      };
    }).slice(0, 8),
    validationFailures: Object.entries(failedRules).map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    integrationHealth: db.integrationHealth,
    recentActivity: db.timelineEvents.filter((t) => invoiceIds.has(t.invoiceId)).slice(-14).reverse().map((t) => ({
      ...t,
      invoiceNumber: db.invoices.find((i) => i.id === t.invoiceId)?.invoiceNumber,
    })),
    slaBreaches: slaBreaches.slice(0, 8).map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, stage: i.stage, slaDueAt: i.slaDueAt,
    })),
  });
}));

// ------------------------------------------------------------ notifications
miscRouter.get('/notifications', authorize('NOTIFICATION_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  let items = db.notifications.filter((n) => n.userId === user.id);
  if (req.query.category) items = items.filter((n) => n.category === req.query.category);
  if (req.query.unread === 'true') items = items.filter((n) => !n.read);
  res.json({
    items: items.slice(0, 100).map((n) => ({
      ...n,
      invoiceNumber: n.invoiceId ? db.invoices.find((i) => i.id === n.invoiceId)?.invoiceNumber : undefined,
    })),
    unread: db.notifications.filter((n) => n.userId === user.id && !n.read).length,
  });
}));

miscRouter.post('/notifications/mark-read', authorize('NOTIFICATION_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const user = requireAuth(req);
  const { ids: notifIds, all } = req.body as { ids?: string[]; all?: boolean };
  db.notifications
    .filter((n) => n.userId === user.id && (all || notifIds?.includes(n.id)))
    .forEach((n) => { n.read = true; });
  markDirty();
  res.json({ unread: db.notifications.filter((n) => n.userId === user.id && !n.read).length });
}));

// ------------------------------------------------------------------ search
miscRouter.get('/search', authorize('INVOICE_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) {
    res.json({ invoices: [], vendors: [], exceptions: [], purchaseOrders: [], users: [] });
    return;
  }
  const match = (v?: string) => v?.toLowerCase().includes(q);
  res.json({
    invoices: db.invoices
      .filter((i) => match(i.invoiceNumber) || match(i.id) || match(i.vendorName) || match(i.poNumber) || match(i.sapDocumentNo) || match(i.description))
      .slice(0, 8)
      .map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, amount: i.amount, currency: i.currency, lifecycle: i.lifecycle })),
    vendors: db.vendors
      .filter((v) => match(v.code) || match(v.name) || match(v.gstin))
      .slice(0, 6)
      .map((v) => ({ code: v.code, name: v.name, city: v.city })),
    exceptions: db.exceptions
      .filter((e) => match(e.code) || match(e.title) || match(e.ruleCode))
      .slice(0, 6)
      .map((e) => ({ id: e.id, code: e.code, title: e.title, status: e.status, invoiceNumber: db.invoices.find((i) => i.id === e.invoiceId)?.invoiceNumber })),
    purchaseOrders: db.sapPurchaseOrders
      .filter((p) => match(p.poNumber) || match(p.vendorName))
      .slice(0, 6)
      .map((p) => ({ poNumber: p.poNumber, vendorName: p.vendorName, openAmount: p.openAmount })),
    users: db.users
      .filter((u) => match(u.name) || match(u.email))
      .slice(0, 5)
      .map((u) => ({ id: u.id, name: u.name, title: u.title })),
  });
}));

// ----------------------------------------------------------------- reports
miscRouter.get('/reports', authorize('REPORT_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const from = String(req.query.dateFrom ?? '2000-01-01');
  const to = String(req.query.dateTo ?? '2100-01-01');
  const categoryId = String(req.query.categoryId ?? '');
  const vendorCode = String(req.query.vendorCode ?? '');

  let invoices = db.invoices.filter((i) => i.receivedAt.slice(0, 10) >= from && i.receivedAt.slice(0, 10) <= to);
  if (categoryId) invoices = invoices.filter((i) => i.categoryId === categoryId);
  if (vendorCode) invoices = invoices.filter((i) => i.vendorCode === vendorCode);
  const invoiceIds = new Set(invoices.map((i) => i.id));

  const exceptions = db.exceptions.filter((e) => invoiceIds.has(e.invoiceId));
  const runs = db.validationRuns.filter((r) => invoiceIds.has(r.invoiceId));
  const doneSteps = db.workflowSteps.filter((s) => invoiceIds.has(s.invoiceId) && s.actedAt);

  const monthly: Record<string, { count: number; amount: number }> = {};
  invoices.forEach((i) => {
    const m = i.receivedAt.slice(0, 7);
    monthly[m] = { count: (monthly[m]?.count ?? 0) + 1, amount: (monthly[m]?.amount ?? 0) + i.amount };
  });

  const vendorPerf = new Map<string, { name: string; count: number; amount: number; exceptions: number }>();
  invoices.forEach((i) => {
    const v = vendorPerf.get(i.vendorCode) ?? { name: i.vendorName, count: 0, amount: 0, exceptions: 0 };
    v.count += 1;
    v.amount += i.amount;
    vendorPerf.set(i.vendorCode, v);
  });
  exceptions.forEach((e) => {
    const inv = invoices.find((i) => i.id === e.invoiceId);
    if (inv) {
      const v = vendorPerf.get(inv.vendorCode);
      if (v) v.exceptions += 1;
    }
  });

  const confidences = invoices.map((i) => i.extractionConfidence).filter((c): c is number => c != null);
  res.json({
    totals: {
      invoices: invoices.length,
      amount: invoices.reduce((s, i) => s + i.amount, 0),
      exceptions: exceptions.length,
      exceptionRate: invoices.length ? Math.round((exceptions.length / invoices.length) * 100) : 0,
      validationRuns: runs.length,
      validationPassRate: runs.length ? Math.round((runs.filter((r) => r.outcome === 'PASS').length / runs.length) * 100) : 0,
      avgConfidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 10 : null,
      posted: invoices.filter((i) => ['POSTED', 'PAID'].includes(i.lifecycle)).length,
      paid: invoices.filter((i) => i.lifecycle === 'PAID').length,
      approvalsCompleted: doneSteps.length,
      approvalsOnTime: doneSteps.filter((s) => !s.dueAt || (s.actedAt ?? '') <= s.dueAt).length,
    },
    monthly: Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    byLifecycle: invoices.reduce<Record<string, number>>((acc, i) => { acc[i.lifecycle] = (acc[i.lifecycle] ?? 0) + 1; return acc; }, {}),
    byCategory: invoices.reduce<Record<string, { count: number; amount: number }>>((acc, i) => {
      const name = db.categories.find((c) => c.id === i.categoryId)?.name ?? i.categoryId;
      acc[name] = { count: (acc[name]?.count ?? 0) + 1, amount: (acc[name]?.amount ?? 0) + i.amount };
      return acc;
    }, {}),
    exceptionsByType: exceptions.reduce<Record<string, number>>((acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; }, {}),
    vendorPerformance: [...vendorPerf.entries()]
      .map(([code, v]) => ({ code, ...v, exceptionRate: v.count ? Math.round((v.exceptions / v.count) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15),
  });
}));

// ---------------------------------------------------------------- lookups
miscRouter.get('/lookups', asyncHandler((_req, res) => {
  const db = getDb();
  res.json({
    categories: db.categories,
    documentTypes: db.documentTypes,
    users: db.users.map((u) => ({ id: u.id, name: u.name, title: u.title, enabled: u.enabled })),
    vendors: db.vendors.map((v) => ({ code: v.code, name: v.name })),
    activeConfigVersion: db.configVersions.find((c) => c.status === 'ACTIVE'),
    slaRules: db.slaRules,
    reminderRules: db.reminderRules,
    exceptionCodes: db.exceptionCodes,
  });
}));
