import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request (or per-job) security context propagated through async calls.
 * The tenant scope extension reads `tenantId` from here to guarantee that no
 * query can cross tenant boundaries.
 */
export interface RequestContext {
  requestId: string;
  tenantId: string | null;
  userId: string | null;
  employeeId: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function requireContext(): RequestContext {
  const ctx = requestContextStorage.getStore();
  if (!ctx) {
    throw new Error('No request context available — did you forget to run inside requestContextStorage.run()?');
  }
  return ctx;
}

/**
 * Runs `fn` with a tenant context. Used by background jobs, the seeder and
 * integration sync workers, which operate outside an HTTP request.
 */
export function runWithTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T> | T,
  extra: Partial<RequestContext> = {},
): Promise<T> {
  const context: RequestContext = {
    requestId: extra.requestId ?? crypto.randomUUID(),
    tenantId,
    userId: extra.userId ?? null,
    employeeId: extra.employeeId ?? null,
    isSuperAdmin: extra.isSuperAdmin ?? false,
    permissions: extra.permissions ?? [],
  };
  return requestContextStorage.run(context, async () => fn());
}
