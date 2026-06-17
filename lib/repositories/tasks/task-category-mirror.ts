import { ensureLocalRowPresent, readLocalRowForWrite } from '@/lib/api-local-row';
import { getDatabase } from '@/lib/database';

/**
 * 任务 category_id 外键指向 task_categories；项目分类存于 project_categories 并需镜像到 task_categories。
 * 写入/同步任务前补齐镜像，避免更新 extra_data（如青蛙状态）时因缺镜像而清空 category_id。
 */
export async function ensureTaskCategoryMirrorLocally(categoryId: string): Promise<boolean> {
  const cid = categoryId.trim();
  if (!cid) return false;

  if (await readLocalRowForWrite('task_categories', cid)) {
    return true;
  }

  let projectCat = await readLocalRowForWrite<Record<string, unknown>>('project_categories', cid);
  if (!projectCat) {
    const ready = await ensureLocalRowPresent('project_categories', cid);
    if (!ready) return false;
    projectCat = await readLocalRowForWrite<Record<string, unknown>>('project_categories', cid);
  }
  if (!projectCat) return false;

  const db = await getDatabase();
  if (!db) return false;

  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR REPLACE INTO task_categories (
      id, name, sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      cid,
      typeof projectCat.name === 'string' && projectCat.name.trim() ? projectCat.name : '未命名分类',
      typeof projectCat.sort_order === 'number' ? projectCat.sort_order : 1000,
      typeof projectCat.created_at === 'string' ? projectCat.created_at : now,
      typeof projectCat.updated_at === 'string' ? projectCat.updated_at : now,
      typeof projectCat.sync_status === 'string' ? projectCat.sync_status : 'synced',
      projectCat.extra_data ?? null,
    ],
  );

  return (await readLocalRowForWrite('task_categories', cid)) != null;
}
