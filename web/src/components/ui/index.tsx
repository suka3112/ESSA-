/**
 * ESSA design system - core reusable components.
 * Visual language follows the ESSA enterprise reference: white surfaces,
 * green primary, subtle borders, dense-but-readable tables.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, ChevronsUpDown, Info, Loader2, SearchX, ShieldAlert, X, XCircle, Inbox } from 'lucide-react';
import { STATUS_TIP, statusTone, type InvoiceStatusLabel } from '@/lib/format';

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

/**
 * Free-text input with a hard character limit and a live counter.
 *
 * Review, 24 Aug (Pranay): every remarks box must stop the user at the column
 * length the database allows, and show the count while they type. 200 is the
 * platform default.
 */
export function Textarea({
  className,
  maxLength = 200,
  showCount = true,
  value,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { showCount?: boolean }) {
  const used = typeof value === 'string' ? value.length : 0;
  return (
    <span className="block">
      <textarea
        value={value}
        maxLength={maxLength}
        className={clsx(
          'w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm placeholder:text-ink-faint',
          'focus:border-essa-500 focus:outline-none focus:ring-2 focus:ring-essa-100',
          className
        )}
        {...rest}
      />
      {showCount && maxLength ? (
        <span className={clsx('mt-0.5 block text-right text-2xs', used >= maxLength ? 'font-semibold text-semantic-warning' : 'text-ink-muted')}>
          {used} / {maxLength} characters
        </span>
      ) : null}
    </span>
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
      <span className="mb-1 block text-xs font-semibold text-ink">
        {label} {required && <span className="text-semantic-error">*</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-2xs text-ink-muted">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- Tabs

/**
 * Single-row horizontal tab strip. Tabs never wrap: when they overflow the
 * container, left/right chevron buttons appear so the user can scroll the
 * hidden tabs into view (buttons show only on the side that has more content).
 */
export function ScrollTabs({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  // Re-measure on every render (tab counts/labels change) + container resize.
  useEffect(update);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: 'smooth' });
  };

  return (
    <div className={clsx('relative min-w-0', className)}>
      {canLeft && (
        <button
          type="button"
          aria-label="Scroll tabs left"
          onClick={() => nudge(-1)}
          className="absolute bottom-0 left-0 top-0 z-10 flex items-center bg-gradient-to-r from-white via-white/95 to-transparent pl-0.5 pr-4 text-ink-muted hover:text-essa-700"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <div ref={ref} className="scrollbar-none flex min-w-0 flex-nowrap overflow-x-auto">
        {children}
      </div>
      {canRight && (
        <button
          type="button"
          aria-label="Scroll tabs right"
          onClick={() => nudge(1)}
          className="absolute bottom-0 right-0 top-0 z-10 flex items-center bg-gradient-to-l from-white via-white/95 to-transparent pl-4 pr-0.5 text-ink-muted hover:text-essa-700"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  counts,
  actions,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  counts?: Record<string, number | undefined>;
  /** Sits at the right end of the tab row — e.g. the invoice's current status. */
  actions?: ReactNode;
}) {
  const tabRow = (
    <ScrollTabs className={clsx('border-b border-line', actions && 'flex-1')}>
      <div role="tablist" className="flex flex-nowrap gap-0.5">
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
    </ScrollTabs>
  );

  if (!actions) return tabRow;
  return (
    <div className="flex items-end gap-3">
      {tabRow}
      <div className="flex shrink-0 items-center gap-2 self-stretch border-b border-line pb-2 pt-2">{actions}</div>
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
  // Tight header (design review): minimal whitespace around the breadcrumb
  // bar so more content is visible above the fold.
  return (
    <div className="mb-2">
      <Breadcrumb items={breadcrumb} />
      <div className="mt-0.5 flex flex-wrap items-start justify-between gap-3">
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
    <section className={clsx('rounded-xl border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
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
  /** Pins the column to the right edge so it stays visible while the table scrolls horizontally. */
  sticky?: boolean;
  /**
   * Plain value behind the cell, used when the table sorts on the client.
   * Defaults to row[key]. Give it whenever the cell renders markup.
   */
  value?: (row: T) => string | number | null | undefined;
}

/**
 * The one table in the product.
 *
 * Sorting and column filters are the enterprise standard here (Pranay, 24 Aug
 * review): every table gets both. A screen that fetches its own page from the
 * API passes `onSort` and drives it server-side; every other screen leaves it
 * out and the table sorts and filters its rows itself.
 */
/**
 * The sort indicator sits on the solid green header, so it is drawn as a real
 * icon in white rather than a faint text glyph — visible whether or not the
 * column is the one being sorted (review, 24 Aug).
 *
 * Three states (review, 25 Aug): the double chevron means the column is not
 * sorting, and is what the header returns to on the third click.
 */
function SortIcon({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown size={12} className="shrink-0 text-white/75" aria-hidden />;
  return dir === 'asc'
    ? <ArrowUp size={12} className="shrink-0 text-white" aria-hidden />
    : <ArrowDown size={12} className="shrink-0 text-white" aria-hidden />;
}

/**
 * Ascending → descending → off. Clicking a different column always starts that
 * column at ascending.
 */
export function nextSortDir(
  activeKey: string | undefined,
  activeDir: 'asc' | 'desc' | undefined,
  key: string
): 'asc' | 'desc' | null {
  if (activeKey !== key) return 'asc';
  if (activeDir === 'asc') return 'desc';
  if (activeDir === 'desc') return null;
  return 'asc';
}

const SORT_HINT: Record<string, string> = { asc: 'ascending', desc: 'descending' };

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
  stickyHeader,
  maxBodyHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /**
   * Server-driven sorting. `dir` is the state the header has just moved to:
   * null means the column was switched off and the screen should fall back to
   * its own default order.
   */
  onSort?: (key: string, dir: 'asc' | 'desc' | null) => void;
  loading?: boolean;
  empty?: ReactNode;
  dense?: boolean;
  /** Freeze the header row (Excel-style): the body scrolls inside maxBodyHeight while the header stays visible. */
  stickyHeader?: boolean;
  maxBodyHeight?: string;
}) {
  const serverDriven = Boolean(onSort);
  const [localSort, setLocalSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const cellValue = (c: Column<T>, row: T): string | number | null | undefined =>
    c.value ? c.value(row) : (row as unknown as Record<string, string | number | null | undefined>)[c.key];

  // Review, 24 Aug: column headers carry sorting only — filtering belongs in the
  // filter bar above the table, so a header never holds two controls.
  let view = rows;
  if (!serverDriven && localSort) {
    const col = columns.find((c) => c.key === localSort.key);
    if (col) {
      view = [...view].sort((a, b) => {
        const av = cellValue(col, a);
        const bv = cellValue(col, b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return localSort.dir === 'asc' ? cmp : -cmp;
      });
    }
  }

  const activeSortKey = serverDriven ? sortBy : localSort?.key;
  const activeSortDir = serverDriven ? sortDir : localSort?.dir;
  /**
   * Three-state header (review, 25 Aug): ascending, descending, then back to
   * the table's own order so a reader can undo a sort without reloading.
   */
  const handleSort = (key: string) => {
    const dir = nextSortDir(activeSortKey, activeSortDir, key);
    if (serverDriven) return onSort!(key, dir);
    setLocalSort(dir ? { key, dir } : null);
  };

  return (
    <div
      className={clsx('overflow-x-auto scrollbar-thin', stickyHeader && 'overflow-y-auto')}
      style={stickyHeader ? { maxHeight: maxBodyHeight ?? '62vh' } : undefined}
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-essa-600 text-white">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={clsx(
                  'whitespace-nowrap px-3 py-2 text-sm font-bold',
                  stickyHeader && 'sticky top-0 z-30 bg-essa-600',
                  c.className,
                  c.align === 'right' && 'text-right',
                  c.align === 'center' && 'text-center',
                  c.sortable && 'select-none',
                  c.sticky && 'sticky right-0 z-20 bg-essa-600 shadow-[-6px_0_6px_-6px_rgba(16,24,40,0.25)]'
                )}
                aria-sort={
                  !c.sortable ? undefined
                    : activeSortKey === c.key ? (activeSortDir === 'asc' ? 'ascending' : 'descending')
                    : 'none'
                }
              >
                <span className={clsx('inline-flex items-center', c.align === 'right' && 'justify-end', c.align === 'center' && 'justify-center')}>
                  {c.sortable ? (
                    (() => {
                      const label = typeof c.header === 'string' ? c.header : c.key;
                      const next = nextSortDir(activeSortKey, activeSortDir, c.key);
                      const hint = next ? `Sort by ${label}, ${SORT_HINT[next]}` : `Stop sorting by ${label}`;
                      return (
                        <button
                          type="button"
                          onClick={() => handleSort(c.key)}
                          className="inline-flex items-center gap-1 text-left hover:underline"
                          title={hint}
                          aria-label={hint}
                        >
                          {c.header}
                          <SortIcon active={activeSortKey === c.key} dir={activeSortDir} />
                        </button>
                      );
                    })()
                  ) : (
                    c.header
                  )}
                </span>
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
          ) : view.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty ?? <EmptyState title="No records" />}</td>
            </tr>
          ) : (
            view.map((row, i) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  'group border-b border-line-soft transition-colors',
                  i % 2 === 1 && 'bg-canvas/60',
                  onRowClick && 'cursor-pointer hover:bg-essa-50'
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      'px-3 align-middle',
                      dense ? 'py-1.5' : 'py-2',
                      c.className,
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center',
                      // Sticky cells sit outside the row's own background, so they carry their
                      // own zebra + hover fill to stay opaque over the scrolling content.
                      c.sticky && 'sticky right-0 z-10 shadow-[-6px_0_6px_-6px_rgba(16,24,40,0.18)]',
                      c.sticky && (i % 2 === 1 ? 'bg-[#fafbfa]' : 'bg-surface'),
                      c.sticky && onRowClick && 'group-hover:bg-essa-50'
                    )}
                  >
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

/**
 * Page numbers, not just arrows (design reference, 24 Aug): the run of pages is
 * windowed around the current one with an ellipsis, so page 1 and the last page
 * are always reachable however many pages there are.
 */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | 'gap')[] = [1];
  const from = Math.max(2, Math.min(page - 1, totalPages - 4));
  const to = Math.min(totalPages - 1, Math.max(page + 1, 5));
  if (from > 2) out.push('gap');
  for (let n = from; n <= to; n += 1) out.push(n);
  if (to < totalPages - 1) out.push('gap');
  out.push(totalPages);
  return out;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
  unit = 'entries',
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
  /** What is being counted — "entries" by default, "records" in the Audit Log. */
  unit?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = pageWindow(page, Math.max(1, totalPages));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-3 py-2 text-xs text-ink-muted">
      <span>
        Showing {from} to {to} of {total.toLocaleString('en-US')} {unit}
      </span>
      <div className="flex items-center gap-1">
        <button aria-label="Previous page" className="rounded border border-line p-1 hover:bg-line-soft disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} />
        </button>
        {pages.map((n, i) =>
          n === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-ink-faint">…</span>
          ) : (
            <button
              key={n}
              aria-label={`Page ${n}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
              className={clsx(
                'min-w-[26px] rounded border px-1.5 py-0.5 text-xs font-medium transition-colors',
                n === page
                  ? 'border-essa-600 bg-essa-600 text-white'
                  : 'border-line text-ink-secondary hover:bg-line-soft'
              )}
            >
              {n}
            </button>
          )
        )}
        <button aria-label="Next page" className="rounded border border-line p-1 hover:bg-line-soft disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={14} />
        </button>
        {onPageSize && (
          <span className="ml-3 flex items-center gap-1.5">
            <span className="whitespace-nowrap">Rows per page</span>
            <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="!h-7 !w-16 !text-xs" aria-label="Rows per page">
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </span>
        )}
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

/**
 * Info tooltip for business metrics (design-review rule: every KPI explains
 * its meaning, formula and the action the user should take).
 */
export function InfoTip({ title, meaning, formula, action, className }: { title?: string; meaning: string; formula?: string; action?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={clsx('relative inline-flex', className)}>
      <button
        type="button"
        aria-label={`About ${title ?? 'this metric'}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        /* The colour is fully replaced when a caller passes one, so the icon
           stays readable on the filled green cards and headers. */
        className={clsx('transition-colors', className ? 'hover:opacity-80' : 'text-ink-faint hover:text-essa-700')}
      >
        <Info size={13} strokeWidth={2.25} />
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-40 mt-1.5 w-60 -translate-x-1/2 rounded-lg border border-line bg-white p-2.5 text-left shadow-pop">
          {title && <span className="mb-1 block text-2xs font-bold uppercase tracking-wide text-ink">{title}</span>}
          <span className="block text-2xs leading-relaxed text-ink-secondary">{meaning}</span>
          {formula && (
            <span className="mt-1.5 block rounded bg-canvas px-1.5 py-1 font-mono text-2xs text-ink-muted">{formula}</span>
          )}
          {action && <span className="mt-1.5 block text-2xs text-essa-700">→ {action}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * Plain hover/focus tooltip — the one tooltip pattern for short explanations
 * that are not KPI metrics (status meanings, truncated cell text).
 */
export function Tooltip({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={clsx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && (
        <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-line bg-white p-2 text-left text-2xs leading-relaxed normal-case tracking-normal text-ink-secondary shadow-pop">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * THE invoice status badge. Current Status and Next Status everywhere in the
 * product render through this component so wording, colour and the explanatory
 * tooltip stay identical on every screen (review §14/§16).
 */
export function InvoiceStatusBadge({ status, muted }: { status: InvoiceStatusLabel; muted?: boolean }) {
  return (
    <Tooltip text={STATUS_TIP[status]}>
      <Badge tone={muted ? 'neutral' : statusTone(status)} className="whitespace-nowrap">{status}</Badge>
    </Tooltip>
  );
}

/** Value that is not available yet (e.g. before extraction completes). */
export function NotAvailable({ label = 'Not available' }: { label?: string }) {
  return <span className="text-2xs italic text-ink-faint">{label}</span>;
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</dt>
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
