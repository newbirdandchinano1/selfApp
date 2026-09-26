import { ensureLocalRowPresent, requireLocalRowForWrite } from '@/lib/api-local-row';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import type {
  CreateTagInput,
  TagDomain,
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
  memo: 'memos',
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

export function normalizeTagDomain(domain: string | null | undefined): TagDomain {
  return domain === 'memo' ? 'memo' : 'task';
}

function sortTagsByWeightDesc(rows: TagRow[]): TagRow[] {
  return [...rows].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const nameCmp = a.name.localeCompare(b.name, 'zh-CN');
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });
}

function coerceTagRow(row: TagRow): TagRow {
  return {
    ...row,
    domain: normalizeTagDomain(row.domain),
    weight: typeof row.weight === 'number' ? row.weight : Number(row.weight) || 0,
  };
}

async function readLocalTagsVisible(): Promise<TagRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TagRow>(
    `SELECT * FROM tags WHERE sync_status != 'pending_delete'`,
  );
  return (rows ?? []).map(coerceTagRow);
}

export async function createTag(input: CreateTagInput) {
  const name = normalizeTagName(input.name);
  if (!name) throw new Error('标签名称不能为空');

  const domain = normalizeTagDomain(input.domain);
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO tags (
      id, name, color, description, weight, domain, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [
      input.id,
      name,
      normalizeTagColor(input.color),
      input.description?.trim() || null,
      normalizeTagWeight(input.weight),
      domain,
      input.extra_data ?? null,
    ],
  );
}

/** @param domain 传入则只返回该域；不传则返回全部（兼容旧调用） */
export async function getTags(domain?: TagDomain) {
  const rows = await readLocalTagsVisible();
  const filtered =
    domain === undefined ? rows : rows.filter((t) => normalizeTagDomain(t.domain) === domain);
  return sortTagsByWeightDesc(filtered);
}

export async function getTagById(id: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TagRow>(
    `SELECT * FROM tags WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [id],
  );
  return row ? coerceTagRow(row) : null;
}

export async function getTagsByIds(ids: string[]): Promise<TagRow[]> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const db = await getDatabase();
  const placeholders = unique.map(() => '?').join(',');
  const rows = await db.getAllAsync<TagRow>(
    `SELECT * FROM tags WHERE id IN (${placeholders}) AND sync_status != 'pending_delete'`,
    unique,
  );
  return sortTagsByWeightDesc((rows ?? []).map(coerceTagRow));
}

export async function isTagNameDuplicate(
  name: string,
  excludeId?: string,
  domain: TagDomain = 'task',
) {
  const normalized = normalizeTagName(name).toLowerCase();
  if (!normalized) return false;
  const rows = await readLocalTagsVisible();
  const targetDomain = normalizeTagDomain(domain);
  return rows.some(
    (t) =>
      t.id !== excludeId &&
      normalizeTagDomain(t.domain) === targetDomain &&
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
     SET name = ?, color = ?, description = ?, weight = ?, domain = ?, extra_data = ?,
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
      input.domain !== undefined
        ? normalizeTagDomain(input.domain)
        : normalizeTagDomain(current.domain),
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
): Promise<void> {
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
  const ids = await getTagIdsByEntity(entityType, entityId);
  if (ids.length === 0) return [];
  return getTagsByIds(ids);
}

export async function getTagsByEntityIds(
  entityType: TagEntityType,
  entityIds: string[],
): Promise<Map<string, TagRow[]>> {
  const result = new Map<string, TagRow[]>();
  const unique = [...new Set(entityIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique) result.set(id, []);
  if (unique.length === 0) return result;

  const db = await getDatabase();
  const placeholders = unique.map(() => '?').join(',');
  const links = await db.getAllAsync<TagLinkRow>(
    `SELECT * FROM tag_links
     WHERE entity_type = ? AND entity_id IN (${placeholders}) AND sync_status != 'pending_delete'`,
    [entityType, ...unique],
  );
  if (!links?.length) return result;

  const tagIds = [...new Set(links.map((l) => l.tag_id))];
  const tags = await getTagsByIds(tagIds);
  const tagById = new Map(tags.map((t) => [t.id, t]));

  for (const link of links) {
    const tag = tagById.get(link.tag_id);
    if (!tag) continue;
    const list = result.get(link.entity_id) ?? [];
    list.push(tag);
    result.set(link.entity_id, list);
  }

  for (const [entityId, list] of result) {
    result.set(entityId, sortTagsByWeightDesc(list));
  }
  return result;
}

export async function setEntityTagIds(
  entityType: TagEntityType,
  entityId: string,
  tagIds: string[],
): Promise<void> {
  await ensureLocalRowPresent(ENTITY_TABLE[entityType], entityId);
  const db = await getDatabase();
  const desiredDomain: TagDomain = entityType === 'memo' ? 'memo' : 'task';

  const uniqueDesired = [...new Set(tagIds.map((id) => id.trim()).filter(Boolean))];

  const existingLinks = await db.getAllAsync<TagLinkRow>(
    `SELECT * FROM tag_links
     WHERE entity_type = ? AND entity_id = ? AND sync_status != 'pending_delete'`,
    [entityType, entityId],
  );
  const existingByTagId = new Map((existingLinks ?? []).map((l) => [l.tag_id, l]));

  const candidateTags = await getTagsByIds(uniqueDesired);
  const tagById = new Map(candidateTags.map((t) => [t.id, t]));

  // 本域可新建关联；历史跨域关联仅在调用方仍传入时保留，避免静默摘掉
  const finalIds = uniqueDesired.filter((id) => {
    const tag = tagById.get(id);
    if (!tag) return false;
    if (normalizeTagDomain(tag.domain) === desiredDomain) return true;
    return existingByTagId.has(id);
  });
  const finalSet = new Set(finalIds);

  for (const link of existingLinks ?? []) {
    if (finalSet.has(link.tag_id)) continue;
    await db.runAsync(
      `UPDATE tag_links
       SET updated_at = datetime('now'), sync_status = 'pending_delete'
       WHERE id = ?`,
      [link.id],
    );
  }

  for (const tagId of finalIds) {
    if (existingByTagId.has(tagId)) continue;
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
  return createTag({ ...input, domain: 'task' });
}

export async function getProjectTags() {
  return getTags('task');
}

export async function getMemoTags() {
  return getTags('memo');
}

export async function createMemoTag(input: CreateTagInput) {
  return createTag({ ...input, domain: 'memo' });
}

export async function getProjectTagById(id: string) {
  return getTagById(id);
}

export async function isProjectTagNameDuplicate(name: string, excludeId?: string) {
  return isTagNameDuplicate(name, excludeId, 'task');
}

export async function isMemoTagNameDuplicate(name: string, excludeId?: string) {
  return isTagNameDuplicate(name, excludeId, 'memo');
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

export async function setMemoTagIds(memoId: string, tagIds: string[]) {
  return setEntityTagIds('memo', memoId, tagIds);
}
