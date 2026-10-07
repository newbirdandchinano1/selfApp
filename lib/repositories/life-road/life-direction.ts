/**
 * 总方向仓库：读写走服务器权威（API 成功后再写 SQLite 缓存）。
 * 单用户语境：App 只维护 updated_at 最新且未删除的一条。
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
  LifeRoadValidationError,
  trimOptionalText,
  trimRequiredText,
} from '@/lib/life-road/life-road-limits';
import { attachPushOccFields, newMutationId } from '@/lib/sync-write-meta';
import type {
  LifeDirectionRow,
  UpdateLifeDirectionInput,
  UpsertLifeDirectionInput,
} from './life-direction.types';

const TABLE = 'life_directions';

function createLifeDirectionId(): string {
  return makeTimestampEntityId('ld_', 8);
}

function mapDirectionRow(row: Record<string, unknown>): LifeDirectionRow {
  return {
    id: String(row.id ?? ''),
    body: String(row.body ?? ''),
    year_theme:
      row.year_theme == null || row.year_theme === '' ? null : String(row.year_theme),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    sync_status: (row.sync_status as LifeDirectionRow['sync_status']) ?? 'synced',
    extra_data:
      row.extra_data == null || row.extra_data === '' ? null : String(row.extra_data),
    server_rev: row.server_rev == null ? null : Number(row.server_rev),
    mutation_id: row.mutation_id == null ? null : String(row.mutation_id),
    last_pushed_mutation_id:
      row.last_pushed_mutation_id == null ? null : String(row.last_pushed_mutation_id),
  };
}

/** 本地缓存：最新一条未软删方向 */
export async function getLifeDirectionLocal(): Promise<LifeDirectionRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${TABLE}
     WHERE sync_status != 'pending_delete'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  return row ? mapDirectionRow(row) : null;
}

/** 按 id 读；优先本地，可 serverFallback */
export async function getLifeDirectionById(
  id: string,
  opts?: { serverFallback?: boolean },
): Promise<LifeDirectionRow | null> {
  const pk = id.trim();
  if (!pk) return null;
  const row = await readApiRecord<Record<string, unknown>>(TABLE, pk, {
    serverFallback: opts?.serverFallback ?? true,
  });
  return row ? mapDirectionRow(row) : null;
}

/**
 * 拉取方向列表并灌缓存，返回最新一条。
 * @param opts.cacheOnly 仅读本地
 */
export async function getLifeDirection(opts?: {
  cacheOnly?: boolean;
  serverFallback?: boolean;
}): Promise<LifeDirectionRow | null> {
  if (!opts?.cacheOnly) {
    try {
      await readApiTable<Record<string, unknown>>(TABLE, {
        serverFallback: opts?.serverFallback ?? true,
      });
    } catch (e) {
      if (__DEV__) console.warn('[life-direction] readApiTable failed', e);
      if (opts?.serverFallback === false) throw e;
    }
  }
  return getLifeDirectionLocal();
}

/**
 * 写入总方向：已有最新行则 PATCH，否则 POST。
 * 失败不写本地「已保存」假行。
 */
export async function upsertLifeDirection(
  input: UpsertLifeDirectionInput,
): Promise<LifeDirectionRow> {
  const body = trimRequiredText(input.body, '总方向', 200);
  const yearTheme =
    input.year_theme !== undefined
      ? trimOptionalText(input.year_theme, '年主题', 40)
      : undefined;
  const extraData =
    input.extra_data !== undefined
      ? input.extra_data?.trim()
        ? input.extra_data.trim()
        : null
      : undefined;

  const existing =
    input.id?.trim()
      ? await getLifeDirectionById(input.id.trim(), { serverFallback: true })
      : await getLifeDirectionLocal();

  if (existing) {
    const patch: Record<string, unknown> = {
      body,
      updated_at: formatWallClockDatetimeLocal(new Date()),
    };
    if (yearTheme !== undefined) patch.year_theme = yearTheme;
    if (extraData !== undefined) patch.extra_data = extraData;
    const withOcc = attachPushOccFields({
      ...patch,
      server_rev: existing.server_rev,
    });
    const cached = await patchViaApiThenCache(TABLE, existing.id, withOcc);
    return mapDirectionRow(cached);
  }

  const id = input.id?.trim() || createLifeDirectionId();
  const now = formatWallClockDatetimeLocal(new Date());
  const row: Record<string, unknown> = {
    id,
    body,
    year_theme: yearTheme ?? null,
    extra_data: extraData ?? null,
    created_at: now,
    updated_at: now,
    mutation_id: newMutationId(),
  };
  const cached = await createViaApiThenCache(TABLE, row);
  return mapDirectionRow(cached);
}

/** 更新已有方向行 */
export async function updateLifeDirection(
  id: string,
  input: UpdateLifeDirectionInput,
): Promise<LifeDirectionRow> {
  const pk = id.trim();
  if (!pk) throw new LifeRoadValidationError('方向 id 无效');
  const existing = await getLifeDirectionById(pk, { serverFallback: true });
  if (!existing) throw new LifeRoadValidationError('总方向不存在');

  const patch: Record<string, unknown> = {
    updated_at: formatWallClockDatetimeLocal(new Date()),
  };
  if (input.body !== undefined) {
    patch.body = trimRequiredText(input.body, '总方向', 200);
  }
  if (input.year_theme !== undefined) {
    patch.year_theme = trimOptionalText(input.year_theme, '年主题', 40);
  }
  if (input.extra_data !== undefined) {
    patch.extra_data = input.extra_data?.trim() ? input.extra_data.trim() : null;
  }
  if (Object.keys(patch).length <= 1) {
    throw new LifeRoadValidationError('没有可更新的字段');
  }
  const withOcc = attachPushOccFields({ ...patch, server_rev: existing.server_rev });
  const cached = await patchViaApiThenCache(TABLE, pk, withOcc);
  return mapDirectionRow(cached);
}

/** 删除方向（服务端成功后再清缓存） */
export async function deleteLifeDirection(id: string): Promise<void> {
  const pk = id.trim();
  if (!pk) throw new LifeRoadValidationError('方向 id 无效');
  const existing = await getLifeDirectionLocal();
  const expectedRev =
    existing?.id === pk ? (existing.server_rev ?? null) : null;
  await deleteViaApiThenCache(TABLE, pk, {
    expectedRev,
    mutationId: newMutationId(),
  });
}
