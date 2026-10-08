import { Injectable } from '@nestjs/common';
import type { Paginated } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { hashPassword, validatePasswordPolicy } from '../../common/utils/password.util.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { AuditService } from '../audit/audit.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { PrincipalService } from '../../auth/principal.service.js';
import { AuthService } from '../../auth/auth.service.js';
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto.js';

const SORTABLE = ['createdAt', 'email', 'firstName', 'lastName', 'status', 'lastLoginAt'] as const;

/**
 * User accounts inside a company: creation, invitations, role assignment and
 * status changes. Employees without a login have no User record — the two are
 * linked through `Employee.userId`.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
    private readonly auth: AuthService,
  ) {}

  async list(tenantId: string, query: UserQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE);
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.roleKey) where['roles'] = { some: { role: { key: query.roleKey } } };
    if (query.search) {
      where['OR'] = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          roles: { include: { role: { select: { key: true, name: true } } } },
          employee: { select: { id: true, employeeNumber: true, photoUrl: true } },
        },
      }),
      this.prisma.client.user.count({ where }),
    ]);

    return paginate(
      rows.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        locale: user.locale,
        mfaEnabled: user.mfaEnabled,
        emailVerified: Boolean(user.emailVerifiedAt),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        roles: user.roles.map((userRole) => ({ key: userRole.role.key, name: userRole.role.name })),
        employee: user.employee,
      })),
      total,
      query,
    );
  }

  async get(tenantId: string, userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
      include: {
        roles: { include: { role: { select: { key: true, name: true } } } },
        employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, photoUrl: true } },
      },
    });
    if (!user) throw new NotFoundError('User', 'USER_NOT_FOUND');
    return user;
  }

  async create(
    tenantId: string,
    dto: CreateUserDto,
    actorUserId: string,
    options: { verifyEmail?: boolean } = {},
  ) {
    const existing = await this.prisma.raw.user.findFirst({ where: { tenantId, email: dto.email } });
    if (existing) throw new ConflictError('A user with this email already exists', 'EMAIL_TAKEN');

    let passwordHash: string | null = null;
    if (dto.password) {
      const policy = validatePasswordPolicy(dto.password);
      if (!policy.valid) throw new ValidationError(policy.problems.join('; '));
      passwordHash = await hashPassword(dto.password);
    }

    if (dto.employeeId) {
      const employee = await this.prisma.client.employee.findFirst({ where: { id: dto.employeeId } });
      if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
      if (employee.userId) throw new ConflictError('Employee already has a user account', 'EMPLOYEE_HAS_USER');
    }

    const user = await this.prisma.client.user.create({
      data: {
        tenantId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        locale: dto.locale ?? 'bg',
        passwordHash,
        status: passwordHash ? 'ACTIVE' : 'INVITED',
        emailVerifiedAt: options.verifyEmail && passwordHash ? new Date() : null,
      },
    });

    if (dto.employeeId) {
      await this.prisma.client.employee.update({ where: { id: dto.employeeId }, data: { userId: user.id } });
    }

    const roleKeys = dto.roleKeys?.length ? dto.roleKeys : ['EMPLOYEE'];
    await this.rbac.assignRolesToUser(tenantId, user.id, roleKeys, actorUserId);
    await this.audit.record({
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      actorUserId,
      tenantId,
      after: { email: user.email, roleKeys },
    });
    return { id: user.id, email: user.email, status: user.status };
  }

  async update(tenantId: string, userId: string, dto: UpdateUserDto, actorUserId: string) {
    const before = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!before) throw new NotFoundError('User', 'USER_NOT_FOUND');

    let passwordHash: string | undefined;
    if (dto.password) {
      const policy = validatePasswordPolicy(dto.password);
      if (!policy.valid) throw new ValidationError(policy.problems.join('; '));
      passwordHash = await hashPassword(dto.password);
    }

    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        locale: dto.locale,
        avatarUrl: dto.avatarUrl,
        status: dto.status,
        passwordHash,
      },
    });

    if (dto.roleKeys) {
      await this.rbac.assignRolesToUser(tenantId, userId, dto.roleKeys, actorUserId);
    }
    if (dto.status && dto.status !== 'ACTIVE') {
      await this.prisma.raw.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: `STATUS_${dto.status}` },
      });
    }

    this.principals.invalidateUser(userId);
    await this.audit.record({
      action: 'user.update',
      entityType: 'User',
      entityId: userId,
      actorUserId,
      tenantId,
      before: { status: before.status, firstName: before.firstName, lastName: before.lastName },
      after: { status: updated.status, firstName: updated.firstName, lastName: updated.lastName, roleKeys: dto.roleKeys },
    });
    return { id: updated.id, status: updated.status };
  }

  async assignRoles(tenantId: string, userId: string, roleKeys: string[], actorUserId: string) {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundError('User', 'USER_NOT_FOUND');
    const before = await this.rbac.effectivePermissions(userId);
    await this.rbac.assignRolesToUser(tenantId, userId, roleKeys, actorUserId);
    this.principals.invalidateUser(userId);
    const after = await this.rbac.effectivePermissions(userId);
    await this.audit.record({
      action: 'user.roles.assign',
      entityType: 'User',
      entityId: userId,
      actorUserId,
      tenantId,
      before: { permissions: before },
      after: { roleKeys, permissions: after },
    });
    return { roleKeys };
  }

  async remove(tenantId: string, userId: string, actorUserId: string) {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundError('User', 'USER_NOT_FOUND');
    if (user.isSuperAdmin) throw new ValidationError('Platform operators cannot be deleted here');

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    });
    await this.prisma.raw.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_DELETED' },
    });
    this.principals.invalidateUser(userId);
    await this.audit.record({
      action: 'user.delete',
      entityType: 'User',
      entityId: userId,
      actorUserId,
      tenantId,
      before: { email: user.email, status: user.status },
    });
    return { deleted: true };
  }

  async listInvitations() {
    const invitations = await this.prisma.client.userInvitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      roleKeys: invitation.roleKeys,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    }));
  }

  async invite(
    tenantId: string,
    dto: { email: string; name: string; roleKeys: string[] },
    actorUserId: string,
    invitedByName: string,
  ) {
    const tenant = await this.prisma.client.tenant.findFirst({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundError('Company', 'TENANT_NOT_FOUND');
    const result = await this.auth.createInvitation(tenantId, {
      email: dto.email,
      name: dto.name,
      roleKeys: dto.roleKeys,
      invitedById: actorUserId,
      companyName: tenant.name,
      locale: tenant.locale,
    });
    void invitedByName;
    return result;
  }

  async revokeInvitation(tenantId: string, invitationId: string, actorUserId: string) {
    const invitation = await this.prisma.client.userInvitation.findFirst({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundError('Invitation', 'INVITATION_NOT_FOUND');
    await this.prisma.client.userInvitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'user.invitation.revoked',
      entityType: 'UserInvitation',
      entityId: invitationId,
      actorUserId,
      tenantId,
    });
    return { revoked: true };
  }

  async sessions(tenantId: string, userId: string) {
    const sessions = await this.prisma.raw.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    void tenantId;
    return sessions.map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async revokeUserSession(userId: string, sessionId: string, actorUserId: string) {
    const session = await this.prisma.raw.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundError('Session', 'SESSION_NOT_FOUND');
    await this.prisma.raw.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' },
    });
    this.principals.invalidateUser(userId);
    await this.audit.record({
      action: 'user.session.revoked',
      entityType: 'Session',
      entityId: sessionId,
      actorUserId,
    });
    return { revoked: true };
  }
}
