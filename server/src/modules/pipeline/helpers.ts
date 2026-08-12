import type { Invoice, NotificationCategory, TimelineEvent } from '../../core/types';
import { getDb, markDirty } from '../../core/store';
import { ids, nowIso } from '../../core/ids';

export function addTimeline(
  invoiceId: string,
  event: string,
  title: string,
  opts: Partial<Pick<TimelineEvent, 'actorType' | 'actorName' | 'detail' | 'status' | 'reference' | 'correlationId' | 'at'>> = {}
): TimelineEvent {
  const db = getDb();
  const entry: TimelineEvent = {
    id: ids.generic('TML'),
    invoiceId,
    at: opts.at ?? nowIso(),
    actorType: opts.actorType ?? 'SYSTEM',
    actorName: opts.actorName ?? 'AP Automation Engine',
    event,
    title,
    detail: opts.detail,
    status: opts.status ?? 'INFO',
    reference: opts.reference,
    correlationId: opts.correlationId,
  };
  db.timelineEvents.push(entry);
  markDirty();
  return entry;
}

export function notifyUser(
  userId: string,
  category: NotificationCategory,
  title: string,
  body: string,
  opts: { invoiceId?: string; entityRef?: string; channel?: 'IN_APP' | 'EMAIL' | 'TEAMS'; createdAt?: string } = {}
) {
  const db = getDb();
  db.notifications.unshift({
    id: ids.generic('NTF'),
    userId,
    category,
    title,
    body,
    invoiceId: opts.invoiceId,
    entityRef: opts.entityRef,
    read: false,
    createdAt: opts.createdAt ?? nowIso(),
    channel: opts.channel ?? 'IN_APP',
  });
  markDirty();
}

export function notifyRole(roleCode: string, category: NotificationCategory, title: string, body: string, opts: { invoiceId?: string; createdAt?: string } = {}) {
  const db = getDb();
  const role = db.roles.find((r) => r.code === roleCode);
  if (!role) return;
  db.users
    .filter((u) => u.enabled && u.roleIds.includes(role.id))
    .forEach((u) => notifyUser(u.id, category, title, body, opts));
}

export function touchInvoice(inv: Invoice) {
  inv.updatedAt = nowIso();
  markDirty();
}

export function getInvoiceOr404(invoiceId: string): Invoice {
  const db = getDb();
  const inv = db.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw Object.assign(new Error(`Invoice ${invoiceId} not found`), { status: 404 });
  return inv;
}
