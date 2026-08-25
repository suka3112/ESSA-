/**
 * Users, Roles & Permissions.
 *
 * UI/UX review (Aug 2026) §11/§12:
 *  · Roles list: Role, Users, Status (Enabled / Disabled), Action. Role Code,
 *    description, the numeric permission count and the System/Custom type are
 *    gone — none of them told the administrator anything useful.
 *  · Permissions are expressed as what they let someone DO: every module has
 *    Read, Create, Edit and Delete. No unexplained codes, no bare tick marks.
 *  · One permission definition (PERMISSION_MODULES below) drives the role
 *    editor AND the permission matrix, so the two can never drift apart, and
 *    it is the same permission that controls navigation and page access.
 *  · Users: one Action opens a single dialog that assigns roles and enables or
 *    disables the user; a user with no role is shown as "No access".
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Pencil, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, LoadingState, Modal, PageHeader,
  Select, StatusBadge, Tabs, Tooltip, useToast, type Column,
} from '@/components/ui';

interface UserRow { id: string; name: string; email: string; title: string; roleIds: string[]; roleNames: string[]; groups: string[]; enabled: boolean; lastLoginAt?: string; entraObjectId: string }
interface RoleRow { id: string; code: string; name: string; description: string; permissions: string[]; system: boolean; active?: boolean }
interface PermRow { code: string; description: string }

/** Roles are enabled unless explicitly disabled (seeded system roles carry no flag). */
const roleEnabled = (r: RoleRow) => r.active !== false;

type PermAction = 'Read' | 'Create' | 'Edit' | 'Delete';
const ACTIONS: PermAction[] = ['Read', 'Create', 'Edit', 'Delete'];

interface PermCell { codes: string[]; allows: string }

/**
 * The permission model as the business reads it: one row per part of the
 * product, one column per action. Each cell maps onto the permission codes the
 * backend already enforces — the wording changes, the enforcement does not.
 */
const PERMISSION_MODULES: { module: string; cells: Partial<Record<PermAction, PermCell>> }[] = [
  { module: 'Dashboard', cells: { Read: { codes: ['DASHBOARD_VIEW'], allows: 'Open the dashboard' } } },
  {
    module: 'Invoices',
    cells: {
      Read: { codes: ['INVOICE_VIEW'], allows: 'View invoices and their documents' },
      Create: { codes: ['INVOICE_UPLOAD'], allows: 'Upload an invoice manually' },
      Edit: { codes: ['INVOICE_EDIT', 'FIELD_CORRECT', 'INVOICE_REVALIDATE'], allows: 'Correct extracted fields and revalidate an invoice' },
    },
  },
  { module: 'Validation', cells: { Edit: { codes: ['VALIDATION_OVERRIDE'], allows: 'Override a failed validation check with a justification' } } },
  {
    module: 'Exceptions',
    cells: {
      Read: { codes: ['EXCEPTION_VIEW'], allows: 'Open the Exception Workbench' },
      Edit: { codes: ['EXCEPTION_MANAGE'], allows: 'Resolve, override and retry exceptions' },
    },
  },
  {
    module: 'Approvals',
    cells: {
      Read: { codes: ['APPROVAL_VIEW'], allows: 'See the approval queue' },
      Edit: { codes: ['APPROVAL_ACT'], allows: 'Approve or reject an invoice' },
    },
  },
  { module: 'Tax Review', cells: { Edit: { codes: ['TAX_REVIEW'], allows: 'Complete the tax review step' } } },
  {
    module: 'Vendors',
    cells: {
      Read: { codes: ['VENDOR_VIEW'], allows: 'View the vendor list' },
      Edit: { codes: ['VENDOR_CONTROL'], allows: 'Block or unblock a vendor on this platform' },
    },
  },
  {
    module: 'SAP',
    cells: {
      Read: { codes: ['SAP_VIEW'], allows: 'View purchase orders and SAP status' },
      Edit: { codes: ['SAP_RETRY'], allows: 'Send an invoice to SAP again' },
    },
  },
  { module: 'Attendance', cells: { Read: { codes: ['BIOMETRIC_VIEW'], allows: 'View attendance data used for validation' } } },
  {
    module: 'Configuration',
    cells: {
      Read: { codes: ['CONFIG_VIEW'], allows: 'View invoice categories, document types and rules' },
      Create: { codes: ['CONFIG_PUBLISH'], allows: 'Publish a new configuration version' },
      Edit: { codes: ['CONFIG_EDIT'], allows: 'Change categories, document types and rules' },
    },
  },
  {
    module: 'Users & Roles',
    cells: {
      Read: { codes: ['USER_ADMIN'], allows: 'View users, roles and permissions' },
      Create: { codes: ['USER_ADMIN'], allows: 'Create a role' },
      Edit: { codes: ['USER_ADMIN'], allows: 'Assign roles and change permissions' },
      Delete: { codes: ['USER_ADMIN'], allows: 'Delete a role' },
    },
  },
  { module: 'Audit Log', cells: { Read: { codes: ['AUDIT_VIEW'], allows: 'Search the audit log' } } },
  { module: 'Reports', cells: { Read: { codes: ['REPORT_VIEW'], allows: 'Open reports' } } },
];

/** Every code that appears somewhere in the table above. */
const MAPPED_CODES = new Set(PERMISSION_MODULES.flatMap((m) => Object.values(m.cells).flatMap((c) => c!.codes)));

const cellGranted = (permissions: string[], cell: PermCell) => cell.codes.every((c) => permissions.includes(c));

export default function UsersPage() {
  const [tab, setTab] = useState('users');
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [userEnabled, setUserEnabled] = useState(true);
  const [roleModal, setRoleModal] = useState<{ id?: string; name: string; active: boolean; permissions: string[]; system?: boolean } | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleRow | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [newUser, setNewUser] = useState<{ name: string; email: string; title: string; roleIds: string[]; enabled: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserRow[]; roles: RoleRow[]; permissions: PermRow[] }>('/users'),
  });

  const update = useMutation({
    mutationFn: (p: { id: string; enabled?: boolean; roleIds?: string[] }) => api.post(`/users/${p.id}`, p),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'User updated', detail: 'The change is recorded in the audit log.' });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Update failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  /**
   * Adding a user does not create a credential — people sign in with their ESSA
   * corporate account. It registers that identity with the platform and gives it
   * the roles it should hold; until then a colleague who signs in sees nothing.
   */
  const createUser = useMutation({
    mutationFn: (p: { name: string; email: string; title: string; roleIds: string[]; enabled: boolean }) => api.post('/users', p),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'User added', detail: 'They can sign in with their corporate account. The change is recorded in the audit log.' });
      setNewUser(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Could not add the user', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const roleAction = useMutation({
    mutationFn: (p: { op: 'CREATE' | 'UPDATE' | 'DELETE'; row: Record<string, unknown> }) => api.post('/configuration/entities/roles', p),
    onSuccess: (_r, p) => {
      toast.push({ tone: 'success', title: p.op === 'CREATE' ? 'Role created' : p.op === 'DELETE' ? 'Role deleted' : 'Role updated', detail: 'The change is recorded in the audit log.' });
      setRoleModal(null);
      setDeleteRole(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Role change failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const filteredUsers = useMemo(() => {
    const rows = data?.users ?? [];
    const q = userSearch.trim().toLowerCase();
    return rows.filter((u) => {
      if (userRoleFilter && !u.roleIds.includes(userRoleFilter)) return false;
      if (!q) return true;
      return [u.name, u.email, u.title].some((v) => v?.toLowerCase().includes(q));
    });
  }, [data?.users, userSearch, userRoleFilter]);

  if (isLoading || !data) return <LoadingState />;

  /** Toggle a cell in the role editor, keeping unmapped codes untouched. */
  const toggleCell = (cell: PermCell, on: boolean) =>
    setRoleModal((prev) => {
      if (!prev) return prev;
      const set = new Set(prev.permissions);
      cell.codes.forEach((c) => (on ? set.add(c) : set.delete(c)));
      return { ...prev, permissions: [...set] };
    });

  const openRoleEditor = (r?: RoleRow) =>
    setRoleModal(
      r
        ? { id: r.id, name: r.name, active: roleEnabled(r), permissions: [...r.permissions], system: r.system }
        : { name: '', active: true, permissions: [] }
    );

  const saveRole = () => {
    if (!roleModal) return;
    const existing = data.roles.find((r) => r.id === roleModal.id);
    // Codes the UI does not present (technical-only permissions) are preserved.
    const untouched = (existing?.permissions ?? []).filter((c) => !MAPPED_CODES.has(c));
    roleAction.mutate({
      op: roleModal.id ? 'UPDATE' : 'CREATE',
      row: {
        ...(existing ?? {}),
        id: roleModal.id,
        name: roleModal.name.trim(),
        // The code is generated from the name and never shown to the user.
        code: existing?.code ?? roleModal.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
        description: existing?.description ?? '',
        system: existing?.system ?? false,
        active: roleModal.active,
        permissions: [...new Set([...untouched, ...roleModal.permissions])],
      },
    });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Users & Roles' }]}
        title="Users, Roles & Permissions"
        description="Users are signed in with their corporate account. What they can see and do on this platform is decided by the roles assigned here."
        actions={
          tab === 'users' ? (
            <Button size="sm" onClick={() => setNewUser({ name: '', email: '', title: '', roleIds: [], enabled: true })}>
              <CirclePlus size={13} /> Add user
            </Button>
          ) : tab === 'roles' ? (
            <Button size="sm" onClick={() => openRoleEditor()}>
              <CirclePlus size={13} /> Create role
            </Button>
          ) : undefined
        }
      />
      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs
            tabs={[
              { key: 'users', label: `Users (${data.users.length})` },
              { key: 'roles', label: `Roles (${data.roles.length})` },
              { key: 'matrix', label: 'Permission Matrix' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {/* ---------------------------------------------------------- users */}
        {tab === 'users' && (
          <>
            <div className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Search</span>
                <span className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Name, email or job title…" className="w-64 pl-8" aria-label="Search users" />
                </span>
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Role</span>
                <Select value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value)} aria-label="Role filter">
                  <option value="">Any role</option>
                  {data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </span>
            </div>
            <DataTable
              dense
              columns={[
                {
                  key: 'name', header: 'User', sortable: true, value: (u) => u.name, render: (u) => (
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-essa-600 text-2xs font-bold text-white">{u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                      <span>
                        <span className="block font-medium">{u.name}</span>
                        <span className="block text-2xs text-ink-faint">{u.email}</span>
                      </span>
                    </div>
                  ),
                },
                { key: 'title', header: 'Job Title', sortable: true, value: (u) => u.title, render: (u) => <span className="text-xs">{u.title}</span> },
                {
                  key: 'roles', header: 'Roles', sortable: true,
                  value: (u) => (u.roleNames.length ? u.roleNames.join(', ') : 'No access'),
                  render: (u) =>
                    !u.roleNames.length
                      ? <span className="text-2xs italic text-ink-faint">No access</span>
                      : <span className="flex max-w-56 flex-wrap gap-1">{u.roleNames.map((r) => <Badge key={r} tone="info">{r}</Badge>)}</span>,
                },
                { key: 'login', header: 'Last Sign In', sortable: true, value: (u) => u.lastLoginAt ?? '', render: (u) => <span className="whitespace-nowrap text-2xs">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Never'}</span> },
                { key: 'enabled', header: 'Status', sortable: true, value: (u) => (u.enabled ? 'Enabled' : 'Disabled'), render: (u) => <StatusBadge value={u.enabled ? 'ACTIVE' : 'INACTIVE'} label={u.enabled ? 'Enabled' : 'Disabled'} /> },
                {
                  /* One action: the dialog assigns roles and enables/disables. */
                  key: 'actions', header: 'Action', align: 'center', sticky: true, render: (u) => (
                    <Button
                      size="sm" variant="ghost" aria-label={`Edit ${u.name}`} title="Assign roles and enable or disable this user"
                      onClick={() => { setEditing(u); setRoleIds(u.roleIds); setUserEnabled(u.enabled); }}
                    >
                      <Pencil size={13} />
                    </Button>
                  ),
                },
              ] satisfies Column<UserRow>[]}
              rows={filteredUsers}
              rowKey={(u) => u.id}
            />
          </>
        )}

        {/* ---------------------------------------------------------- roles */}
        {tab === 'roles' && (
          <>
            <DataTable
              dense
              columns={[
                { key: 'name', header: 'Role', sortable: true, value: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
                { key: 'users', header: 'Users', align: 'center', sortable: true, value: (r) => data.users.filter((u) => u.roleIds.includes(r.id)).length, render: (r) => data.users.filter((u) => u.roleIds.includes(r.id)).length },
                { key: 'status', header: 'Status', sortable: true, value: (r) => (roleEnabled(r) ? 'Enabled' : 'Disabled'), render: (r) => <StatusBadge value={roleEnabled(r) ? 'ACTIVE' : 'INACTIVE'} label={roleEnabled(r) ? 'Enabled' : 'Disabled'} /> },
                {
                  key: 'actions', header: 'Action', align: 'center', sticky: true, render: (r) => (
                    <div className="flex justify-center gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Manage permissions for ${r.name}`} title="Manage permissions, rename, enable or disable" onClick={() => openRoleEditor(r)}>
                        <Pencil size={13} />
                      </Button>
                      {!r.system && (
                        <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} title="Delete this role" className="text-semantic-error" onClick={() => setDeleteRole(r)}>
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </div>
                  ),
                },
              ] satisfies Column<RoleRow>[]}
              rows={data.roles}
              rowKey={(r) => r.id}
            />
          </>
        )}

        {/* ------------------------------------------------- permission matrix */}
        {tab === 'matrix' && (
          <div className="space-y-2 p-3">
            <p className="text-xs text-ink-secondary">
              Each row is something a person can do. A tick means the role is allowed to do it; read the row to see which
              roles have a permission, read a column to see everything a role can do.
            </p>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-line bg-white px-2 py-2 text-left font-semibold">Area</th>
                    <th className="border-b border-line bg-white px-2 py-2 text-left font-semibold">Permission</th>
                    <th className="border-b border-line bg-white px-2 py-2 text-left font-semibold">What it allows</th>
                    {data.roles.map((r) => (
                      <th key={r.id} className="whitespace-nowrap border-b border-line bg-essa-600 px-2 py-2 text-center font-semibold text-white">{r.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULES.flatMap((m) =>
                    ACTIONS.filter((a) => m.cells[a]).map((a, idx) => {
                      const cell = m.cells[a]!;
                      return (
                        <tr key={`${m.module}-${a}`} className={clsx(idx === 0 && 'border-t border-line')}>
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 font-medium text-ink">{idx === 0 ? m.module : ''}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-ink-secondary">{a}</td>
                          <td className="px-2 py-1.5 text-2xs text-ink-muted">{cell.allows}</td>
                          {data.roles.map((r) => (
                            <td key={r.id} className="border-l border-line-soft px-2 py-1.5 text-center">
                              {cellGranted(r.permissions, cell)
                                ? <span className="font-bold text-essa-600" title={`${r.name} can ${cell.allows.toLowerCase()}`}>✓</span>
                                : <span className="text-line-strong" title={`${r.name} cannot ${cell.allows.toLowerCase()}`}>—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* ----------------------------------------------------- user editor */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit user — ${editing?.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={update.isPending} onClick={() => editing && update.mutate({ id: editing.id, roleIds, enabled: userEnabled })}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Roles" hint="A user with no role has no access to the platform.">
            <div className="space-y-1.5">
              {data.roles.filter(roleEnabled).map((r) => (
                <label key={r.id} className="flex items-center gap-2 rounded-md border border-line p-2 text-xs hover:bg-canvas">
                  <input
                    type="checkbox"
                    checked={roleIds.includes(r.id)}
                    onChange={(e) => setRoleIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))}
                    className="h-3.5 w-3.5 accent-essa-600"
                  />
                  <span className="font-medium">{r.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={userEnabled} onChange={(e) => setUserEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-essa-600" />
            User enabled — can sign in to the platform
          </label>
        </div>
      </Modal>

      {/* ----------------------------------------------------- role editor */}
      <Modal
        open={Boolean(roleModal)}
        onClose={() => setRoleModal(null)}
        title={roleModal?.id ? `Edit role — ${roleModal.name}` : 'Create role'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRoleModal(null)}>Cancel</Button>
            <Button loading={roleAction.isPending} disabled={!roleModal?.name.trim()} onClick={saveRole}>
              {roleModal?.id ? 'Save role' : 'Create role'}
            </Button>
          </>
        }
      >
        {roleModal && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Role name" required>
                <Input value={roleModal.name} onChange={(e) => setRoleModal((p) => p && ({ ...p, name: e.target.value }))} placeholder="e.g. AP Supervisor" />
              </Field>
              <Field label="Status">
                <Select value={roleModal.active ? 'enabled' : 'disabled'} onChange={(e) => setRoleModal((p) => p && ({ ...p, active: e.target.value === 'enabled' }))} className="w-full">
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </Select>
              </Field>
            </div>
            {/* Same permission definition as the matrix — they can never drift. */}
            <Field label="Permissions">
              <div className="max-h-80 overflow-y-auto rounded-md border border-line scrollbar-thin">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-canvas">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">Area</th>
                      {ACTIONS.map((a) => <th key={a} className="px-2 py-1.5 text-center font-semibold">{a}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_MODULES.map((m) => (
                      <tr key={m.module} className="border-t border-line-soft">
                        <td className="px-2 py-1.5 font-medium text-ink">{m.module}</td>
                        {ACTIONS.map((a) => {
                          const cell = m.cells[a];
                          if (!cell) return <td key={a} className="px-2 py-1.5 text-center text-line-strong">—</td>;
                          return (
                            <td key={a} className="px-2 py-1.5 text-center">
                              <Tooltip text={cell.allows}>
                                <input
                                  type="checkbox"
                                  aria-label={`${m.module} — ${a}`}
                                  checked={cellGranted(roleModal.permissions, cell)}
                                  onChange={(e) => toggleCell(cell, e.target.checked)}
                                  className="h-3.5 w-3.5 accent-essa-600"
                                />
                              </Tooltip>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Field>
            <p className="rounded-md bg-canvas px-2.5 py-2 text-2xs text-ink-muted">
              These permissions decide both what appears in the menu and what the platform allows — the two always match.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteRole)}
        onClose={() => setDeleteRole(null)}
        tone="danger"
        title={`Delete role — ${deleteRole?.name}`}
        confirmLabel="Delete role"
        loading={roleAction.isPending}
        message={
          <p className="text-xs">
            {deleteRole && data.users.some((u) => u.roleIds.includes(deleteRole.id))
              ? 'This role is still assigned to users — remove the assignments first, or disable the role instead of deleting it.'
              : 'This permanently removes the role. Nobody currently holds it, so no user is affected.'}
          </p>
        }
        onConfirm={() => deleteRole && roleAction.mutate({ op: 'DELETE', row: { id: deleteRole.id } })}
      />
      {/* ------------------------------------------------------- add user */}
      <Modal
        open={Boolean(newUser)}
        onClose={() => setNewUser(null)}
        title="Add user"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewUser(null)}>Cancel</Button>
            <Button
              loading={createUser.isPending}
              disabled={!newUser?.name.trim() || !newUser?.email.trim()}
              onClick={() => newUser && createUser.mutate(newUser)}
            >
              Add user
            </Button>
          </>
        }
      >
        {newUser && (
          <div className="space-y-3">
            <p className="rounded-md bg-canvas px-2.5 py-2 text-2xs text-ink-muted">
              This does not create a password. The person signs in with their ESSA corporate account — adding them here
              is what gives that account access to this platform, and the roles decide what they can do.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Full name" required>
                <Input value={newUser.name} placeholder="e.g. Dewi Lestari" onChange={(e) => setNewUser((u) => u && ({ ...u, name: e.target.value }))} />
              </Field>
              <Field label="Corporate email" required hint="The address they sign in with">
                <Input
                  type="email"
                  value={newUser.email}
                  placeholder="e.g. dewi.lestari@essa.co.id"
                  onChange={(e) => setNewUser((u) => u && ({ ...u, email: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Job title" hint="Shown on the users list; it does not affect what they can do">
              <Input value={newUser.title} placeholder="e.g. AP Processor" onChange={(e) => setNewUser((u) => u && ({ ...u, title: e.target.value }))} />
            </Field>
            <Field label="Roles" hint="What the person can see and do. Leave every role unticked to add the account with no access yet.">
              <div className="space-y-1.5 rounded-md border border-line p-2.5">
                {data.roles.map((r) => (
                  <label key={r.id} className="flex items-start gap-2 text-xs text-ink-secondary">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 accent-essa-600"
                      checked={newUser.roleIds.includes(r.id)}
                      onChange={(e) =>
                        setNewUser((u) => u && ({
                          ...u,
                          roleIds: e.target.checked ? [...u.roleIds, r.id] : u.roleIds.filter((x) => x !== r.id),
                        }))
                      }
                    />
                    <span>
                      <span className="font-medium text-ink">{r.name}</span>
                      {r.description && <span className="block text-2xs text-ink-muted">{r.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Status">
              <Select value={newUser.enabled ? 'enabled' : 'disabled'} onChange={(e) => setNewUser((u) => u && ({ ...u, enabled: e.target.value === 'enabled' }))} className="w-full">
                <option value="enabled">Enabled — they can sign in now</option>
                <option value="disabled">Disabled — add the account but keep it closed for now</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>

    </div>
  );
}
