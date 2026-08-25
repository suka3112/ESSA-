/**
 * Administration → SLA Management — shared types, hooks and small components.
 *
 * Screens follow the ESSA EAPA SLA Administration UI Specification:
 *   1  SLA Management list           →  SlaPoliciesPage
 *   2–6 Create/Edit SLA tabs         →  SlaPolicyEditor (General · Timer & Calendar ·
 *                                        Reminder Rules · Escalation Rules · Pause / Stop-Clock)
 *   7  Business Calendar             →  BusinessCalendarPage
 *   8  Test / Simulation             →  SlaSimulationPage (also inside the editor)
 *   9  Version, Publish & History    →  Versions tab of the editor
 *   12 Runtime Monitor + 13 widgets  →  SlaMonitorPage
 *   Reminder Rules / Escalation Rules navigation items → cross-policy views
 *
 * Vocabularies (scopes, stages, recipients …) come from GET /sla/meta so the
 * UI never drifts from the engine.
 */
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { Badge, StatusBadge, Tooltip } from '@/components/ui';

// ------------------------------------------------------------------ types
export type SlaStage = 'INVOICE_CREATION' | 'TAX_REVIEW' | 'AP_APPROVAL' | 'PAYMENT' | 'DOCUMENT_REQUEST';
export type SlaScopeType = 'INVOICE_CATEGORY' | 'WORKFLOW' | 'DOCUMENT_REQUEST' | 'GLOBAL';
export type SlaPolicyStatus = 'DRAFT' | 'TEST' | 'ACTIVE' | 'RETIRED';
export type SlaUnit = 'HOURS' | 'CALENDAR_DAYS' | 'BUSINESS_HOURS' | 'BUSINESS_DAYS';
export type SlaChannel = 'EMAIL' | 'TEAMS' | 'PORTAL';

export interface SlaDuration { value: number; unit: SlaUnit }

export interface SlaReminderRule {
  id: string; seq: number; after: SlaDuration; repeat: boolean; recipient: string; channels: SlaChannel[]; template: string; enabled: boolean;
}

export interface SlaEscalation {
  enabled: boolean; breachCondition: string; primaryTarget: string; fallbackTarget: string; channels: SlaChannel[]; createAuditEvent: boolean; createBreachFlag: boolean;
}

export interface SlaPauseRule { code: string; label: string; pause: boolean; resumeEvent: string; reasonRequired: boolean }

export interface SlaPolicy {
  id: string; code: string; name: string; description?: string;
  scopeType: SlaScopeType; activity?: string; stage: SlaStage; triggerEvent: string; owner?: string;
  provisional: boolean; provisionalNote?: string;
  version: number; status: SlaPolicyStatus; effectiveFrom: string;
  changedBy: string; changedAt: string; changeSummary?: string; publishedBy?: string; publishedAt?: string; retiredAt?: string; lastTestedAt?: string;
  timer: {
    duration: number | null; unit: SlaUnit; unitConfirmed: boolean; calendarId?: string; timezone: string;
    warningBefore: SlaDuration | null; countdownOnWorkbench: boolean; dashboardIndicator: boolean;
  };
  reminders: SlaReminderRule[];
  escalation: SlaEscalation;
  pauseRules: SlaPauseRule[];
  manualPauseAllowed: boolean;
  maxPause: SlaDuration | null;
}

export interface CalendarException { id: string; date: string; name: string; type: 'PUBLIC_HOLIDAY' | 'COMPANY_HOLIDAY' | 'WORKING_DAY_EXCEPTION'; working: boolean }

export interface BusinessCalendar {
  id: string; code: string; name: string; timezone: string; workingDays: number[]; workStart: string; workEnd: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'; version: number; effectiveFrom: string; changedBy: string; changedAt: string; exceptions: CalendarException[];
}

export interface SlaMeta {
  scopeTypes: { code: SlaScopeType; label: string; hint: string }[];
  stages: { code: SlaStage; label: string; hint: string }[];
  activities: { code: string; label: string; categoryCodes: string[]; categoryIds: string[] }[];
  triggerEvents: { code: string; label: string; stages: SlaStage[] }[];
  owners: { code: string; label: string }[];
  recipients: { code: string; label: string }[];
  escalationTargets: { code: string; label: string }[];
  units: { code: SlaUnit; label: string }[];
  channels: { code: SlaChannel; label: string }[];
  breachConditions: { code: string; label: string }[];
  templates: string[];
  timezones: string[];
  pauseConditions: { code: string; label: string; resumeEvent: string }[];
  statuses: SlaPolicyStatus[];
  runtimeStatuses: { code: string; label: string; hint: string }[];
}

export interface SlaEvent { type: string; at: string; detail: string }

export interface SlaInstance {
  id: string; objectType: 'INVOICE' | 'WORKFLOW_STEP' | 'DOCUMENT_REQUEST'; objectId: string; reference: string;
  invoiceId?: string; invoiceNumber?: string; vendorName?: string; categoryId?: string; categoryName?: string;
  policyId?: string; policyCode: string; policyName: string; policyVersion?: number; stage: SlaStage; owner: string;
  startedAt: string; warningAt?: string | null; dueAt?: string | null; status: string; remainingMs: number | null; note?: string; events: SlaEvent[];
}

export interface SimulationRow { event: string; at: string | null; detail: string }
export interface SimulationResult { policy: { id: string; code: string; name: string; version: number; status: string }; startAt: string; rows: SimulationRow[]; calendarName: string | null }

// ------------------------------------------------------------------ hooks
export function useSlaMeta() {
  return useQuery({ queryKey: ['sla-meta'], queryFn: () => api.get<SlaMeta>('/sla/meta'), staleTime: 5 * 60_000 });
}

export function useSlaPolicies() {
  return useQuery({ queryKey: ['sla-policies'], queryFn: () => api.get<{ policies: SlaPolicy[]; calendars: BusinessCalendar[] }>('/sla/policies') });
}

// ---------------------------------------------------------------- helpers
export const label = (list: { code: string; label: string }[] | undefined, code: string | undefined | null): string =>
  code ? list?.find((x) => x.code === code)?.label ?? code.replace(/_/g, ' ') : '—';

export function durationLabel(d: SlaDuration | null | undefined): string {
  if (!d) return '—';
  const names: Record<SlaUnit, [string, string]> = {
    HOURS: ['Hour', 'Hours'], CALENDAR_DAYS: ['Calendar Day', 'Calendar Days'], BUSINESS_HOURS: ['Business Hour', 'Business Hours'], BUSINESS_DAYS: ['Business Day', 'Business Days'],
  };
  const [one, many] = names[d.unit] ?? [d.unit, d.unit];
  return `${d.value} ${d.value === 1 ? one : many}`;
}

/** Target as shown in the list: "3 Business Days", "Not applicable", "1 Day *". */
export function targetLabel(p: SlaPolicy): string {
  if (p.timer.duration == null) return 'Not applicable';
  return durationLabel({ value: p.timer.duration, unit: p.timer.unit });
}

export function scopeLabel(p: SlaPolicy, meta?: SlaMeta): string {
  if (p.scopeType === 'INVOICE_CATEGORY') return label(meta?.activities, p.activity);
  if (p.scopeType === 'WORKFLOW') return p.activity ? `Workflow / ${label(meta?.activities, p.activity)}` : 'Workflow / all types';
  if (p.scopeType === 'DOCUMENT_REQUEST') return 'All / Document Request';
  return 'All types';
}

/** Human-readable countdown or overdue duration: "1d 6h", "+2h". */
export function remainingLabel(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const body = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? `+${body}` : body;
}

export const POLICY_STATUS_TIP: Record<SlaPolicyStatus, string> = {
  DRAFT: 'Being edited. Not used at runtime.',
  TEST: 'Simulated successfully; ready to be published.',
  ACTIVE: 'Published and in force. Immutable — create a new version to change it.',
  RETIRED: 'Replaced by a newer version or withdrawn. Existing runtime clocks keep their history.',
};

export function PolicyStatusBadge({ status }: { status: SlaPolicyStatus }) {
  return (
    <Tooltip text={POLICY_STATUS_TIP[status]}>
      <StatusBadge value={status === 'TEST' ? 'TESTING' : status} label={status === 'TEST' ? 'Tested' : status.charAt(0) + status.slice(1).toLowerCase()} />
    </Tooltip>
  );
}

export const RUNTIME_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'pending' | 'draft'> = {
  PENDING: 'draft', RUNNING: 'info', WARNING: 'warning', PAUSED: 'neutral', COMPLETED: 'success', BREACHED: 'error', CANCELLED: 'neutral',
};

export function RuntimeStatusBadge({ status, meta }: { status: string; meta?: SlaMeta }) {
  const info = meta?.runtimeStatuses.find((s) => s.code === status);
  return (
    <Tooltip text={info?.hint ?? status}>
      <Badge tone={RUNTIME_TONE[status] ?? 'neutral'}>{info?.label ?? status}</Badge>
    </Tooltip>
  );
}

/** "Proposed design" marker for controls the BPD does not define (spec §16). */
export function ProposedNote({ children, tone = 'warning' }: { children: React.ReactNode; tone?: 'warning' | 'info' }) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2 text-xs', tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-line bg-canvas text-ink-secondary')}>
      {children}
    </div>
  );
}

/** Small green switch, the same one the configuration screens use. */
export function Toggle({ checked, onChange, disabled, label: aria }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={aria} disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={clsx('relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-essa-600' : 'bg-line-strong')}
      style={{ height: 18, width: 32 }}
    >
      <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform" style={{ transform: checked ? 'translateX(15px)' : 'translateX(2px)' }} />
    </button>
  );
}

export function FilterField({ label: text, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-2xs font-semibold text-ink-muted">{text}</span>
      {children}
    </label>
  );
}

// ------------------------------------------------------- section navigation
/** Administration → SLA Management sub-navigation (spec §1.2). */
export const SLA_SECTIONS = [
  { key: 'policies', label: 'SLA Policies', to: '/admin/sla' },
  { key: 'reminders', label: 'Reminder Rules', to: '/admin/sla/reminders' },
  { key: 'escalations', label: 'Escalation Rules', to: '/admin/sla/escalations' },
  { key: 'calendar', label: 'Business Calendar', to: '/admin/sla/calendar' },
  { key: 'simulation', label: 'Simulation / Test', to: '/admin/sla/simulation' },
  { key: 'monitor', label: 'SLA Instances / Monitor', to: '/admin/sla/monitor' },
] as const;

export function SlaSectionNav({ active }: { active: (typeof SLA_SECTIONS)[number]['key'] }) {
  return (
    <nav aria-label="SLA Management sections" className="mb-3 flex flex-wrap gap-1 border-b border-line">
      {SLA_SECTIONS.map((s) => (
        <NavLink
          key={s.key}
          to={s.to}
          end
          className={clsx(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            active === s.key ? 'border-essa-600 text-essa-700' : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'
          )}
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}

export const SLA_BREADCRUMB = [{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'SLA Management', to: '/admin/sla' }];
