/**
 * Audit Log — built to the design reference supplied on 24 Aug 2026.
 *
 *  · Filter bar: Search · Object Type · Action · Source · Result · Date Range,
 *    with an explicit Apply Filters and a Reset. Every filter is named after the
 *    column it filters and offers exactly the values that appear in it.
 *  · Columns: Timestamp · Object Type · Object ID · Action · User · Source ·
 *    Result · Correlation ID.
 *  · Expanding a row shows the record in two columns — what changed on the left
 *    (Field / Before / After, or the context for that kind of activity) and who,
 *    why and exactly when on the right — followed by one plain-language
 *    sentence describing the record, so it can be read without decoding it.
 *  · Its own top-level destination — it covers every transaction on the
 *    platform, not only what is configured under Administration. AUDIT_VIEW is
 *    held by the Administrator only.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Info, ListFilter, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '@/lib/api';
import { displayRole, fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { Badge, Button, Card, Input, LoadingState, NoResults, PageHeader, Pagination, Select } from '@/components/ui';

interface AuditDetail { label: string; value: string }

interface AuditRow {
  id: string; eventTime: string; actorType: string; actorName: string; actorRole?: string; eventType: string;
  category: string; action: string; module: string; entityType: string; entityId: string; entityRef?: string;
  invoiceId?: string; result: string; reason?: string; details?: AuditDetail[];
  oldValue?: unknown; newValue?: unknown; correlationId: string; source: string;
}

interface Facets { objectTypes: string[]; actions: string[]; sources: string[]; results: string[]; users: string[] }

interface AuditResponse {
  items: AuditRow[]; page: number; pageSize: number; total: number; totalPages: number; facets?: Facets;
}

/** The filters that live in the URL, in the order the filter bar shows them. */
const FILTER_KEYS = ['search', 'entityType', 'eventType', 'source', 'result', 'dateFrom', 'dateTo'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Draft = Record<FilterKey, string>;
const EMPTY_DRAFT: Draft = { search: '', entityType: '', eventType: '', source: '', result: '', dateFrom: '', dateTo: '' };

// --- values -------------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Field keys become the names a person would recognise. */
const FIELD_LABEL: Record<string, string> = {
  roleIds: 'Roles', roleNames: 'Roles', enabled: 'Status', status: 'Status',
  slaDueAt: 'SLA due', poNumber: 'PO number', invoiceNumber: 'Invoice number',
  processingFlag: 'Processing state', lifecycle: 'Lifecycle state', value: 'Value',
};

function fieldLabel(key: string): string {
  if (FIELD_LABEL[key]) return FIELD_LABEL[key];
  if (/\s/.test(key)) return key; // already a human label, e.g. "Invoice Amount"
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return fmtNumber(v, 2);
  if (Array.isArray(v)) return v.length ? v.map(fmtValue).join(', ') : '—';
  if (isPlainObject(v)) return Object.entries(v).map(([k, val]) => `${fieldLabel(k)}: ${fmtValue(val)}`).join(' · ');
  const s = String(v);
  return ISO_DATE.test(s) ? fmtDateTime(s) : s;
}

interface Change { field: string; before: string; after: string }

/** The fields whose values this record changed. */
function changesOf(a: AuditRow): Change[] {
  if (a.oldValue == null && a.newValue == null) return [];
  const wrap = (v: unknown) => (isPlainObject(v) ? v : v == null ? {} : { Value: v });
  const before = wrap(a.oldValue);
  const after = wrap(a.newValue);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((k) => ({ field: fieldLabel(k), before: fmtValue(before[k]), after: fmtValue(after[k]) }))
    .filter((c) => c.before !== c.after);
}

/** Date and time to the second, for the expanded record: 24-Aug-2026 12:30:14. */
function fmtExactTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  return `${date} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

/** What is shown on the left of an expanded record. */
function leftPairs(a: AuditRow): AuditDetail[] {
  const changes = changesOf(a);
  const pairs: AuditDetail[] = [];
  if (changes.length === 1) {
    pairs.push(
      { label: 'Field', value: changes[0].field },
      { label: 'Before', value: changes[0].before },
      { label: 'After', value: changes[0].after },
    );
  } else if (changes.length > 1) {
    changes.forEach((c) => pairs.push({ label: c.field, value: `${c.before}  →  ${c.after}` }));
  }
  (a.details ?? []).forEach((d) => pairs.push(d));
  return pairs;
}

// --- the plain-language sentence ---------------------------------------------

const RESULT_PHRASE: Record<string, string> = {
  SUCCESS: 'the action was successful',
  PASS: 'every check passed',
  FAIL: 'the check did not pass',
  OVERRIDDEN: 'the result was overridden',
  REJECTED: 'the decision was recorded',
  DENIED: 'the action was refused',
};

const ACTION_PHRASE: Record<string, string> = {
  LOGIN_SUCCESS: 'signed in',
  LOGIN_FAILED: 'tried to sign in',
  LOGOUT: 'signed out',
  APPROVAL_APPROVED: 'approved',
  APPROVAL_REJECTED: 'rejected',
  APPROVAL_SENT_BACK: 'sent back',
  DOCUMENT_UPLOAD: 'uploaded a document for',
  DOCUMENT_REPLACED: 'replaced a document on',
  EXCEPTION_CREATED: 'raised an exception on',
  EXCEPTION_OVERRIDE: 'overrode an exception on',
  EXCEPTION_RESOLVE: 'resolved an exception on',
  VALIDATION_COMPLETED: 'completed validation for',
  VALIDATION_OVERRIDDEN: 'overrode a validation check on',
  EXTRACTION_COMPLETED: 'completed invoice extraction for',
  INVOICE_RECEIVED: 'received',
  CONFIG_PUBLISHED: 'published',
  CONFIG_DRAFT_CREATED: 'created',
  USER_DISABLED: 'disabled',
  USER_ENABLED: 'enabled',
  ROLE_ASSIGNED: 'changed the roles of',
  VENDOR_NEGATIVE_MARKED: 'marked a negative flag on',
};

const sentence = (parts: string[]) => `${parts.join(' ')}.`;

/** One sentence describing the record, so it reads without being decoded. */
function summaryOf(a: AuditRow): string {
  const who = a.actorType === 'USER' ? a.actorName : `the ${a.actorName}`;
  const sourceName = a.source.charAt(0) + a.source.slice(1).toLowerCase();
  const where = a.source === 'SYSTEM' ? 'automatically through the system' : `through the ${sourceName}`;
  const outcome = RESULT_PHRASE[a.result] ?? 'the action was recorded';
  const ref = a.entityRef ?? a.entityId;
  const object = a.entityType === 'INVOICE' ? `invoice ${ref}` : `${a.entityType.replace(/_/g, ' ').toLowerCase()} ${ref}`;

  const changes = changesOf(a);
  if (a.eventType === 'CORRECT' && changes.length === 1) {
    const c = changes[0];
    return sentence(['This record shows that', who, 'corrected the', c.field, 'for invoice', ref,
      'from', c.before, 'to', c.after, where + ',', 'and the change was successful']);
  }
  const verb = ACTION_PHRASE[a.eventType];
  if (verb) {
    return sentence(['This record shows that', who, verb, object, where + ',', 'and', outcome]);
  }
  return sentence(['This record shows', a.eventType.replace(/_/g, ' ').toLowerCase(), 'on', object, 'by', who,
    where + ',', 'and', outcome]);
}

// --- badges -------------------------------------------------------------------

const RESULT_TONE: Record<string, 'success' | 'error' | 'info' | 'warning' | 'neutral'> = {
  SUCCESS: 'success', PASS: 'success',
  FAIL: 'error', DENIED: 'error',
  OVERRIDDEN: 'info', REJECTED: 'warning', WARNING: 'warning',
};

function FilterField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-2xs font-semibold text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

function Pair({ label, value }: AuditDetail) {
  return (
    <div className="flex gap-3 py-0.5">
      <dt className="w-36 shrink-0 text-2xs text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-2xs font-medium text-ink">{value}</dd>
    </div>
  );
}

export default function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  // The filter bar is applied on demand (design reference), so the controls hold
  // a draft until Apply Filters moves it into the URL and re-queries.
  const applied = useMemo<Draft>(() => {
    const d = { ...EMPTY_DRAFT };
    FILTER_KEYS.forEach((k) => { d[k] = params.get(k) ?? ''; });
    return d;
  }, [params]);
  const [draft, setDraft] = useState<Draft>(applied);
  useEffect(() => setDraft(applied), [applied]);

  const setDraftValue = (key: FilterKey, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const apply = () => {
    const next = new URLSearchParams(params);
    FILTER_KEYS.forEach((k) => (draft[k] ? next.set(k, draft[k]) : next.delete(k)));
    next.delete('page');
    setParams(next, { replace: true });
  };
  const reset = () => setParams(new URLSearchParams(), { replace: true });

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const obj: Record<string, string> = {};
    params.forEach((v, k) => (obj[k] = v));
    return obj;
  }, [params]);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.get<AuditResponse>(`/audit${qs({ pageSize: 10, ...query })}`),
  });

  const facets = data?.facets;
  const dirty = FILTER_KEYS.some((k) => draft[k] !== applied[k]);
  const hasFilters = FILTER_KEYS.some((k) => applied[k]) || dirty;

  const sortDir = params.get('sortDir') ?? 'desc';
  const toggleTimeSort = () => {
    const next = new URLSearchParams(params);
    next.set('sortBy', 'eventTime');
    next.set('sortDir', sortDir === 'asc' ? 'desc' : 'asc');
    next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Audit Log' }]}
        title="Audit Log"
        description="Every transaction on the platform is recorded for accountability and transparency. Records cannot be edited or deleted."
      />

      <Card pad={false}>
        {/* ------------------------------------------------------- filter bar */}
        <form
          className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3"
          onSubmit={(e) => { e.preventDefault(); apply(); }}
        >
          <FilterField label="Search" className="min-w-44 grow basis-44">
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input
                value={draft.search}
                onChange={(e) => setDraftValue('search', e.target.value)}
                placeholder="Search by keyword, ID, user…"
                className="w-full pl-8"
                aria-label="Search the audit log"
              />
            </span>
          </FilterField>

          <FilterField label="Object Type">
            <Select value={draft.entityType} onChange={(e) => setDraftValue('entityType', e.target.value)} aria-label="Object type filter" className="w-36">
              <option value="">All</option>
              {(facets?.objectTypes ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </FilterField>

          <FilterField label="Action">
            <Select value={draft.eventType} onChange={(e) => setDraftValue('eventType', e.target.value)} aria-label="Action filter" className="w-44">
              <option value="">All</option>
              {(facets?.actions ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </FilterField>

          <FilterField label="Source">
            <Select value={draft.source} onChange={(e) => setDraftValue('source', e.target.value)} aria-label="Source filter" className="w-28">
              <option value="">All</option>
              {(facets?.sources ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </FilterField>

          <FilterField label="Result">
            <Select value={draft.result} onChange={(e) => setDraftValue('result', e.target.value)} aria-label="Result filter" className="w-28">
              <option value="">All</option>
              {(facets?.results ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </FilterField>

          <FilterField label="Date Range">
            <span className="flex items-center gap-1.5 text-2xs text-ink-muted">
              <Input type="date" className="!h-9 w-32" value={draft.dateFrom} onChange={(e) => setDraftValue('dateFrom', e.target.value)} aria-label="From date" />
              –
              <Input type="date" className="!h-9 w-32" value={draft.dateTo} onChange={(e) => setDraftValue('dateTo', e.target.value)} aria-label="To date" />
            </span>
          </FilterField>

          <span className="ml-auto flex items-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={!hasFilters}>
              <RotateCcw size={13} /> Reset
            </Button>
            <Button type="submit" size="sm">
              <ListFilter size={13} /> Apply Filters
            </Button>
          </span>
        </form>

        {/* ----------------------------------------------------------- table */}
        {isLoading ? (
          <LoadingState />
        ) : !data?.items.length ? (
          <NoResults query={applied.search || undefined} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-essa-600 text-white">
                  <th className="w-8 px-2 py-2" aria-label="Expand" />
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold" aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}>
                    <button onClick={toggleTimeSort} className="inline-flex items-center gap-1.5 hover:underline" aria-label="Sort by timestamp">
                      Timestamp
                      {sortDir === 'asc'
                        ? <ArrowUp size={13} className="shrink-0 text-white" aria-hidden />
                        : <ArrowDown size={13} className="shrink-0 text-white" aria-hidden />}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">Object Type</th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">Object ID</th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">Action</th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">User</th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">Source</th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">Result</th>
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-bold">Correlation ID</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => {
                  const open = expanded === a.id;
                  const pairs = leftPairs(a);
                  return (
                    <Fragment key={a.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : a.id)}
                        className={clsx(
                          'cursor-pointer border-b border-line-soft transition-colors hover:bg-essa-50',
                          open && 'bg-essa-50'
                        )}
                      >
                        <td className="px-2 py-2 text-ink-faint">
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-2xs text-ink-secondary">{fmtDateTime(a.eventTime)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-2xs font-semibold text-ink-secondary">{a.entityType}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-2xs">
                          {a.invoiceId ? (
                            <Link to={`/invoices/${a.invoiceId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-essa-700 hover:underline">
                              {a.entityId}
                            </Link>
                          ) : <span className="font-medium">{a.entityId}</span>}
                          {a.entityRef && a.entityRef !== a.entityId && (
                            <span className="block text-2xs font-normal text-ink-faint">{a.entityRef}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-2xs font-medium">{a.eventType}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-2xs">{a.actorName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-2xs text-ink-secondary">{a.source}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Badge tone={RESULT_TONE[a.result] ?? 'neutral'}>{a.result}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-2xs text-ink-muted">{a.correlationId}</td>
                      </tr>

                      {open && (
                        <tr className="border-b border-line-soft bg-essa-50/40">
                          <td colSpan={9} className="px-5 pb-4 pt-1">
                            <div className="rounded-lg border border-line bg-surface p-3.5">
                              <dl className="grid gap-x-8 gap-y-0.5 md:grid-cols-2">
                                <div>
                                  {pairs.length
                                    ? pairs.map((p) => <Pair key={p.label + p.value} {...p} />)
                                    : <p className="py-0.5 text-2xs text-ink-faint">No field values changed in this activity.</p>}
                                </div>
                                <div>
                                  <Pair label="Role" value={a.actorType === 'USER' ? displayRole(a.actorRole) : 'System'} />
                                  <Pair label="Reason" value={a.reason ?? 'Not recorded'} />
                                  <Pair label="Time" value={fmtExactTime(a.eventTime)} />
                                </div>
                              </dl>
                              <p className="mt-3 flex items-start gap-2 rounded-md border border-essa-100 bg-essa-50 px-2.5 py-2 text-2xs text-ink-secondary">
                                <Info size={13} className="mt-px shrink-0 text-essa-600" />
                                <span>{summaryOf(a)}</span>
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            unit="records"
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(s) => setParam('pageSize', String(s))}
          />
        )}
      </Card>

      <p className="flex items-center gap-1.5 px-1 text-2xs text-ink-muted">
        <ShieldCheck size={12} className="text-essa-600" />
        Audit records are written once and can never be edited or deleted.
        {applied.dateFrom || applied.dateTo ? ` Showing ${applied.dateFrom ? fmtDate(applied.dateFrom) : 'the beginning'} to ${applied.dateTo ? fmtDate(applied.dateTo) : 'today'}.` : ''}
      </p>
    </div>
  );
}
