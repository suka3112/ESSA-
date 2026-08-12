import type { TechnicalLog } from './types';
import { ids, nowIso } from './ids';
import { getDb, markDirty } from './store';

const ENV = process.env.APP_ENV ?? 'DEV/UAT';
const MAX_LOGS = 3000;

export interface LogContext {
  module: string;
  event: string;
  message: string;
  level?: TechnicalLog['level'];
  correlationId?: string;
  transactionId?: string;
  requestId?: string;
  jobId?: string;
  invoiceId?: string;
  integration?: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
  retryCount?: number;
}

/**
 * Structured technical logger (separate from the business audit store).
 * Emits JSON to stdout and retains a rolling window queryable by support users.
 */
export function techLog(ctx: LogContext): TechnicalLog {
  const entry: TechnicalLog = {
    id: ids.generic('LOG'),
    timestamp: nowIso(),
    level: ctx.level ?? 'INFO',
    service: 'ap-backend',
    module: ctx.module,
    event: ctx.event,
    message: ctx.message,
    correlationId: ctx.correlationId,
    transactionId: ctx.transactionId,
    requestId: ctx.requestId,
    jobId: ctx.jobId,
    invoiceId: ctx.invoiceId,
    integration: ctx.integration,
    status: ctx.status,
    durationMs: ctx.durationMs,
    errorCode: ctx.errorCode,
    retryCount: ctx.retryCount,
    environment: ENV,
  };
  try {
    const db = getDb();
    db.technicalLogs.unshift(entry);
    if (db.technicalLogs.length > MAX_LOGS) db.technicalLogs.length = MAX_LOGS;
    markDirty();
  } catch {
    /* store not ready during boot - stdout only */
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: entry.timestamp, level: entry.level, module: entry.module, event: entry.event, msg: entry.message, cor: entry.correlationId }));
  return entry;
}
