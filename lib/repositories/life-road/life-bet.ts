/**
 * 道路赌注仓库：API-then-cache；创建/更新前本地先拦今年进行中 ≤ 5。
 */
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import {
  createViaApiThenCache,
  deleteViaApiThenCache,
  patchViaApiThenCache,
} from '@/lib/api-write-cache';
import { getDatabase } from '@/lib/database';
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  assertLifeBetYearRulesMerged,
  currentCalendarYear,
  isActiveLifeBetStatus,
  LifeRoadValidationError,
  parseLifeBetHorizon,
  parseLifeBetStatus,
  parseLifeBetYear,
  parseSortOrder,
  trimOptionalText,
  trimRequiredText,
} from '@/lib/life-road/life-road-limits';
import { attachPushOccFields, newMutationId } from '@/lib/sync-write-meta';
import type { CreateLifeBetInput, LifeBetRow, UpdateLifeBetInput } from './life-bet.types';

const TABLE = 'life_bets';

function createLifeBetId(): string {
  return makeTimestampEntityId('lb_', 8);
}

function mapLifeBetRow(row: Record<string, unknown>): LifeBetRow {
  const yearRaw = row.year;
  let year: number | null = null;
  if (yearRaw != null && yearRaw !== '') {
    const n = typeof yearRaw === 'number' ? yearRaw : Number(yearRaw);
    year = Number.isFinite(n) ? n : null;
  }
  const horizonRaw = String(row.horizon ?? 'year').trim();
  const horizon =
    horizonRaw === 'multi' || horizonRaw === 'farther' || horizonRaw === 'year'
      ? horizonRaw
      : 'year';
  const statusRaw = String(row.status ?? 'on_track').trim();
  const status =
    statusRaw === 'paused' ||
    statusRaw === 'arrived' ||
    statusRaw === 'dropped' ||
    statusRaw === 'on_track'
      ? statusRaw
      : 'on_track';
  let sortOrder = 1000;
  try {
    sortOrder = parseSortOrder(row.sort_order, 1000);
  } catch {
    sortOrder = 1000;
  }
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    horizon,
    year,
    note: row.note == null || row.note === '' ? null : String(row.note),
    status,
    sort_order: sortOrder,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    sync_status: (row.sync_status as LifeBetRow['sync_status']) ?? 'synced',
    extra_data:
      row.extra_data == null || row.extra_data === '' ? null : String(row.extra_data),
    server_rev: row.server_rev == null ? null : Number(row.server_rev),
    mutation_id: row.mutation_id == null ? null : String(row.mutation_id),
    last_pushed_mutation_id:
      row.last_pushed_mutation_id == null ? null : String(row.last_pushed_mutation_id),
  };
}

/** 本地可见赌注，按 horizon/year/sort_order */
export async function getLifeBetsLocal(): Promise<LifeBetRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${TABLE}
     WHERE sync_status != 'pending_delete'
     ORDER BY
       CASE horizon WHEN 'year' THEN 0 WHEN 'multi' THEN 1 ELSE 2 END,
       year DESC,
       sort_order ASC,
       updated_at DESC`,
  );
  return (rows ?? []).map(mapLifeBetRow);
}

export async function getLifeBetById(
  id: string,
  opts?: { serverFallback?: boolean },
): Promise<LifeBetRow | null> {
  const pk = id.trim();
  if (!pk) return null;
  const row = await readApiRecord<Record<string, unknown>>(TABLE, pk, {
    serverFallback: opts?.serverFallback ?? true,
  });
  return row ? mapLifeBetRow(row) : null;
}

/**
 * 列表：默认先 REST 灌缓存再读本地。
 */
export async function getLifeBets(opts?: {
  cacheOnly?: boolean;
  serverFallback?: boolean;
}): Promise<LifeBetRow[]> {
  if (!opts?.cacheOnly) {
    try {
      await readApiTable<Record<string, unknown>>(TABLE, {
        serverFallback: opts?.serverFallback ?? true,
      });
    } catch (e) {
      if (__DEV__) console.warn('[life-bet] readApiTable failed', e);
      if (opts?.serverFallback === false) throw e;
    }
  }
  return getLifeBetsLocal();
}

/** 同 year 下进行中（on_track|paused）条数，可选排除 id */
export async function countActiveYearBetsLocal(
  year: number,
  excludeId?: string,
): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  const params: (string | number)[] = [year];
  let excludeSql = '';
  if (excludeId?.trim()) {
    excludeSql = ' AND id != ?';
    params.push(excludeId.trim());
  }
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ${TABLE}
     WHERE horizon = 'year'
       AND year = ?
       AND status IN ('on_track', 'paused')
       AND sync_status != 'pending_delete'
       ${excludeSql}`,
    params,
  );
  return Number(row?.cnt ?? 0);
}

async function assertClientYearLimit(merged: {
  horizon: ReturnType<typeof parseLifeBetHorizon>;
  year: number | null;
  status: ReturnType<typeof parseLifeBetStatus>;
  excludeId?: string;
}): Promise<void> {
  let activeCount = 0;
  if (
    merged.horizon === 'year' &&
    merged.year != null &&
    isActiveLifeBetStatus(merged.status)
  ) {
    activeCount = await countActiveYearBetsLocal(merged.year, merged.excludeId);
  }
  assertLifeBetYearRulesMerged({
    horizon: merged.horizon,
    year: merged.year,
    status: merged.status,
    activeCountSameYear: activeCount,
  });
}

/** 创建赌注；失败不落本地假行 */
export async function createLifeBet(input: CreateLifeBetInput): Promise<LifeBetRow> {
  const title = trimRequiredText(input.title, '标题', 40);
  const horizon = parseLifeBetHorizon(input.horizon);
  let year =
    input.year !== undefined ? parseLifeBetYear(input.year) : horizon === 'year' ? currentCalendarYear() : null;
  if (horizon === 'year' && year == null) {
    year = currentCalendarYear();
  }
  const note = trimOptionalText(input.note, '说明', 200);
  const status = parseLifeBetStatus(input.status ?? 'on_track');
  const sortOrder = parseSortOrder(input.sort_order, 1000);
  const extraData = input.extra_data?.trim() ? input.extra_data.trim() : null;

  await assertClientYearLimit({ horizon, year, status });

  const id = input.id?.trim() || createLifeBetId();
  const now = formatWallClockDatetimeLocal(new Date());
  const row: Record<string, unknown> = {
    id,
    title,
    horizon,
    year,
    note,
    status,
    sort_order: sortOrder,
    extra_data: extraData,
    created_at: now,
    updated_at: now,
    mutation_id: newMutationId(),
  };
  try {
    const cached = await createViaApiThenCache(TABLE, row);
    return mapLifeBetRow(cached);
  } catch (e) {
    if (__DEV__) console.warn('[life-bet] create failed', e);
    throw e;
  }
}

/** 更新赌注 */
export async function updateLifeBet(
  id: string,
  input: UpdateLifeBetInput,
): Promise<LifeBetRow> {
  const pk = id.trim();
  if (!pk) throw new LifeRoadValidationError('赌注 id 无效');
  const existing = await getLifeBetById(pk, { serverFallback: true });
  if (!existing) throw new LifeRoadValidationError('道路赌注不存在');

  const title =
    input.title !== undefined ? trimRequiredText(input.title, '标题', 40) : existing.title;
  const horizon =
    input.horizon !== undefined ? parseLifeBetHorizon(input.horizon) : existing.horizon;
  let year =
    input.year !== undefined ? parseLifeBetYear(input.year) : existing.year;
  if (horizon === 'year' && year == null) {
    throw new LifeRoadValidationError('「今年」桶必须填写公历年');
  }
  const note =
    input.note !== undefined ? trimOptionalText(input.note, '说明', 200) : existing.note;
  const status =
    input.status !== undefined ? parseLifeBetStatus(input.status) : existing.status;
  const sortOrder =
    input.sort_order !== undefined
      ? parseSortOrder(input.sort_order, existing.sort_order)
      : existing.sort_order;
  const extraData =
    input.extra_data !== undefined
      ? input.extra_data?.trim()
        ? input.extra_data.trim()
        : null
      : existing.extra_data;

  await assertClientYearLimit({ horizon, year, status, excludeId: pk });

  const patch = attachPushOccFields({
    title,
    horizon,
    year,
    note,
    status,
    sort_order: sortOrder,
    extra_data: extraData,
    updated_at: formatWallClockDatetimeLocal(new Date()),
    server_rev: existing.server_rev,
  });
  try {
    const cached = await patchViaApiThenCache(TABLE, pk, patch);
    return mapLifeBetRow(cached);
  } catch (e) {
    if (__DEV__) console.warn('[life-bet] update failed', e);
    throw e;
  }
}

/**
 * 删除赌注：先将关联项目 life_bet_id 置空，再删赌注。
 * 项目不会被删除。
 */
export async function deleteLifeBet(id: string): Promise<void> {
  const pk = id.trim();
  if (!pk) throw new LifeRoadValidationError('赌注 id 无效');

  const db = await getDatabase();
  if (!db) throw new LifeRoadValidationError('本地数据库不可用');

  const linked = await db.getAllAsync<{ id: string; server_rev?: number | null }>(
    `SELECT id, server_rev FROM projects
     WHERE life_bet_id = ?
       AND sync_status != 'pending_delete'`,
    [pk],
  );

  for (const proj of linked ?? []) {
    const projectId = String(proj.id ?? '').trim();
    if (!projectId) continue;
    try {
      const patch = attachPushOccFields({
        life_bet_id: null,
        updated_at: formatWallClockDatetimeLocal(new Date()),
        server_rev: proj.server_rev,
      });
      await patchViaApiThenCache('projects', projectId, patch);
    } catch (e) {
      if (__DEV__) console.warn('[life-bet] clear project life_bet_id failed', projectId, e);
      throw new Error('取消项目归属失败，请检查网络后重试');
    }
  }

  const existing = await getLifeBetById(pk, { serverFallback: true });
  await deleteViaApiThenCache(TABLE, pk, {
    expectedRev: existing?.server_rev ?? null,
    mutationId: newMutationId(),
  });
}
