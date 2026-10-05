import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { readLocalRowForWrite } from '@/lib/api-local-row';
import { patchViaApiThenCache } from '@/lib/api-write-cache';

export type ProjectApiPatch = {
  extra_data?: string | null;
  status?: string;
  category_id?: string | null;
  name?: string;
  note?: string | null;
  due_date?: string | null;
  priority?: number;
};

/** 阶段 3：PATCH 服务器成功后再写缓存；失败不改本地、不留 pending */
export async function persistProjectPatchToApi(
  projectId: string,
  patch: ProjectApiPatch,
  projectRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const local = await readLocalRowForWrite<Record<string, unknown>>('projects', projectId);
  await patchViaApiThenCache('projects', projectId, patch, {
    cacheRow: {
      ...(local ?? {}),
      ...(projectRowSnapshot ?? {}),
      id: projectId,
      ...patch,
      sync_status: 'synced',
    },
  });
  invalidateInflightApiTableFetch('projects');
}
