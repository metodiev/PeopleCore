import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  TENANT_PERMISSION_KEYS,
  type PermissionKey,
} from './permissions.js';

/** System role keys. Custom roles can be created per tenant on top of these. */
export const SYSTEM_ROLES = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'HR_ADMIN',
  'HR_MANAGER',
  'MANAGER',
  'EMPLOYEE',
  'ACCOUNTANT',
  'READ_ONLY',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[number];

export interface RoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  /** Platform roles operate across tenants and are never tenant-assignable. */
  platformLevel: boolean;
  permissions: readonly PermissionKey[];
}

const viewOnlyPermissions: readonly PermissionKey[] = PERMISSION_CATALOG.filter((p) => p.key.endsWith('.view')).map(
  (p) => p.key as PermissionKey,
);

const selfServicePermissions: readonly PermissionKey[] = [
  'employees.self.view',
  'leave.self.view',
  'leave.request',
  'attendance.self.view',
  'attendance.clock',
  'schedules.view',
  'calendar.view',
  'documents.view',
  'documents.acknowledge',
  'performance.self.view',
  'training.view',
  'expenses.self.view',
  'expenses.create',
  'assets.self.view',
  'requests.self.view',
  'requests.create',
  'notifications.self.manage',
  'reports.view',
  'search.global',
  'dashboard.view',
];

const managerPermissions: readonly PermissionKey[] = [
  ...selfServicePermissions,
  'employees.view',
  'employees.documents.view',
  'departments.view',
  'teams.view',
  'locations.view',
  'positions.view',
  'leave.view',
  'leave.approve',
  'attendance.view',
  'attendance.approve',
  'calendar.manage',
  'performance.view',
  'performance.review',
  'expenses.view',
  'expenses.approve',
  'assets.view',
  'requests.view',
  'requests.manage',
  'documents.upload',
  'reports.manage',
  'integrations.view',
];

const hrManagerPermissions: readonly PermissionKey[] = [
  ...managerPermissions,
  'employees.create',
  'employees.edit',
  'employees.terminate',
  'employees.sensitive.view',
  'employees.salary.view',
  'employees.documents.manage',
  'departments.manage',
  'teams.manage',
  'locations.manage',
  'positions.manage',
  'contracts.view',
  'contracts.manage',
  'compensation.view',
  'benefits.view',
  'benefits.manage',
  'leave.manage',
  'attendance.manage',
  'schedules.manage',
  'documents.manage',
  'performance.manage',
  'training.manage',
  'expenses.manage',
  'assets.manage',
  'users.view',
  'roles.view',
  'settings.view',
  'audit.view',
  'gdpr.view',
  'notifications.manage',
];

const hrAdminPermissions: readonly PermissionKey[] = [
  ...hrManagerPermissions,
  'compensation.manage',
  'users.manage',
  'gdpr.manage',
  'integrations.manage',
  'calendar.sync',
  'settings.manage',
  'billing.view',
];

const accountantPermissions: readonly PermissionKey[] = [
  'dashboard.view',
  'search.global',
  'employees.view',
  'employees.salary.view',
  'compensation.view',
  'compensation.manage',
  'benefits.view',
  'benefits.manage',
  'contracts.view',
  'expenses.view',
  'expenses.approve',
  'expenses.manage',
  'reports.view',
  'reports.manage',
  'billing.view',
  'billing.manage',
  'documents.view',
  'audit.view',
];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'PeopleCore platform operator. Manages tenants across the platform.',
    platformLevel: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: 'COMPANY_ADMIN',
    name: 'Company Admin',
    description: 'Full control of the company workspace, users, permissions, integrations and billing.',
    platformLevel: false,
    permissions: TENANT_PERMISSION_KEYS,
  },
  {
    key: 'HR_ADMIN',
    name: 'HR Admin',
    description: 'Owns HR operations: people, contracts, compensation, policies and reporting.',
    platformLevel: false,
    permissions: [...new Set(hrAdminPermissions)],
  },
  {
    key: 'HR_MANAGER',
    name: 'HR Manager',
    description: 'Runs day-to-day HR work without workspace administration.',
    platformLevel: false,
    permissions: [...new Set(hrManagerPermissions)],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Manages their team: approvals, attendance, performance and team calendar.',
    platformLevel: false,
    permissions: [...new Set(managerPermissions)],
  },
  {
    key: 'EMPLOYEE',
    name: 'Employee',
    description: 'Employee self-service: profile, leave, attendance, requests, documents.',
    platformLevel: false,
    permissions: [...new Set(selfServicePermissions)],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Payroll and finance: compensation, expenses, billing and financial reporting.',
    platformLevel: false,
    permissions: [...new Set(accountantPermissions)],
  },
  {
    key: 'READ_ONLY',
    name: 'Read Only',
    description: 'Read-only access to company records.',
    platformLevel: false,
    permissions: [...new Set<PermissionKey>([...viewOnlyPermissions, 'search.global'])],
  },
];

export const ROLE_DEFINITION_BY_KEY: ReadonlyMap<SystemRoleKey, RoleDefinition> = new Map(
  ROLE_DEFINITIONS.map((r) => [r.key, r]),
);

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return ROLE_DEFINITION_BY_KEY.has(value as SystemRoleKey);
}
