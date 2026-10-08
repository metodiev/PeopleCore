import { type CanActivate, type CustomDecorator, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@peoplecore/shared';
import { ForbiddenError, UnauthorizedError } from '../../common/errors/app-error.js';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard.js';

export const ANY_PERMISSIONS_KEY = 'anyRequiredPermissions';

/**
 * Any-of variant of `@RequirePermissions`.
 *
 * Expense endpoints are shared by employees (`expenses.self.view`) and finance
 * (`expenses.view` / `expenses.manage`) — the stock all-of guard would lock one
 * of the two out. Row-level scope still narrows the result set.
 */
export const RequireAnyPermission = (...permissions: PermissionKey[]): CustomDecorator =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);

@Injectable()
export class AnyPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required =
      this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;

    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) throw new UnauthorizedError();
    if (principal.isSuperAdmin) return true;
    if (!required.some((permission) => principal.permissions.includes(permission))) {
      throw new ForbiddenError(`Missing permission(s): ${required.join(' or ')}`, 'PERMISSION_DENIED');
    }
    return true;
  }
}
