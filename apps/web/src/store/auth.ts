import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens, LoginResult, Principal, TenantSummary } from '@peoplecore/shared';
import { api, ApiError, configureApi, setAccessToken } from '../lib/api.js';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  locale: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  status: string;
}

interface MeResponse {
  user: SessionUser;
  tenant: (TenantSummary & { locale: string; timezone: string; currency: string }) | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  employeeId: string | null;
}

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: SessionUser | null;
  tenant: MeResponse['tenant'];
  employeeId: string | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string, tenantSlug?: string) => Promise<LoginResult>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  acceptOAuthToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  can: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

function applyResult(result: LoginResult, set: (partial: Partial<AuthState>) => void): void {
  if (!result.tokens) return;
  setAccessToken(result.tokens.accessToken);
  set({
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
  });
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'loading',
      user: null,
      tenant: null,
      employeeId: null,
      roles: [],
      permissions: [],
      isSuperAdmin: false,
      accessToken: null,
      refreshToken: null,

      async login(email, password, tenantSlug) {
        const result = await api.post<LoginResult>('/auth/login', { email, password, tenantSlug });
        if (result.mfaRequired) return result;
        applyResult(result, set);
        await get().loadSession();
        return result;
      },

      async completeMfa(mfaToken, code) {
        const result = await api.post<LoginResult>('/auth/mfa/verify', { mfaToken, code });
        applyResult(result, set);
        await get().loadSession();
      },

      async acceptOAuthToken(token) {
        const result = await api.post<LoginResult>('/auth/oauth/exchange', { token });
        applyResult(result, set);
        await get().loadSession();
      },

      async logout() {
        try {
          await api.post('/auth/logout');
        } catch {
          /* the session may already be gone */
        }
        setAccessToken(null);
        set({
          status: 'anonymous',
          user: null,
          tenant: null,
          employeeId: null,
          roles: [],
          permissions: [],
          isSuperAdmin: false,
          accessToken: null,
          refreshToken: null,
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
          const me = await api.get<MeResponse>('/auth/me');
          set({
            status: 'authenticated',
            user: me.user,
            tenant: me.tenant,
            employeeId: me.employeeId,
            roles: me.roles,
            permissions: me.permissions,
            isSuperAdmin: me.isSuperAdmin,
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            const refreshed = await get().refreshSession();
            if (!refreshed) set({ status: 'anonymous', user: null, tokens: undefined } as Partial<AuthState>);
          } else {
            set({ status: 'anonymous' });
          }
        }
      },

      async refreshSession() {
        const { refreshToken } = get();
        if (!refreshToken) return null;
        try {
          const tokens = await api.post<AuthTokens>(
            '/auth/refresh',
            { refreshToken },
            { skipRefresh: true },
          );
          applyResult({ mfaRequired: false, tokens }, set);
          return tokens.accessToken;
        } catch {
          setAccessToken(null);
          set({ accessToken: null, refreshToken: null, status: 'anonymous', user: null });
          return null;
        }
      },

      can(permission) {
        const state = get();
        return state.isSuperAdmin || state.permissions.includes(permission);
      },

      hasRole(role) {
        return get().roles.includes(role);
      },
    }),
    {
      name: 'peoplecore.session',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

// Wire the HTTP layer to the session without a circular import.
configureApi({
  refresh: () => useAuth.getState().refreshSession(),
  onUnauthorized: () => {
    void useAuth.getState().logout();
  },
});

/** Convenience hook for permission checks in components. */
export function usePermission(permission: string): boolean {
  return useAuth((state) => state.isSuperAdmin || state.permissions.includes(permission));
}

/** Scope for principal-level checks (avoids re-rendering on unrelated changes). */
export const selectPrincipal = (state: AuthState): Principal | null =>
  state.user
    ? {
        userId: state.user.id,
        tenantId: state.tenant?.id ?? null,
        employeeId: state.employeeId,
        email: state.user.email,
        firstName: state.user.firstName,
        lastName: state.user.lastName,
        roles: state.roles,
        permissions: state.permissions,
        isSuperAdmin: state.isSuperAdmin,
        sessionId: '',
      }
    : null;
