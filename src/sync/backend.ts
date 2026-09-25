/**
 * Platform bridge. In the desktop app every Google call goes through the Rust
 * side (tokens never reach JavaScript; they live in the OS keychain).
 */
export type ApiErrorCode = 'AUTH_REQUIRED' | 'AUTH_EXPIRED' | 'OFFLINE' | 'HTTP' | 'CONFIG' | 'UNKNOWN';
export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public status?: number) { super(message); }
}

export interface CredentialsInfo { source?: string | null; client_id_end?: string | null; secret?: string | null }

export interface UpdateInfo { available: boolean; version?: string; notes?: string; install?: () => Promise<void> }

export interface Backend {
  kind: 'tauri' | 'mock';
  authStatus(): Promise<{ connected: boolean; email?: string }>;
  authConnect(): Promise<{ email?: string }>;
  authDisconnect(): Promise<void>;
  request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown): Promise<T>;
  cacheGet(key: string): Promise<string | null>;
  cachePut(key: string, value: string): Promise<void>;
  cacheClear(): Promise<void>;
  deviceName(): Promise<string>;
  appVersion(): Promise<string>;
  checkUpdate(): Promise<UpdateInfo>;
  credentialsInfo(): Promise<CredentialsInfo>;
  setClientCredentials(json: string): Promise<CredentialsInfo>;
  clearClientCredentials(): Promise<CredentialsInfo>;
}

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function toApiError(e: unknown): ApiError {
  const msg = typeof e === 'string' ? e : (e as any)?.message ?? String(e);
  const m = msg.match(/^(AUTH_REQUIRED|AUTH_EXPIRED|OFFLINE|HTTP|CONFIG)(?::(\d+))?:?\s*(.*)$/s);
  if (m) return new ApiError(m[1] as ApiErrorCode, m[3] || m[1], m[2] ? Number(m[2]) : undefined);
  return new ApiError('UNKNOWN', msg);
}

export async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try { return await invoke<T>(cmd, args); } catch (e) { throw toApiError(e); }
  };
  return {
    kind: 'tauri',
    authStatus: () => call('auth_status'),
    authConnect: () => call('auth_connect'),
    authDisconnect: () => call('auth_disconnect'),
    request: async (method, url, body) => {
      const text = await call<string>('google_request', { method, url, body: body === undefined ? null : JSON.stringify(body) });
      return text ? JSON.parse(text) : {};
    },
    cacheGet: key => call('cache_get', { key }),
    cachePut: (key, value) => call('cache_put', { key, value }),
    cacheClear: () => call('cache_clear'),
    deviceName: () => call('device_name'),
    credentialsInfo: () => call('credentials_info'),
    setClientCredentials: json => call('set_client_credentials', { json }),
    clearClientCredentials: () => call('clear_client_credentials'),
    appVersion: async () => (await import('@tauri-apps/api/app')).getVersion(),
    checkUpdate: async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const upd = await check();
        if (!upd) return { available: false };
        return {
          available: true, version: upd.version, notes: upd.body ?? undefined,
          install: async () => {
            await upd.downloadAndInstall();
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        };
      } catch {
        return { available: false };
      }
    },
  };
}

let backendPromise: Promise<Backend> | null = null;
export function getBackend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = isTauri()
      ? tauriBackend()
      : import.meta.env.DEV
        ? import('../dev/mockBackend').then(m => m.mockBackend())
        : Promise.reject(new ApiError('CONFIG', 'Open the Health Tracker desktop app — this page only works inside it.'));
  }
  return backendPromise;
}
