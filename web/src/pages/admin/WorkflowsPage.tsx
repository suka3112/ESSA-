/**
 * Workflows & Approval Hierarchy.
 *
 * UI/UX review (Aug 2026) §13:
 *  · The approval hierarchy is shown the way the business defines it — an
 *    amount range with the approval role at Level 1 to Level 4. The four level
 *    columns are fixed; rows (amount ranges) can be added and amounts changed.
 *  · "From amount / To amount" are proper columns, not a free-text band.
 *  · No individual approver names anywhere: an approval level belongs to a
 *    role, and whoever holds that role can approve.
 *
 * Review, 24 Aug 2026: Department is not a concept in this platform. Approval
 * authority is decided by the invoice amount band alone, exactly as the DoA
 * table in BPD v0.1.4 §11.2 defines it.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Mail, MessageSquare, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayRole, fmtMoney } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, useToast, type Column,
} from '@/components/ui';

interface DoARow { id: string; level: number; role: string; approverUserId: string; approverName: string; minAmount: number; maxAmount: number | null; currency: string; active: boolean }
interface StepDef { stepNo: number; name: string; role: string; approverType: string; amountThresholdMin?: number; taxStep?: boolean; slaHours: number; escalationTo?: string; notify: boolean }
interface WorkflowDef { id: string; code: string; name: string; description: string; categoryId?: string; status: string; version: string; steps: StepDef[] }

/**
 * The approval levels of the DoA hierarchy — BPD v0.1.4 §11.2.
 * HOS = Head of Section · HOD = Head of Department · HOF = Head of Function
 * OSH/STH = Operations & Site Head · GFD = Group Functional Director
 */
const DOA_ROLES = ['HOS', 'HOD', 'HOF', 'OSH_STH', 'GFD'];
/** The agreed four-level approval structure. */
const LEVELS = [1, 2, 3, 4] as const;

/**
 * Reference values from BPD v0.1.4 §11.4. These are surfaced here so an
 * administrator can see the full approval-lifecycle in one place; the actual
 * cadence lives in SLA Management and is what the notification engine reads.
 */
const REMINDER_SCHEDULE = [
  { n: 1, label: '1st reminder', after: '24 hours', recipient: 'Approver', channel: 'Email' as const },
  { n: 2, label: '2nd reminder', after: '48 hours', recipient: 'Approver', channel: 'Email' as const },
  { n: 3, label: '3rd reminder', after: '3 days', recipient: 'Approver + AP Manager', channel: 'Email' as const },
  { n: 4, label: 'Final reminder', after: '5 days', recipient: 'Approver + AP Manager', channel: 'Email' as const },
];

const ESCALATION_LADDER = [
  { n: 1, trigger: 'No action after 5-day final reminder', action: 'Auto-escalate to next DoA level', target: 'Next approver', channel: 'Teams + Email' as const },
  { n: 2, trigger: 'No further DoA level exists', action: 'Escalate to AP Manager', target: 'AP Manager', channel: 'Teams + Email' as const },
  { n: 3, trigger: 'All escalations', action: 'Log timestamp and SLA-breach reason', target: 'Audit trail', channel: 'In-platform' as const },
];

const VENDOR_CHASE = [
  { n: 1, label: '1st notification', trigger: 'On detection of missing document', recipient: 'Vendor', drafter: 'System · AP sends' },
  { n: 2, label: '1st reminder', trigger: 'Every 7 days while document still missing', recipient: 'Vendor', drafter: 'System · AP sends' },
  { n: 3, label: 'Escalation', trigger: 'After 1st reminder with no response', recipient: 'Head of Function (HOF)', drafter: 'System' },
];

const DOA_ROLE_LEGEND: { code: string; name: string }[] = [
  { code: 'HOS', name: 'Head of Section' },
  { code: 'HOD', name: 'Head of Department' },
  { code: 'HOF', name: 'Head of Function' },
  { code: 'OSH / STH', name: 'Operations & Site Head' },
  { code: 'GFD', name: 'Group Functional Director' },
];

/** Small icon-first tag used inside reference tables (Teams / Email / In-platform). */
function ChannelTag({ value }: { value: string }) {
  const teams = value.includes('Teams');
  const email = value.includes('Email');
  const platform = value.includes('platform');
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {teams && (
        <span className="inline-flex items-center gap-1 rounded bg-semantic-pendingBg px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-semantic-pending">
          <MessageSquare size={10} /> Teams
        </span>
      )}
      {email && (
        <span className="inline-flex items-center gap-1 rounded bg-line-soft px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-secondary">
          <Mail size={10} /> Email
        </span>
      )}
      {platform && (
        <span className="inline-flex items-center gap-1 rounded bg-semantic-successBg px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-semantic-success">
          In-platform
        </span>
      )}
    </span>
  );
}

/** One amount range with the role configured at each of the four levels. */
interface HierarchyRow {
  key: string;
  minAmount: number;
  maxAmount: number | null;
  active: boolean;
  levels: Record<number, DoARow | undefined>;
}

export default function WorkflowsPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('CONFIG_EDIT');
  const toast = useToast();
  const qc = useQueryClient();
  const [editingBand, setEditingBand] = useState<{ original?: HierarchyRow; minAmount: number; maxAmount: number | null; levelRoles: Record<number, string> } | null>(null);
  const [deletingBand, setDeletingBand] = useState<HierarchyRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['approval-matrix'],
    queryFn: () => api.get<{ doa: DoARow[]; workflows: WorkflowDef[] }>('/approval-matrix'),
  });
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<{ categories: { id: string; name: string }[] }>('/lookups') });

  const entity = useMutation({
    mutationFn: (p: { entity: string; op: string; row: Record<string, unknown> }) => api.post(`/configuration/entities/${p.entity}`, { op: p.op, row: p.row }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Approval configuration updated', detail: 'Applies to invoices that enter approval from now on.' });
      qc.invalidateQueries({ queryKey: ['approval-matrix'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  /** Pivot the stored levels into one row per amount range (a DoA band). */
  const hierarchy = useMemo<HierarchyRow[]>(() => {
    const map = new Map<string, HierarchyRow>();
    for (const d of data?.doa ?? []) {
      const key = `${d.minAmount}|${d.maxAmount ?? ''}`;
      const row = map.get(key) ?? {
        key, minAmount: d.minAmount, maxAmount: d.maxAmount, active: d.active, levels: {},
      };
      row.levels[d.level] = d;
      row.active = row.active || d.active;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.minAmount - b.minAmount);
  }, [data?.doa]);

  /**
   * Every invoice amount must fall in exactly one band, so the editor warns
   * before a range is saved that overlaps one that already exists.
   */
  const bandOverlaps = useMemo(() => {
    if (!editingBand) return false;
    const min = editingBand.minAmount;
    const max = editingBand.maxAmount ?? Number.POSITIVE_INFINITY;
    if (max <= min) return true;
    return hierarchy.some((r) => {
      if (editingBand.original && r.key === editingBand.original.key) return false;
      const rMax = r.maxAmount ?? Number.POSITIVE_INFINITY;
      // Inclusive comparison so adjacent bands cannot share a boundary
      // (e.g. Band 1 ending at 2,000,000 and Band 2 starting at 2,000,000
      // would both match an invoice of exactly 2,000,000 and trigger two
      // different approval workflows). From must be at least 1 higher than
      // the previous band's To.
      return min <= rMax && r.minAmount <= max;
    });
  }, [editingBand, hierarchy]);

  if (isLoading || !data) return <LoadingState />;

  const openBandEditor = (row?: HierarchyRow) =>
    setEditingBand({
      original: row,
      minAmount: row?.minAmount ?? 0,
      maxAmount: row?.maxAmount ?? null,
      levelRoles: Object.fromEntries(LEVELS.map((l) => [l, row?.levels[l]?.role ?? ''])) as Record<number, string>,
    });

  /** Save the whole amount range: one stored entry per level that has a role. */
  const saveBand = () => {
    if (!editingBand) return;
    const { original, minAmount, maxAmount, levelRoles } = editingBand;
    for (const level of LEVELS) {
      const role = levelRoles[level];
      const existing = original?.levels[level];
      if (role && existing) {
        entity.mutate({ entity: 'doaMatrix', op: 'UPDATE', row: { ...existing, minAmount, maxAmount, role, level } });
      } else if (role && !existing) {
        entity.mutate({
          entity: 'doaMatrix', op: 'CREATE',
          row: {
            minAmount, maxAmount, role, level, currency: 'IDR', active: true,
            // Routing resolves the actual approver from the role holders at run
            // time — no person is configured here.
            approverUserId: '', approverName: `${displayRole(role)} group`,
          },
        });
      } else if (!role && existing) {
        entity.mutate({ entity: 'doaMatrix', op: 'DELETE', row: { id: existing.id } });
      }
    }
    setEditingBand(null);
  };

  const deleteBand = () => {
    if (!deletingBand) return;
    Object.values(deletingBand.levels).forEach((d) => d && entity.mutate({ entity: 'doaMatrix', op: 'DELETE', row: { id: d.id } }));
    setDeletingBand(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Workflows & Approval Hierarchy' }]}
        title="Workflows & Approval Hierarchy"
      />

      {/* --------------------------------------------- approval hierarchy */}
      <Card
        title={
          <span>
            Approval hierarchy
            <span className="ml-2 text-2xs font-normal text-ink-muted">Non-PO</span>
          </span>
        }
        pad={false}
        actions={canEdit ? <Button size="sm" variant="secondary" onClick={() => openBandEditor()}><Plus size={13} /> Add amount range</Button> : undefined}
      >
        {/* Role legend — the columns use acronyms, so spell them out once at the top */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-white px-4 py-2 text-2xs text-ink-muted">
          <span className="mr-1 font-semibold uppercase tracking-wide">Roles</span>
          {DOA_ROLE_LEGEND.map((r) => (
            <span key={r.code} className="inline-flex items-center gap-1 rounded-full border border-line bg-line-soft px-2 py-0.5">
              <span className="font-semibold text-ink">{r.code}</span> {r.name}
            </span>
          ))}
        </div>
        <DataTable
          dense
          columns={[
            { key: 'band', header: 'Band', value: (r) => r.minAmount, render: (r) => <span className="font-medium">Band {hierarchy.findIndex((x) => x.key === r.key) + 1}</span> },
            { key: 'from', header: 'From Amount', align: 'right', sortable: true, value: (r) => r.minAmount, render: (r) => <span className="whitespace-nowrap">{fmtMoney(r.minAmount)}</span> },
            { key: 'to', header: 'To Amount', align: 'right', sortable: true, value: (r) => r.maxAmount ?? Number.MAX_SAFE_INTEGER, render: (r) => <span className="whitespace-nowrap">{r.maxAmount != null ? fmtMoney(r.maxAmount) : 'No limit'}</span> },
            ...LEVELS.map((l) => ({
              key: `level-${l}`,
              header: `Level ${l}`,
              align: 'center' as const,
              render: (r: HierarchyRow) =>
                r.levels[l]
                  ? <Badge tone="info">{displayRole(r.levels[l]!.role)}</Badge>
                  : <span className="text-2xs text-line-strong">—</span>,
            })),
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} label={r.active ? 'Enabled' : 'Disabled'} /> },
            {
              key: 'actions', header: 'Action', align: 'center', sticky: true, render: (r) =>
                canEdit ? (
                  <div className="flex justify-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Edit amount range" title="Edit this amount range and its levels" onClick={() => openBandEditor(r)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Delete amount range" title="Delete this amount range" className="text-semantic-error" onClick={() => setDeletingBand(r)}><Trash2 size={13} /></Button>
                  </div>
                ) : null,
            },
          ] satisfies Column<HierarchyRow>[]}
          rows={hierarchy}
          rowKey={(r) => r.key}
        />
      </Card>

      {/* --------------------------------------------- workflow definitions */}
      {data.workflows.map((wf) => (
        <Card
          key={wf.id}
          title={<span>{wf.name} <span className="ml-2 text-2xs font-normal text-ink-muted">{wf.categoryId ? lookups?.categories.find((c) => c.id === wf.categoryId)?.name : 'All Non-PO categories'}</span></span>}
          actions={<StatusBadge value={wf.status} />}
        >
          <div className="space-y-4">
            {hierarchy.map((band, bi) => {
              // Expand the workflow for this band: the "By approval hierarchy"
              // step becomes the band's own DoA levels, and steps that only
              // apply from a threshold amount are shown only in the bands they
              // can actually run in.
              const cells: { key: string; name: string; sub: string; sla: number; tax?: boolean; escalationTo?: string }[] = [];
              for (const s of wf.steps) {
                if (s.approverType === 'DOA') {
                  for (const l of LEVELS) {
                    const d = band.levels[l];
                    if (d) cells.push({ key: `s${s.stepNo}-doa${l}`, name: displayRole(d.role), sub: `Approval hierarchy · DoA level ${l}`, sla: s.slaHours, escalationTo: s.escalationTo });
                  }
                } else if (s.amountThresholdMin == null || (band.maxAmount ?? Number.POSITIVE_INFINITY) >= s.amountThresholdMin) {
                  cells.push({ key: `s${s.stepNo}`, name: s.name, sub: displayRole(s.role), sla: s.slaHours, tax: s.taxStep, escalationTo: s.escalationTo });
                }
              }
              return (
                <div key={band.key}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-2xs">
                    <span className="rounded bg-essa-50 px-2 py-0.5 font-semibold text-essa-700">Band {bi + 1}</span>
                    <span className="font-medium text-ink">
                      {fmtMoney(band.minAmount)} — {band.maxAmount != null ? fmtMoney(band.maxAmount) : 'No limit'}
                    </span>
                    <span className="text-ink-muted">· {cells.length} approval level{cells.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <div className="flex min-w-max items-center gap-0 py-1">
                      <div className="rounded-md border-2 border-essa-600 bg-essa-600 px-3 py-1.5 text-xs font-bold text-white">START</div>
                      {cells.map((c, i) => (
                        <div key={c.key} className="flex items-center">
                          <span className="h-0.5 w-6 bg-essa-400" />
                          <div className="w-44 rounded-lg border border-line bg-white p-2.5 shadow-card">
                            <p className="text-xs font-semibold text-ink">Level {i + 1} · {c.name}</p>
                            <p className="text-2xs text-ink-muted">{c.sub}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <Badge tone="neutral">SLA {c.sla}h</Badge>
                              {c.tax && <Badge tone="info">Tax review</Badge>}
                              {c.escalationTo && <Badge tone="pending">Escalates to {displayRole(c.escalationTo)}</Badge>}
                            </div>
                          </div>
                        </div>
                      ))}
                      <span className="h-0.5 w-6 bg-essa-400" />
                      <div className="rounded-md border-2 border-essa-600 bg-white px-3 py-1.5 text-xs font-bold text-essa-700">SAP PARKING</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      {/* --------------------------------------------- reminders + escalation
        * BPD §11.4 fixes both cadences. Values live in SLA Management; we
        * render them here as read-only reference so an admin sees the whole
        * approval-lifecycle without navigating away. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={<span className="inline-flex items-center gap-2"><BellRing size={13} className="text-essa-600" /> Reminders <span className="text-2xs font-normal text-ink-muted">If approver takes no action</span></span>}
          pad={false}
        >
          <DataTable
            dense
            columns={[
              { key: 'n', header: '#', align: 'center', render: (r: typeof REMINDER_SCHEDULE[number]) => <span className="font-semibold text-ink-muted">{r.n}</span> },
              { key: 'label', header: 'Reminder', render: (r) => <span className="font-medium">{r.label}</span> },
              { key: 'after', header: 'Triggered after', render: (r) => <span className="whitespace-nowrap">{r.after}</span> },
              { key: 'recipient', header: 'Recipient', render: (r) => <span>{r.recipient}</span> },
              { key: 'channel', header: 'Channel', render: (r) => <ChannelTag value={r.channel} /> },
            ] satisfies Column<typeof REMINDER_SCHEDULE[number]>[]}
            rows={REMINDER_SCHEDULE}
            rowKey={(r) => String(r.n)}
          />
        </Card>

        <Card
          title={<span className="inline-flex items-center gap-2"><ShieldAlert size={13} className="text-semantic-error" /> Escalation ladder <span className="text-2xs font-normal text-ink-muted">If SLA breached after all reminders</span></span>}
          pad={false}
        >
          <DataTable
            dense
            columns={[
              { key: 'n', header: '#', align: 'center', render: (r: typeof ESCALATION_LADDER[number]) => <span className="font-semibold text-ink-muted">{r.n}</span> },
              { key: 'trigger', header: 'Trigger', render: (r) => <span>{r.trigger}</span> },
              { key: 'action', header: 'Action', render: (r) => <span className="font-medium">{r.action}</span> },
              { key: 'target', header: 'Target', render: (r) => <span>{r.target}</span> },
            ] satisfies Column<typeof ESCALATION_LADDER[number]>[]}
            rows={ESCALATION_LADDER}
            rowKey={(r) => String(r.n)}
          />
        </Card>
      </div>

      {/* --------------------------------------------- vendor chase
        * BPD §11.4 — missing mandatory document. AP team reviews and sends the
        * system-drafted email; weekly follow-ups; escalates to HOF. */}
      <Card
        title={<span className="inline-flex items-center gap-2"><Mail size={13} className="text-essa-600" /> Vendor chase <span className="text-2xs font-normal text-ink-muted">Missing mandatory document</span></span>}
        pad={false}
      >
        <DataTable
          dense
          columns={[
            { key: 'n', header: '#', align: 'center', render: (r: typeof VENDOR_CHASE[number]) => <span className="font-semibold text-ink-muted">{r.n}</span> },
            { key: 'label', header: 'Notification / Reminder', render: (r) => <span className="font-medium">{r.label}</span> },
            { key: 'trigger', header: 'Triggered', render: (r) => <span>{r.trigger}</span> },
            { key: 'recipient', header: 'Recipient', render: (r) => <span>{r.recipient}</span> },
            { key: 'channel', header: 'Channel', render: () => <ChannelTag value="Email" /> },
            { key: 'drafter', header: 'Drafted by', render: (r) => <span className="text-ink-muted">{r.drafter}</span> },
          ] satisfies Column<typeof VENDOR_CHASE[number]>[]}
          rows={VENDOR_CHASE}
          rowKey={(r) => String(r.n)}
        />
      </Card>

      {/* ------------------------------------------------ amount-range editor */}
      <Modal
        open={Boolean(editingBand)}
        onClose={() => setEditingBand(null)}
        title={editingBand?.original ? 'Edit amount range' : 'Add amount range'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingBand(null)}>Cancel</Button>
            <Button
              disabled={!LEVELS.some((l) => editingBand?.levelRoles[l]) || bandOverlaps}
              loading={entity.isPending}
              onClick={saveBand}
            >
              Save
            </Button>
          </>
        }
      >
        {editingBand && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="From amount" required>
                <Input type="number" min={0} value={editingBand.minAmount} onChange={(e) => setEditingBand((p) => p && ({ ...p, minAmount: Number(e.target.value) }))} />
              </Field>
              <Field label="To amount" hint="Leave blank for no upper limit">
                <Input
                  type="number" min={0}
                  value={editingBand.maxAmount ?? ''}
                  onChange={(e) => setEditingBand((p) => p && ({ ...p, maxAmount: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </Field>
            </div>
            {bandOverlaps && (
              <p className="rounded-md bg-semantic-warningBg px-2.5 py-1.5 text-2xs text-semantic-warning">
                This amount range overlaps or touches another band. Bands must not share a boundary — set From at least 1 higher than the previous band’s To (e.g. 2,000,001, not 2,000,000) so every invoice amount falls in exactly one band.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-4">
              {LEVELS.map((l) => (
                <Field key={l} label={`Level ${l}`} hint={l === 1 ? 'Whoever holds this role can approve' : undefined}>
                  <Select
                    value={editingBand.levelRoles[l] ?? ''}
                    onChange={(e) => setEditingBand((p) => p && ({ ...p, levelRoles: { ...p.levelRoles, [l]: e.target.value } }))}
                    className="w-full"
                  >
                    <option value="">Not required</option>
                    {DOA_ROLES.map((r) => <option key={r} value={r}>{displayRole(r)}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingBand)}
        onClose={() => setDeletingBand(null)}
        onConfirm={deleteBand}
        loading={entity.isPending}
        tone="danger"
        title="Delete amount range"
        confirmLabel="Delete"
        message={<p className="text-xs">The approval levels configured for invoices between {fmtMoney(deletingBand?.minAmount)} and {deletingBand?.maxAmount != null ? fmtMoney(deletingBand.maxAmount) : 'no limit'} are removed. Invoices already in approval are unaffected.</p>}
      />

    </div>
  );
}
