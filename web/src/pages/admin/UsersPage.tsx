import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { fmtRelative, titleCase } from '@/lib/format';
import { Badge, Button, Card, DataTable, Field, LoadingState, Modal, PageHeader, StatusBadge, Tabs, useToast, type Column } from '@/components/ui';

interface UserRow { id: string; name: string; email: string; department: string; title: string; roleIds: string[]; roleNames: string[]; groups: string[]; enabled: boolean; lastLoginAt?: string; entraObjectId: string }
interface RoleRow { id: string; code: string; name: string; description: string; permissions: string[]; system: boolean }
interface PermRow { code: string; description: string }

export default function UsersPage() {
  const [tab, setTab] = useState('users');
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserRow[]; roles: RoleRow[]; permissions: PermRow[] }>('/users'),
  });

  const update = useMutation({
    mutationFn: (p: { id: string; enabled?: boolean; roleIds?: string[] }) => api.post(`/users/${p.id}`, p),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'User updated', detail: 'Access change recorded in the audit trail.' });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (isLoading || !data) return <LoadingState />;

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Users & Roles' }]}
        title="Users, Roles & Permissions"
        description="Identity is authenticated by Microsoft Entra ID; the portal manages enablement, role and group assignment. Backend authorization enforces permissions on every protected operation independently of menu visibility."
      />
      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={[{ key: 'users', label: `Users (${data.users.length})` }, { key: 'roles', label: `Roles (${data.roles.length})` }, { key: 'matrix', label: 'Permission Matrix' }]} active={tab} onChange={setTab} />
        </div>

        {tab === 'users' && (
          <DataTable
            dense
            columns={[
              {
                key: 'name', header: 'User', render: (u) => (
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-essa-600 text-2xs font-bold text-white">{u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                    <span>
                      <span className="block font-medium">{u.name}</span>
                      <span className="block text-2xs text-ink-faint">{u.email}</span>
                    </span>
                  </div>
                ),
              },
              { key: 'title', header: 'Title', render: (u) => <span className="text-xs">{u.title}</span> },
              { key: 'department', header: 'Department', render: (u) => <span className="text-xs">{u.department}</span> },
              { key: 'roles', header: 'Roles', render: (u) => <span className="flex max-w-56 flex-wrap gap-1">{u.roleNames.map((r) => <Badge key={r} tone="info">{r}</Badge>)}</span> },
              { key: 'groups', header: 'Groups', render: (u) => <span className="text-2xs text-ink-muted">{u.groups.join(', ')}</span> },
              { key: 'entra', header: 'Entra Object', render: (u) => <span className="font-mono text-2xs text-ink-faint">{u.entraObjectId}</span> },
              { key: 'login', header: 'Last Login', render: (u) => <span className="whitespace-nowrap text-2xs">{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'Never'}</span> },
              { key: 'enabled', header: 'Status', render: (u) => <StatusBadge value={u.enabled ? 'ACTIVE' : 'INACTIVE'} label={u.enabled ? 'Enabled' : 'Disabled'} /> },
              {
                key: 'actions', header: 'Actions', render: (u) => (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => { setEditing(u); setRoleIds(u.roleIds); }}><Pencil size={13} /></Button>
                    <Button size="sm" variant={u.enabled ? 'warning' : 'secondary'} onClick={() => update.mutate({ id: u.id, enabled: !u.enabled })}>
                      {u.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                ),
              },
            ] satisfies Column<UserRow>[]}
            rows={data.users}
            rowKey={(u) => u.id}
          />
        )}

        {tab === 'roles' && (
          <DataTable
            dense
            columns={[
              { key: 'name', header: 'Role', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-2xs">{r.code}</span> },
              { key: 'description', header: 'Description', render: (r) => <span className="block max-w-96 text-xs text-ink-secondary">{r.description}</span> },
              { key: 'perms', header: 'Permissions', align: 'center', render: (r) => <Badge tone="neutral">{r.permissions.length}</Badge> },
              { key: 'users', header: 'Users', align: 'center', render: (r) => data.users.filter((u) => u.roleIds.includes(r.id)).length },
              { key: 'system', header: 'Type', render: (r) => (r.system ? <Badge tone="info"><ShieldCheck size={11} /> System</Badge> : <Badge tone="neutral">Custom</Badge>) },
            ] satisfies Column<RoleRow>[]}
            rows={data.roles}
            rowKey={(r) => r.id}
          />
        )}

        {tab === 'matrix' && (
          <div className="overflow-x-auto p-3 scrollbar-thin">
            <table className="w-full border-collapse text-2xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-line bg-white px-2 py-1.5 text-left font-semibold">Permission</th>
                  {data.roles.map((r) => (
                    <th key={r.id} className="border-b border-line bg-essa-600 px-2 py-1.5 text-center font-semibold text-white">{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.permissions.map((p, i) => (
                  <tr key={p.code} className={clsx(i % 2 === 1 && 'bg-canvas')}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b border-line-soft bg-inherit px-2 py-1.5">
                      <span className="font-mono font-medium">{p.code}</span>
                      <span className="block text-ink-muted">{p.description}</span>
                    </td>
                    {data.roles.map((r) => (
                      <td key={r.id} className="border-b border-line-soft px-2 py-1.5 text-center">
                        {r.permissions.includes(p.code) ? <span className="font-bold text-essa-600">✓</span> : <span className="text-line-strong">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit roles — ${editing?.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={update.isPending} onClick={() => editing && update.mutate({ id: editing.id, roleIds })}>Save assignment</Button>
          </>
        }
      >
        <Field label="Assigned roles">
          <div className="space-y-1.5">
            {data.roles.map((r) => (
              <label key={r.id} className="flex items-start gap-2 rounded-md border border-line p-2 text-xs hover:bg-canvas">
                <input
                  type="checkbox"
                  checked={roleIds.includes(r.id)}
                  onChange={(e) => setRoleIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))}
                  className="mt-0.5 h-3.5 w-3.5 accent-essa-600"
                />
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-2xs text-ink-muted">{r.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      </Modal>
    </div>
  );
}
