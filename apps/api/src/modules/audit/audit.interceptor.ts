import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { AuditService } from './audit.service.js';
import { AUDIT_ENTITY_KEY } from './audited.decorator.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const IGNORED_PATH_PATTERNS = [/\/auth\/login/, /\/auth\/refresh/, /\/auth\/mfa/, /\/notifications\/.*\/read/];

/**
 * Automatically audits mutating requests. Services additionally call
 * `AuditService.record()` directly when they can provide precise before/after
 * values (compensation changes, leave decisions, permission changes…).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request & { principal?: { userId: string } }>();
    if (!MUTATING_METHODS.has(request.method)) return next.handle();
    if (IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(request.path))) return next.handle();

    const entityType =
      this.reflector.getAllAndOverride<string>(AUDIT_ENTITY_KEY, [context.getHandler(), context.getClass()]) ??
      request.path.split('/').filter((segment) => segment && !/^v?\d+$/.test(segment))[0] ??
      'unknown';

    return next.handle().pipe(
      tap((responseBody) => {
        void this.audit.recordRequest(
          {
            action: `${request.method} ${request.route?.path ?? request.path}`,
            entityType,
            entityId: extractEntityId(request, responseBody),
            after: responseBody,
          },
          request,
        );
      }),
    );
  }
}

function extractEntityId(request: Request, body: unknown): string | null {
  const params = request.params as Record<string, string | undefined>;
  if (params['id'] && /^[0-9a-f-]{36}$/i.test(params['id'])) return params['id'];
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}
