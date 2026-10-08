/**
 * Permission catalog — single source of truth shared by the API (guards,
 * seeding) and the clients (navigation/UI gating).
 *
 * Keys follow `<module>.<action>` in dot notation. `*.self` permissions apply
 * to the requesting user's own records; the API turns them into row filters.
 */
export const PERMISSION_CATALOG = [
  // Employees
  { key: 'employees.view', module: 'employees', description: 'View employee profiles' },
  { key: 'employees.create', module: 'employees', description: 'Create employees' },
  { key: 'employees.edit', module: 'employees', description: 'Edit employee profiles' },
  { key: 'employees.delete', module: 'employees', description: 'Delete/archive employees' },
  { key: 'employees.terminate', module: 'employees', description: 'Terminate employment' },
  { key: 'employees.sensitive.view', module: 'employees', description: 'View national IDs, bank accounts, medical data' },
  { key: 'employees.salary.view', module: 'employees', description: 'View salary and compensation data' },
  { key: 'employees.documents.view', module: 'employees', description: 'View employee documents' },
  { key: 'employees.documents.manage', module: 'employees', description: 'Upload/replace/delete employee documents' },
  { key: 'employees.self.view', module: 'employees', description: 'View own profile' },

  // Organization
  { key: 'departments.view', module: 'departments', description: 'View departments' },
  { key: 'departments.manage', module: 'departments', description: 'Manage departments' },
  { key: 'teams.view', module: 'teams', description: 'View teams' },
  { key: 'teams.manage', module: 'teams', description: 'Manage teams' },
  { key: 'locations.view', module: 'locations', description: 'View locations' },
  { key: 'locations.manage', module: 'locations', description: 'Manage locations' },
  { key: 'positions.view', module: 'positions', description: 'View positions' },
  { key: 'positions.manage', module: 'positions', description: 'Manage positions' },

  // Employment & compensation
  { key: 'contracts.view', module: 'contracts', description: 'View contracts' },
  { key: 'contracts.manage', module: 'contracts', description: 'Manage contracts' },
  { key: 'compensation.view', module: 'compensation', description: 'View compensation records' },
  { key: 'compensation.manage', module: 'compensation', description: 'Manage salary and benefits' },
  { key: 'benefits.view', module: 'benefits', description: 'View benefits' },
  { key: 'benefits.manage', module: 'benefits', description: 'Manage benefits' },

  // Leave
  { key: 'leave.view', module: 'leave', description: 'View leave requests and balances' },
  { key: 'leave.self.view', module: 'leave', description: 'View own leave' },
  { key: 'leave.request', module: 'leave', description: 'Submit leave requests' },
  { key: 'leave.approve', module: 'leave', description: 'Approve/reject leave requests' },
  { key: 'leave.manage', module: 'leave', description: 'Manage leave types, policies, balances, holidays' },

  // Attendance & schedules
  { key: 'attendance.view', module: 'attendance', description: 'View attendance records' },
  { key: 'attendance.self.view', module: 'attendance', description: 'View own attendance' },
  { key: 'attendance.clock', module: 'attendance', description: 'Clock in/out' },
  { key: 'attendance.approve', module: 'attendance', description: 'Approve attendance corrections' },
  { key: 'attendance.manage', module: 'attendance', description: 'Manage attendance records' },
  { key: 'schedules.view', module: 'schedules', description: 'View work schedules' },
  { key: 'schedules.manage', module: 'schedules', description: 'Manage work schedules' },

  // Calendar
  { key: 'calendar.view', module: 'calendar', description: 'View calendars and events' },
  { key: 'calendar.manage', module: 'calendar', description: 'Manage calendars and events' },
  { key: 'calendar.sync', module: 'calendar', description: 'Connect and synchronize external calendars' },

  // Documents
  { key: 'documents.view', module: 'documents', description: 'View documents' },
  { key: 'documents.upload', module: 'documents', description: 'Upload documents' },
  { key: 'documents.manage', module: 'documents', description: 'Manage documents, categories and versions' },
  { key: 'documents.acknowledge', module: 'documents', description: 'Acknowledge assigned documents' },

  // Performance & training
  { key: 'performance.view', module: 'performance', description: 'View reviews and goals' },
  { key: 'performance.self.view', module: 'performance', description: 'View own reviews and goals' },
  { key: 'performance.manage', module: 'performance', description: 'Manage review cycles and goals' },
  { key: 'performance.review', module: 'performance', description: 'Submit reviews for others' },
  { key: 'training.view', module: 'training', description: 'View courses, certifications and skills' },
  { key: 'training.manage', module: 'training', description: 'Manage training, certifications and skills' },

  // Expenses & assets
  { key: 'expenses.view', module: 'expenses', description: 'View expenses' },
  { key: 'expenses.self.view', module: 'expenses', description: 'View own expenses' },
  { key: 'expenses.create', module: 'expenses', description: 'Create and submit expenses' },
  { key: 'expenses.approve', module: 'expenses', description: 'Approve/reject expenses' },
  { key: 'expenses.manage', module: 'expenses', description: 'Manage expense categories and settings' },
  { key: 'assets.view', module: 'assets', description: 'View company assets' },
  { key: 'assets.self.view', module: 'assets', description: 'View own assigned assets' },
  { key: 'assets.manage', module: 'assets', description: 'Manage assets and assignments' },

  // Requests (tickets)
  { key: 'requests.view', module: 'requests', description: 'View HR requests' },
  { key: 'requests.self.view', module: 'requests', description: 'View own HR requests' },
  { key: 'requests.create', module: 'requests', description: 'Create HR requests' },
  { key: 'requests.manage', module: 'requests', description: 'Handle HR requests inbox' },

  // Notifications
  { key: 'notifications.self.manage', module: 'notifications', description: 'Manage own notification preferences' },
  { key: 'notifications.manage', module: 'notifications', description: 'Send and manage notifications' },

  // Reporting & search
  { key: 'reports.view', module: 'reports', description: 'View and export reports' },
  { key: 'reports.manage', module: 'reports', description: 'Manage scheduled reports' },
  { key: 'search.global', module: 'search', description: 'Use global search' },

  // Administration
  { key: 'users.view', module: 'users', description: 'View users' },
  { key: 'users.manage', module: 'users', description: 'Manage users, invites and sessions' },
  { key: 'roles.view', module: 'roles', description: 'View roles and permissions' },
  { key: 'roles.manage', module: 'roles', description: 'Manage roles and permissions' },
  { key: 'settings.view', module: 'settings', description: 'View company settings' },
  { key: 'settings.manage', module: 'settings', description: 'Manage company settings' },
  { key: 'integrations.view', module: 'integrations', description: 'View integrations' },
  { key: 'integrations.manage', module: 'integrations', description: 'Manage integrations' },
  { key: 'audit.view', module: 'audit', description: 'View audit logs' },
  { key: 'gdpr.view', module: 'gdpr', description: 'View GDPR requests and consents' },
  { key: 'gdpr.manage', module: 'gdpr', description: 'Manage GDPR exports, erasure and retention' },
  { key: 'billing.view', module: 'billing', description: 'View billing and subscription' },
  { key: 'billing.manage', module: 'billing', description: 'Manage billing and subscription' },
  { key: 'dashboard.view', module: 'dashboard', description: 'View dashboards' },

  // Platform (super admin only)
  { key: 'platform.tenants.manage', module: 'platform', description: 'Manage tenants (platform level)' },
  { key: 'platform.impersonate', module: 'platform', description: 'Impersonate tenant users for support' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];
export type PermissionModule = (typeof PERMISSION_CATALOG)[number]['module'];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

const catalogIndex = new Map<string, (typeof PERMISSION_CATALOG)[number]>(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return catalogIndex.has(value);
}

export function permissionModuleOf(key: PermissionKey): PermissionModule {
  return catalogIndex.get(key)!.module;
}

/** All catalog keys belonging to a module, e.g. `employees.*` → 7 keys. */
export function permissionsOfModule(module: PermissionModule): PermissionKey[] {
  return PERMISSION_CATALOG.filter((p) => p.module === module).map((p) => p.key);
}

/**
 * Company-level permissions — everything except platform administration,
 * which is reserved for the PeopleCore operator (super admin).
 */
export const TENANT_PERMISSION_KEYS: readonly PermissionKey[] = ALL_PERMISSION_KEYS.filter(
  (key) => permissionModuleOf(key) !== 'platform',
);
