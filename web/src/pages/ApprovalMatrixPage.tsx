/**
 * Legacy route.
 *
 * UI/UX review (Aug 2026): "There is no extra screen, nothing extra." The
 * approval hierarchy is maintained in exactly one place — Administration →
 * Workflows & Approval Hierarchy — so this old entry point simply forwards
 * there instead of duplicating the same table on a second screen.
 */
import { Navigate } from 'react-router-dom';

export default function ApprovalMatrixPage() {
  return <Navigate to="/admin/workflows" replace />;
}
