import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../common/errors/app-error.js';
import {
  currentContext,
  requestContextStorage,
  requireContext,
  runWithTenantContext,
} from './request-context.js';
import { currentTenantId, tenantScoped } from './tenant-context.util.js';

describe('request context', () => {
  it('has no context outside a run scope', () => {
    expect(currentContext()).toBeUndefined();
    expect(() => requireContext()).toThrow(/No request context available/);
    expect(() => currentTenantId()).toThrow(ForbiddenError);
    try {
      currentTenantId();
    } catch (error) {
      expect((error as ForbiddenError).code).toBe('TENANT_CONTEXT_MISSING');
    }
  });

  it('propagates context to nested async calls', async () => {
    const seen = await runWithTenantContext('tenant-a', async () => {
      const nested = await Promise.resolve().then(() => currentTenantId());
      return nested;
    });
    expect(seen).toBe('tenant-a');
    // The context must not leak out of the run scope.
    expect(currentContext()).toBeUndefined();
  });

  it('applies sensible defaults and honours overrides', async () => {
    const defaults = await runWithTenantContext('tenant-a', () => requireContext());
    expect(defaults.tenantId).toBe('tenant-a');
    expect(defaults.userId).toBeNull();
    expect(defaults.employeeId).toBeNull();
    expect(defaults.isSuperAdmin).toBe(false);
    expect(defaults.permissions).toEqual([]);
    expect(defaults.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const overridden = await runWithTenantContext(
      'tenant-b',
      () => requireContext(),
      { userId: 'user-1', employeeId: 'employee-9', isSuperAdmin: true, permissions: ['employees.view'] },
    );
    expect(overridden).toMatchObject({
      tenantId: 'tenant-b',
      userId: 'user-1',
      employeeId: 'employee-9',
      isSuperAdmin: true,
      permissions: ['employees.view'],
    });
  });

  it('keeps concurrent contexts isolated', async () => {
    const resolve = async (tenantId: string) =>
      runWithTenantContext(tenantId, async () => {
        await new Promise((resolve) => setTimeout(resolve, tenantId === 'tenant-slow' ? 20 : 1));
        return currentTenantId();
      });
    expect(await Promise.all([resolve('tenant-slow'), resolve('tenant-fast')])).toEqual([
      'tenant-slow',
      'tenant-fast',
    ]);
  });
});

describe('tenant-scoped payloads', () => {
  it('injects the current tenant into a create payload', async () => {
    const payload = await runWithTenantContext('tenant-a', () =>
      tenantScoped({ firstName: 'Ada', lastName: 'Lovelace' }),
    );
    expect(payload).toEqual({ firstName: 'Ada', lastName: 'Lovelace', tenantId: 'tenant-a' });
  });

  it('does not mutate the input object', async () => {
    const input = { firstName: 'Ada' };
    await runWithTenantContext('tenant-a', () => tenantScoped(input));
    expect(input).toEqual({ firstName: 'Ada' });
  });

  it('fails closed without a tenant context', () => {
    expect(() => tenantScoped({ firstName: 'Ada' })).toThrow(ForbiddenError);
  });

  it('fails closed when the context carries no tenant id', () => {
    expect(() =>
      requestContextStorage.run(
        {
          requestId: 'req-1',
          tenantId: null,
          userId: 'user-1',
          employeeId: null,
          isSuperAdmin: true,
          permissions: [],
        },
        () => currentTenantId(),
      ),
    ).toThrow(/No tenant context/);
  });
});
