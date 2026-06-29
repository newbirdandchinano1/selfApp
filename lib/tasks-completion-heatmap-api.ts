import {
  apiGetTasksCompletionHeatmap,
  type CompletionHeatmapDayDetail,
  type CompletionHeatmapDayCounts,
  type CompletionHeatmapDayDetailTodo,
} from '@/lib/api-client';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import type { FrogCompletionDayItem } from '@/lib/repositories/tasks/frog-completion-events';
import type { TaskExecutionEventWithTitle } from '@/lib/repositories/tasks/task-execution-events';
import { loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

export type CompletionHeatmapData = {
  frogCountByYmd: Map<string, number>;
  todoCountByYmd: Map<string, number>;
  meta: {
    logicalToday?: string;
    heatmapStart?: string;
    heatmapEnd?: string;
    completionHeatmapWeeks?: number;
  };
};

export type CompletionHeatmapDayDetailData = {
  frogItems: FrogCompletionDayItem[];
  todoItems: TaskExecutionEventWithTitle[];
};

type HeatmapRequestOpts = {
  boundary?: TasksDayBoundary;
  heatmapStart?: string;
  heatmapEnd?: string;
  signal?: AbortSignal;
};

function readDayCount(row: CompletionHeatmapDayCounts | undefined, key: 'frogs' | 'todos'): number {
  if (!row || typeof row !== 'object') return 0;
  const n = row[key];
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function countsRecordToMaps(countsByDay: Record<string, CompletionHeatmapDayCounts>): {
  frogCountByYmd: Map<string, number>;
  todoCountByYmd: Map<string, number>;
} {
  const frogCountByYmd = new Map<string, number>();
  const todoCountByYmd = new Map<string, number>();
  for (const [ymd, row] of Object.entries(countsByDay ?? {})) {
    if (!ymd) continue;
    frogCountByYmd.set(ymd, readDayCount(row, 'frogs'));
    todoCountByYmd.set(ymd, readDayCount(row, 'todos'));
  }
  return { frogCountByYmd, todoCountByYmd };
}

function readTodoTitle(row: CompletionHeatmapDayDetailTodo & Record<string, unknown>): string | null {
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (title) return title;
  const taskTitle = typeof row.task_title === 'string' ? row.task_title.trim() : '';
  return taskTitle || null;
}

function mapDayDetailFromApi(detail: CompletionHeatmapDayDetail, ymd: string): CompletionHeatmapDayDetailData {
  return {
    frogItems: (detail.frogs ?? []).map((f, i) => ({
      id: f.task_id ? `${f.task_id}:${ymd}` : `frog-${i}`,
      task_id: f.task_id,
      assigned_ymd: detail.ymd?.trim() || ymd,
      task_title: f.task_title?.trim() || null,
    })),
    todoItems: (detail.todos ?? []).map((t) => ({
      id: t.id,
      task_id: t.task_id ?? '',
      action: 'completed',
      created_at: `${detail.ymd?.trim() || ymd}T12:00:00.000Z`,
      task_title: readTodoTitle(t as CompletionHeatmapDayDetailTodo & Record<string, unknown>),
    })),
  };
}

/**
 * 完成热力图（画格子）：`GET /api/pages/tasks/completion-heatmap`
 * 使用 `countsByDay` 中的 `frogs` / `todos` 字段。
 */
export async function fetchCompletionHeatmap(opts: HeatmapRequestOpts): Promise<CompletionHeatmapData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const { heatmapStart, heatmapEnd, signal } = opts;

  throwIfAborted(signal);
  const payload = await apiGetTasksCompletionHeatmap({
    dayBoundaryHour: boundary.hour,
    dayBoundaryMinute: boundary.minute,
    heatmapStart,
    heatmapEnd,
    signal,
  });
  const { frogCountByYmd, todoCountByYmd } = countsRecordToMaps(payload.countsByDay ?? {});
  return {
    frogCountByYmd,
    todoCountByYmd,
    meta: payload.meta ?? {},
  };
}

/**
 * 点击某一天：`GET /api/pages/tasks/completion-heatmap?day=YYYY-MM-DD&...`
 * 读 `dayDetail.todos`（不是 overview 的 `dayDetail.events`）。
 * `heatmapStart` / `heatmapEnd` / 日界必须与首次加载热力图一致。
 */
export async function fetchCompletionHeatmapDayDetail(
  opts: HeatmapRequestOpts & { day: string },
): Promise<CompletionHeatmapDayDetailData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const ymd = opts.day.trim();
  const { heatmapStart, heatmapEnd, signal } = opts;

  throwIfAborted(signal);
  const payload = await apiGetTasksCompletionHeatmap({
    dayBoundaryHour: boundary.hour,
    dayBoundaryMinute: boundary.minute,
    heatmapStart,
    heatmapEnd,
    day: ymd,
    includeDayDetail: true,
    signal,
  });
  if (payload.dayDetail) {
    return mapDayDetailFromApi(payload.dayDetail, ymd);
  }
  return { frogItems: [], todoItems: [] };
}
