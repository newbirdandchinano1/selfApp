import { apiGetTasksCompletionHeatmap, type CompletionHeatmapDayCounts } from '@/lib/api-client';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import type { FrogCompletionDayItem } from '@/lib/repositories/tasks/frog-completion-events';
import { getFrogCompletionCountsByDayRange } from '@/lib/repositories/tasks/frog-completion-events';
import type { TaskExecutionEventWithTitle } from '@/lib/repositories/tasks/task-execution-events';
import {
  getNetCompletedTaskEventsForLocalDay,
  getTaskCompletionCountsByDayRange,
} from '@/lib/repositories/tasks/task-execution-events';
import { getFrogCompletionsForAssignedDay } from '@/lib/repositories/tasks/frog-completion-events';
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

function countsRecordToMaps(countsByDay: Record<string, CompletionHeatmapDayCounts>): {
  frogCountByYmd: Map<string, number>;
  todoCountByYmd: Map<string, number>;
} {
  const frogCountByYmd = new Map<string, number>();
  const todoCountByYmd = new Map<string, number>();
  for (const [ymd, row] of Object.entries(countsByDay ?? {})) {
    if (!ymd) continue;
    frogCountByYmd.set(ymd, row?.frogs ?? 0);
    todoCountByYmd.set(ymd, row?.todos ?? 0);
  }
  return { frogCountByYmd, todoCountByYmd };
}

async function readCompletionHeatmapFromLocal(
  startYmd: string,
  endYmd: string,
): Promise<CompletionHeatmapData> {
  const [frogCounts, todoCounts] = await Promise.all([
    getFrogCompletionCountsByDayRange(startYmd, endYmd),
    getTaskCompletionCountsByDayRange(startYmd, endYmd),
  ]);
  return {
    frogCountByYmd: frogCounts,
    todoCountByYmd: todoCounts,
    meta: { heatmapStart: startYmd, heatmapEnd: endYmd },
  };
}

/** 完成热力图：`GET /api/pages/tasks/completion-heatmap` */
export async function fetchCompletionHeatmap(opts: {
  boundary?: TasksDayBoundary;
  heatmapStart?: string;
  heatmapEnd?: string;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<CompletionHeatmapData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const { heatmapStart, heatmapEnd, offlineFallback, forceLocal, signal } = opts;

  if (!forceLocal) {
    try {
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
    } catch (e) {
      if (!offlineFallback) throw e;
      console.warn('[tasks-completion-heatmap-api] 接口失败，回退本地 SQLite', e);
    }
  }

  if (heatmapStart && heatmapEnd) {
    return readCompletionHeatmapFromLocal(heatmapStart, heatmapEnd);
  }
  return { frogCountByYmd: new Map(), todoCountByYmd: new Map(), meta: {} };
}

/** 选中日明细：`GET /api/pages/tasks/completion-heatmap?day=&includeDayDetail=true` */
export async function fetchCompletionHeatmapDayDetail(opts: {
  day: string;
  boundary?: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<CompletionHeatmapDayDetailData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const ymd = opts.day.trim();

  if (!opts.forceLocal) {
    try {
      throwIfAborted(opts.signal);
      const payload = await apiGetTasksCompletionHeatmap({
        dayBoundaryHour: boundary.hour,
        dayBoundaryMinute: boundary.minute,
        day: ymd,
        includeDayDetail: true,
        signal: opts.signal,
      });
      const detail = payload.dayDetail;
      if (detail) {
        return {
          frogItems: (detail.frogs ?? []).map((f, i) => ({
            id: f.task_id ? `${f.task_id}:${ymd}` : `frog-${i}`,
            task_id: f.task_id,
            assigned_ymd: ymd,
            task_title: f.task_title ?? null,
          })),
          todoItems: (detail.todos ?? []).map((t) => ({
            id: t.id,
            task_id: t.task_id ?? '',
            action: 'completed',
            created_at: `${ymd}T12:00:00.000Z`,
            task_title: t.title ?? null,
          })),
        };
      }
    } catch (e) {
      if (!opts.offlineFallback) throw e;
      console.warn('[tasks-completion-heatmap-api] 日明细接口失败，回退本地', e);
    }
  }

  const [frogItems, todoItems] = await Promise.all([
    getFrogCompletionsForAssignedDay(ymd),
    getNetCompletedTaskEventsForLocalDay(ymd),
  ]);
  return { frogItems, todoItems };
}
