import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ChevronDown, CircleHelp, ClipboardCheck, FileSpreadsheet, FileText,
  LayoutDashboard, LogOut, Menu, Settings, Landmark,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { displayRoles } from '@/lib/format';

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
      { label: 'Invoice Workbench', to: '/invoices' },
      { label: 'Upload Invoice', to: '/invoices/upload', perm: 'INVOICE_UPLOAD' },
      { label: 'Approvals', to: '/approvals', perm: 'APPROVAL_VIEW' },
      { label: 'Exception Workbench', to: '/exceptions', perm: 'EXCEPTION_VIEW' },
    ],
  },
  { label: 'Vendors', to: '/vendors', icon: <Landmark size={16} />, perm: 'VENDOR_VIEW' },
  // New top-level menu (design review §13): all purchase orders, like Vendors.
  { label: 'Purchase Orders', to: '/purchase-orders', icon: <FileSpreadsheet size={16} />, perm: 'SAP_VIEW' },
  // Removed menus (design review §14/§17): Integrations and Reports are out of
  // BPD scope (exports live on the tables); the Approval Matrix lives inside
  // Administration → Workflows & Approval Hierarchy rather than as a standalone screen.
  /**
   * Administration is a self-contained area for the Administrator. Review,
   * 24 Aug: roles are not combined in the prototype, so the AP Supervisor no
   * longer holds CONFIG_VIEW or AUDIT_VIEW and never sees this menu. The Audit
   * Log lives here as an administration screen; technical/console logs stay
   * server-side only.
   */
  {
    label: 'Administration', to: '/admin/configuration', icon: <Settings size={16} />, perm: 'CONFIG_VIEW',
    children: [
      { label: 'Invoice Configuration', to: '/admin/configuration', perm: 'CONFIG_VIEW' },
      { label: 'SLA & Reminders', to: '/admin/sla', perm: 'CONFIG_VIEW' },
      { label: 'Workflows & Approval Hierarchy', to: '/admin/workflows', perm: 'CONFIG_VIEW' },
      { label: 'Users & Roles', to: '/admin/users', perm: 'USER_ADMIN' },
      { label: 'Audit Log', to: '/audit', perm: 'AUDIT_VIEW' },
    ],
  },
];

/** Approved branding: EAPA — ESSA Accounts Payable Automation. */
function EapaLogo() {
  return (
    <div className="px-4 py-3.5">
      <span className="text-2xl font-black tracking-tight text-essa-600" style={{ fontFamily: 'Inter' }}>
        eapa
        <span className="align-super text-xs text-essa-400">●</span>
      </span>
      <span className="block text-2xs font-semibold uppercase tracking-widest text-ink-muted">ESSA Accounts Payable Automation</span>
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
      <EapaLogo />
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
        EAPA · ESSA Accounts Payable Automation
        <br />
        v0.1 · DEV/UAT environment
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
        {/* Slim header (design review): reduced height, product identity visible,
            no global search, no in-app notification bell, no internal V1/V2 labels. */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-white px-3">
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
              <p className="text-xs font-semibold leading-tight text-ink">
                EAPA <span className="font-normal text-ink-muted">· Welcome, {user?.name.split(' ')[0]}</span>
              </p>
              <p className="text-2xs leading-tight text-ink-muted">{displayRoles(user?.roleNames).join(' · ')}</p>
            </div>
          </div>
          <div className="flex-1" />
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
                  <p className="mt-0.5 text-2xs text-ink-muted">{user?.title}</p>
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
        <main className="flex-1 overflow-y-auto px-5 py-3 scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
