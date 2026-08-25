import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '@/lib/api';
import { fmtMoney, fmtNumber, titleCase } from '@/lib/format';
import { Button, Card, DataTable, Input, LoadingState, PageHeader, Select, type Column } from '@/components/ui';

interface ReportData {
  totals: { invoices: number; amount: number; exceptions: number; exceptionRate: number; validationRuns: number; validationPassRate: number; avgConfidence: number | null; posted: number; paid: number; approvalsCompleted: number; approvalsOnTime: number };
  monthly: { month: string; count: number; amount: number }[];
  byLifecycle: Record<string, number>;
  byStatus: Record<string, number>;
  byCategory: Record<string, { count: number; amount: number }>;
  exceptionsByType: Record<string, number>;
  vendorPerformance: { code: string; name: string; count: number; amount: number; exceptions: number; exceptionRate: number }[];
}

const STATUS_ORDER = ['Draft', 'Validation', 'Approval Pending', 'Approved', 'Parked', 'Posted', 'Paid', 'Rejected', 'Failed', 'Cancelled'];

const fmtMonth = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

/** Compact labelled filter control. */
function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/** Horizontal distribution row: label · bar (share of max) · count. */
function DistRow({ label, value, max, tone, sub }: { label: string; value: number; max: number; tone: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 truncate text-ink-secondary" title={label}>{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-line-soft">
        <div className={clsx('h-full rounded transition-all', tone)} style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right font-semibold text-ink">{value}</span>
      {sub && <span className="w-12 shrink-0 text-right text-2xs text-ink-muted">{sub}</span>}
    </div>
  );
}

export default function ReportsPage() {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', categoryId: '', vendorCode: '' });
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const hasFilters = Object.values(filters).some(Boolean);
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<{ categories: { id: string; name: string }[]; vendors: { code: string; name: string }[] }>('/lookups') });
  const { data, isLoading } = useQuery({
    queryKey: ['reports', filters],
    queryFn: () => api.get<ReportData>(`/reports${qs(filters)}`),
  });

  if (isLoading || !data) return <LoadingState label="Building reports…" />;
  const t = data.totals;
  const onTimePct = t.approvalsCompleted ? Math.round((t.approvalsOnTime / t.approvalsCompleted) * 100) : null;

  const lifecycleData = STATUS_ORDER.filter((k) => data.byStatus?.[k])
    .map((k) => ({ key: k, name: k, value: data.byStatus[k] }));
  const lifecycleTotal = lifecycleData.reduce((s, d) => s + d.value, 0) || 1;
  const lifecycleMax = Math.max(...lifecycleData.map((d) => d.value), 1);

  const excData = Object.entries(data.exceptionsByType)
    .map(([name, value]) => ({ name: titleCase(name), value }))
    .sort((a, b) => b.value - a.value);
  const excMax = Math.max(...excData.map((d) => d.value), 1);

  const categoryData = Object.entries(data.byCategory)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.amount - a.amount);
  const categoryMaxAmount = Math.max(...categoryData.map((c) => c.amount), 1);

  const vendorRows = [...data.vendorPerformance].sort((a, b) => b.amount - a.amount);

  const exportCsv = () => {
    const rows = vendorRows.map((v) => [v.code, v.name, v.count, v.amount, v.exceptions, `${v.exceptionRate}%`].join(','));
    const blob = new Blob([['Vendor Code,Vendor,Invoices,Amount,Exceptions,Exception Rate', ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'essa-ap-report.csv';
    a.click();
  };

  const kpis: { label: string; value: string; tone?: string }[] = [
    { label: 'Invoices', value: fmtNumber(t.invoices) },
    { label: 'Total Value', value: fmtMoney(t.amount) },
    { label: 'Exception Rate', value: `${t.exceptionRate}%`, tone: t.exceptionRate > 30 ? 'text-semantic-error' : t.exceptionRate > 15 ? 'text-semantic-warning' : 'text-essa-700' },
    { label: 'Validation Pass', value: `${t.validationPassRate}%`, tone: t.validationPassRate >= 80 ? 'text-essa-700' : 'text-semantic-warning' },
    { label: 'Avg Confidence', value: t.avgConfidence != null ? `${t.avgConfidence}%` : '—', tone: 'text-semantic-info' },
    { label: 'Posted', value: fmtNumber(t.posted), tone: 'text-essa-700' },
    { label: 'Paid', value: fmtNumber(t.paid), tone: 'text-essa-700' },
    { label: 'Approvals On-time', value: onTimePct != null ? `${onTimePct}%` : '—', tone: onTimePct != null && onTimePct < 80 ? 'text-semantic-warning' : 'text-essa-700' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Reports' }]}
        title="AP Reports"
        description="Volume, processing performance, exception rates, approval SLA, vendor performance and extraction quality."
        actions={<Button variant="secondary" size="sm" onClick={exportCsv}><Download size={13} /> Export CSV</Button>}
      />

      {/* ------------------------------------------------------------ filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-5">
            <Filter label="From"><Input type="date" value={filters.dateFrom} onChange={set('dateFrom')} aria-label="From date" /></Filter>
            <Filter label="To"><Input type="date" value={filters.dateTo} onChange={set('dateTo')} aria-label="To date" /></Filter>
            <Filter label="Category">
              <Select value={filters.categoryId} onChange={set('categoryId')} aria-label="Category" className="w-full">
                <option value="">All categories</option>
                {lookups?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Filter>
            <Filter label="Vendor">
              <Select value={filters.vendorCode} onChange={set('vendorCode')} aria-label="Vendor" className="w-full">
                <option value="">All vendors</option>
                {lookups?.vendors.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
              </Select>
            </Filter>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({ dateFrom: '', dateTo: '', categoryId: '', vendorCode: '' })}>
              <RotateCcw size={13} /> Reset
            </Button>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------------ KPI band */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line-soft shadow-card sm:grid-cols-4 xl:grid-cols-8">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{k.label}</p>
            <p className={clsx('mt-1 truncate text-lg font-bold', k.tone ?? 'text-ink')} title={k.value}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------------------ charts row */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
        <Card title="Monthly invoice volume & value" className="flex flex-col">
          {/* Chart is absolutely positioned so its measured size can never feed back
              into the parent's auto height (prevents infinite grow loop). */}
          <div className="relative h-full min-h-64">
            <div className="absolute inset-0">
            <ResponsiveContainer>
              <BarChart data={data.monthly} margin={{ top: 8, left: -10, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={fmtMonth} tickMargin={6} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(v % 1e9 ? 1 : 0)} bn` : `${Math.round(v / 1e6)} m`)} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(v) => fmtMonth(String(v))} formatter={(v: number, n: string) => (n === 'Value' ? fmtMoney(v) : v)} />
                <Bar yAxisId="l" dataKey="count" name="Invoices" fill="#1f7a41" radius={[3, 3, 0, 0]} barSize={22} />
                <Bar yAxisId="r" dataKey="amount" name="Value" fill="#a7d6b8" radius={[3, 3, 0, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
          <p className="mt-2 flex items-center gap-4 border-t border-line-soft pt-2 text-2xs text-ink-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-essa-600" /> Invoices (count)</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-essa-200" /> Value (IDR, USD invoices at the NDPBM rate)</span>
          </p>
        </Card>

        <Card title="Where invoices stand" className="flex flex-col">
          <div className="space-y-2">
            {lifecycleData.map((d) => (
              <DistRow key={d.key} label={d.name} value={d.value} max={lifecycleMax} tone="bg-essa-500" sub={`${Math.round((d.value / lifecycleTotal) * 100)}%`} />
            ))}
          </div>
          <div className="mt-3 border-t border-line-soft pt-2.5">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Exception hotspots</p>
            <div className="space-y-2">
              {excData.length ? (
                excData.map((d) => <DistRow key={d.name} label={d.name} value={d.value} max={excMax} tone="bg-amber-500" />)
              ) : (
                <p className="text-2xs text-ink-muted">No exceptions in the selected period.</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------ category + vendor row */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
        <Card title="Category spend">
          <div className="space-y-3">
            {categoryData.map((c) => (
              <div key={c.name}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-ink-secondary">{c.name}</span>
                  <span className="whitespace-nowrap font-semibold text-ink">{fmtMoney(c.amount)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full rounded-full bg-essa-500" style={{ width: `${Math.max(2, (c.amount / categoryMaxAmount) * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-2xs text-ink-muted">{c.count} invoice(s) · avg {fmtMoney(c.count ? c.amount / c.count : 0)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Vendor performance" pad={false} className="flex flex-col xl:col-span-2">
          <DataTable
            dense
            columns={[
              { key: 'name', header: 'Vendor', render: (v) => <span className="font-medium">{v.name} <span className="text-2xs text-ink-faint">({v.code})</span></span> },
              { key: 'count', header: 'Invoices', align: 'right', render: (v) => v.count },
              { key: 'amount', header: 'Billed Value', align: 'right', render: (v) => <span className="whitespace-nowrap">{fmtMoney(v.amount)}</span> },
              { key: 'exceptions', header: 'Exceptions', align: 'right', render: (v) => (v.exceptions ? v.exceptions : <span className="text-ink-faint">0</span>) },
              {
                key: 'rate', header: 'Exception Rate', render: (v) => (
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line-soft">
                      <span
                        className={clsx('block h-full rounded-full', v.exceptionRate > 50 ? 'bg-semantic-error' : v.exceptionRate > 20 ? 'bg-amber-500' : 'bg-essa-500')}
                        style={{ width: `${Math.min(100, v.exceptionRate)}%` }}
                      />
                    </span>
                    <span className={clsx('w-10 text-right', v.exceptionRate > 50 ? 'font-semibold text-semantic-error' : v.exceptionRate > 20 ? 'text-semantic-warning' : 'text-essa-700')}>
                      {v.exceptionRate}%
                    </span>
                  </span>
                ), align: 'right',
              },
            ] satisfies Column<ReportData['vendorPerformance'][0]>[]}
            rows={vendorRows}
            rowKey={(v) => v.code}
          />
        </Card>
      </div>
    </div>
  );
}
