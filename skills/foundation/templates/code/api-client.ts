/**
 * api-client.ts — the app's single HTTP client for its own backend.
 *
 * Deps:  npx expo install expo-crypto   (zod or any `{ parse }` schema for responses)
 *
 * Behavior:
 * - Base URL from EXPO_PUBLIC_API_URL (validated, https in release) via env.ts.
 * - `Authorization: Bearer <token>` injected from the session; tokens never go in URLs.
 * - Timeout per request (default 15s) merged with the caller's AbortSignal (TanStack `signal`).
 * - 401 → one shared (single-flight) refresh → retry once → still 401 / refresh failed →
 *   `onUnauthorized` (sign-out) and an ApiError(401).
 * - `idempotencyKey` sends `Idempotency-Key` so retried writes are not applied twice.
 * - Every failure is an `ApiError { status, code }`; status 0 = network/timeout.
 * - __DEV__ logs method, path, status and duration only (no headers, bodies or query strings).
 *
 * Adapt:
 * - Token source: supabase-client.ts helpers here; swap for your auth provider.
 * - Register sign-out once at startup: `api.setOnUnauthorized(() => signOut({ reason: 'expired' }))`.
 * - Expected server error body: `{ error: { code, message } }`; adjust `toApiError` otherwise.
 */
import { randomUUID } from 'expo-crypto';
import { env } from './env';
import { getAccessToken, refreshAccessToken } from './supabase-client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined>;
interface Schema<T> { parse(input: unknown): T }

export interface RequestOptions<T> {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  idempotencyKey?: string;
  schema?: Schema<T>;
  auth?: boolean; // default true
}

export const newIdempotencyKey = () => randomUUID();

const TOKEN_PARAM = /^(access_?token|refresh_?token|token|jwt|session|password)$/i;

export function createApiClient(baseUrl: string, defaultTimeoutMs = 15_000) {
  let refreshing: Promise<string | null> | null = null;
  let onUnauthorized: () => void | Promise<void> = () => {};

  const refreshOnce = () => {
    refreshing ??= refreshAccessToken().catch(() => null).finally(() => { refreshing = null; });
    return refreshing;
  };

  function buildUrl(path: string, query?: Query): string {
    const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (__DEV__ && TOKEN_PARAM.test(k)) throw new Error(`[api] "${k}" must not be sent in the URL; use headers/body.`);
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async function send(method: string, path: string, opts: RequestOptions<unknown>, token: string | null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? defaultTimeoutMs);
    const forwardAbort = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    opts.signal?.addEventListener('abort', forwardAbort);
    const started = Date.now();
    try {
      const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      const res = await fetch(buildUrl(path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      if (__DEV__) console.log(`[api] ${method} ${path} → ${res.status} (${Date.now() - started}ms)`);
      return res;
    } catch (err) {
      if (opts.signal?.aborted) throw err; // caller cancelled: let TanStack Query handle it
      const timedOut = controller.signal.aborted;
      throw new ApiError(0, timedOut ? 'timeout' : 'network_error', timedOut ? 'Request timed out' : 'Network error');
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  async function toApiError(res: Response): Promise<ApiError> {
    const requestId = res.headers.get('x-request-id') ?? undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      return new ApiError(res.status, body.error?.code ?? `http_${res.status}`, body.error?.message ?? res.statusText, requestId);
    } catch {
      return new ApiError(res.status, `http_${res.status}`, res.statusText || 'Request failed', requestId);
    }
  }

  async function request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let res = await send(method, path, opts, auth ? await getAccessToken() : null);
    if (res.status === 401 && auth) {
      const fresh = await refreshOnce();
      if (fresh) res = await send(method, path, opts, fresh);
      if (!fresh || res.status === 401) {
        await onUnauthorized();
        throw new ApiError(401, 'unauthorized', 'Session expired');
      }
    }
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json();
    return opts.schema ? opts.schema.parse(data) : (data as T);
  }

  return {
    request,
    get: <T>(path: string, opts?: Omit<RequestOptions<T>, 'body'>) => request<T>('GET', path, opts),
    post: <T>(path: string, opts?: RequestOptions<T>) => request<T>('POST', path, opts),
    put: <T>(path: string, opts?: RequestOptions<T>) => request<T>('PUT', path, opts),
    patch: <T>(path: string, opts?: RequestOptions<T>) => request<T>('PATCH', path, opts),
    delete: <T>(path: string, opts?: RequestOptions<T>) => request<T>('DELETE', path, opts),
    setOnUnauthorized(fn: () => void | Promise<void>) { onUnauthorized = fn; },
  };
}

if (!env.EXPO_PUBLIC_API_URL) throw new Error('[api] EXPO_PUBLIC_API_URL is not set');
export const api = createApiClient(env.EXPO_PUBLIC_API_URL);
