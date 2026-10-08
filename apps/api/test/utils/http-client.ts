import { request as httpRequest } from 'node:http';

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | undefined>;
}

export interface HttpClient {
  get<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  token?: string;
}

export interface RequestOptions {
  token?: string | undefined;
  headers?: Record<string, string>;
}

/**
 * HTTP client that talks to the API over a Unix domain socket. The test
 * environment cannot bind TCP ports, and this mirrors how the API is often
 * deployed behind a reverse proxy anyway.
 */
export function createHttpClient(socketPath: string): HttpClient {
  async function send<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<HttpResponse<T>>((resolve, reject) => {
      const request = httpRequest(
        {
          socketPath,
          path,
          method,
          headers: {
            'content-type': 'application/json',
            ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
            ...options.headers,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = raw;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              /* keep raw text */
            }
            resolve({ status: response.statusCode ?? 0, body: parsed as T, headers: response.headers });
          });
        },
      );
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  const client: HttpClient = {
    get: (path, options) => send('GET', path, undefined, options),
    post: (path, body, options) => send('POST', path, body, options),
    patch: (path, body, options) => send('PATCH', path, body, options),
    put: (path, body, options) => send('PUT', path, body, options),
    delete: (path, options) => send('DELETE', path, undefined, options),
  };
  return client;
}
