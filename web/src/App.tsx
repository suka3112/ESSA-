import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { LoadingState, NoPermission } from './components/ui';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InvoiceListPage from './pages/InvoiceListPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import UploadInvoicePage from './pages/UploadInvoicePage';
import ExceptionsPage from './pages/ExceptionsPage';
import ApprovalMatrixPage from './pages/ApprovalMatrixPage';
import ApprovalsPage from './pages/ApprovalsPage';
import VendorsPage from './pages/VendorsPage';
import VendorDetailPage from './pages/VendorDetailPage';
import SapIntegrationPage from './pages/SapIntegrationPage';
import BiometricPage from './pages/BiometricPage';
import ReportsPage from './pages/ReportsPage';
import ConfigurationPage from './pages/admin/ConfigurationPage';
import WorkflowsPage from './pages/admin/WorkflowsPage';
import SlaPoliciesPage from './pages/admin/sla/SlaPoliciesPage';
import SlaPolicyEditor from './pages/admin/sla/SlaPolicyEditor';
import { EscalationRulesPage, ReminderRulesPage } from './pages/admin/sla/SlaRulesPages';
import BusinessCalendarPage from './pages/admin/sla/BusinessCalendarPage';
import SlaSimulationPage from './pages/admin/sla/SlaSimulationPage';
import SlaMonitorPage from './pages/admin/sla/SlaMonitorPage';
import ExceptionCodesPage from './pages/admin/sla/ExceptionCodesPage';
import UsersPage from './pages/admin/UsersPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import AuditLogPage from './pages/AuditLogPage';
import HelpPage from './pages/HelpPage';

function Guard({ perm, children }: { perm?: string; children: ReactNode }) {
  const { user, loading, hasPerm } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState label="Signing you in…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (perm && !hasPerm(perm)) {
    return (
      <AppShell>
        <NoPermission />
      </AppShell>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Guard perm="DASHBOARD_VIEW"><DashboardPage /></Guard>} />
      <Route path="/invoices" element={<Guard perm="INVOICE_VIEW"><InvoiceListPage /></Guard>} />
      <Route path="/invoices/upload" element={<Guard perm="INVOICE_UPLOAD"><UploadInvoicePage /></Guard>} />
      <Route path="/invoices/:id" element={<Guard perm="INVOICE_VIEW"><InvoiceDetailPage /></Guard>} />
      <Route path="/exceptions" element={<Guard perm="EXCEPTION_VIEW"><ExceptionsPage /></Guard>} />
      <Route path="/approvals" element={<Guard perm="APPROVAL_VIEW"><ApprovalsPage /></Guard>} />
      {/* UI/UX review: no duplicate screens — the approval hierarchy lives only
          in Administration → Workflows & Approval Hierarchy. */}
      <Route path="/approval-matrix" element={<ApprovalMatrixPage />} />
      <Route path="/purchase-orders" element={<Guard perm="SAP_VIEW"><PurchaseOrdersPage /></Guard>} />
      <Route path="/vendors" element={<Guard perm="VENDOR_VIEW"><VendorsPage /></Guard>} />
      <Route path="/vendors/:code" element={<Guard perm="VENDOR_VIEW"><VendorDetailPage /></Guard>} />
      <Route path="/integrations/sap" element={<Guard perm="SAP_VIEW"><SapIntegrationPage /></Guard>} />
      <Route path="/integrations/biometric" element={<Guard perm="BIOMETRIC_VIEW"><BiometricPage /></Guard>} />
      {/* Ingestion is part of the Invoice Workbench (source filter) */}
      <Route path="/ingestion" element={<Navigate to="/invoices" replace />} />
      <Route path="/reports" element={<Guard perm="REPORT_VIEW"><ReportsPage /></Guard>} />
      <Route path="/admin/configuration" element={<Guard perm="CONFIG_VIEW"><ConfigurationPage /></Guard>} />
      {/* Administration → SLA Management (SLA Administration UI Specification §1.2) */}
      <Route path="/admin/sla" element={<Guard perm="CONFIG_VIEW"><SlaPoliciesPage /></Guard>} />
      <Route path="/admin/sla/policies/:id" element={<Guard perm="CONFIG_VIEW"><SlaPolicyEditor /></Guard>} />
      <Route path="/admin/sla/reminders" element={<Guard perm="CONFIG_VIEW"><ReminderRulesPage /></Guard>} />
      <Route path="/admin/sla/escalations" element={<Guard perm="CONFIG_VIEW"><EscalationRulesPage /></Guard>} />
      <Route path="/admin/sla/calendar" element={<Guard perm="CONFIG_VIEW"><BusinessCalendarPage /></Guard>} />
      <Route path="/admin/sla/simulation" element={<Guard perm="CONFIG_VIEW"><SlaSimulationPage /></Guard>} />
      <Route path="/admin/sla/monitor" element={<Guard perm="CONFIG_VIEW"><SlaMonitorPage /></Guard>} />
      <Route path="/admin/sla/exception-codes" element={<Guard perm="CONFIG_VIEW"><ExceptionCodesPage /></Guard>} />
      <Route path="/admin/workflows" element={<Guard perm="CONFIG_VIEW"><WorkflowsPage /></Guard>} />
      <Route path="/admin/users" element={<Guard perm="USER_ADMIN"><UsersPage /></Guard>} />
      <Route path="/audit" element={<Guard perm="AUDIT_VIEW"><AuditLogPage /></Guard>} />
      {/* Technical logs removed from the product (design review) — logging stays server-side. */}
      <Route path="/tech-logs" element={<Navigate to="/audit" replace />} />
      <Route path="/help" element={<Guard><HelpPage /></Guard>} />
      <Route path="*" element={<Guard><div className="py-16 text-center text-sm text-ink-muted">Page not found.</div></Guard>} />
    </Routes>
  );
}
