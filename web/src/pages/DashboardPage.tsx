/**
 * Dashboard — one page, three role dashboards.
 *
 * UI/UX review (Aug 2026):
 *  · Only metrics the business actually uses. Invented rates (STP %, exception
 *    rate, team throughput, high-value pending, "done this week") are gone.
 *  · SLA is a single, unambiguous number: SLA Breached. No "at risk"/"near SLA"
 *    blend, and no all-time date-range filter — filtering happens in the lists.
 *  · The work queue shows Current Status and Next Status. No Group column, no
 *    person assignment: work belongs to a role, not an individual.
 *  · The Administrator dashboard is about configuration, not invoices: how many
 *    categories, document types, users and roles exist — click a tile to list them.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, CheckCircle2, Clock, FileWarning, Files, FolderTree, ListTodo,
  RotateCw, Send, ShieldCheck, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  currentStatus, displayRole, fmtDateTime, fmtMoney, isPreExtraction, nextStatus, statusDetail,
} from '@/lib/format';
import {
  Badge, Card, ConfirmDialog, ErrorState, InfoTip, InvoiceStatusBadge, LoadingState, NotAvailable,
  PageHeader, StatusBadge, Tooltip, useToast,
} from '@/components/ui';

interface BacklogRow {
  stepId: string; invoiceId: string; invoiceNumber?: string; name: string; stepNo: number;
  role: string; roleName: string;
  vendorName?: string; categoryName?: string; amount?: number; currency?: string;
  lifecycle: string; stage?: string | null; processingFlag?: string | null; poNumber?: string;
  dueAt?: string; overdue: boolean;
}

interface DashboardData {
  kpis: Record<string, number | null>;
  byLifecycle: Record<string, number>;
  approvalBacklog: BacklogRow[];
  integrationHealth: { sapState: string; sapMessage: string };
  slaBreaches: { id: string; invoiceNumber: string; vendorName: string; stage: string; slaDueAt: string }[];
}

interface WorkRow {
  id: string; invoiceNumber: string; vendorName: string; categoryName: string; lifecycle: string;
  stage: string; processingFlag: string | null; poNumber?: string; slaDueAt: string; slaBreached: boolean;
  openExceptions: number; receivedAt: string; correlationId: string; extractionConfidence?: number | null;
}

type ViewRole = 'PROCESSOR' | 'SUPERVISOR' | 'ADMIN';

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'neutral';

/**
 * Unified stat card — the only KPI shape on the page. `primary` renders the
 * persona's headline metric as a filled card so the eye has one anchor.
 */
function StatCard({ label, value, caption, icon, tone = 'neutral', to, onClick, active, tip, primary }: {
  label: string;
  value: number | string | null | undefined;
  caption?: string;
  icon: React.ReactNode;
  tone?: Tone;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  tip?: { meaning: string; formula?: string; action?: string };
  primary?: boolean;
}) {
  const text: Record<Tone, string> = {
    green: 'text-essa-700', red: 'text-semantic-error', amber: 'text-semantic-warning', blue: 'text-semantic-info', neutral: 'text-ink',
  };
  const chip: Record<Tone, string> = {
    green: 'bg-essa-50 text-essa-600', red: 'bg-semantic-errorBg text-semantic-error', amber: 'bg-semantic-warningBg text-semantic-warning', blue: 'bg-semantic-infoBg text-semantic-info', neutral: 'bg-canvas text-ink-muted',
  };
  const body = primary ? (
    <div className="group flex h-full flex-col justify-between rounded-xl border border-essa-600 bg-essa-600 p-3 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start justify-between gap-1.5">
        <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-essa-100">
          {label} {tip && <InfoTip title={label} meaning={tip.meaning} formula={tip.formula} action={tip.action} className="text-essa-100" />}
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15 text-white">{icon}</span>
      </div>
      <div className="mt-2">
        <p className="text-[22px] font-bold leading-none text-white">{value ?? '—'}</p>
        <p className="mt-1 truncate text-2xs text-essa-100">{caption ?? ' '}</p>
      </div>
    </div>
  ) : (
    <div
      className={clsx(
        'group flex h-full flex-col justify-between rounded-xl border bg-white p-3 shadow-card transition-all hover:-translate-y-0.5 hover:border-essa-300 hover:shadow-pop',
        active ? 'border-essa-500 ring-2 ring-essa-100' : 'border-line'
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
          {label} {tip && <InfoTip title={label} meaning={tip.meaning} formula={tip.formula} action={tip.action} />}
        </span>
        <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', chip[tone])}>{icon}</span>
      </div>
      <div className="mt-2">
        <p className={clsx('text-[22px] font-bold leading-none', text[tone])}>{value ?? '—'}</p>
        <p className="mt-1 truncate text-2xs text-ink-muted">{caption ?? ' '}</p>
      </div>
    </div>
  );
  if (to) return <Link to={to} className="block h-full min-w-0">{body}</Link>;
  if (onClick) {
    // A div (not a button) so the tooltip trigger inside stays a valid child;
    // keyboard access is preserved explicitly.
    return (
      <div
        role="button"
        tabIndex={0}
        aria-pressed={active}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className="h-full min-w-0 cursor-pointer text-left focus-visible:outline-2"
      >
        {body}
      </div>
    );
  }
  return <div className="h-full min-w-0">{body}</div>;
}

/** Administrator configuration lists — one tile, one list. */
type AdminList = 'categories' | 'categoriesPo' | 'categoriesNonPo' | 'documentTypes' | 'users' | 'roles';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    window.setTimeout(() => setRefreshing(false), 600);
  };

  // The dashboard is decided purely by the signed-in persona.
  const role: ViewRole = useMemo(() => {
    const names = (user?.roleNames ?? []).map((n) => displayRole(n));
    if (names.includes('Administrator')) return 'ADMIN';
    if (names.includes('AP Supervisor') || names.includes('Tax Reviewer')) return 'SUPERVISOR';
    return 'PROCESSOR';
  }, [user?.roleNames]);

  const [adminList, setAdminList] = useState<AdminList>('categories');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    placeholderData: (prev) => prev,
  });

  // Processor work queue — reuses the workbench list API (open work, SLA first).
  const workQ = useQuery({
    queryKey: ['dashboard-work'],
    // Exactly the invoices the "My Work Queue" tile counts — Draft and
 // Validation, i.e. everything still waiting on the AP team.
    queryFn: () => api.get<{ items: WorkRow[]; total: number }>(`/invoices${qs({ pageSize: 8, statusIn: 'Draft,Validation', sortBy: 'slaDueAt', sortDir: 'asc' })}`),
    enabled: role === 'PROCESSOR',
  });

  // Administrator: what is configured on the platform.
  const configQ = useQuery({
    queryKey: ['dashboard-config'],
    queryFn: () => api.get<{
      categories: { id: string; name: string; poBased: boolean }[];
      documentTypes: { id: string; name: string }[];
      slaRules: { id: string; days: number | null }[];
    }>('/lookups'),
    enabled: role === 'ADMIN',
  });
  const usersQ = useQuery({
    queryKey: ['dashboard-users'],
    queryFn: () => api.get<{ users: { id: string; name: string; title: string; enabled: boolean; roleNames: string[] }[]; roles: { id: string; name: string; active?: boolean }[] }>('/users'),
    enabled: role === 'ADMIN' && hasPerm('USER_ADMIN'),
  });

  // Supervisor inline approve / reject on the backlog.
  const [rejecting, setRejecting] = useState<BacklogRow | null>(null);
  const approvalAct = useMutation({
    mutationFn: (p: { stepId: string; action: 'APPROVE' | 'REJECT'; comment?: string }) =>
      api.post(`/approvals/${p.stepId}/action`, { action: p.action, comment: p.comment }),
    onSuccess: (_r, p) => {
      toast.push({ tone: 'success', title: `Invoice ${p.action === 'APPROVE' ? 'approved' : 'rejected'}` });
      setRejecting(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Approval action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;

  const k = data.kpis;
  const health = data.integrationHealth;
  const backlog = data.approvalBacklog;

  const categories = configQ.data?.categories ?? [];
  const slaCount = (configQ.data?.slaRules ?? []).filter((r) => r.days != null).length;
  const roles = usersQ.data?.roles ?? [];
  const users = usersQ.data?.users ?? [];

  const adminLists: Record<AdminList, { title: string; rows: { key: string; primary: string; secondary?: string }[]; to?: string }> = {
    categories: {
      title: 'Invoice categories', to: '/admin/configuration',
      rows: categories.map((c) => ({ key: c.id, primary: c.name, secondary: c.poBased ? 'PO based' : 'Non-PO' })),
    },
    categoriesPo: {
      title: 'PO based invoice categories', to: '/admin/configuration',
      rows: categories.filter((c) => c.poBased).map((c) => ({ key: c.id, primary: c.name })),
    },
    categoriesNonPo: {
      title: 'Non-PO invoice categories', to: '/admin/configuration',
      rows: categories.filter((c) => !c.poBased).map((c) => ({ key: c.id, primary: c.name })),
    },
    documentTypes: {
      title: 'Document types', to: '/admin/configuration',
      rows: (configQ.data?.documentTypes ?? []).map((d) => ({ key: d.id, primary: d.name })),
    },
    users: {
      title: 'Users', to: '/admin/users',
      rows: users.map((u) => ({ key: u.id, primary: u.name, secondary: u.roleNames.length ? u.roleNames.join(', ') : 'No access' })),
    },
    roles: {
      title: 'Roles', to: '/admin/users',
      rows: roles.map((r) => ({ key: r.id, primary: r.name, secondary: r.active === false ? 'Disabled' : 'Enabled' })),
    },
  };
  const activeAdminList = adminLists[adminList];

  return (
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0">
      <PageHeader
        breadcrumb={[{ label: 'Home' }, { label: 'Dashboard' }]}
        title="Dashboard"
        description={
          role === 'PROCESSOR' ? 'The invoices waiting for you to act on.'
            : role === 'SUPERVISOR' ? 'Invoices waiting for your approval.'
              : 'What is configured on the platform.'
        }
        actions={
          <button
            onClick={refresh}
            title="Refresh the numbers on this dashboard"
            aria-label="Refresh dashboard"
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink-secondary shadow-card transition-colors hover:border-essa-400 hover:text-essa-700"
          >
            <RotateCw size={13} className={refreshing ? 'animate-spin' : undefined} /> Refresh
          </button>
        }
      />

      {health.sapState !== 'CONNECTED' && (
        <div className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium', health.sapState === 'DEGRADED' ? 'border-amber-300 bg-semantic-warningBg text-semantic-warning' : 'border-red-300 bg-semantic-errorBg text-semantic-error')}>
          <ShieldCheck size={14} />
          SAP interface is {health.sapState.toLowerCase()} — {health.sapMessage}. Invoices continue to be processed and are sent to SAP when the connection is restored.
        </div>
      )}

      {/* ================================================== AP PROCESSOR */}
      {role === 'PROCESSOR' && (
        <>
          {/* Counts only, never value. Primary = today's queue. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
            <StatCard
              primary label="My Work Queue" value={k.apWorkQueue} icon={<ListTodo size={13} />} to="/invoices?statusIn=Draft%2CValidation" caption="invoices waiting for action"
              tip={{ meaning: 'Invoices still waiting on the AP team — everything in Draft or Validation.', action: 'Work the queue with the earliest SLA first.' }}
            />
            <StatCard
              label="Exceptions to Fix" value={k.invoicesWithExceptions} tone="red" icon={<FileWarning size={13} />} to="/invoices?hasExceptions=true" caption="invoices with open exceptions"
              tip={{ meaning: 'Invoices stopped by a failed validation check. PO-based invoices only — Non-PO invoices are not validated, so they never raise an exception.', action: 'Open the invoice, correct the failed fields and revalidate.' }}
            />
            <StatCard
              label="SLA Breached" value={k.slaBreaches} tone="amber" icon={<Clock size={13} />} to="/invoices?slaBreached=true" caption="past their SLA due date"
              tip={{ meaning: 'Invoices past the SLA for the stage they are in — creation, tax review, approval or payment. A finished or vendor-blocked invoice has no SLA running.', action: 'Clear the oldest first.' }}
            />
            <StatCard
              label="Rejected" value={k.rejected} tone="amber" icon={<Send size={13} />} to="/invoices?status=Rejected" caption="waiting for vendor resubmission"
              tip={{ meaning: 'Invoices that were rejected and are waiting for the vendor to resubmit corrected documents.' }}
            />
            <StatCard
              label="Ready to Park" value={k.readyToPark} tone="green" icon={<CheckCircle2 size={13} />} to="/invoices?status=Approved" caption="approved · ready for SAP"
              tip={{ meaning: 'Fully approved invoices that are ready to be parked in SAP.' }}
            />
          </div>

          {/* My Work Queue — the same columns and the same order as the
              Invoice Workbench, so the two screens read identically. */}
          <Card
            title={
              <span className="flex w-full items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5">My Work Queue <InfoTip title="My Work Queue" meaning="Open invoices for your role, earliest SLA first, with the status they are in now and the status they move to next." action="Click a row to open the invoice." /></span>
                <Link to="/invoices" className="flex items-center gap-1 text-xs font-medium text-essa-700 hover:underline">Open workbench <ArrowRight size={12} /></Link>
              </span>
            }
            className="flex h-96 flex-col overflow-hidden xl:min-h-0 xl:flex-1 xl:h-auto"
          >
            <div className="h-full min-h-0 overflow-y-auto pr-0.5 scrollbar-thin">
              {!workQ.data?.items.length ? (
                <p className="py-6 text-center text-xs text-ink-muted">Nothing is waiting for you right now.</p>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="border-b border-line text-left text-2xs font-bold uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pl-2 pr-3">Invoice Number</th>
                      <th className="hidden py-2 pr-3 md:table-cell">Vendor Name</th>
                      <th className="hidden py-2 pr-3 lg:table-cell">Category</th>
                      <th className="py-2 pr-3">Current Status</th>
                      <th className="py-2 pr-3">Next Status</th>
                      <th className="py-2 pr-3 text-right">SLA Due</th>
                      <th className="w-10 py-2 pr-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {workQ.data.items.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => navigate(`/invoices/${r.id}`)}
                        className="group cursor-pointer transition-colors hover:bg-essa-50/70"
                      >
                        <td className="max-w-[10rem] truncate py-2.5 pl-2 pr-3 font-bold text-ink group-hover:text-essa-700">
                          {isPreExtraction(r) ? (
                            <Tooltip text="The invoice number appears once extraction finishes.">
                              <span className="font-medium text-ink-muted">{r.correlationId}</span>
                            </Tooltip>
                          ) : r.invoiceNumber}
                        </td>
                        <td className="hidden max-w-[12rem] truncate py-2.5 pr-3 text-ink-secondary md:table-cell">
                          {isPreExtraction(r) ? <NotAvailable /> : r.vendorName}
                        </td>
                        <td className="hidden max-w-[10rem] truncate py-2.5 pr-3 text-ink-muted lg:table-cell">
                          {isPreExtraction(r) ? <NotAvailable /> : r.categoryName}
                        </td>
                        <td className="py-2.5 pr-3">
                          <InvoiceStatusBadge status={currentStatus(r)} />
                          {statusDetail(r) && <span className="mt-0.5 block text-2xs text-ink-muted">{statusDetail(r)}</span>}
                        </td>
                        <td className="py-2.5 pr-3"><InvoiceStatusBadge status={nextStatus(r)} muted /></td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right">
                          {r.slaBreached ? (
                            <Badge tone="error">SLA Breached</Badge>
                          ) : r.slaDueAt ? (
                            <span className="text-2xs text-ink-muted">{fmtDateTime(r.slaDueAt)}</span>
                          ) : (
                            <span className="text-2xs text-ink-faint">No SLA</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-2 text-center">
                          <ArrowRight size={13} className="mx-auto text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-essa-600" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ================================================== AP SUPERVISOR */}
      {role === 'SUPERVISOR' && (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              primary label="Awaiting My Approval" value={backlog.length} icon={<BadgeCheck size={13} />} to="/approvals" caption="invoices to approve or reject"
              tip={{ meaning: 'Non-PO invoices waiting at an approval step. PO invoices do not need approval.', action: 'Approve or reject from the list below.' }}
            />
            <StatCard
              label="Overdue Approvals" value={backlog.filter((a) => a.overdue).length} tone="red" icon={<Clock size={13} />} to="/approvals" caption="past their SLA due date"
              tip={{ meaning: 'Approvals whose SLA due date has already passed.' }}
            />
          </div>

          {/* Approval backlog — invoice columns,
              no workflow step internals and no individual approver names. */}
          <Card
            title={
              <span className="flex w-full items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5">Awaiting My Approval <InfoTip title="Awaiting My Approval" meaning="Invoices waiting for your approval group to decide." action="Approve or reject here, or open the invoice for the full detail." /></span>
                <Link to="/approvals" className="flex items-center gap-1 text-xs font-medium text-essa-700 hover:underline">Open approvals <ArrowRight size={12} /></Link>
              </span>
            }
            className="flex h-96 flex-col overflow-hidden xl:min-h-0 xl:flex-1 xl:h-auto"
          >
            <div className="h-full min-h-0 overflow-y-auto pr-0.5 scrollbar-thin">
              {backlog.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink-muted">No approvals waiting.</p>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="border-b border-line text-left text-2xs font-bold uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pl-2 pr-3">Invoice Number</th>
                      <th className="hidden py-2 pr-3 md:table-cell">Vendor Name</th>
                      <th className="py-2 pr-3 text-right">Amount</th>
                      <th className="hidden py-2 pr-3 lg:table-cell">Category</th>
                      <th className="py-2 pr-3">Current Status</th>
                      <th className="py-2 pr-3 text-right">SLA Due</th>
                      {hasPerm('APPROVAL_ACT') && <th className="py-2 pr-2 text-center">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {backlog.map((a) => (
                      <tr key={a.stepId} className="group transition-colors hover:bg-essa-50/60">
                        <td className="max-w-[10rem] py-2 pl-2 pr-3">
                          <Link to={`/invoices/${a.invoiceId}?tab=approvals`} className="block truncate font-bold text-ink hover:text-essa-700 hover:underline">{a.invoiceNumber}</Link>
                        </td>
                        <td className="hidden max-w-[12rem] truncate py-2 pr-3 text-ink-secondary md:table-cell">{a.vendorName ?? '—'}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right font-bold text-ink">{fmtMoney(a.amount, a.currency)}</td>
                        <td className="hidden max-w-[14rem] truncate py-2 pr-3 text-ink-secondary lg:table-cell">{a.categoryName ?? '—'}</td>
                        <td className="py-2 pr-3"><InvoiceStatusBadge status={currentStatus(a)} /></td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">
                          {a.overdue ? <Badge tone="error">SLA Breached</Badge> : <span className="text-2xs text-ink-muted">{fmtDateTime(a.dueAt)}</span>}
                        </td>
                        {hasPerm('APPROVAL_ACT') && (
                          <td className="py-2 pr-2">
                            <span className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => approvalAct.mutate({ stepId: a.stepId, action: 'APPROVE' })}
                                disabled={approvalAct.isPending}
                                title="Approve this invoice" aria-label={`Approve ${a.invoiceNumber}`}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-essa-600 transition-colors hover:border-essa-500 hover:bg-essa-600 hover:text-white disabled:opacity-50"
                              >
                                <CheckCircle2 size={14} />
                              </button>
                              <button
                                onClick={() => setRejecting(a)}
                                title="Reject (a reason is required)" aria-label={`Reject ${a.invoiceNumber}`}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-semantic-error transition-colors hover:border-red-400 hover:bg-semantic-error hover:text-white"
                              >
                                <X size={14} />
                              </button>
                              <button
                                onClick={() => navigate(`/invoices/${a.invoiceId}?tab=approvals`)}
                                title="Open the invoice" aria-label={`Open ${a.invoiceNumber}`}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-muted transition-colors hover:border-essa-400 hover:text-essa-700"
                              >
                                <ArrowRight size={14} />
                              </button>
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ================================================== ADMINISTRATOR */}
      {role === 'ADMIN' && (
        <>
          {/* What is configured on the platform. Click a tile to see the list. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard
              primary label="Invoice Categories" value={categories.length} icon={<FolderTree size={13} />} onClick={() => setAdminList('categories')} caption="configured categories"
              tip={{ meaning: 'All invoice categories configured on the platform.', action: 'Maintain them in Invoice Configuration.' }}
            />
            <StatCard
              label="PO Categories" value={categories.filter((c) => c.poBased).length} tone="blue" icon={<FolderTree size={13} />} onClick={() => setAdminList('categoriesPo')} active={adminList === 'categoriesPo'} caption="matched against a PO"
              tip={{ meaning: 'Invoice categories that are matched against a purchase order.' }}
            />
            <StatCard
              label="Non-PO Categories" value={categories.filter((c) => !c.poBased).length} tone="blue" icon={<FolderTree size={13} />} onClick={() => setAdminList('categoriesNonPo')} active={adminList === 'categoriesNonPo'} caption="routed for approval"
              tip={{ meaning: 'Invoice categories without a purchase order — these go through the approval hierarchy.' }}
            />
            <StatCard
              label="Document Types" value={configQ.data?.documentTypes.length} tone="neutral" icon={<Files size={13} />} onClick={() => setAdminList('documentTypes')} active={adminList === 'documentTypes'} caption="expected in a bundle"
              tip={{ meaning: 'Document types that can appear inside an invoice bundle.' }}
            />
            <StatCard
              label="Users" value={users.length} tone="green" icon={<Users size={13} />} onClick={() => setAdminList('users')} active={adminList === 'users'} caption={`${users.filter((u) => u.enabled).length} enabled`}
              tip={{ meaning: 'Users synchronised from the corporate directory.', action: 'Assign roles in Users & Roles.' }}
            />
            <StatCard
              label="Roles" value={roles.length} tone="green" icon={<ShieldCheck size={13} />} onClick={() => setAdminList('roles')} active={adminList === 'roles'} caption="configured roles"
              tip={{ meaning: 'Roles configured on the platform and the permissions they carry.' }}
            />
            <StatCard
              label="SLA Targets" value={slaCount} tone="amber" icon={<Clock size={13} />} to="/admin/sla" caption="turnaround targets"
              tip={{ meaning: 'Turnaround targets per invoice type and stage, plus the approval reminder and escalation timers.', action: 'Maintain them in SLA & Reminders.' }}
            />
          </div>

          {/* The list behind the selected tile — no charts, no invoice metrics. */}
          <Card
            title={
              <span className="flex w-full items-center justify-between gap-1.5">
                <span>{activeAdminList.title} <span className="ml-1 text-2xs font-normal text-ink-muted">{activeAdminList.rows.length} item{activeAdminList.rows.length === 1 ? '' : 's'}</span></span>
                {activeAdminList.to && (
                  <Link to={activeAdminList.to} className="flex items-center gap-1 text-xs font-medium text-essa-700 hover:underline">Manage <ArrowRight size={12} /></Link>
                )}
              </span>
            }
            className="flex max-h-96 flex-col overflow-hidden"
          >
            <div className="min-h-0 overflow-y-auto pr-0.5 scrollbar-thin">
              {activeAdminList.rows.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink-muted">Nothing configured yet.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {activeAdminList.rows.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-2 text-xs">
                      <span className="min-w-0 truncate font-medium text-ink">{r.primary}</span>
                      {r.secondary && <span className="shrink-0 text-2xs text-ink-muted">{r.secondary}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

        </>
      )}

      {/* Reject with mandatory comment (inline backlog action) */}
      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        tone="danger"
        loading={approvalAct.isPending}
        title={`Reject — ${rejecting?.invoiceNumber}`}
        confirmLabel="Reject invoice"
        requireReason="Reason for rejection (required — the vendor is asked to resubmit)"
        message={<p className="text-xs">{rejecting?.vendorName} · {fmtMoney(rejecting?.amount, rejecting?.currency)} — rejecting sends the invoice back for corrected documents.</p>}
        onConfirm={(reason) => rejecting && reason && approvalAct.mutate({ stepId: rejecting.stepId, action: 'REJECT', comment: reason })}
      />
    </div>
  );
}
