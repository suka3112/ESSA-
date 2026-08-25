/**
 * Screen 7 — Business Calendar (PROPOSED).
 *
 * Maintains the working-time calendar used by policies measured in Business
 * Days / Business Hours: working days, daily working hours, timezone and the
 * holiday / exception list. Required only if ESSA confirms that SLA values are
 * working time; kept editable so the confirmation can be applied without a
 * deployment.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Send, Trash2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, Field, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, useToast } from '@/components/ui';
import { ProposedNote, SLA_BREADCRUMB, SlaSectionNav, useSlaMeta, useSlaPolicies, type BusinessCalendar, type CalendarException } from './shared';

const DAYS = [{ n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 7, l: 'Sun' }];
const EXCEPTION_TYPES = [
  { code: 'PUBLIC_HOLIDAY', label: 'Public Holiday' },
  { code: 'COMPANY_HOLIDAY', label: 'Company Holiday' },
  { code: 'WORKING_DAY_EXCEPTION', label: 'Working Day (exception)' },
] as const;

const errText = (e: unknown) => (e instanceof ApiError ? (Array.isArray(e.body.detail) ? (e.body.detail as string[]).join(' ') : e.body.message) : String(e));

export default function BusinessCalendarPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const canPublish = hasPerm('CONFIG_PUBLISH');
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useSlaMeta();
  const { data, isLoading } = useSlaPolicies();
  const calendars = data?.calendars ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => calendars.find((c) => c.id === selectedId) ?? calendars.find((c) => c.status === 'ACTIVE') ?? calendars[0], [calendars, selectedId]);
  const [draft, setDraft] = useState<BusinessCalendar | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (selected) { setDraft(structuredClone(selected)); setDirty(false); } }, [selected]);

  const usedBy = useMemo(() => (data?.policies ?? []).filter((p) => p.status === 'ACTIVE' && p.timer.calendarId === selected?.id), [data?.policies, selected]);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['sla-policies'] }); qc.invalidateQueries({ queryKey: ['sla-monitor'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); };

  const save = useMutation({
    mutationFn: (c: BusinessCalendar) => api.post<{ calendar: BusinessCalendar }>(`/sla/calendars/${c.id}`, c),
    onSuccess: (r) => { toast.push({ tone: 'success', title: 'Calendar saved', detail: r.calendar.status === 'ACTIVE' ? `Now v${r.calendar.version}. Running business-day SLA clocks were recalculated.` : 'Draft calendar saved.' }); invalidate(); setDirty(false); },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not save', detail: errText(e) }),
  });
  const [creating, setCreating] = useState<{ code: string; name: string } | null>(null);
  const create = useMutation({
    mutationFn: (p: { code: string; name: string }) => api.post<{ calendar: BusinessCalendar }>('/sla/calendars', { ...p, timezone: meta.data?.timezones[0] }),
    onSuccess: (r) => { toast.push({ tone: 'success', title: 'Calendar created', detail: 'Saved as Draft. Publish it to make it selectable by policies at runtime.' }); invalidate(); setCreating(null); setSelectedId(r.calendar.id); },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not create', detail: errText(e) }),
  });
  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/sla/calendars/${id}/publish`, {}),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Calendar published' }); invalidate(); },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not publish', detail: errText(e) }),
  });
  const [retiring, setRetiring] = useState(false);
  const retire = useMutation({
    mutationFn: (id: string) => api.post(`/sla/calendars/${id}/retire`, {}),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Calendar retired' }); setRetiring(false); invalidate(); },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not retire', detail: errText(e) }),
  });

  if (isLoading || !meta.data || !draft) return <LoadingState />;
  const editable = canEdit && draft.status !== 'RETIRED';
  const update = (fn: (c: BusinessCalendar) => void) => { setDraft((c) => { if (!c) return c; const n = structuredClone(c); fn(n); return n; }); setDirty(true); };
  const exceptions = [...draft.exceptions].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[...SLA_BREADCRUMB, { label: 'Business Calendar' }]}
        title="Business Calendar"
        description="Maintains working days, hours and holidays used by Business Day / Business Hour SLA policies. Associate policies with a calendar rather than embedding calendar logic in each policy."
        actions={
          <>
            {calendars.length > 1 && (
              <Select value={draft.id} onChange={(e) => setSelectedId(e.target.value)} aria-label="Select calendar" className="w-56">
                {calendars.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status.toLowerCase()})</option>)}
              </Select>
            )}
            {canEdit && <Button variant="secondary" onClick={() => setCreating({ code: '', name: '' })}><Plus size={14} /> New calendar</Button>}
            {editable && <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(draft)}><Save size={14} /> Save</Button>}
            {canPublish && draft.status === 'DRAFT' && <Button variant="secondary" disabled={dirty} loading={publish.isPending} onClick={() => publish.mutate(draft.id)}><Send size={14} /> Publish</Button>}
            {canPublish && draft.status === 'ACTIVE' && <Button variant="warning" onClick={() => setRetiring(true)}><XCircle size={14} /> Retire</Button>}
          </>
        }
      />
      <SlaSectionNav active="calendar" />
      <ProposedNote><span className="font-semibold">PROPOSED — technical design required only if ESSA confirms SLA is calculated using working days or working hours.</span> Calendar changes affect new calculations from their effective date; existing runtime instances keep their calculated history unless a controlled recalculation is explicitly required.</ProposedNote>

      <div className="grid gap-3 lg:grid-cols-5">
        <Card title={<span className="inline-flex items-center gap-2">Calendar <StatusBadge value={draft.status} /> <span className="text-2xs font-normal text-ink-muted">v{draft.version}</span></span>} className="lg:col-span-2">
          <div className="space-y-3">
            <Field label="Calendar Code" required><Input value={draft.code} disabled readOnly className="w-full font-mono" /></Field>
            <Field label="Calendar Name" required><Input value={draft.name} disabled={!editable} maxLength={80} className="w-full" onChange={(e) => update((c) => { c.name = e.target.value; })} /></Field>
            <Field label="Timezone" required>
              <Select value={draft.timezone} disabled={!editable} className="w-full" onChange={(e) => update((c) => { c.timezone = e.target.value; })}>
                {meta.data.timezones.map((z) => <option key={z} value={z}>{z === 'Asia/Jakarta' ? 'Asia/Jakarta (WIB)' : z}</option>)}
              </Select>
            </Field>
            <Field label="Working Days" required>
              <span className="flex flex-wrap gap-1 pt-1">
                {DAYS.map((d) => {
                  const on = draft.workingDays.includes(d.n);
                  return (
                    <button key={d.n} type="button" disabled={!editable} aria-pressed={on} onClick={() => update((c) => { c.workingDays = on ? c.workingDays.filter((x) => x !== d.n) : [...c.workingDays, d.n].sort(); })}
                      className={clsx('rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed', on ? 'border-essa-600 bg-essa-600 text-white' : 'border-line bg-white text-ink-muted hover:border-line-strong')}>
                      {d.l}
                    </button>
                  );
                })}
              </span>
            </Field>
            <Field label="Working Hours" required>
              <span className="flex items-center gap-2">
                <Input type="time" value={draft.workStart} disabled={!editable} className="w-32" onChange={(e) => update((c) => { c.workStart = e.target.value; })} />
                <span className="text-xs text-ink-muted">to</span>
                <Input type="time" value={draft.workEnd} disabled={!editable} className="w-32" onChange={(e) => update((c) => { c.workEnd = e.target.value; })} />
              </span>
            </Field>
            <Field label="Effective From" required><Input type="date" value={draft.effectiveFrom} disabled={!editable} className="w-full" onChange={(e) => update((c) => { c.effectiveFrom = e.target.value; })} /></Field>
            <dl className="rounded-lg border border-line bg-canvas p-2.5 text-2xs text-ink-muted">
              <div>Last changed by {draft.changedBy}, {fmtDateTime(draft.changedAt)}</div>
              <div className="mt-1" title={usedBy.map((p) => p.code).join(', ')}>Used by {usedBy.length} active polic{usedBy.length === 1 ? 'y' : 'ies'}{usedBy.length ? ` — ${usedBy.slice(0, 4).map((p) => p.code).join(', ')}${usedBy.length > 4 ? ` and ${usedBy.length - 4} more` : ''}` : ''}.</div>
            </dl>
          </div>
        </Card>

        <Card title="Holidays & exceptions" className="lg:col-span-3" pad={false}
          actions={editable ? <Button size="sm" variant="secondary" onClick={() => update((c) => { c.exceptions.push({ id: `hol-${Date.now()}`, date: '', name: '', type: 'PUBLIC_HOLIDAY', working: false }); })}><Plus size={13} /> Add date</Button> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="bg-essa-600 text-2xs uppercase tracking-wide text-white"><th className="px-3 py-2">Date</th><th className="min-w-56 px-3 py-2">Holiday / Exception</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-center">Working?</th>{editable && <th className="px-3 py-2"></th>}</tr></thead>
              <tbody>
                {exceptions.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">No non-working dates configured — only weekends are skipped.</td></tr>}
                {exceptions.map((h) => (
                  <ExceptionRow key={h.id} h={h} editable={editable} onChange={(fn) => update((c) => { const x = c.exceptions.find((y) => y.id === h.id); if (x) fn(x); })} onRemove={() => update((c) => { c.exceptions = c.exceptions.filter((y) => y.id !== h.id); })} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line-soft px-3 py-2 text-2xs text-ink-muted">A <span className="font-medium">Working Day (exception)</span> makes a weekend date count as working time. Dates are in the calendar's timezone.</p>
        </Card>
      </div>

      <Modal open={Boolean(creating)} onClose={() => setCreating(null)} title="New business calendar"
        footer={<><Button variant="ghost" onClick={() => setCreating(null)}>Cancel</Button><Button loading={create.isPending} disabled={!creating?.code || !creating?.name} onClick={() => creating && create.mutate(creating)}>Create draft</Button></>}>
        {creating && (
          <div className="space-y-3">
            <Field label="Calendar Code" required hint="Upper-case letters, digits and underscores."><Input value={creating.code} className="w-full font-mono" maxLength={50} onChange={(e) => setCreating((c) => c && { ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} /></Field>
            <Field label="Calendar Name" required><Input value={creating.name} className="w-full" maxLength={80} onChange={(e) => setCreating((c) => c && { ...c, name: e.target.value })} /></Field>
            <p className="text-2xs text-ink-muted">Starts as Mon–Fri, 08:00–17:00, {meta.data.timezones[0]}. Adjust and publish.</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={retiring} onClose={() => setRetiring(false)} tone="warning" title={`Retire ${draft.name}?`} confirmLabel="Retire calendar" loading={retire.isPending}
        message={<p>Retiring is refused while an active policy still uses this calendar. Point those policies at another calendar first.</p>} onConfirm={() => retire.mutate(draft.id)} />
    </div>
  );
}

function ExceptionRow({ h, editable, onChange, onRemove }: { h: CalendarException; editable: boolean; onChange: (fn: (x: CalendarException) => void) => void; onRemove: () => void }) {
  return (
    <tr className="border-t border-line-soft">
      <td className="px-3 py-1.5 whitespace-nowrap">{editable ? <Input type="date" value={h.date} className="!h-8 w-36" aria-label="Holiday date" onChange={(e) => onChange((x) => { x.date = e.target.value; })} /> : fmtDate(h.date)}</td>
      <td className="px-3 py-1.5">{editable ? <Input value={h.name} className="!h-8 w-full" maxLength={80} placeholder="Name" aria-label="Holiday name" onChange={(e) => onChange((x) => { x.name = e.target.value; })} /> : h.name}</td>
      <td className="px-3 py-1.5">
        {editable ? (
          <Select value={h.type} className="!h-8" aria-label="Exception type" onChange={(e) => onChange((x) => { x.type = e.target.value as CalendarException['type']; x.working = x.type === 'WORKING_DAY_EXCEPTION'; })}>
            {EXCEPTION_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </Select>
        ) : EXCEPTION_TYPES.find((t) => t.code === h.type)?.label}
      </td>
      <td className="px-3 py-1.5 text-center"><Badge tone={h.working ? 'success' : 'neutral'}>{h.working ? 'Yes' : 'No'}</Badge></td>
      {editable && <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" aria-label={`Remove ${h.name || h.date}`} onClick={onRemove}><Trash2 size={13} /></Button></td>}
    </tr>
  );
}
