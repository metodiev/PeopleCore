import { Injectable } from '@nestjs/common';
import type { Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ForbiddenError } from '../../common/errors/app-error.js';

export type EmployeeVisibility = 'all' | 'team' | 'self';

/**
 * Row-level data scope for employee data.
 *
 * The permission model answers *what* a user may do; this service answers
 * *whose* records they may do it to:
 *  - HR/Admin roles (can edit or see sensitive data) → every employee;
 *  - managers (approve leave/attendance) → their reports, team members and
 *    departments they manage;
 *  - everyone else → only their own employee record.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  visibilityOf(principal: Principal): EmployeeVisibility {
    const permissions = new Set(principal.permissions);
    if (
      principal.isSuperAdmin ||
      permissions.has('employees.edit') ||
      permissions.has('employees.create') ||
      permissions.has('employees.sensitive.view') ||
      permissions.has('employees.terminate')
    ) {
      return 'all';
    }
    if (permissions.has('leave.approve') || permissions.has('attendance.approve') || permissions.has('performance.review')) {
      return 'team';
    }
    return 'self';
  }

  /**
   * Prisma `where` fragment restricting Employee queries to the caller's scope.
   * `extra` filters are combined with AND, so they can never widen the scope.
   */
  async employeeWhere(principal: Principal, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const visibility = this.visibilityOf(principal);

    if (visibility === 'all') return { ...extra };

    if (visibility === 'team') {
      const employeeId = principal.employeeId;
      if (!employeeId) return { ...extra, id: '00000000-0000-0000-0000-000000000000' };
      return {
        AND: [
          extra,
          {
            OR: [
              { id: employeeId },
              { managerId: employeeId },
              { team: { leadId: employeeId } },
              { department: { managerId: employeeId } },
            ],
          },
        ],
      };
    }

    const employeeId = principal.employeeId;
    if (!employeeId) return { ...extra, id: '00000000-0000-0000-0000-000000000000' };
    return { AND: [extra, { id: employeeId }] };
  }

  /** Throws unless the principal may read/write the given employee record. */
  async assertEmployeeAccess(principal: Principal, employeeId: string): Promise<void> {
    if (this.visibilityOf(principal) === 'all') return;
    const where = await this.employeeWhere(principal, { id: employeeId });
    const found = await this.prisma.client.employee.findFirst({ where, select: { id: true } });
    if (!found) {
      throw new ForbiddenError('You do not have access to this employee record', 'EMPLOYEE_SCOPE_DENIED');
    }
  }
}
