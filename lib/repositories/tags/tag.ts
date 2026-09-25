import { ensureLocalRowPresent, requireLocalRowForWrite } from '@/lib/api-local-row';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import type {
  CreateTagInput,
  TagEntityType,
  TagLinkRow,
  TagRow,
  UpdateTagInput,
} from './tag.types';
import { DEFAULT_TAG_COLOR } from './tag.types';

const ENTITY_TABLE: Record<TagEntityType, string> = {
  project: 'projects',
  habit: 'habits',
  task: 'tasks',
};

function normalizeTagName(name: string): string {
  return name.trim();
}

function normalizeTagColor(color: string | null | undefined): string {
  const raw = (color ?? '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  return DEFAULT_TAG_COLOR;
}

function normalizeTagWeight(weight: number | null | undefined): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return 0;
  return Math.max(-9999, Math.min(9999, Math.round(weight)));
}

function sortTagsByWeightDesc(rows: TagRow[]): TagRow[] {
  return [...rows].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const nameCmp = a.name.localeCompare(b.name, 'zh-CN');
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });
}

async function readLocalTagsVisible(): Promise<TagRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TagRow>(
    `SELECT * FROM tags WHERE sync_status != 'pending_delete'`,
  );
  return rows ?? [];
}

export async function createTag(input: CreateTagInput) {
  const name = normalizeTagName(input.name);
  if (!name) throw new Error('标签名称不能为空');

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO tags (
      id, name, color, description, weight, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [
      input.id,
      name,
      normalizeTagColor(input.color),
      input.description?.trim() || null,
      normalizeTagWeight(input.weight),
      input.extra_data ?? null,
    ],
  );
}

export async function getTags() {
  const rows = await readLocalTagsVisible();
  return sortTagsByWeightDesc(rows);
}

export async function getTagById(id: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TagRow>(
    `SELECT * FROM tags WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [id],
  );
  return row ?? null;
}

export async function isTagNameDuplicate(name: string, excludeId?: string) {
  const normalized = normalizeTagName(name).toLowerCase();
  if (!normalized) return false;
  const rows = await readLocalTagsVisible();
  return rows.some(
    (t) =>
      t.id !== excludeId &&
      String(t.name ?? '')
        .trim()
        .toLowerCase() === normalized,
  );
}

export async function updateTag(id: string, input: UpdateTagInput) {
  const db = await getDatabase();
  const current = await requireLocalRowForWrite<TagRow>('tags', id);
  const nextName = input.name !== undefined ? normalizeTagName(input.name) : current.name;
  if (!nextName) throw new Error('标签名称不能为空');

  const result = await db.runAsync(
    `UPDATE tags
     SET name = ?, color = ?, description = ?, weight = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      nextName,
      input.color !== undefined ? normalizeTagColor(input.color) : current.color,
      input.description !== undefined
        ? input.description?.trim() || null
        : current.description,
      input.weight !== undefined ? normalizeTagWeight(input.weight) : current.weight,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      id,
    ],
  );
  if ((result.changes ?? 0) === 0) {
    throw new Error('标签保存失败，请返回列表刷新后重试');
  }
}

export async function deleteTag(id: string) {
  await requireLocalRowForWrite('tags', id);
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tag_links
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE tag_id = ? AND sync_status != 'pending_delete'`,
    [id],
  );
  const result = await db.runAsync(
    `UPDATE tags
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
  if ((result.changes ?? 0) === 0) {
    throw new Error('标签删除失败，请返回列表刷新后重试');
  }
}

/** 删除实体时同步软删标签关联 */
export async function softDeleteTagLinksForEntity(
  entityType: TagEntityType,
  entityId: string,
) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tag_links
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE entity_type = ? AND entity_id = ? AND sync_status != 'pending_delete'`,
    [entityType, entityId],
  );
}

export async function getTagIdsByEntity(
  entityType: TagEntityType,
  entityId: string,
): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ tag_id: string }>(
    `SELECT tag_id FROM tag_links
     WHERE entity_type = ? AND entity_id = ? AND sync_status != 'pending_delete'`,
    [entityType, entityId],
  );
  return (rows ?? []).map((r) => r.tag_id);
}

export async function getTagsByEntity(
  entityType: TagEntityType,
  entityId: string,
): Promise<TagRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TagRow>(
    `SELECT t.*
     FROM tags t
     INNER JOIN tag_links l ON l.tag_id = t.id
     WHERE l.entity_type = ?
       AND l.entity_id = ?
       AND l.sync_status != 'pending_delete'
       AND t.sync_status != 'pending_delete'`,
    [entityType, entityId],
  );
  return sortTagsByWeightDesc(rows ?? []);
}

/** 批量：entityId -> 已按权重排序的标签列表 */
export async function getTagsByEntityIds(
  entityType: TagEntityType,
  entityIds: string[],
): Promise<Map<string, TagRow[]>> {
  const map = new Map<string, TagRow[]>();
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const db = await getDatabase();
  const chunkSize = 200;
  const rows: Array<TagRow & { entity_id: string }> = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const part = await db.getAllAsync<TagRow & { entity_id: string }>(
      `SELECT t.*, l.entity_id AS entity_id
       FROM tags t
       INNER JOIN tag_links l ON l.tag_id = t.id
       WHERE l.entity_type = ?
         AND l.entity_id IN (${placeholders})
         AND l.sync_status != 'pending_delete'
         AND t.sync_status != 'pending_delete'`,
      [entityType, ...chunk],
    );
    if (part?.length) rows.push(...part);
  }

  for (const row of rows) {
    const { entity_id, ...tag } = row;
    const list = map.get(entity_id) ?? [];
    list.push(tag);
    map.set(entity_id, list);
  }
  for (const [eid, list] of map) {
    map.set(eid, sortTagsByWeightDesc(list));
  }
  return map;
}

/**
 * 覆盖设置实体的标签集合（0 到多个）。
 * 子任务（有 parent_task_id）拒绝写 link。
 */
export async function setEntityTagIds(
  entityType: TagEntityType,
  entityId: string,
  tagIds: string[],
) {
  if (entityType === 'task') {
    const db = await getDatabase();
    const task = await db.getFirstAsync<{ parent_task_id: string | null }>(
      `SELECT parent_task_id FROM tasks WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
      [entityId],
    );
    if (task?.parent_task_id) {
      throw new Error('子任务不支持打标签');
    }
  }

  await ensureLocalRowPresent(ENTITY_TABLE[entityType], entityId);
  const uniqueIds = [...new Set(tagIds.map((id) => id.trim()).filter(Boolean))];

  for (const tagId of uniqueIds) {
    const ready = await ensureLocalRowPresent('tags', tagId);
    if (!ready) {
      throw new Error('部分标签尚未同步到本地，请刷新后重试');
    }
  }

  const db = await getDatabase();
  const allLinks = await db.getAllAsync<TagLinkRow>(
    `SELECT * FROM tag_links WHERE entity_type = ? AND entity_id = ?`,
    [entityType, entityId],
  );
  const byTag = new Map<string, TagLinkRow>();
  for (const row of allLinks ?? []) {
    const prev = byTag.get(row.tag_id);
    if (!prev) {
      byTag.set(row.tag_id, row);
      continue;
    }
    const prevDead = prev.sync_status === 'pending_delete';
    const rowDead = row.sync_status === 'pending_delete';
    if (prevDead && !rowDead) byTag.set(row.tag_id, row);
  }
  const nextSet = new Set(uniqueIds);

  for (const row of byTag.values()) {
    if (row.sync_status === 'pending_delete') continue;
    if (!nextSet.has(row.tag_id)) {
      await db.runAsync(
        `UPDATE tag_links
         SET updated_at = datetime('now'), sync_status = 'pending_delete'
         WHERE id = ?`,
        [row.id],
      );
    }
  }

  for (const tagId of uniqueIds) {
    const existing = byTag.get(tagId);
    if (existing && existing.sync_status !== 'pending_delete') continue;
    if (existing && existing.sync_status === 'pending_delete') {
      await db.runAsync(
        `UPDATE tag_links
         SET updated_at = datetime('now'),
             sync_status = 'pending_update'
         WHERE id = ?`,
        [existing.id],
      );
      continue;
    }
    await db.runAsync(
      `INSERT INTO tag_links (
        id, entity_type, entity_id, tag_id, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create')`,
      [makeTimestampEntityId('tl_', 8), entityType, entityId, tagId],
    );
  }
}

// —— 项目侧薄封装（保持旧调用方 API）——

export async function createProjectTag(input: CreateTagInput) {
  return createTag(input);
}

export async function getProjectTags() {
  return getTags();
}

export async function getProjectTagById(id: string) {
  return getTagById(id);
}

export async function isProjectTagNameDuplicate(name: string, excludeId?: string) {
  return isTagNameDuplicate(name, excludeId);
}

export async function updateProjectTag(id: string, input: UpdateTagInput) {
  return updateTag(id, input);
}

export async function deleteProjectTag(id: string) {
  return deleteTag(id);
}

export async function softDeleteProjectTagLinksForProject(projectId: string) {
  return softDeleteTagLinksForEntity('project', projectId);
}

export async function getTagIdsByProjectId(projectId: string): Promise<string[]> {
  return getTagIdsByEntity('project', projectId);
}

export async function getTagsByProjectId(projectId: string): Promise<TagRow[]> {
  return getTagsByEntity('project', projectId);
}

export async function getTagsByProjectIds(
  projectIds: string[],
): Promise<Map<string, TagRow[]>> {
  return getTagsByEntityIds('project', projectIds);
}

export async function setProjectTagIds(projectId: string, tagIds: string[]) {
  return setEntityTagIds('project', projectId, tagIds);
}

export async function setHabitTagIds(habitId: string, tagIds: string[]) {
  return setEntityTagIds('habit', habitId, tagIds);
}

export async function setTaskTagIds(taskId: string, tagIds: string[]) {
  return setEntityTagIds('task', taskId, tagIds);
}
