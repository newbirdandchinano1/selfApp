import { getCloudAuthToken, getCloudSqlApiUrl } from '@/lib/cloud-backup-config';
import { fetchWithTimeoutAndRetry, isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';

export type CloudSqlExecuteResult<T = unknown> =
  | { ok: true; data: T[]; raw: unknown }
  | { ok: false; message: string; diagnosticText: string; aborted?: boolean };

function serializeUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const lines = [`${err.name}: ${err.message}`];
    if (typeof err.stack === 'string' && err.stack.trim()) lines.push(err.stack);
    return lines.join('\n');
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

function extractRowsFromResponseBody(body: unknown): unknown[] {
  if (body == null) return [];
  if (Array.isArray(body)) return body;
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.rows)) return o.rows;
  }
  return [];
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const err = o.error ?? o.message ?? o.msg;
    if (typeof err === 'string' && err.trim()) return err.trim();
  }
  return `云端 SQL 执行失败：HTTP ${status}`;
}

export async function executeCloudSql<T = unknown>(
  sql: string,
  params?: unknown[],
  opts?: { signal?: AbortSignal },
): Promise<CloudSqlExecuteResult<T>> {
  throwIfAborted(opts?.signal);

  const apiUrl = await getCloudSqlApiUrl();
  const token = await getCloudAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = JSON.stringify({
    sql,
    ...(params != null && params.length > 0 ? { params } : {}),
  });

  let res: Response;
  try {
    res = await fetchWithTimeoutAndRetry(
      apiUrl,
      { method: 'POST', headers, body },
      { signal: opts?.signal },
    );
  } catch (e) {
    if (isAbortError(e) || opts?.signal?.aborted) {
      const message = '云端 SQL 请求已中止';
      return { ok: false, message, diagnosticText: serializeUnknownError(e), aborted: true };
    }
    const message = '云端 SQL 请求失败（网络层）';
    return { ok: false, message, diagnosticText: serializeUnknownError(e) };
  }

  let parsed: unknown = null;
  const text = await res.text().catch(() => '');
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { raw: text };
    }
  }

  if (res.status >= 200 && res.status < 300) {
    const data = extractRowsFromResponseBody(parsed) as T[];
    const successFlag =
      parsed && typeof parsed === 'object' && 'success' in (parsed as object)
        ? (parsed as { success?: boolean }).success
        : undefined;
    if (successFlag === false) {
      const message = extractErrorMessage(parsed, res.status);
      return {
        ok: false,
        message,
        diagnosticText: [message, '', '----- 响应 -----', text || '(空)'].join('\n'),
      };
    }
    return { ok: true, data, raw: parsed };
  }

  const message = extractErrorMessage(parsed, res.status);
  return {
    ok: false,
    message,
    diagnosticText: [`POST ${apiUrl}`, `HTTP ${res.status}`, '', text || '(空)'].join('\n'),
  };
}
