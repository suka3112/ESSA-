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
    permissions: [...BASE, ...P('INVOICE_EDIT', 'INVOICE_UPLOAD', 'INVOICE_REVALIDATE', 'FIELD_CORRECT', 'EXCEPTION_VIEW', 'EXCEPTION_MANAGE', 'VENDOR_VIEW', 'SAP_VIEW', 'BIOMETRIC_VIEW', 'APPROVAL_VIEW')],
  },
  {
    id: 'role-ap-reviewer', code: 'AP_REVIEWER', name: 'AP Reviewer', system: true,
    description: 'Reviews HITL corrections and validation outcomes',
    permissions: [...BASE, ...P('INVOICE_REVALIDATE', 'FIELD_CORRECT', 'EXCEPTION_VIEW', 'EXCEPTION_MANAGE', 'APPROVAL_VIEW', 'APPROVAL_ACT', 'VENDOR_VIEW', 'SAP_VIEW', 'BIOMETRIC_VIEW')],
  },
  {
    id: 'role-ap-approver', code: 'AP_APPROVER', name: 'AP Approver', system: true,
    description: 'Department / DoA approver',
    permissions: [...BASE, ...P('APPROVAL_VIEW', 'APPROVAL_ACT', 'EXCEPTION_VIEW', 'VENDOR_VIEW')],
  },
  {
    id: 'role-tax-reviewer', code: 'TAX_REVIEWER', name: 'Tax Reviewer', system: true,
    description: 'Reviews tax treatment on qualifying invoices',
    permissions: [...BASE, ...P('APPROVAL_VIEW', 'APPROVAL_ACT', 'TAX_REVIEW', 'EXCEPTION_VIEW', 'VENDOR_VIEW')],
  },
  {
    id: 'role-ap-manager', code: 'AP_MANAGER', name: 'AP Manager', system: true,
    description: 'Manages AP operations, overrides and final approvals',
    permissions: [...BASE, ...P('INVOICE_EDIT', 'INVOICE_UPLOAD', 'INVOICE_REVALIDATE', 'FIELD_CORRECT', 'VALIDATION_OVERRIDE', 'EXCEPTION_VIEW', 'EXCEPTION_MANAGE', 'APPROVAL_VIEW', 'APPROVAL_ACT', 'TAX_REVIEW', 'VENDOR_VIEW', 'VENDOR_CONTROL', 'SAP_VIEW', 'SAP_RETRY', 'BIOMETRIC_VIEW', 'AUDIT_VIEW', 'CONFIG_VIEW')],
  },
  {
    id: 'role-admin', code: 'ADMINISTRATOR', name: 'Administrator', system: true,
    description: 'Full platform administration including configuration publishing',
    permissions: PERMISSIONS.map((p) => p.code),
  },
  {
    id: 'role-support', code: 'SUPPORT', name: 'Support / Technical', system: true,
    description: 'Technical visibility for troubleshooting - no business actions',
    permissions: [...BASE, ...P('EXCEPTION_VIEW', 'SAP_VIEW', 'SAP_RETRY', 'TECH_LOG_VIEW', 'AUDIT_VIEW', 'BIOMETRIC_VIEW', 'VENDOR_VIEW')],
  },
  {
    id: 'role-auditor', code: 'AUDITOR', name: 'Auditor (View Only)', system: true,
    description: 'Read-only audit access',
    permissions: [...BASE, ...P('AUDIT_VIEW', 'EXCEPTION_VIEW', 'APPROVAL_VIEW', 'VENDOR_VIEW', 'SAP_VIEW', 'CONFIG_VIEW')],
  },
];

export const USERS: AppUser[] = [
  { id: 'u-priya', entraObjectId: 'e1a2-priya', name: 'Priya Sharma', email: 'priya.sharma@essa.co.in', department: 'Accounts Payable', title: 'AP Processor', roleIds: ['role-ap-processor'], groups: ['AP Team'], enabled: true },
  { id: 'u-arjun', entraObjectId: 'e1a2-arjun', name: 'Arjun Mehta', email: 'arjun.mehta@essa.co.in', department: 'Accounts Payable', title: 'Senior AP Analyst', roleIds: ['role-ap-reviewer'], groups: ['AP Team'], enabled: true },
  { id: 'u-kavitha', entraObjectId: 'e1a2-kavitha', name: 'Kavitha Nair', email: 'kavitha.nair@essa.co.in', department: 'Operations', title: 'Operations Head', roleIds: ['role-ap-approver'], groups: ['Operations Approvers'], enabled: true },
  { id: 'u-rahul', entraObjectId: 'e1a2-rahul', name: 'Rahul Verma', email: 'rahul.verma@essa.co.in', department: 'Taxation', title: 'Tax Lead', roleIds: ['role-tax-reviewer'], groups: ['Tax Team'], enabled: true },
  { id: 'u-meera', entraObjectId: 'e1a2-meera', name: 'Meera Krishnan', email: 'meera.krishnan@essa.co.in', department: 'Finance', title: 'AP Manager', roleIds: ['role-ap-manager'], groups: ['AP Team', 'Finance Leadership'], enabled: true },
  { id: 'u-suresh', entraObjectId: 'e1a2-suresh', name: 'Suresh Iyer', email: 'suresh.iyer@essa.co.in', department: 'IT', title: 'Platform Administrator', roleIds: ['role-admin'], groups: ['IT Admin'], enabled: true },
  { id: 'u-fatima', entraObjectId: 'e1a2-fatima', name: 'Fatima Sheikh', email: 'fatima.sheikh@essa.co.in', department: 'IT', title: 'Application Support', roleIds: ['role-support'], groups: ['IT Support'], enabled: true },
  { id: 'u-vikram', entraObjectId: 'e1a2-vikram', name: 'Vikram Rao', email: 'vikram.rao@essa.co.in', department: 'Projects', title: 'Projects Head', roleIds: ['role-ap-approver'], groups: ['Projects Approvers'], enabled: true },
  { id: 'u-ananya', entraObjectId: 'e1a2-ananya', name: 'Ananya Das', email: 'ananya.das@essa.co.in', department: 'Internal Audit', title: 'Internal Auditor', roleIds: ['role-auditor'], groups: ['Audit'], enabled: true },
  { id: 'u-deepak', entraObjectId: 'e1a2-deepak', name: 'Deepak Malhotra', email: 'deepak.malhotra@essa.co.in', department: 'Admin & Facilities', title: 'Facilities Manager', roleIds: ['role-ap-approver'], groups: ['Facilities Approvers'], enabled: false },
];

export const DOA_MATRIX: DoAEntry[] = [
  { id: 'doa-1', department: 'Operations', level: 1, role: 'AP_APPROVER', approverUserId: 'u-kavitha', approverName: 'Kavitha Nair', minAmount: 0, maxAmount: 2_500_000, currency: 'INR', active: true },
  { id: 'doa-2', department: 'Operations', level: 2, role: 'AP_MANAGER', approverUserId: 'u-meera', approverName: 'Meera Krishnan', minAmount: 2_500_000, maxAmount: null, currency: 'INR', active: true },
  { id: 'doa-3', department: 'Projects', level: 1, role: 'AP_APPROVER', approverUserId: 'u-vikram', approverName: 'Vikram Rao', minAmount: 0, maxAmount: 5_000_000, currency: 'INR', active: true },
  { id: 'doa-4', department: 'Projects', level: 2, role: 'AP_MANAGER', approverUserId: 'u-meera', approverName: 'Meera Krishnan', minAmount: 5_000_000, maxAmount: null, currency: 'INR', active: true },
  { id: 'doa-5', department: 'Admin & Facilities', level: 1, role: 'AP_APPROVER', approverUserId: 'u-kavitha', approverName: 'Kavitha Nair', minAmount: 0, maxAmount: 1_000_000, currency: 'INR', active: true },
  { id: 'doa-6', department: 'Accounts Payable', level: 1, role: 'AP_MANAGER', approverUserId: 'u-meera', approverName: 'Meera Krishnan', minAmount: 0, maxAmount: null, currency: 'INR', active: true },
];
