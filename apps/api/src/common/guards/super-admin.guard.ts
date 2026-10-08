import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/** Restricts a route to PeopleCore platform operators. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new UnauthorizedError();
    if (!request.principal.isSuperAdmin) {
      throw new ForbiddenError('Platform operator access required', 'SUPER_ADMIN_REQUIRED');
    }
    return true;
  }
}
