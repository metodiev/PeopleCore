import { ForbiddenError } from '../common/errors/app-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { currentContext } from './request-context.js';

/**
 * Models carrying `tenantId`. Every operation on these models must run inside
 * a request/job context; the extension injects the current tenant id into
 * filters and payloads, making cross-tenant access impossible by construction.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'TenantPrivacySettings',
  'User',
  'UserInvitation',
  'Role',
  'Department',
  'Location',
  'Team',
  'Position',
  'WorkSchedule',
  'ScheduleAssignment',
  'Employee',
  'EmergencyContact',
  'BankAccount',
  'EmployeeEducation',
  'Skill',
  'EmployeeSkill',
  'EmployeeLanguage',
  'EmployeeNote',
  'EmploymentHistory',
  'Contract',
  'CompensationChange',
  'Benefit',
  'LeaveType',
  'LeavePolicy',
  'LeaveBalance',
  'LeaveRequest',
  'LeaveApproval',
  'Holiday',
  'LeaveBlackoutDate',
  'AttendanceEntry',
  'AttendanceBreak',
  'AttendanceCorrection',
  'DocumentCategory',
  'Document',
  'DocumentVersion',
  'DocumentAcknowledgment',
  'Calendar',
  'CalendarEvent',
  'EventAttendee',
  'IntegrationConnection',
  'CalendarSyncMapping',
  'EventSyncMapping',
  'ReviewCycle',
  'PerformanceReview',
  'ReviewFeedback',
  'Goal',
  'KeyResult',
  'Course',
  'TrainingAssignment',
  'Certification',
  'LearningPlan',
  'LearningPlanItem',
  'ExpenseCategory',
  'Expense',
  'Asset',
  'AssetAssignment',
  'HRRequest',
  'HRRequestComment',
  'Notification',
  'NotificationPreference',
  'PushDevice',
  'ConsentRecord',
  'DataExportRequest',
  'ErasureRequest',
  'RetentionPolicy',
  'SavedReport',
  'ReportRun',
]);

/** Models using `deletedAt` for soft deletion. */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set([
  'Tenant',
  'User',
  'Employee',
  'Department',
  'Team',
  'Location',
  'Position',
  'LeaveType',
  'Document',
  'Asset',
  'Course',
]);

const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WHERE_WRITE_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

type AnyRecord = Record<string, unknown>;
interface AnyArgs {
  where?: AnyRecord;
  data?: unknown;
  create?: AnyRecord;
  update?: unknown;
  [key: string]: unknown;
}

function injectWhere(args: AnyArgs, tenantId: string, softDelete: boolean): void {
  const where = (args.where ?? {}) as AnyRecord;
  if (where['tenantId'] !== undefined && where['tenantId'] !== tenantId) {
    throw new ForbiddenError('Cross-tenant access denied', 'TENANT_MISMATCH');
  }
  where['tenantId'] = tenantId;
  // Soft-deleted rows stay hidden unless the caller filters on deletedAt explicitly.
  if (softDelete && where['deletedAt'] === undefined) {
    where['deletedAt'] = null;
  }
  args.where = where;
}

function injectData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => injectData(item, tenantId));
  }
  if (data && typeof data === 'object') {
    const record = data as AnyRecord;
    if (record['tenantId'] !== undefined && record['tenantId'] !== tenantId) {
      throw new ForbiddenError('Cross-tenant write denied', 'TENANT_MISMATCH');
    }
    return { ...record, tenantId };
  }
  return data;
}

/**
 * Prisma client extension enforcing tenant isolation and soft-delete filtering.
 * Operations without a tenant context fail closed — unscoped access must go
 * through `PrismaService.raw` deliberately.
 */
export function createTenantScopeExtension() {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const context = currentContext();
          if (!context?.tenantId) {
            throw new ForbiddenError(
              `No tenant context for ${model}.${operation} — use PrismaService.forTenant() or PrismaService.raw`,
              'TENANT_CONTEXT_MISSING',
            );
          }

          const tenantId = context.tenantId;
          const softDelete = SOFT_DELETE_MODELS.has(model);
          const mutableArgs = { ...((args ?? {}) as AnyArgs) };

          if (READ_OPERATIONS.has(operation) || WHERE_WRITE_OPERATIONS.has(operation)) {
            injectWhere(mutableArgs, tenantId, READ_OPERATIONS.has(operation) && softDelete);
          } else if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
            mutableArgs.data = injectData(mutableArgs.data, tenantId);
          } else if (operation === 'upsert') {
            injectWhere(mutableArgs, tenantId, false);
            mutableArgs.create = injectData(mutableArgs.create, tenantId) as AnyRecord;
          } else {
            // Unknown operations fall back to a filtered where clause where possible.
            if ('where' in mutableArgs) {
              injectWhere(mutableArgs, tenantId, false);
            }
          }

          return query(mutableArgs);
        },
      },
    },
  });
}
