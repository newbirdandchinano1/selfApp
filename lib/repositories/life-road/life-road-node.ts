/**
 * 道路年季月节点仓库：API-then-cache；同槽唯一（一年 / 一季 / 一月各一条内容）。
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
  assertLifeRoadNodeShape,
  currentCalendarYear,
  LIFE_ROAD_NOTE_MAX,
  LIFE_ROAD_TITLE_MAX,
  LifeRoadValidationError,
  monthToQuarter,
  parseCalendarYear,
  parseLifeRoadNodeKind,
  parseLifeRoadNodeStatus,
  parseMonth,
  parseQuarter,
  parseSortOrder,
  trimOptionalText,
  trimRequiredText,
  type LifeRoadNodeKind,
} from '@/lib/life-road/life-road-node-model';
import { attachPushOccFields, newMutationId } from '@/lib/sync-write-meta';
import type {
  CreateLifeRoadNodeInput,
  LifeRoadNodeRow,
  UpdateLifeRoadNodeInput,
} from './life-road-node.types';

const TABLE = 'life_road_nodes';

function createNodeId(): string {
  return makeTimestampEntityId('lrn_', 8);
}

function mapNodeRow(row: Record<string, unknown>): LifeRoadNodeRow {
  const kind = parseLifeRoadNodeKind(row.kind ?? 'year');
  let calendarYear: number | null = null;
  try {
    calendarYear = parseCalendarYear(row.calendar_year);
  } catch {
    calendarYear = null;
  }
  let quarter: number | null = null;
  try {
    quarter = parseQuarter(row.quarter);
  } catch {
    quarter = null;
  }
  let month: number | null = null;
  try {
    month = parseMonth(row.month);
  } catch {
    month = null;
  }
  let sortOrder = 1000;
  try {
    sortOrder = parseSortOrder(row.sort_order, 1000);
  } catch {
    sortOrder = 1000;
  }
  return {
    id: String(row.id ?? ''),
    kind,
    title: String(row.title ?? ''),
    note: row.note == null || row.note === '' ? null : String(row.note),
    calendar_year: calendarYear,
    quarter,
    month,
    parent_id:
      row.parent_id == null || row.parent_id === '' ? null : String(row.parent_id),
    status: parseLifeRoadNodeStatus(row.status ?? 'on_track'),
    sort_order: sortOrder,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    sync_status: (row.sync_status as LifeRoadNodeRow['sync_status']) ?? 'synced',
    extra_data:
      row.extra_data == null || row.extra_data === '' ? null : String(row.extra_data),
    server_rev: row.server_rev == null ? null : Number(row.server_rev),
    mutation_id: row.mutation_id == null ? null : String(row.mutation_id),
    last_pushed_mutation_id:
      row.last_pushed_mutation_id == null
        ? null
        : String(row.last_pushed_mutation_id),
  };
}

function normalizeShapeFields(input: {
  kind: LifeRoadNodeKind;
  calendar_year?: number | null;
  quarter?: number | null;
  month?: number | null;
  parent_id?: string | null;
}): {
  calendar_year: number | null;
  quarter: number | null;
  month: number | null;
  parent_id: string | null;
} {
  let calendar_year =
    input.calendar_year !== undefined
      ? parseCalendarYear(input.calendar_year)
      : null;
  let quarter =
    input.quarter !== undefined ? parseQuarter(input.quarter) : null;
  let month = input.month !== undefined ? parseMonth(input.month) : null;
  const parent_id = input.parent_id?.trim() ? input.parent_id.trim() : null;

  if (input.kind === 'year' || input.kind === 'quarter' || input.kind === 'month') {
    if (calendar_year == null) calendar_year = currentCalendarYear();
  }
  if (input.kind === 'month' && month != null) {
    quarter = monthToQuarter(month);
  }
  if (input.kind === 'multi' || input.kind === 'farther') {
    calendar_year = null;
    quarter = null;
    month = null;
  }
  if (input.kind === 'year') {
    quarter = null;
    month = null;
  }
  if (input.kind === 'quarter') {
    month = null;
  }

  assertLifeRoadNodeShape({
    kind: input.kind,
    calendar_year,
    quarter,
    month,
    parent_id: input.kind === 'year' || input.kind === 'multi' || input.kind === 'farther'
      ? null
      : parent_id,
  });

  return {
    calendar_year,
    quarter,
    month,
    parent_id:
      input.kind === 'year' || input.kind === 'multi' || input.kind === 'farther'
        ? null
        : parent_id,
  };
}

/** 同槽已有内容（排除自身）则拒绝，保证一格一条 */
async function assertSlotUnique(merged: {
  kind: LifeRoadNodeKind;
  calendar_year: number | null;
  quarter: number | null;
  month: number | null;
  excludeId?: string;
}): Promise<void> {
  if (merged.kind === 'multi' || merged.kind === 'farther') return;
  const db = await getDatabase();
  if (!db) return;

  const params: (string | number)[] = [merged.kind];
  let where = `kind = ? AND sync_status != 'pending_delete'`;
  if (merged.calendar_year != null) {
    where += ' AND calendar_year = ?';
    params.push(merged.calendar_year);
  }
  if (merged.kind === 'quarter' && merged.quarter != null) {
    where += ' AND quarter = ?';
    params.push(merged.quarter);
  }
  if (merged.kind === 'month' && merged.month != null) {
    where += ' AND month = ?';
    params.push(merged.month);
  }
  if (merged.excludeId?.trim()) {
    where += ' AND id != ?';
    params.push(merged.excludeId.trim());
  }
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ${TABLE} WHERE ${where}`,
    params,
  );
  if (Number(row?.cnt ?? 0) > 0) {
    const label =
      merged.kind === 'year'
        ? `${merged.calendar_year} 年目标`
        : merged.kind === 'quarter'
          ? `${merged.calendar_year} Q${merged.quarter}`
          : `${merged.calendar_year} 年 ${merged.month} 月`;
    throw new LifeRoadValidationError(`${label} 已有内容，请直接编辑该节点`);
  }
}

export async function getLifeRoadNodesLocal(): Promise<LifeRoadNodeRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${TABLE}
     WHERE sync_status != 'pending_delete'
     ORDER BY
       CASE kind
         WHEN 'multi' THEN 0
         WHEN 'farther' THEN 1
         WHEN 'year' THEN 2
         WHEN 'quarter' THEN 3
         ELSE 4
       END,
       calendar_year DESC,
       quarter ASC,
       month ASC,
       sort_order ASC,
       updated_at DESC`,
  );
  return (rows ?? []).map(mapNodeRow);
}

export async function getLifeRoadNodeById(
  id: string,
  opts?: { serverFallback?: boolean },
): Promise<LifeRoadNodeRow | null> {
  const pk = id.trim();
  if (!pk) return null;
  const row = await readApiRecord<Record<string, unknown>>(TABLE, pk, {
    serverFallback: opts?.serverFallback ?? true,
  });
  return row ? mapNodeRow(row) : null;
}

export async function getLifeRoadNodes(opts?: {
  cacheOnly?: boolean;
  serverFallback?: boolean;
}): Promise<LifeRoadNodeRow[]> {
  if (!opts?.cacheOnly) {
    try {
      await readApiTable<Record<string, unknown>>(TABLE, {
        serverFallback: opts?.serverFallback ?? true,
      });
    } catch (e) {
      if (__DEV__) console.warn('[life-road-node] readApiTable failed', e);
      if (opts?.serverFallback === false) throw e;
    }
  }
  return getLifeRoadNodesLocal();
}

export async function getMonthGoalsLocal(): Promise<LifeRoadNodeRow[]> {
  const all = await getLifeRoadNodesLocal();
  return all.filter(
    (n) =>
      n.kind === 'month' &&
      (n.status === 'on_track' || n.status === 'paused' || n.status === 'arrived'),
  );
}

export async function createLifeRoadNode(
  input: CreateLifeRoadNodeInput,
): Promise<LifeRoadNodeRow> {
  const kind = parseLifeRoadNodeKind(input.kind);
  const title = trimRequiredText(input.title, '标题', LIFE_ROAD_TITLE_MAX);
  const note = trimOptionalText(input.note, '说明', LIFE_ROAD_NOTE_MAX);
  const status = parseLifeRoadNodeStatus(input.status ?? 'on_track');
  const sortOrder = parseSortOrder(input.sort_order, 1000);
  const extraData = input.extra_data?.trim() ? input.extra_data.trim() : null;
  const shape = normalizeShapeFields({
    kind,
    calendar_year: input.calendar_year,
    quarter: input.quarter,
    month: input.month,
    parent_id: input.parent_id,
  });

  await assertSlotUnique({
    kind,
    calendar_year: shape.calendar_year,
    quarter: shape.quarter,
    month: shape.month,
  });

  const id = input.id?.trim() || createNodeId();
  const now = formatWallClockDatetimeLocal(new Date());
  const row: Record<string, unknown> = {
    id,
    kind,
    title,
    note,
    calendar_year: shape.calendar_year,
    quarter: shape.quarter,
    month: shape.month,
    parent_id: shape.parent_id,
    status,
    sort_order: sortOrder,
    extra_data: extraData,
    created_at: now,
    updated_at: now,
    mutation_id: newMutationId(),
  };
  try {
    const cached = await createViaApiThenCache(TABLE, row);
    return mapNodeRow(cached);
  } catch (e) {
    if (__DEV__) console.warn('[life-road-node] create failed', e);
    throw e;
  }
}

export async function updateLifeRoadNode(
  id: string,
  input: UpdateLifeRoadNodeInput,
): Promise<LifeRoadNodeRow> {
  const pk = id.trim();
  if (!pk) throw new LifeRoadValidationError('节点 id 无效');
  const existing = await getLifeRoadNodeById(pk, { serverFallback: true });
  if (!existing) throw new LifeRoadValidationError('道路节点不存在');

  const title =
    input.title !== undefined
      ? trimRequiredText(input.title, '标题', LIFE_ROAD_TITLE_MAX)
      : existing.title;
  const note =
    input.note !== undefined
      ? trimOptionalText(input.note, '说明', LIFE_ROAD_NOTE_MAX)
      : existing.note;
  const status =
    input.status !== undefined
      ? parseLifeRoadNodeStatus(input.status)
      : existing.status;
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

  const shape = normalizeShapeFields({
    kind: existing.kind,
    calendar_year:
      input.calendar_year !== undefined
        ? input.calendar_year
        : existing.calendar_year,
    quarter: input.quarter !== undefined ? input.quarter : existing.quarter,
    month: input.month !== undefined ? input.month : existing.month,
    parent_id:
      input.parent_id !== undefined ? input.parent_id : existing.parent_id,
  });

  await assertSlotUnique({
    kind: existing.kind,
    calendar_year: shape.calendar_year,
    quarter: shape.quarter,
    month: shape.month,
    excludeId: pk,
  });

  const patch = attachPushOccFields({
    title,
    note,
    calendar_year: shape.calendar_year,
    quarter: shape.quarter,
    month: shape.month,
    parent_id: shape.parent_id,
    status,
    sort_order: sortOrder,
    extra_data: extraData,
    updated_at: formatWallClockDatetimeLocal(new Date()),
    server_rev: existing.server_rev,
  });
  try {
    const cached = await patchViaApiThenCache(TABLE, pk, patch);
    return mapNodeRow(cached);
  } catch (e) {
    if (__DEV__) console.warn('[life-road-node] update failed', e);
    throw e;
  }
}

/**
 * 删除节点：月目标先清空关联项目的 life_month_goal_id；
 * 季 / 年删除不级联删子节点（子节点可改挂或保留空窗）。
 */
export async function deleteLifeRoadNode(id: string): Promise<void> {
  const pk = id.trim();
  if (!pk) throw new LifeRoadValidationError('节点 id 无效');
  const existing = await getLifeRoadNodeById(pk, { serverFallback: true });
  if (!existing) throw new LifeRoadValidationError('道路节点不存在');

  if (existing.kind === 'month') {
    const db = await getDatabase();
    if (db) {
      const linked = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM projects
         WHERE life_month_goal_id = ?
           AND sync_status != 'pending_delete'`,
        [pk],
      );
      for (const p of linked ?? []) {
        try {
          await patchViaApiThenCache('projects', String(p.id), {
            life_month_goal_id: null,
            updated_at: formatWallClockDatetimeLocal(new Date()),
          });
        } catch (e) {
          if (__DEV__) console.warn('[life-road-node] clear project link failed', p.id, e);
        }
      }
    }
  }

  await deleteViaApiThenCache(TABLE, pk, {
    expectedRev: existing.server_rev ?? null,
    mutationId: newMutationId(),
  });
}

/**
 * 确保某年的年 / 季 / 月槽位可写：若缺父级则按需创建空标题占位？
 * 产品：空窗合法，不强制建骨架行。写月目标时可选带 parent_id。
 * 本函数仅解析并返回应写入的 parent_id（已有季节点则挂上）。
 */
export async function resolveMonthParentId(
  calendarYear: number,
  month: number,
): Promise<string | null> {
  const q = monthToQuarter(month);
  const nodes = await getLifeRoadNodesLocal();
  const quarter = nodes.find(
    (n) =>
      n.kind === 'quarter' &&
      n.calendar_year === calendarYear &&
      n.quarter === q &&
      n.status !== 'dropped',
  );
  return quarter?.id ?? null;
}
