import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { type Observable } from 'rxjs';
import { requestContextStorage, type RequestContext } from '../../prisma/request-context.js';

/** Request-scoped fields the guard layer fills in after authentication. */
export interface RequestWithContext extends Request {
  context?: RequestContext;
  principal?: import('@peoplecore/shared').Principal;
}

/**
 * Establishes the per-request async-local context (request id + tenant) and
 * echoes the request id back to the caller.
 *
 * Guards run before interceptors, so the authenticated principal is already
 * attached to the request — it seeds the context that every repository uses to
 * enforce tenant isolation.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const incomingId = request.header('x-request-id');
    const principal = request.principal;
    const store: RequestContext = {
      requestId: incomingId && incomingId.length <= 128 ? incomingId : randomUUID(),
      tenantId: principal?.tenantId ?? null,
      userId: principal?.userId ?? null,
      employeeId: principal?.employeeId ?? null,
      isSuperAdmin: principal?.isSuperAdmin ?? false,
      permissions: principal?.permissions ?? [],
    };
    request.context = store;
    response.setHeader('x-request-id', store.requestId);

    return requestContextStorage.run(store, () => next.handle());
  }
}
