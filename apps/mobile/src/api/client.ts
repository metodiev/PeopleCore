import type { ApiErrorBody } from '@peoplecore/shared';

const DEFAULT_BASE_URL = 'http://localhost:4000/api/v1';

/** Base URL of the PeopleCore REST API (`/api/v1`). */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

/** Error thrown for every non-2xx API response and for network failures. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the request never reached the API (offline, DNS, timeout). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 (used by the refresh call itself). */
  skipRefresh?: boolean;
  timeoutMs?: number;
}

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let unauthorizedHandler: (() => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Session callbacks are wired by the auth store to avoid a circular import. */
export function configureApi(options: {
  refresh: () => Promise<string | null>;
  onUnauthorized: () => void;
}): void {
  refreshHandler = options.refresh;
  unauthorizedHandler = options.onUnauthorized;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, String(entry)));
    else params.append(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return text as unknown as T;
  return JSON.parse(text) as T;
}

/**
 * Refreshes the access token at most once at a time no matter how many
 * requests fail with 401 in parallel (single-flight).
 */
async function refreshOnce(): Promise<string | null> {
  if (!refreshHandler) return null;
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (init.signal || timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const attempt = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    return fetchWithTimeout(
      buildUrl(path, options.query),
      {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      },
      options.timeoutMs ?? 20_000,
    );
  };

  let response: Response;
  try {
    response = await attempt(accessToken);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the PeopleCore API', { cause: String(error) });
  }

  if (response.status === 401 && !options.skipRefresh && refreshHandler) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      try {
        response = await attempt(refreshed);
      } catch (error) {
        throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the PeopleCore API', { cause: String(error) });
      }
    } else {
      unauthorizedHandler?.();
    }
  }

  if (!response.ok) {
    const payload = await parseResponse<ApiErrorBody | null>(response).catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? `HTTP_${response.status}`,
      payload?.error?.message ?? response.statusText ?? 'Request failed',
      payload?.error?.details,
    );
  }

  return parseResponse<T>(response);
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Request failed';
}
