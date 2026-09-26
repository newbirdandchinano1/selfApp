/**
 * 通用表级 CRUD / List / Get / tables meta。
 */
import { apiRequest, prepareRowBodyForApi, ApiRequestError } from '@/lib/api/http';
import { buildListQuery, type ApiListQueryOpts, type ApiListResponse } from '@/lib/api/query';

function buildApiUploadBodies(table: string, row: Record<string, unknown>): Record<string, unknown>[] {
  return [
    prepareRowBodyForApi(table, row),
    prepareRowBodyForApi(table, row, { aggressive: true, maxBytes: 24_000 }),
    prepareRowBodyForApi(table, row, { aggressive: true, ultra: true, maxBytes: 8_000 }),
  ];
}

function isEntityTooLargeError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.httpStatus === 413 || /entity too large/i.test(err.message))
  );
}

export async function apiCreateRecord<T = unknown>(
  table: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const {
    AppDomainFallbackError,
    appDomainCreateRecord,
    isAppDomainCrudTable,
  } = await import('@/lib/api-app-domain');
  const { isApiGenericWriteForbidden } = await import('@/lib/api-allowed-tables');

  if (isAppDomainCrudTable(table)) {
    try {
      const body = { ...row };
      delete body.sync_status;
      return await appDomainCreateRecord<T>(table, body, {
        signal: opts?.signal,
      });
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
      if (isApiGenericWriteForbidden(table)) {
        throw new Error(
          `表「${table}」禁止通过通用 CRUD 写入（专用接口未覆盖此操作）`,
        );
      }
    }
  } else if (isApiGenericWriteForbidden(table)) {
    throw new Error(
      `表「${table}」禁止通过通用 CRUD 写入，请使用专用业务接口（如 /api/app/points/*）`,
    );
  }

  const bodies = buildApiUploadBodies(table, row);
  let lastError: unknown;
  for (let i = 0; i < bodies.length; i++) {
    try {
      return await apiRequest<T>(`/api/app/data/${encodeURIComponent(table)}`, {
        method: 'POST',
        body: bodies[i],
        signal: opts?.signal,
      });
    } catch (e) {
      lastError = e;
      if (i < bodies.length - 1 && isEntityTooLargeError(e)) continue;
      throw e;
    }
  }
  throw lastError;
}

export async function apiUpdateRecord<T = unknown>(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const {
    AppDomainFallbackError,
    appDomainUpdateRecord,
    isAppDomainCrudTable,
  } = await import('@/lib/api-app-domain');
  const { isApiGenericWriteForbidden } = await import('@/lib/api-allowed-tables');

  if (isAppDomainCrudTable(table)) {
    try {
      const body = { ...row };
      delete body.sync_status;
      return await appDomainUpdateRecord<T>(table, id, body, {
        signal: opts?.signal,
        method: 'PUT',
      });
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
      if (isApiGenericWriteForbidden(table)) {
        throw new Error(
          `表「${table}」禁止通过通用 CRUD 写入（专用接口未覆盖此操作）`,
        );
      }
    }
  } else if (isApiGenericWriteForbidden(table)) {
    throw new Error(`表「${table}」禁止通过通用 CRUD 写入，请使用专用业务接口`);
  }

  const bodies = buildApiUploadBodies(table, row);
  let lastError: unknown;
  for (let i = 0; i < bodies.length; i++) {
    try {
      return await apiRequest<T>(
        `/api/app/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          body: bodies[i],
          signal: opts?.signal,
        },
      );
    } catch (e) {
      lastError = e;
      if (i < bodies.length - 1 && isEntityTooLargeError(e)) continue;
      throw e;
    }
  }
  throw lastError;
}

export async function apiPatchRecord<T = unknown>(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const {
    AppDomainFallbackError,
    appDomainUpdateRecord,
    isAppDomainCrudTable,
  } = await import('@/lib/api-app-domain');
  const { isApiGenericWriteForbidden } = await import('@/lib/api-allowed-tables');

  if (isAppDomainCrudTable(table)) {
    try {
      const body = { ...row };
      delete body.sync_status;
      return await appDomainUpdateRecord<T>(table, id, body, {
        signal: opts?.signal,
        method: 'PATCH',
      });
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
      if (isApiGenericWriteForbidden(table)) {
        throw new Error(
          `表「${table}」禁止通过通用 CRUD 写入（专用接口未覆盖此操作）`,
        );
      }
    }
  } else if (isApiGenericWriteForbidden(table)) {
    throw new Error(`表「${table}」禁止通过通用 CRUD 写入，请使用专用业务接口`);
  }

  return apiRequest<T>(`/api/app/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: prepareRowBodyForApi(table, row),
    signal: opts?.signal,
  });
}

export async function apiDeleteRecord(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const {
    AppDomainFallbackError,
    appDomainDeleteRecord,
    isAppDomainCrudTable,
  } = await import('@/lib/api-app-domain');
  const { isApiGenericWriteForbidden } = await import('@/lib/api-allowed-tables');

  if (isAppDomainCrudTable(table)) {
    try {
      await appDomainDeleteRecord(table, id, { signal: opts?.signal });
      return;
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
      if (isApiGenericWriteForbidden(table)) {
        throw new Error(
          `表「${table}」禁止通过通用 CRUD 写入（专用接口未覆盖此操作）`,
        );
      }
    }
  } else if (isApiGenericWriteForbidden(table)) {
    throw new Error(`表「${table}」禁止通过通用 CRUD 写入，请使用专用业务接口`);
  }

  await apiRequest<null>(`/api/app/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiListRecords<T extends Record<string, unknown>>(
  table: string,
  opts?: ApiListQueryOpts & { signal?: AbortSignal },
): Promise<ApiListResponse<T>> {
  const { appDomainListRecords, isAppDomainCrudTable } = await import('@/lib/api-app-domain');
  if (isAppDomainCrudTable(table)) {
    const domain = await appDomainListRecords<T>(table, opts);
    if (domain) return domain;
  }

  const data = await apiRequest<ApiListResponse<T>>(
    `/api/app/data/${encodeURIComponent(table)}${buildListQuery(opts)}`,
    { method: 'GET', signal: opts?.signal },
  );
  return {
    list: Array.isArray(data?.list) ? data.list : [],
    pagination: data?.pagination ?? {
      page: opts?.page ?? 1,
      limit: opts?.limit ?? 50,
      total: 0,
      totalPages: 0,
    },
  };
}

export async function apiGetRecord<T extends Record<string, unknown>>(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const {
    AppDomainFallbackError,
    appDomainGetRecord,
    isAppDomainCrudTable,
  } = await import('@/lib/api-app-domain');

  if (isAppDomainCrudTable(table)) {
    try {
      return await appDomainGetRecord<T>(table, id, { signal: opts?.signal });
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
    }
  }

  return apiRequest<T>(`/api/app/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'GET',
    signal: opts?.signal,
  });
}

export type ApiTableMetaRow = {
  name?: string;
  table?: string;
  primaryKey?: string;
  primary_key?: string;
  hasDeletedAt?: boolean;
  has_deleted_at?: boolean;
  columns?: string[];
};

export async function apiGetTablesMeta(signal?: AbortSignal): Promise<ApiTableMetaRow[]> {
  const data = await apiRequest<ApiTableMetaRow[] | { tables?: ApiTableMetaRow[] }>('/api/app/tables', {
    method: 'GET',
    signal,
  });
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { tables?: ApiTableMetaRow[] }).tables)) {
    return (data as { tables: ApiTableMetaRow[] }).tables;
  }
  return [];
}
