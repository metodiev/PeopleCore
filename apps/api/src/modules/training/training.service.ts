import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CertificationStatus, EnrollmentStatus, Paginated, Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  AssignmentQueryDto,
  CertificationQueryDto,
  CourseQueryDto,
  CreateAssignmentsDto,
  CreateCertificationDto,
  CreateCourseDto,
  CreateLearningPlanDto,
  CreateLearningPlanItemDto,
  CreateSkillDto,
  LearningPlanQueryDto,
  SkillMatrixQueryDto,
  SkillQueryDto,
  UpdateAssignmentDto,
  UpdateCertificationDto,
  UpdateCourseDto,
  UpdateLearningPlanItemDto,
} from './dto/training.dto.js';

const SORTABLE_COURSES = ['createdAt', 'title', 'category', 'durationHours'] as const;
const SORTABLE_ASSIGNMENTS = ['createdAt', 'dueDate', 'status', 'completedAt'] as const;
const SORTABLE_CERTIFICATIONS = ['createdAt', 'name', 'issuedDate', 'expiresAt'] as const;
const SORTABLE_SKILLS = ['createdAt', 'name', 'category'] as const;
const SORTABLE_PLANS = ['createdAt', 'name', 'targetDate', 'status'] as const;

/** Days before `expiresAt` at which a certification starts warning. */
export const CERTIFICATION_EXPIRING_WINDOW_DAYS = 30;

const OPEN_ENROLLMENT_STATUSES: EnrollmentStatus[] = ['ASSIGNED', 'IN_PROGRESS'];

export interface TrainingAssignedEvent {
  tenantId: string;
  assignmentId: string;
  employeeId: string;
  courseId: string;
  courseTitle: string;
  dueDate: string | null;
  assignedByUserId: string;
}

/**
 * Training & development: course catalog (with skill links and validity),
 * assignments with due dates, certifications with expiry tracking, the skill
 * catalog / matrix, and per-employee learning plans.
 *
 * Reads are restricted to the caller's employee scope: employees see their own
 * records, managers their team, HR the whole company.
 */
@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Courses ───────────────────────────────────────────────────────────────

  async listCourses(query: CourseQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_COURSES, { title: 'asc' });
    const where: Record<string, unknown> = {};
    if (query.category) where['category'] = query.category;
    if (query.isRequired !== undefined) where['isRequired'] = query.isRequired;
    if (!query.includeInactive) where['isActive'] = true;
    if (query.search) {
      where['OR'] = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { provider: { contains: query.search, mode: 'insensitive' } },
        { category: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.course.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          skills: { include: { skill: { select: { id: true, name: true, category: true } } } },
          _count: { select: { assignments: true } },
        },
      }),
      this.prisma.client.course.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeCourse(row)), total, query);
  }

  async getCourse(id: string) {
    const course = await this.prisma.client.course.findFirst({
      where: { id },
      include: {
        skills: { include: { skill: { select: { id: true, name: true, category: true } } } },
        _count: { select: { assignments: true, planItems: true } },
      },
    });
    if (!course) throw new NotFoundError('Course', 'COURSE_NOT_FOUND');
    return this.serializeCourse(course);
  }

  async createCourse(principal: Principal, dto: CreateCourseDto) {
    const existing = await this.prisma.client.course.findFirst({ where: { title: dto.title } });
    if (existing) throw new ConflictError(`A course titled "${dto.title}" already exists`, 'COURSE_EXISTS');
    await this.assertSkillsExist(dto.skillIds);

    const course = await this.prisma.client.course.create({
      data: tenantScoped({
        title: dto.title,
        description: dto.description,
        provider: dto.provider,
        url: dto.url,
        category: dto.category,
        durationHours: dto.durationHours,
        isRequired: dto.isRequired ?? false,
        validityMonths: dto.validityMonths,
        skills: dto.skillIds?.length ? { create: dto.skillIds.map((skillId) => ({ skillId })) } : undefined,
      }),
      include: { skills: { include: { skill: { select: { id: true, name: true, category: true } } } } },
    });
    await this.audit.record({
      action: 'course.create',
      entityType: 'Course',
      entityId: course.id,
      actorUserId: principal.userId,
      after: { title: course.title, isRequired: course.isRequired, skillIds: dto.skillIds ?? [] },
    });
    return this.serializeCourse(course);
  }

  async updateCourse(principal: Principal, id: string, dto: UpdateCourseDto) {
    const before = await this.prisma.client.course.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Course', 'COURSE_NOT_FOUND');
    if (dto.title && dto.title !== before.title) {
      const duplicate = await this.prisma.client.course.findFirst({ where: { title: dto.title } });
      if (duplicate) throw new ConflictError(`A course titled "${dto.title}" already exists`, 'COURSE_EXISTS');
    }
    await this.assertSkillsExist(dto.skillIds);

    const course = await this.prisma.transaction(async (tx) => {
      const updated = await tx.course.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          provider: dto.provider,
          url: dto.url,
          category: dto.category,
          durationHours: dto.durationHours,
          isRequired: dto.isRequired,
          validityMonths: dto.validityMonths,
          isActive: dto.isActive,
        },
        include: { skills: { include: { skill: { select: { id: true, name: true, category: true } } } } },
      });

      if (dto.skillIds) {
        await tx.courseSkill.deleteMany({ where: { courseId: id } });
        for (const skillId of dto.skillIds) {
          await tx.courseSkill.create({ data: { courseId: id, skillId } });
        }
      }
      return updated;
    });

    const refreshed = dto.skillIds
      ? await this.prisma.client.course.findFirst({
          where: { id },
          include: { skills: { include: { skill: { select: { id: true, name: true, category: true } } } } },
        })
      : course;

    await this.audit.record({
      action: 'course.update',
      entityType: 'Course',
      entityId: id,
      actorUserId: principal.userId,
      before: { title: before.title, isRequired: before.isRequired, isActive: before.isActive },
      after: { title: course.title, isRequired: course.isRequired, isActive: course.isActive, skillIds: dto.skillIds },
    });
    return this.serializeCourse(refreshed ?? course);
  }

  /** Soft delete: the course disappears from the catalog, history stays intact. */
  async deleteCourse(principal: Principal, id: string) {
    const course = await this.prisma.client.course.findFirst({ where: { id } });
    if (!course) throw new NotFoundError('Course', 'COURSE_NOT_FOUND');

    await this.prisma.transaction(async (tx) => {
      await tx.course.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await tx.trainingAssignment.updateMany({
        where: { courseId: id, status: { in: OPEN_ENROLLMENT_STATUSES } },
        data: { status: 'CANCELLED' },
      });
    });
    await this.audit.record({
      action: 'course.delete',
      entityType: 'Course',
      entityId: id,
      actorUserId: principal.userId,
      before: { title: course.title },
    });
    return { deleted: true };
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async assign(principal: Principal, dto: CreateAssignmentsDto) {
    const course = await this.prisma.client.course.findFirst({ where: { id: dto.courseId } });
    if (!course) throw new NotFoundError('Course', 'COURSE_NOT_FOUND');
    if (!course.isActive) throw new ValidationError('Archived courses cannot be assigned', { code: 'COURSE_INACTIVE' });

    const employeeIds = [...new Set(dto.employeeIds)];
    const employees = await this.prisma.client.employee.findMany({
      where: { id: { in: employeeIds }, status: { not: 'TERMINATED' } },
      select: { id: true, firstName: true, lastName: true },
    });
    if (employees.length !== employeeIds.length) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    for (const employee of employees) {
      await this.scope.assertEmployeeAccess(principal, employee.id);
    }

    const openAssignments = await this.prisma.client.trainingAssignment.findMany({
      where: { courseId: dto.courseId, employeeId: { in: employeeIds }, status: { in: OPEN_ENROLLMENT_STATUSES } },
      select: { id: true, employeeId: true },
    });
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

    const assignmentIds = await this.prisma.transaction(async (tx) => {
      const rows: { id: string; employeeId: string }[] = [];
      for (const employee of employees) {
        const open = openAssignments.find((assignment) => assignment.employeeId === employee.id);
        if (open) {
          await tx.trainingAssignment.update({
            where: { id: open.id },
            data: { dueDate, notes: dto.notes, assignedById: principal.userId, assignedAt: new Date() },
          });
          rows.push({ id: open.id, employeeId: employee.id });
        } else {
          const created = await tx.trainingAssignment.create({
            data: tenantScoped({
              employeeId: employee.id,
              courseId: dto.courseId,
              status: 'ASSIGNED',
              assignedById: principal.userId,
              assignedAt: new Date(),
              dueDate,
              notes: dto.notes,
            }),
          });
          rows.push({ id: created.id, employeeId: employee.id });
        }
      }
      return rows;
    });

    for (const row of assignmentIds) {
      this.events.emit('training.assigned', {
        tenantId: principal.tenantId!,
        assignmentId: row.id,
        employeeId: row.employeeId,
        courseId: course.id,
        courseTitle: course.title,
        dueDate: dto.dueDate ?? null,
        assignedByUserId: principal.userId,
      } satisfies TrainingAssignedEvent);
    }

    await this.audit.record({
      action: 'training.assign',
      entityType: 'TrainingAssignment',
      actorUserId: principal.userId,
      metadata: { courseId: course.id, employeeIds, dueDate: dto.dueDate ?? null },
    });
    return { courseId: course.id, assignments: assignmentIds.length, assignmentIds: assignmentIds.map((row) => row.id) };
  }

  async listAssignments(principal: Principal, query: AssignmentQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_ASSIGNMENTS, { createdAt: 'desc' });
    const today = startOfDay(new Date());
    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.courseId) filters.push({ courseId: query.courseId });
    if (query.overdue) filters.push({ dueDate: { lt: today }, status: { in: OPEN_ENROLLMENT_STATUSES } });

    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else {
      filters.push({ employee: await this.scope.employeeWhere(principal) });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.trainingAssignment.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          course: { select: { id: true, title: true, category: true, isRequired: true, validityMonths: true } },
          employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true, employeeNumber: true } },
        },
      }),
      this.prisma.client.trainingAssignment.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeAssignment(row)), total, query);
  }

  async getAssignment(principal: Principal, id: string) {
    const assignment = await this.prisma.client.trainingAssignment.findFirst({
      where: { id },
      include: {
        course: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      },
    });
    if (!assignment) throw new NotFoundError('Training assignment', 'ASSIGNMENT_NOT_FOUND');
    await this.assertAssignmentAccess(principal, assignment.employeeId);
    return this.serializeAssignment(assignment);
  }

  async updateAssignment(principal: Principal, id: string, dto: UpdateAssignmentDto) {
    const before = await this.prisma.client.trainingAssignment.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Training assignment', 'ASSIGNMENT_NOT_FOUND');
    await this.assertAssignmentAccess(principal, before.employeeId);

    const status = dto.status ?? before.status;
    if (status === before.status && dto.status && before.status === 'COMPLETED') {
      throw new ConflictError('This assignment is already completed', 'ASSIGNMENT_COMPLETED');
    }

    const updated = await this.prisma.client.trainingAssignment.update({
      where: { id },
      data: {
        status: dto.status,
        score: dto.score,
        certificateDocumentId: dto.certificateDocumentId,
        notes: dto.notes,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        startedAt: dto.status === 'IN_PROGRESS' ? (before.startedAt ?? new Date()) : undefined,
        completedAt: dto.status === 'COMPLETED' ? new Date() : dto.status ? null : undefined,
      },
    });

    // Completions of courses with a validity period issue a certification, so
    // expiry can be tracked from one place.
    let certificationId: string | null = null;
    if (dto.status === 'COMPLETED' && before.status !== 'COMPLETED') {
      const course = await this.prisma.client.course.findFirst({ where: { id: before.courseId } });
      if (course?.validityMonths) {
        const expiresAt = addMonths(updated.completedAt ?? new Date(), course.validityMonths);
        const certification = await this.prisma.client.certification.create({
          data: tenantScoped({
            employeeId: before.employeeId,
            name: course.title,
            issuer: course.provider,
            issuedDate: startOfDay(updated.completedAt ?? new Date()),
            expiresAt,
            status: effectiveCertificationStatus('VALID', expiresAt),
            documentId: dto.certificateDocumentId ?? null,
          }),
        });
        certificationId = certification.id;
      }
    }

    await this.audit.record({
      action: 'training.assignment.update',
      entityType: 'TrainingAssignment',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: before.status, score: before.score ? Number(before.score) : null },
      after: { status: updated.status, score: updated.score ? Number(updated.score) : null, certificationId },
    });
    return { ...this.serializeAssignment(updated), certificationId };
  }

  // ── Certifications ────────────────────────────────────────────────────────

  async listCertifications(principal: Principal, query: CertificationQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_CERTIFICATIONS, { expiresAt: 'asc' });
    const filters: Record<string, unknown>[] = [];

    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else {
      filters.push({ employee: await this.scope.employeeWhere(principal) });
    }
    if (query.status) filters.push(certificationStatusFilter(query.status));

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.certification.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
      }),
      this.prisma.client.certification.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeCertification(row)), total, query);
  }

  /** Certifications that expire within `days` (defaults to the 30-day window). */
  async expiringCertifications(principal: Principal, days = CERTIFICATION_EXPIRING_WINDOW_DAYS) {
    const today = startOfDay(new Date());
    const until = addDays(today, Math.max(1, days));
    const rows = await this.prisma.client.certification.findMany({
      where: {
        AND: [
          { employee: await this.scope.employeeWhere(principal) },
          { status: { not: 'REVOKED' } },
          { expiresAt: { not: null, gte: today, lte: until } },
        ],
      },
      orderBy: { expiresAt: 'asc' },
      include: { employee: { select: { id: true, firstName: true, lastName: true, workEmail: true } } },
    });
    return rows.map((row) => this.serializeCertification(row));
  }

  async createCertification(principal: Principal, dto: CreateCertificationDto) {
    const employeeId = dto.employeeId ?? principal.employeeId;
    if (!employeeId) throw new ValidationError('employeeId is required — the caller has no employee record');
    if (employeeId !== principal.employeeId) await this.scope.assertEmployeeAccess(principal, employeeId);
    if (dto.expiresAt && new Date(dto.expiresAt) < new Date(dto.issuedDate)) {
      throw new ValidationError('The expiry date must be after the issue date');
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const certification = await this.prisma.client.certification.create({
      data: tenantScoped({
        employeeId,
        name: dto.name,
        issuer: dto.issuer,
        issuedDate: new Date(dto.issuedDate),
        expiresAt,
        status: effectiveCertificationStatus('VALID', expiresAt),
        documentId: dto.documentId,
        notes: dto.notes,
      }),
    });
    await this.audit.record({
      action: 'certification.create',
      entityType: 'Certification',
      entityId: certification.id,
      actorUserId: principal.userId,
      after: { employeeId, name: certification.name, expiresAt: certification.expiresAt, status: certification.status },
    });
    return this.serializeCertification(certification);
  }

  async updateCertification(principal: Principal, id: string, dto: UpdateCertificationDto) {
    const before = await this.prisma.client.certification.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Certification', 'CERTIFICATION_NOT_FOUND');
    await this.scope.assertEmployeeAccess(principal, before.employeeId);

    const expiresAt = dto.expiresAt === undefined ? before.expiresAt : dto.expiresAt ? new Date(dto.expiresAt) : null;
    const updated = await this.prisma.client.certification.update({
      where: { id },
      data: {
        employeeId: dto.employeeId,
        name: dto.name,
        issuer: dto.issuer,
        issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : undefined,
        expiresAt: dto.expiresAt === undefined ? undefined : expiresAt,
        documentId: dto.documentId,
        notes: dto.notes,
        status: dto.status === 'REVOKED' ? 'REVOKED' : effectiveCertificationStatus(dto.status ?? before.status, expiresAt),
      },
    });
    await this.audit.record({
      action: 'certification.update',
      entityType: 'Certification',
      entityId: id,
      actorUserId: principal.userId,
      before: { name: before.name, status: before.status, expiresAt: before.expiresAt },
      after: { name: updated.name, status: updated.status, expiresAt: updated.expiresAt },
    });
    return this.serializeCertification(updated);
  }

  async deleteCertification(principal: Principal, id: string) {
    const certification = await this.prisma.client.certification.findFirst({ where: { id } });
    if (!certification) throw new NotFoundError('Certification', 'CERTIFICATION_NOT_FOUND');
    await this.scope.assertEmployeeAccess(principal, certification.employeeId);

    await this.prisma.client.certification.delete({ where: { id } });
    await this.audit.record({
      action: 'certification.delete',
      entityType: 'Certification',
      entityId: id,
      actorUserId: principal.userId,
      before: { employeeId: certification.employeeId, name: certification.name },
    });
    return { deleted: true };
  }

  // ── Skills ────────────────────────────────────────────────────────────────

  async listSkills(query: SkillQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_SKILLS, { name: 'asc' });
    const where: Record<string, unknown> = {};
    if (query.category) where['category'] = query.category;
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.client.skill.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { _count: { select: { employees: true, courses: true } } },
      }),
      this.prisma.client.skill.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async createSkill(principal: Principal, dto: CreateSkillDto) {
    const existing = await this.prisma.client.skill.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictError(`Skill "${dto.name}" already exists`, 'SKILL_EXISTS');

    const skill = await this.prisma.client.skill.create({ data: tenantScoped({ name: dto.name, category: dto.category }) });
    await this.audit.record({
      action: 'skill.create',
      entityType: 'Skill',
      entityId: skill.id,
      actorUserId: principal.userId,
      after: { name: skill.name, category: skill.category },
    });
    return skill;
  }

  /** Per-employee skill levels for the caller's scope (managers see their team). */
  async skillMatrix(principal: Principal, query: SkillMatrixQueryDto) {
    const filters: Record<string, unknown>[] = [];
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ id: query.employeeId });
    }
    if (query.search) {
      filters.push({
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    filters.push(await this.scope.employeeWhere(principal));

    const employees = await this.prisma.client.employee.findMany({
      where: { AND: filters },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        department: { select: { id: true, name: true } },
      },
    });

    const employeeSkills = await this.prisma.client.employeeSkill.findMany({
      where: { employeeId: { in: employees.map((employee) => employee.id) }, ...(query.skillId ? { skillId: query.skillId } : {}) },
      include: { skill: { select: { id: true, name: true, category: true } } },
      orderBy: { level: 'desc' },
    });

    const rows = employees.map((employee) => ({
      employee,
      skills: employeeSkills
        .filter((entry) => entry.employeeId === employee.id)
        .map((entry) => ({
          skillId: entry.skillId,
          name: entry.skill.name,
          category: entry.skill.category,
          level: entry.level,
          yearsOfExp: entry.yearsOfExp,
          lastUsedAt: entry.lastUsedAt,
        })),
    }));

    const catalog = new Map<string, { id: string; name: string; category: string | null; employees: number; averageLevel: number }>();
    for (const entry of employeeSkills) {
      const current = catalog.get(entry.skillId) ?? {
        id: entry.skill.id,
        name: entry.skill.name,
        category: entry.skill.category,
        employees: 0,
        averageLevel: 0,
      };
      current.averageLevel = (current.averageLevel * current.employees + entry.level) / (current.employees + 1);
      current.employees += 1;
      catalog.set(entry.skillId, current);
    }

    return {
      employees: rows,
      skills: [...catalog.values()].map((skill) => ({ ...skill, averageLevel: Number(skill.averageLevel.toFixed(2)) })),
    };
  }

  // ── Learning plans ────────────────────────────────────────────────────────

  async listPlans(principal: Principal, query: LearningPlanQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_PLANS, { createdAt: 'desc' });
    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });

    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else {
      filters.push({ employee: await this.scope.employeeWhere(principal) });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.learningPlan.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
          items: {
            orderBy: { order: 'asc' },
            include: { course: { select: { id: true, title: true, category: true, durationHours: true, validityMonths: true } } },
          },
        },
      }),
      this.prisma.client.learningPlan.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializePlan(row)), total, query);
  }

  async createPlan(principal: Principal, dto: CreateLearningPlanDto) {
    const employeeId = dto.employeeId ?? principal.employeeId;
    if (!employeeId) throw new ValidationError('employeeId is required — the caller has no employee record');
    if (employeeId !== principal.employeeId) await this.scope.assertEmployeeAccess(principal, employeeId);

    const plan = await this.prisma.client.learningPlan.create({
      data: tenantScoped({
        employeeId,
        name: dto.name,
        description: dto.description,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        status: 'ACTIVE',
      }),
    });
    await this.audit.record({
      action: 'learningPlan.create',
      entityType: 'LearningPlan',
      entityId: plan.id,
      actorUserId: principal.userId,
      after: { employeeId, name: plan.name },
    });
    return plan;
  }

  async addPlanItem(principal: Principal, planId: string, dto: CreateLearningPlanItemDto) {
    const plan = await this.loadPlan(planId);
    await this.assertPlanAccess(principal, plan.employeeId);

    const course = await this.prisma.client.course.findFirst({ where: { id: dto.courseId } });
    if (!course) throw new NotFoundError('Course', 'COURSE_NOT_FOUND');
    const duplicate = await this.prisma.client.learningPlanItem.findFirst({ where: { learningPlanId: planId, courseId: dto.courseId } });
    if (duplicate) throw new ConflictError('This course is already part of the learning plan', 'PLAN_ITEM_EXISTS');

    const item = await this.prisma.client.learningPlanItem.create({
      data: tenantScoped({ learningPlanId: planId, courseId: dto.courseId, order: dto.order ?? 0, status: 'ASSIGNED' }),
      include: { course: { select: { id: true, title: true } } },
    });
    await this.audit.record({
      action: 'learningPlan.item.add',
      entityType: 'LearningPlanItem',
      entityId: item.id,
      actorUserId: principal.userId,
      after: { planId, courseId: dto.courseId },
    });
    return item;
  }

  async updatePlanItem(principal: Principal, itemId: string, dto: UpdateLearningPlanItemDto) {
    const item = await this.prisma.client.learningPlanItem.findFirst({ where: { id: itemId } });
    if (!item) throw new NotFoundError('Learning plan item', 'PLAN_ITEM_NOT_FOUND');
    const plan = await this.loadPlan(item.learningPlanId);
    await this.assertPlanAccess(principal, plan.employeeId);

    const updated = await this.prisma.client.learningPlanItem.update({
      where: { id: itemId },
      data: {
        status: dto.status,
        completedAt: dto.status === 'COMPLETED' ? new Date() : null,
      },
    });
    await this.audit.record({
      action: 'learningPlan.item.update',
      entityType: 'LearningPlanItem',
      entityId: itemId,
      actorUserId: principal.userId,
      before: { status: item.status },
      after: { status: updated.status },
    });
    return updated;
  }

  async completePlan(principal: Principal, planId: string) {
    const plan = await this.loadPlan(planId);
    await this.assertPlanAccess(principal, plan.employeeId);
    if (plan.status === 'CANCELLED') throw new ConflictError('A cancelled learning plan cannot be completed', 'PLAN_CANCELLED');

    const items = await this.prisma.client.learningPlanItem.findMany({ where: { learningPlanId: planId } });
    const remaining = items.filter((item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED');
    if (remaining.length > 0) {
      throw new ValidationError(`${remaining.length} course(s) are still open on this learning plan`, {
        code: 'PLAN_INCOMPLETE',
        remaining: remaining.length,
      });
    }

    const updated = await this.prisma.client.learningPlan.update({ where: { id: planId }, data: { status: 'COMPLETED' } });
    await this.audit.record({
      action: 'learningPlan.complete',
      entityType: 'LearningPlan',
      entityId: planId,
      actorUserId: principal.userId,
      before: { status: plan.status },
      after: { status: updated.status },
    });
    return updated;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async dashboard(principal: Principal) {
    const employeeScope = await this.scope.employeeWhere(principal);
    const today = startOfDay(new Date());
    const soon = addDays(today, CERTIFICATION_EXPIRING_WINDOW_DAYS);

    const [assignmentGroups, overdue, dueSoon, requiredOpen, certificationGroups, activePlans] = await Promise.all([
      this.prisma.client.trainingAssignment.groupBy({
        by: ['status'],
        where: { employee: employeeScope },
        _count: { _all: true },
      }),
      this.prisma.client.trainingAssignment.count({
        where: { AND: [{ employee: employeeScope }, { dueDate: { lt: today }, status: { in: OPEN_ENROLLMENT_STATUSES } }] },
      }),
      this.prisma.client.trainingAssignment.count({
        where: {
          AND: [
            { employee: employeeScope },
            { dueDate: { gte: today, lte: soon }, status: { in: OPEN_ENROLLMENT_STATUSES } },
          ],
        },
      }),
      this.prisma.client.trainingAssignment.count({
        where: {
          AND: [{ employee: employeeScope }, { status: { in: OPEN_ENROLLMENT_STATUSES } }, { course: { isRequired: true } }],
        },
      }),
      this.prisma.client.certification.groupBy({
        by: ['status'],
        where: { employee: employeeScope },
        _count: { _all: true },
      }),
      this.prisma.client.learningPlan.count({ where: { AND: [{ employee: employeeScope }, { status: 'ACTIVE' }] } }),
    ]);

    const assignments: Record<string, number> = { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
    let assignmentTotal = 0;
    for (const group of assignmentGroups) {
      assignments[group.status] = group._count._all;
      assignmentTotal += group._count._all;
    }

    const certifications: Record<string, number> = { VALID: 0, EXPIRING: 0, EXPIRED: 0, REVOKED: 0 };
    for (const group of certificationGroups) certifications[group.status] = group._count._all;

    const completed = assignments['COMPLETED'] ?? 0;
    return {
      assignments: { ...assignments, total: assignmentTotal, overdue, dueWithin30Days: dueSoon, requiredOpen },
      certifications: { ...certifications, expiringWithinDays: CERTIFICATION_EXPIRING_WINDOW_DAYS },
      activeLearningPlans: activePlans,
      completionRate: assignmentTotal > 0 ? Number(((completed / assignmentTotal) * 100).toFixed(1)) : 0,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async assertSkillsExist(skillIds?: string[]): Promise<void> {
    if (!skillIds?.length) return;
    const unique = [...new Set(skillIds)];
    const found = await this.prisma.client.skill.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw new NotFoundError('Skill', 'SKILL_NOT_FOUND');
  }

  /** The assignee may progress their own training; anyone else needs `training.manage`. */
  private async assertAssignmentAccess(principal: Principal, employeeId: string) {
    if (employeeId === principal.employeeId) return;
    if (!principal.isSuperAdmin && !principal.permissions.includes('training.manage')) {
      throw new ForbiddenError('You can only update your own training', 'TRAINING_SCOPE_DENIED');
    }
    await this.scope.assertEmployeeAccess(principal, employeeId);
  }

  private async assertPlanAccess(principal: Principal, employeeId: string) {
    if (employeeId === principal.employeeId) return;
    if (!principal.isSuperAdmin && !principal.permissions.includes('training.manage')) {
      throw new ForbiddenError('You can only update your own learning plans', 'PLAN_SCOPE_DENIED');
    }
    await this.scope.assertEmployeeAccess(principal, employeeId);
  }

  private async loadPlan(id: string) {
    const plan = await this.prisma.client.learningPlan.findFirst({ where: { id } });
    if (!plan) throw new NotFoundError('Learning plan', 'LEARNING_PLAN_NOT_FOUND');
    return plan;
  }

  private serializeCourse<T extends object>(course: T) {
    const withRelations = course as T & {
      skills?: { skill: { id: string; name: string; category: string | null } }[];
      durationHours?: unknown;
    };
    const { skills, ...rest } = withRelations;
    return {
      ...rest,
      durationHours: withRelations.durationHours === null || withRelations.durationHours === undefined ? null : Number(withRelations.durationHours),
      skills: skills?.map((link) => link.skill) ?? [],
    };
  }

  private serializeAssignment<T extends object>(assignment: T) {
    const value = assignment as T & { dueDate?: Date | null; completedAt?: Date | null; score?: unknown; status: string };
    const today = startOfDay(new Date());
    // Assignment rows use EnrollmentStatus (which has no EXPIRED member), so an
    // overdue open assignment is surfaced as `displayStatus: 'EXPIRED'`.
    const isOverdue =
      value.dueDate != null && value.dueDate < today && (value.status === 'ASSIGNED' || value.status === 'IN_PROGRESS');
    return {
      ...value,
      score: value.score === null || value.score === undefined ? null : Number(value.score),
      isOverdue,
      displayStatus: isOverdue ? 'EXPIRED' : value.status,
    };
  }

  private serializeCertification<T extends object>(certification: T) {
    const value = certification as T & { status: CertificationStatus; expiresAt: Date | null };
    return { ...value, status: effectiveCertificationStatus(value.status, value.expiresAt) };
  }

  private serializePlan<T extends object>(plan: T) {
    const value = plan as T & { items?: { status: string }[] };
    const items = value.items ?? [];
    const completed = items.filter((item) => item.status === 'COMPLETED').length;
    return {
      ...value,
      itemsCompleted: completed,
      itemsTotal: items.length,
      progress: items.length > 0 ? Math.round((completed / items.length) * 100) : 0,
    };
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Certification expiry is derived from `expiresAt` so the stored status can
 * never go stale: EXPIRED once past, EXPIRING inside the 30-day warning window.
 */
function effectiveCertificationStatus(stored: CertificationStatus, expiresAt: Date | null): CertificationStatus {
  if (stored === 'REVOKED') return 'REVOKED';
  if (!expiresAt) return 'VALID';
  const today = startOfDay(new Date());
  if (expiresAt < today) return 'EXPIRED';
  if (expiresAt <= addDays(today, CERTIFICATION_EXPIRING_WINDOW_DAYS)) return 'EXPIRING';
  return 'VALID';
}

/** Translates the derived certification status into a database filter. */
function certificationStatusFilter(status: CertificationStatus): Record<string, unknown> {
  const today = startOfDay(new Date());
  const windowEnd = addDays(today, CERTIFICATION_EXPIRING_WINDOW_DAYS);
  switch (status) {
    case 'EXPIRED':
      return { status: { not: 'REVOKED' }, expiresAt: { not: null, lt: today } };
    case 'EXPIRING':
      return { status: { not: 'REVOKED' }, expiresAt: { not: null, gte: today, lte: windowEnd } };
    case 'VALID':
      return { status: { not: 'REVOKED' }, OR: [{ expiresAt: null }, { expiresAt: { gt: windowEnd } }] };
    default:
      return { status: 'REVOKED' };
  }
}
