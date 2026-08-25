import { Router } from 'express';
import { currentStatus } from '../core/status';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, pageParams, paginate, requireAuth, sortItems } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { ids, nowIso } from '../core/ids';

export const vendorRouter = Router();

/**
 * Vendor master list. Paged, sorted and filtered on the server so the page
 * behaves like the Invoice Workbench (review, 25 Aug): the table never holds
 * the whole master in memory, and every filter counts against the full list
 * rather than the page on screen.
 *
 * The values the table shows are flattened onto each row - location, tax
 * status and AP control state - so a column header can sort on exactly what
 * the reader sees.
 */
vendorRouter.get('/vendors', authorize('VENDOR_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  let items = db.vendors.map((v) => {
    const control = db.vendorControls.find((c) => c.vendorCode === v.code);
    const invoices = db.invoices.filter((i) => i.vendorCode === v.code);
    return {
      ...v,
      control,
      invoiceCount: invoices.length,
      openInvoiceCount: invoices.filter((i) => !['POSTED', 'PAID'].includes(i.lifecycle)).length,
      // IDR equivalent, so a USD vendor sorts and totals with the rest.
      totalBilled: invoices.reduce((s, i) => s + (i.amountIdr ?? i.amount), 0),
      location: [v.city, v.state].filter(Boolean).join(', '),
      // PKP / Non-PKP is derived until SAP supplies the flag: an Indonesian
      // vendor with an NPWP is PKP. A foreign vendor's own registration (e.g.
      // Emerson's Singapore GST number) does not make it PKP.
      taxStatus: v.gstin && v.country === 'Indonesia' ? 'PKP' : 'Non-PKP',
      controlState: control?.negativeFlag ? 'Negative' : control && !control.apEnabled ? 'Disabled' : 'Enabled',
    };
  });
  const text = String(req.query.search ?? '').trim().toLowerCase();
  if (text) items = items.filter((v) => [v.code, v.name, v.city, v.gstin, v.classification].some((x) => x?.toLowerCase().includes(text)));
  if (req.query.classification) items = items.filter((v) => v.classification === req.query.classification);
  if (req.query.taxStatus) items = items.filter((v) => v.taxStatus === req.query.taxStatus);
  if (req.query.controlState) items = items.filter((v) => v.controlState === req.query.controlState);
  if (req.query.sapStatus) items = items.filter((v) => v.sapStatus === req.query.sapStatus);
  // Kept so an existing link with the old flags still opens the right list.
  if (req.query.negative === 'true') items = items.filter((v) => v.control?.negativeFlag);
  if (req.query.disabled === 'true') items = items.filter((v) => v.control && !v.control.apEnabled);

  // Facets are the values actually present in the master, not the vocabulary
  // the code knows about, so the page can hide a filter that would only ever
  // offer one answer.
  const all = db.vendors.map((v) => {
    const control = db.vendorControls.find((c) => c.vendorCode === v.code);
    return {
      sapStatus: v.sapStatus,
      taxStatus: v.gstin ? 'PKP' : 'Non-PKP',
      controlState: control?.negativeFlag ? 'Negative' : control && !control.apEnabled ? 'Disabled' : 'Enabled',
    };
  });
  const uniq = (values: (string | undefined)[]) => [...new Set(values)].filter(Boolean).sort() as string[];
  const facets = {
    sapStatuses: uniq(all.map((v) => v.sapStatus)),
    controlStates: ['Enabled', 'Negative', 'Disabled'].filter((c) => all.some((v) => v.controlState === c)),
    taxStatuses: ['PKP', 'Non-PKP'].filter((t) => all.some((v) => v.taxStatus === t)),
  };

  // No default sort: unsorted is the SAP master's own order (by vendor code),
  // which is what a cleared column header returns to.
  const p = pageParams(req);
  items = sortItems(items, p.sortBy, p.sortDir);
  res.json({ ...paginate(items, p), facets });
}));

vendorRouter.get('/vendors/:code', authorize('VENDOR_VIEW'), asyncHandler((req, res) => {
  const db = getDb();
  const vendor = db.vendors.find((v) => v.code === req.params.code);
  if (!vendor) throw Errors.notFound('Vendor', req.params.code);
  const invoices = db.invoices.filter((i) => i.vendorCode === vendor.code);
  res.json({
    vendor,
    control: db.vendorControls.find((c) => c.vendorCode === vendor.code),
    history: db.vendorControlHistory.filter((h) => h.vendorCode === vendor.code).sort((a, b) => b.at.localeCompare(a.at)),
    purchaseOrders: db.sapPurchaseOrders.filter((p) => p.vendorCode === vendor.code).slice(0, 20),
    invoices: invoices
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 25)
      .map((i) => ({
        id: i.id, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, amount: i.amount,
        currency: i.currency, lifecycle: i.lifecycle, stage: i.stage,
        // The same status the Invoice Workbench shows, so a vendor page never disagrees with it.
        status: currentStatus(i, db.exceptions.filter((e) => e.invoiceId === i.id && ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status)).length),
        categoryName: db.categories.find((c) => c.id === i.categoryId)?.name,
      })),
  });
}));

/** Portal-owned control overlay only - the portal never modifies SAP master data. */
vendorRouter.post('/vendors/:code/control', authorize('VENDOR_CONTROL'), asyncHandler((req, res) => {
  const user = requireAuth(req);
  const db = getDb();
  const vendor = db.vendors.find((v) => v.code === req.params.code);
  if (!vendor) throw Errors.notFound('Vendor', req.params.code);
  const { negativeFlag, apEnabled, reason, remarks } = req.body as {
    negativeFlag?: boolean; apEnabled?: boolean; reason?: string; remarks?: string;
  };
  let control = db.vendorControls.find((c) => c.vendorCode === vendor.code);
  if (!control) {
    control = { vendorCode: vendor.code, negativeFlag: false, apEnabled: true, updatedBy: user.id, updatedByName: user.name, updatedAt: nowIso() };
    db.vendorControls.push(control);
  }
  const changes: { action: 'NEGATIVE_MARKED' | 'NEGATIVE_REMOVED' | 'ENABLED' | 'DISABLED'; old: boolean; next: boolean }[] = [];
  if (typeof negativeFlag === 'boolean' && negativeFlag !== control.negativeFlag) {
    if (negativeFlag && !reason?.trim()) throw Errors.validation('A reason is mandatory when marking a vendor negative');
    changes.push({ action: negativeFlag ? 'NEGATIVE_MARKED' : 'NEGATIVE_REMOVED', old: control.negativeFlag, next: negativeFlag });
    control.negativeFlag = negativeFlag;
  }
  if (typeof apEnabled === 'boolean' && apEnabled !== control.apEnabled) {
    if (!apEnabled && !reason?.trim()) throw Errors.validation('A reason is mandatory when disabling a vendor for AP automation');
    changes.push({ action: apEnabled ? 'ENABLED' : 'DISABLED', old: control.apEnabled, next: apEnabled });
    control.apEnabled = apEnabled;
  }
  if (!changes.length) throw Errors.badRequest('No control changes supplied');
  control.reason = reason ?? control.reason;
  control.remarks = remarks ?? control.remarks;
  control.updatedBy = user.id;
  control.updatedByName = user.name;
  control.updatedAt = nowIso();

  for (const ch of changes) {
    db.vendorControlHistory.unshift({
      id: ids.generic('VCH'), vendorCode: vendor.code, action: ch.action,
      reason: reason ?? '', by: user.id, byName: user.name, at: nowIso(),
    });
    audit({
      actorType: 'USER', actorId: user.id, actorName: user.name,
      eventType: `VENDOR_${ch.action}`, category: 'VENDOR', action: ch.action, module: 'vendor',
      entityType: 'VENDOR', entityId: vendor.code, entityRef: vendor.name,
      result: 'SUCCESS', reason,
      oldValue: { value: ch.old }, newValue: { value: ch.next },
      correlationId: req.ctx.correlationId, source: 'PORTAL',
    });
  }
  markDirty();
  res.json({ control });
}));
