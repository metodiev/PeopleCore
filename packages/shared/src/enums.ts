/**
 * Enumerations mirrored from the Prisma schema. The API stores these string
 * values; clients use them for rendering, filtering and validation. Values
 * must stay in sync with `apps/api/prisma/schema.prisma`.
 */
function enumOf<const T extends readonly string[]>(...values: T): T & { readonly type: T[number] } {
  return values as T & { readonly type: T[number] };
}

export const TenantStatus = enumOf('ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED');
export type TenantStatus = (typeof TenantStatus)[number];

export const TenantPlan = enumOf('FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');
export type TenantPlan = (typeof TenantPlan)[number];

export const UserStatus = enumOf('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');
export type UserStatus = (typeof UserStatus)[number];

export const EmployeeStatus = enumOf('ACTIVE', 'PROBATION', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED');
export type EmployeeStatus = (typeof EmployeeStatus)[number];

export const EmploymentType = enumOf('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY');
export type EmploymentType = (typeof EmploymentType)[number];

export const ContractType = enumOf('PERMANENT', 'FIXED_TERM', 'PROBATION', 'INTERNSHIP', 'CONTRACTOR');
export type ContractType = (typeof ContractType)[number];

export const CompensationChangeType = enumOf('BASE_SALARY', 'HOURLY_RATE', 'BONUS', 'ALLOWANCE', 'ADJUSTMENT');
export type CompensationChangeType = (typeof CompensationChangeType)[number];

export const BenefitType = enumOf(
  'HEALTH_INSURANCE',
  'LIFE_INSURANCE',
  'PENSION',
  'MEAL_VOUCHER',
  'TRANSPORT',
  'PHONE',
  'CAR',
  'GYM',
  'EDUCATION',
  'OTHER',
);
export type BenefitType = (typeof BenefitType)[number];

export const ContractStatus = enumOf('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');
export type ContractStatus = (typeof ContractStatus)[number];

export const Gender = enumOf('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');
export type Gender = (typeof Gender)[number];

export const AttendanceStatus = enumOf('PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'REMOTE', 'LEAVE', 'HOLIDAY', 'WEEKEND');
export type AttendanceStatus = (typeof AttendanceStatus)[number];

export const PunchSource = enumOf('WEB', 'MOBILE', 'KIOSK', 'QR', 'GPS', 'IMPORT', 'MANUAL');
export type PunchSource = (typeof PunchSource)[number];

export const TimeEntryStatus = enumOf('OPEN', 'COMPLETED', 'MISSING_PUNCH', 'CORRECTION_REQUESTED', 'CORRECTED');
export type TimeEntryStatus = (typeof TimeEntryStatus)[number];

export const CorrectionStatus = enumOf('PENDING', 'APPROVED', 'REJECTED');
export type CorrectionStatus = (typeof CorrectionStatus)[number];

export const WorkScheduleType = enumOf('FIXED', 'FLEXIBLE', 'SHIFT', 'ROTATING', 'CUSTOM');
export type WorkScheduleType = (typeof WorkScheduleType)[number];

export const LeaveRequestStatus = enumOf('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
export type LeaveRequestStatus = (typeof LeaveRequestStatus)[number];

export const ApprovalStepStatus = enumOf('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');
export type ApprovalStepStatus = (typeof ApprovalStepStatus)[number];

export const ApproverType = enumOf('MANAGER', 'HR', 'USER');
export type ApproverType = (typeof ApproverType)[number];

export const LeaveAccrualType = enumOf('ANNUAL_FIXED', 'MONTHLY_ACCRUAL', 'NONE');
export type LeaveAccrualType = (typeof LeaveAccrualType)[number];

export const DocumentStatus = enumOf('ACTIVE', 'ARCHIVED', 'EXPIRED');
export type DocumentStatus = (typeof DocumentStatus)[number];

export const DocumentConfidentiality = enumOf('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');
export type DocumentConfidentiality = (typeof DocumentConfidentiality)[number];

export const NoteVisibility = enumOf('HR_ONLY', 'MANAGER', 'PRIVATE');
export type NoteVisibility = (typeof NoteVisibility)[number];

export const GoalType = enumOf('GOAL', 'OKR', 'KPI');
export type GoalType = (typeof GoalType)[number];

export const GoalStatus = enumOf('DRAFT', 'ACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED', 'CANCELLED');
export type GoalStatus = (typeof GoalStatus)[number];

export const GoalPriority = enumOf('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
export type GoalPriority = (typeof GoalPriority)[number];

export const ReviewCycleStatus = enumOf('DRAFT', 'ACTIVE', 'CLOSED');
export type ReviewCycleStatus = (typeof ReviewCycleStatus)[number];

export const ReviewType = enumOf('SELF', 'MANAGER', 'PEER', 'UPWARD');
export type ReviewType = (typeof ReviewType)[number];

export const ReviewStatus = enumOf('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'ACKNOWLEDGED');
export type ReviewStatus = (typeof ReviewStatus)[number];

export const EnrollmentStatus = enumOf('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
export type EnrollmentStatus = (typeof EnrollmentStatus)[number];

export const CertificationStatus = enumOf('VALID', 'EXPIRING', 'EXPIRED', 'REVOKED');
export type CertificationStatus = (typeof CertificationStatus)[number];

export const ExpenseStatus = enumOf(
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'REIMBURSED',
  'CANCELLED',
);
export type ExpenseStatus = (typeof ExpenseStatus)[number];

export const AssetStatus = enumOf('AVAILABLE', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST');
export type AssetStatus = (typeof AssetStatus)[number];

export const AssetCondition = enumOf('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');
export type AssetCondition = (typeof AssetCondition)[number];

export const AssetCategory = enumOf(
  'LAPTOP',
  'PHONE',
  'MONITOR',
  'CAR',
  'ACCESS_CARD',
  'EQUIPMENT',
  'SOFTWARE_LICENSE',
  'OTHER',
);
export type AssetCategory = (typeof AssetCategory)[number];

export const HRRequestType = enumOf('HR', 'CERTIFICATE', 'DOCUMENT', 'PAYROLL', 'EQUIPMENT', 'REMOTE_WORK', 'IT', 'OTHER');
export type HRRequestType = (typeof HRRequestType)[number];

export const HRRequestStatus = enumOf('OPEN', 'IN_PROGRESS', 'WAITING_EMPLOYEE', 'RESOLVED', 'CLOSED', 'CANCELLED');
export type HRRequestStatus = (typeof HRRequestStatus)[number];

export const HRRequestPriority = enumOf('LOW', 'NORMAL', 'HIGH', 'URGENT');
export type HRRequestPriority = (typeof HRRequestPriority)[number];

export const NotificationChannel = enumOf('IN_APP', 'EMAIL', 'PUSH', 'SMS');
export type NotificationChannel = (typeof NotificationChannel)[number];

export const IntegrationProvider = enumOf(
  'GOOGLE',
  'MICROSOFT',
  'SLACK',
  'TEAMS',
  'PAYROLL',
  'ACCOUNTING',
  'RECRUITMENT',
);
export type IntegrationProvider = (typeof IntegrationProvider)[number];

export const IntegrationStatus = enumOf('CONNECTED', 'DISCONNECTED', 'ERROR', 'SYNCING');
export type IntegrationStatus = (typeof IntegrationStatus)[number];

export const CalendarType = enumOf('COMPANY', 'DEPARTMENT', 'TEAM', 'PERSONAL', 'HOLIDAY');
export type CalendarType = (typeof CalendarType)[number];

export const CalendarEventType = enumOf(
  'MEETING',
  'EVENT',
  'HOLIDAY',
  'LEAVE',
  'BUSINESS_TRIP',
  'REMOTE_WORK',
  'TRAINING',
  'OTHER',
);
export type CalendarEventType = (typeof CalendarEventType)[number];

export const EventVisibility = enumOf('PUBLIC', 'TENANT', 'PRIVATE');
export type EventVisibility = (typeof EventVisibility)[number];

export const SyncDirection = enumOf('NONE', 'PULL', 'PUSH', 'BIDIRECTIONAL');
export type SyncDirection = (typeof SyncDirection)[number];

export const ConsentType = enumOf('DATA_PROCESSING', 'MARKETING', 'PRIVACY_POLICY', 'GPS_TRACKING', 'BIOMETRIC');
export type ConsentType = (typeof ConsentType)[number];

export const DataRequestStatus = enumOf('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');
export type DataRequestStatus = (typeof DataRequestStatus)[number];

export const ReportType = enumOf(
  'EMPLOYEES',
  'HEADCOUNT',
  'TURNOVER',
  'ABSENCE',
  'LEAVE',
  'ATTENDANCE',
  'OVERTIME',
  'SALARY',
  'DEPARTMENT',
  'HIRING',
  'TERMINATION',
  'DEMOGRAPHICS',
);
export type ReportType = (typeof ReportType)[number];

export const ReportFormat = enumOf('CSV', 'XLSX', 'PDF', 'JSON');
export type ReportFormat = (typeof ReportFormat)[number];

export const ScheduledFrequency = enumOf('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY');
export type ScheduledFrequency = (typeof ScheduledFrequency)[number];
