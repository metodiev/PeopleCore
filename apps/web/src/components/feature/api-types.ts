/**
 * Response shapes used by the pages. They mirror the Prisma models and the
 * serialisers in `apps/api/src/modules/**` — no mocks, no invented fields.
 */

export interface NamedRef {
  id: string;
  name: string;
}

export interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  photoUrl?: string | null;
}

/* ── Employees ──────────────────────────────────────────────────────────── */

export interface EmployeeListItem extends EmployeeRef {
  preferredName?: string | null;
  workEmail: string;
  phone?: string | null;
  status: string;
  hireDate: string;
  terminationDate?: string | null;
  employmentType: string;
  department?: NamedRef | null;
  team?: NamedRef | null;
  location?: NamedRef | null;
  position?: { id: string; title: string } | null;
  manager?: { id: string; firstName: string; lastName: string } | null;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string | null;
  isPrimary: boolean;
}

export interface BankAccount {
  id: string;
  accountHolder: string;
  /** Raw value is returned by the API but must never be rendered. */
  iban: string;
  /** Masked form (e.g. `BG12••••3456`) — always display this one. */
  ibanMasked?: string | null;
  bic?: string | null;
  bankName?: string | null;
  currency?: string | null;
  isPrimary: boolean;
}

export interface EducationItem {
  id: string;
  institution: string;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  grade?: string | null;
}

export interface SkillItem {
  id: string;
  level: number;
  yearsOfExp?: number | null;
  skill: { id: string; name: string; category?: string | null };
}

export interface LanguageItem {
  id: string;
  language: string;
  level: string;
  isNative: boolean;
}

export interface EmployeeProfile {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  photoUrl?: string | null;
  workEmail: string;
  personalEmail?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  nationalId?: string | null;
  hireDate: string;
  terminationDate?: string | null;
  status: string;
  employmentType: string;
  workingHoursPerWeek?: number | null;
  department?: NamedRef | null;
  team?: NamedRef | null;
  location?: NamedRef | null;
  position?: { id: string; title: string } | null;
  manager?: { id: string; firstName: string; lastName: string; photoUrl?: string | null } | null;
  schedule?: { id: string; name: string; startTime?: string | null; endTime?: string | null; workDays?: number[] } | null;
  user?: { id: string; email: string; status: string; lastLoginAt?: string | null; mfaEnabled: boolean } | null;
  emergencyContacts?: EmergencyContact[];
  education?: EducationItem[];
  skills?: SkillItem[];
  languages?: LanguageItem[];
  bankAccounts?: BankAccount[] | null;
  [key: string]: unknown;
}

export interface ContractItem {
  id: string;
  employeeId: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  probationEndDate?: string | null;
  workingHoursPerWeek?: number | null;
  salaryAmount?: number | string | null;
  currency?: string | null;
  notes?: string | null;
  employee?: EmployeeRef;
  position?: { id: string; title: string } | null;
}

export interface EmploymentHistoryItem {
  id: string;
  changeType?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  managerId?: string | null;
  notes?: string | null;
}

export interface CompensationItem {
  id: string;
  changeType: string;
  amount: number | string;
  currency: string;
  effectiveDate: string;
  reason?: string | null;
  notes?: string | null;
}

export interface EmployeeNoteItem {
  id: string;
  body: string;
  visibility: string;
  authorId?: string | null;
  createdAt: string;
}

export interface ExpiringItem {
  id: string;
  name?: string;
  endDate?: string | null;
  probationEndDate?: string | null;
  expiresAt?: string | null;
  employee?: EmployeeRef & { workEmail?: string };
  title?: string;
}

/* ── Leave ──────────────────────────────────────────────────────────────── */

export interface LeaveBalanceItem {
  leaveTypeId: string;
  leaveType: string;
  color?: string | null;
  entitled: number;
  accrued: number;
  available: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface LeaveApprovalItem {
  id: string;
  stepOrder: number;
  approverType: string;
  status: string;
  comment?: string | null;
  approverId?: string | null;
  decidedAt?: string | null;
}

export interface LeaveRequestItem {
  id: string;
  employeeId: string;
  employee?: EmployeeRef;
  leaveType?: { id: string; name: string; color?: string | null; isPaid: boolean };
  startDate: string;
  endDate: string;
  daysRequested: number;
  status: string;
  reason?: string | null;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  createdAt: string;
  approvals?: LeaveApprovalItem[];
}

export interface LeaveTypeItem {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isPaid: boolean;
  requiresApproval: boolean;
  accrualType: string;
  defaultDaysPerYear?: number | null;
  maxCarryOverDays?: number | null;
  allowHalfDay: boolean;
  requiresAttachment: boolean;
  color?: string | null;
  isActive: boolean;
}

export interface LeavePolicyItem {
  id: string;
  name: string;
  description?: string | null;
  approvalChain: Array<{ type: string; approverId: string | null }>;
  minNoticeDays: number;
  maxConsecutiveDays?: number | null;
  requiresAttachmentOverDays?: number | null;
  allowNegativeBalance: boolean;
  isDefault: boolean;
  isActive: boolean;
}

export interface HolidayItem {
  id: string;
  name: string;
  date: string;
  isRecurringYearly: boolean;
  locationId?: string | null;
}

export interface BlackoutItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  leaveTypeId?: string | null;
  reason?: string | null;
}

export interface TeamCalendarEntry {
  id: string;
  employee: EmployeeRef & { departmentId?: string | null };
  leaveType: { name: string; color?: string | null };
  startDate: string;
  endDate: string;
  days: number;
  status: string;
}

/* ── Attendance ─────────────────────────────────────────────────────────── */

export interface AttendanceBreakItem {
  id: string;
  startedAt: string;
  endedAt?: string | null;
}

export interface AttendanceEntryItem {
  id: string;
  employeeId: string;
  date: string;
  clockIn?: string | null;
  clockOut?: string | null;
  workedMinutes?: number | null;
  overtimeMinutes: number;
  lateMinutes: number;
  breakMinutes?: number | null;
  status: string;
  notes?: string | null;
  breaks?: AttendanceBreakItem[];
  employee?: EmployeeRef & { department?: NamedRef | null };
}

export interface AttendanceSummary {
  from: string;
  to: string;
  totals: {
    entries: number;
    workedMinutes: number;
    workedHours: number;
    overtimeMinutes: number;
    overtimeHours: number;
    breakMinutes: number;
    averageWorkedMinutes: number;
    lateDays: number;
    remoteDays: number;
    missingPunches: number;
    absentDays: number;
  };
}

export interface MissingPunchRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  department: NamedRef | null;
  date: string;
  type: 'NO_CLOCK_OUT' | 'ABSENT' | string;
  clockIn: string | null;
  clockOut: string | null;
}

export interface AttendanceCorrectionItem {  id: string;
  employeeId: string;
  date: string;
  requestedClockIn?: string | null;
  requestedClockOut?: string | null;
  requestedStatus?: string | null;
  reason: string;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  employee?: { id: string; employeeNumber?: string; name: string; department?: NamedRef | null };
}

/* ── Documents ──────────────────────────────────────────────────────────── */

export interface DocumentItem {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  confidentiality: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  category?: { id: string; key: string; name: string } | null;
  employee?: EmployeeRef | null;
  currentVersion?: { version: number; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
  versions: number;
  acknowledgments: number;
  createdAt: string;
}

export interface DocumentCategoryItem {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  requiresAcknowledgement: boolean;
  requiresExpiry: boolean;
  defaultRetentionDays?: number | null;
}

export interface DocumentDownload {
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
}

/* ── Users, roles, audit ────────────────────────────────────────────────── */

export interface UserAccountItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  status: string;
  locale: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  roles: Array<{ key: string; name: string }>;
  employee?: { id: string; employeeNumber: string; photoUrl?: string | null } | null;
}

export interface UserSessionItem {
  id: string;
  current?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string;
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  platformLevel: boolean;
  permissions: string[];
  userCount: number;
}

export interface PermissionModule {
  module: string;
  permissions: Array<{ key: string; description: string }>;
}

export interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface TenantProfile {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  locale: string;
  timezone: string;
  currency: string;
  status?: string;
  plan?: string;
  domain?: string | null;
  privacy?: PrivacySettings | null;
  [key: string]: unknown;
}

export interface PrivacySettings {
  id?: string;
  dataRetentionDays?: number | null;
  consentRequired?: boolean;
  allowDataExport?: boolean;
  anonymizeOnErasure?: boolean;
  dpoEmail?: string | null;
  processingNotes?: string | null;
  [key: string]: unknown;
}

export interface InvitationItem {
  id: string;
  email: string;
  roleKeys: string[];
  expiresAt: string;
  createdAt: string;
}

/* ── Expenses, assets, requests ─────────────────────────────────────────── */

export interface ExpenseItem {
  id: string;
  title: string;
  description?: string | null;
  amount: number | string;
  currency: string;
  expenseDate: string;
  status: string;
  category?: { id: string; key?: string; name: string } | null;
  employee?: EmployeeRef | null;
  receiptDocumentId?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  reimbursedAt?: string | null;
  createdAt: string;
}

export interface ExpenseCategoryItem {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  requiresReceipt: boolean;
  maxAmount?: number | string | null;
  isActive: boolean;
}

export interface ExpenseSummary {
  totals: { count: number; amount: number; currency?: string };
  byStatus?: Array<{ status: string; count: number; amount: number }>;
  byCategory?: Array<{ category: string; count: number; amount: number }>;
  byMonth?: Array<{ month: string; amount: number }>;
}

export interface AssetItem {
  id: string;
  category: string;
  name: string;
  description?: string | null;
  serialNumber?: string | null;
  vendor?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | string | null;
  currency?: string | null;
  warrantyEndDate?: string | null;
  condition: string;
  status: string;
  location?: NamedRef | null;
  assignedTo?: EmployeeRef | null;
  assignedAt?: string | null;
  returnedAt?: string | null;
  notes?: string | null;
  history?: AssetAssignmentItem[];
}

export interface AssetAssignmentItem {
  id: string;
  employeeId: string;
  employee?: EmployeeRef;
  assignedAt: string;
  returnedAt?: string | null;
  conditionAtAssign?: string | null;
  conditionAtReturn?: string | null;
  notes?: string | null;
}

export interface AssetDashboard {
  total: number;
  assigned: number;
  available: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  warrantyExpiringWithinDays: number;
  warrantyExpiring: Array<{
    id: string;
    name: string;
    category: string;
    serialNumber?: string | null;
    warrantyEndDate?: string | null;
    assignedTo?: EmployeeRef | null;
  }>;
}

export interface RequestCommentItem {
  id: string;
  authorUserId: string;
  authorName?: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface RequestItem {
  id: string;
  type: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assigneeId?: string | null;
  assignee?: EmployeeRef | null;
  employee?: EmployeeRef | null;
  dueDate?: string | null;
  resolvedAt?: string | null;
  resolution?: string | null;
  comments?: RequestCommentItem[];
  createdAt: string;
  updatedAt: string;
}

export interface RequestStats {
  open: number;
  openByType: Record<string, number>;
  openByPriority: Record<string, number>;
  resolved: number;
  averageResolutionHours: number | null;
  oldestOpen: {
    id: string;
    subject: string;
    type: string;
    priority: string;
    createdAt: string;
    employeeId: string;
    ageHours: number | null;
  } | null;
  oldestOpenAgeHours: number | null;
}

/* ── Performance & training ─────────────────────────────────────────────── */

export interface ReviewCycleItem {
  id: string;
  name: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  status: string;
  includesSelfReview: boolean;
  includesPeerReview: boolean;
  reviewCount?: number;
}

export interface PerformanceReviewItem {
  id: string;
  cycleId: string;
  cycle?: { id: string; name: string; status: string };
  employeeId: string;
  employee?: EmployeeRef;
  reviewerId?: string | null;
  reviewer?: { id: string; firstName: string; lastName: string } | null;
  type: string;
  status: string;
  overallRating?: number | string | null;
  summary?: string | null;
  strengths?: string | null;
  improvements?: string | null;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export interface KeyResultItem {
  id: string;
  title: string;
  targetValue: number | string;
  currentValue: number | string;
  unit?: string | null;
  dueDate?: string | null;
}

export interface GoalItem {
  id: string;
  employeeId: string;
  employee?: { id: string; firstName: string; lastName: string };
  title: string;
  description?: string | null;
  type: string;
  status: string;
  priority: string;
  progress: number;
  weight?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  reviewCycleId?: string | null;
  keyResults?: KeyResultItem[];
  createdAt: string;
}

export interface FeedbackItem {
  id: string;
  subjectEmployeeId: string;
  authorUserId?: string | null;
  authorName?: string | null;
  message: string;
  type: string;
  visibility: string;
  isAnonymous: boolean;
  createdAt: string;
}

export interface PerformanceDashboard {
  activeCycles: Array<{ id: string; name: string; startDate: string; endDate: string; reviewCount: number }>;
  pendingReviews: number;
  reviewsAwaitingMyAction: number;
  averageRating: number | null;
  ratedReviews: number;
  goals: { total: number; byStatus: Record<string, number>; overdue: number; dueWithin30Days: number };
}

export interface CourseItem {
  id: string;
  title: string;
  description?: string | null;
  provider?: string | null;
  url?: string | null;
  category?: string | null;
  durationHours?: number | string | null;
  isRequired: boolean;
  validityMonths?: number | null;
  isActive: boolean;
}

export interface TrainingAssignmentItem {
  id: string;
  employeeId: string;
  employee?: EmployeeRef;
  courseId: string;
  course?: { id: string; title: string; provider?: string | null; isRequired: boolean };
  status: string;
  assignedAt: string;
  dueDate?: string | null;
  completedAt?: string | null;
  score?: number | string | null;
  certificateDocumentId?: string | null;
  notes?: string | null;
}

export interface CertificationItem {
  id: string;
  employeeId: string;
  employee?: EmployeeRef;
  name: string;
  issuer?: string | null;
  issuedDate: string;
  expiresAt?: string | null;
  status: string;
  notes?: string | null;
}

export interface SkillMatrixRow {
  employee: { id: string; firstName: string; lastName: string; employeeNumber?: string; department?: NamedRef | null };
  skills: Array<{ skillId: string; skillName: string; level: number }>;
}

export interface LearningPlanItem {
  id: string;
  employeeId: string;
  employee?: EmployeeRef;
  name: string;
  description?: string | null;
  status: string;
  targetDate?: string | null;
  items?: Array<{ id: string; courseId: string; status: string; order: number; course?: { id: string; title: string } }>;
}

/* ── Reports & integrations ─────────────────────────────────────────────── */

export interface ReportCatalogEntry {
  type: string;
  name: string;
  description: string;
  permissions: string[];
  salary: boolean;
}

export interface ReportResult {
  columns: Array<{ key: string; label: string; type?: string }>;
  rows: Array<Record<string, string | number | null>>;
  summary?: Record<string, string | number>;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SavedReportItem {
  id: string;
  name: string;
  type: string;
  format: string;
  filters?: Record<string, unknown> | null;
  scheduleFrequency?: string | null;
  recipients?: string[];
  isActive?: boolean;
  lastRunAt?: string | null;
  createdAt: string;
}

export interface ReportRunItem {
  id: string;
  type: string;
  format: string;
  status: string;
  rowCount?: number | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  savedReport?: { id: string; name: string } | null;
}

export interface ReportExportResult {
  runId: string;
  type: string;
  format: string;
  columns: Array<{ key: string; label: string; type?: string }>;
  rows: Array<Record<string, string | number | null>>;
  summary?: Record<string, string | number>;
  rowCount: number;
}

export interface IntegrationItem {
  provider: string;
  status: string;
  connected?: boolean;
  externalAccountId?: string | null;
  externalAccountEmail?: string | null;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  scopes?: string[];
  settings?: unknown;
}

export interface IntegrationCatalogEntry {
  provider: string;
  name: string;
  description: string;
  category: string;
  available: boolean;
  reason?: string;
  scopes?: string[];
  connection: {
    id: string;
    status: string;
    connectedAccount: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  } | null;
}

export interface IntegrationConnectionStatus {
  id: string;
  provider: string;
  scopeKey: string;
  status: string;
  connectedAccount: string | null;
  connectedAccountId: string | null;
  scopes: string[];
  lastSyncAt: string | null;
  lastSyncError: string | null;
  mappedCalendars: number;
  mappedEvents: number;
}

/* ── Notifications ──────────────────────────────────────────────────────── */

/* ── Employee 360 ───────────────────────────────────────────────────────── */

export interface BenefitItem {
  id: string;
  type: string;
  name?: string | null;
  startDate: string;
  endDate?: string | null;
  amount?: number | string | null;
  currency?: string | null;
}

export interface Employee360 {
  profile: EmployeeProfile;
  employment: { contracts: ContractItem[]; currentContract: ContractItem | null };
  organization: {
    department?: NamedRef | null;
    team?: NamedRef | null;
    location?: NamedRef | null;
    position?: { id: string; title: string } | null;
    manager?: { id: string; firstName: string; lastName: string; photoUrl?: string | null } | null;
    schedule?: { id: string; name: string; startTime?: string | null; endTime?: string | null; workDays?: number[] } | null;
    history: EmploymentHistoryItem[];
  };
  leave: { year: number; balances: LeaveBalanceItem[]; requests: LeaveRequestItem[] } | null;
  attendance: {
    recent: AttendanceEntryItem[];
    summary: { daysTracked: number; totalWorkedMinutes: number; totalOvertimeMinutes: number; lateDays: number; missingPunches: number };
  } | null;
  calendar: CalendarEventItem[];
  documents: DocumentItem[] | null;
  compensation: { history: CompensationItem[]; current: CompensationItem | null } | null;
  benefits: BenefitItem[];
  performance: PerformanceReviewItem[] | null;
  goals: GoalItem[] | null;
  training: TrainingAssignmentItem[] | null;
  certifications: CertificationItem[] | null;
  assets: AssetItem[] | null;
  expenses: ExpenseItem[] | null;
  requests: RequestItem[] | null;
  notes: EmployeeNoteItem[];
  activity: AuditLogItem[] | null;
  permissions: { sensitive: boolean; salary: boolean; documents: boolean; audit: boolean };
}

export interface NotificationPreferenceItem {  eventType: string;
  channel: string;
  enabled: boolean;
}

export interface GdprOverview {
  exports?: { pending: number; completed: number; total?: number };
  erasureRequests?: { pending: number; completed: number; total?: number };
  consents?: { granted: number; withdrawn: number };
  retentionPolicies?: number;
  [key: string]: unknown;
}

export interface DataExportRequestItem {
  id: string;
  subjectEmployeeId?: string | null;
  requestedById?: string | null;
  status: string;
  format?: string;
  createdAt: string;
  completedAt?: string | null;
}

export interface ErasureRequestItem {
  id: string;
  subjectEmployeeId?: string | null;
  status: string;
  reason?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface RetentionPolicyItem {
  id: string;
  entityType: string;
  retentionDays: number;
  action?: string | null;
  isActive?: boolean;
}

export interface DashboardSection {
  [key: string]: unknown;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location?: string | null;
  type?: string | null;
  isCancelled?: boolean;
  organizer?: EmployeeRef | null;
  attendees?: Array<{ employeeId: string; status: string; employee?: EmployeeRef }>;
}

/* ── Calendar ───────────────────────────────────────────────────────────── */

export interface CalendarListItem {
  id: string;
  name: string;
  type: string;
  color?: string | null;
  isDefault: boolean;
  isReadOnly: boolean;
  ownerEmployeeId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  eventCount: number;
}

export interface CalendarEntry {
  id: string;
  source: 'event' | 'holiday';
  calendarId: string;
  title: string;
  description?: string | null;
  type: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location?: string | null;
  visibility: string;
  organizerEmployeeId?: string | null;
  leaveRequestId?: string | null;
  recurrenceRule?: string | null;
  isCancelled: boolean;
  readOnly: boolean;
  attendees: Array<{ id: string; employeeId: string; status: string }>;
}

/* ── Organization ───────────────────────────────────────────────────────── */

export interface LocationItem {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  isActive: boolean;
  employeeCount?: number;
}

export interface TeamItem {
  id: string;
  name: string;
  description?: string | null;
  department?: NamedRef | null;
  lead?: EmployeeRef | null;
  memberCount?: number;
}

export interface PositionItem {
  id: string;
  title: string;
  code?: string | null;
  level?: string | null;
  department?: NamedRef | null;
  employeeCount?: number;
}

export interface WorkScheduleItem {
  id: string;
  name: string;
  type: string;
  workDays: number[];
  startTime: string;
  endTime: string;
  breakMinutes?: number | null;
  flexibleMinutes?: number | null;
  isDefault: boolean;
  employeeCount?: number;
}

/* ── Settings & self-service ────────────────────────────────────────────── */

export interface TenantOverview {
  users: number;
  employees: number;
  activeEmployees: number;
  departments: number;
  locations: number;
  teams: number;
  pendingInvites: number;
  usersByRole: Array<{ role: string; roleKey: string; count: number }>;
}

export interface NotificationChannelPreference {
  channel: string;
  enabled: boolean;
}

export interface NotificationPreferenceView {
  eventType: string;
  label: string;
  mandatory: boolean;
  channels: NotificationChannelPreference[];
}

export interface LeaveBalanceYear {
  year: number;
  balances: LeaveBalanceItem[];
}

export interface TrainingDashboard {
  assignments: Record<string, number> & { total: number; overdue: number; dueWithin30Days: number; requiredOpen: number };
  certifications: Record<string, number> & { expiringWithinDays: number };
  activeLearningPlans: number;
  completionRate: number;
}

export interface TrainingSkillRow {
  id: string;
  name: string;
  category?: string | null;
  _count?: { employees: number; courses: number };
}

export interface CourseRow extends CourseItem {
  _count?: { assignments: number };
}

export interface ExpenseExportResult {
  filename: string;
  contentType: string;
  body: string;
  rowCount: number;
}

export interface ExpenseSummaryResult {
  from: string | null;
  to: string | null;
  byStatus: Array<{ status: string; currency: string; count: number; total: number }>;
  byCategory: Array<{ categoryId: string; categoryKey: string | null; categoryName: string | null; currency: string; count: number; total: number }>;
}
