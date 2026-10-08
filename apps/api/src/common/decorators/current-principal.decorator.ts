import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from '@peoplecore/shared';

/** Injects the authenticated principal into a controller handler. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const request = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  if (!request.principal) {
    throw new Error('CurrentPrincipal used on an unauthenticated route');
  }
  return request.principal;
});
