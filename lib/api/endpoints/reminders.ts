/**
 * 服务端提醒 API：push token / jobs / inbox。
 */
import { APP_API_PREFIX, apiRequest } from '@/lib/api/http';

export type ReminderJobUpsertItem = {
  dedupeKey: string;
  category: string;
  fireAt: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  strong?: boolean;
};

export type PutReminderJobsBody = {
  upsert?: ReminderJobUpsertItem[];
  cancelDedupeKeys?: string[];
  cancelPrefixes?: string[];
  replaceCategories?: string[];
};

export type PutReminderJobsResult = {
  upserted: number;
  cancelled: number;
};

export type ReminderInboxItemDto = {
  id: string;
  dedupeKey: string;
  category: string;
  title: string;
  body: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
};

export type ReminderInboxPageDto = {
  items: ReminderInboxItemDto[];
  nextCursor: string | null;
};

export async function apiRegisterPushToken(params: {
  token: string;
  platform?: string;
}): Promise<{ id: string; token: string; platform: string }> {
  return apiRequest(`${APP_API_PREFIX}/push-tokens`, {
    method: 'POST',
    body: {
      token: params.token,
      platform: params.platform ?? null,
    },
  });
}

export async function apiPutReminderJobs(
  body: PutReminderJobsBody,
): Promise<PutReminderJobsResult> {
  return apiRequest(`${APP_API_PREFIX}/reminder-jobs`, {
    method: 'PUT',
    body,
  });
}

export async function apiFetchReminderInbox(params?: {
  cursor?: string | null;
  limit?: number;
  updatedSince?: string | null;
}): Promise<ReminderInboxPageDto> {
  const q = new URLSearchParams();
  if (params?.cursor) q.set('cursor', params.cursor);
  if (params?.updatedSince) q.set('updatedSince', params.updatedSince);
  if (params?.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiRequest(
    `${APP_API_PREFIX}/reminder-inbox${qs ? `?${qs}` : ''}`,
  );
}

export async function apiMarkReminderInboxRead(params: {
  id?: string;
  dedupeKey?: string;
}): Promise<ReminderInboxItemDto> {
  return apiRequest(`${APP_API_PREFIX}/reminder-inbox/read`, {
    method: 'POST',
    body: {
      id: params.id ?? null,
      dedupeKey: params.dedupeKey ?? null,
    },
  });
}

export async function apiMarkAllReminderInboxRead(): Promise<{ updated: number }> {
  return apiRequest(`${APP_API_PREFIX}/reminder-inbox/read-all`, {
    method: 'POST',
    body: {},
  });
}
