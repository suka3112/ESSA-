/**
 * In-process asynchronous job/queue abstraction.
 *
 * Provides the same enqueue/handler semantics as a managed queue
 * (Azure Service Bus in the target architecture) so long-running work never
 * blocks HTTP requests. Replace the transport by re-implementing `enqueue`
 * against Service Bus without touching call-sites.
 */
import type { IntegrationJob } from './types';
import { ids, nowIso } from './ids';
import { getDb, markDirty } from './store';
import { techLog } from './logger';

type JobHandler = (job: IntegrationJob) => Promise<void> | void;

const handlers = new Map<IntegrationJob['type'], JobHandler>();

export function registerJobHandler(type: IntegrationJob['type'], handler: JobHandler) {
  handlers.set(type, handler);
}

export interface EnqueueOptions {
  refId?: string;
  invoiceId?: string;
  detail?: string;
  correlationId?: string;
  delayMs?: number;
  maxAttempts?: number;
}

export function enqueueJob(type: IntegrationJob['type'], opts: EnqueueOptions = {}): IntegrationJob {
  const db = getDb();
  const job: IntegrationJob = {
    id: ids.job(),
    type,
    refId: opts.refId,
    invoiceId: opts.invoiceId,
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 3,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    correlationId: opts.correlationId ?? ids.correlation(),
    detail: opts.detail ?? '',
  };
  db.integrationJobs.unshift(job);
  if (db.integrationJobs.length > 1000) db.integrationJobs.length = 1000;
  markDirty();
  techLog({
    module: 'jobs', event: 'JOB_ENQUEUED', message: `${type} job queued`,
    correlationId: job.correlationId, jobId: job.id, invoiceId: job.invoiceId,
  });
  setTimeout(() => void runJob(job.id), opts.delayMs ?? 400);
  return job;
}

async function runJob(jobId: string) {
  const db = getDb();
  const job = db.integrationJobs.find((j) => j.id === jobId);
  if (!job || job.status === 'COMPLETED') return;
  const handler = handlers.get(job.type);
  if (!handler) {
    job.status = 'FAILED';
    job.error = `No handler registered for ${job.type}`;
    job.updatedAt = nowIso();
    markDirty();
    return;
  }
  job.status = 'RUNNING';
  job.attempts += 1;
  job.updatedAt = nowIso();
  markDirty();
  const started = Date.now();
  try {
    await handler(job);
    job.status = 'COMPLETED';
    job.updatedAt = nowIso();
    markDirty();
    techLog({
      module: 'jobs', event: 'JOB_COMPLETED', message: `${job.type} completed`,
      correlationId: job.correlationId, jobId: job.id, invoiceId: job.invoiceId,
      durationMs: Date.now() - started, status: 'SUCCESS',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.error = message;
    job.updatedAt = nowIso();
    if (job.attempts >= job.maxAttempts) {
      job.status = 'DEAD_LETTER';
      techLog({
        module: 'jobs', event: 'JOB_DEAD_LETTER', level: 'ERROR',
        message: `${job.type} moved to dead letter after ${job.attempts} attempts: ${message}`,
        correlationId: job.correlationId, jobId: job.id, invoiceId: job.invoiceId,
        errorCode: 'JOB_MAX_RETRIES', retryCount: job.attempts,
      });
    } else {
      job.status = 'RETRYING';
      const backoff = 1500 * Math.pow(2, job.attempts - 1);
      job.nextRetryAt = new Date(Date.now() + backoff).toISOString();
      techLog({
        module: 'jobs', event: 'JOB_RETRY_SCHEDULED', level: 'WARN',
        message: `${job.type} failed (${message}) - retry ${job.attempts}/${job.maxAttempts}`,
        correlationId: job.correlationId, jobId: job.id, retryCount: job.attempts,
      });
      setTimeout(() => void runJob(job.id), backoff);
    }
    markDirty();
  }
}

export function retryJob(jobId: string): IntegrationJob | undefined {
  const db = getDb();
  const job = db.integrationJobs.find((j) => j.id === jobId);
  if (!job) return undefined;
  job.status = 'QUEUED';
  job.error = undefined;
  job.updatedAt = nowIso();
  markDirty();
  setTimeout(() => void runJob(job.id), 300);
  return job;
}
