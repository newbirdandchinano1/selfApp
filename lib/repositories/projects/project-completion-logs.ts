import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { readApiTable } from '@/lib/api-read';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { parseRewardPointsFromExtraData } from '@/lib/reward-points';
import { getTagsByProjectId } from '@/lib/repositories/projects/project-tag';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getDatabase, type SyncStatus } from '../../database.native';

export type ProjectCompletionLogSource = 'archive' | 'compress' | 'manual_delete';

export type ProjectCompletionLogRow = {
  id: string;
  project_id: string | null;
  name: string;
  completed_ymd: string;
  completed_at: string;
  task_count: number;
  done_task_count: number;
  points_delta: number;
  tag_names: string | null;
  note: string | null;
  source: string;
  created_at: string;
  sync_status: SyncStatus;
};

export type InsertProjectCompletionLogInput = {
  projectId: string | null;
  name: string;
  completedYmd: string;
  completedAt?: string;
  taskCount?: number;
  doneTaskCount?: number;
  pointsDelta?: number;
  tagNames?: string[];
  note?: string | null;
  source?: ProjectCompletionLogSource;
};

const LOG_READ_OPTS = { offlineFallback: true, localOnly: true as const };
const NOTE_MAX_LEN = 500;

function truncateNote(note: string | null | undefined): string | null {
  const t = (note ?? '').trim();
  if (!t) return null;
  if (t.length <= NOTE_MAX_LEN) return t;
  return `${t.slice(0, NOTE_MAX_LEN)}…`;
}

function serializeTagNames(names: string[] | undefined): string | null {
  if (!names?.length) return null;
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

export function parseCompletionLogTagNames(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 是否已有该项目的履历（任意一条） */
export async function hasProjectCompletionLog(projectId: string): Promise<boolean> {
  const id = projectId.trim();
  if (!id) return false;
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM project_completion_logs
     WHERE project_id = ? AND sync_status != 'pending_delete'`,
    [id],
  );
  return Number(row?.c ?? 0) > 0;
}

export async function insertProjectCompletionLog(
  input: InsertProjectCompletionLogInput,
): Promise<string> {
  const name = input.name.trim() || '未命名项目';
  const ymd = input.completedYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('完成日格式无效');
  }

  const db = await getDatabase();
  const id = makeTimestampEntityId('pcl_', 8);
  const completedAt = input.completedAt?.trim() || formatTaskAuditDatetimeLocal();
  const createdAt = formatTaskAuditDatetimeLocal();
  await db.runAsync(
    `INSERT INTO project_completion_logs (
      id, project_id, name, completed_ymd, completed_at,
      task_count, done_task_count, points_delta, tag_names, note, source,
      created_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
    [
      id,
      input.projectId?.trim() || null,
      name,
      ymd,
      completedAt,
      Math.max(0, Math.round(input.taskCount ?? 0)),
      Math.max(0, Math.round(input.doneTaskCount ?? 0)),
      Number.isFinite(input.pointsDelta) ? Number(input.pointsDelta) : 0,
      serializeTagNames(input.tagNames),
      truncateNote(input.note),
      input.source ?? 'archive',
      createdAt,
    ],
  );

  invalidateInflightApiTableFetch('project_completion_logs');
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
  return id;
}

/**
 * 从项目行写入履历。若已有该 project_id 的履历且 skipIfExists，则跳过。
 * 返回是否新写入。
 */
export async function ensureProjectCompletionLogFromProject(
  project: ProjectRow,
  options: {
    completedYmd: string;
    taskCount?: number;
    doneTaskCount?: number;
    pointsDelta?: number;
    source?: ProjectCompletionLogSource;
    skipIfExists?: boolean;
  },
): Promise<boolean> {
  if (options.skipIfExists !== false && (await hasProjectCompletionLog(project.id))) {
    return false;
  }

  let tagNames: string[] = [];
  try {
    const tags = await getTagsByProjectId(project.id);
    tagNames = tags.map((t) => t.name);
  } catch {
    tagNames = [];
  }

  const pointsFromExtra = parseRewardPointsFromExtraData(project.extra_data);
  await insertProjectCompletionLog({
    projectId: project.id,
    name: project.name,
    completedYmd: options.completedYmd,
    taskCount: options.taskCount,
    doneTaskCount: options.doneTaskCount,
    pointsDelta: options.pointsDelta ?? pointsFromExtra,
    tagNames,
    note: project.note,
    source: options.source ?? 'archive',
  });
  return true;
}

/** 履历列表：完成日新→旧 */
export async function listProjectCompletionLogs(): Promise<ProjectCompletionLogRow[]> {
  const rows = await readApiTable<ProjectCompletionLogRow>('project_completion_logs', LOG_READ_OPTS);
  return rows
    .filter((r) => r.sync_status !== 'pending_delete')
    .sort((a, b) => {
      const ymdCmp = b.completed_ymd.localeCompare(a.completed_ymd);
      if (ymdCmp !== 0) return ymdCmp;
      return compareDatetimeDesc(a.completed_at, b.completed_at);
    });
}

/** 实体已删、仅剩履历的条目（用于收集箱「摘要」区） */
export async function listOrphanProjectCompletionLogs(
  existingProjectIds: Set<string> | string[],
): Promise<ProjectCompletionLogRow[]> {
  const alive = existingProjectIds instanceof Set ? existingProjectIds : new Set(existingProjectIds);
  const all = await listProjectCompletionLogs();
  const seenProject = new Set<string>();
  const out: ProjectCompletionLogRow[] = [];
  for (const log of all) {
    const pid = (log.project_id ?? '').trim();
    if (pid && alive.has(pid)) continue;
    // 同一已删项目多条履历时只展示最新一条
    if (pid) {
      if (seenProject.has(pid)) continue;
      seenProject.add(pid);
    }
    out.push(log);
  }
  return out;
}
