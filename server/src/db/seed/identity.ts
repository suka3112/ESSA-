import type { AppUser, DoAEntry, Permission, PermissionCode, Role } from '../../core/types';

export const PERMISSIONS: Permission[] = [
  { code: 'DASHBOARD_VIEW', description: 'View AP operations dashboard' },
  { code: 'INVOICE_VIEW', description: 'View invoices and documents' },
  { code: 'INVOICE_EDIT', description: 'Edit invoice working data' },
  { code: 'INVOICE_UPLOAD', description: 'Manually upload invoices (fallback channel)' },
  { code: 'INVOICE_REVALIDATE', description: 'Trigger revalidation runs' },
  { code: 'FIELD_CORRECT', description: 'Correct extracted field values (HITL)' },
  { code: 'VALIDATION_OVERRIDE', description: 'Override failed validation results' },
  { code: 'EXCEPTION_VIEW', description: 'View exception workbench' },
  { code: 'EXCEPTION_MANAGE', description: 'Assign/resolve/close exceptions' },
  { code: 'APPROVAL_VIEW', description: 'View approval queues' },
  { code: 'APPROVAL_ACT', description: 'Approve / reject / send back / delegate' },
  { code: 'TAX_REVIEW', description: 'Perform tax review steps' },
  { code: 'VENDOR_VIEW', description: 'View vendor master snapshot' },
  { code: 'VENDOR_CONTROL', description: 'Set negative flag / enable-disable vendors' },
  { code: 'SAP_VIEW', description: 'View SAP integration status' },
  { code: 'SAP_RETRY', description: 'Retry / reprocess SAP integration jobs' },
  { code: 'BIOMETRIC_VIEW', description: 'View attendance/biometric data' },
  { code: 'CONFIG_VIEW', description: 'View configuration' },
  { code: 'CONFIG_EDIT', description: 'Edit draft configuration' },
  { code: 'CONFIG_PUBLISH', description: 'Publish configuration versions' },
  { code: 'USER_ADMIN', description: 'Manage users, roles and permissions' },
  { code: 'AUDIT_VIEW', description: 'Search the business audit trail' },
  { code: 'TECH_LOG_VIEW', description: 'View technical logs and integration jobs' },
  { code: 'REPORT_VIEW', description: 'View reports' },
  { code: 'NOTIFICATION_VIEW', description: 'View notifications' },
];

const P = (...codes: PermissionCode[]) => codes;
const BASE = P('DASHBOARD_VIEW', 'INVOICE_VIEW', 'NOTIFICATION_VIEW', 'REPORT_VIEW');

export const ROLES: Role[] = [
  {
    id: 'role-ap-processor', code: 'AP_PROCESSOR', name: 'AP Processor', system: true,
    description: 'Processes invoices, corrects extraction, manages exceptions',
    // UI/UX review (Aug 2026): the AP Processor must NOT see Approval
    // navigation or the approval queue — approvals belong to the AP Supervisor.
    permissions: [...BASE, ...P('INVOICE_EDIT', 'INVOICE_UPLOAD', 'INVOICE_REVALIDATE', 'FIELD_CORRECT', 'EXCEPTION_VIEW', 'EXCEPTION_MANAGE', 'VENDOR_VIEW', 'SAP_VIEW', 'BIOMETRIC_VIEW')],
  },
  /**
   * Design review (Anas/Pranay, Aug 2026): the AP Reviewer, AP Approver-desk
   * and AP Manager personas are consolidated into a single AP Supervisor role
   * (client terminology). The role keeps the AP_REVIEWER code so existing
   * workflow references stay valid; it absorbs the former Manager permissions.
   */
  {
    id: 'role-ap-reviewer', code: 'AP_REVIEWER', name: 'AP Supervisor', system: true,
    description: 'Supervises AP processing — HITL review, approvals, overrides and final sign-off (replaces the Reviewer, Approver and Manager personas)',
    // Review, 24 Aug: roles must not be combined in the prototype. The Audit Log
    // and configuration are administration screens, so the AP Supervisor holds
    // neither AUDIT_VIEW nor CONFIG_VIEW.
    permissions: [...BASE, ...P('INVOICE_EDIT', 'INVOICE_UPLOAD', 'INVOICE_REVALIDATE', 'FIELD_CORRECT', 'VALIDATION_OVERRIDE', 'EXCEPTION_VIEW', 'EXCEPTION_MANAGE', 'APPROVAL_VIEW', 'APPROVAL_ACT', 'TAX_REVIEW', 'VENDOR_VIEW', 'VENDOR_CONTROL', 'SAP_VIEW', 'SAP_RETRY', 'BIOMETRIC_VIEW')],
  },
  /**
   * Tax Reviewer (UI/UX review, Aug 2026 — Anas): tax review is a persona of
   * its own and must be represented in the UI. It only sees the tax-review
   * work it is permitted to do — no configuration, no user administration.
   */
  {
    id: 'role-tax-reviewer', code: 'TAX_REVIEWER', name: 'Tax Reviewer', system: true,
    description: 'Reviews the tax details of an invoice before it continues through the approval flow',
    permissions: [...BASE, ...P('TAX_REVIEW', 'APPROVAL_VIEW', 'APPROVAL_ACT', 'EXCEPTION_VIEW', 'VENDOR_VIEW')],
  },
  /**
   * Administrator — the platform administration persona.
   *
   * Review, 24 Aug: roles must not be combined in the prototype. The
   * Administrator configures the platform and can see what is happening for
   * support purposes, but does not process or approve invoices — those are the
   * AP Processor's, Tax Reviewer's and AP Supervisor's work.
   */
  {
    id: 'role-admin', code: 'ADMINISTRATOR', name: 'Administrator', system: true,
    description: 'Configures the platform — invoice configuration, SLA and reminders, approval hierarchy, users, roles and the audit log',
    permissions: [
      ...BASE,
      ...P('EXCEPTION_VIEW', 'VENDOR_VIEW', 'SAP_VIEW', 'BIOMETRIC_VIEW',
        'CONFIG_VIEW', 'CONFIG_EDIT', 'CONFIG_PUBLISH',
        'USER_ADMIN', 'AUDIT_VIEW', 'TECH_LOG_VIEW'),
    ],
  },
  // Removed per design review: AP Manager / AP Approver / Tax Reviewer
  // (merged into AP Supervisor), Support/Technical (server-side only) and
  // Auditor (Administrator covers audit activities).
];

export const USERS: AppUser[] = [
  { id: 'u-priya', entraObjectId: 'e1a2-priya', name: 'Putri Anggraini', email: 'putri.anggraini@essa.co.id', title: 'AP Processor', roleIds: ['role-ap-processor'], groups: ['AP Team'], enabled: true },
  { id: 'u-arjun', entraObjectId: 'e1a2-arjun', name: 'Arif Wibowo', email: 'arif.wibowo@essa.co.id', title: 'AP Supervisor', roleIds: ['role-ap-reviewer'], groups: ['AP Team'], enabled: true },
  { id: 'u-kavitha', entraObjectId: 'e1a2-kavitha', name: 'Kartika Dewi', email: 'kartika.dewi@essa.co.id', title: 'Operations Head', roleIds: [], groups: ['Operations Approvers'], enabled: false },
  { id: 'u-rahul', entraObjectId: 'e1a2-rahul', name: 'Rahmat Hidayat', email: 'rahmat.hidayat@essa.co.id', title: 'Tax Reviewer', roleIds: ['role-tax-reviewer'], groups: ['Tax Team'], enabled: true },
  { id: 'u-meera', entraObjectId: 'e1a2-meera', name: 'Maya Puspita', email: 'maya.puspita@essa.co.id', title: 'AP Supervisor', roleIds: [], groups: ['AP Team', 'Finance Leadership'], enabled: false },
  { id: 'u-suresh', entraObjectId: 'e1a2-suresh', name: 'Surya Nugraha', email: 'surya.nugraha@essa.co.id', title: 'Platform Administrator', roleIds: ['role-admin'], groups: ['IT Admin'], enabled: true },
  // Support/Technical persona removed from the product (design review) — account disabled.
  { id: 'u-fatima', entraObjectId: 'e1a2-fatima', name: 'Fitri Handayani', email: 'fitri.handayani@essa.co.id', title: 'Application Support', roleIds: [], groups: ['IT Support'], enabled: false },
  { id: 'u-vikram', entraObjectId: 'e1a2-vikram', name: 'Vino Kusuma', email: 'vino.kusuma@essa.co.id', title: 'Projects Head', roleIds: [], groups: ['Projects Approvers'], enabled: false },
  // Auditor persona removed (Administrator covers audit activities) — account disabled.
  { id: 'u-ananya', entraObjectId: 'e1a2-ananya', name: 'Ayu Lestari', email: 'ayu.lestari@essa.co.id', title: 'Internal Auditor', roleIds: [], groups: ['Audit'], enabled: false },
  { id: 'u-deepak', entraObjectId: 'e1a2-deepak', name: 'Dimas Prakoso', email: 'dimas.prakoso@essa.co.id', title: 'Facilities Manager', roleIds: [], groups: ['Facilities Approvers'], enabled: false },
];

/**
 * DoA Approval Hierarchy — BPD v0.1.4 §11.2.
 * Approval authority is decided by the invoice amount band; every level in the
 * band must approve in sequence and no level is skipped.
 *
 *   HOS = Head of Section | HOD = Head of Department | HOF = Head of Function
 *   OSH/STH = Operations & Site Head / Site Head | GFD = Group Functional Director
 */
const band = (bandNo: number, minAmount: number, maxAmount: number | null, roles: string[]): DoAEntry[] =>
  roles.map((role, i) => ({
    id: `doa-${bandNo}-${i + 1}`,
    level: i + 1,
    role,
    minAmount,
    maxAmount,
    currency: 'IDR',
    active: true,
  }));

// Band boundaries never repeat: each band starts 1 above the previous band's
// upper limit, so any invoice amount falls in exactly one band and can never
// trigger two different approval workflows (matching is inclusive on both ends).
export const DOA_MATRIX: DoAEntry[] = [
  ...band(1, 0, 2_000_000, ['HOS']),
  ...band(2, 2_000_001, 5_000_000, ['HOS', 'HOD']),
  ...band(3, 5_000_001, 15_000_000, ['HOD', 'HOF']),
  ...band(4, 15_000_001, 50_000_000, ['HOD', 'HOF', 'OSH_STH']),
  ...band(5, 50_000_001, 100_000_000, ['HOD', 'HOF', 'OSH_STH', 'GFD']),
  ...band(6, 100_000_001, null, ['HOD', 'HOF', 'OSH_STH', 'GFD']),
];
