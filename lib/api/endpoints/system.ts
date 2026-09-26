/**
 * 系统级探针。
 */
import { getApiBaseUrl } from '@/lib/api-config';
import { fetchWithTimeoutAndRetry, throwIfAborted } from '@/lib/cloud-fetch-retry';
import {
  extractEnvelope,
  isApiResponseSuccess,
  parseResponseBody,
} from '@/lib/api/http';

export async function apiHealthCheck(opts?: { signal?: AbortSignal }): Promise<boolean> {
  const baseUrl = await getApiBaseUrl();
  throwIfAborted(opts?.signal);
  const res = await fetchWithTimeoutAndRetry(`${baseUrl}/health`, { method: 'GET' }, { signal: opts?.signal });
  const { parsed } = await parseResponseBody(res);
  const envelope = extractEnvelope(parsed);
  return isApiResponseSuccess(res.status, envelope?.code ?? -1);
}

