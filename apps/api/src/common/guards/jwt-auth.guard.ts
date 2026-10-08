import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { requestContextStorage } from '../../prisma/request-context.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { PrincipalService } from '../../auth/principal.service.js';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  tid: string | null;
  typ: 'access';
}

export interface AuthenticatedRequest extends Request {
  principal?: import('@peoplecore/shared').Principal;
}

/**
 * Verifies the Bearer access token, validates the session and attaches the
 * principal to the request and the request context. Public routes may still
 * carry a token (optional authentication) — invalid tokens are simply ignored
 * there.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly principals: PrincipalService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedError('Missing access token', 'TOKEN_MISSING');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.config.auth.accessSecret });
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedError('Invalid or expired access token', 'TOKEN_INVALID');
    }

    if (payload.typ !== 'access') {
      if (isPublic) return true;
      throw new UnauthorizedError('Invalid token type', 'TOKEN_INVALID');
    }

    const principal = await this.principals.build(payload.sub, payload.sid);
    if (!principal) {
      if (isPublic) return true;
      throw new UnauthorizedError('Session is no longer valid', 'SESSION_REVOKED');
    }

    request.principal = principal;
    const store = requestContextStorage.getStore();
    if (store) {
      store.tenantId = principal.tenantId;
      store.userId = principal.userId;
      store.employeeId = principal.employeeId;
      store.isSuperAdmin = principal.isSuperAdmin;
      store.permissions = principal.permissions;
    }
    return true;
  }
}

export function extractBearerToken(request: Request): string | undefined {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}
