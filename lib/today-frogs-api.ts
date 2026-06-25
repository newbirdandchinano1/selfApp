import { apiGetTodayFrogs } from '@/lib/api-client';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getFrogAssignedOn } from '@/lib/frog-assignment';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';

export type TodayFrogsResult = {
  logicalToday: string;
  tasks: TaskRow[];
};

function sortTodayFrogRows(rows: TaskRow[], logicalToday: string): TaskRow[] {
  return rows.slice().sort((a, b) => {
    const doneA = isFrogDoneForToday(a.extra_data, a.status, logicalToday);
    const doneB = isFrogDoneForToday(b.extra_data, b.status, logicalToday);
    if (doneA !== doneB) return doneA ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const updA = a.updated_at ? Date.parse(a.updated_at) : 0;
    const updB = b.updated_at ? Date.parse(b.updated_at) : 0;
    return updB - updA;
  });
}

export function filterTodayFrogsLocally(tasks: TaskRow[], logicalToday: string): TaskRow[] {
  return sortTodayFrogRows(
    tasks.filter((t) => getFrogAssignedOn(t.extra_data) === logicalToday),
    logicalToday,
  );
}

async function resolveLogicalToday(boundary?: TasksDayBoundary): Promise<{ boundary: TasksDayBoundary; logicalToday: string }> {
  const resolved = boundary ?? (await loadTasksDayBoundary());
  return {
    boundary: resolved,
    logicalToday: getLogicalLocalYmd(new Date(), resolved),
  };
}

/** 拉取今日青蛙：优先 REST，失败或仅本地时回退 SQLite 过滤 */
export async function fetchTodayFrogs(opts?: {
  boundary?: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<TodayFrogsResult> {
  const { boundary, logicalToday } = await resolveLogicalToday(opts?.boundary);
  const skipNetwork = opts?.forceLocal || Boolean(getActivePageApiReadOpts()?.localOnly);

  if (!skipNetwork) {
    try {
      const data = await apiGetTodayFrogs({
        dayBoundaryHour: boundary.hour,
        dayBoundaryMinute: boundary.minute,
        signal: opts?.signal,
      });
      const rows = (Array.isArray(data.tasks) ? data.tasks : []) as TaskRow[];
      if (rows.length > 0) {
        await syncApiReadResultToLocal('tasks', rows as Record<string, unknown>[]);
      }
      return {
        logicalToday: data.logicalToday?.trim() || logicalToday,
        tasks: rows,
      };
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[today-frogs] 接口失败，回退本地过滤', e);
    }
  }

  const allTasks = await getTasks();
  return {
    logicalToday,
    tasks: filterTodayFrogsLocally(allTasks, logicalToday),
  };
}
