/** Wire-level contracts shared by the API and both clients. */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorBody {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  path: string;
  timestamp: string;
  requestId?: string;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

/** Authenticated principal attached to every request. */
export interface Principal {
  userId: string;
  tenantId: string | null;
  employeeId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  sessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
}

export interface LoginResult {
  mfaRequired: boolean;
  /** Present only when mfaRequired is false. */
  tokens?: AuthTokens;
  /** Short-lived ticket used to complete the MFA challenge. */
  mfaToken?: string;
  user?: Principal;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
}

/** Notification event catalog — drives preferences and delivery. */
export const NOTIFICATION_EVENTS = [
  'leave.requested',
  'leave.approved',
  'leave.rejected',
  'leave.cancelled',
  'leave.balance.low',
  'attendance.correction.requested',
  'attendance.correction.approved',
  'attendance.missing_punch',
  'expense.submitted',
  'expense.approved',
  'expense.rejected',
  'expense.changes_requested',
  'request.created',
  'request.assigned',
  'request.resolved',
  'request.comment',
  'document.expiring',
  'document.assigned',
  'document.acknowledgement.required',
  'contract.expiring',
  'contract.probation.ending',
  'certification.expiring',
  'salary.review.due',
  'performance.review.assigned',
  'goal.due',
  'training.assigned',
  'training.due',
  'employee.birthday',
  'employee.anniversary',
  'employee.welcome',
  'employee.terminated',
  'user.invited',
  'user.password_reset',
  'user.email_verified',
  'user.mfa_enabled',
  'security.new_login',
  'integration.sync_error',
  'integration.sync_completed',
  'approval.required',
  'report.ready',
  'gdpr.export.completed',
  'gdpr.erasure.completed',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = {
  'leave.requested': 'Leave request submitted',
  'leave.approved': 'Leave approved',
  'leave.rejected': 'Leave rejected',
  'leave.cancelled': 'Leave cancelled',
  'leave.balance.low': 'Low leave balance',
  'attendance.correction.requested': 'Attendance correction requested',
  'attendance.correction.approved': 'Attendance correction approved',
  'attendance.missing_punch': 'Missing punch',
  'expense.submitted': 'Expense submitted',
  'expense.approved': 'Expense approved',
  'expense.rejected': 'Expense rejected',
  'expense.changes_requested': 'Expense changes requested',
  'request.created': 'HR request created',
  'request.assigned': 'HR request assigned',
  'request.resolved': 'HR request resolved',
  'request.comment': 'New request comment',
  'document.expiring': 'Document expiring',
  'document.assigned': 'Document assigned',
  'document.acknowledgement.required': 'Document acknowledgement required',
  'contract.expiring': 'Contract expiring',
  'contract.probation.ending': 'Probation period ending',
  'certification.expiring': 'Certification expiring',
  'salary.review.due': 'Salary review due',
  'performance.review.assigned': 'Performance review assigned',
  'goal.due': 'Goal due soon',
  'training.assigned': 'Training assigned',
  'training.due': 'Training due',
  'employee.birthday': 'Employee birthday',
  'employee.anniversary': 'Work anniversary',
  'employee.welcome': 'Welcome message',
  'employee.terminated': 'Employment ended',
  'user.invited': 'User invited',
  'user.password_reset': 'Password reset requested',
  'user.email_verified': 'Email verified',
  'user.mfa_enabled': 'MFA enabled',
  'security.new_login': 'New sign-in detected',
  'integration.sync_error': 'Integration sync error',
  'integration.sync_completed': 'Integration sync completed',
  'approval.required': 'Approval required',
  'report.ready': 'Report ready',
  'gdpr.export.completed': 'Data export completed',
  'gdpr.erasure.completed': 'Data erasure completed',
};

/** Events that are internal/optional for end users (cannot be disabled). */
export const MANDATORY_NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  'user.password_reset',
  'user.email_verified',
  'security.new_login',
];

/**
 * Minimal shape of an uploaded multipart file. Declared here so API services
 * and clients agree on the contract without depending on Express/Multer types.
 */
export interface UploadedFileLike {
  fieldname?: string;
  originalname: string;
  encoding?: string;
  mimetype: string;
  size: number;
  /**
   * Raw bytes. Typed as `Uint8Array` (rather than Node's `Buffer`) so the
   * contract stays usable from the web and React Native clients; `Buffer` is a
   * `Uint8Array` subclass, so server-side upload objects remain assignable.
   */
  buffer: Uint8Array;
  destination?: string;
  filename?: string;
  path?: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptimeSeconds: number;
  checks: Record<string, { status: 'up' | 'down'; latencyMs?: number; message?: string }>;
}
