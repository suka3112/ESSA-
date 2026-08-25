/**
 * Screens 2–6, 8 and 9 — Create / Edit SLA policy.
 *
 * One policy, edited across tabs:
 *   General · Timer & Calendar · Reminder Rules · Escalation Rules ·
 *   Pause / Stop-Clock (proposed) · Test / Simulation
 *
 * Versioning removed from the UI (review, 25 Aug): the user sees and edits a
 * single policy — no Versions tab, no version numbers, no "create new
 * version". Every action is recorded in the Audit Log as SLA_POLICY_*.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical, Plus, Save, Send, Trash2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs, Textarea, Tooltip, useToast,
} from '@/components/ui';
import {
  PolicyStatusBadge, ProposedNote, SLA_BREADCRUMB, Toggle, durationLabel, label,
  useSlaMeta, useSlaPolicies, type BusinessCalendar, type SimulationResult, type SlaChannel, type SlaMeta, type SlaPolicy, type SlaReminderRule, type SlaUnit,
} from './shared';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'timer', label: 'Timer & Calendar' },
  { key: 'reminders', label: 'Reminder Rules' },
  { key: 'escalation', label: 'Escalation Rules' },
  { key: 'pause', label: 'Pause / Stop-Clock' },
  { key: 'test', label: 'Test / Simulation' },
];

function blankPolicy(meta: SlaMeta, calendars: BusinessCalendar[]): SlaPolicy {
  const activeCalendar = calendars.find((c) => c.status === 'ACTIVE') ?? calendars[0];
  return {
    id: '', code: '', name: '', description: '', scopeType: 'INVOICE_CATEGORY', activity: '', stage: 'INVOICE_CREATION', triggerEvent: 'INVOICE_CREATED', owner: 'AP_TEAM',
    provisional: false, provisionalNote: '', version: 1, status: 'DRAFT', effectiveFrom: new Date().toISOString().slice(0, 10), changedBy: '', changedAt: '', changeSummary: 'New policy',
    timer: { duration: 1, unit: 'BUSINESS_DAYS', unitConfirmed: false, calendarId: activeCalendar?.id, timezone: meta.timezones[0], warningBefore: { value: 8, unit: 'HOURS' }, countdownOnWorkbench: true, dashboardIndicator: true },
    reminders: [],
    escalation: { enabled: false, breachCondition: 'ON_DUE_TIME', primaryTarget: 'AP_MANAGER', fallbackTarget: 'NONE', channels: ['EMAIL'], createAuditEvent: true, createBreachFlag: true },
    pauseRules: meta.pauseConditions.map((c) => ({ code: c.code, label: c.label, pause: false, resumeEvent: c.resumeEvent, reasonRequired: false })),
    manualPauseAllowed: false, maxPause: null,
  };
}

const errText = (e: unknown) => (e instanceof ApiError ? (Array.isArray(e.body.detail) ? (e.body.detail as string[]).join(' ') : e.body.message) : String(e));

/** Local datetime-local value for an ISO instant, in the browser's timezone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SlaPolicyEditor() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'general';
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const canPublish = hasPerm('CONFIG_PUBLISH');
  const meta = useSlaMeta();
  const policies = useSlaPolicies();

  const saved = useMemo(() => policies.data?.policies.find((p) => p.id === id), [policies.data, id]);
  const calendars = policies.data?.calendars ?? [];

  const [draft, setDraft] = useState<SlaPolicy | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!meta.data) return;
    if (isNew) { setDraft(blankPolicy(meta.data, policies.data?.calendars ?? [])); setDirty(false); return; }
    if (saved) { setDraft(structuredClone(saved)); setDirty(false); }
  }, [isNew, saved, meta.data, policies.data?.calendars]);

  const editable = Boolean(draft && canEdit && (isNew || draft.status !== 'RETIRED'));
  const update = (fn: (p: SlaPolicy) => void) => {
    setDraft((p) => { if (!p) return p; const n = structuredClone(p); fn(n); return n; });
    setDirty(true);
  };

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['sla-policies'] }); qc.invalidateQueries({ queryKey: ['sla-monitor'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  const save = useMutation({
    mutationFn: (p: SlaPolicy) => (isNew ? api.post<{ policy: SlaPolicy }>('/sla/policies', p) : api.post<{ policy: SlaPolicy }>(`/sla/policies/${p.id}`, p)),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: 'Saved', detail: `${r.policy.code} saved.` });
      invalidate();
      setDirty(false);
      if (isNew) navigate(`/admin/sla/policies/${r.policy.id}?tab=timer`, { replace: true });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not save', detail: errText(e) }),
  });

  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simStart, setSimStart] = useState(() => toLocalInput(new Date().toISOString()));
  const test = useMutation({
    mutationFn: (p: SlaPolicy) => api.post<{ policy: SlaPolicy; simulation: { rows: SimulationResult['rows']; calendarName: string | null } }>(`/sla/policies/${p.id}/test`, { startAt: new Date(simStart).toISOString() }),
    onSuccess: (r) => {
      setSimulation({ policy: r.policy, startAt: new Date(simStart).toISOString(), ...r.simulation });
      toast.push({ tone: 'success', title: 'Test completed', detail: 'The timeline below was calculated from this policy. It can now be published.' });
      invalidate();
      setTab('test');
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Test failed', detail: errText(e) }),
  });

  const [publishing, setPublishing] = useState<{ effectiveFrom: string; changeSummary: string } | null>(null);
  const publish = useMutation({
    mutationFn: (p: { id: string; effectiveFrom: string; changeSummary: string }) => api.post<{ policy: SlaPolicy }>(`/sla/policies/${p.id}/publish`, p),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: `${r.policy.code} published`, detail: 'Running SLA clocks were recalculated.' });
      setPublishing(null);
      invalidate();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not publish', detail: errText(e) }),
  });

  const [retiring, setRetiring] = useState(false);
  const retire = useMutation({
    mutationFn: (p: { id: string; reason: string }) => api.post(`/sla/policies/${p.id}/retire`, p),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Policy retired', detail: 'No new SLA instances will be created; existing clocks keep their history.' }); setRetiring(false); invalidate(); },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not retire', detail: errText(e) }),
  });

  const [deleting, setDeleting] = useState(false);
  const del = useMutation({
    mutationFn: (pid: string) => api.post(`/sla/policies/${pid}/delete`, {}),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Draft discarded' }); invalidate(); navigate('/admin/sla'); },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not discard', detail: errText(e) }),
  });

  if (meta.isLoading || policies.isLoading || !meta.data || !draft) return <LoadingState />;
  if (!isNew && !saved) return <div className="py-16 text-center text-sm text-ink-muted">This SLA policy does not exist. <Link to="/admin/sla" className="text-essa-700 hover:underline">Back to SLA Management</Link></div>;
  const m = meta.data;
  const codeLocked = !isNew;
  const readOnlyReason = !canEdit ? 'You can view this policy but not change it.' : draft.status === 'RETIRED' ? 'This policy is retired.' : null;

  const title = isNew ? 'Create SLA Policy' : draft.code;

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[...SLA_BREADCRUMB, { label: isNew ? 'Create SLA' : draft.code }]}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {title}
            {!isNew && <PolicyStatusBadge status={draft.status} />}
            {draft.provisional && <Tooltip text={draft.provisionalNote || 'Value to be confirmed by ESSA'}><Badge tone="warning">Provisional</Badge></Tooltip>}
          </span>
        }
        description={isNew ? 'Define where the SLA applies, what starts it and who owns it, then configure the timer, reminders and escalation. Save as Draft, test, then publish.' : draft.name}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/admin/sla')}><ArrowLeft size={14} /> Back</Button>
            {editable && <Button variant="secondary" loading={save.isPending} disabled={!dirty && !isNew} onClick={() => save.mutate(draft)}><Save size={14} /> Save</Button>}
            {editable && !isNew && <Button variant="secondary" loading={test.isPending} disabled={dirty} title={dirty ? 'Save first' : 'Run the simulation and mark this policy as tested'} onClick={() => test.mutate(draft)}><FlaskConical size={14} /> Test</Button>}
            {!isNew && canPublish && (draft.status === 'DRAFT' || draft.status === 'TEST') && (
              <Button disabled={dirty || draft.status !== 'TEST'} title={draft.status !== 'TEST' ? 'Run Test before publishing' : dirty ? 'Save first' : 'Publish this policy'} onClick={() => setPublishing({ effectiveFrom: draft.effectiveFrom, changeSummary: draft.changeSummary ?? '' })}><Send size={14} /> Publish</Button>
            )}
            {!isNew && canPublish && draft.status === 'ACTIVE' && <Button variant="warning" onClick={() => setRetiring(true)}><XCircle size={14} /> Retire</Button>}
            {!isNew && canEdit && (draft.status === 'DRAFT' || draft.status === 'TEST') && <Button variant="ghost" onClick={() => setDeleting(true)} title="Discard this draft"><Trash2 size={14} /></Button>}
          </>
        }
      />

      {readOnlyReason && <ProposedNote tone="info">{readOnlyReason}</ProposedNote>}

      <Card pad={false}>
        <div className="px-3 pt-1"><Tabs tabs={TABS.filter((t) => isNew ? t.key !== 'test' : true)} active={tab} onChange={setTab} counts={{ reminders: draft.reminders.length }} /></div>
        <div className="p-4">
          {tab === 'general' && <GeneralTab draft={draft} update={update} editable={editable} meta={m} codeLocked={codeLocked} />}
          {tab === 'timer' && <TimerTab draft={draft} update={update} editable={editable} meta={m} calendars={calendars} />}
          {tab === 'reminders' && <RemindersTab draft={draft} update={update} editable={editable} meta={m} />}
          {tab === 'escalation' && <EscalationTab draft={draft} update={update} editable={editable} meta={m} />}
          {tab === 'pause' && <PauseTab draft={draft} update={update} editable={editable} meta={m} />}
          {tab === 'test' && !isNew && (
            <TestTab
              draft={draft} simulation={simulation} simStart={simStart} setSimStart={setSimStart} dirty={dirty} editable={editable}
              onRun={() => test.mutate(draft)} running={test.isPending}
              onPreview={async () => {
                try {
                  const r = await api.post<SimulationResult>('/sla/simulate', { policyId: draft.id, startAt: new Date(simStart).toISOString() });
                  setSimulation(r);
                } catch (e) { toast.push({ tone: 'error', title: 'Simulation failed', detail: errText(e) }); }
              }}
            />
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------ publish */}
      <Modal
        open={Boolean(publishing)} onClose={() => setPublishing(null)} title={`Publish ${draft.code}`}
        footer={<><Button variant="ghost" onClick={() => setPublishing(null)}>Cancel</Button><Button loading={publish.isPending} onClick={() => publishing && publish.mutate({ id: draft.id, ...publishing })}>Publish</Button></>}
      >
        {publishing && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-ink-secondary">Publishing puts this policy in force from the effective date. Running SLA clocks are recalculated against the new rules.</p>
            <Field label="Effective From" required><Input type="date" value={publishing.effectiveFrom} onChange={(e) => setPublishing((p) => p && { ...p, effectiveFrom: e.target.value })} className="w-44" /></Field>
            <Field label="Change Summary" hint="Shown in the audit log"><Textarea rows={2} value={publishing.changeSummary} onChange={(e) => setPublishing((p) => p && { ...p, changeSummary: e.target.value })} /></Field>
            <p className="text-2xs text-ink-muted">Published by you, {fmtDate(new Date().toISOString())}. Recorded in the Audit Log.</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={retiring} onClose={() => setRetiring(false)} tone="warning" title={`Retire ${draft.code}`} confirmLabel="Retire policy" requireReason="Reason for retiring" loading={retire.isPending}
        message={<p>No new SLA instances will be created from this policy. Existing runtime clocks keep their history.</p>}
        onConfirm={(reason) => retire.mutate({ id: draft.id, reason: reason ?? '' })} />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} tone="danger" title="Discard this draft?" confirmLabel="Discard draft" loading={del.isPending}
        message={<p>Draft {draft.code} is deleted.</p>}
        onConfirm={() => del.mutate(draft.id)} />
    </div>
  );
}

// --------------------------------------------------------------- General
function GeneralTab({ draft, update, editable, meta, codeLocked }: { draft: SlaPolicy; update: (fn: (p: SlaPolicy) => void) => void; editable: boolean; meta: SlaMeta; codeLocked: boolean }) {
  const ro = !editable;
  const triggers = meta.triggerEvents.filter((t) => t.stages.includes(draft.stage));
  const scopeHint = meta.scopeTypes.find((s) => s.code === draft.scopeType)?.hint;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">Defines where the SLA applies, what starts it, and who owns it.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="SLA Code" required hint={codeLocked ? 'The SLA code cannot be changed after creation.' : 'Stable unique key, e.g. SERVICE_AP_VERIFICATION.'}>
          <Input value={draft.code} disabled={ro || codeLocked} maxLength={50} className="w-full font-mono uppercase" onChange={(e) => update((p) => { p.code = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); })} />
        </Field>
        <Field label="SLA Name" required>
          <Input value={draft.name} disabled={ro} maxLength={120} className="w-full" onChange={(e) => update((p) => { p.name = e.target.value; })} />
        </Field>
        <Field label="Scope Type" required hint={scopeHint}>
          <Select value={draft.scopeType} disabled={ro} className="w-full" onChange={(e) => update((p) => {
            p.scopeType = e.target.value as SlaPolicy['scopeType'];
            if (p.scopeType === 'DOCUMENT_REQUEST') { p.stage = 'DOCUMENT_REQUEST'; p.triggerEvent = 'DOCUMENT_REQUEST_SENT'; p.owner = 'VENDOR'; }
            else if (p.stage === 'DOCUMENT_REQUEST') { p.stage = 'INVOICE_CREATION'; p.triggerEvent = 'INVOICE_CREATED'; }
            if (p.scopeType === 'WORKFLOW') { p.stage = 'AP_APPROVAL'; p.triggerEvent = 'WORKFLOW_STEP_ASSIGNED'; p.owner = 'CURRENT_APPROVER'; }
            if (p.scopeType === 'GLOBAL') p.activity = '';
          })}>
            {meta.scopeTypes.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Category / Activity" required={draft.scopeType === 'INVOICE_CATEGORY'} hint={draft.scopeType === 'GLOBAL' || draft.scopeType === 'DOCUMENT_REQUEST' ? 'Not used for this scope.' : draft.scopeType === 'WORKFLOW' ? 'Leave blank to apply to every invoice type.' : activityHint(meta, draft.activity)}>
          <Select value={draft.activity ?? ''} disabled={ro || draft.scopeType === 'GLOBAL' || draft.scopeType === 'DOCUMENT_REQUEST'} className="w-full" onChange={(e) => update((p) => { p.activity = e.target.value; })}>
            <option value="">{draft.scopeType === 'WORKFLOW' ? 'All invoice types' : 'Select an activity'}</option>
            {meta.activities.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
          </Select>
        </Field>
        <Field label="Stage" required>
          <Select value={draft.stage} disabled={ro || draft.scopeType === 'DOCUMENT_REQUEST' || draft.scopeType === 'WORKFLOW'} className="w-full" onChange={(e) => update((p) => {
            p.stage = e.target.value as SlaPolicy['stage'];
            const t = meta.triggerEvents.find((x) => x.stages.includes(p.stage));
            if (t) p.triggerEvent = t.code;
          })}>
            {meta.stages.filter((s) => draft.scopeType === 'DOCUMENT_REQUEST' ? s.code === 'DOCUMENT_REQUEST' : s.code !== 'DOCUMENT_REQUEST').map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Trigger Event" required hint="The event that creates the runtime SLA instance.">
          <Select value={draft.triggerEvent} disabled={ro} className="w-full" onChange={(e) => update((p) => { p.triggerEvent = e.target.value; })}>
            {(triggers.length ? triggers : meta.triggerEvents).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Owner / Responsible" hint="Team or role accountable for meeting the SLA.">
          <Select value={draft.owner ?? ''} disabled={ro} className="w-full" onChange={(e) => update((p) => { p.owner = e.target.value; })}>
            <option value="">Not set</option>
            {meta.owners.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Effective From" required hint="Supports controlled future activation. Confirmed again at publish time.">
          <Input type="date" value={draft.effectiveFrom} disabled={ro} className="w-full" onChange={(e) => update((p) => { p.effectiveFrom = e.target.value; })} />
        </Field>
        <Field label="Status" required hint="Set by the lifecycle actions (Save Draft → Test → Publish → Retire), never edited directly.">
          <Input value={draft.status === 'TEST' ? 'Tested' : draft.status.charAt(0) + draft.status.slice(1).toLowerCase()} disabled className="w-full" readOnly />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={draft.description ?? ''} disabled={ro} onChange={(e) => update((p) => { p.description = e.target.value; })} />
        </Field>
      </div>
      <div className="rounded-lg border border-line bg-canvas p-3">
        <div className="flex items-start gap-3">
          <Toggle checked={draft.provisional} disabled={ro} label="Provisional — value to be confirmed" onChange={(v) => update((p) => { p.provisional = v; })} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink">Provisional — target still to be confirmed by ESSA</p>
            <p className="text-2xs text-ink-muted">A provisional policy can be saved and tested but stays Draft: it cannot be published until the flag is cleared.</p>
            {draft.provisional && <Input value={draft.provisionalNote ?? ''} disabled={ro} maxLength={200} placeholder="What is waiting for confirmation" className="mt-2 w-full" onChange={(e) => update((p) => { p.provisionalNote = e.target.value; })} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function activityHint(meta: SlaMeta, activity?: string): string | undefined {
  const a = meta.activities.find((x) => x.code === activity);
  if (!a) return 'Invoice / activity type from the SLA matrix.';
  if (!a.categoryIds.length) return `${a.label} is in the SLA matrix but has no invoice category configured yet — the policy applies once the category exists.`;
  return `Applies to ${a.categoryIds.length} configured invoice categor${a.categoryIds.length === 1 ? 'y' : 'ies'} (${a.categoryCodes.map((c) => c.replace(/_/g, '-')).join(', ')}).`;
}

// ----------------------------------------------------------------- Timer
function TimerTab({ draft, update, editable, meta, calendars }: { draft: SlaPolicy; update: (fn: (p: SlaPolicy) => void) => void; editable: boolean; meta: SlaMeta; calendars: BusinessCalendar[] }) {
  const ro = !editable;
  const t = draft.timer;
  const business = t.unit === 'BUSINESS_DAYS' || t.unit === 'BUSINESS_HOURS';
  const cal = calendars.find((c) => c.id === t.calendarId);
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">Defines the target duration and the calendar used to calculate the due time. The engine calculates start, warning and due time when the runtime instance is created.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Target Duration" required hint="Leave blank when the stage does not apply to this type — no clock runs.">
          <Input type="number" min={0} max={365} value={t.duration ?? ''} placeholder="Not applicable" disabled={ro} className="w-full" onChange={(e) => update((p) => { p.timer.duration = e.target.value === '' ? null : Math.max(0, Number(e.target.value)); })} />
        </Field>
        <Field label="Unit" required hint="Business units require a Business Calendar.">
          <span className="flex items-center gap-2">
            <Select value={t.unit} disabled={ro} className="w-full" onChange={(e) => update((p) => {
              p.timer.unit = e.target.value as SlaUnit;
              const b = p.timer.unit === 'BUSINESS_DAYS' || p.timer.unit === 'BUSINESS_HOURS';
              if (b && !p.timer.calendarId) p.timer.calendarId = calendars.find((c) => c.status === 'ACTIVE')?.id;
              if (!b) p.timer.calendarId = undefined;
            })}>
              {meta.units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
            </Select>
          </span>
        </Field>
        <Field label="Business Calendar" required={business} hint={business ? 'Controls weekends, holidays and working hours for this policy.' : 'Only used for Business Days / Business Hours.'}>
          <Select value={t.calendarId ?? ''} disabled={ro || !business} className="w-full" onChange={(e) => update((p) => { p.timer.calendarId = e.target.value || undefined; })}>
            <option value="">{business ? 'Select a calendar' : 'Not used'}</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status.toLowerCase()})</option>)}
          </Select>
        </Field>
        <Field label="Timezone" required hint="Use Asia/Jakarta (WIB) consistently for business-time calculation.">
          <Select value={t.timezone} disabled={ro} className="w-full" onChange={(e) => update((p) => { p.timer.timezone = e.target.value; })}>
            {meta.timezones.map((z) => <option key={z} value={z}>{z === 'Asia/Jakarta' ? 'Asia/Jakarta (WIB)' : z}</option>)}
          </Select>
        </Field>
        <Field label="Working Hours" hint="Read from the selected Business Calendar.">
          <Input value={cal ? `${cal.workStart} – ${cal.workEnd} · ${cal.workingDays.map((d) => dayNames[d]).join(', ')}` : business ? 'Select a calendar' : 'Calendar time (24 hours)'} disabled readOnly className="w-full" />
        </Field>
        <Field label="Warning Before Breach" hint="Optional — flags the item on the workbench and dashboard when it is this close to breach.">
          <span className="flex gap-2">
            <Input type="number" min={0} max={999} value={t.warningBefore?.value ?? ''} placeholder="None" disabled={ro} className="w-full" onChange={(e) => update((p) => { p.timer.warningBefore = e.target.value === '' ? null : { value: Math.max(0, Number(e.target.value)), unit: p.timer.warningBefore?.unit ?? 'HOURS' }; })} />
            <Select value={t.warningBefore?.unit ?? 'HOURS'} disabled={ro || !t.warningBefore} className="w-48" onChange={(e) => update((p) => { if (p.timer.warningBefore) p.timer.warningBefore.unit = e.target.value as SlaUnit; })}>
              {meta.units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
            </Select>
          </span>
        </Field>
        <ToggleRow label="Countdown on Workbench" hint="Show the remaining time on the invoice workbench and approvals list." checked={t.countdownOnWorkbench} disabled={ro} onChange={(v) => update((p) => { p.timer.countdownOnWorkbench = v; })} />
        <ToggleRow label="Dashboard SLA Indicator" hint="Count this policy's instances in the dashboard SLA widgets." checked={t.dashboardIndicator} disabled={ro} onChange={(v) => update((p) => { p.timer.dashboardIndicator = v; })} />
        <ToggleRow label="Unit confirmed by ESSA" hint="Tick once ESSA has confirmed whether the target is measured in calendar or working time." checked={t.unitConfirmed} disabled={ro} onChange={(v) => update((p) => { p.timer.unitConfirmed = v; })} />
      </div>
      <p className="text-2xs text-ink-muted">Runtime effect: the due time is recalculated only when a governed pause / resume rule applies or the policy is republished. Design note: weekends and holidays are never hardcoded — maintain them in the <Link to="/admin/sla/calendar" className="text-essa-700 hover:underline">Business Calendar</Link>.</p>
    </div>
  );
}

function ToggleRow({ label: text, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
      <div><p className="text-xs font-semibold text-ink">{text}</p><p className="text-2xs text-ink-muted">{hint}</p></div>
      <Toggle checked={checked} disabled={disabled} label={text} onChange={onChange} />
    </div>
  );
}

// ------------------------------------------------------------- Reminders
function ChannelPicker({ value, onChange, disabled, meta }: { value: SlaChannel[]; onChange: (v: SlaChannel[]) => void; disabled?: boolean; meta: SlaMeta }) {
  return (
    <span className="flex flex-wrap gap-1">
      {meta.channels.map((c) => {
        const on = value.includes(c.code);
        return (
          <button key={c.code} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== c.code) : [...value, c.code])}
            className={clsx('rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors disabled:cursor-not-allowed', on ? 'border-essa-600 bg-essa-50 text-essa-700' : 'border-line text-ink-muted hover:border-line-strong')}>
            {c.label}
          </button>
        );
      })}
    </span>
  );
}

function RemindersTab({ draft, update, editable, meta }: { draft: SlaPolicy; update: (fn: (p: SlaPolicy) => void) => void; editable: boolean; meta: SlaMeta }) {
  const ro = !editable;
  const rows = [...draft.reminders].sort((a, b) => a.seq - b.seq);
  const setRow = (id: string, fn: (r: SlaReminderRule) => void) => update((p) => { const r = p.reminders.find((x) => x.id === id); if (r) fn(r); });
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">Progressive reminders sent while the SLA is still open and no required action has been completed. Sending a reminder never completes, approves or rejects the underlying transaction.</p>
      <ProposedNote tone="info">Approval reminders at 24 hours, 48 hours, 3 days and 5 days; missing-document follow-up every 7 days. Reminder intervals are configurable in Administration — they are editable here without a code change.</ProposedNote>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-essa-600 text-2xs uppercase tracking-wide text-white">
              <th className="px-2 py-2">#</th><th className="px-2 py-2">Trigger After</th><th className="px-2 py-2">Recipient</th><th className="px-2 py-2">Channel</th><th className="px-2 py-2">Template</th><th className="px-2 py-2 text-center">Enabled</th>{!ro && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-2 py-6 text-center text-ink-muted">No reminders configured. {!ro && 'Add one below.'}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={clsx('border-t border-line-soft', !r.enabled && 'opacity-60')}>
                <td className="px-2 py-1.5 font-semibold">{r.seq}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1">
                    <Input type="number" min={0} value={r.after.value} disabled={ro} className="!h-8 !w-20" aria-label={`Reminder ${r.seq} delay`} onChange={(e) => setRow(r.id, (x) => { x.after.value = Math.max(0, Number(e.target.value)); })} />
                    <Select value={r.after.unit} disabled={ro} className="!h-8" aria-label={`Reminder ${r.seq} unit`} onChange={(e) => setRow(r.id, (x) => { x.after.unit = e.target.value as SlaUnit; })}>
                      {meta.units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                    </Select>
                    <Tooltip text="Repeat at this interval while the SLA is still open (vendor chase every 7 days)."><label className="flex items-center gap-1 whitespace-nowrap text-2xs text-ink-muted"><input type="checkbox" checked={r.repeat} disabled={ro} onChange={(e) => setRow(r.id, (x) => { x.repeat = e.target.checked; })} /> repeat</label></Tooltip>
                  </span>
                  {r.after.value === 0 && <span className="text-2xs text-ink-muted">Sent immediately (initial notice)</span>}
                </td>
                <td className="px-2 py-1.5">
                  <Select value={r.recipient} disabled={ro} className="!h-8" aria-label={`Reminder ${r.seq} recipient`} onChange={(e) => setRow(r.id, (x) => { x.recipient = e.target.value; })}>
                    {meta.recipients.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </Select>
                </td>
                <td className="px-2 py-1.5"><ChannelPicker value={r.channels} disabled={ro} meta={meta} onChange={(v) => setRow(r.id, (x) => { x.channels = v; })} /></td>
                <td className="px-2 py-1.5">
                  <Select value={r.template} disabled={ro} className="!h-8 max-w-56" aria-label={`Reminder ${r.seq} template`} onChange={(e) => setRow(r.id, (x) => { x.template = e.target.value; })}>
                    {!meta.templates.includes(r.template) && r.template && <option value={r.template}>{r.template}</option>}
                    {meta.templates.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </td>
                <td className="px-2 py-1.5 text-center"><Toggle checked={r.enabled} disabled={ro} label={`Reminder ${r.seq} enabled`} onChange={(v) => setRow(r.id, (x) => { x.enabled = v; })} /></td>
                {!ro && <td className="px-2 py-1.5 text-right"><Button size="sm" variant="ghost" aria-label={`Remove reminder ${r.seq}`} onClick={() => update((p) => { p.reminders = p.reminders.filter((x) => x.id !== r.id).map((x, i) => ({ ...x, seq: i + 1 })); })}><Trash2 size={13} /></Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ro && (
        <Button variant="secondary" size="sm" onClick={() => update((p) => {
          const seq = p.reminders.length + 1;
          const last = p.reminders[p.reminders.length - 1];
          p.reminders.push({ id: `rem-${Date.now()}`, seq, after: { value: last ? last.after.value * 2 : 24, unit: last?.after.unit ?? 'HOURS' }, repeat: false, recipient: last?.recipient ?? (p.owner && meta.recipients.some((r) => r.code === p.owner) ? p.owner : 'AP_TEAM'), channels: ['EMAIL'], template: meta.templates[0] ?? '', enabled: true });
        })}><Plus size={13} /> Add reminder level</Button>
      )}
      <p className="text-2xs text-ink-muted">Notification wording lives in the Notification configuration — templates are selected here, never edited, so text can change without a deployment.</p>
    </div>
  );
}

// ------------------------------------------------------------ Escalation
function EscalationTab({ draft, update, editable, meta }: { draft: SlaPolicy; update: (fn: (p: SlaPolicy) => void) => void; editable: boolean; meta: SlaMeta }) {
  const ro = !editable;
  const e = draft.escalation;
  const finalReminder = [...draft.reminders].filter((r) => r.enabled).sort((a, b) => a.seq - b.seq).pop();
  const summary = [
    e.breachCondition === 'AFTER_FINAL_REMINDER'
      ? { condition: finalReminder ? `No action after reminder ${finalReminder.seq} (${durationLabel(finalReminder.after)})` : 'No action after the final reminder', action: 'Auto-escalate', target: label(meta.escalationTargets, e.primaryTarget) }
      : e.breachCondition === 'AFTER_FIRST_UNANSWERED_REMINDER'
        ? { condition: 'No response after the first reminder', action: 'Escalate', target: label(meta.escalationTargets, e.primaryTarget) }
        : { condition: 'Due time exceeded', action: 'Escalate', target: label(meta.escalationTargets, e.primaryTarget) },
    ...(e.fallbackTarget && e.fallbackTarget !== 'NONE' ? [{ condition: 'No further level exists', action: 'Escalate', target: label(meta.escalationTargets, e.fallbackTarget) }] : []),
    ...(e.createAuditEvent ? [{ condition: 'All escalations', action: 'Audit event', target: 'Invoice audit trail' }] : []),
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">Defines what happens after SLA breach / final reminder. Escalation changes assignment and notification only — it is never an automatic business approval. Every escalation is recorded against the SLA instance and the invoice audit trail.</p>
      <ProposedNote tone="info">Approval escalates to the next approval level after the final reminder, and to the AP Manager (AP Supervisor persona) when no higher level exists. Missing-document chase escalates to the Head of Function after the first unanswered reminder. Recipient resolution reuses the workflow / approval hierarchy — there is no second approver master inside SLA.</ProposedNote>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
        <div><p className="text-xs font-semibold text-ink">Escalation enabled</p><p className="text-2xs text-ink-muted">Off for stage targets that only measure turnaround (e.g. Payment); on for approval and vendor-response policies.</p></div>
        <Toggle checked={e.enabled} disabled={ro} label="Escalation enabled" onChange={(v) => update((p) => { p.escalation.enabled = v; })} />
      </div>
      <div className={clsx('grid gap-4 md:grid-cols-2', !e.enabled && 'opacity-60')}>
        <Field label="Breach Condition" required>
          <Select value={e.breachCondition} disabled={ro || !e.enabled} className="w-full" onChange={(ev) => update((p) => { p.escalation.breachCondition = ev.target.value; })}>
            {meta.breachConditions.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </Select>
        </Field>
        <Field label="Primary Escalation" required>
          <Select value={e.primaryTarget} disabled={ro || !e.enabled} className="w-full" onChange={(ev) => update((p) => { p.escalation.primaryTarget = ev.target.value; })}>
            {meta.escalationTargets.filter((t) => t.code !== 'NONE').map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Fallback if No Next Level" required hint="Used when the primary target cannot be resolved, e.g. no higher approval level exists.">
          <Select value={e.fallbackTarget} disabled={ro || !e.enabled} className="w-full" onChange={(ev) => update((p) => { p.escalation.fallbackTarget = ev.target.value; })}>
            {meta.escalationTargets.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Channels" required>
          <span className="block pt-2"><ChannelPicker value={e.channels} disabled={ro || !e.enabled} meta={meta} onChange={(v) => update((p) => { p.escalation.channels = v; })} /></span>
        </Field>
        <ToggleRow label="Create Audit Event" hint="Record every escalation in the Audit Log, correlated with the invoice." checked={e.createAuditEvent} disabled={ro || !e.enabled} onChange={(v) => update((p) => { p.escalation.createAuditEvent = v; })} />
        <ToggleRow label="Create SLA Breach Flag" hint="Mark the invoice / step as SLA Breached on the workbench and dashboard." checked={e.createBreachFlag} disabled={ro || !e.enabled} onChange={(v) => update((p) => { p.escalation.createBreachFlag = v; })} />
      </div>
      {e.enabled && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead><tr className="bg-essa-600 text-2xs uppercase tracking-wide text-white"><th className="px-2 py-2">Condition</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Target</th><th className="px-2 py-2">Channel</th></tr></thead>
            <tbody>
              {summary.map((s, i) => (
                <tr key={i} className="border-t border-line-soft"><td className="px-2 py-1.5">{s.condition}</td><td className="px-2 py-1.5">{s.action}</td><td className="px-2 py-1.5 font-medium">{s.target}</td><td className="px-2 py-1.5">{s.action === 'Audit event' ? 'In-platform' : e.channels.map((c) => label(meta.channels, c)).join(', ') || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- Pause
function PauseTab({ draft, update, editable, meta }: { draft: SlaPolicy; update: (fn: (p: SlaPolicy) => void) => void; editable: boolean; meta: SlaMeta }) {
  const ro = !editable;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">Optional stop-clock configuration for periods where the owning team cannot progress because the invoice is waiting on an external dependency.</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <thead><tr className="bg-essa-600 text-2xs uppercase tracking-wide text-white"><th className="px-2 py-2">Pause Condition</th><th className="px-2 py-2 text-center">Pause?</th><th className="px-2 py-2">Resume Event</th><th className="px-2 py-2 text-center">Reason Required?</th></tr></thead>
          <tbody>
            {draft.pauseRules.map((r) => (
              <tr key={r.code} className="border-t border-line-soft">
                <td className="px-2 py-1.5"><span className="font-medium">{r.label}</span><span className="block font-mono text-2xs text-ink-muted">{r.code}</span></td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={r.pause} disabled={ro} aria-label={`Pause on ${r.label}`} onChange={(e) => update((p) => { const x = p.pauseRules.find((y) => y.code === r.code); if (x) x.pause = e.target.checked; })} /></td>
                <td className="px-2 py-1.5 font-mono text-2xs">{r.resumeEvent}</td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={r.reasonRequired} disabled={ro || !r.pause} aria-label={`Reason required for ${r.label}`} onChange={(e) => update((p) => { const x = p.pauseRules.find((y) => y.code === r.code); if (x) x.reasonRequired = e.target.checked; })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ToggleRow label="Manual Pause (permissioned)" hint="If allowed, a manual pause requires a reason and is fully audited." checked={draft.manualPauseAllowed} disabled={ro} onChange={(v) => update((p) => { p.manualPauseAllowed = v; })} />
        <Field label="Maximum Pause" hint="Optional guardrail — a paused clock resumes automatically after this long.">
          <span className="flex gap-2">
            <Input type="number" min={0} value={draft.maxPause?.value ?? ''} placeholder="No limit" disabled={ro} className="w-full" onChange={(e) => update((p) => { p.maxPause = e.target.value === '' ? null : { value: Math.max(0, Number(e.target.value)), unit: p.maxPause?.unit ?? 'CALENDAR_DAYS' }; })} />
            <Select value={draft.maxPause?.unit ?? 'CALENDAR_DAYS'} disabled={ro || !draft.maxPause} className="w-48" onChange={(e) => update((p) => { if (p.maxPause) p.maxPause.unit = e.target.value as SlaUnit; })}>
              {meta.units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
            </Select>
          </span>
        </Field>
      </div>
      <p className="text-2xs text-ink-muted">Runtime effect (if confirmed): on pause EAPA records the timestamp and reason and stops the paused period from counting; on resume the due time is recalculated and the full pause / resume history is kept on the SLA instance.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Test
function TestTab({ draft, simulation, simStart, setSimStart, dirty, editable, onRun, running, onPreview }: {
  draft: SlaPolicy; simulation: SimulationResult | null; simStart: string; setSimStart: (v: string) => void; dirty: boolean; editable: boolean; onRun: () => void; running: boolean; onPreview: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">Verify expected due dates, reminders and escalation before publishing. Simulation is read-only: it creates no operational SLA instance, sends no notification and changes no invoice.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Policy"><Input value={draft.code} disabled readOnly className="w-64" /></Field>
        <Field label="Start Date/Time" required><Input type="datetime-local" value={simStart} onChange={(e) => setSimStart(e.target.value)} className="w-56" /></Field>
        <Button variant="secondary" onClick={onPreview}>Preview timeline</Button>
        {editable && <Button loading={running} disabled={dirty} title={dirty ? 'Save first' : 'Run the test and mark this policy as tested'} onClick={onRun}><FlaskConical size={14} /> Run Test</Button>}
      </div>
      {draft.lastTestedAt && <p className="text-2xs text-ink-muted">Last tested {fmtDateTime(draft.lastTestedAt)}. Any edit clears the test.</p>}
      {simulation ? <SimulationTable result={simulation} /> : <p className="rounded-lg border border-dashed border-line py-8 text-center text-xs text-ink-muted">Run a preview to see the calculated timeline.</p>}
    </div>
  );
}

export function SimulationTable({ result }: { result: SimulationResult }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-xs">
        <thead><tr className="bg-essa-600 text-2xs uppercase tracking-wide text-white"><th className="px-2 py-2">Calculated Event</th><th className="px-2 py-2">Result</th><th className="px-2 py-2">Detail</th></tr></thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-t border-line-soft">
              <td className="px-2 py-1.5 font-medium">{r.event}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{r.at ? fmtDateTime(r.at) : <span className="text-ink-muted">{r.event === 'Target Duration' ? r.detail : '—'}</span>}</td>
              <td className="px-2 py-1.5 text-ink-secondary">{r.at ? r.detail : r.event === 'Target Duration' ? '' : r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line-soft px-2 py-1.5 text-2xs text-ink-muted">Calculated for {result.policy.code}{result.calendarName ? ` on ${result.calendarName}` : ''}, from {fmtDateTime(result.startAt)}. Times are shown in your local timezone.</p>
    </div>
  );
}
