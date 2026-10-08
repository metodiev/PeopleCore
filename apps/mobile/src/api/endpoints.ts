import type {
  AttendanceStatus,
  AuthTokens,
  CorrectionStatus,
  HRRequestPriority,
  HRRequestStatus,
  HRRequestType,
  LeaveRequestStatus,
  LoginResult,
  NotificationChannel,
  NotificationEvent,
  Paginated,
  PunchSource,
} from '@peoplecore/shared';
import { api, ApiError } from './client';
import type {
  AttendanceCorrection,
  AttendanceEntry,
  AttendanceSummary,
  AuthSession,
  CalendarEventItem,
  CalendarFeed,
  CreateCorrectionInput,
  CreateHrRequestInput,
  CreateLeaveRequestInput,
  DashboardLeaveBalance,
  DashboardMeResponse,
  DashboardView,
  DocumentDownload,
  DocumentRow,
  Employee360,
  EmployeeSummary,
  HolidayItem,
  HrRequestComment,
  HrRequestRow,
  LeaveBalancesResponse,
  LeaveCalendarItem,
  LeaveRequestRow,
  LeaveType,
  MeResponse,
  MfaEnableResponse,
  MfaSetupResponse,
  NotificationItem,
  NotificationPreferenceView,
} from './types';

// ── helpers ─────────────────────────────────────────────────────────────────

function settle<T>(promise: Promise<T>): Promise<T | null> {
  return promise.then(
    (value) => value,
    () => null,
  );
}

// ── auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string, tenantSlug?: string) =>
    api.post<LoginResult>('/auth/login', { email, password, ...(tenantSlug ? { tenantSlug } : {}) }),

  verifyMfa: (mfaToken: string, code: string) =>
    api.post<LoginResult>('/auth/mfa/verify', { mfaToken, code }),

  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }, { skipRefresh: true }),

  logout: () => api.post<void>('/auth/logout', undefined, { skipRefresh: true }),

  me: () => api.get<MeResponse>('/auth/me'),

  sessions: () => api.get<AuthSession[]>('/auth/sessions'),

  revokeSession: (id: string) => api.delete<{ revoked: boolean }>(`/auth/sessions/${id}`),

  mfaSetup: () => api.post<MfaSetupResponse>('/auth/mfa/setup'),

  mfaEnable: (code: string) => api.post<MfaEnableResponse>('/auth/mfa/enable', { code }),

  mfaDisable: (code: string) => api.post<{ disabled: boolean }>('/auth/mfa/disable', { code }),
};

// ── dashboard ───────────────────────────────────────────────────────────────

/**
 * Dashboard data from `GET /dashboard/me`. Users without `dashboard.view`
 * (or API builds where the aggregate endpoint is absent) fall back to
 * composing the same cards from the module endpoints.
 */
export async function fetchDashboard(options: { canApprove?: boolean } = {}): Promise<DashboardView> {
  try {
    const [me, approvals] = await Promise.all([
      api.get<DashboardMeResponse>('/dashboard/me'),
      options.canApprove ? settle(leaveApi.pendingApprovals({ pageSize: 1 })) : Promise.resolve(null),
    ]);
    return { ...me, pendingApprovals: approvals?.meta.total ?? null };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status !== 403 && status !== 404 && status !== 405) throw error;
    return composeDashboard(options);
  }
}

async function composeDashboard(options: { canApprove?: boolean }): Promise<DashboardView> {
  const now = toIsoDay(new Date());
  const [attendance, balances, pendingRequests, upcomingLeave, approvals, notifications, entries] = await Promise.all([
    settle(attendanceApi.today()),
    settle(leaveApi.myBalances()),
    settle(leaveApi.requests({ status: 'PENDING', pageSize: 5 })),
    settle(leaveApi.requests({ status: 'APPROVED', pageSize: 5, sortBy: 'startDate', sortOrder: 'asc' })),
    options.canApprove ? settle(leaveApi.pendingApprovals({ pageSize: 1 })) : Promise.resolve(null),
    settle(notificationsApi.list({ unreadOnly: true, pageSize: 1 })),
    settle(calendarApi.events(toIsoDay(new Date()), toIsoDay(new Date(Date.now() + 30 * 86_400_000)))),
  ]);

  if (
    attendance === null &&
    balances === null &&
    pendingRequests === null &&
    upcomingLeave === null &&
    notifications === null &&
    entries === null
  ) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the PeopleCore API');
  }

  const calendarEntries = (entries ?? []).filter((entry) => entry.source === 'event');
  const leaveBalances: DashboardLeaveBalance[] = (balances?.balances ?? []).map((balance) => ({
    leaveTypeId: balance.leaveTypeId,
    leaveType: balance.leaveType,
    leaveTypeKey: balance.leaveTypeKey,
    color: balance.color,
    entitled: balance.entitled,
    accrued: balance.accrued,
    used: balance.used,
    pending: balance.pending,
    remaining: balance.remaining,
  }));

  return {
    employee: null,
    attendance: attendance
      ? {
          id: attendance.id,
          date: attendance.date,
          status: attendance.status,
          clockIn: attendance.clockIn,
          clockOut: attendance.clockOut,
          workedMinutes: attendance.workedMinutes,
          overtimeMinutes: attendance.overtimeMinutes,
          breakMinutes: attendance.breakMinutes,
        }
      : null,
    schedule: null,
    leave: {
      year: balances?.year ?? new Date().getFullYear(),
      balances: leaveBalances,
      remainingDays: leaveBalances.reduce((sum, balance) => sum + balance.remaining, 0),
    },
    upcomingLeave: (upcomingLeave?.data ?? [])
      .filter((request) => request.endDate >= now)
      .map((request) => ({
        id: request.id,
        leaveType: request.leaveType.name,
        color: request.leaveType.color,
        status: request.status,
        startDate: request.startDate,
        endDate: request.endDate,
        days: request.daysRequested,
        startHalfDay: request.startHalfDay,
        endHalfDay: request.endHalfDay,
      })),
    calendar: {
      today: calendarEntries.filter((entry) => entry.startAt.slice(0, 10) === now),
      upcoming: calendarEntries.filter((entry) => entry.startAt.slice(0, 10) > now),
    },
    pendingRequests: {
      leave: pendingRequests?.meta.total ?? 0,
      expenses: 0,
      corrections: 0,
      hr: 0,
      total: pendingRequests?.meta.total ?? 0,
    },
    unreadNotifications: notifications?.meta.total ?? 0,
    expiringDocuments: [],
    pendingApprovals: approvals?.meta.total ?? null,
  };
}

function toIsoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// ── leave ───────────────────────────────────────────────────────────────────

export interface LeaveRequestQuery {
  status?: LeaveRequestStatus;
  leaveTypeId?: string;
  employeeId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const leaveApi = {
  types: () => api.get<LeaveType[]>('/leave/types'),

  myBalances: (year?: number) =>
    api.get<LeaveBalancesResponse>('/leave/balances/me', { query: { year } }),

  requests: (query: LeaveRequestQuery = {}) =>
    api.get<Paginated<LeaveRequestRow>>('/leave/requests', { query: { ...query } }),

  pendingApprovals: (query: LeaveRequestQuery = {}) =>
    api.get<Paginated<LeaveRequestRow>>('/leave/requests/pending-approval', { query: { ...query } }),

  request: (id: string) => api.get<LeaveRequestRow>(`/leave/requests/${id}`),

  create: (input: CreateLeaveRequestInput) => api.post<LeaveRequestRow>('/leave/requests', input),

  cancel: (id: string, reason?: string) =>
    api.post<LeaveRequestRow>(`/leave/requests/${id}/cancel`, { reason }),

  approve: (id: string, comment?: string) =>
    api.post<LeaveRequestRow>(`/leave/requests/${id}/approve`, { comment }),

  reject: (id: string, comment?: string) =>
    api.post<LeaveRequestRow>(`/leave/requests/${id}/reject`, { comment }),

  calendar: (from: string, to: string) =>
    api.get<LeaveCalendarItem[]>('/leave/calendar', { query: { from, to } }),

  holidays: (year: number) => api.get<HolidayItem[]>('/leave/holidays', { query: { year } }),
};

// ── attendance ──────────────────────────────────────────────────────────────

export interface AttendanceQuery {
  employeeId?: string;
  from?: string;
  to?: string;
  status?: AttendanceStatus;
  page?: number;
  pageSize?: number;
}

export const attendanceApi = {
  today: () => api.get<AttendanceEntry | null>('/attendance/today'),

  clockIn: (source: PunchSource = 'MOBILE') =>
    api.post<AttendanceEntry>('/attendance/clock-in', { source }),

  clockOut: (source: PunchSource = 'MOBILE') =>
    api.post<AttendanceEntry>('/attendance/clock-out', { source }),

  startBreak: () => api.post<AttendanceEntry>('/attendance/breaks/start', {}),

  endBreak: () => api.post<AttendanceEntry>('/attendance/breaks/end', {}),

  entries: (query: AttendanceQuery = {}) =>
    api.get<Paginated<AttendanceEntry>>('/attendance', { query: { ...query } }),

  summary: (query: { from?: string; to?: string } = {}) =>
    api.get<AttendanceSummary>('/attendance/summary', { query }),

  corrections: (query: { status?: CorrectionStatus; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<AttendanceCorrection>>('/attendance/corrections', { query: { ...query } }),

  createCorrection: (input: CreateCorrectionInput) =>
    api.post<AttendanceCorrection>('/attendance/corrections', input),
};

// ── notifications ───────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (query: { unreadOnly?: boolean; type?: string; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<NotificationItem>>('/notifications', { query: { ...query } }),

  markRead: (id: string) => api.post<NotificationItem>(`/notifications/${id}/read`),

  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all'),

  preferences: () => api.get<NotificationPreferenceView[]>('/notifications/preferences'),

  updatePreferences: (
    preferences: Array<{ eventType: NotificationEvent; channel: NotificationChannel; enabled: boolean }>,
  ) => api.put<NotificationPreferenceView[]>('/notifications/preferences', { preferences }),

  registerDevice: (input: { token: string; platform: string; deviceName?: string }) =>
    api.post<{ id: string }>('/notifications/devices', input),

  removeDevice: (token: string) =>
    api.delete<{ deleted: boolean }>(`/notifications/devices/${encodeURIComponent(token)}`),
};

// ── documents ───────────────────────────────────────────────────────────────

export const documentsApi = {
  list: (query: { search?: string; categoryId?: string; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<DocumentRow>>('/documents', { query: { ...query } }),

  download: (id: string) => api.get<DocumentDownload>(`/documents/${id}/download`),

  acknowledge: (id: string, signature?: string) =>
    api.post<{ acknowledged: boolean }>(`/documents/${id}/acknowledge`, { signature }),
};

// ── team ────────────────────────────────────────────────────────────────────

export const teamApi = {
  employees: (query: { search?: string; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<EmployeeSummary>>('/employees', { query: { pageSize: 100, ...query } }),

  employee360: (id: string) => api.get<Employee360>(`/employees/${id}/360`),
};

// ── HR requests ─────────────────────────────────────────────────────────────

export const hrRequestsApi = {
  list: (query: { status?: HRRequestStatus; type?: HRRequestType; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<HrRequestRow>>('/requests', { query: { ...query } }),

  detail: (id: string) => api.get<HrRequestRow>(`/requests/${id}`),

  create: (input: CreateHrRequestInput) => api.post<HrRequestRow>('/requests', input),

  addComment: (id: string, body: string) =>
    api.post<HrRequestComment>(`/requests/${id}/comments`, { body }),
};

// ── calendar ────────────────────────────────────────────────────────────────

export const calendarApi = {
  events: (from: string, to: string) =>
    api.get<CalendarEventItem[]>('/calendar/events', { query: { from, to } }),

  /** Events + approved leave + holidays for a date range. */
  async feed(range: { from: string; to: string }): Promise<CalendarFeed> {
    const year = Number(range.from.slice(0, 4)) || new Date().getFullYear();
    const [entries, leave, holidays] = await Promise.all([
      settle(calendarApi.events(range.from, range.to)),
      settle(leaveApi.calendar(range.from, range.to)),
      settle(leaveApi.holidays(year)),
    ]);
    return {
      entries: entries ?? [],
      leave: leave ?? [],
      holidays: holidays ?? [],
    };
  },
};

export { ApiError };
export type { HRRequestPriority, HRRequestStatus };
