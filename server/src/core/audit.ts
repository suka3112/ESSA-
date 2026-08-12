import type { AuditEvent } from './types';
import { ids, nowIso } from './ids';
import { getDb, markDirty } from './store';

export type AuditInput = Omit<AuditEvent, 'id' | 'eventTime'> & { eventTime?: string };

/**
 * Central append-only business/security audit service.
 * Records are immutable from the application perspective - there is no
 * update or delete path anywhere in the codebase.
 */
export function audit(input: AuditInput): AuditEvent {
  const event: AuditEvent = {
    id: ids.audit(),
    eventTime: input.eventTime ?? nowIso(),
    ...input,
  };
  const db = getDb();
  db.auditEvents.unshift(event);
  markDirty();
  return event;
}

export function systemAudit(
  partial: Partial<AuditInput> & Pick<AuditInput, 'eventType' | 'category' | 'action' | 'entityType' | 'entityId'>
): AuditEvent {
  return audit({
    actorType: 'SYSTEM',
    actorId: 'system',
    actorName: 'AP Automation Engine',
    module: partial.module ?? 'pipeline',
    result: 'SUCCESS',
    correlationId: partial.correlationId ?? ids.correlation(),
    source: partial.source ?? 'BACKEND',
    ...partial,
  });
}
