import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, titleCase } from '@/lib/format';
import { Badge, Card, DataTable, LoadingState, PageHeader, StatusBadge, type Column } from '@/components/ui';

interface DoARow { id: string; department: string; level: number; role: string; approverName: string; minAmount: number; maxAmount: number | null; currency: string; active: boolean }
interface WorkflowDef { id: string; code: string; name: string; description: string; categoryId?: string; status: string; version: string; steps: { stepNo: number; name: string; role: string; approverType: string; amountThresholdMin?: number; taxStep?: boolean; slaHours: number; escalationTo?: string }[] }

export default function ApprovalMatrixPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['approval-matrix'],
    queryFn: () => api.get<{ doa: DoARow[]; workflows: WorkflowDef[] }>('/approval-matrix'),
  });
  if (isLoading || !data) return <LoadingState />;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Approval Matrix' }]}
        title="Approval Matrix"
        description="Delegation of Authority levels and active approval workflow definitions."
      />
      <Card title="Delegation of Authority (DoA)" pad={false}>
        <DataTable
          dense
          columns={[
            { key: 'department', header: 'Department', render: (r) => <span className="font-medium">{r.department}</span> },
            { key: 'level', header: 'Level', align: 'center', render: (r) => <Badge tone="info">L{r.level}</Badge> },
            { key: 'role', header: 'Role', render: (r) => titleCase(r.role) },
            { key: 'approver', header: 'Approver', render: (r) => r.approverName },
            { key: 'range', header: 'Amount Band', render: (r) => `${fmtMoney(r.minAmount)} – ${r.maxAmount != null ? fmtMoney(r.maxAmount) : 'Unlimited'}` },
            { key: 'active', header: 'Status', render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
          ] satisfies Column<DoARow>[]}
          rows={data.doa}
          rowKey={(r) => r.id}
        />
      </Card>
      {data.workflows.map((wf) => (
        <Card key={wf.id} title={<span>{wf.name} <span className="ml-2 text-2xs font-normal text-ink-muted">{wf.code} · {wf.version}</span></span>} actions={<StatusBadge value={wf.status} />}>
          <p className="mb-3 text-xs text-ink-muted">{wf.description}</p>
          <ol className="flex flex-wrap items-center gap-y-3">
            {wf.steps.map((s, i) => (
              <li key={s.stepNo} className="flex items-center">
                <div className="w-44 rounded-lg border border-line bg-canvas p-2.5">
                  <p className="text-xs font-semibold text-ink">{s.stepNo}. {s.name}</p>
                  <p className="text-2xs text-ink-muted">{s.approverType === 'DOA' ? 'DoA matrix routing' : titleCase(s.role)}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    <Badge tone="neutral">SLA {s.slaHours}h</Badge>
                    {s.taxStep && <Badge tone="info">Tax gate</Badge>}
                    {s.amountThresholdMin != null && <Badge tone="warning">≥ {fmtMoney(s.amountThresholdMin)}</Badge>}
                    {s.escalationTo && <Badge tone="pending">Esc → {titleCase(s.escalationTo)}</Badge>}
                  </p>
                </div>
                {i < wf.steps.length - 1 && <span className="mx-1.5 h-0.5 w-6 bg-essa-400" />}
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
