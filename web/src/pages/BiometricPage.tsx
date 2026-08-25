import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Send } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { Badge, Button, Card, DataTable, Input, LoadingState, PageHeader, StatusBadge, useToast, type Column } from '@/components/ui';

interface BiometricData {
  batches: { id: string; source: string; receivedAt: string; recordCount: number; accepted: number; duplicates: number; rejected: number; status: string; correlationId: string }[];
  lastPushAt: string;
  summary: { vendorCode: string; vendorName?: string; records: number; hours: number; meals: number }[];
  sample: { id: string; vendorCode: string; employeeId: string; employeeName: string; date: string; present: boolean; hours: number; otHours: number; mealEligible: boolean; site: string; status: string }[];
  total: number;
}

export default function BiometricPage() {
  const [vendorCode, setVendorCode] = useState('');
  const [month, setMonth] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['biometric', vendorCode, month],
    queryFn: () => api.get<BiometricData>(`/integrations/biometric${qs({ vendorCode, month })}`),
  });

  const simulate = useMutation({
    mutationFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      return api.post('/integrations/biometric/push', {
        source: 'ESSA-MIS',
        records: Array.from({ length: 12 }, (_, i) => ({
          vendorCode: 'V300019',
          employeeId: `EMP${String(3100 + i).padStart(5, '0')}`,
          employeeName: `Demo Resource ${i + 1}`,
          date: today,
          present: true,
          hours: 8,
          otHours: i % 5 === 0 ? 1.5 : 0,
          mealEligible: true,
          site: 'Hazira Plant',
        })),
      });
    },
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Attendance batch pushed', detail: 'ESSA MIS push simulated — records validated, deduplicated and persisted.' });
      qc.invalidateQueries({ queryKey: ['biometric'] });
    },
  });

  if (isLoading || !data) return <LoadingState label="Loading attendance data…" />;

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Integrations' }, { label: 'Attendance / Biometric' }]}
        title="Attendance / Biometric Integration"
        description="ESSA MIS pushes attendance and availability data to the platform's inbound API (the portal never polls). Normalized records feed the rule engine for N-way reconciliation on manpower and catering invoices."
        actions={
          <Button size="sm" variant="secondary" loading={simulate.isPending} onClick={() => simulate.mutate()}>
            <Send size={13} /> Simulate MIS push
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Card><p className="text-2xs font-medium uppercase text-ink-muted">Last push</p><p className="mt-1 text-sm font-semibold">{fmtDateTime(data.lastPushAt)}</p></Card>
        <Card><p className="text-2xs font-medium uppercase text-ink-muted">Total records</p><p className="mt-1 text-xl font-bold">{fmtNumber(data.total)}</p></Card>
        <Card><p className="text-2xs font-medium uppercase text-ink-muted">Batches</p><p className="mt-1 text-xl font-bold">{data.batches.length}</p></Card>
        <Card><p className="text-2xs font-medium uppercase text-ink-muted">Integration mode</p><p className="mt-1 flex items-center gap-1 text-sm font-semibold"><Fingerprint size={15} className="text-essa-600" /> Inbound push API</p></Card>
      </div>

      <Card title="Summary by vendor" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'vendor', header: 'Vendor', render: (r) => <span className="font-medium">{r.vendorName ?? r.vendorCode} <span className="text-2xs text-ink-faint">({r.vendorCode})</span></span> },
            { key: 'records', header: 'Records', align: 'right', render: (r) => fmtNumber(r.records) },
            { key: 'hours', header: 'Total Hours', align: 'right', render: (r) => fmtNumber(r.hours, 1) },
            { key: 'meals', header: 'Meal-eligible Days', align: 'right', render: (r) => fmtNumber(r.meals) },
          ] satisfies Column<BiometricData['summary'][0]>[]}
          rows={data.summary}
          rowKey={(r) => r.vendorCode}
        />
      </Card>

      <Card title="Ingestion batches" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'id', header: 'Batch', render: (b) => <span className="font-mono text-xs">{b.id}</span> },
            { key: 'source', header: 'Source', render: (b) => <Badge tone="neutral">{b.source}</Badge> },
            { key: 'received', header: 'Received', render: (b) => <span className="whitespace-nowrap text-xs">{fmtDateTime(b.receivedAt)}</span> },
            { key: 'count', header: 'Records', align: 'right', render: (b) => b.recordCount },
            { key: 'accepted', header: 'Accepted', align: 'right', render: (b) => <span className="text-essa-700">{b.accepted}</span> },
            { key: 'dupes', header: 'Duplicates', align: 'right', render: (b) => (b.duplicates ? <Badge tone="warning">{b.duplicates}</Badge> : 0) },
            { key: 'rejected', header: 'Rejected', align: 'right', render: (b) => (b.rejected ? <Badge tone="error">{b.rejected}</Badge> : 0) },
            { key: 'status', header: 'Status', render: (b) => <StatusBadge value={b.status} /> },
            { key: 'cor', header: 'Correlation', render: (b) => <span className="font-mono text-2xs text-ink-muted">{b.correlationId}</span> },
          ] satisfies Column<BiometricData['batches'][0]>[]}
          rows={data.batches}
          rowKey={(b) => b.id}
        />
      </Card>

      <Card title="Attendance records" pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-3">
          <Input value={vendorCode} onChange={(e) => setVendorCode(e.target.value.toUpperCase())} placeholder="Vendor code e.g. V300019" className="w-52" aria-label="Vendor filter" />
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Month filter" />
          <span className="ml-auto text-2xs text-ink-muted">Showing {Math.min(200, data.sample.length)} of {fmtNumber(data.total)} records</span>
        </div>
        <DataTable
          dense
          columns={[
            { key: 'emp', header: 'Employee', render: (r) => <span className="text-xs">{r.employeeName} <span className="text-2xs text-ink-faint">({r.employeeId})</span></span> },
            { key: 'vendor', header: 'Vendor', render: (r) => <span className="text-xs">{r.vendorCode}</span> },
            { key: 'date', header: 'Date', render: (r) => <span className="text-xs">{r.date}</span> },
            { key: 'site', header: 'Site', render: (r) => <span className="text-xs">{r.site}</span> },
            { key: 'present', header: 'Present', align: 'center', render: (r) => (r.present ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
            { key: 'hours', header: 'Hours', align: 'right', render: (r) => r.hours },
            { key: 'ot', header: 'OT', align: 'right', render: (r) => r.otHours || '—' },
            { key: 'meal', header: 'Meal', align: 'center', render: (r) => (r.mealEligible ? 'Yes' : 'No') },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
          ] satisfies Column<BiometricData['sample'][0]>[]}
          rows={data.sample}
          rowKey={(r) => r.id}
        />
      </Card>
    </div>
  );
}
