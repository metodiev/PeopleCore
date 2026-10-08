import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import type { LoginResult, Principal } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { OAuthService, type OAuthProviderName } from './oauth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { UnauthorizedError, ValidationError } from '../common/errors/app-error.js';
import type { SessionMetadata } from './token.service.js';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MfaCodeDto,
  MfaVerifyLoginDto,
  OAuthExchangeDto,
  RefreshTokenDto,
  RegisterCompanyDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly oauth: OAuthService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ── Sign-up / sign-in ─────────────────────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create a company workspace and its first administrator' })
  register(@Body() dto: RegisterCompanyDto, @Req() request: Request): Promise<LoginResult & { tenantId: string }> {
    return this.auth.registerCompany(dto, sessionMeta(request));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Sign in with email and password (returns an MFA challenge when enabled)' })
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.login(dto, sessionMeta(request));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/verify')
  @ApiOperation({ summary: 'Complete the MFA challenge started by /auth/login' })
  verifyMfaLogin(@Body() dto: MfaVerifyLoginDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.completeMfaLogin(dto.mfaToken, dto.code, sessionMeta(request));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    const tokens = await this.auth.refresh(dto.refreshToken, sessionMeta(request));
    const { sessionId, ...payload } = tokens;
    void sessionId;
    return payload;
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.auth.logout(principal.sessionId, principal.userId);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('logout-all')
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  logoutAll(@CurrentPrincipal() principal: Principal) {
    return this.auth.logoutAll(principal.userId);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current user, effective permissions and company' })
  async me(@CurrentPrincipal() principal: Principal) {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: principal.userId },
      include: { tenant: { select: { id: true, name: true, slug: true, logoUrl: true, locale: true, timezone: true, currency: true } } },
    });
    if (!user) throw new UnauthorizedError('Account not found', 'ACCOUNT_NOT_FOUND');
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        emailVerified: Boolean(user.emailVerifiedAt),
        mfaEnabled: user.mfaEnabled,
        status: user.status,
      },
      tenant: user.tenant,
      roles: principal.roles,
      permissions: principal.permissions,
      isSuperAdmin: principal.isSuperAdmin,
      employeeId: principal.employeeId,
    };
  }

  // ── Email verification & passwords ────────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify-email')
  @ApiOperation({ summary: 'Confirm an email address using the token from the verification email' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('resend-verification')
  @ApiOperation({ summary: 'Re-send the email verification link' })
  resendVerification(@CurrentPrincipal() principal: Principal) {
    return this.auth.resendVerification(principal.userId);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset link (always answers 200)' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  @ApiOperation({ summary: 'Change the current password' })
  changePassword(@CurrentPrincipal() principal: Principal, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(principal.userId, dto.currentPassword, dto.newPassword);
  }

  // ── Multi-factor authentication ───────────────────────────────────────────

  @ApiBearerAuth()
  @Post('mfa/setup')
  @ApiOperation({ summary: 'Begin MFA setup — returns the TOTP secret and otpauth URL' })
  async setupMfa(@CurrentPrincipal() principal: Principal) {
    const user = await this.prisma.raw.user.findUnique({ where: { id: principal.userId } });
    const tenant = user?.tenantId ? await this.prisma.raw.tenant.findUnique({ where: { id: user.tenantId } }) : null;
    return this.mfa.beginSetup(principal.userId, principal.email, tenant?.name ?? 'PeopleCore');
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/enable')
  @ApiOperation({ summary: 'Activate MFA after verifying a TOTP code (returns recovery codes once)' })
  async enableMfa(@CurrentPrincipal() principal: Principal, @Body() dto: MfaCodeDto) {
    const result = await this.mfa.enable(principal.userId, dto.code);
    await this.audit.record({
      action: 'auth.mfa.enabled',
      entityType: 'User',
      entityId: principal.userId,
      actorUserId: principal.userId,
    });
    return result;
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/disable')
  @ApiOperation({ summary: 'Disable MFA (requires a valid code)' })
  async disableMfa(@CurrentPrincipal() principal: Principal, @Body() dto: MfaCodeDto) {
    await this.mfa.disable(principal.userId, dto.code);
    await this.audit.record({
      action: 'auth.mfa.disabled',
      entityType: 'User',
      entityId: principal.userId,
      actorUserId: principal.userId,
    });
    return { disabled: true };
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/recovery-codes')
  @ApiOperation({ summary: 'Regenerate MFA recovery codes' })
  regenerateRecoveryCodes(@CurrentPrincipal() principal: Principal, @Body() dto: MfaCodeDto) {
    if (!dto.code) throw new ValidationError('A verification code is required');
    return this.mfa.regenerateRecoveryCodes(principal.userId);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions of the current user' })
  sessions(@CurrentPrincipal() principal: Principal) {
    return this.auth.listSessions(principal.userId, principal.sessionId);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke one session' })
  async revokeSession(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.auth.revokeSession(principal.userId, id);
    return { revoked: true };
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('invitations/accept')
  @ApiOperation({ summary: 'Accept an invitation, set a password and sign in' })
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() request: Request) {
    return this.auth.acceptInvitation(dto, sessionMeta(request));
  }

  // ── OAuth (Google / Microsoft) ────────────────────────────────────────────

  @Public()
  @Get('oauth/:provider/start')
  @ApiOperation({ summary: 'Start the OAuth flow (google | microsoft)' })
  async oauthStart(
    @Param('provider') provider: string,
    @Query('tenantSlug') tenantSlug: string | undefined,
    @Query('redirectTo') redirectTo: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const normalized = assertProvider(provider);
    const { url } = await this.oauth.buildAuthorizationUrl(normalized, {
      tenantSlug,
      mode: 'login',
      redirectTo,
    });
    response.redirect(url);
  }

  @Public()
  @Get('oauth/:provider/callback')
  @ApiOperation({ summary: 'OAuth callback — links the identity and redirects to the web app' })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const normalized = assertProvider(provider);
    if (error) {
      response.redirect(`${this.config.webAppUrl}/auth/callback?error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) throw new ValidationError('Missing OAuth code or state');

    const statePayload = await this.oauth.verifyState(state);
    if (statePayload.mode !== 'login') {
      throw new ValidationError('This state parameter is not valid for sign-in');
    }

    const exchanged = await this.oauth.exchangeCode(normalized, code);
    const result = await this.oauth.loginWithProvider(
      normalized,
      statePayload.tenantId,
      exchanged.profile,
      {
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: exchanged.expiresAt,
        scopes: exchanged.scopes,
      },
      sessionMeta(request),
    );

    const oneTime = await this.oauth.createExchangeToken(result);
    const redirectTo = statePayload.redirectTo ?? '/';
    response.redirect(`${this.config.webAppUrl}/auth/callback?token=${encodeURIComponent(oneTime)}&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('oauth/exchange')
  @ApiOperation({ summary: 'Exchange the one-time OAuth token for a session' })
  oauthExchange(@Body() dto: OAuthExchangeDto): Promise<LoginResult> {
    return this.oauth.consumeExchangeToken(dto.token);
  }

  @Public()
  @Get('oauth/:provider/status')
  @ApiOperation({ summary: 'Whether a provider is configured on this server' })
  oauthStatus(@Param('provider') provider: string) {
    const normalized = assertProvider(provider);
    return { provider: normalized, configured: this.oauth.isConfigured(normalized) };
  }
}

function sessionMeta(request: Request): SessionMetadata {
  const forwarded = request.header('x-forwarded-for');
  return {
    ip: forwarded ? forwarded.split(',')[0]!.trim() : request.ip,
    userAgent: request.header('user-agent'),
  };
}

function assertProvider(provider: string): OAuthProviderName {
  if (provider !== 'google' && provider !== 'microsoft') {
    throw new ValidationError(`Unsupported provider "${provider}"`);
  }
  return provider;
}
