import { isLocalFirstReads } from '@/lib/api-data-mode';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { updateProject } from '@/lib/repositories/projects/project';
import type { UpdateProjectInput } from '@/lib/repositories/projects/project.types';

export type ProjectApiPatch = {
  extra_data?: string | null;
  status?: string;
  category_id?: string | null;
  name?: string;
  note?: string | null;
  due_date?: string | null;
  priority?: number;
};

/** local-first：先写本地 SQLite，再由脏表队列推送；否则 PATCH 后拉回 */
export async function persistProjectPatchToApi(
  projectId: string,
  patch: ProjectApiPatch,
  projectRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  if (isLocalFirstReads()) {
    await updateProject(projectId, patch as UpdateProjectInput);
    invalidateInflightApiTableFetch('projects');
    return;
  }

  const { apiPatchRecord, ensureApiLoggedIn } = await import('@/lib/api-client');
  const { fetchApiRecordByPk } = await import('@/lib/api-read');
  const { syncApiReadResultToLocal } = await import('@/lib/api-read-local-sync');

  await ensureApiLoggedIn();
  await apiPatchRecord('projects', projectId, patch);
  invalidateInflightApiTableFetch('projects');

  try {
    await fetchApiRecordByPk('projects', projectId);
  } catch (e) {
    if (__DEV__) console.warn('[project-api-write] 拉取服务端项目同步本地失败，尝试快照', e);
    if (projectRowSnapshot) {
      const row = { ...projectRowSnapshot, id: projectId, ...patch };
      await syncApiReadResultToLocal('projects', row);
    }
  }
}
