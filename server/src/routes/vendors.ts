import { Router } from 'express';
import { getDb, markDirty } from '../core/store';
import { asyncHandler, authorize, requireAuth } from '../core/http';
import { Errors } from '../core/errors';
import { audit } from '../core/audit';
import { ids, nowIso } from '../core/ids';

export const vendorRouter = Router();

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
      totalBilled: invoices.reduce((s, i) => s + i.amount, 0),
    };
  });
  const text = String(req.query.search ?? '').trim().toLowerCase();
  if (text) items = items.filter((v) => [v.code, v.name, v.city, v.gstin, v.classification].some((x) => x?.toLowerCase().includes(text)));
  if (req.query.classification) items = items.filter((v) => v.classification === req.query.classification);
  if (req.query.negative === 'true') items = items.filter((v) => v.control?.negativeFlag);
  if (req.query.disabled === 'true') items = items.filter((v) => v.control && !v.control.apEnabled);
  res.json({ items, total: items.length });
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
      entityType: 'Vendor', entityId: vendor.code, entityRef: vendor.name,
      result: 'SUCCESS', reason,
      oldValue: { value: ch.old }, newValue: { value: ch.next },
      correlationId: req.ctx.correlationId, source: 'PORTAL',
    });
  }
  markDirty();
  res.json({ control });
}));
