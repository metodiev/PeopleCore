import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AuthTokens } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnauthorizedError } from '../common/errors/app-error.js';
import { randomToken, sha256 } from '../common/utils/crypto.util.js';
import { PrincipalService } from './principal.service.js';

export interface SessionMetadata {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens extends AuthTokens {
  sessionId: string;
}

/** `jsonwebtoken` types expect its own StringValue union; TTLs come from env. */
function jwtExpiry(ttl: string): number {
  return parseDurationMs(ttl, 900_000) / 1000;
}

export function parseDurationMs(value: string, fallbackMs: number): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] as number;
  return amount * factor;
}

/**
 * Access tokens are short-lived JWTs; refresh tokens are opaque, hashed at
 * rest and rotated on every use (with reuse detection that revokes the whole
 * token family). One `Session` row represents one refresh token lineage.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly principals: PrincipalService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issueSession(
    user: { id: string; tenantId: string | null },
    metadata: SessionMetadata,
    family: string = randomUUID(),
  ): Promise<IssuedTokens> {
    const refreshToken = randomToken(48);
    const refreshTtlMs = parseDurationMs(this.config.auth.refreshTtl, 30 * 86_400_000);
    const expiresAt = new Date(Date.now() + refreshTtlMs);

    const session = await this.prisma.raw.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        family,
        expiresAt,
        ip: metadata.ip,
        userAgent: metadata.userAgent?.slice(0, 512),
        lastUsedAt: new Date(),
      },
    });

    const accessToken = await this.signAccessToken(user.id, session.id, user.tenantId);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: Math.floor(parseDurationMs(this.config.auth.accessTtl, 900_000) / 1000),
      refreshTokenExpiresAt: expiresAt.toISOString(),
      tokenType: 'Bearer',
      sessionId: session.id,
    };
  }

  /**
   * Rotates a refresh token. Presenting a revoked token is treated as a
   * possible theft: the entire token family is revoked.
   */
  async rotate(refreshToken: string, metadata: SessionMetadata): Promise<IssuedTokens> {
    const session = await this.prisma.raw.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: { select: { id: true, tenantId: true, deletedAt: true, status: true } } },
    });

    if (!session) throw new UnauthorizedError('Invalid refresh token', 'TOKEN_INVALID');

    if (session.revokedAt) {
      await this.revokeFamily(session.family, 'TOKEN_REUSE_DETECTED');
      throw new UnauthorizedError('Refresh token reuse detected — all sessions revoked', 'TOKEN_REUSE_DETECTED');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.revokeSession(session.id, 'EXPIRED');
      throw new UnauthorizedError('Refresh token expired', 'TOKEN_EXPIRED');
    }

    if (!session.user || session.user.deletedAt || session.user.status === 'DISABLED') {
      await this.revokeFamily(session.family, 'USER_INACTIVE');
      throw new UnauthorizedError('Account is not active', 'ACCOUNT_INACTIVE');
    }

    await this.prisma.raw.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED', lastUsedAt: new Date() },
    });

    const issued = await this.issueSession(session.user, metadata, session.family);
    await this.prisma.raw.session.update({
      where: { id: session.id },
      data: { replacedBySessionId: issued.sessionId },
    });
    this.principals.invalidateUser(session.user.id);
    return issued;
  }

  async signAccessToken(userId: string, sessionId: string, tenantId: string | null): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, tid: tenantId, typ: 'access' },
      { secret: this.config.auth.accessSecret, expiresIn: jwtExpiry(this.config.auth.accessTtl) },
    );
  }

  /** Short-lived ticket issued between password and MFA verification. */
  async signMfaTicket(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: 'mfa' },
      { secret: this.config.auth.accessSecret, expiresIn: 300 },
    );
  }

  async verifyMfaTicket(ticket: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(ticket, {
        secret: this.config.auth.accessSecret,
      });
      if (payload.typ !== 'mfa') throw new Error('wrong type');
      return payload.sub;
    } catch {
      throw new UnauthorizedError('MFA challenge expired, sign in again', 'MFA_TICKET_INVALID');
    }
  }

  async verifyOneTimeToken(token: string, expectedType: string): Promise<Record<string, unknown>> {
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: this.config.auth.accessSecret,
      });
      if (payload['typ'] !== expectedType) throw new Error('wrong type');
      return payload;
    } catch {
      throw new UnauthorizedError('Link is invalid or has expired', 'TOKEN_INVALID');
    }
  }

  async signOneTimeToken(payload: Record<string, unknown>, type: string, ttl: string): Promise<string> {
    return this.jwt.signAsync(
      { ...payload, typ: type },
      { secret: this.config.auth.accessSecret, expiresIn: jwtExpiry(ttl) },
    );
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const session = await this.prisma.raw.session.findUnique({ where: { id: sessionId } });
    await this.prisma.raw.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (session) this.principals.invalidateUser(session.userId);
  }

  async revokeFamily(family: string, reason: string): Promise<void> {
    const sessions = await this.prisma.raw.session.findMany({ where: { family }, select: { userId: true } });
    await this.prisma.raw.session.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    for (const userId of new Set(sessions.map((session) => session.userId))) {
      this.principals.invalidateUser(userId);
    }
  }

  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.raw.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    this.principals.invalidateUser(userId);
    return result.count;
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.raw.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
    }));
  }
}
