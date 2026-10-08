import type {
  AttendanceStatus,
  CorrectionStatus,
  DocumentStatus,
  HRRequestPriority,
  HRRequestStatus,
  HRRequestType,
  LeaveRequestStatus,
  NotificationChannel,
  NotificationEvent,
} from '@peoplecore/shared';

export type { Paginated } from '@peoplecore/shared';

// ── Auth ────────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  locale: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  status: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  locale?: string;
  timezone?: string;
  currency?: string;
}

/** `GET /auth/me` */
export interface MeResponse {
  user: SessionUser;
  tenant: TenantSummary | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  employeeId: string | null;
}

/** `GET /auth/sessions` */
export interface AuthSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

/** `POST /auth/mfa/setup` */
export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  recoveryCodes?: string[];
}

/** `POST /auth/mfa/enable` */
export interface MfaEnableResponse {
  enabled: boolean;
  recoveryCodes: string[];
}

// ── Employees ───────────────────────────────────────────────────────────────

export interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  employeeNumber?: string | null;
  workEmail?: string | null;
}

export interface EmployeeSummary extends EmployeeRef {
  status: string;
  hireDate?: string | null;
  terminationDate?: string | null;
  employmentType?: string | null;
  department?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
  position?: { id: string; title: string } | null;
  manager?: { id: string; firstName: string; lastName: string } | null;
}

export interface Employee360LeaveBalance {
  leaveTypeId: string;
  leaveType: string;
  color?: string | null;
  entitled: number;
  accrued: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface Employee360 {
  profile: Record<string, unknown> & {
    id?: string;
    firstName?: string;
    lastName?: string;
    workEmail?: string | null;
    phone?: string | null;
    employeeNumber?: string | null;
    hireDate?: string | null;
    photoUrl?: string | null;
  };
  employment: {
    contracts?: Array<Record<string, unknown>>;
    currentContract?: Record<string, unknown> | null;
  };
  organization: {
    department?: { id: string; name: string } | null;
    team?: { id: string; name: string } | null;
    location?: { id: string; name: string } | null;
    position?: { id: string; title: string } | null;
    manager?: { id: string; firstName: string; lastName: string } | null;
  };
  leave?: {
    year: number;
    balances: Employee360LeaveBalance[];
    requests: LeaveRequestRow[];
  } | null;
  attendance?: {
    entries?: AttendanceEntry[];
    summary?: AttendanceSummary | null;
  } | null;
}

// ── Leave ───────────────────────────────────────────────────────────────────

export interface LeaveType {
  id: string;
  key: string;
  name: string;
  color?: string | null;
  isPaid?: boolean;
  requiresDocument?: boolean;
  isActive?: boolean;
}

/** `GET /leave/balances/me` */
export interface LeaveBalancesResponse {
  year: number;
  balances: Array<{
    id: string;
    leaveTypeId: string;
    leaveTypeKey: string;
    leaveType: string;
    color?: string | null;
    isPaid?: boolean;
    entitled: number;
    accrued: number;
    available: number;
    used: number;
    pending: number;
    remaining: number;
  }>;
}

export interface LeaveApprovalStep {
  id: string;
  stepOrder: number;
  status: string;
  approverId: string;
  comment?: string | null;
  decidedAt?: string | null;
}

export interface LeaveRequestRow {
  id: string;
  status: LeaveRequestStatus;
  startDate: string;
  endDate: string;
  daysRequested: number;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  reason?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  decisionComment?: string | null;
  employee: EmployeeRef;
  leaveType: { id: string; name: string; color?: string | null; isPaid?: boolean };
  approvals?: LeaveApprovalStep[];
}

export interface CreateLeaveRequestInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  reason?: string;
}

/** `GET /leave/calendar` */
export interface LeaveCalendarItem {
  id: string;
  employee: { id: string; firstName: string; lastName: string; photoUrl?: string | null; departmentId?: string | null };
  leaveType: { name: string; color?: string | null };
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveRequestStatus;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export interface AttendanceBreak {
  id: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

export interface AttendanceEntry {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: AttendanceStatus;
  entryStatus?: string;
  workedMinutes: number;
  overtimeMinutes?: number;
  breakMinutes?: number;
  remote?: boolean;
  notes?: string | null;
  breaks: AttendanceBreak[];
}

/** `GET /attendance/summary` */
export interface AttendanceSummary {
  from?: string;
  to?: string;
  workedMinutes?: number;
  overtimeMinutes?: number;
  lateDays?: number;
  remoteDays?: number;
  absentDays?: number;
  missingPunches?: number;
  entries?: number;
}

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  date: string;
  requestedClockIn: string | null;
  requestedClockOut: string | null;
  requestedStatus?: AttendanceStatus | null;
  reason: string;
  status: CorrectionStatus;
  reviewComment?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  employee?: EmployeeRef;
}

export interface CreateCorrectionInput {
  date: string;
  requestedClockIn?: string;
  requestedClockOut?: string;
  requestedStatus?: AttendanceStatus;
  reason: string;
}

// ── Notifications ───────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  type: NotificationEvent | string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationChannelPreference {
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationPreferenceView {
  eventType: NotificationEvent;
  label: string;
  mandatory: boolean;
  channels: NotificationChannelPreference[];
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string;
  name: string;
  description?: string | null;
  status: DocumentStatus;
  confidentiality?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  category?: { id: string; key: string; name: string } | null;
  employee?: EmployeeRef | null;
  currentVersion?: {
    id: string;
    version: number;
    fileName: string;
    mimeType: string;
    size?: number;
    createdAt: string;
  } | null;
  acknowledgedAt?: string | null;
  versionCount?: number;
  acknowledgmentCount?: number;
}

/** `GET /documents/:id/download` */
export interface DocumentDownload {
  url: string;
  fileName: string;
  mimeType: string;
  expiresInSeconds?: number;
}

// ── HR requests ─────────────────────────────────────────────────────────────

export interface HrRequestComment {
  id: string;
  requestId: string;
  authorUserId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; firstName: string; lastName: string } | null;
}

export interface HrRequestRow {
  id: string;
  employeeId: string;
  type: HRRequestType;
  subject: string;
  description: string;
  priority: HRRequestPriority;
  status: HRRequestStatus;
  dueDate?: string | null;
  assigneeId?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: EmployeeRef | null;
  comments?: HrRequestComment[];
  _count?: { comments: number };
}

export interface CreateHrRequestInput {
  type: HRRequestType;
  subject: string;
  description: string;
  priority?: HRRequestPriority;
  dueDate?: string;
}

// ── Calendar ────────────────────────────────────────────────────────────────

/** `GET /calendar/events` — calendar entries mirror the API's `CalendarEntry`. */
export interface CalendarEventItem {
  id: string;
  source: 'event' | 'holiday';
  calendarId: string;
  title: string;
  description: string | null;
  type: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  visibility?: string;
  organizerEmployeeId?: string | null;
  leaveRequestId?: string | null;
  isCancelled?: boolean;
  readOnly?: boolean;
  attendees?: Array<{ id: string; employeeId: string; status: string }>;
}

/** `GET /leave/holidays` */
export interface HolidayItem {
  id: string;
  name: string;
  date: string;
  isRecurringYearly?: boolean;
  locationId?: string | null;
}

export interface MonthRange {
  from: string;
  to: string;
}

/** Aggregated calendar feed used by the Calendar screen. */
export interface CalendarFeed {
  entries: CalendarEventItem[];
  leave: LeaveCalendarItem[];
  holidays: HolidayItem[];
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardAttendance {
  id: string | null;
  date: string;
  status: AttendanceStatus | null;
  clockIn: string | null;
  clockOut: string | null;
  workedMinutes: number;
  lateMinutes?: number | null;
  overtimeMinutes?: number | null;
  breakMinutes?: number | null;
}

export interface DashboardSchedule {
  id: string;
  name: string;
  type: string;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | null;
}

export interface DashboardLeaveBalance {
  leaveTypeId: string;
  leaveType: string;
  leaveTypeKey: string;
  color?: string | null;
  entitled: number;
  accrued: number;
  carriedOver?: number;
  adjustment?: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface DashboardUpcomingLeave {
  id: string;
  leaveType: string;
  color?: string | null;
  status: LeaveRequestStatus;
  startDate: string;
  endDate: string;
  days: number;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
}

export interface DashboardPendingRequests {
  leave: number;
  expenses: number;
  corrections: number;
  hr: number;
  total: number;
}

export interface DashboardExpiringDocument {
  id: string;
  name: string;
  category: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
}

/** `GET /dashboard/me` */
export interface DashboardMeResponse {
  employee: EmployeeSummary | null;
  attendance: DashboardAttendance | null;
  schedule: DashboardSchedule | null;
  leave: { year: number; balances: DashboardLeaveBalance[]; remainingDays: number };
  upcomingLeave: DashboardUpcomingLeave[];
  calendar: { today: CalendarEventItem[]; upcoming: CalendarEventItem[] };
  pendingRequests: DashboardPendingRequests;
  unreadNotifications: number;
  expiringDocuments: DashboardExpiringDocument[];
}

/** View model rendered by the Dashboard screen. */
export interface DashboardView extends DashboardMeResponse {
  /** Filled for users with `leave.approve`; null when not a manager or unavailable. */
  pendingApprovals: number | null;
}
