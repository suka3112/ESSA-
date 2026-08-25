/**
 * Exception codes — the agreed catalogue (review, 24 Aug): ONE code per error
 * type, the same for every invoice, category and vendor. The codes are a
 * column and a filter on the Exception Workbench.
 *
 * Its own item under Administration (review, 25 Aug) — it is reference data,
 * not part of SLA Management — and read-only for every user: the catalogue is
 * fixed with the platform release so a code always means the same thing in
 * reports, vendor correspondence and history. Changing it is a release
 * change, not a portal setting.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { Badge, Card, DataTable, Input, LoadingState, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';

interface ExceptionCodeRow { id: string; code: string; type: string; label: string; description: string; documentTypeId?: string; active: boolean }
interface Lookups { exceptionCodes: ExceptionCodeRow[]; documentTypes: { id: string; name: string }[] }

export default function ExceptionCodesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  const codes = data?.exceptionCodes ?? [];
  const types = useMemo(() => [...new Set(codes.map((c) => c.type))], [codes]);
  const documentName = (id?: string) => data?.documentTypes.find((d) => d.id === id)?.name;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return codes.filter((c) =>
      (!type || c.type === type) &&
      (!q || [c.code, c.label, c.description, titleCase(c.type)].some((v) => v.toLowerCase().includes(q)))
    );
  }, [codes, search, type]);

  if (isLoading || !data) return <LoadingState />;

  const columns: Column<ExceptionCodeRow>[] = [
    { key: 'code', header: 'Exception Code', sortable: true, value: (r) => r.code, render: (r) => <span className="font-mono text-2xs font-semibold text-ink-secondary">{r.code}</span> },
    { key: 'type', header: 'Exception Type', sortable: true, value: (r) => titleCase(r.type), render: (r) => <span className="text-xs">{titleCase(r.type)}</span> },
    { key: 'label', header: 'Name', sortable: true, value: (r) => r.label, render: (r) => <span className="text-xs font-medium">{r.label}</span> },
    { key: 'description', header: 'What It Means', value: (r) => r.description, render: (r) => <span className="text-xs text-ink-secondary">{r.description}</span> },
    { key: 'document', header: 'Document', sortable: true, value: (r) => documentName(r.documentTypeId) ?? '', render: (r) => documentName(r.documentTypeId) ? <span className="text-xs">{documentName(r.documentTypeId)}</span> : <span className="text-2xs text-ink-faint">—</span> },
    { key: 'active', header: 'Status', sortable: true, value: (r) => (r.active ? 'Active' : 'Inactive'), render: (r) => <StatusBadge value={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Exception Codes' }]}
        title="Exception Codes"
        description="One code per error type — the same code whatever the invoice, category or vendor. Shown as a column and a filter on the Exception Workbench."
        actions={<Badge tone="neutral"><Lock size={11} /> Read-only reference</Badge>}
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-3 py-2.5">
          <span className="flex flex-col gap-0.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Search</span>
            <span className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, name or meaning" className="w-64 pl-8" aria-label="Search exception codes" />
            </span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Exception type</span>
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Exception type filter">
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </span>
          <span className="ml-auto self-center text-2xs text-ink-muted">{rows.length} of {codes.length} codes</span>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} dense empty={<p className="py-8 text-center text-xs text-ink-muted">No exception code matches.</p>} />
        <p className="border-t border-line-soft px-3 py-2 text-2xs text-ink-muted">
          The catalogue is fixed with the platform release so that a code always means the same thing on the workbench, in reports and in vendor correspondence. It is not edited in the portal by any user.
        </p>
      </Card>
    </div>
  );
}
