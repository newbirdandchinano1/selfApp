/**
 * 道路派生查询：进行中项目数 / 最近完成名 / 空窗。只读本地 SQLite，不落表。
 */
import { getDatabase } from '@/lib/database';

export type LifeBetDerivedStats = {
  activeProjectCount: number | null;
  latestCompletedName: string | null;
  /** 状态为在路上且进行中项目数为 0 */
  isEmptyWindow: boolean;
};

/** 关联且未软删、status ∈ active|paused 的项目数；查询失败返回 null（UI 显示 —） */
export async function countActiveProjectsForLifeBet(lifeBetId: string): Promise<number | null> {
  const id = lifeBetId.trim();
  if (!id) return null;
  try {
    const db = await getDatabase();
    if (!db) return null;
    const row = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM projects
       WHERE life_bet_id = ?
         AND sync_status != 'pending_delete'
         AND status IN ('active', 'paused')`,
      [id],
    );
    const n = Number(row?.cnt ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    if (__DEV__) console.warn('[life-road-derived] countActiveProjects failed', id, e);
    return null;
  }
}

/** 最近一条 completed|archived 项目名；无则 null */
export async function getLatestCompletedProjectNameForLifeBet(
  lifeBetId: string,
): Promise<string | null> {
  const id = lifeBetId.trim();
  if (!id) return null;
  try {
    const db = await getDatabase();
    if (!db) return null;
    const row = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM projects
       WHERE life_bet_id = ?
         AND sync_status != 'pending_delete'
         AND status IN ('completed', 'archived')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [id],
    );
    const name = row?.name != null ? String(row.name).trim() : '';
    return name || null;
  } catch (e) {
    if (__DEV__) console.warn('[life-road-derived] latestCompleted failed', id, e);
    return null;
  }
}

export type LifeBetActiveProjectRef = { id: string; name: string };

/** 进行中项目列表（最多 limit 条，按 updated_at 降序；含 id 供道路页点进编辑） */
export async function listActiveProjectsForLifeBet(
  lifeBetId: string,
  limit = 3,
): Promise<{ projects: LifeBetActiveProjectRef[]; total: number } | null> {
  const id = lifeBetId.trim();
  if (!id) return null;
  try {
    const db = await getDatabase();
    if (!db) return null;
    const totalRow = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM projects
       WHERE life_bet_id = ?
         AND sync_status != 'pending_delete'
         AND status IN ('active', 'paused')`,
      [id],
    );
    const total = Number(totalRow?.cnt ?? 0);
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      `SELECT id, name FROM projects
       WHERE life_bet_id = ?
         AND sync_status != 'pending_delete'
         AND status IN ('active', 'paused')
       ORDER BY updated_at DESC
       LIMIT ?`,
      [id, Math.max(0, limit)],
    );
    const projects = (rows ?? [])
      .map((r) => ({
        id: String(r.id ?? '').trim(),
        name: String(r.name ?? '').trim(),
      }))
      .filter((p) => p.id && p.name);
    return { projects, total: Number.isFinite(total) ? total : projects.length };
  } catch (e) {
    if (__DEV__) console.warn('[life-road-derived] listActiveProjects failed', id, e);
    return null;
  }
}

/** @deprecated 用 listActiveProjectsForLifeBet；保留名称兼容 */
export async function listActiveProjectNamesForLifeBet(
  lifeBetId: string,
  limit = 3,
): Promise<{ names: string[]; total: number } | null> {
  const result = await listActiveProjectsForLifeBet(lifeBetId, limit);
  if (!result) return null;
  return { names: result.projects.map((p) => p.name), total: result.total };
}

/**
 * 单条赌注派生摘要。
 * @param betStatus 用于空窗判定；非 on_track 则 isEmptyWindow=false
 */
export async function getLifeBetDerivedStats(
  lifeBetId: string,
  betStatus: string,
): Promise<LifeBetDerivedStats> {
  const activeProjectCount = await countActiveProjectsForLifeBet(lifeBetId);
  const latestCompletedName = await getLatestCompletedProjectNameForLifeBet(lifeBetId);
  const isEmptyWindow =
    betStatus === 'on_track' && activeProjectCount !== null && activeProjectCount === 0;
  return { activeProjectCount, latestCompletedName, isEmptyWindow };
}
