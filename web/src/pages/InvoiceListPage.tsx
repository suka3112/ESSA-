import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Filter, Mail, RotateCcw, Search, Upload } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, fmtRelative, titleCase } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, DataTable, Input, NoResults, PageHeader, Pagination, Select, StatusBadge, useToast, type Column,
} from '@/components/ui';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  vendorCode: string;
  vendorName: string;
  categoryName: string;
  invoiceDate: string;
  amount: number;
  currency: string;
  poNumber?: string;
  department: string;
  receivedAt: string;
  stage: string;
  lifecycle: string;
  processingFlag: string | null;
  slaDueAt: string;
  slaBreached: boolean;
  assignedToName?: string;
  source: string;
  openExceptions: number;
  priority: string;
}

interface Lookups {
  categories: { id: string; name: string }[];
  departments: string[];
  users: { id: string; name: string; enabled: boolean }[];
  vendors: { code: string; name: string }[];
}

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [params, setParams] = useSearchParams();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchDraft, setSearchDraft] = useState(params.get('search') ?? '');
  const toast = useToast();
  const qc = useQueryClient();

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const obj: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k !== 'view') obj[k] = v; // 'view' is UI-only (workbench vs ingestion tab)
    });
    return obj;
  }, [params]);

  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', query],
    queryFn: () =>
      api.get<{ items: InvoiceRow[]; page: number; pageSize: number; total: number; totalPages: number }>(
        `/invoices${qs({ pageSize: 25, ...query })}`
      ),
  });

  const simulate = useMutation({
    mutationFn: () => api.post<{ invoiceNumber: string }>('/ingestion/email/simulate'),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: `Invoice ${r.invoiceNumber} created from mailbox`, detail: 'Watch it progress through classification → extraction → validation.' });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  const sortBy = params.get('sortBy') ?? 'receivedAt';
  const sortDir = (params.get('sortDir') as 'asc' | 'desc') ?? 'desc';
  const onSort = (key: string) => {
    if (sortBy === key) setParam('sortDir', sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setParam('sortBy', key);
      setParam('sortDir', 'asc');
    }
  };

  const columns: Column<InvoiceRow>[] = [
    {
      key: 'invoiceNumber', header: 'Invoice', sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium text-essa-700">{r.invoiceNumber}</p>
          <p className="text-2xs text-ink-faint">{r.id}</p>
        </div>
      ),
    },
    {
      key: 'vendorName', header: 'Vendor', sortable: true,
      render: (r) => (
        <div className="max-w-44">
          <p className="truncate">{r.vendorName}</p>
          <p className="text-2xs text-ink-faint">{r.vendorCode}</p>
        </div>
      ),
    },
    { key: 'categoryName', header: 'Category', render: (r) => <span className="text-xs">{r.categoryName}</span> },
    { key: 'invoiceDate', header: 'Inv. Date', sortable: true, render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.invoiceDate)}</span> },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', render: (r) => <span className="whitespace-nowrap font-medium">{fmtMoney(r.amount, r.currency)}</span> },
    { key: 'poNumber', header: 'PO', render: (r) => <span className="text-xs">{r.poNumber ?? '—'}</span> },
    { key: 'department', header: 'Department', render: (r) => <span className="text-xs">{r.department}</span> },
    { key: 'stage', header: 'Stage', render: (r) => <StatusBadge value={r.stage} /> },
    {
      key: 'lifecycle', header: 'Status',
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge value={r.lifecycle} />
          {r.processingFlag && <span className="text-2xs text-semantic-warning">{titleCase(r.processingFlag)}</span>}
        </div>
      ),
    },
    {
      key: 'slaDueAt', header: 'SLA', sortable: true,
      render: (r) =>
        ['POSTED', 'PAID'].includes(r.lifecycle) ? (
          <span className="text-2xs text-ink-faint">—</span>
        ) : r.slaBreached || new Date(r.slaDueAt) < new Date() ? (
          <Badge tone="error">Breached</Badge>
        ) : (
          <span className="whitespace-nowrap text-2xs text-ink-muted">due {fmtRelative(r.slaDueAt)}</span>
        ),
    },
    {
      key: 'assignedToName', header: 'Assigned To',
      render: (r) => <span className="text-xs">{r.assignedToName ?? <span className="text-ink-faint">Unassigned</span>}</span>,
    },
    {
      key: 'openExceptions', header: 'Exc.', align: 'center',
      render: (r) => (r.openExceptions ? <Badge tone="error">{r.openExceptions}</Badge> : <span className="text-ink-faint">0</span>),
    },
  ];

  const exportCsv = () => {
    if (!data) return;
    const header = 'Invoice ID,Invoice Number,Vendor,Category,Invoice Date,Amount,Currency,PO,Department,Stage,Status,Assigned To';
    const rows = data.items.map((r) =>
      [r.id, r.invoiceNumber, r.vendorName, r.categoryName, r.invoiceDate, r.amount, r.currency, r.poNumber ?? '', r.department, r.stage, r.lifecycle, r.assignedToName ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'essa-invoices.csv';
    a.click();
  };

  const activeFilterCount = ['lifecycle', 'stage', 'categoryId', 'vendorCode', 'department', 'assignedTo', 'processingFlag', 'slaBreached', 'hasExceptions', 'amountMin', 'amountMax', 'dateFrom', 'dateTo', 'source'].filter((k) => params.get(k)).length;

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoice Processing' }, { label: 'Invoices' }]}
        title="Invoice Workbench"
        description="All invoices across intake channels (AP mailbox, SharePoint monitor, manual upload) with lifecycle, stage, SLA and exception visibility."
        actions={
          <>
            {hasPerm('INVOICE_UPLOAD') && (
              <Button variant="ghost" size="sm" loading={simulate.isPending} onClick={() => simulate.mutate()}>
                <Mail size={14} /> Simulate vendor email
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download size={14} /> Export
            </Button>
            {hasPerm('INVOICE_UPLOAD') && (
              <Button size="sm" onClick={() => navigate('/invoices/upload')}>
                <Upload size={14} /> Upload Invoice
              </Button>
            )}
          </>
        }
      />

      <Card pad={false}>
        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setParam('search', searchDraft || undefined);
            }}
          >
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search invoice, vendor, PO, SAP doc…" className="w-64 pl-8" aria-label="Search invoices" />
          </form>
          <Select value={params.get('lifecycle') ?? ''} onChange={(e) => setParam('lifecycle', e.target.value || undefined)} aria-label="Status filter">
            <option value="">All statuses</option>
            {['DRAFT', 'VALIDATED', 'IN_PROGRESS', 'PARKED', 'POSTED', 'PAID'].map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </Select>
          <Select value={params.get('categoryId') ?? ''} onChange={(e) => setParam('categoryId', e.target.value || undefined)} aria-label="Category filter">
            <option value="">All categories</option>
            {lookups?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select value={params.get('vendorCode') ?? ''} onChange={(e) => setParam('vendorCode', e.target.value || undefined)} aria-label="Vendor filter">
            <option value="">All vendors</option>
            {lookups?.vendors.map((v) => (
              <option key={v.code} value={v.code}>{v.name}</option>
            ))}
          </Select>
          <Select value={params.get('source') ?? ''} onChange={(e) => setParam('source', e.target.value || undefined)} aria-label="Intake channel filter">
            <option value="">All intake channels</option>
            <option value="EMAIL">AP Mailbox</option>
            <option value="SHAREPOINT">SharePoint Monitor</option>
            <option value="MANUAL_UPLOAD">Manual Upload</option>
          </Select>
          <Button variant={showAdvanced || activeFilterCount > 2 ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowAdvanced((s) => !s)}>
            <Filter size={13} /> Advanced {activeFilterCount > 0 && `(${activeFilterCount})`}
          </Button>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost" size="sm"
              onClick={() => {
                setSearchDraft('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              <RotateCcw size={13} /> Reset
            </Button>
          )}
        </div>
        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2 border-b border-line-soft bg-canvas p-3 md:grid-cols-4 xl:grid-cols-6">
            <Select value={params.get('stage') ?? ''} onChange={(e) => setParam('stage', e.target.value || undefined)} aria-label="Stage filter">
              <option value="">All stages</option>
              {['RECEIVED', 'CLASSIFICATION', 'COMPLETENESS', 'EXTRACTION', 'EXTRACTION_REVIEW', 'VALIDATION', 'EXCEPTION', 'APPROVAL', 'TAX_REVIEW', 'SAP_HANDOFF', 'SAP_PROCESSING', 'COMPLETED'].map((s) => (
                <option key={s} value={s}>{titleCase(s)}</option>
              ))}
            </Select>
            <Select value={params.get('department') ?? ''} onChange={(e) => setParam('department', e.target.value || undefined)} aria-label="Department filter">
              <option value="">All departments</option>
              {lookups?.departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
            <Select value={params.get('assignedTo') ?? ''} onChange={(e) => setParam('assignedTo', e.target.value || undefined)} aria-label="Assignee filter">
              <option value="">Any assignee</option>
              {lookups?.users.filter((u) => u.enabled).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
            <Select value={params.get('processingFlag') ?? ''} onChange={(e) => setParam('processingFlag', e.target.value || undefined)} aria-label="Processing flag filter">
              <option value="">Any processing state</option>
              {['MISSING_DOCUMENTS', 'EXTRACTION_REVIEW', 'VALIDATION_FAILED', 'APPROVAL_PENDING', 'SAP_PENDING', 'SAP_ERROR', 'TECHNICAL_RETRY'].map((f) => (
                <option key={f} value={f}>{titleCase(f)}</option>
              ))}
            </Select>
            <Select
              value={params.get('hasExceptions') === 'true' ? 'exc' : params.get('slaBreached') === 'true' ? 'sla' : ''}
              onChange={(e) => {
                setParam('hasExceptions', e.target.value === 'exc' ? 'true' : undefined);
                setParam('slaBreached', e.target.value === 'sla' ? 'true' : undefined);
              }}
              aria-label="Attention filter"
            >
              <option value="">Any attention state</option>
              <option value="exc">With open exceptions</option>
              <option value="sla">SLA breached</option>
            </Select>
            <Input type="number" placeholder="Min amount" value={params.get('amountMin') ?? ''} onChange={(e) => setParam('amountMin', e.target.value || undefined)} aria-label="Minimum amount" />
            <Input type="number" placeholder="Max amount" value={params.get('amountMax') ?? ''} onChange={(e) => setParam('amountMax', e.target.value || undefined)} aria-label="Maximum amount" />
            <Input type="date" value={params.get('dateFrom') ?? ''} onChange={(e) => setParam('dateFrom', e.target.value || undefined)} aria-label="Invoice date from" />
            <Input type="date" value={params.get('dateTo') ?? ''} onChange={(e) => setParam('dateTo', e.target.value || undefined)} aria-label="Invoice date to" />
          </div>
        )}

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          onRowClick={(r) => navigate(`/invoices/${r.id}`)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          empty={<NoResults query={params.get('search') ?? undefined} />}
          dense
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(s) => setParam('pageSize', String(s))}
          />
        )}
      </Card>
    </div>
  );
}
