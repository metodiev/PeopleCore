import type {
  AttendanceStatus,
  CorrectionStatus,
  DocumentStatus,
  HRRequestPriority,
  HRRequestStatus,
  LeaveRequestStatus,
} from '@peoplecore/shared';
import { Badge } from './badge';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n';
import type { Tone } from '@/lib/theme';

const LEAVE_STATUS_TONE: Record<LeaveRequestStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

const LEAVE_STATUS_KEY: Record<LeaveRequestStatus, MessageKey> = {
  DRAFT: 'common.none',
  PENDING: 'leave.approvalsPending',
  APPROVED: 'leave.approve',
  REJECTED: 'leave.reject',
  CANCELLED: 'common.cancel',
};

const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, Tone> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
  HALF_DAY: 'info',
  REMOTE: 'info',
  LEAVE: 'brand',
  HOLIDAY: 'neutral',
  WEEKEND: 'neutral',
};

const ATTENDANCE_STATUS_KEY: Record<AttendanceStatus, MessageKey> = {
  PRESENT: 'attendance.status.PRESENT',
  LATE: 'attendance.status.LATE',
  ABSENT: 'attendance.status.ABSENT',
  HALF_DAY: 'attendance.status.HALF_DAY',
  REMOTE: 'attendance.status.REMOTE',
  LEAVE: 'attendance.status.LEAVE',
  HOLIDAY: 'attendance.status.HOLIDAY',
  WEEKEND: 'attendance.status.WEEKEND',
};

const ENTRY_STATUS_KEY: Record<string, MessageKey> = {
  OPEN: 'attendance.entryStatus.OPEN',
  COMPLETED: 'attendance.entryStatus.COMPLETED',
  MISSING_PUNCH: 'attendance.entryStatus.MISSING_PUNCH',
  CORRECTION_REQUESTED: 'attendance.entryStatus.CORRECTION_REQUESTED',
  CORRECTED: 'attendance.entryStatus.CORRECTED',
};

const CORRECTION_STATUS_TONE: Record<CorrectionStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const REQUEST_STATUS_TONE: Record<HRRequestStatus, Tone> = {
  OPEN: 'info',
  IN_PROGRESS: 'brand',
  WAITING_EMPLOYEE: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};

const REQUEST_STATUS_KEY: Record<HRRequestStatus, MessageKey> = {
  OPEN: 'requests.status.OPEN',
  IN_PROGRESS: 'requests.status.IN_PROGRESS',
  WAITING_EMPLOYEE: 'requests.status.WAITING_EMPLOYEE',
  RESOLVED: 'requests.status.RESOLVED',
  CLOSED: 'requests.status.CLOSED',
  CANCELLED: 'requests.status.CANCELLED',
};

const REQUEST_PRIORITY_TONE: Record<HRRequestPriority, Tone> = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

const REQUEST_PRIORITY_KEY: Record<HRRequestPriority, MessageKey> = {
  LOW: 'requests.priorityLabels.LOW',
  NORMAL: 'requests.priorityLabels.NORMAL',
  HIGH: 'requests.priorityLabels.HIGH',
  URGENT: 'requests.priorityLabels.URGENT',
};

const REQUEST_TYPE_KEY: Record<string, MessageKey> = {
  HR: 'requests.types.HR',
  CERTIFICATE: 'requests.types.CERTIFICATE',
  DOCUMENT: 'requests.types.DOCUMENT',
  PAYROLL: 'requests.types.PAYROLL',
  EQUIPMENT: 'requests.types.EQUIPMENT',
  REMOTE_WORK: 'requests.types.REMOTE_WORK',
  IT: 'requests.types.IT',
  OTHER: 'requests.types.OTHER',
};

const DOCUMENT_STATUS_TONE: Record<DocumentStatus, Tone> = {
  ACTIVE: 'success',
  ARCHIVED: 'neutral',
  EXPIRED: 'danger',
};

export function useStatusLabels() {
  const { t } = useI18n();
  return {
    leaveStatus: (status: LeaveRequestStatus) => t(LEAVE_STATUS_KEY[status]),
    attendanceStatus: (status: AttendanceStatus) => t(ATTENDANCE_STATUS_KEY[status]),
    entryStatus: (status: string | null | undefined) =>
      status ? t(ENTRY_STATUS_KEY[status] ?? 'attendance.entryStatus.OPEN') : null,
    requestStatus: (status: HRRequestStatus) => t(REQUEST_STATUS_KEY[status]),
    requestPriority: (priority: HRRequestPriority) => t(REQUEST_PRIORITY_KEY[priority]),
    requestType: (type: string) => t(REQUEST_TYPE_KEY[type] ?? 'requests.types.OTHER'),
    documentStatus: (status: DocumentStatus) => (status === 'ACTIVE' ? 'ACTIVE' : status),
    leaveStatusTone: (status: LeaveRequestStatus) => LEAVE_STATUS_TONE[status],
    attendanceTone: (status: AttendanceStatus) => ATTENDANCE_STATUS_TONE[status],
    correctionTone: (status: CorrectionStatus) => CORRECTION_STATUS_TONE[status],
    requestTone: (status: HRRequestStatus) => REQUEST_STATUS_TONE[status],
    priorityTone: (priority: HRRequestPriority) => REQUEST_PRIORITY_TONE[priority],
    documentTone: (status: DocumentStatus) => DOCUMENT_STATUS_TONE[status],
  };
}

export function LeaveStatusBadge({ status }: { status: LeaveRequestStatus }) {
  const labels = useStatusLabels();
  return <Badge label={labels.leaveStatus(status)} tone={labels.leaveStatusTone(status)} />;
}

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const labels = useStatusLabels();
  return <Badge label={labels.attendanceStatus(status)} tone={labels.attendanceTone(status)} />;
}

export function CorrectionStatusBadge({ status }: { status: CorrectionStatus }) {
  const labels = useStatusLabels();
  return <Badge label={labels.leaveStatus(status === 'APPROVED' ? 'APPROVED' : status === 'REJECTED' ? 'REJECTED' : 'PENDING')} tone={labels.correctionTone(status)} />;
}

export function RequestStatusBadge({ status }: { status: HRRequestStatus }) {
  const labels = useStatusLabels();
  return <Badge label={labels.requestStatus(status)} tone={labels.requestTone(status)} />;
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const labels = useStatusLabels();
  return <Badge label={labels.documentStatus(status)} tone={labels.documentTone(status)} />;
}
