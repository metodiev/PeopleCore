import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LoginResult } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../common/utils/crypto.util.js';
import { IntegrationError, UnauthorizedError, ValidationError } from '../common/errors/app-error.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { RbacService } from '../modules/rbac/rbac.service.js';
import { PrincipalService } from './principal.service.js';
import { TokenService, type SessionMetadata } from './token.service.js';

export type OAuthProviderName = 'google' | 'microsoft';
export type OAuthFlowMode = 'login' | 'calendar';

interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

interface ProviderProfile {
  providerAccountId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Google and Microsoft OAuth 2.0 (authorization-code flow).
 *
 * Two flows share the same plumbing:
 *  - `login`    — sign in / provision a user in a company workspace;
 *  - `calendar` — connect a calendar account (the callback hands the tokens to
 *                 the integrations module, which stores them encrypted).
 *
 * Credentials come exclusively from the environment — when they are absent the
 * endpoints answer 503 instead of failing obscurely.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.crypto = new CryptoService(config.encryptionKey);
  }

  isConfigured(provider: OAuthProviderName): boolean {
    const settings = provider === 'google' ? this.config.oauth.google : this.config.oauth.microsoft;
    return Boolean(settings.clientId && settings.clientSecret);
  }

  private endpoints(provider: OAuthProviderName, scopes?: string[]): ProviderEndpoints {
    if (provider === 'google') {
      return {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scopes: scopes ?? ['openid', 'email', 'profile'],
      };
    }
    const tenant = this.config.oauth.microsoft.tenantId;
    return {
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: scopes ?? ['openid', 'email', 'profile', 'offline_access', 'User.Read'],
    };
  }

  private redirectUri(provider: OAuthProviderName): string {
    const settings = provider === 'google' ? this.config.oauth.google : this.config.oauth.microsoft;
    if (settings.redirectUri) return settings.redirectUri;
    return `${this.config.webAppUrl}/api/${this.config.apiVersion}/auth/oauth/${provider}/callback`;
  }

  /** Builds the provider authorization URL and the signed `state` parameter. */
  async buildAuthorizationUrl(
    provider: OAuthProviderName,
    input: { tenantSlug?: string; mode: OAuthFlowMode; userId?: string; redirectTo?: string; scopes?: string[] },
  ): Promise<{ url: string; state: string }> {
    if (!this.isConfigured(provider)) {
      throw new IntegrationError(`${provider} OAuth is not configured on this server`, 'OAUTH_NOT_CONFIGURED');
    }

    let tenantId: string | null = null;
    if (input.tenantSlug) {
      const tenant = await this.prisma.raw.tenant.findFirst({ where: { slug: input.tenantSlug, deletedAt: null } });
      if (!tenant) throw new ValidationError(`Unknown company "${input.tenantSlug}"`);
      tenantId = tenant.id;
    }

    const state = await this.tokens.signOneTimeToken(
      { provider, mode: input.mode, tenantId, userId: input.userId ?? null, redirectTo: input.redirectTo ?? null },
      'oauth_state',
      '10m',
    );

    const endpoints = this.endpoints(provider, input.scopes);
    const params = new URLSearchParams({
      client_id: this.clientId(provider),
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: endpoints.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return { url: `${endpoints.authorizeUrl}?${params.toString()}`, state };
  }

  async exchangeCode(provider: OAuthProviderName, code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes: string[];
    profile: ProviderProfile;
  }> {
    const endpoints = this.endpoints(provider);
    const body = new URLSearchParams({
      client_id: this.clientId(provider),
      client_secret: this.clientSecret(provider),
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri(provider),
    });

    const response = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      const detail = await response.text();
      this.logger.warn(`Token exchange failed (${provider}): ${response.status} ${detail.slice(0, 300)}`);
      throw new IntegrationError('Failed to exchange the authorization code', 'OAUTH_EXCHANGE_FAILED');
    }

    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    const profile = await this.fetchProfile(provider, payload.access_token);
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
      scopes: payload.scope?.split(' ') ?? [],
      profile,
    };
  }

  /** Verifies the state parameter and returns its payload. */
  async verifyState(state: string): Promise<{
    provider: OAuthProviderName;
    mode: OAuthFlowMode;
    tenantId: string | null;
    userId: string | null;
    redirectTo: string | null;
  }> {
    const payload = await this.tokens.verifyOneTimeToken(state, 'oauth_state');
    return {
      provider: payload['provider'] as OAuthProviderName,
      mode: payload['mode'] as OAuthFlowMode,
      tenantId: (payload['tenantId'] as string | null) ?? null,
      userId: (payload['userId'] as string | null) ?? null,
      redirectTo: (payload['redirectTo'] as string | null) ?? null,
    };
  }

  /**
   * Sign-in flow: links the provider identity to an existing user in the
   * company, or provisions a new employee account (provider-verified email).
   */
  async loginWithProvider(
    provider: OAuthProviderName,
    tenantId: string | null,
    profile: ProviderProfile,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date; scopes: string[] },
    meta: SessionMetadata,
  ): Promise<LoginResult> {
    if (!profile.email) {
      throw new UnauthorizedError('The provider did not return an email address', 'OAUTH_EMAIL_MISSING');
    }
    const email = profile.email.toLowerCase();

    let account = await this.prisma.raw.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: provider.toUpperCase() as 'GOOGLE' | 'MICROSOFT', providerAccountId: profile.providerAccountId } },
      include: { user: true },
    });

    let user = account?.user ?? null;
    if (!user && tenantId) {
      user = await this.prisma.raw.user.findFirst({ where: { email, tenantId, deletedAt: null } });
    }

    if (!user) {
      if (!tenantId) {
        throw new UnauthorizedError('No PeopleCore account is linked to this identity', 'OAUTH_NO_ACCOUNT');
      }
      const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new UnauthorizedError('Company not found', 'OAUTH_NO_ACCOUNT');

      user = await this.prisma.forTenant(tenantId, (db) =>
        db.user.create({
          data: {
            tenantId,
            email,
            firstName: profile.firstName ?? email.split('@')[0],
            lastName: profile.lastName ?? '',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            locale: tenant.locale,
          },
        }),
      );
      await this.rbac.assignRolesToUser(tenantId, user.id, ['EMPLOYEE']);
      await this.audit.record({
        action: 'auth.oauth.signup',
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
        tenantId,
        after: { provider, email },
      });
    }

    const encryptedTokens = this.encryptTokens(tokens);
    if (account) {
      await this.prisma.raw.oAuthAccount.update({
        where: { id: account.id },
        data: encryptedTokens,
      });
    } else {
      account = await this.prisma.raw.oAuthAccount.create({
        data: {
          userId: user.id,
          provider: provider.toUpperCase() as 'GOOGLE' | 'MICROSOFT',
          providerAccountId: profile.providerAccountId,
          email,
          ...encryptedTokens,
        },
        include: { user: true },
      });
    }

    const issued = await this.tokens.issueSession({ id: user.id, tenantId: user.tenantId }, meta);
    const principal = await this.principals.build(user.id, issued.sessionId);
    await this.audit.record({
      action: 'auth.login.oauth',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      tenantId: user.tenantId,
      metadata: { provider },
      ip: meta.ip,
    });
    const { sessionId, ...tokenPayload } = issued;
    void sessionId;
    return { mfaRequired: false, tokens: tokenPayload, user: principal ?? undefined };
  }

  encryptTokens(tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date; scopes: string[] }) {
    return {
      accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes,
    };
  }

  decryptTokens(connection: { accessTokenEnc: string | null; refreshTokenEnc: string | null }) {
    return {
      accessToken: connection.accessTokenEnc ? this.crypto.decrypt(connection.accessTokenEnc) : null,
      refreshToken: connection.refreshTokenEnc ? this.crypto.decrypt(connection.refreshTokenEnc) : null,
    };
  }

  /** One-time token the browser exchanges for a session after the redirect. */
  async createExchangeToken(sessionIssued: LoginResult): Promise<string> {
    return this.tokens.signOneTimeToken({ result: sessionIssued }, 'oauth_exchange', '5m');
  }

  async consumeExchangeToken(token: string): Promise<LoginResult> {
    const payload = await this.tokens.verifyOneTimeToken(token, 'oauth_exchange');
    return payload['result'] as LoginResult;
  }

  private async fetchProfile(provider: OAuthProviderName, accessToken: string): Promise<ProviderProfile> {
    const endpoints = this.endpoints(provider);
    const response = await fetch(endpoints.userInfoUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new IntegrationError('Failed to load the provider profile', 'OAUTH_PROFILE_FAILED');
    const data = (await response.json()) as Record<string, unknown>;

    if (provider === 'google') {
      return {
        providerAccountId: String(data['sub'] ?? ''),
        email: (data['email'] as string | undefined)?.toLowerCase() ?? null,
        firstName: (data['given_name'] as string | undefined) ?? null,
        lastName: (data['family_name'] as string | undefined) ?? null,
      };
    }

    const email =
      ((data['mail'] as string | undefined) ?? (data['userPrincipalName'] as string | undefined))?.toLowerCase() ?? null;
    return {
      providerAccountId: String(data['id'] ?? ''),
      email,
      firstName: (data['givenName'] as string | undefined) ?? null,
      lastName: (data['surname'] as string | undefined) ?? null,
    };
  }

  private clientId(provider: OAuthProviderName): string {
    const settings = provider === 'google' ? this.config.oauth.google : this.config.oauth.microsoft;
    if (!settings.clientId) throw new IntegrationError(`${provider} client id is not configured`, 'OAUTH_NOT_CONFIGURED');
    return settings.clientId;
  }

  private clientSecret(provider: OAuthProviderName): string {
    const settings = provider === 'google' ? this.config.oauth.google : this.config.oauth.microsoft;
    if (!settings.clientSecret) {
      throw new IntegrationError(`${provider} client secret is not configured`, 'OAUTH_NOT_CONFIGURED');
    }
    return settings.clientSecret;
  }
}
