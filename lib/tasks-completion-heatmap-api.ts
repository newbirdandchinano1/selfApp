import {
  apiGetTasksCompletionHeatmap,
  type CompletionHeatmapDayDetail,
  type CompletionHeatmapDayCounts,
  type CompletionHeatmapDayDetailTodo,
} from '@/lib/api-client';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import {
  readFrogSubjectHints,
  resolveFrogItemAgainstProjects,
  type FrogHeatmapProjectHint,
} from '@/lib/open-frog-heatmap-item';
import { getFrogCompletionsForAssignedDay, getFrogCompletionCountsByDayRange } from '@/lib/repositories/tasks/frog-completion-events';
import type { FrogCompletionDayItem } from '@/lib/repositories/tasks/frog-completion-events';
import {
  getNetCompletedTaskEventsForLocalDay,
  getTaskCompletionCountsByDayRange,
  type TaskExecutionEventWithTitle,
} from '@/lib/repositories/tasks/task-execution-events';
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
  /** 用于把同名/同 id 的青蛙纠正为项目青蛙 */
  projects?: FrogHeatmapProjectHint[];
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

/** 青蛙完成与待办完成互斥展示：同一 task_id 已在青蛙区则不再计入待办区 */
export function dedupeHeatmapTodoItemsAgainstFrogs(
  frogItems: FrogCompletionDayItem[],
  todoItems: TaskExecutionEventWithTitle[],
): TaskExecutionEventWithTitle[] {
  const frogTaskIds = new Set(
    frogItems.map((f) => f.task_id?.trim()).filter((id): id is string => Boolean(id)),
  );
  if (frogTaskIds.size === 0) return todoItems;
  return todoItems.filter((t) => !frogTaskIds.has(t.task_id.trim()));
}

function applyProjectHints(
  frogItems: FrogCompletionDayItem[],
  projects: FrogHeatmapProjectHint[] | undefined,
): FrogCompletionDayItem[] {
  if (!projects?.length) return frogItems;
  return frogItems.map((item) => resolveFrogItemAgainstProjects(item, projects));
}

async function enrichFrogSubjects(
  frogItems: FrogCompletionDayItem[],
): Promise<FrogCompletionDayItem[]> {
  if (frogItems.length === 0) return frogItems;
  const ids = frogItems.map((f) => f.task_id?.trim()).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return frogItems;
  const { ensureLocalRowForWrite } = await import('@/lib/api-local-row');
  const resolved = await Promise.all(
    ids.map(async (id) => {
      if (id.startsWith('p_')) return [id, 'project' as const] as const;
      // 即使长得像任务 id，也先问项目表（接口可能误填）
      const asProject = await ensureLocalRowForWrite('projects', id);
      if (asProject) return [id, 'project' as const] as const;
      if (id.startsWith('tsk_') || id.startsWith('t_')) return [id, 'task' as const] as const;
      const asTask = await ensureLocalRowForWrite('tasks', id);
      if (asTask) return [id, 'task' as const] as const;
      return [id, undefined] as const;
    }),
  );
  const subjectById = new Map(resolved);
  return frogItems.map((f) => {
    if (f.subject === 'project') return f;
    const sid = f.task_id?.trim() ?? '';
    const subject = sid ? subjectById.get(sid) : undefined;
    return subject ? { ...f, subject } : f;
  });
}

/** 同一主体只保留一条；同名时优先保留项目青蛙 */
function dedupeFrogDayItems(items: FrogCompletionDayItem[]): FrogCompletionDayItem[] {
  const byId = new Map<string, FrogCompletionDayItem>();
  for (const item of items) {
    const key = item.task_id?.trim();
    if (!key) continue;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, item);
      continue;
    }
    const preferProject = item.subject === 'project' && prev.subject !== 'project';
    byId.set(key, {
      ...(preferProject ? item : prev),
      task_title:
        (preferProject ? item : prev).task_title?.trim() ||
        (preferProject ? prev : item).task_title?.trim() ||
        null,
      subject:
        prev.subject === 'project' || item.subject === 'project'
          ? 'project'
          : (prev.subject ?? item.subject),
    });
  }

  const list = [...byId.values()];
  const byTitle = new Map<string, FrogCompletionDayItem>();
  const noTitle: FrogCompletionDayItem[] = [];
  for (const item of list) {
    const titleKey = (item.task_title ?? '').trim().toLowerCase();
    if (!titleKey) {
      noTitle.push(item);
      continue;
    }
    const prev = byTitle.get(titleKey);
    if (!prev) {
      byTitle.set(titleKey, item);
      continue;
    }
    if (item.subject === 'project' && prev.subject !== 'project') {
      byTitle.set(titleKey, item);
    } else if (prev.subject !== 'project' && item.task_id?.startsWith('p_')) {
      byTitle.set(titleKey, { ...item, subject: 'project' });
    }
  }
  return [...byTitle.values(), ...noTitle];
}

function mapFrogRowsFromApi(
  detail: CompletionHeatmapDayDetail,
  ymd: string,
): FrogCompletionDayItem[] {
  return (detail.frogs ?? []).map((f, i) => {
    const raw = f as CompletionHeatmapDayDetail['frogs'][number] & Record<string, unknown>;
    const hints = readFrogSubjectHints(raw);
    const title =
      (typeof raw.task_title === 'string' && raw.task_title.trim()) ||
      (typeof raw.title === 'string' && raw.title.trim()) ||
      null;
    const subjectId = hints.subjectId ?? null;
    return {
      id: subjectId ? `${subjectId}:${ymd}` : `frog-${i}`,
      task_id: subjectId,
      assigned_ymd: detail.ymd?.trim() || ymd,
      task_title: title,
      subject: hints.subject,
    };
  });
}

async function mapDayDetailFromApi(
  detail: CompletionHeatmapDayDetail,
  ymd: string,
  projects?: FrogHeatmapProjectHint[],
): Promise<CompletionHeatmapDayDetailData> {
  const frogItems = dedupeFrogDayItems(
    applyProjectHints(await enrichFrogSubjects(mapFrogRowsFromApi(detail, ymd)), projects),
  );
  const todoItems = (detail.todos ?? []).map((t) => ({
    id: t.id,
    task_id: t.task_id ?? '',
    action: 'completed',
    created_at: `${detail.ymd?.trim() || ymd}T12:00:00.000Z`,
    task_title: readTodoTitle(t as CompletionHeatmapDayDetailTodo & Record<string, unknown>),
  }));
  return {
    frogItems,
    todoItems: dedupeHeatmapTodoItemsAgainstFrogs(frogItems, todoItems),
  };
}

async function fetchCompletionHeatmapDayDetailLocal(
  ymd: string,
  projects?: FrogHeatmapProjectHint[],
): Promise<CompletionHeatmapDayDetailData> {
  const [frogItemsRaw, todoItems] = await Promise.all([
    getFrogCompletionsForAssignedDay(ymd),
    getNetCompletedTaskEventsForLocalDay(ymd),
  ]);
  const frogItems = dedupeFrogDayItems(applyProjectHints(frogItemsRaw, projects));
  return {
    frogItems,
    todoItems: dedupeHeatmapTodoItemsAgainstFrogs(frogItems, todoItems),
  };
}

async function readCompletionHeatmapFromLocal(
  heatmapStart?: string,
  heatmapEnd?: string,
): Promise<Pick<CompletionHeatmapData, 'frogCountByYmd' | 'todoCountByYmd'>> {
  const [todoCountByYmd, frogCountByYmd] = await Promise.all([
    heatmapStart && heatmapEnd
      ? getTaskCompletionCountsByDayRange(heatmapStart, heatmapEnd)
      : Promise.resolve(new Map<string, number>()),
    heatmapStart && heatmapEnd
      ? getFrogCompletionCountsByDayRange(heatmapStart, heatmapEnd)
      : Promise.resolve(new Map<string, number>()),
  ]);
  return { frogCountByYmd, todoCountByYmd };
}

/**
 * 完成热力图：优先专用接口计数（含待办净完成）。
 * 接口失败时才回退本地事件表。
 */
export async function fetchCompletionHeatmap(opts: HeatmapRequestOpts): Promise<CompletionHeatmapData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const { heatmapStart, heatmapEnd, signal } = opts;

  throwIfAborted(signal);
  try {
    const payload = await apiGetTasksCompletionHeatmap({
      dayBoundaryHour: boundary.hour,
      dayBoundaryMinute: boundary.minute,
      heatmapStart,
      heatmapEnd,
      signal,
    });
    const apiCounts = countsRecordToMaps(payload.countsByDay ?? {});
    return {
      frogCountByYmd: apiCounts.frogCountByYmd,
      todoCountByYmd: apiCounts.todoCountByYmd,
      meta: payload.meta ?? {},
    };
  } catch (e) {
    console.warn('[completion-heatmap] 接口失败，回退本地', e);
    const local = await readCompletionHeatmapFromLocal(heatmapStart, heatmapEnd);
    return {
      frogCountByYmd: local.frogCountByYmd,
      todoCountByYmd: local.todoCountByYmd,
      meta: {},
    };
  }
}

/**
 * 点击某一天：优先专用接口明细；并用本地项目列表纠正项目青蛙的 id/跳转。
 * 同时与本地青蛙事件按标题合并，避免接口把 project id 错填成无效 task id。
 */
export async function fetchCompletionHeatmapDayDetail(
  opts: HeatmapRequestOpts & { day: string },
): Promise<CompletionHeatmapDayDetailData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const ymd = opts.day.trim();
  const { heatmapStart, heatmapEnd, signal, projects } = opts;

  throwIfAborted(signal);
  const local = await fetchCompletionHeatmapDayDetailLocal(ymd, projects);
  try {
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
      const fromApi = await mapDayDetailFromApi(payload.dayDetail, ymd, projects);
      const frogItems = dedupeFrogDayItems(
        applyProjectHints([...fromApi.frogItems, ...local.frogItems], projects),
      );
      return {
        frogItems,
        todoItems: dedupeHeatmapTodoItemsAgainstFrogs(frogItems, fromApi.todoItems),
      };
    }
  } catch (e) {
    console.warn('[completion-heatmap] 日明细接口失败，回退本地', e);
  }
  return local;
}
