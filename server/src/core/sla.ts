/**
 * SLA engine — configuration-to-runtime mapping (SLA Administration UI
 * Specification §15).
 *
 *  · Configuration: `db.slaPolicies` (versioned policy header + timer +
 *    reminder / escalation / pause rules) and `db.businessCalendars`.
 *  · Runtime: SLA instances are DERIVED from the invoices, approval steps and
 *    document requests the platform already tracks, using the ACTIVE policy
 *    version. That keeps the rule agreed in the 24 Aug review — an invoice has
 *    exactly ONE SLA clock, for the stage it is actually in — and means the
 *    Runtime Monitor, the workbench, the approvals list and the dashboard can
 *    never disagree about a due time.
 *
 * Nothing here hardcodes weekends or holidays: business-day / business-hour
 * policies read the Business Calendar (spec Screen 3 design note).
 */
import type { Database } from './store';
import type {
  BusinessCalendar, Invoice, SlaDuration, SlaEvent, SlaInstance, SlaInstanceStatus, SlaPolicy, SlaStage,
} from './types';
import { currentStatus } from './status';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

// ------------------------------------------------------------ vocabularies
export const SLA_STAGE_LABEL: Record<SlaStage, string> = {
  INVOICE_CREATION: 'AP Verification',
  TAX_REVIEW: 'Tax Review',
  AP_APPROVAL: 'Approval',
  PAYMENT: 'Payment',
  DOCUMENT_REQUEST: 'Document Request',
};

/** Long-form stage wording used where there is room (invoice detail, tooltips). */
export const SLA_STAGE_DESCRIPTION: Record<SlaStage, string> = {
  INVOICE_CREATION: 'Invoice creation / detailed verification by the AP team',
  TAX_REVIEW: 'Tax Team review',
  AP_APPROVAL: 'Approval hierarchy',
  PAYMENT: 'Payment processing after parking',
  DOCUMENT_REQUEST: 'Vendor response to a missing-document request',
};

/**
 * Invoice / activity types of the ESSA EAPA SLA Matrix (BPD page 13). The V2
 * category model splits "Services" into Service / Manpower / Catering for
 * validation purposes, so an activity can map onto several categories.
 */
export const ACTIVITIES: { code: string; label: string; categoryCodes: string[] }[] = [
  { code: 'MATERIAL', label: 'Material', categoryCodes: ['MATERIAL'] },
  { code: 'SERVICE', label: 'Services', categoryCodes: ['SERVICE', 'MANPOWER', 'CATERING'] },
  { code: 'NON_PO', label: 'Non-PO', categoryCodes: ['NON_PO'] },
  { code: 'PIB_PAYMENT', label: 'PIB Payments', categoryCodes: [] },
  { code: 'MONTHLY_TAX_PAYMENT', label: 'Monthly Tax Payment', categoryCodes: [] },
  { code: 'EMPLOYEE_REIMBURSEMENT', label: 'Employee Reimbursements', categoryCodes: [] },
];

export const SLA_RECIPIENT_LABEL: Record<string, string> = {
  CURRENT_APPROVER: 'Current Approver',
  APPROVER_AND_AP_MANAGER: 'Approver, AP Supervisor',
  NEXT_DOA_LEVEL: 'Next Approval Level',
  AP_TEAM: 'AP Team',
  AP_MANAGER: 'AP Supervisor',
  TAX_TEAM: 'Tax Team',
  HOF: 'Head of Function',
  VENDOR: 'Vendor',
  NONE: 'No escalation',
};

export function recipientLabel(code: string | undefined): string {
  if (!code) return '—';
  return SLA_RECIPIENT_LABEL[code] ?? code.replace(/_/g, ' ');
}

export function durationLabel(d: SlaDuration | null | undefined): string {
  if (!d) return '—';
  const unit: Record<SlaDuration['unit'], [string, string]> = {
    HOURS: ['Hour', 'Hours'],
    CALENDAR_DAYS: ['Calendar Day', 'Calendar Days'],
    BUSINESS_HOURS: ['Business Hour', 'Business Hours'],
    BUSINESS_DAYS: ['Business Day', 'Business Days'],
  };
  const [one, many] = unit[d.unit];
  return `${d.value} ${d.value === 1 ? one : many}`;
}

export function durationMs(d: SlaDuration): number {
  switch (d.unit) {
    case 'HOURS':
    case 'BUSINESS_HOURS':
      return d.value * HOUR_MS;
    default:
      return d.value * DAY_MS;
  }
}

// -------------------------------------------------------- calendar maths
interface LocalParts { ymd: string; weekday: number; minutes: number }

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    }
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(ms: number, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY[get('weekday')] ?? 1,
    minutes: hour * 60 + Number(get('minute')),
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is this instant on a working day of the calendar? */
export function isWorkingDay(cal: BusinessCalendar, ms: number): boolean {
  const p = localParts(ms, cal.timezone);
  const exception = cal.exceptions.find((e) => e.date === p.ymd);
  if (exception) return exception.working;
  return cal.workingDays.includes(p.weekday);
}

function isWorkingMinute(cal: BusinessCalendar, ms: number): boolean {
  if (!isWorkingDay(cal, ms)) return false;
  const p = localParts(ms, cal.timezone);
  return p.minutes >= toMinutes(cal.workStart) && p.minutes < toMinutes(cal.workEnd);
}

/** Move `days` working days forwards (or backwards when negative), keeping the time of day. */
function shiftBusinessDays(cal: BusinessCalendar, startMs: number, days: number): number {
  const step = days < 0 ? -DAY_MS : DAY_MS;
  let remaining = Math.abs(days);
  let t = startMs;
  let guard = 0;
  while (remaining > 0 && guard++ < 5000) {
    t += step;
    if (isWorkingDay(cal, t)) remaining -= 1;
  }
  return t;
}

/** Move `minutes` working minutes forwards / backwards, counting only time inside working hours. */
function shiftBusinessMinutes(cal: BusinessCalendar, startMs: number, minutes: number): number {
  const stepMin = 15;
  const step = (minutes < 0 ? -1 : 1) * stepMin * MIN_MS;
  let remaining = Math.abs(minutes);
  let t = startMs;
  let guard = 0;
  while (remaining > 0 && guard++ < 200_000) {
    // Probe the minute we are about to consume so a step that lands on the
    // working-hours boundary is still counted correctly.
    const probe = minutes < 0 ? t - MIN_MS : t;
    t += step;
    if (isWorkingMinute(cal, probe)) remaining -= stepMin;
  }
  return t;
}

export function calendarFor(db: Database, calendarId?: string): BusinessCalendar | undefined {
  if (calendarId) {
    const exact = db.businessCalendars.find((c) => c.id === calendarId);
    if (exact) return exact;
  }
  return db.businessCalendars.find((c) => c.status === 'ACTIVE');
}

/** Shift an instant by a duration, honouring the calendar for business units. */
export function shiftByDuration(db: Database, d: SlaDuration, fromMs: number, calendarId?: string, sign: 1 | -1 = 1): number {
  const value = d.value * sign;
  switch (d.unit) {
    case 'HOURS':
      return fromMs + value * HOUR_MS;
    case 'CALENDAR_DAYS':
      return fromMs + value * DAY_MS;
    case 'BUSINESS_DAYS': {
      const cal = calendarFor(db, calendarId);
      return cal ? shiftBusinessDays(cal, fromMs, value) : fromMs + value * DAY_MS;
    }
    case 'BUSINESS_HOURS': {
      const cal = calendarFor(db, calendarId);
      return cal ? shiftBusinessMinutes(cal, fromMs, value * 60) : fromMs + value * HOUR_MS;
    }
    default:
      return fromMs;
  }
}

// ------------------------------------------------------- policy resolution
const today = () => new Date().toISOString().slice(0, 10);

export function activityForCategory(db: Database, categoryId: string | undefined): string | undefined {
  if (!categoryId) return undefined;
  const code = db.categories.find((c) => c.id === categoryId)?.code;
  if (!code) return undefined;
  return ACTIVITIES.find((a) => a.categoryCodes.includes(code))?.code;
}

export function categoryIdsForActivity(db: Database, activity: string | undefined): string[] {
  if (!activity) return [];
  const codes = ACTIVITIES.find((a) => a.code === activity)?.categoryCodes ?? [];
  return db.categories.filter((c) => codes.includes(c.code)).map((c) => c.id);
}

/** The version of a policy code that is in force now, or null. */
export function activeVersion(db: Database, code: string): SlaPolicy | null {
  const t = today();
  const live = db.slaPolicies
    .filter((p) => p.code === code && p.status === 'ACTIVE' && p.effectiveFrom <= t)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version);
  return live[0] ?? null;
}

/** Latest version of a code that is not retired — what the list and resolution fall back to. */
export function latestVersion(db: Database, code: string): SlaPolicy | null {
  const rows = db.slaPolicies.filter((p) => p.code === code).sort((a, b) => b.version - a.version);
  return rows.find((p) => p.status !== 'RETIRED') ?? rows[0] ?? null;
}

export interface ResolvedPolicy {
  policy: SlaPolicy;
  /** False when only a Draft / Test / future-dated version exists (runtime is PENDING). */
  active: boolean;
}

/**
 * Find the policy for a scope + stage + activity. Activity-specific policies
 * win over generic ones (activity not set) and GLOBAL policies are the last
 * fallback for invoice-category scopes.
 */
export function resolvePolicy(
  db: Database,
  q: { scopeType: SlaPolicy['scopeType']; stage: SlaStage; activity?: string }
): ResolvedPolicy | null {
  const codes = (pred: (p: SlaPolicy) => boolean) => [...new Set(db.slaPolicies.filter(pred).map((p) => p.code))];
  const tiers: string[][] = [
    codes((p) => p.scopeType === q.scopeType && p.stage === q.stage && Boolean(q.activity) && p.activity === q.activity),
    codes((p) => p.scopeType === q.scopeType && p.stage === q.stage && !p.activity),
  ];
  if (q.scopeType === 'INVOICE_CATEGORY') tiers.push(codes((p) => p.scopeType === 'GLOBAL' && p.stage === q.stage));

  for (const tier of tiers) {
    for (const code of tier) {
      const live = activeVersion(db, code);
      if (live) return { policy: live, active: true };
    }
  }
  for (const tier of tiers) {
    for (const code of tier) {
      const latest = latestVersion(db, code);
      if (latest && latest.status !== 'RETIRED') return { policy: latest, active: false };
    }
  }
  return null;
}

// ---------------------------------------------------------- timer maths
export interface TimerResult {
  dueAt: string | null;
  warningAt: string | null;
}

export function computeTimer(db: Database, policy: SlaPolicy, startIso: string): TimerResult {
  const t = policy.timer;
  if (t.duration == null) return { dueAt: null, warningAt: null };
  const start = new Date(startIso).getTime();
  const due = shiftByDuration(db, { value: t.duration, unit: t.unit }, start, t.calendarId);
  let warning: number | null = null;
  if (t.warningBefore && t.warningBefore.value > 0) {
    warning = shiftByDuration(db, t.warningBefore, due, t.calendarId, -1);
    if (warning <= start) warning = start;
  }
  return { dueAt: new Date(due).toISOString(), warningAt: warning == null ? null : new Date(warning).toISOString() };
}

/** When each configured reminder would fire, relative to the SLA start. */
export function reminderSchedule(db: Database, policy: SlaPolicy, startIso: string, untilIso?: string): { seq: number; at: string; label: string; recipient: string; channels: string[]; template: string; repeatIndex?: number }[] {
  const start = new Date(startIso).getTime();
  const horizon = untilIso ? new Date(untilIso).getTime() : start + 90 * DAY_MS;
  const out: ReturnType<typeof reminderSchedule> = [];
  for (const r of policy.reminders.filter((x) => x.enabled).sort((a, b) => a.seq - b.seq)) {
    const first = shiftByDuration(db, r.after, start, policy.timer.calendarId);
    out.push({ seq: r.seq, at: new Date(first).toISOString(), label: `Reminder ${r.seq}`, recipient: r.recipient, channels: r.channels, template: r.template });
    if (r.repeat && r.after.value > 0) {
      let t = first;
      let n = 2;
      while (n <= 12) {
        t = shiftByDuration(db, r.after, t, policy.timer.calendarId);
        if (t > horizon) break;
        out.push({ seq: r.seq, at: new Date(t).toISOString(), label: `Reminder ${r.seq} (repeat ${n})`, recipient: r.recipient, channels: r.channels, template: r.template, repeatIndex: n });
        n += 1;
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** When escalation would fire, given the timer and reminders. */
export function escalationAt(db: Database, policy: SlaPolicy, startIso: string, dueAt: string | null): string | null {
  const e = policy.escalation;
  if (!e.enabled) return null;
  const reminders = reminderSchedule(db, policy, startIso, dueAt ?? undefined).filter((r) => !r.repeatIndex);
  switch (e.breachCondition) {
    case 'AFTER_FINAL_REMINDER':
      return reminders.length ? reminders[reminders.length - 1].at : dueAt;
    case 'AFTER_FIRST_UNANSWERED_REMINDER': {
      // The first reminder that carries a delay (a "0 hours" row is the
      // initial notice, not a reminder) — escalate one interval after it.
      const first = policy.reminders.filter((r) => r.enabled && r.after.value > 0).sort((a, b) => a.seq - b.seq)[0];
      if (!first) return dueAt;
      const start = new Date(startIso).getTime();
      const firstAt = shiftByDuration(db, first.after, start, policy.timer.calendarId);
      return new Date(shiftByDuration(db, first.after, firstAt, policy.timer.calendarId)).toISOString();
    }
    case 'ON_DUE_TIME':
    default:
      return dueAt;
  }
}

// ---------------------------------------------------------- invoice SLA
/** Which SLA clock is running for this invoice right now. */
export function slaStageFor(inv: Pick<Invoice, 'lifecycle' | 'stage' | 'processingFlag'>, openExceptions = 0): SlaStage | null {
  switch (currentStatus(inv, openExceptions)) {
    case 'Draft':
    case 'Validation':
      return 'INVOICE_CREATION';
    case 'Approval Pending':
      return inv.stage === 'TAX_REVIEW' ? 'TAX_REVIEW' : 'AP_APPROVAL';
    case 'Approved':
    case 'Parked':
    case 'Posted':
      return 'PAYMENT';
    // Paid, Rejected, Cancelled and Failed are not on an SLA clock: the
    // invoice is either finished or waiting on someone outside the platform.
    default:
      return null;
  }
}

/** Proposed stop-clock conditions (spec Screen 6) and the invoice state each one would map to. */
export const PAUSE_CONDITIONS: { code: string; label: string; resumeEvent: string; flags: string[] }[] = [
  { code: 'WAITING_VENDOR_DOCUMENT', label: 'Waiting for Vendor Document', resumeEvent: 'DOCUMENT_RECEIVED', flags: ['MISSING_DOCUMENTS'] },
  { code: 'WAITING_SAP_REFERENCE', label: 'Waiting for SAP GRN / SES', resumeEvent: 'SAP_REFERENCE_AVAILABLE', flags: ['SAP_PENDING'] },
  { code: 'SAP_INTEGRATION_UNAVAILABLE', label: 'SAP Integration Unavailable', resumeEvent: 'INTEGRATION_RECOVERED', flags: ['SAP_ERROR', 'TECHNICAL_RETRY'] },
  { code: 'APPROVED_SYSTEM_MAINTENANCE', label: 'Approved System Maintenance', resumeEvent: 'MAINTENANCE_ENDED', flags: [] },
  { code: 'WAITING_INTERNAL_AP_ACTION', label: 'Waiting for Internal AP Action', resumeEvent: 'AP_ACTION_COMPLETED', flags: ['EXTRACTION_REVIEW'] },
];

function pausedBy(policy: SlaPolicy, inv: Pick<Invoice, 'processingFlag'>): string | null {
  for (const rule of policy.pauseRules.filter((r) => r.pause)) {
    const cond = PAUSE_CONDITIONS.find((c) => c.code === rule.code);
    if (cond && inv.processingFlag && cond.flags.includes(inv.processingFlag)) return cond.label;
  }
  return null;
}

export interface SlaState {
  stage: SlaStage | null;
  stageLabel: string | null;
  policyCode: string | null;
  policyVersion: number | null;
  policyActive: boolean;
  target: SlaDuration | null;
  dueAt: string | null;
  warningAt: string | null;
  breached: boolean;
  paused: boolean;
  pauseReason: string | null;
}

const EMPTY: SlaState = { stage: null, stageLabel: null, policyCode: null, policyVersion: null, policyActive: false, target: null, dueAt: null, warningAt: null, breached: false, paused: false, pauseReason: null };

/**
 * Recompute the SLA for one invoice from the state it is actually in.
 * `since` is when the invoice entered its current state.
 */
export function computeSla(db: Database, inv: Invoice, openExceptions = 0, since?: string): SlaState {
  const stage = slaStageFor(inv, openExceptions);
  if (!stage) return EMPTY;
  const resolved = resolvePolicy(db, { scopeType: 'INVOICE_CATEGORY', stage, activity: activityForCategory(db, inv.categoryId) });
  if (!resolved) return { ...EMPTY, stage, stageLabel: SLA_STAGE_LABEL[stage] };
  const { policy, active } = resolved;
  const base: SlaState = {
    ...EMPTY, stage, stageLabel: SLA_STAGE_LABEL[stage], policyCode: policy.code, policyVersion: policy.version, policyActive: active,
  };
  if (!active || policy.timer.duration == null) return base;
  // The clock starts when the invoice entered its current state; when that
  // moment is not known we fall back to when the invoice was received, never to
  // the record's last-touched timestamp (which would reset every clock).
  const startIso = since ?? inv.receivedAt;
  const { dueAt, warningAt } = computeTimer(db, policy, startIso);
  const pauseReason = pausedBy(policy, inv);
  return {
    ...base,
    target: { value: policy.timer.duration, unit: policy.timer.unit },
    dueAt,
    warningAt,
    paused: Boolean(pauseReason),
    pauseReason,
    breached: !pauseReason && Boolean(dueAt) && Date.now() > new Date(dueAt!).getTime(),
  };
}

/** Apply the computed SLA back onto the invoice record. */
export function applySla(db: Database, inv: Invoice, openExceptions = 0, since?: string): SlaState {
  const s = computeSla(db, inv, openExceptions, since);
  inv.slaDueAt = s.dueAt ?? '';
  inv.slaBreached = s.breached;
  return s;
}

function openExceptionMap(db: Database): Map<string, number> {
  const openByInvoice = new Map<string, number>();
  db.exceptions
    .filter((e) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'].includes(e.status))
    .forEach((e) => openByInvoice.set(e.invoiceId, (openByInvoice.get(e.invoiceId) ?? 0) + 1));
  return openByInvoice;
}

/** When the invoice entered its current state — the most recent thing that happened to it. */
function stateEnteredMap(db: Database): Map<string, string> {
  const lastActionAt = new Map<string, string>();
  const note = (invoiceId: string, at?: string) => {
    if (!at) return;
    const prev = lastActionAt.get(invoiceId);
    if (!prev || at > prev) lastActionAt.set(invoiceId, at);
  };
  for (const step of db.workflowSteps) note(step.invoiceId, step.actedAt);
  for (const ev of db.timelineEvents) note(ev.invoiceId, ev.at);
  return lastActionAt;
}

function clockStart(inv: Invoice, stage: SlaStage | null, lastActionAt: Map<string, string>): string {
  return stage === 'INVOICE_CREATION' ? inv.receivedAt : lastActionAt.get(inv.id) ?? inv.receivedAt;
}

/**
 * Recompute every invoice — used after seeding, and after an SLA policy is
 * published or retired in Administration, so the data stays coherent.
 */
export function recomputeAllSla(db: Database): void {
  const openByInvoice = openExceptionMap(db);
  const lastActionAt = stateEnteredMap(db);
  for (const inv of db.invoices) {
    const open = openByInvoice.get(inv.id) ?? 0;
    const stage = slaStageFor(inv, open);
    applySla(db, inv, open, clockStart(inv, stage, lastActionAt));
  }
}

// ------------------------------------------------------ runtime instances
function statusFor(now: number, dueAt: string | null, warningAt: string | null, paused: boolean, active: boolean): SlaInstanceStatus {
  if (!active || !dueAt) return 'PENDING';
  if (paused) return 'PAUSED';
  const due = new Date(dueAt).getTime();
  if (now > due) return 'BREACHED';
  if (warningAt && now >= new Date(warningAt).getTime()) return 'WARNING';
  return 'RUNNING';
}

function buildEvents(db: Database, policy: SlaPolicy, startIso: string, dueAt: string | null, warningAt: string | null, now: number, closing?: SlaEvent): SlaEvent[] {
  const events: SlaEvent[] = [{ type: 'STARTED', at: startIso, detail: `${policy.code} v${policy.version} · ${policy.triggerEvent.replace(/_/g, ' ').toLowerCase()}` }];
  const closeAt = closing ? new Date(closing.at).getTime() : now;
  for (const r of reminderSchedule(db, policy, startIso, dueAt ?? undefined)) {
    if (new Date(r.at).getTime() <= closeAt) {
      events.push({ type: 'REMINDER', at: r.at, detail: `${r.label} → ${recipientLabel(r.recipient)} (${r.channels.map((c) => c.toLowerCase()).join(', ')})` });
    }
  }
  if (warningAt && new Date(warningAt).getTime() <= closeAt) events.push({ type: 'WARNING', at: warningAt, detail: 'Inside the pre-breach warning threshold' });
  if (dueAt && new Date(dueAt).getTime() <= closeAt && !closing) events.push({ type: 'BREACHED', at: dueAt, detail: 'Due time passed before completion' });
  const esc = escalationAt(db, policy, startIso, dueAt);
  if (!closing && esc && new Date(esc).getTime() <= closeAt) {
    events.push({ type: 'ESCALATED', at: esc, detail: `Escalated to ${recipientLabel(policy.escalation.primaryTarget)}${policy.escalation.fallbackTarget && policy.escalation.fallbackTarget !== 'NONE' ? ` (fallback ${recipientLabel(policy.escalation.fallbackTarget)})` : ''}` });
  }
  if (closing) events.push(closing);
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

const OWNER_FOR_STAGE: Record<SlaStage, string> = {
  INVOICE_CREATION: 'AP_TEAM', TAX_REVIEW: 'TAX_TEAM', AP_APPROVAL: 'CURRENT_APPROVER', PAYMENT: 'AP_TEAM', DOCUMENT_REQUEST: 'VENDOR',
};

/**
 * Derive every runtime SLA instance from the operational data. Closed
 * instances (COMPLETED / CANCELLED) are included so the monitor can show them
 * on request; the summary counts only open ones.
 */
export function buildSlaInstances(db: Database): SlaInstance[] {
  const now = Date.now();
  const openByInvoice = openExceptionMap(db);
  const lastActionAt = stateEnteredMap(db);
  const categoryName = (id?: string) => db.categories.find((c) => c.id === id)?.name;
  const out: SlaInstance[] = [];

  // ---- invoices: one clock each, for the stage it is in ------------------
  for (const inv of db.invoices) {
    const open = openByInvoice.get(inv.id) ?? 0;
    const stage = slaStageFor(inv, open);
    const status = currentStatus(inv, open);
    const activity = activityForCategory(db, inv.categoryId);
    const common = {
      objectType: 'INVOICE' as const, objectId: inv.id, reference: inv.invoiceNumber || inv.id, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
      vendorName: inv.vendorName, categoryId: inv.categoryId, categoryName: categoryName(inv.categoryId),
    };
    if (!stage) {
      // Closed clocks: Paid completes the payment SLA; Rejected / Cancelled
      // cancel whatever was running. Failed (SAP technical error) has no clock.
      const closedStage: SlaStage | null = status === 'Paid' ? 'PAYMENT' : status === 'Rejected' || status === 'Cancelled' ? 'INVOICE_CREATION' : null;
      if (!closedStage) continue;
      const resolved = resolvePolicy(db, { scopeType: 'INVOICE_CATEGORY', stage: closedStage, activity });
      if (!resolved) continue;
      const startIso = clockStart(inv, closedStage, lastActionAt);
      const closedAt = inv.paymentDate ?? inv.updatedAt;
      const closing: SlaEvent = status === 'Paid'
        ? { type: 'COMPLETED', at: closedAt, detail: 'Payment cleared in SAP' }
        : { type: 'CANCELLED', at: closedAt, detail: status === 'Rejected' ? 'Invoice rejected — waiting for corrected documents' : 'Invoice cancelled' };
      const { dueAt, warningAt } = resolved.active ? computeTimer(db, resolved.policy, startIso) : { dueAt: null, warningAt: null };
      out.push({
        id: `sla-${inv.id}-${closedStage.toLowerCase()}`, ...common,
        policyId: resolved.policy.id, policyCode: resolved.policy.code, policyName: resolved.policy.name, policyVersion: resolved.policy.version,
        stage: closedStage, owner: resolved.policy.owner ?? OWNER_FOR_STAGE[closedStage], startedAt: startIso, dueAt, warningAt,
        status: status === 'Paid' ? 'COMPLETED' : 'CANCELLED', remainingMs: null,
        events: buildEvents(db, resolved.policy, startIso, dueAt, warningAt, now, closing),
      });
      continue;
    }
    const resolved = resolvePolicy(db, { scopeType: 'INVOICE_CATEGORY', stage, activity });
    if (!resolved) continue;
    const { policy, active } = resolved;
    if (active && policy.timer.duration == null) continue; // stage does not apply to this type
    const startIso = clockStart(inv, stage, lastActionAt);
    const { dueAt, warningAt } = active ? computeTimer(db, policy, startIso) : { dueAt: null, warningAt: null };
    const pauseReason = active ? pausedBy(policy, inv) : null;
    const st = statusFor(now, dueAt, warningAt, Boolean(pauseReason), active);
    out.push({
      id: `sla-${inv.id}-${stage.toLowerCase()}`, ...common,
      policyId: policy.id, policyCode: policy.code, policyName: policy.name, policyVersion: policy.version,
      stage, owner: policy.owner ?? OWNER_FOR_STAGE[stage], startedAt: startIso, dueAt, warningAt, status: st,
      remainingMs: dueAt ? new Date(dueAt).getTime() - now : null,
      note: !active ? (policy.provisional ? policy.provisionalNote ?? 'Target to be confirmed' : `Policy ${policy.code} is ${policy.status.toLowerCase()} — not yet published`) : pauseReason ? `Paused: ${pauseReason}` : undefined,
      events: active ? buildEvents(db, policy, startIso, dueAt, warningAt, now) : [{ type: 'STARTED', at: startIso, detail: 'Waiting for an active policy version' }],
    });
  }

  // ---- approval steps: reminder / escalation clock per assigned step ------
  for (const step of db.workflowSteps.filter((s) => s.status === 'ACTIVE')) {
    const inv = db.invoices.find((i) => i.id === step.invoiceId);
    if (!inv) continue;
    const resolved = resolvePolicy(db, { scopeType: 'WORKFLOW', stage: 'AP_APPROVAL', activity: activityForCategory(db, inv.categoryId) });
    if (!resolved) continue;
    const { policy, active } = resolved;
    const instance = db.workflowInstances.find((w) => w.id === step.instanceId);
    const previous = db.workflowSteps
      .filter((s) => s.instanceId === step.instanceId && s.stepNo < step.stepNo && s.actedAt)
      .sort((a, b) => (b.actedAt ?? '').localeCompare(a.actedAt ?? ''))[0];
    const startIso = previous?.actedAt ?? instance?.startedAt ?? lastActionAt.get(inv.id) ?? inv.receivedAt;
    const { dueAt, warningAt } = active && policy.timer.duration != null ? computeTimer(db, policy, startIso) : { dueAt: null, warningAt: null };
    const roleName = db.roles.find((r) => r.code === step.role)?.name ?? step.role.replace(/_/g, ' ');
    const st = statusFor(now, dueAt, warningAt, false, active);
    out.push({
      id: `sla-${step.id}`, objectType: 'WORKFLOW_STEP', objectId: step.id, reference: `${inv.invoiceNumber || inv.id} · ${step.name}`,
      invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, vendorName: inv.vendorName, categoryId: inv.categoryId, categoryName: categoryName(inv.categoryId),
      policyId: policy.id, policyCode: policy.code, policyName: policy.name, policyVersion: policy.version,
      stage: 'AP_APPROVAL', owner: roleName, startedAt: startIso, dueAt, warningAt, status: st,
      remainingMs: dueAt ? new Date(dueAt).getTime() - now : null,
      note: !active ? `Policy ${policy.code} is not yet published` : undefined,
      events: active ? buildEvents(db, policy, startIso, dueAt, warningAt, now) : [{ type: 'STARTED', at: startIso, detail: 'Waiting for an active policy version' }],
    });
  }

  // ---- document requests: vendor chase clock per open missing-document case
  for (const ex of db.exceptions.filter((e) => e.type === 'MISSING_DOCUMENT')) {
    const inv = db.invoices.find((i) => i.id === ex.invoiceId);
    if (!inv) continue;
    const resolved = resolvePolicy(db, { scopeType: 'DOCUMENT_REQUEST', stage: 'DOCUMENT_REQUEST' });
    if (!resolved) continue;
    const { policy, active } = resolved;
    const closed = ['RESOLVED', 'CLOSED'].includes(ex.status);
    const startIso = ex.createdAt;
    const { dueAt, warningAt } = active && policy.timer.duration != null ? computeTimer(db, policy, startIso) : { dueAt: null, warningAt: null };
    const closing: SlaEvent | undefined = closed
      ? { type: ex.status === 'RESOLVED' ? 'COMPLETED' : 'CANCELLED', at: ex.resolvedAt ?? inv.updatedAt, detail: ex.resolution ?? 'Request closed' }
      : undefined;
    const st: SlaInstanceStatus = closed ? (ex.status === 'RESOLVED' ? 'COMPLETED' : 'CANCELLED') : statusFor(now, dueAt, warningAt, false, active);
    out.push({
      id: `sla-${ex.id}`, objectType: 'DOCUMENT_REQUEST', objectId: ex.id, reference: ex.id,
      invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, vendorName: inv.vendorName, categoryId: inv.categoryId, categoryName: categoryName(inv.categoryId),
      policyId: policy.id, policyCode: policy.code, policyName: policy.name, policyVersion: policy.version,
      stage: 'DOCUMENT_REQUEST', owner: policy.owner ?? 'VENDOR', startedAt: startIso, dueAt, warningAt, status: st,
      remainingMs: !closed && dueAt ? new Date(dueAt).getTime() - now : null,
      note: ex.title,
      events: active ? buildEvents(db, policy, startIso, dueAt, warningAt, now, closing) : [{ type: 'STARTED', at: startIso, detail: 'Waiting for an active policy version' }],
    });
  }

  return out.sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
}

// ------------------------------------------------------------- simulation
export interface SimulationRow { event: string; at: string | null; detail: string }

export function simulatePolicy(db: Database, policy: SlaPolicy, startIso: string): { rows: SimulationRow[]; calendarName: string | null } {
  const cal = ['BUSINESS_DAYS', 'BUSINESS_HOURS'].includes(policy.timer.unit) ? calendarFor(db, policy.timer.calendarId) : undefined;
  const rows: SimulationRow[] = [{ event: 'Start', at: startIso, detail: `Trigger: ${policy.triggerEvent.replace(/_/g, ' ')}` }];
  if (policy.timer.duration == null) {
    rows.push({ event: 'Target Duration', at: null, detail: 'Not applicable — no clock runs for this policy' });
    return { rows, calendarName: cal?.name ?? null };
  }
  const { dueAt, warningAt } = computeTimer(db, policy, startIso);
  rows.push({ event: 'Target Duration', at: null, detail: durationLabel({ value: policy.timer.duration, unit: policy.timer.unit }) + (cal ? ` on ${cal.name}` : '') });
  rows.push({ event: 'Due Date/Time', at: dueAt, detail: `Timezone ${policy.timer.timezone}` });
  rows.push({ event: 'Warning Starts', at: warningAt, detail: warningAt ? `${durationLabel(policy.timer.warningBefore)} before breach` : 'No warning threshold configured' });
  for (const r of reminderSchedule(db, policy, startIso, dueAt ?? undefined)) {
    rows.push({ event: r.label, at: r.at, detail: `${recipientLabel(r.recipient)} · ${r.channels.map((c) => c[0] + c.slice(1).toLowerCase()).join(', ')} · ${r.template}` });
  }
  const esc = escalationAt(db, policy, startIso, dueAt);
  rows.push({
    event: 'Escalation', at: esc,
    detail: policy.escalation.enabled
      ? `${policy.escalation.breachCondition.replace(/_/g, ' ').toLowerCase()} → ${recipientLabel(policy.escalation.primaryTarget)}${policy.escalation.fallbackTarget && policy.escalation.fallbackTarget !== 'NONE' ? `, fallback ${recipientLabel(policy.escalation.fallbackTarget)}` : ''}`
      : 'Escalation disabled for this policy',
  });
  // Fixed rows first (start, target), then everything with a time in order.
  const [start, target, ...timed] = rows;
  timed.sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9'));
  return { rows: [start, target, ...timed], calendarName: cal?.name ?? null };
}
