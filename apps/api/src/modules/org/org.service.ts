import { Injectable } from '@nestjs/common';
import type { Paginated } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { AuditService } from '../audit/audit.service.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import type {
  AssignScheduleDto,
  CreateDepartmentDto,
  CreateLocationDto,
  CreatePositionDto,
  CreateTeamDto,
  CreateWorkScheduleDto,
  DepartmentQueryDto,
  LocationQueryDto,
  PositionQueryDto,
  TeamQueryDto,
  UpdateDepartmentDto,
  UpdateLocationDto,
  UpdatePositionDto,
  UpdateTeamDto,
  UpdateWorkScheduleDto,
} from './dto/org.dto.js';

const SORTABLE = ['createdAt', 'name', 'title', 'city'] as const;

/** Departments, locations, teams, positions and work schedules. */
@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Departments ───────────────────────────────────────────────────────────

  async listDepartments(query: DepartmentQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { name: 'asc' });
    const where: Record<string, unknown> = {};
    if (query.parentId) where['parentId'] = query.parentId;
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.client.department.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          parent: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          _count: { select: { employees: true, teams: true, children: true } },
        },
      }),
      this.prisma.client.department.count({ where }),
    ]);

    return paginate(
      rows.map((department) => ({
        id: department.id,
        name: department.name,
        code: department.code,
        description: department.description,
        parent: department.parent,
        manager: department.manager,
        costCenter: department.costCenter,
        headcount: department._count.employees,
        teams: department._count.teams,
        children: department._count.children,
        createdAt: department.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async getDepartment(id: string) {
    const department = await this.prisma.client.department.findFirst({
      where: { id },
      include: {
        parent: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        teams: { select: { id: true, name: true } },
        _count: { select: { employees: true } },
      },
    });
    if (!department) throw new NotFoundError('Department', 'DEPARTMENT_NOT_FOUND');
    return department;
  }

  async createDepartment(dto: CreateDepartmentDto, actorUserId: string) {
    if (dto.parentId) {
      const parent = await this.prisma.client.department.findFirst({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundError('Parent department', 'PARENT_NOT_FOUND');
    }
    const department = await this.prisma.client.department.create({ data: tenantScoped({ ...dto }) });
    await this.audit.record({
      action: 'department.create',
      entityType: 'Department',
      entityId: department.id,
      actorUserId,
      after: department,
    });
    return department;
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto, actorUserId: string) {
    const before = await this.prisma.client.department.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Department', 'DEPARTMENT_NOT_FOUND');
    if (dto.parentId === id) throw new ValidationError('A department cannot be its own parent');
    if (dto.parentId) await this.assertNoCycle(id, dto.parentId);

    const updated = await this.prisma.client.department.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      action: 'department.update',
      entityType: 'Department',
      entityId: id,
      actorUserId,
      before,
      after: updated,
    });
    return updated;
  }

  async deleteDepartment(id: string, actorUserId: string) {
    const department = await this.prisma.client.department.findFirst({
      where: { id },
      include: { _count: { select: { employees: true, children: true } } },
    });
    if (!department) throw new NotFoundError('Department', 'DEPARTMENT_NOT_FOUND');
    if (department._count.employees > 0) {
      throw new ConflictError('Department still has employees — move them first', 'DEPARTMENT_NOT_EMPTY');
    }
    if (department._count.children > 0) {
      throw new ConflictError('Department still has sub-departments', 'DEPARTMENT_HAS_CHILDREN');
    }
    await this.prisma.client.department.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'department.delete',
      entityType: 'Department',
      entityId: id,
      actorUserId,
      before: department,
    });
    return { deleted: true };
  }

  private async assertNoCycle(id: string, parentId: string): Promise<void> {
    let current: string | null = parentId;
    const seen = new Set<string>();
    while (current) {
      if (current === id) throw new ValidationError('This parent would create a cycle');
      if (seen.has(current)) break;
      seen.add(current);
      const node: { parentId: string | null } | null = await this.prisma.client.department.findFirst({
        where: { id: current },
        select: { parentId: true },
      });
      current = node?.parentId ?? null;
    }
  }

  // ── Locations ─────────────────────────────────────────────────────────────

  async listLocations(query: LocationQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { name: 'asc' });
    const where: Record<string, unknown> = {};
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.client.location.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { _count: { select: { employees: true, assets: true } } },
      }),
      this.prisma.client.location.count({ where }),
    ]);

    return paginate(
      rows.map((location) => ({
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        country: location.country,
        timezone: location.timezone,
        latitude: location.latitude,
        longitude: location.longitude,
        geofenceRadiusM: location.geofenceRadiusM,
        isActive: location.isActive,
        headcount: location._count.employees,
        assets: location._count.assets,
      })),
      total,
      query,
    );
  }

  async createLocation(dto: CreateLocationDto, actorUserId: string) {
    const location = await this.prisma.client.location.create({ data: tenantScoped({ ...dto }) });
    await this.audit.record({
      action: 'location.create',
      entityType: 'Location',
      entityId: location.id,
      actorUserId,
      after: location,
    });
    return location;
  }

  async updateLocation(id: string, dto: UpdateLocationDto, actorUserId: string) {
    const before = await this.prisma.client.location.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Location', 'LOCATION_NOT_FOUND');
    const updated = await this.prisma.client.location.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      action: 'location.update',
      entityType: 'Location',
      entityId: id,
      actorUserId,
      before,
      after: updated,
    });
    return updated;
  }

  async deleteLocation(id: string, actorUserId: string) {
    const location = await this.prisma.client.location.findFirst({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (!location) throw new NotFoundError('Location', 'LOCATION_NOT_FOUND');
    if (location._count.employees > 0) {
      throw new ConflictError('Location still has employees assigned', 'LOCATION_IN_USE');
    }
    await this.prisma.client.location.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'location.delete',
      entityType: 'Location',
      entityId: id,
      actorUserId,
      before: location,
    });
    return { deleted: true };
  }

  // ── Teams ─────────────────────────────────────────────────────────────────

  async listTeams(query: TeamQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { name: 'asc' });
    const where: Record<string, unknown> = {};
    if (query.departmentId) where['departmentId'] = query.departmentId;
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.client.team.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          department: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.client.team.count({ where }),
    ]);

    return paginate(
      rows.map((team) => ({
        id: team.id,
        name: team.name,
        description: team.description,
        department: team.department,
        lead: team.lead,
        members: team._count.members,
      })),
      total,
      query,
    );
  }

  async createTeam(dto: CreateTeamDto, actorUserId: string) {
    const team = await this.prisma.client.team.create({ data: tenantScoped({ ...dto }) });
    await this.audit.record({ action: 'team.create', entityType: 'Team', entityId: team.id, actorUserId, after: team });
    return team;
  }

  async updateTeam(id: string, dto: UpdateTeamDto, actorUserId: string) {
    const before = await this.prisma.client.team.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Team', 'TEAM_NOT_FOUND');
    const updated = await this.prisma.client.team.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      action: 'team.update',
      entityType: 'Team',
      entityId: id,
      actorUserId,
      before,
      after: updated,
    });
    return updated;
  }

  async deleteTeam(id: string, actorUserId: string) {
    const team = await this.prisma.client.team.findFirst({ where: { id }, include: { _count: { select: { members: true } } } });
    if (!team) throw new NotFoundError('Team', 'TEAM_NOT_FOUND');
    await this.prisma.client.employee.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await this.prisma.client.team.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'team.delete', entityType: 'Team', entityId: id, actorUserId, before: team });
    return { deleted: true };
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  async listPositions(query: PositionQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { title: 'asc' });
    const where: Record<string, unknown> = {};
    if (query.departmentId) where['departmentId'] = query.departmentId;
    if (query.search) where['title'] = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.client.position.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { department: { select: { id: true, name: true } }, _count: { select: { employees: true } } },
      }),
      this.prisma.client.position.count({ where }),
    ]);

    return paginate(
      rows.map((position) => ({
        id: position.id,
        title: position.title,
        code: position.code,
        level: position.level,
        department: position.department,
        employees: position._count.employees,
      })),
      total,
      query,
    );
  }

  async createPosition(dto: CreatePositionDto, actorUserId: string) {
    const position = await this.prisma.client.position.create({ data: tenantScoped({ ...dto }) });
    await this.audit.record({
      action: 'position.create',
      entityType: 'Position',
      entityId: position.id,
      actorUserId,
      after: position,
    });
    return position;
  }

  async updatePosition(id: string, dto: UpdatePositionDto, actorUserId: string) {
    const before = await this.prisma.client.position.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Position', 'POSITION_NOT_FOUND');
    const updated = await this.prisma.client.position.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      action: 'position.update',
      entityType: 'Position',
      entityId: id,
      actorUserId,
      before,
      after: updated,
    });
    return updated;
  }

  async deletePosition(id: string, actorUserId: string) {
    const position = await this.prisma.client.position.findFirst({ where: { id } });
    if (!position) throw new NotFoundError('Position', 'POSITION_NOT_FOUND');
    await this.prisma.client.position.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'position.delete',
      entityType: 'Position',
      entityId: id,
      actorUserId,
      before: position,
    });
    return { deleted: true };
  }

  // ── Work schedules ────────────────────────────────────────────────────────

  async listSchedules() {
    const schedules = await this.prisma.client.workSchedule.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { employees: true, assignments: true } } },
    });
    return schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      type: schedule.type,
      workDays: schedule.workDays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      breakMinutes: schedule.breakMinutes,
      flexibleMinutes: schedule.flexibleMinutes,
      timezone: schedule.timezone,
      isDefault: schedule.isDefault,
      employees: schedule._count.employees,
      assignments: schedule._count.assignments,
    }));
  }

  async createSchedule(dto: CreateWorkScheduleDto, actorUserId: string) {
    const schedule = await this.prisma.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.workSchedule.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.workSchedule.create({ data: tenantScoped({ ...dto, workDays: [...new Set(dto.workDays)].sort() }) });
    });
    await this.audit.record({
      action: 'schedule.create',
      entityType: 'WorkSchedule',
      entityId: schedule.id,
      actorUserId,
      after: schedule,
    });
    return schedule;
  }

  async updateSchedule(id: string, dto: UpdateWorkScheduleDto, actorUserId: string) {
    const before = await this.prisma.client.workSchedule.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Work schedule', 'SCHEDULE_NOT_FOUND');

    const updated = await this.prisma.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.workSchedule.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.workSchedule.update({
        where: { id },
        data: { ...dto, ...(dto.workDays ? { workDays: [...new Set(dto.workDays)].sort() } : {}) },
      });
    });
    await this.audit.record({
      action: 'schedule.update',
      entityType: 'WorkSchedule',
      entityId: id,
      actorUserId,
      before,
      after: updated,
    });
    return updated;
  }

  async assignSchedule(dto: AssignScheduleDto, actorUserId: string) {
    const [employee, schedule] = await Promise.all([
      this.prisma.client.employee.findFirst({ where: { id: dto.employeeId } }),
      this.prisma.client.workSchedule.findFirst({ where: { id: dto.scheduleId } }),
    ]);
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    if (!schedule) throw new NotFoundError('Work schedule', 'SCHEDULE_NOT_FOUND');

    const assignment = await this.prisma.transaction(async (tx) => {
      await tx.scheduleAssignment.updateMany({
        where: { employeeId: dto.employeeId, effectiveTo: null },
        data: { effectiveTo: new Date(dto.effectiveFrom) },
      });
      await tx.employee.update({ where: { id: dto.employeeId }, data: { scheduleId: dto.scheduleId } });
      return tx.scheduleAssignment.create({
        data: tenantScoped({
          employeeId: dto.employeeId,
          scheduleId: dto.scheduleId,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        }),
      });
    });

    await this.audit.record({
      action: 'schedule.assign',
      entityType: 'ScheduleAssignment',
      entityId: assignment.id,
      actorUserId,
      after: assignment,
    });
    return assignment;
  }
}
