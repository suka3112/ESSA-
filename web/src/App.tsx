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
import ApprovalsPage from './pages/ApprovalsPage';
import ApprovalMatrixPage from './pages/ApprovalMatrixPage';
import VendorsPage from './pages/VendorsPage';
import VendorDetailPage from './pages/VendorDetailPage';
import SapIntegrationPage from './pages/SapIntegrationPage';
import BiometricPage from './pages/BiometricPage';
import ReportsPage from './pages/ReportsPage';
import ConfigurationPage from './pages/admin/ConfigurationPage';
import WorkflowsPage from './pages/admin/WorkflowsPage';
import UsersPage from './pages/admin/UsersPage';
import AuditLogPage from './pages/AuditLogPage';
import TechLogsPage from './pages/TechLogsPage';
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
      <Route path="/approval-matrix" element={<Guard perm="APPROVAL_VIEW"><ApprovalMatrixPage /></Guard>} />
      <Route path="/vendors" element={<Guard perm="VENDOR_VIEW"><VendorsPage /></Guard>} />
      <Route path="/vendors/:code" element={<Guard perm="VENDOR_VIEW"><VendorDetailPage /></Guard>} />
      <Route path="/integrations/sap" element={<Guard perm="SAP_VIEW"><SapIntegrationPage /></Guard>} />
      <Route path="/integrations/biometric" element={<Guard perm="BIOMETRIC_VIEW"><BiometricPage /></Guard>} />
      {/* Ingestion is part of the Invoice Workbench (source filter) */}
      <Route path="/ingestion" element={<Navigate to="/invoices" replace />} />
      <Route path="/reports" element={<Guard perm="REPORT_VIEW"><ReportsPage /></Guard>} />
      <Route path="/admin/configuration" element={<Guard perm="CONFIG_VIEW"><ConfigurationPage /></Guard>} />
      <Route path="/admin/workflows" element={<Guard perm="CONFIG_VIEW"><WorkflowsPage /></Guard>} />
      <Route path="/admin/users" element={<Guard perm="USER_ADMIN"><UsersPage /></Guard>} />
      <Route path="/audit" element={<Guard perm="AUDIT_VIEW"><AuditLogPage /></Guard>} />
      <Route path="/tech-logs" element={<Guard perm="TECH_LOG_VIEW"><TechLogsPage /></Guard>} />
      <Route path="/help" element={<Guard><HelpPage /></Guard>} />
      <Route path="*" element={<Guard><div className="py-16 text-center text-sm text-ink-muted">Page not found.</div></Guard>} />
    </Routes>
  );
}
