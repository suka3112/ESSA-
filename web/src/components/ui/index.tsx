/**
 * ESSA design system - core reusable components.
 * Visual language follows the ESSA enterprise reference: white surfaces,
 * green primary, subtle borders, dense-but-readable tables.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, Loader2, SearchX, ShieldAlert, X, XCircle, Inbox } from 'lucide-react';

// ---------------------------------------------------------------- Button
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 py-1.5 text-sm';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-essa-600 text-white hover:bg-essa-700 active:bg-essa-800 shadow-sm',
    secondary: 'border border-essa-600 text-essa-700 bg-white hover:bg-essa-50 active:bg-essa-100',
    ghost: 'text-ink-secondary hover:bg-line-soft border border-transparent',
    danger: 'bg-semantic-error text-white hover:bg-red-800',
    warning: 'border border-amber-600 text-amber-700 bg-white hover:bg-amber-50',
  };
  return (
    <button className={clsx(base, sizes, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Badge
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'pending' | 'draft';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-line-soft text-ink-secondary',
    success: 'bg-semantic-successBg text-semantic-success',
    warning: 'bg-semantic-warningBg text-semantic-warning',
    error: 'bg-semantic-errorBg text-semantic-error',
    info: 'bg-semantic-infoBg text-semantic-info',
    pending: 'bg-semantic-pendingBg text-semantic-pending',
    draft: 'bg-semantic-draftBg text-semantic-draft',
  };
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide', tones[tone], className)}>
      {children}
    </span>
  );
}

const LIFECYCLE_TONES: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  DRAFT: 'draft', VALIDATED: 'info', IN_PROGRESS: 'pending', PARKED: 'warning', POSTED: 'success', PAID: 'success',
  OPEN: 'error', ASSIGNED: 'info', WAITING: 'warning', RESOLVED: 'success', CLOSED: 'neutral',
  PASS: 'success', WARNING: 'warning', FAIL: 'error', HARD_FAIL: 'error', PENDING: 'pending', OVERRIDDEN: 'warning', SKIPPED: 'neutral',
  ACTIVE: 'success', INACTIVE: 'neutral', TESTING: 'info', RETIRED: 'neutral',
  APPROVED: 'success', REJECTED: 'error', SENT_BACK: 'warning', ESCALATED: 'warning', DELEGATED: 'info',
  HIGH: 'error', CRITICAL: 'error', MEDIUM: 'warning', LOW: 'info', NORMAL: 'neutral', URGENT: 'error',
  QUEUED: 'pending', SENT: 'info', ACKNOWLEDGED: 'info', FAILED: 'error', DEAD_LETTER: 'error', COMPLETED: 'success', RUNNING: 'pending', RETRYING: 'warning',
  CONNECTED: 'success', DEGRADED: 'warning', UNAVAILABLE: 'error',
  AVAILABLE: 'success', MISSING: 'error', SUPERSEDED: 'neutral',
  PROCESSED: 'success', PROCESSING: 'pending', NEW: 'info', ERROR: 'error', IGNORED: 'neutral',
  MANDATORY: 'error', OPTIONAL: 'neutral', CONDITIONAL: 'warning',
  'IN_PROGRESS_EXC': 'pending',
  SUCCESS: 'success', DENIED: 'error', FAILURE: 'error',
  EMAIL: 'info', SHAREPOINT: 'pending', MANUAL_UPLOAD: 'neutral',
  REVIEW: 'warning', CORRECTED: 'info', ACCEPTED: 'success', VALID: 'success', INVALID: 'error', NOT_REQUIRED: 'neutral',
  MATCHED: 'success', MISMATCH: 'error', CAPTURED: 'info', AWAITING_SAP: 'pending', NOT_EXTRACTED: 'neutral',
};

export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  return <Badge tone={LIFECYCLE_TONES[value] ?? 'neutral'}>{label ?? value.replace(/_/g, ' ')}</Badge>;
}

export function ConfidenceBadge({ band, value }: { band?: string; value?: number }) {
  const tone = band === 'HIGH' ? 'success' : band === 'MEDIUM' ? 'warning' : 'error';
  return (
    <Badge tone={tone}>
      {band ?? '—'}{value != null ? ` ${(value * 100).toFixed(0)}%` : ''}
    </Badge>
  );
}

// ---------------------------------------------------------------- Inputs
export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'h-9 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm placeholder:text-ink-faint',
        'focus:border-essa-500 focus:outline-none focus:ring-2 focus:ring-essa-100 disabled:bg-line-soft',
        className
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        'w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm placeholder:text-ink-faint',
        'focus:border-essa-500 focus:outline-none focus:ring-2 focus:ring-essa-100',
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'h-9 rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink',
        'focus:border-essa-500 focus:outline-none focus:ring-2 focus:ring-essa-100 disabled:bg-line-soft',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, required, children, hint }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-secondary">
        {label} {required && <span className="text-semantic-error">*</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-2xs text-ink-muted">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs({
  tabs,
  active,
  onChange,
  counts,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  counts?: Record<string, number | undefined>;
}) {
  return (
    <div role="tablist" className="flex gap-0.5 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition-colors',
            active === t.key
              ? 'border-essa-600 text-essa-700'
              : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'
          )}
        >
          {t.label}
          {counts?.[t.key] != null && counts[t.key]! > 0 && (
            <span className={clsx('ml-1.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold', active === t.key ? 'bg-essa-100 text-essa-700' : 'bg-line-soft text-ink-muted')}>
              {counts[t.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Page furniture
export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-ink-muted">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-ink-faint" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-essa-700 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-ink-secondary">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
}: {
  breadcrumb: { label: string; to?: string }[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <Breadcrumb items={breadcrumb} />
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {description && <p className="mt-0.5 max-w-3xl text-xs text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('rounded-lg border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </header>
      )}
      {/* flex-1/min-h-0 are inert unless the card is made a flex column via
          className="flex flex-col" — then the body fills the card's height. */}
      <div className={clsx('min-h-0 flex-1', pad && 'p-4')}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- Table
export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sortBy,
  sortDir,
  onSort,
  loading,
  empty,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  loading?: boolean;
  empty?: ReactNode;
  dense?: boolean;
}) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-essa-600 text-white">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={clsx('whitespace-nowrap px-3 py-2 text-xs font-semibold', c.className, c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.sortable && onSort && 'cursor-pointer select-none hover:bg-essa-700')}
                onClick={c.sortable && onSort ? () => onSort(c.key) : undefined}
                aria-sort={sortBy === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.header}
                {c.sortable && sortBy === c.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-ink-muted">
                <Loader2 size={20} className="mx-auto animate-spin text-essa-600" />
                <span className="mt-2 block text-xs">Loading…</span>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty ?? <EmptyState title="No records" />}</td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  'border-b border-line-soft transition-colors',
                  i % 2 === 1 && 'bg-canvas/60',
                  onRowClick && 'cursor-pointer hover:bg-essa-50'
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-3 align-middle', dense ? 'py-1.5' : 'py-2', c.className, c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-3 py-2 text-xs text-ink-muted">
      <span>
        Showing {from}–{to} of {total.toLocaleString('en-IN')} entries
      </span>
      <div className="flex items-center gap-1">
        {onPageSize && (
          <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="mr-2 !h-7 !text-xs" aria-label="Rows per page">
            {[10, 25, 50, 100].map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </Select>
        )}
        <button aria-label="First page" className="rounded border border-line p-1 hover:bg-line-soft disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(1)}>
          <ChevronsLeft size={14} />
        </button>
        <button aria-label="Previous page" className="rounded border border-line p-1 hover:bg-line-soft disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} />
        </button>
        <span className="mx-2 font-medium text-ink">
          {page} / {totalPages}
        </span>
        <button aria-label="Next page" className="rounded border border-line p-1 hover:bg-line-soft disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={14} />
        </button>
        <button aria-label="Last page" className="rounded border border-line p-1 hover:bg-line-soft disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(totalPages)}>
          <ChevronsRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- states
export function EmptyState({ title, hint, icon, action }: { title: string; hint?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <span className="text-ink-faint">{icon ?? <Inbox size={28} />}</span>
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function NoResults({ query }: { query?: string }) {
  return <EmptyState icon={<SearchX size={28} />} title="No matching results" hint={query ? `Nothing matched "${query}". Try adjusting the filters or search terms.` : 'Try adjusting the filters or search terms.'} />;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-ink-muted">
      <Loader2 size={22} className="animate-spin text-essa-600" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function ErrorState({ message, correlationId, onRetry }: { message?: string; correlationId?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <XCircle size={26} className="text-semantic-error" />
      <p className="text-sm font-medium text-ink">Something went wrong</p>
      <p className="max-w-md text-xs text-ink-muted">{message ?? 'The request could not be completed.'}</p>
      {correlationId && <p className="text-2xs text-ink-faint">Correlation ID: {correlationId}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function NoPermission() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <ShieldAlert size={30} className="text-semantic-warning" />
      <p className="text-base font-semibold text-ink">Access denied</p>
      <p className="max-w-md text-xs text-ink-muted">
        You do not have permission to view this area. If you believe this is incorrect, contact your ESSA administrator to review your role assignment.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Modal / Drawer
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={clsx('flex max-h-[90vh] w-full flex-col rounded-lg bg-white shadow-pop', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-ink-muted hover:bg-line-soft">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('flex h-full w-full flex-col bg-white shadow-pop', width)}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close panel" className="rounded p-1 text-ink-muted hover:bg-line-soft">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  requireReason,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'warning';
  requireReason?: string;
  loading?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'primary'}
            loading={loading}
            disabled={Boolean(requireReason) && !reason.trim()}
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-secondary">
        <div>{message}</div>
        {requireReason && (
          <Field label={requireReason} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Provide a reason (recorded in the audit trail)" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Toast
interface ToastItem {
  id: number;
  tone: 'success' | 'error' | 'info' | 'warning';
  title: string;
  detail?: string;
}
const ToastContext = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = (t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 5200);
  };
  const icons = {
    success: <CheckCircle2 size={16} className="text-semantic-success" />,
    error: <XCircle size={16} className="text-semantic-error" />,
    warning: <AlertTriangle size={16} className="text-semantic-warning" />,
    info: <Info size={16} className="text-semantic-info" />,
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-white p-3 shadow-pop">
            {icons[t.tone]}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink">{t.title}</p>
              {t.detail && <p className="mt-0.5 break-words text-2xs text-ink-muted">{t.detail}</p>}
            </div>
            <button onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))} aria-label="Dismiss notification" className="text-ink-faint hover:text-ink">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------- misc
export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function ProgressBar({ value, tone = 'success' }: { value: number; tone?: 'success' | 'warning' | 'error' }) {
  const colors = { success: 'bg-essa-500', warning: 'bg-amber-500', error: 'bg-red-500' };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-all', colors[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
