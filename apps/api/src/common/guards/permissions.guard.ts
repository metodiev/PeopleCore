import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/**
 * Enforces `@RequirePermissions(...)` metadata against the principal's
 * effective permissions (least privilege by default).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (!principal) throw new UnauthorizedError();

    if (principal.isSuperAdmin) return true;

    const missing = required.filter((permission) => !principal.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing permission(s): ${missing.join(', ')}`, 'PERMISSION_DENIED');
    }
    return true;
  }
}
