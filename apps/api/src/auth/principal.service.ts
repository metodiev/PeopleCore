import { Injectable } from '@nestjs/common';
import { ALL_PERMISSION_KEYS, type Principal } from '@peoplecore/shared';
import { PrismaService } from '../prisma/prisma.service.js';

interface CacheEntry {
  expiresAt: number;
  principal: Principal | null;
}

const CACHE_TTL_MS = 15_000;
const CACHE_MAX_ENTRIES = 10_000;

/**
 * Builds the authenticated principal (identity + effective permissions) for a
 * user/session pair. Results are cached briefly so hot paths do not hit the
 * database on every request while session revocation still takes effect
 * within seconds. Call `invalidate*` when roles or session state change.
 */
@Injectable()
export class PrincipalService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string, sessionId: string): Promise<Principal | null> {
    const key = `${userId}:${sessionId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.principal;
    }

    const principal = await this.load(userId, sessionId);
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.evictExpired();
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, principal });
    return principal;
  }

  invalidateUser(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
  }

  private async load(userId: string, sessionId: string): Promise<Principal | null> {
    const [session, user] = await Promise.all([
      this.prisma.raw.session.findUnique({ where: { id: sessionId } }),
      this.prisma.raw.user.findUnique({
        where: { id: userId },
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          employee: { select: { id: true } },
        },
      }),
    ]);

    if (!session || session.userId !== userId) return null;
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    if (!user || user.deletedAt) return null;
    if (user.status === 'DISABLED' || user.status === 'SUSPENDED') return null;

    const roles = user.roles.map((userRole) => userRole.role.key);
    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.key);
      }
    }
    if (user.isSuperAdmin) {
      for (const permission of ALL_PERMISSION_KEYS) permissions.add(permission);
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      employeeId: user.employee?.id ?? null,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions: [...permissions],
      isSuperAdmin: user.isSuperAdmin,
      sessionId,
    };
  }
}
