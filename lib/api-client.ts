import {
    clearApiAuthToken,
    getApiAuthToken,
    getApiBaseUrl,
    getApiPassword,
    getApiUsername,
    setApiAuthToken,
} from '@/lib/api-config';
import { logPageListApiResponse } from '@/lib/api-debug';
import { mapTableRowForMysqlApiUpload } from '@/lib/api-mysql-column-map';
import { formatWallClockDatetimeLocal, normalizeRecordForMysqlApi } from '@/lib/api-mysql-datetime';
import {
    type ApiUploadSlimOptions,
    slimRecordForMysqlApi,
} from '@/lib/api-mysql-payload';
import { enqueueApiRequest } from '@/lib/api-request-queue';
import { fetchWithTimeoutAndRetry, isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import type {
    TasksCalendarDayResponse,
    TasksCalendarGridResponse,
    TasksCalendarResponse,
} from '@/lib/tasks-calendar-data';

export function prepareRowBodyForApi(
  table: string,
  row: Record<string, unknown>,
  opts?: ApiUploadSlimOptions,
): Record<string, unknown> {
  const mapped = mapTableRowForMysqlApiUpload(table, row);
  const normalized = normalizeRecordForMysqlApi(mapped, table) as Record<string, unknown>;
  /**
   * 积分钱包服务端用 updated_at 乐观锁，库内多为会话时区墙上时钟。
   * 通用 normalize 会把时间收成 UTC，东八区下会固定「旧 8 小时」而被永久拒绝。
   */
  if (table === 'points_wallet') {
    normalized.updated_at = formatWallClockDatetimeLocal(new Date());
  }
  return slimRecordForMysqlApi(normalized, opts);
}

/** 上传失败时依次尝试更小 payload（避免网关 413） */
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

type ApiEnvelope<T> = {
  code: number;
  message: string;
  data: T | null;
};

export class ApiUnauthorizedError extends Error {
  constructor(message = '未登录或 Token 已过期') {
    super(message);
    this.name = 'ApiUnauthorizedError';
  }
}

export class ApiRequestError extends Error {
  readonly httpStatus: number;
  readonly apiCode: number;
  readonly retryable: boolean;
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    httpStatus: number,
    apiCode: number,
    opts?: { retryable?: boolean; retryAfterSec?: number },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
    this.retryable = opts?.retryable ?? false;
    this.retryAfterSec = opts?.retryAfterSec;
  }
}

/** 按规范：HTTP 200 且 body.code === 0 为成功 */
export function isApiResponseSuccess(httpStatus: number, apiCode: number): boolean {
  return httpStatus === 200 && apiCode === 0;
}

export function formatApiErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError || err instanceof ApiUnauthorizedError) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isApiErrorRetryable(err: unknown): boolean {
  if (err instanceof ApiRequestError) return err.retryable;
  if (err instanceof ApiUnauthorizedError) return true;
  if (isAbortError(err)) return true;
  return true;
}

/** upsert 流程中 POST 409 / 唯一约束冲突，上层会改走 PUT，不应弹全局错误 */
export function isDuplicateRecordApiError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.httpStatus === 409 || /已存在|duplicate|冲突|unique/i.test(err.message))
  );
}

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

export function serializeApiErrorForDiagnostic(err: unknown): string {
  return serializeUnknownError(err);
}

async function parseResponseBody(res: Response): Promise<{ parsed: unknown; text: string }> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return { parsed: null, text: '' };

  // 诊断日志：记录大响应的大小，帮助排查截断问题
  if (text.length > 50_000) {
    const contentLength = res.headers.get('Content-Length');
    console.log(
      `[api] 响应体大小: ${text.length} 字符` +
      (contentLength != null ? ` (Content-Length: ${contentLength})` : '') +
      ` ${res.url?.slice(-60)}`,
    );
  }

  try {
    return { parsed: JSON.parse(text) as unknown, text };
  } catch (parseErr) {
    // JSON 解析失败可能是截断导致的不完整 JSON
    const contentLength = res.headers.get('Content-Length');
    console.warn('[api] JSON 解析失败，响应可能被截断', {
      status: res.status,
      textLength: text.length,
      contentLength: contentLength ?? 'unknown',
      textTail: text.slice(-200),
    });
    throw new ApiRequestError(
      `JSON 解析失败，响应可能被截断（${text.length} 字符）`,
      res.status,
      -1,
      { retryable: true },
    );
  }
}

function extractEnvelope(parsed: unknown): ApiEnvelope<unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.code !== 'number') return null;
  return {
    code: o.code,
    message: typeof o.message === 'string' ? o.message : '',
    data: (o.data ?? null) as unknown,
  };
}

export async function apiLogin(opts?: {
  signal?: AbortSignal;
  username?: string;
  password?: string;
}): Promise<string> {
  const baseUrl = await getApiBaseUrl();
  const username = opts?.username ?? (await getApiUsername());
  const password = opts?.password ?? (await getApiPassword());

  throwIfAborted(opts?.signal);

  const res = await fetchWithTimeoutAndRetry(
    `${baseUrl}/api/app/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
    { signal: opts?.signal, perAttemptTimeoutMs: 8_000, maxAttempts: 2 },
  );

  const { parsed, text } = await parseResponseBody(res);
  const envelope = extractEnvelope(parsed);

  if (!envelope || !isApiResponseSuccess(res.status, envelope.code)) {
    const message = envelope?.message || `登录失败：HTTP ${res.status}`;
    throw new ApiRequestError(message, res.status, envelope?.code ?? -1, {
      retryable: res.status >= 500,
    });
  }

  const token = (envelope.data as { token?: string } | null)?.token;
  if (!token) {
    throw new ApiRequestError('登录响应缺少 token', res.status, envelope.code);
  }

  await setApiAuthToken(token);
  return token;
}

export async function ensureApiLoggedIn(opts?: { signal?: AbortSignal }): Promise<string> {
  const existing = await getApiAuthToken();
  if (existing) return existing;
  return apiLogin(opts);
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  skipAuth?: boolean;
  retryOnUnauthorized?: boolean;
  /** 单次请求超时毫秒数，bootstrap 等大响应用更大的值 */
  perAttemptTimeoutMs?: number;
  /**
   * 不触发全局「正在同步数据…」全屏蒙层（后台任务、页面内自有 loading 时使用）。
   * `/api/ai/*` 默认视为耗时长的非阻塞请求，也会跳过蒙层。
   */
  skipGlobalLoading?: boolean;
};

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const method = options.method ?? 'GET';
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;

  const runOnce = async (token: string | null): Promise<T> => {
    throwIfAborted(options.signal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (!options.skipAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetchWithTimeoutAndRetry(
      url,
      {
        method,
        headers,
        ...(options.body != null ? { body: JSON.stringify(options.body) } : {}),
      },
      { signal: options.signal, perAttemptTimeoutMs: options.perAttemptTimeoutMs },
    );

    const { parsed, text } = await parseResponseBody(res);

    const envelope = extractEnvelope(parsed);

    if (res.status === 401) {
      await clearApiAuthToken();
      const message = envelope?.message?.trim() || '请先登录';
      throw new ApiUnauthorizedError(message);
    }

    if (res.status === 413 || /entity too large/i.test(text)) {
      throw new ApiRequestError(
        envelope?.message?.trim() || 'request entity too large',
        413,
        envelope?.code ?? -1,
      );
    }

    if (!envelope) {
      throw new ApiRequestError(
        `接口响应格式异常：HTTP ${res.status}`,
        res.status,
        -1,
        { retryable: res.status >= 500 },
      );
    }

    if (!isApiResponseSuccess(res.status, envelope.code)) {
      const retryable = res.status === 500 || res.status === 502 || res.status === 503;
      let retryAfterSec: number | undefined;
      if (res.status === 503) {
        const ra = res.headers.get('Retry-After');
        if (ra != null && /^\d+$/.test(ra.trim())) {
          retryAfterSec = parseInt(ra.trim(), 10);
        }
      }
      throw new ApiRequestError(
        envelope.message || `请求失败：HTTP ${res.status}`,
        res.status,
        envelope.code,
        { retryable, retryAfterSec },
      );
    }

    if (__DEV__ && text && res.status >= 400) {
      console.warn('[api]', method, path, text);
    }

    return envelope.data as T;
  };

  const execute = async (): Promise<T> => {
    const runAuth = async (): Promise<T> => {
      try {
        const token = options.skipAuth ? null : await ensureApiLoggedIn({ signal: options.signal });
        return await runOnce(token);
      } catch (e) {
        if (retryOnUnauthorized && e instanceof ApiUnauthorizedError && !options.skipAuth) {
          await clearApiAuthToken();
          const token = await apiLogin({ signal: options.signal });
          return runOnce(token);
        }
        if (isAbortError(e)) throw e;
        throw e;
      }
    };

    const isAiEndpoint = /\/api(?:\/app)?\/ai(?:\/|$)/.test(path);
    const skipOverlay = options.skipGlobalLoading === true || isAiEndpoint;
    if (method !== 'GET' && !skipOverlay) {
      const { withApiWriteLoading } = await import('@/lib/api-loading-tracker');
      return withApiWriteLoading(runAuth);
    }
    return runAuth();
  };

  return enqueueApiRequest(execute);
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

  if (isAppDomainCrudTable(table)) {
    try {
      // 专用接口自行整理 body（如 recipes 的 JSON 数组），避免通用 slim/map 破坏字段
      const body = { ...row };
      delete body.sync_status;
      return await appDomainCreateRecord<T>(table, body, {
        signal: opts?.signal,
      });
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
    }
  }

  const bodies = buildApiUploadBodies(table, row);

  let lastError: unknown;
  for (let i = 0; i < bodies.length; i++) {
    try {
      return await apiRequest<T>(`/api/data/${encodeURIComponent(table)}`, {
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
    }
  }

  const bodies = buildApiUploadBodies(table, row);

  let lastError: unknown;
  for (let i = 0; i < bodies.length; i++) {
    try {
      return await apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
        method: 'PUT',
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
    }
  }

  return apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
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

  if (isAppDomainCrudTable(table)) {
    try {
      await appDomainDeleteRecord(table, id, { signal: opts?.signal });
      return;
    } catch (e) {
      if (!(e instanceof AppDomainFallbackError)) throw e;
    }
  }

  await apiRequest<null>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export type ApiListPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ApiListResponse<T> = {
  list: T[];
  pagination: ApiListPagination;
};

/** List API 可选过滤参数（见 CALENDAR_API_FOR_APP.md） */
export type ApiListQueryOpts = {
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
  startDate?: string;
  endDate?: string;
  dueDateGte?: string;
  dueDateLte?: string;
  frogAssignedOnGte?: string;
  frogAssignedOnLte?: string;
  createdAtGte?: string;
  createdAtLte?: string;
  assignedYmdGte?: string;
  assignedYmdLte?: string;
  calendarRelevant?: boolean;
  fields?: string;
  updatedSince?: string;
};

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      qs.set(key, value ? 'true' : 'false');
      continue;
    }
    if (value === '') continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

function buildListQuery(opts?: ApiListQueryOpts): string {
  return buildQuery({
    page: opts?.page,
    limit: opts?.limit,
    includeDeleted: opts?.includeDeleted === true,
    startDate: opts?.startDate,
    endDate: opts?.endDate,
    dueDateGte: opts?.dueDateGte,
    dueDateLte: opts?.dueDateLte,
    frogAssignedOnGte: opts?.frogAssignedOnGte,
    frogAssignedOnLte: opts?.frogAssignedOnLte,
    createdAtGte: opts?.createdAtGte,
    createdAtLte: opts?.createdAtLte,
    assignedYmdGte: opts?.assignedYmdGte,
    assignedYmdLte: opts?.assignedYmdLte,
    calendarRelevant: opts?.calendarRelevant === true,
    fields: opts?.fields,
    updatedSince: opts?.updatedSince,
  });
}

export type TodayFrogsMeta = {
  serverFiltered?: boolean;
  filtersVersion?: string;
  serverTime?: string;
};

export type TodayFrogsPayload = {
  logicalToday: string;
  count: number;
  tasks: Record<string, unknown>[];
  /** 今日指派的项目青蛙（与 projects 行一致） */
  projectFrogs?: Record<string, unknown>[];
  projectFrogIds?: string[];
  meta?: TodayFrogsMeta;
};

export async function apiGetTodayFrogs(params?: {
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  signal?: AbortSignal;
}): Promise<TodayFrogsPayload> {
  const qs = buildQuery({
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
  });
  return apiRequest<TodayFrogsPayload>(`/api/pages/tasks/today-frogs${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export type TasksCatalogTableVersion = {
  count?: number;
  version?: string | null;
  maxUpdatedAt?: string | null;
};

export type TasksCatalogMeta = {
  serverTime?: string;
  /** false 时 APP 应跳过 catalog 写入并降级逐表 List */
  catalogComplete?: boolean;
  tablesVersion?: Record<string, TasksCatalogTableVersion>;
};

export type TasksCatalogPayload = {
  projects?: Record<string, unknown>[];
  projectCategories?: Record<string, unknown>[];
  taskCategories?: Record<string, unknown>[];
  meta?: TasksCatalogMeta;
};

/** 项目与分类专用聚合接口（不含 tasks） */
export async function apiGetTasksCatalog(params?: {
  updatedSince?: string;
  signal?: AbortSignal;
}): Promise<TasksCatalogPayload> {
  const qs = buildQuery({
    updatedSince: params?.updatedSince,
  });
  return apiRequest<TasksCatalogPayload>(`/api/pages/tasks/catalog${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiGetTasksCalendar(
  params: {
    start: string;
    end: string;
    dayBoundaryHour?: number;
    dayBoundaryMinute?: number;
    signal?: AbortSignal;
  },
): Promise<TasksCalendarResponse> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    dayBoundaryHour: params.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params.dayBoundaryMinute ?? 0,
  });
  return apiRequest(`/api/calendar/tasks${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** 月格轻量接口 `GET /api/calendar/tasks/grid`（见 BACKEND_TASKS_CALENDAR_API.md） */
export async function apiGetTasksCalendarGrid(
  params: {
    start: string;
    end: string;
    dayBoundaryHour?: number;
    dayBoundaryMinute?: number;
    signal?: AbortSignal;
  },
): Promise<TasksCalendarGridResponse> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    dayBoundaryHour: params.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params.dayBoundaryMinute ?? 0,
  });
  return apiRequest(`/api/calendar/tasks/grid${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** 选中日详情 `GET /api/calendar/tasks/day` */
export async function apiGetTasksCalendarDay(
  params: {
    ymd: string;
    dayBoundaryHour?: number;
    dayBoundaryMinute?: number;
    signal?: AbortSignal;
  },
): Promise<TasksCalendarDayResponse> {
  const qs = buildQuery({
    ymd: params.ymd,
    dayBoundaryHour: params.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params.dayBoundaryMinute ?? 0,
  });
  return apiRequest(`/api/calendar/tasks/day${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

export type TasksBootstrapPayload = {
  projects?: Record<string, unknown>[];
  projectCategories?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  taskCategories?: Record<string, unknown>[];
  taskItems?: Record<string, unknown>[];
  habits?: Record<string, unknown>[];
  habitContexts?: Record<string, unknown>[];
  habitCheckIns?: Record<string, unknown>[];
  taskExecutionEvents?: Record<string, unknown>[];
  frogCompletionEvents?: Record<string, unknown>[];
  meta?: Record<string, unknown>;
};

export type TasksBootstrapTableSummary = {
  count: number;
  version: string | null;
};

export type TasksBootstrapSummaryMeta = {
  serverTime?: string;
  logicalToday?: string;
  heatmapStart?: string;
  heatmapEnd?: string;
  habitCheckInStart?: string;
  habitCheckInEnd?: string;
  completionHeatmapWeeks?: number;
};

/** 任务页视图筛选 meta（`GET /api/pages/tasks?taskView=tasksPage`） */
export type TasksPageFilteredMeta = TasksBootstrapSummaryMeta & {
  tasksScope?: string;
  serverFiltered?: boolean;
  filtersVersion?: string;
  taskViews?: string[];
  weekStart?: string;
  weekEnd?: string;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  snapshotAt?: string;
};

export type TasksPageFilterParams = {
  taskView?: 'tasksPage' | 'standaloneTodos' | 'matrixWeek' | 'projectTrees';
  taskViews?: string;
  logicalToday?: string;
  weekStart?: string;
  weekEnd?: string;
  projectIds?: string;
  includeCompleted?: boolean;
  includeCancelled?: boolean;
  includeShelved?: boolean;
  page?: number;
  limit?: number;
};

export type TasksBootstrapSummaryPayload = {
  tables: Record<string, TasksBootstrapTableSummary>;
  meta: TasksBootstrapSummaryMeta;
};

export async function apiGetTasksBootstrapSummary(
  params?: {
    dayBoundaryHour?: number;
    dayBoundaryMinute?: number;
    heatmapStart?: string;
    heatmapEnd?: string;
    habitCheckInMonths?: number;
    habitCheckInStart?: string;
    habitCheckInEnd?: string;
    signal?: AbortSignal;
  },
): Promise<TasksBootstrapSummaryPayload> {
  const qs = buildQuery({
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
    heatmapStart: params?.heatmapStart,
    heatmapEnd: params?.heatmapEnd,
    habitCheckInMonths: params?.habitCheckInMonths,
    habitCheckInStart: params?.habitCheckInStart,
    habitCheckInEnd: params?.habitCheckInEnd,
  });
  return apiRequest<TasksBootstrapSummaryPayload>(`/api/pages/tasks/summary${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiGetTasksBootstrap(
  params?: {
    dayBoundaryHour?: number;
    dayBoundaryMinute?: number;
    heatmapStart?: string;
    heatmapEnd?: string;
    habitCheckInMonths?: number;
    habitCheckInStart?: string;
    habitCheckInEnd?: string;
    include?: string;
    signal?: AbortSignal;
  } & TasksPageFilterParams,
): Promise<TasksBootstrapPayload> {
  const qs = buildQuery({
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
    heatmapStart: params?.heatmapStart,
    heatmapEnd: params?.heatmapEnd,
    habitCheckInMonths: params?.habitCheckInMonths,
    habitCheckInStart: params?.habitCheckInStart,
    habitCheckInEnd: params?.habitCheckInEnd,
    include: params?.include,
    taskView: params?.taskView,
    taskViews: params?.taskViews,
    logicalToday: params?.logicalToday,
    weekStart: params?.weekStart,
    weekEnd: params?.weekEnd,
    projectIds: params?.projectIds,
    includeCompleted: params?.includeCompleted,
    includeCancelled: params?.includeCancelled,
    includeShelved: params?.includeShelved,
    page: params?.page,
    limit: params?.limit,
  });
  // 带 taskView 的筛选视图只返回 tasks，超时按普通 page API；无 taskView 的 10 表 bootstrap 才用长超时
  return apiRequest<TasksBootstrapPayload>(`/api/pages/tasks${qs}`, {
    method: 'GET',
    signal: params?.signal,
    perAttemptTimeoutMs: params?.taskView ? 20_000 : 180_000,
  });
}

export type HabitsGridItem = {
  id: string;
  name: string;
  icon: string;
  kind: 'build' | 'break' | 'task' | string;
  todayCount: number;
  dailyGoal: number | null;
  displayCompleted: boolean;
  hiddenOnViewDay: boolean;
  periodProgress: number | null;
  periodGoal: number | null;
  note?: string | null;
  extra_data?: string | Record<string, unknown> | null;
  extraData?: string | Record<string, unknown> | null;
  context?: string | null;
  rewardPoints?: number;
};

export type HabitsGridSection = {
  id: string;
  title: string;
  items: HabitsGridItem[];
};

export type HabitsGridMeta = {
  serverFiltered?: boolean;
  filtersVersion?: string;
  serverTime?: string;
};

export type HabitsGridPayload = {
  logicalToday: string;
  sections: HabitsGridSection[];
  meta?: HabitsGridMeta;
};

export async function apiGetTasksHabitsGrid(params?: {
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  logicalToday?: string;
  habitCheckInMonths?: number;
  signal?: AbortSignal;
}): Promise<HabitsGridPayload> {
  const qs = buildQuery({
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
    logicalToday: params?.logicalToday,
    habitCheckInMonths: params?.habitCheckInMonths,
  });
  return apiRequest<HabitsGridPayload>(`/api/pages/tasks/habits-grid${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export type CompletionHeatmapDayCounts = {
  frogs: number;
  todos: number;
  total: number;
};

export type CompletionHeatmapMeta = {
  logicalToday?: string;
  heatmapStart?: string;
  heatmapEnd?: string;
  completionHeatmapWeeks?: number;
  serverTime?: string;
};

export type CompletionHeatmapDayDetailFrog = {
  task_id: string | null;
  task_title: string | null;
};

export type CompletionHeatmapDayDetailTodo = {
  id: string;
  task_id: string | null;
  title: string | null;
};

export type CompletionHeatmapDayDetail = {
  ymd: string;
  frogs: CompletionHeatmapDayDetailFrog[];
  todos: CompletionHeatmapDayDetailTodo[];
};

export type CompletionHeatmapPayload = {
  meta: CompletionHeatmapMeta;
  countsByDay: Record<string, CompletionHeatmapDayCounts>;
  dayDetail?: CompletionHeatmapDayDetail;
};

export async function apiGetTasksCompletionHeatmap(params?: {
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  heatmapStart?: string;
  heatmapEnd?: string;
  day?: string;
  includeDayDetail?: boolean;
  signal?: AbortSignal;
}): Promise<CompletionHeatmapPayload> {
  const qs = buildQuery({
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
    heatmapStart: params?.heatmapStart,
    heatmapEnd: params?.heatmapEnd,
    day: params?.day,
    includeDayDetail: params?.includeDayDetail === true ? true : undefined,
  });
  return apiRequest<CompletionHeatmapPayload>(`/api/pages/tasks/completion-heatmap${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export type TasksOverviewMeta = {
  serverTime?: string;
  logicalToday?: string;
  heatmapStart?: string;
  heatmapEnd?: string;
  firstCompletedDay?: string | null;
  filtersVersion?: string;
};

export type TasksOverviewInsightCounts = {
  open: number;
  doneOrCancelled: number;
  totalActive: number;
  /** 设置了重复规则的独立待办数（含各状态） */
  recurring: number;
  completedEvents: number;
  reopenedEvents: number;
};

export type TasksOverviewStatKey =
  | 'open'
  | 'doneOrCancelled'
  | 'totalActive'
  | 'recurring'
  | 'completedEvents'
  | 'reopenedEvents';

export type TasksOverviewEvent = {
  id: string;
  task_id: string | null;
  action: string;
  created_at: string;
  task_title: string | null;
};

export type TasksOverviewPaged<T> = {
  list: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type TasksOverviewStatDetail = {
  statKey: string;
  mode: 'tasks' | 'events';
  tasks?: TasksOverviewPaged<Record<string, unknown>>;
  events?: TasksOverviewPaged<TasksOverviewEvent>;
};

export type TasksOverviewDayDetail = {
  ymd: string;
  netCompletedCount: number;
  events: TasksOverviewEvent[];
};

export type TasksOverviewPayload = {
  meta: TasksOverviewMeta;
  insightCounts: TasksOverviewInsightCounts;
  countsByDay: Record<string, number>;
  recentEvents: TasksOverviewPaged<TasksOverviewEvent>;
  statDetail?: TasksOverviewStatDetail;
  dayDetail?: TasksOverviewDayDetail;
};

export async function apiGetTasksOverview(params?: {
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  logicalToday?: string;
  heatmapStart?: string;
  heatmapEnd?: string;
  eventsPage?: number;
  eventsLimit?: number;
  statKey?: string;
  statPage?: number;
  statLimit?: number;
  day?: string;
  includeDayDetail?: boolean;
  signal?: AbortSignal;
}): Promise<TasksOverviewPayload> {
  const qs = buildQuery({
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
    logicalToday: params?.logicalToday,
    heatmapStart: params?.heatmapStart,
    heatmapEnd: params?.heatmapEnd,
    eventsPage: params?.eventsPage,
    eventsLimit: params?.eventsLimit,
    statKey: params?.statKey,
    statPage: params?.statPage,
    statLimit: params?.statLimit,
    day: params?.day,
    includeDayDetail: params?.includeDayDetail === true ? true : undefined,
  });
  return apiRequest<TasksOverviewPayload>(`/api/pages/tasks/tasks-overview${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** 分页列表 meta（`GET /api/pages/projects`、`GET /api/pages/tasks/list`） */
export type PageListMeta = {
  serverTime?: string;
  categoryId?: string;
  categoryIds?: string[];
  uncategorized?: boolean;
  /** 后端回显：本次响应是否包含 status=done 的任务 */
  includeCompleted?: boolean;
  /** 后端回显：本次响应是否包含 status=cancelled 的任务 */
  includeCancelled?: boolean;
  /** true 表示每个项目的 tasks 树已给全，未按 LIMIT 截断 */
  tasksComplete?: boolean;
  projectId?: string;
};

export type PageListResponse<T> = {
  list: T[];
  pagination: ApiListPagination;
  meta?: PageListMeta;
};

export type ApiTaskTreeNode = Record<string, unknown> & {
  id: string;
  children?: ApiTaskTreeNode[];
};

export type ApiProjectListItem = Record<string, unknown> & {
  id: string;
  tasks?: ApiTaskTreeNode[];
  /** 该项目在服务端的任务总数（含子孙）；APP 用来发现树被截断 */
  taskCount?: number;
};

export type ProjectsListQueryParams = {
  categoryId?: string;
  categoryIds?: string;
  uncategorized?: boolean;
  includeCompleted?: boolean;
  includeCancelled?: boolean;
  includeShelved?: boolean;
  page?: number;
  limit?: number;
  updatedSince?: string;
  /** 只返回这一个项目及其完整任务树 */
  projectId?: string;
  signal?: AbortSignal;
};

/** 项目列表（含服务端组装的任务树） */
export async function apiGetProjectsList(
  params?: ProjectsListQueryParams,
): Promise<PageListResponse<ApiProjectListItem>> {
  const qs = buildQuery({
    categoryId: params?.categoryId,
    categoryIds: params?.categoryIds,
    uncategorized: params?.uncategorized === true ? true : undefined,
    includeCompleted: params?.includeCompleted === false ? false : undefined,
    includeCancelled: params?.includeCancelled === false ? false : undefined,
    includeShelved: params?.includeShelved === false ? false : undefined,
    page: params?.page,
    limit: params?.limit,
    updatedSince: params?.updatedSince,
    projectId: params?.projectId,
  });
  const data = await apiRequest<PageListResponse<ApiProjectListItem>>(`/api/pages/projects${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
  const result = {
    list: Array.isArray(data?.list) ? data.list : [],
    pagination: data?.pagination ?? {
      page: params?.page ?? 1,
      limit: params?.limit ?? 50,
      total: 0,
      totalPages: 0,
    },
    meta: data?.meta,
  };
  logPageListApiResponse('projects-list', `/api/pages/projects${qs}`, params as Record<string, unknown>, result);
  return result;
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
    `/api/data/${encodeURIComponent(table)}${buildListQuery(opts)}`,
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

  return apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
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
  const data = await apiRequest<ApiTableMetaRow[] | { tables?: ApiTableMetaRow[] }>('/api/tables', {
    method: 'GET',
    signal,
  });
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { tables?: ApiTableMetaRow[] }).tables)) {
    return (data as { tables: ApiTableMetaRow[] }).tables;
  }
  return [];
}

// ---------------------------------------------------------------------------
// 财务页专用接口（禁止降级 /api/data/* 全表 List；字段形状对齐 finance_* 行）
// ---------------------------------------------------------------------------

export type FinancePageMeta = {
  serverTime?: string;
  tablesVersion?: Record<
    string,
    { count?: number; version?: string | null; maxUpdatedAt?: string | null } | undefined
  >;
};

/** GET /api/pages/finance/catalog */
export type FinanceCatalogPayload = {
  accounts: Record<string, unknown>[];
  accountTypes: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  meta?: FinancePageMeta;
};

export async function apiGetFinanceCatalog(params?: {
  signal?: AbortSignal;
}): Promise<FinanceCatalogPayload> {
  return apiRequest<FinanceCatalogPayload>('/api/pages/finance/catalog', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/finance/home */
export type FinanceHomePayload = {
  accounts: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  /** 今日 + 预算窗 + 近 daysBack 天 + 首屏历史日的并集（去重） */
  transactions: Record<string, unknown>[];
  historyHasMore?: boolean;
  /** 服务端按 exclude_from_total_assets 汇总的净资产 */
  netWorth?: number;
  /** 自然月收入/支出（不含转账），可选 */
  monthly?: { income: number; expense: number };
  meta?: FinancePageMeta & {
    logicalToday?: string;
    daysBack?: number;
    budgetRefreshDay?: number;
  };
};

export async function apiGetFinanceHome(params?: {
  logicalToday?: string;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  /** 首屏历史有流水日数（不含今天），默认 2 */
  historyDays?: number;
  /** 与预算窗取并集的回看天数，默认 90 */
  daysBack?: number;
  budgetRefreshDay?: number;
  signal?: AbortSignal;
}): Promise<FinanceHomePayload> {
  const qs = buildQuery({
    logicalToday: params?.logicalToday,
    dayBoundaryHour: params?.dayBoundaryHour,
    dayBoundaryMinute: params?.dayBoundaryMinute,
    historyDays: params?.historyDays,
    daysBack: params?.daysBack ?? 90,
    budgetRefreshDay: params?.budgetRefreshDay,
  });
  return apiRequest<FinanceHomePayload>(`/api/pages/finance/home${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/finance/recent-days — 首页触底加载更早流水 */
export type FinanceRecentDaysPayload = {
  transactions: Record<string, unknown>[];
  historyHasMore?: boolean;
  meta?: FinancePageMeta & { before?: string; days?: number };
};

export async function apiGetFinanceRecentDays(params: {
  before: string;
  days?: number;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  signal?: AbortSignal;
}): Promise<FinanceRecentDaysPayload> {
  const qs = buildQuery({
    before: params.before,
    days: params.days ?? 3,
    dayBoundaryHour: params.dayBoundaryHour,
    dayBoundaryMinute: params.dayBoundaryMinute,
  });
  return apiRequest<FinanceRecentDaysPayload>(`/api/pages/finance/recent-days${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/finance/transactions — 按区间/账户拉流水（统计、日历日、账户详情） */
export type FinanceTransactionsPagePayload = {
  transactions: Record<string, unknown>[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta?: FinancePageMeta & {
    start?: string;
    end?: string;
    accountId?: string;
  };
};

export async function apiGetFinanceTransactionsPage(params: {
  start?: string;
  end?: string;
  accountId?: string;
  page?: number;
  limit?: number;
  excludeCorrections?: boolean;
  signal?: AbortSignal;
}): Promise<FinanceTransactionsPagePayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    accountId: params.accountId,
    page: params.page,
    limit: params.limit,
    excludeCorrections: params.excludeCorrections === true ? true : undefined,
  });
  return apiRequest<FinanceTransactionsPagePayload>(`/api/pages/finance/transactions${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/finance/daily-summaries */
export type FinanceDailySummariesPayload = {
  days: Array<{ day: string; income: number; expense: number; net: number }>;
  meta?: FinancePageMeta & { start?: string; end?: string };
};

export async function apiGetFinanceDailySummaries(params: {
  start: string;
  end: string;
  signal?: AbortSignal;
}): Promise<FinanceDailySummariesPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
  });
  return apiRequest<FinanceDailySummariesPayload>(`/api/pages/finance/daily-summaries${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/finance/account-detail */
export type FinanceAccountDetailPayload = {
  account: Record<string, unknown> | null;
  transactions: Record<string, unknown>[];
  meta?: FinancePageMeta;
};

export async function apiGetFinanceAccountDetail(params: {
  accountId?: string;
  accountName?: string;
  signal?: AbortSignal;
}): Promise<FinanceAccountDetailPayload> {
  const qs = buildQuery({
    accountId: params.accountId,
    accountName: params.accountName,
  });
  return apiRequest<FinanceAccountDetailPayload>(`/api/pages/finance/account-detail${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/finance/cash-flow */
export type FinanceCashFlowPayload = {
  profile: Record<string, unknown> | null;
  incomes: Record<string, unknown>[];
  holdings: Record<string, unknown>[];
  expenseLines: Record<string, unknown>[];
  meta?: FinancePageMeta;
};

export async function apiGetFinanceCashFlow(params?: {
  signal?: AbortSignal;
}): Promise<FinanceCashFlowPayload> {
  return apiRequest<FinanceCashFlowPayload>('/api/pages/finance/cash-flow', {
    method: 'GET',
    signal: params?.signal,
  });
}

/**
 * GET /api/pages/finance/insights
 * 现金流洞察：月汇总 / Top 分类 / 月末净值序列（勿回传 6 个月全量流水）
 */
export type FinanceInsightsPayload = {
  netWorth: number;
  monthly: Array<{
    key: string;
    income: number;
    expense: number;
    net: number;
  }>;
  categoryTop?: Array<{ categoryId: string | null; name: string; amount: number }>;
  monthEndNetWorth?: Array<{ key: string; netWorth: number }>;
  meta?: FinancePageMeta & { months?: number };
};

export async function apiGetFinanceInsights(params?: {
  months?: number;
  signal?: AbortSignal;
}): Promise<FinanceInsightsPayload> {
  const qs = buildQuery({
    months: params?.months ?? 6,
  });
  return apiRequest<FinanceInsightsPayload>(`/api/pages/finance/insights${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

// ---------------------------------------------------------------------------
// 复盘页专用接口（禁止降级 /api/data/* 全表 List；字段形状对齐 review_* / *_review_journal 行）
// ---------------------------------------------------------------------------

export type ReviewPageMeta = {
  serverTime?: string;
  logicalToday?: string;
  dailyStart?: string;
  dailyEnd?: string;
  weekStart?: string;
  monthStart?: string;
  catalogComplete?: boolean;
};

/** GET /api/pages/review/catalog */
export type ReviewCatalogPayload = {
  dimensions: Record<string, unknown>[];
  columns: Record<string, unknown>[];
  meta?: ReviewPageMeta;
};

export async function apiGetReviewCatalog(params?: {
  scope?: 'daily' | 'weekly' | 'monthly' | 'all';
  signal?: AbortSignal;
}): Promise<ReviewCatalogPayload> {
  const qs = buildQuery({
    scope: params?.scope && params.scope !== 'all' ? params.scope : undefined,
  });
  return apiRequest<ReviewCatalogPayload>(`/api/pages/review/catalog${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/review/home — Tab 冷启动 / 下拉主口 */
export type ReviewHomePayload = {
  dimensions: Record<string, unknown>[];
  columns: Record<string, unknown>[];
  dailyJournals: Record<string, unknown>[];
  weeklyJournal?: Record<string, unknown> | null;
  monthlyJournal?: Record<string, unknown> | null;
  meta?: ReviewPageMeta;
};

export async function apiGetReviewHome(params: {
  logicalToday: string;
  dailyStart: string;
  dailyEnd: string;
  weekStart?: string;
  monthStart?: string;
  signal?: AbortSignal;
}): Promise<ReviewHomePayload> {
  const qs = buildQuery({
    logicalToday: params.logicalToday,
    dailyStart: params.dailyStart,
    dailyEnd: params.dailyEnd,
    weekStart: params.weekStart,
    monthStart: params.monthStart,
  });
  return apiRequest<ReviewHomePayload>(`/api/pages/review/home${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/review/daily — 按日期区间拉日刊（日历 / 换日） */
export type ReviewDailyPayload = {
  journals: Record<string, unknown>[];
  meta?: ReviewPageMeta & { start?: string; end?: string };
};

export async function apiGetReviewDaily(params: {
  start: string;
  end: string;
  signal?: AbortSignal;
}): Promise<ReviewDailyPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
  });
  return apiRequest<ReviewDailyPayload>(`/api/pages/review/daily${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/review/weekly — 按周起点拉周刊（可多周） */
export type ReviewWeeklyPayload = {
  journals: Record<string, unknown>[];
  meta?: ReviewPageMeta;
};

export async function apiGetReviewWeekly(params: {
  weekStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
}): Promise<ReviewWeeklyPayload> {
  const qs = buildQuery({
    weekStart: params.weekStart,
    start: params.start,
    end: params.end,
  });
  return apiRequest<ReviewWeeklyPayload>(`/api/pages/review/weekly${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/pages/review/monthly — 按月初拉月刊 */
export type ReviewMonthlyPayload = {
  journals: Record<string, unknown>[];
  meta?: ReviewPageMeta;
};

export async function apiGetReviewMonthly(params: {
  monthStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
}): Promise<ReviewMonthlyPayload> {
  const qs = buildQuery({
    monthStart: params.monthStart,
    start: params.start,
    end: params.end,
  });
  return apiRequest<ReviewMonthlyPayload>(`/api/pages/review/monthly${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/**
 * GET /api/pages/review/week-metrics
 * 周复盘旧表单指标：服务端按区间聚合，禁止 APP 再 List tasks/habits/finance 全表
 */
export type ReviewWeekMetricsPayload = {
  rangeKind?: 'rolling-7' | 'calendar-week';
  weekStartYmd: string;
  weekEndYmd: string;
  rangeDisplay?: string;
  weekTitle?: string;
  tasksCompleted: number;
  tasksCreated: number;
  habitCheckInTotal: number;
  savingsWeekTotal: number;
  financeIncome: number;
  financeExpense: number;
  wishUpdates: number;
  meta?: ReviewPageMeta;
};

export async function apiGetReviewWeekMetrics(params: {
  start: string;
  end: string;
  rangeKind?: 'rolling-7' | 'calendar-week';
  signal?: AbortSignal;
}): Promise<ReviewWeekMetricsPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    rangeKind: params.rangeKind,
  });
  return apiRequest<ReviewWeekMetricsPayload>(`/api/pages/review/week-metrics${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

// ---------------------------------------------------------------------------
// 我的 Tab / 画像子页专用接口（禁止降级 /api/data/* 全表 List）
// ---------------------------------------------------------------------------

export type ProfilePageMeta = {
  serverTime?: string;
  wishPreviewLimit?: number;
  catalogComplete?: boolean;
};

/** GET /api/pages/profile/home — Tab 冷启动 / 下拉主口 */
export type ProfileHomePayload = {
  user?: Record<string, unknown> | null;
  visions: Record<string, unknown>[];
  /** 未完成心愿预览（优先字段名） */
  wishPreview?: Record<string, unknown>[];
  /** 兼容别名 */
  wishItems?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileHome(params?: {
  wishPreviewLimit?: number;
  signal?: AbortSignal;
}): Promise<ProfileHomePayload> {
  const qs = buildQuery({
    wishPreviewLimit: params?.wishPreviewLimit,
  });
  return apiRequest<ProfileHomePayload>(`/api/pages/profile/home${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/profile/wish-list */
export type ProfileWishListPayload = {
  wishItems: Record<string, unknown>[];
  savingsPlans: Record<string, unknown>[];
  savingsDeposits: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileWishList(params?: {
  signal?: AbortSignal;
}): Promise<ProfileWishListPayload> {
  return apiRequest<ProfileWishListPayload>('/api/pages/profile/wish-list', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/profile/memo-list */
export type ProfileMemoListPayload = {
  dimensions: Record<string, unknown>[];
  memos: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileMemoList(params?: {
  signal?: AbortSignal;
}): Promise<ProfileMemoListPayload> {
  return apiRequest<ProfileMemoListPayload>('/api/pages/profile/memo-list', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/profile/vision-wall */
export type ProfileVisionWallPayload = {
  user?: Record<string, unknown> | null;
  visions: Record<string, unknown>[];
  goalDimensions?: Record<string, unknown>[];
  /** 兼容别名 */
  dimensions?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileVisionWall(params?: {
  signal?: AbortSignal;
}): Promise<ProfileVisionWallPayload> {
  return apiRequest<ProfileVisionWallPayload>('/api/pages/profile/vision-wall', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/profile/wish-board */
export type ProfileWishBoardPayload = {
  pointsWallet?: Record<string, unknown>[];
  wallet?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  wishBoardItems?: Record<string, unknown>[];
  pointsLedger?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileWishBoard(params?: {
  signal?: AbortSignal;
}): Promise<ProfileWishBoardPayload> {
  return apiRequest<ProfileWishBoardPayload>('/api/pages/profile/wish-board', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/pages/profile/recipes */
export type ProfileRecipesPayload = {
  categories: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  recipes?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileRecipes(params?: {
  signal?: AbortSignal;
}): Promise<ProfileRecipesPayload> {
  return apiRequest<ProfileRecipesPayload>('/api/pages/profile/recipes', {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiHealthCheck(opts?: { signal?: AbortSignal }): Promise<boolean> {
  const baseUrl = await getApiBaseUrl();
  throwIfAborted(opts?.signal);
  const res = await fetchWithTimeoutAndRetry(`${baseUrl}/health`, { method: 'GET' }, { signal: opts?.signal });
  const { parsed } = await parseResponseBody(res);
  const envelope = extractEnvelope(parsed);
  return isApiResponseSuccess(res.status, envelope?.code ?? -1);
}
