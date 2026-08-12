import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, ChevronDown, CircleHelp, ClipboardCheck, Database, FileText, Fingerprint, Gauge,
  Inbox, LayoutDashboard, ListChecks, LogOut, Menu, MessageSquareWarning, ScrollText,
  Search, Settings, ShieldCheck, TriangleAlert, Upload, UserCog, Users, X, GitBranch, BarChart3, Landmark,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, qs } from '@/lib/api';
import { fmtRelative, fmtMoney } from '@/lib/format';
import { StatusBadge, Badge } from '@/components/ui';

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  perm?: string;
  children?: { label: string; to: string; perm?: string }[];
}

const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={16} />, perm: 'DASHBOARD_VIEW' },
  {
    label: 'Invoice Processing', to: '/invoices', icon: <FileText size={16} />, perm: 'INVOICE_VIEW',
    children: [
      { label: 'Invoices', to: '/invoices' },
      { label: 'Upload Invoice', to: '/invoices/upload', perm: 'INVOICE_UPLOAD' },
      { label: 'Approvals', to: '/approvals', perm: 'APPROVAL_VIEW' },
      { label: 'Exception Workbench', to: '/exceptions', perm: 'EXCEPTION_VIEW' },
    ],
  },
  { label: 'Vendors', to: '/vendors', icon: <Landmark size={16} />, perm: 'VENDOR_VIEW' },
  {
    label: 'Integrations', to: '/integrations/sap', icon: <Database size={16} />, perm: 'SAP_VIEW',
    children: [
      { label: 'SAP Integration', to: '/integrations/sap', perm: 'SAP_VIEW' },
      { label: 'Attendance / Biometric', to: '/integrations/biometric', perm: 'BIOMETRIC_VIEW' },
    ],
  },
  { label: 'Reports', to: '/reports', icon: <BarChart3 size={16} />, perm: 'REPORT_VIEW' },
  {
    label: 'Administration', to: '/admin/configuration', icon: <Settings size={16} />, perm: 'CONFIG_VIEW',
    children: [
      { label: 'Invoice Configuration', to: '/admin/configuration', perm: 'CONFIG_VIEW' },
      { label: 'Workflows & DoA', to: '/admin/workflows', perm: 'CONFIG_VIEW' },
      { label: 'Users & Roles', to: '/admin/users', perm: 'USER_ADMIN' },
    ],
  },
  { label: 'Approval Matrix', to: '/approval-matrix', icon: <GitBranch size={16} />, perm: 'APPROVAL_VIEW' },
  { label: 'Audit Logs', to: '/audit', icon: <ShieldCheck size={16} />, perm: 'AUDIT_VIEW' },
  { label: 'Technical Logs', to: '/tech-logs', icon: <ScrollText size={16} />, perm: 'TECH_LOG_VIEW' },
];

function EssaLogo() {
  return (
    <div className="flex items-center gap-2 px-4 py-4">
      <span className="text-2xl font-black tracking-tight text-essa-600" style={{ fontFamily: 'Inter' }}>
        essa
        <span className="align-super text-xs text-essa-400">●</span>
      </span>
      <span className="mt-1 text-2xs font-semibold uppercase tracking-widest text-ink-muted">AP Automation</span>
    </div>
  );
}

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<{
      invoices: { id: string; invoiceNumber: string; vendorName: string; amount: number; currency: string; lifecycle: string }[];
      vendors: { code: string; name: string; city: string }[];
      exceptions: { id: string; code: string; title: string; status: string; invoiceNumber?: string }[];
      purchaseOrders: { poNumber: string; vendorName: string; openAmount: number }[];
      users: { id: string; name: string; title: string }[];
    }>(`/search${qs({ q })}`),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const go = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };
  const hasResults = data && (data.invoices.length || data.vendors.length || data.exceptions.length || data.purchaseOrders.length || data.users.length);
  return (
    <div ref={ref} className="relative hidden w-80 md:block">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search invoices, vendors, POs, exceptions…"
        aria-label="Global search"
        className="h-8 w-full rounded-md border border-line bg-canvas pl-8 pr-3 text-xs focus:border-essa-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-essa-100"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-9 z-40 max-h-96 overflow-y-auto rounded-lg border border-line bg-white shadow-pop scrollbar-thin">
          {!hasResults && <p className="px-3 py-4 text-center text-xs text-ink-muted">No results for “{q}”</p>}
          {data?.invoices.length ? (
            <div className="p-1.5">
              <p className="px-2 py-1 text-2xs font-semibold uppercase text-ink-faint">Invoices</p>
              {data.invoices.map((i) => (
                <button key={i.id} onClick={() => go(`/invoices/${i.id}`)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-essa-50">
                  <span className="font-medium">{i.invoiceNumber}</span>
                  <span className="truncate text-ink-muted">{i.vendorName}</span>
                  <StatusBadge value={i.lifecycle} />
                </button>
              ))}
            </div>
          ) : null}
          {data?.exceptions.length ? (
            <div className="border-t border-line-soft p-1.5">
              <p className="px-2 py-1 text-2xs font-semibold uppercase text-ink-faint">Exceptions</p>
              {data.exceptions.map((e) => (
                <button key={e.id} onClick={() => go(`/exceptions?focus=${e.id}`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-essa-50">
                  <span className="font-medium">{e.code}</span>
                  <span className="truncate text-ink-muted">{e.title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {data?.vendors.length ? (
            <div className="border-t border-line-soft p-1.5">
              <p className="px-2 py-1 text-2xs font-semibold uppercase text-ink-faint">Vendors</p>
              {data.vendors.map((v) => (
                <button key={v.code} onClick={() => go(`/vendors/${v.code}`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-essa-50">
                  <span className="font-medium">{v.code}</span>
                  <span className="truncate text-ink-muted">{v.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {data?.purchaseOrders.length ? (
            <div className="border-t border-line-soft p-1.5">
              <p className="px-2 py-1 text-2xs font-semibold uppercase text-ink-faint">Purchase Orders</p>
              {data.purchaseOrders.map((p) => (
                <button key={p.poNumber} onClick={() => go(`/integrations/sap?tab=reference&search=${p.poNumber}`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-essa-50">
                  <span className="font-medium">PO {p.poNumber}</span>
                  <span className="truncate text-ink-muted">{p.vendorName}</span>
                  <span className="ml-auto text-ink-muted">{fmtMoney(p.openAmount)} open</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * V1 / V2 version switcher (top-right, beside the profile).
 * V2 = this extended AP Automation experience; V1 = the existing POC portal.
 * Switching back returns to the exact V1 page the user came from - the V1
 * session lives in the V1 app, so no re-login is needed in either direction.
 */
const V1_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_V1_URL || 'http://localhost:3000';

function VersionSwitch() {
  const goV1 = () => {
    const back = sessionStorage.getItem('essa.v1.back');
    window.location.href = back || `${V1_URL}/finance/invoice-dashboard`;
  };
  return (
    <div className="hidden items-center gap-1.5 sm:flex" title="Switch between the existing POC (V1) and the extended AP Automation experience (V2) - same signed-in user, no logout needed.">
      <span className="text-2xs font-semibold text-ink-muted">Version:</span>
      <div role="group" aria-label="Application version" className="inline-flex overflow-hidden rounded-lg border border-essa-600">
        <button onClick={goV1} aria-pressed="false" className="px-3 py-1 text-xs font-bold text-essa-700 transition-colors hover:bg-essa-50">
          V1
        </button>
        <button aria-pressed="true" className="cursor-default bg-essa-600 px-3 py-1 text-xs font-bold text-white">
          V2
        </button>
      </div>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ items: { id: string; category: string; title: string; body: string; read: boolean; createdAt: string; invoiceId?: string; channel: string }[]; unread: number }>('/notifications'),
    refetchInterval: 20_000,
  });
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const markAll = async () => {
    await api.post('/notifications/mark-read', { all: true });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const openItem = async (n: { id: string; invoiceId?: string }) => {
    await api.post('/notifications/mark-read', { ids: [n.id] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    setOpen(false);
    if (n.invoiceId) navigate(`/invoices/${n.invoiceId}`);
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${data?.unread ? ` (${data.unread} unread)` : ''}`} className="relative rounded-md p-1.5 text-ink-secondary hover:bg-line-soft">
        <Bell size={17} />
        {Boolean(data?.unread) && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-semantic-error px-1 text-2xs font-bold text-white">
            {data!.unread > 99 ? '99+' : data!.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-96 rounded-lg border border-line bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
            <p className="text-xs font-semibold">Notifications</p>
            <button onClick={markAll} className="text-2xs font-medium text-essa-700 hover:underline">
              Mark all as read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {!data?.items.length && <p className="px-3 py-6 text-center text-xs text-ink-muted">You're all caught up.</p>}
            {data?.items.slice(0, 30).map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={clsx('flex w-full items-start gap-2 border-b border-line-soft px-3 py-2 text-left hover:bg-essa-50', !n.read && 'bg-essa-50/60')}>
                <span className="mt-0.5">
                  <Badge tone={n.category === 'EXCEPTION' ? 'error' : n.category === 'APPROVAL' ? 'info' : n.category === 'SAP' ? 'pending' : 'neutral'}>{n.category}</Badge>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate text-xs', !n.read ? 'font-semibold text-ink' : 'text-ink-secondary')}>{n.title}</span>
                  <span className="block truncate text-2xs text-ink-muted">{n.body}</span>
                  <span className="block text-2xs text-ink-faint">{fmtRelative(n.createdAt)}</span>
                </span>
                {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-essa-500" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, hasPerm } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const location = useLocation();
  const userRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const visibleNav = NAV.filter((n) => !n.perm || hasPerm(n.perm)).map((n) => ({
    ...n,
    children: n.children?.filter((c) => !c.perm || hasPerm(c.perm)),
  }));

  const sidebar = (
    <aside className={clsx('flex h-full w-[236px] shrink-0 flex-col border-r border-line bg-white')}>
      <EssaLogo />
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        {visibleNav.map((item) => {
          const activeParent = item.children?.some((c) => location.pathname === c.to) || location.pathname === item.to;
          return (
            <div key={item.label} className="mb-0.5">
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={() =>
                  clsx(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                    activeParent ? 'bg-essa-600 text-white shadow-sm' : 'text-ink-secondary hover:bg-essa-50 hover:text-essa-800'
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
              {item.children && activeParent && (
                <div className="ml-4 mt-0.5 border-l border-line pl-2">
                  {item.children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end
                      className={({ isActive }) =>
                        clsx(
                          'block rounded px-2 py-1.5 text-xs font-medium',
                          isActive ? 'bg-essa-50 text-essa-700' : 'text-ink-muted hover:bg-line-soft hover:text-ink'
                        )
                      }
                    >
                      {c.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line px-4 py-3 text-2xs text-ink-faint">
        ESSA AP Automation · v0.1
        <br />
        DEV/UAT environment
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {sidebarOpen && <div className="hidden lg:block">{sidebar}</div>}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 h-full">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-4">
          <button
            aria-label="Toggle navigation"
            onClick={() => {
              if (window.innerWidth < 1024) setMobileOpen((o) => !o);
              else setSidebarOpen((o) => !o);
            }}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-line-soft"
          >
            <Menu size={18} />
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded border border-essa-200 bg-essa-50 p-1 text-essa-700">
              <ClipboardCheck size={14} />
            </span>
            <div>
              <p className="text-xs font-semibold leading-tight text-ink">Welcome, {user?.name.split(' ')[0]}</p>
              <p className="text-2xs leading-tight text-ink-muted">{user?.roleNames.join(' · ')}</p>
            </div>
          </div>
          <div className="flex-1" />
          <GlobalSearch />
          <VersionSwitch />
          <NotificationBell />
          <Link to="/help" aria-label="Help & FAQs" className="rounded-md p-1.5 text-ink-secondary hover:bg-line-soft">
            <CircleHelp size={17} />
          </Link>
          <div ref={userRef} className="relative">
            <button onClick={() => setUserMenu((o) => !o)} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 hover:bg-line-soft" aria-haspopup="menu" aria-expanded={userMenu}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-essa-600 text-2xs font-bold text-white">
                {user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </span>
              <span className="hidden text-xs font-medium sm:block">{user?.name}</span>
              <ChevronDown size={13} className="text-ink-muted" />
            </button>
            {userMenu && (
              <div role="menu" className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-line bg-white py-1 shadow-pop">
                <div className="border-b border-line-soft px-3 py-2">
                  <p className="text-xs font-semibold">{user?.name}</p>
                  <p className="text-2xs text-ink-muted">{user?.email}</p>
                  <p className="mt-0.5 text-2xs text-ink-muted">{user?.title} · {user?.department}</p>
                </div>
                <button
                  role="menuitem"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink-secondary hover:bg-line-soft"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
