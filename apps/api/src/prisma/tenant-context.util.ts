import { ForbiddenError } from '../common/errors/app-error.js';
import { currentContext } from './request-context.js';

/** The tenant id of the current request/job. Throws when called outside one. */
export function currentTenantId(): string {
  const tenantId = currentContext()?.tenantId;
  if (!tenantId) {
    throw new ForbiddenError('No tenant context for this operation', 'TENANT_CONTEXT_MISSING');
  }
  return tenantId;
}

/**
 * Adds the current tenant id to a Prisma `create` payload.
 *
 * The tenant scope extension already injects `tenantId` at runtime; passing it
 * explicitly keeps payloads type-safe (Prisma's checked input requires the
 * relation object, the unchecked one requires the scalar) and makes nested
 * writes — which the extension cannot reach — carry the tenant as well.
 */
export function tenantScoped<T extends object>(data: T): T & { tenantId: string } {
  return { ...data, tenantId: currentTenantId() };
}
