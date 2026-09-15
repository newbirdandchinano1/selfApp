import { ensureLocalRowPresent, requireLocalRowForWrite } from '@/lib/api-local-row';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import type {
  CreateProjectTagInput,
  ProjectTagLinkRow,
  ProjectTagRow,
  UpdateProjectTagInput,
} from './project-tag.types';
import { DEFAULT_PROJECT_TAG_COLOR } from './project-tag.types';

function normalizeTagName(name: string): string {
  return name.trim();
}

function normalizeTagColor(color: string | null | undefined): string {
  const raw = (color ?? '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  return DEFAULT_PROJECT_TAG_COLOR;
}

function normalizeTagWeight(weight: number | null | undefined): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return 0;
  return Math.max(-9999, Math.min(9999, Math.round(weight)));
}

function sortTagsByWeightDesc(rows: ProjectTagRow[]): ProjectTagRow[] {
  return [...rows].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const nameCmp = a.name.localeCompare(b.name, 'zh-CN');
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });
}

async function readLocalProjectTagsVisible(): Promise<ProjectTagRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ProjectTagRow>(
    `SELECT * FROM project_tags WHERE sync_status != 'pending_delete'`,
  );
  return rows ?? [];
}

export async function createProjectTag(input: CreateProjectTagInput) {
  const name = normalizeTagName(input.name);
  if (!name) throw new Error('标签名称不能为空');

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO project_tags (
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

export async function getProjectTags() {
  const rows = await readLocalProjectTagsVisible();
  return sortTagsByWeightDesc(rows);
}

export async function getProjectTagById(id: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ProjectTagRow>(
    `SELECT * FROM project_tags WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [id],
  );
  return row ?? null;
}

export async function isProjectTagNameDuplicate(name: string, excludeId?: string) {
  const normalized = normalizeTagName(name).toLowerCase();
  if (!normalized) return false;
  const rows = await readLocalProjectTagsVisible();
  return rows.some(
    (t) =>
      t.id !== excludeId &&
      String(t.name ?? '')
        .trim()
        .toLowerCase() === normalized,
  );
}

export async function updateProjectTag(id: string, input: UpdateProjectTagInput) {
  const db = await getDatabase();
  const current = await requireLocalRowForWrite<ProjectTagRow>('project_tags', id);
  const nextName =
    input.name !== undefined ? normalizeTagName(input.name) : current.name;
  if (!nextName) throw new Error('标签名称不能为空');

  const result = await db.runAsync(
    `UPDATE project_tags
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

export async function deleteProjectTag(id: string) {
  await requireLocalRowForWrite('project_tags', id);
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE project_tag_links
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE tag_id = ? AND sync_status != 'pending_delete'`,
    [id],
  );
  const result = await db.runAsync(
    `UPDATE project_tags
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
  if ((result.changes ?? 0) === 0) {
    throw new Error('标签删除失败，请返回列表刷新后重试');
  }
}

/** 删除项目时同步软删标签关联 */
export async function softDeleteProjectTagLinksForProject(projectId: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE project_tag_links
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE project_id = ? AND sync_status != 'pending_delete'`,
    [projectId],
  );
}

export async function getTagIdsByProjectId(projectId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ tag_id: string }>(
    `SELECT tag_id FROM project_tag_links
     WHERE project_id = ? AND sync_status != 'pending_delete'`,
    [projectId],
  );
  return (rows ?? []).map((r) => r.tag_id);
}

export async function getTagsByProjectId(projectId: string): Promise<ProjectTagRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ProjectTagRow>(
    `SELECT t.*
     FROM project_tags t
     INNER JOIN project_tag_links l ON l.tag_id = t.id
     WHERE l.project_id = ?
       AND l.sync_status != 'pending_delete'
       AND t.sync_status != 'pending_delete'`,
    [projectId],
  );
  return sortTagsByWeightDesc(rows ?? []);
}

/** 批量：projectId -> 已按权重排序的标签列表 */
export async function getTagsByProjectIds(
  projectIds: string[],
): Promise<Map<string, ProjectTagRow[]>> {
  const map = new Map<string, ProjectTagRow[]>();
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const db = await getDatabase();
  const chunkSize = 200;
  const rows: Array<ProjectTagRow & { project_id: string }> = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const part = await db.getAllAsync<ProjectTagRow & { project_id: string }>(
      `SELECT t.*, l.project_id AS project_id
       FROM project_tags t
       INNER JOIN project_tag_links l ON l.tag_id = t.id
       WHERE l.project_id IN (${placeholders})
         AND l.sync_status != 'pending_delete'
         AND t.sync_status != 'pending_delete'`,
      chunk,
    );
    if (part?.length) rows.push(...part);
  }

  for (const row of rows) {
    const { project_id, ...tag } = row;
    const list = map.get(project_id) ?? [];
    list.push(tag);
    map.set(project_id, list);
  }
  for (const [pid, list] of map) {
    map.set(pid, sortTagsByWeightDesc(list));
  }
  return map;
}

/**
 * 覆盖设置项目的标签集合（0 到多个）。
 * 保留仍在选中集合中的关联；软删被移除的；新建缺失的。
 * 若同一标签曾被软删，则恢复该关联行，避免重复插入。
 */
export async function setProjectTagIds(projectId: string, tagIds: string[]) {
  await ensureLocalRowPresent('projects', projectId);
  const uniqueIds = [...new Set(tagIds.map((id) => id.trim()).filter(Boolean))];

  for (const tagId of uniqueIds) {
    const ready = await ensureLocalRowPresent('project_tags', tagId);
    if (!ready) {
      throw new Error('部分标签尚未同步到本地，请刷新后重试');
    }
  }

  const db = await getDatabase();
  const allLinks = await db.getAllAsync<ProjectTagLinkRow>(
    `SELECT * FROM project_tag_links WHERE project_id = ?`,
    [projectId],
  );
  const byTag = new Map<string, ProjectTagLinkRow>();
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
        `UPDATE project_tag_links
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
        `UPDATE project_tag_links
         SET updated_at = datetime('now'),
             sync_status = 'pending_update'
         WHERE id = ?`,
        [existing.id],
      );
      continue;
    }
    await db.runAsync(
      `INSERT INTO project_tag_links (
        id, project_id, tag_id, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'pending_create')`,
      [makeTimestampEntityId('ptl_', 8), projectId, tagId],
    );
  }
}
