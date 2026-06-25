import {
  apiGetTasksList,
  type PageListMeta,
  type TasksListQueryParams,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';

const TASKS_LIST_PAGE_LIMIT = 500;

export type TasksListData = {
  tasks: TaskRow[];
  meta?: PageListMeta;
};

export type TasksListFetchOpts = Omit<TasksListQueryParams, 'page' | 'limit'> & {
  offlineFallback?: boolean;
  forceLocal?: boolean;
};

async function pullTasksListPage(
  query: TasksListQueryParams,
  page: number,
): Promise<{ list: Record<string, unknown>[]; totalPages: number; meta?: PageListMeta }> {
  const res = await apiGetTasksList({
    ...query,
    page,
    limit: TASKS_LIST_PAGE_LIMIT,
    signal: query.signal,
  });
  const totalPages =
    typeof res.pagination.totalPages === 'number' && res.pagination.totalPages > 0
      ? res.pagination.totalPages
      : 1;
  return { list: res.list, totalPages, meta: res.meta };
}

async function pullTasksListFromApi(query: TasksListQueryParams): Promise<TasksListData> {
  const merged: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  let meta: PageListMeta | undefined;

  while (page <= totalPages) {
    throwIfAborted(query.signal);
    const batch = await pullTasksListPage(query, page);
    if (page === 1) {
      meta = batch.meta;
      totalPages = batch.totalPages;
    }
    merged.push(...batch.list);
    page += 1;
  }

  if (merged.length > 0) {
    await withApiTableSyncLock('tasks', async () => {
      await syncApiReadResultToLocal('tasks', merged);
    });
  }

  return {
    tasks: sortByUpdatedDesc(merged as TaskRow[]),
    meta,
  };
}

async function readTasksListFromLocal(): Promise<TasksListData> {
  const tasks = await getTasks();
  return { tasks };
}

/**
 * 按任务分类拉取扁平任务列表：`GET /api/pages/tasks/list`。
 * 成功时写入本地 tasks 表；增量同步后若需合并视图请读 SQLite。
 */
export async function fetchTasksList(opts?: TasksListFetchOpts): Promise<TasksListData> {
  if (!opts?.forceLocal) {
    try {
      const { offlineFallback: _offlineFallback, forceLocal: _forceLocal, ...query } = opts ?? {};
      return await pullTasksListFromApi(query);
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[tasks-list-api] 接口失败，回退本地 SQLite', e);
    }
  }

  return readTasksListFromLocal();
}
