import {
  clearApiAuthToken,
  getApiAuthToken,
  getApiBaseUrl,
  getApiPassword,
  getApiUsername,
  setApiAuthToken,
} from '@/lib/api-config';
import { normalizeRecordForMysqlApi } from '@/lib/api-mysql-datetime';
import { mapTableRowForMysqlApiUpload } from '@/lib/api-mysql-column-map';
import {
  type ApiUploadSlimOptions,
  slimRecordForMysqlApi,
} from '@/lib/api-mysql-payload';
import { fetchWithTimeoutAndRetry, isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { logPageListApiResponse } from '@/lib/api-debug';
import { enqueueApiRequest } from '@/lib/api-request-queue';
import type { TasksCalendarResponse } from '@/lib/tasks-calendar-data';

export function prepareRowBodyForApi(
  table: string,
  row: Record<string, unknown>,
  opts?: ApiUploadSlimOptions,
): Record<string, unknown> {
  const mapped = mapTableRowForMysqlApiUpload(table, row);
  return slimRecordForMysqlApi(normalizeRecordForMysqlApi(mapped), opts);
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
    `${baseUrl}/api/auth/login`,
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

    if (method !== 'GET') {
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

export type TodayFrogsPayload = {
  logicalToday: string;
  count: number;
  tasks: Record<string, unknown>[];
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
  // bootstrap 端点一次返回 10 张表的数据，JSON 响应可能非常大，
  // 使用更长的超时时间避免在慢网络下被截断
  return apiRequest<TasksBootstrapPayload>(`/api/pages/tasks${qs}`, {
    method: 'GET',
    signal: params?.signal,
    perAttemptTimeoutMs: 180_000,
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
  completedEvents: number;
  reopenedEvents: number;
};

export type TasksOverviewStatKey =
  | 'open'
  | 'doneOrCancelled'
  | 'totalActive'
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
  signal?: AbortSignal;
};

export type TasksListQueryParams = {
  categoryId?: string;
  categoryIds?: string;
  uncategorized?: boolean;
  includeCompleted?: boolean;
  includeCancelled?: boolean;
  includeShelved?: boolean;
  page?: number;
  limit?: number;
  updatedSince?: string;
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

/** 任务扁平列表（按任务分类筛选） */
export async function apiGetTasksList(
  params?: TasksListQueryParams,
): Promise<PageListResponse<Record<string, unknown>>> {
  const qs = buildQuery({
    categoryId: params?.categoryId,
    categoryIds: params?.categoryIds,
    uncategorized: params?.uncategorized === true ? true : undefined,
    includeCompleted: params?.includeCompleted === true ? true : undefined,
    includeCancelled: params?.includeCancelled === true ? true : undefined,
    includeShelved: params?.includeShelved === false ? false : undefined,
    page: params?.page,
    limit: params?.limit,
    updatedSince: params?.updatedSince,
  });
  const data = await apiRequest<PageListResponse<Record<string, unknown>>>(
    `/api/pages/tasks/list${qs}`,
    { method: 'GET', signal: params?.signal },
  );
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
  logPageListApiResponse('tasks-list', `/api/pages/tasks/list${qs}`, params as Record<string, unknown>, result);
  return result;
}

export async function apiListRecords<T extends Record<string, unknown>>(
  table: string,
  opts?: ApiListQueryOpts & { signal?: AbortSignal },
): Promise<ApiListResponse<T>> {
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

export async function apiHealthCheck(opts?: { signal?: AbortSignal }): Promise<boolean> {
  const baseUrl = await getApiBaseUrl();
  throwIfAborted(opts?.signal);
  const res = await fetchWithTimeoutAndRetry(`${baseUrl}/health`, { method: 'GET' }, { signal: opts?.signal });
  const { parsed } = await parseResponseBody(res);
  const envelope = extractEnvelope(parsed);
  return isApiResponseSuccess(res.status, envelope?.code ?? -1);
}
