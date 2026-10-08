import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LoginResult, Principal } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../common/errors/app-error.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../common/utils/password.util.js';
import { randomToken, sha256 } from '../common/utils/crypto.util.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { RbacService } from '../modules/rbac/rbac.service.js';
import { MailService } from '../modules/mail/mail.service.js';
import { TenantProvisioningService } from '../modules/tenancy/tenant-provisioning.service.js';
import { MfaService } from './mfa.service.js';
import { PrincipalService } from './principal.service.js';
import { TokenService, type IssuedTokens, type SessionMetadata } from './token.service.js';
import type {
  AcceptInvitationDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterCompanyDto,
} from './dto/auth.dto.js';

const VERIFICATION_TOKEN_TTL_MS = 24 * 3_600_000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 86_400_000;
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60_000;

/**
 * Authentication: password sign-in with lockout, email verification, password
 * reset, invitations, MFA challenge completion and refresh-token rotation.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly principals: PrincipalService,
    private readonly provisioning: TenantProvisioningService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ── Company self-signup ───────────────────────────────────────────────────

  async registerCompany(dto: RegisterCompanyDto, meta: SessionMetadata): Promise<LoginResult & { tenantId: string }> {
    const passwordCheck = validatePasswordPolicy(dto.password);
    if (!passwordCheck.valid) throw new ValidationError(passwordCheck.problems.join('; '));

    const slugTaken = await this.prisma.raw.tenant.findFirst({ where: { slug: dto.slug } });
    if (slugTaken) throw new ConflictError(`Company slug "${dto.slug}" is already taken`, 'TENANT_SLUG_TAKEN');
    const emailTaken = await this.prisma.raw.user.findFirst({ where: { email: dto.email.toLowerCase() } });
    if (emailTaken) throw new ConflictError('An account with this email already exists', 'EMAIL_TAKEN');

    const tenant = await this.prisma.raw.tenant.create({
      data: {
        name: dto.companyName,
        slug: dto.slug,
        locale: dto.locale ?? 'bg',
        status: 'ACTIVE',
        plan: 'STARTER',
      },
    });

    await this.provisioning.provision(tenant.id, tenant.locale);

    const user = await this.prisma.forTenant(tenant.id, (db) =>
      db.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
          passwordHash: null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          locale: tenant.locale,
          status: 'ACTIVE',
        },
      }),
    );

    await this.rbac.assignRolesToUser(tenant.id, user.id, ['COMPANY_ADMIN']);
    await this.issueEmailVerification(user.id, tenant.id, user.email, user.firstName, tenant.name, tenant.locale);

    const passwordHash = await hashPassword(dto.password);
    await this.prisma.raw.user.update({ where: { id: user.id }, data: { passwordHash } });

    const issued = await this.tokens.issueSession({ id: user.id, tenantId: tenant.id }, meta);
    const principal = await this.principals.build(user.id, issued.sessionId);
    await this.audit.record({
      action: 'auth.company.register',
      entityType: 'Tenant',
      entityId: tenant.id,
      actorUserId: user.id,
      tenantId: tenant.id,
      after: { name: tenant.name, slug: tenant.slug },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { ...toLoginResult(issued, principal), tenantId: tenant.id };
  }

  // ── Password sign-in ──────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: SessionMetadata): Promise<LoginResult> {
    const email = dto.email.toLowerCase();
    const candidates = await this.prisma.raw.user.findMany({
      where: { email, deletedAt: null },
      include: { tenant: { select: { id: true, slug: true, name: true, status: true } } },
    });

    let user: (typeof candidates)[number] | undefined = candidates[0];
    if (dto.tenantSlug) {
      user =
        candidates.find((candidate) => candidate.tenant?.slug === dto.tenantSlug) ??
        candidates.find((candidate) => candidate.tenantId === null);
    } else if (candidates.length > 1) {
      throw new ValidationError('This email belongs to multiple companies — provide tenantSlug', {
        code: 'TENANT_REQUIRED',
        tenants: candidates.map((candidate) => candidate.tenant?.slug).filter(Boolean),
      });
    }

    if (!user) {
      // Equalize timing so account existence is not observable.
      await verifyPassword(dto.password, 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account temporarily locked after failed attempts', 'ACCOUNT_LOCKED');
    }

    const passwordValid = await verifyPassword(dto.password, user.passwordHash);
    if (!passwordValid) {
      const attempts = user.failedLoginAttempts + 1;
      await this.prisma.raw.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
        tenantId: user.tenantId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        actorType: 'USER',
      });
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (user.status === 'DISABLED' || user.status === 'SUSPENDED') {
      throw new UnauthorizedError('Account is not active', 'ACCOUNT_INACTIVE');
    }

    if (user.tenant && user.tenant.status === 'SUSPENDED') {
      throw new UnauthorizedError('Company workspace is suspended', 'TENANT_SUSPENDED');
    }

    if (user.mfaEnabled) {
      const mfaToken = await this.tokens.signMfaTicket(user.id);
      return { mfaRequired: true, mfaToken };
    }

    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });

    const issued = await this.tokens.issueSession({ id: user.id, tenantId: user.tenantId }, meta);
    const principal = await this.principals.build(user.id, issued.sessionId);
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      tenantId: user.tenantId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      actorType: 'USER',
    });

    return toLoginResult(issued, principal);
  }

  async completeMfaLogin(mfaToken: string, code: string, meta: SessionMetadata): Promise<LoginResult> {
    const userId = await this.tokens.verifyMfaTicket(mfaToken);
    const user = await this.prisma.raw.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedError('Account not found', 'ACCOUNT_NOT_FOUND');

    const valid = await this.mfa.verify(user.id, code);
    if (!valid) {
      await this.audit.record({
        action: 'auth.mfa.failed',
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
        tenantId: user.tenantId,
        ip: meta.ip,
      });
      throw new UnauthorizedError('Invalid verification code', 'MFA_CODE_INVALID');
    }

    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });

    const issued = await this.tokens.issueSession({ id: user.id, tenantId: user.tenantId }, meta);
    const principal = await this.principals.build(user.id, issued.sessionId);
    await this.audit.record({
      action: 'auth.login.mfa',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      tenantId: user.tenantId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return toLoginResult(issued, principal);
  }

  async refresh(refreshToken: string, meta: SessionMetadata): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, meta);
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'LOGOUT');
    this.principals.invalidateUser(userId);
    await this.audit.record({ action: 'auth.logout', entityType: 'Session', entityId: sessionId, actorUserId: userId });
  }

  async logoutAll(userId: string): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllForUser(userId, 'LOGOUT_ALL');
    this.principals.invalidateUser(userId);
    await this.audit.record({ action: 'auth.logout_all', entityType: 'User', entityId: userId, actorUserId: userId });
    return { revoked };
  }

  // ── Email verification & password reset ───────────────────────────────────

  async verifyEmail(rawToken: string): Promise<{ verified: boolean; email?: string }> {
    const token = await this.prisma.raw.verificationToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!token || token.type !== 'EMAIL_VERIFICATION' || token.usedAt || token.expiresAt < new Date()) {
      throw new UnauthorizedError('Verification link is invalid or expired', 'TOKEN_INVALID');
    }

    await this.prisma.raw.$transaction([
      this.prisma.raw.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.raw.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date(), status: token.user.status === 'INVITED' ? 'ACTIVE' : token.user.status },
      }),
    ]);
    await this.audit.record({
      action: 'auth.email.verified',
      entityType: 'User',
      entityId: token.userId,
      actorUserId: token.userId,
      tenantId: token.user.tenantId,
    });
    return { verified: true, email: token.user.email };
  }

  async resendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      include: { tenant: { select: { id: true, name: true } } },
    });
    if (!user || user.emailVerifiedAt) return { sent: false };
    await this.issueEmailVerification(
      user.id,
      user.tenantId,
      user.email,
      user.firstName,
      user.tenant?.name ?? 'PeopleCore',
      user.locale,
    );
    return { sent: true };
  }

  async requestPasswordReset(dto: ForgotPasswordDto): Promise<{ sent: boolean }> {
    const email = dto.email.toLowerCase();
    const candidates = await this.prisma.raw.user.findMany({
      where: { email, deletedAt: null },
      include: { tenant: { select: { slug: true, name: true } } },
    });
    const user = dto.tenantSlug
      ? candidates.find((candidate) => candidate.tenant?.slug === dto.tenantSlug)
      : candidates[0];

    // Always answer positively — never disclose whether an account exists.
    if (!user) return { sent: true };

    const rawToken = randomToken(32);
    await this.prisma.raw.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const url = `${this.config.webAppUrl}/reset-password?token=${rawToken}`;
    await this.mail.sendPasswordResetEmail(user.email, {
      recipientName: user.firstName,
      url,
      expiresInHours: 1,
      locale: user.locale,
    });
    await this.audit.record({
      action: 'auth.password.reset_requested',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      tenantId: user.tenantId,
    });
    return { sent: true };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<{ reset: boolean }> {
    const passwordCheck = validatePasswordPolicy(newPassword);
    if (!passwordCheck.valid) throw new ValidationError(passwordCheck.problems.join('; '));

    const token = await this.prisma.raw.verificationToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!token || token.type !== 'PASSWORD_RESET' || token.usedAt || token.expiresAt < new Date()) {
      throw new UnauthorizedError('Reset link is invalid or expired', 'TOKEN_INVALID');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.raw.$transaction([
      this.prisma.raw.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.raw.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' },
      }),
    ]);
    await this.tokens.revokeAllForUser(token.userId, 'PASSWORD_RESET');
    this.principals.invalidateUser(token.userId);
    await this.audit.record({
      action: 'auth.password.reset',
      entityType: 'User',
      entityId: token.userId,
      actorUserId: token.userId,
    });
    return { reset: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
    const user = await this.prisma.raw.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError();
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedError('Current password is incorrect', 'INVALID_CREDENTIALS');
    }
    const passwordCheck = validatePasswordPolicy(newPassword);
    if (!passwordCheck.valid) throw new ValidationError(passwordCheck.problems.join('; '));

    await this.prisma.raw.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await this.audit.record({ action: 'auth.password.changed', entityType: 'User', entityId: userId, actorUserId: userId });
    return { changed: true };
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  async createInvitation(
    tenantId: string,
    input: { email: string; name: string; roleKeys: string[]; invitedById: string; locale?: string; companyName: string },
  ): Promise<{ invitationId: string }> {
    const email = input.email.toLowerCase();
    const existingUser = await this.prisma.raw.user.findFirst({ where: { email, tenantId, deletedAt: null } });
    if (existingUser) throw new ConflictError('A user with this email already exists in this company', 'EMAIL_TAKEN');

    const rawToken = randomToken(32);
    const invitation = await this.prisma.raw.userInvitation.create({
      data: {
        tenantId,
        email,
        roleKeys: input.roleKeys,
        invitedById: input.invitedById,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const url = `${this.config.webAppUrl}/accept-invitation?token=${rawToken}`;
    await this.mail.sendInvitationEmail(email, {
      recipientName: input.name,
      url,
      expiresInHours: 168,
      locale: input.locale,
      companyName: input.companyName,
    });
    await this.audit.record({
      action: 'user.invited',
      entityType: 'UserInvitation',
      entityId: invitation.id,
      actorUserId: input.invitedById,
      tenantId,
      after: { email, roleKeys: input.roleKeys },
    });
    return { invitationId: invitation.id };
  }

  async acceptInvitation(dto: AcceptInvitationDto, meta: SessionMetadata): Promise<LoginResult> {
    const passwordCheck = validatePasswordPolicy(dto.password);
    if (!passwordCheck.valid) throw new ValidationError(passwordCheck.problems.join('; '));

    const invitation = await this.prisma.raw.userInvitation.findUnique({
      where: { tokenHash: sha256(dto.token) },
      include: { tenant: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
      throw new UnauthorizedError('Invitation is invalid or has expired', 'INVITATION_INVALID');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.forTenant(invitation.tenantId, async (db) => {
      const created = await db.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          passwordHash,
          firstName: dto.firstName ?? invitation.email.split('@')[0],
          lastName: dto.lastName ?? '',
          locale: invitation.tenant.locale,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      await db.userInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      return created;
    });

    await this.rbac.assignRolesToUser(invitation.tenantId, user.id, invitation.roleKeys, invitation.invitedById ?? undefined);
    const issued = await this.tokens.issueSession({ id: user.id, tenantId: user.tenantId }, meta);
    const principal = await this.principals.build(user.id, issued.sessionId);
    await this.audit.record({
      action: 'user.invitation.accepted',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      tenantId: invitation.tenantId,
    });
    return toLoginResult(issued, principal);
  }

  // ── Session listing ───────────────────────────────────────────────────────

  async listSessions(userId: string, currentSessionId: string) {
    return this.tokens.listSessions(userId, currentSessionId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.raw.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new UnauthorizedError('Session not found', 'SESSION_NOT_FOUND');
    await this.tokens.revokeSession(sessionId, 'REVOKED_BY_USER');
    this.principals.invalidateUser(userId);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async issueEmailVerification(
    userId: string,
    tenantId: string | null,
    email: string,
    firstName: string,
    companyName: string,
    locale?: string,
  ): Promise<void> {
    const rawToken = randomToken(32);
    await this.prisma.raw.verificationToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFICATION',
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const url = `${this.config.webAppUrl}/verify-email?token=${rawToken}`;
    await this.mail.sendVerificationEmail(email, {
      recipientName: firstName,
      url,
      expiresInHours: 24,
      locale,
    });
    void tenantId;
    void companyName;
  }
}

function toLoginResult(tokens: IssuedTokens, principal: Principal | null): LoginResult {
  const { sessionId, ...rest } = tokens;
  void sessionId;
  return { mfaRequired: false, tokens: rest, user: principal ?? undefined };
}
