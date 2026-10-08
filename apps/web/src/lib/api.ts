import type { ApiErrorBody, Paginated } from '@peoplecore/shared';

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
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  formData?: FormData;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 (used by the refresh call itself). */
  skipRefresh?: boolean;
}

const API_BASE = '/api/v1';

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let unauthorizedHandler: (() => void) | null = null;

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
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
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

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const attempt = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (options.body !== undefined && !options.formData) headers['content-type'] = 'application/json';

    return fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      credentials: 'include',
      signal: options.signal,
    });
  };

  let response = await attempt(accessToken);

  if (response.status === 401 && !options.skipRefresh && refreshHandler) {
    const refreshed = await refreshHandler();
    if (refreshed) {
      response = await attempt(refreshed);
    } else {
      unauthorizedHandler?.();
    }
  }

  if (!response.ok) {
    const payload = (await parseResponse<ApiErrorBody | null>(response)) as ApiErrorBody | null;
    if (response.status === 401) unauthorizedHandler?.();
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
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', formData }),
};

export type { Paginated };
