import type { AuthTokens, LoginResult } from '@peoplecore/shared';
import { create } from 'zustand';
import { configureApi, setAccessToken } from '@/api/client';
import { authApi } from '@/api/endpoints';
import type { MeResponse, SessionUser, TenantSummary } from '@/api/types';
import { readSecure, StorageKeys, writeSecure } from '@/lib/storage';
import { authenticateBiometric, getBiometricCapability } from '@/lib/biometric';

export type AuthStatus = 'loading' | 'mfa' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  tenant: TenantSummary | null;
  employeeId: string | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  mfaToken: string | null;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  sessionError: string | null;

  hydrate: () => Promise<void>;
  login: (email: string, password: string, tenantSlug?: string) => Promise<'authenticated' | 'mfa'>;
  completeMfa: (code: string) => Promise<void>;
  cancelMfa: () => void;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  can: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
}

export const useAuth = create<AuthState>((set, get) => {
  async function persistTokens(tokens: AuthTokens | null): Promise<void> {
    setAccessToken(tokens?.accessToken ?? null);
    set({ accessToken: tokens?.accessToken ?? null, refreshToken: tokens?.refreshToken ?? null });
    await Promise.all([
      writeSecure(StorageKeys.accessToken, tokens?.accessToken ?? null),
      writeSecure(StorageKeys.refreshToken, tokens?.refreshToken ?? null),
    ]);
  }

  async function applyLoginResult(result: LoginResult): Promise<void> {
    if (result.tokens) await persistTokens(result.tokens);
    await get().loadSession();
  }

  return {
    status: 'loading',
    user: null,
    tenant: null,
    employeeId: null,
    roles: [],
    permissions: [],
    isSuperAdmin: false,
    accessToken: null,
    refreshToken: null,
    mfaToken: null,
    biometricEnabled: false,
    biometricAvailable: false,
    sessionError: null,

    async hydrate() {
      const [accessToken, refreshToken, biometricEnabled, capability] = await Promise.all([
        readSecure(StorageKeys.accessToken),
        readSecure(StorageKeys.refreshToken),
        readSecure(StorageKeys.biometricEnabled),
        getBiometricCapability(),
      ]);
      set({
        accessToken,
        refreshToken,
        biometricEnabled: biometricEnabled === 'true',
        biometricAvailable: capability.available,
      });
      if (accessToken) setAccessToken(accessToken);
      await get().loadSession();
    },

    async login(email, password, tenantSlug) {
      const result = await authApi.login(email, password, tenantSlug);
      if (result.mfaRequired && result.mfaToken) {
        set({ status: 'mfa', mfaToken: result.mfaToken, sessionError: null });
        return 'mfa';
      }
      await applyLoginResult(result);
      return 'authenticated';
    },

    async completeMfa(code) {
      const mfaToken = get().mfaToken;
      if (!mfaToken) {
        set({ status: 'anonymous', sessionError: 'MFA challenge expired. Please sign in again.' });
        return;
      }
      const result = await authApi.verifyMfa(mfaToken, code);
      set({ mfaToken: null });
      await applyLoginResult(result);
    },

    cancelMfa() {
      set({ status: 'anonymous', mfaToken: null });
    },

    async logout() {
      try {
        await authApi.logout();
      } catch {
        // The session may already be gone on the server.
      }
      await persistTokens(null);
      set({
        status: 'anonymous',
        user: null,
        tenant: null,
        employeeId: null,
        roles: [],
        permissions: [],
        isSuperAdmin: false,
        mfaToken: null,
        sessionError: null,
      });
    },

    async loadSession() {
      const { accessToken, refreshToken } = get();
      if (!accessToken && !refreshToken) {
        set({ status: 'anonymous' });
        return;
      }
      if (accessToken) setAccessToken(accessToken);
      try {
        const me: MeResponse = await authApi.me();
        set({
          status: 'authenticated',
          user: me.user,
          tenant: me.tenant,
          employeeId: me.employeeId,
          roles: me.roles,
          permissions: me.permissions,
          isSuperAdmin: me.isSuperAdmin,
          sessionError: null,
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401) {
          const refreshed = await get().refreshSession();
          if (refreshed) {
            await get().loadSession();
            return;
          }
          set({ status: 'anonymous', sessionError: 'Your session expired. Please sign in again.' });
          return;
        }
        set({ status: 'anonymous' });
      }
    },

    async refreshSession() {
      const refreshToken = get().refreshToken ?? (await readSecure(StorageKeys.refreshToken));
      if (!refreshToken) return null;
      try {
        const tokens = await authApi.refresh(refreshToken);
        await persistTokens(tokens);
        return tokens.accessToken;
      } catch {
        await persistTokens(null);
        set({ status: 'anonymous', user: null, sessionError: 'Your session expired. Please sign in again.' });
        return null;
      }
    },

    can(permission) {
      const { isSuperAdmin, permissions } = get();
      return isSuperAdmin || permissions.includes(permission);
    },

    hasRole(role) {
      return get().roles.includes(role);
    },

    async setBiometricEnabled(enabled) {
      set({ biometricEnabled: enabled });
      await writeSecure(StorageKeys.biometricEnabled, enabled ? 'true' : 'false');
    },

    async unlockWithBiometrics() {
      const { biometricEnabled } = get();
      if (!biometricEnabled) return false;
      const result = await authenticateBiometric();
      if (!result) return false;
      const refreshToken = get().refreshToken ?? (await readSecure(StorageKeys.refreshToken));
      if (!refreshToken) return false;
      set({ refreshToken });
      const accessToken = await get().refreshSession();
      if (!accessToken) return false;
      await get().loadSession();
      return get().status === 'authenticated';
    },
  };
});

// Wire the HTTP layer to the session without a circular import.
configureApi({
  refresh: () => useAuth.getState().refreshSession(),
  onUnauthorized: () => {
    const state = useAuth.getState();
    if (state.status === 'authenticated' || state.status === 'loading') {
      void state.logout();
    }
  },
});

/** Convenience hook for permission checks in components. */
export function usePermission(permission: string): boolean {
  return useAuth((state) => state.isSuperAdmin || state.permissions.includes(permission));
}
