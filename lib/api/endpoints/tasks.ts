/**
 * 任务域专用 endpoints：青蛙 / catalog / calendar / bootstrap / habits / heatmap / overview / projects。
 */
import { apiRequest } from '@/lib/api/http';
import { buildQuery, type ApiListPagination } from '@/lib/api/query';
import { logPageListApiResponse } from '@/lib/api-debug';
import type {
  TasksCalendarDayResponse,
  TasksCalendarGridResponse,
  TasksCalendarResponse,
} from '@/lib/tasks-calendar-data';

export type FrogCandidateApiItem = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  dueDate: string | null;
  acceptanceCriteria: string;
  rewardPoints: number;
  projectId: string | null;
  projectName: string | null;
  /** @deprecated 优先用 tags */
  tagNames: string[];
  tags?: { name: string; color: string }[];
  isOverdue?: boolean;
  alreadyAssigned: boolean;
  blockedReason: string | null;
};

export type FrogCandidatesPayload = {
  assignYmd: string;
  logicalToday: string;
  items: FrogCandidateApiItem[];
  meta?: { filtersVersion?: string; count?: number };
};

export async function apiGetFrogCandidates(params?: {
  assignYmd?: string;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  signal?: AbortSignal;
}): Promise<FrogCandidatesPayload> {
  const qs = buildQuery({
    assignYmd: params?.assignYmd,
    dayBoundaryHour: params?.dayBoundaryHour ?? 0,
    dayBoundaryMinute: params?.dayBoundaryMinute ?? 0,
  });
  return apiRequest<FrogCandidatesPayload>(`/api/app/pages/tasks/frog-candidates${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export type FrogAssignPayload = {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
  action: 'assign' | 'unassign';
  extra_data: string | null;
  assignedDates: string[];
};

export async function apiPostFrogAssign(body: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
  action?: 'assign' | 'unassign';
  signal?: AbortSignal;
}): Promise<FrogAssignPayload> {
  return apiRequest<FrogAssignPayload>('/api/app/pages/tasks/frog-assign', {
    method: 'POST',
    body: {
      kind: body.kind,
      id: body.id,
      assignYmd: body.assignYmd,
      action: body.action ?? 'assign',
    },
    signal: body.signal,
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
  return apiRequest<TasksCatalogPayload>(`/api/app/pages/tasks/catalog${qs}`, {
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
  return apiRequest(`/api/app/calendar/tasks${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** 月格轻量接口 `GET /api/app/calendar/tasks/grid`（见 BACKEND_TASKS_CALENDAR_API.md） */
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
  return apiRequest(`/api/app/calendar/tasks/grid${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** 选中日详情 `GET /api/app/calendar/tasks/day` */
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
  return apiRequest(`/api/app/calendar/tasks/day${qs}`, {
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

/** 任务页视图筛选 meta（`GET /api/app/pages/tasks?taskView=tasksPage`） */
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
  return apiRequest<TasksBootstrapSummaryPayload>(`/api/app/pages/tasks/summary${qs}`, {
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
  return apiRequest<TasksBootstrapPayload>(`/api/app/pages/tasks${qs}`, {
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
  return apiRequest<HabitsGridPayload>(`/api/app/pages/tasks/habits-grid${qs}`, {
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
  /** 后端可选：项目青蛙 / 任务青蛙；缺省时由客户端根据 id 前缀与本地项目表推断 */
  subject?: 'task' | 'project';
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
  return apiRequest<CompletionHeatmapPayload>(`/api/app/pages/tasks/completion-heatmap${qs}`, {
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
  return apiRequest<TasksOverviewPayload>(`/api/app/pages/tasks/tasks-overview${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** 分页列表 meta（`GET /api/app/pages/projects`、`GET /api/app/pages/tasks/list`） */
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
  const data = await apiRequest<PageListResponse<ApiProjectListItem>>(`/api/app/pages/projects${qs}`, {
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
  logPageListApiResponse(
    'projects-list',
    `/api/app/pages/projects${qs}`,
    params as Record<string, unknown>,
    result,
  );
  return result;
}
