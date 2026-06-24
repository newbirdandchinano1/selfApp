import { shouldPreserveForeignKeyOnUpload } from '@/lib/api-fk-preserve';
import {
  apiCreateRecord,
  apiDeleteRecord,
  apiListRecords,
  apiUpdateRecord,
  ApiRequestError,
  isDuplicateRecordApiError,
} from '@/lib/api-client';
import {
  ensureProjectCategoryRefsForApiUpload,
  ensureTaskCategoryMirrorForApiUpload,
  readLocalForeignKeyRefs,
  sortProjectCategoriesForApiUpload,
} from '@/lib/cloud-sql-sync';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { isAbortError } from '@/lib/cloud-fetch-retry';

function rowPrimaryKeyValue(row: Record<string, unknown>, pkCols: string[]): string | null {
  if (pkCols.length === 0) {
    const id = row.id;
    return id == null || id === '' ? null : String(id);
  }
  const parts = pkCols.map(col => row[col]);
  if (parts.some(v => v == null || v === '')) return null;
  return String(parts[0]);
}

type UploadedPkRegistry = Map<string, Set<string>>;

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof ApiRequestError && /foreign key constraint fails/i.test(err.message);
}

function isMissingParentRecordApiError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (/请先同步\s*projects/i.test(err.message) ||
      /请先同步\s*project_categories/i.test(err.message) ||
      /请先同步\s*habits/i.test(err.message) ||
      /请先同步\s*memo_dimensions/i.test(err.message) ||
      /请先.*task_categories/i.test(err.message) ||
      /任务分类.*不存在/i.test(err.message) ||
      /项目分类.*不存在/i.test(err.message) ||
      /习惯.*不存在/i.test(err.message) ||
      /备忘.*维度.*不存在/i.test(err.message) ||
      /引用的\s*项目[\s（(]*projects/i.test(err.message) ||
      /projects[\s）)]*不存在/i.test(err.message))
  );
}

function normalizeHabitCheckInRecordDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const ymd = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

async function findApiHabitCheckInIdByNaturalKey(
  habitId: string,
  recordDateYmd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let page = 1;
  while (page <= 50) {
    const { list, pagination } = await apiListRecords<{ id?: string; habit_id?: string; record_date?: string }>(
      'habit_check_ins',
      { page, limit: 200, signal },
    );
    for (const row of list) {
      if (String(row.habit_id ?? '') !== habitId) continue;
      if (normalizeHabitCheckInRecordDate(row.record_date) !== recordDateYmd) continue;
      if (row.id) return String(row.id);
    }
    if (page >= pagination.totalPages || list.length === 0) break;
    page += 1;
  }
  return null;
}

async function realignLocalHabitCheckInId(localId: string, serverId: string): Promise<void> {
  if (!localId || !serverId || localId === serverId) return;
  const { getDatabase } = await import('@/lib/database');
  const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
    '@/lib/cloud-sql-dirty-track'
  );
  const db = await getDatabase();
  if (!db) return;

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    const existingServerRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM habit_check_ins WHERE id = ? LIMIT 1`,
      [serverId],
    );
    if (existingServerRow) {
      await db.runAsync(`DELETE FROM habit_check_ins WHERE id = ?`, [localId]);
      return;
    }
    await db.runAsync(`UPDATE habit_check_ins SET id = ? WHERE id = ?`, [serverId, localId]);
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

async function upsertHabitCheckInRowToApi(
  payload: Record<string, unknown>,
  localPk: string | null,
  signal?: AbortSignal,
): Promise<'created' | 'updated'> {
  try {
    await apiCreateRecord('habit_check_ins', payload, { signal });
    return 'created';
  } catch (createErr) {
    if (!isDuplicateRecordApiError(createErr)) throw createErr;
    if (!localPk) throw createErr;

    try {
      await apiUpdateRecord('habit_check_ins', localPk, payload, { signal });
      return 'updated';
    } catch (updateErr) {
      if (!(updateErr instanceof ApiRequestError) || updateErr.httpStatus !== 404) {
        throw updateErr;
      }
    }

    const habitId = payload.habit_id == null || payload.habit_id === '' ? null : String(payload.habit_id);
    const recordDateYmd = normalizeHabitCheckInRecordDate(payload.record_date);
    if (!habitId || !recordDateYmd) throw createErr;

    const serverId = await findApiHabitCheckInIdByNaturalKey(habitId, recordDateYmd, signal);
    if (!serverId) throw createErr;

    await apiUpdateRecord('habit_check_ins', serverId, payload, { signal });
    await realignLocalHabitCheckInId(localPk, serverId);
    return 'updated';
  }
}

/** 单行上传失败可跳过（继续后续行） */
export class ApiRowUploadSkippedError extends Error {
  readonly table: string;
  readonly pk: string | null;

  constructor(table: string, pk: string | null, message: string) {
    super(message);
    this.name = 'ApiRowUploadSkippedError';
    this.table = table;
    this.pk = pk;
  }
}

function isRecoverableParentReferenceError(err: unknown): boolean {
  return isForeignKeyConstraintError(err) || isMissingParentRecordApiError(err);
}

function shouldPreserveCategoryFkOnUpload(
  table: string,
  fk: { fromColumn: string; parentTable: string },
): boolean {
  return shouldPreserveForeignKeyOnUpload(table, fk);
}

function nullifyRowForeignKeys(
  table: string,
  row: Record<string, unknown>,
  fkRefs: Awaited<ReturnType<typeof readLocalForeignKeyRefs>>,
): Record<string, unknown> {
  const out = { ...row };
  for (const fk of fkRefs) {
    if (fk.parentTable === table) continue;
    if (shouldPreserveCategoryFkOnUpload(table, fk)) continue;
    if (out[fk.fromColumn] != null && out[fk.fromColumn] !== '') {
      out[fk.fromColumn] = null;
    }
  }
  return out;
}

function sanitizeRowForeignKeysForApiUpload(
  table: string,
  row: Record<string, unknown>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefs: Awaited<ReturnType<typeof readLocalForeignKeyRefs>>,
): Record<string, unknown> {
  const out = { ...row };
  for (const fk of fkRefs) {
    if (fk.parentTable === table) continue;
    if (shouldPreserveCategoryFkOnUpload(table, fk)) continue;
    const val = out[fk.fromColumn];
    if (val == null || val === '') continue;
    const uploaded = uploadedPkByTable.get(fk.parentTable);
    if (!uploaded || uploaded.size === 0) continue;
    if (!uploaded.has(String(val))) {
      out[fk.fromColumn] = null;
    }
  }
  return out;
}

export async function upsertRowToApi(
  table: string,
  row: Record<string, unknown>,
  pkCols: string[],
  opts?: {
    signal?: AbortSignal;
    uploadedPkByTable?: UploadedPkRegistry;
    fkRefs?: Awaited<ReturnType<typeof readLocalForeignKeyRefs>>;
    rowsByTable?: Map<string, Record<string, unknown>[]>;
    pkColsByTable?: Map<string, string[]>;
    fkRefsByTable?: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>;
  },
): Promise<'created' | 'updated' | 'deleted'> {
  let body = row;
  if (opts?.uploadedPkByTable && opts.fkRefs) {
    body = sanitizeRowForeignKeysForApiUpload(table, row, opts.uploadedPkByTable, opts.fkRefs);
  }
  const pk = rowPrimaryKeyValue(body, pkCols);

  if (body.sync_status === 'pending_delete') {
    if (!pk) {
      throw new ApiRowUploadSkippedError(table, null, '待删除行缺少主键');
    }
    try {
      await apiDeleteRecord(table, pk, { signal: opts?.signal });
      return 'deleted';
    } catch (e) {
      if (e instanceof ApiRequestError && e.httpStatus === 404) {
        return 'deleted';
      }
      throw e;
    }
  }

  const runUpsert = async (payload: Record<string, unknown>): Promise<'created' | 'updated'> => {
    if (table === 'habit_check_ins') {
      return upsertHabitCheckInRowToApi(payload, pk, opts?.signal);
    }
    try {
      await apiCreateRecord(table, payload, { signal: opts?.signal });
      return 'created';
    } catch (e) {
      if (isDuplicateRecordApiError(e)) {
        if (!pk) throw e;
        await apiUpdateRecord(table, pk, payload, { signal: opts?.signal });
        return 'updated';
      }
      throw e;
    }
  };

  const tryUpsertReferencedProject = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'tasks' || !opts?.rowsByTable) return;
    const projectId = payload.project_id;
    if (projectId == null || projectId === '') return;

    const pid = String(projectId);
    const projectRow = (opts.rowsByTable.get('projects') ?? []).find(p => String(p.id) === pid);
    if (!projectRow) return;

    const projectPkCols = opts.pkColsByTable?.get('projects') ?? ['id'];
    await upsertRowToApi('projects', projectRow, projectPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('projects') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('projects')?.add(pid);
  };

  const tryUpsertReferencedProjectCategory = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'projects' || !opts?.rowsByTable) return;
    const categoryId = payload.category_id;
    if (categoryId == null || categoryId === '') return;

    const cid = String(categoryId);
    const categoryRow = (opts.rowsByTable.get('project_categories') ?? []).find(c => String(c.id) === cid);
    if (!categoryRow) return;

    const categoryPkCols = opts.pkColsByTable?.get('project_categories') ?? ['id'];
    await upsertRowToApi('project_categories', categoryRow, categoryPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('project_categories') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('project_categories')?.add(cid);
  };

  const tryUpsertReferencedHabit = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'habit_check_ins' || !opts?.rowsByTable) return;
    const habitId = payload.habit_id;
    if (habitId == null || habitId === '') return;

    const hid = String(habitId);
    const habitRow = (opts.rowsByTable.get('habits') ?? []).find(h => String(h.id) === hid);
    if (!habitRow) return;

    const habitPkCols = opts.pkColsByTable?.get('habits') ?? ['id'];
    await upsertRowToApi('habits', habitRow, habitPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('habits') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('habits')?.add(hid);
  };

  const tryUpsertReferencedTaskCategory = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'tasks' || !opts?.rowsByTable) return;
    const categoryId = payload.category_id;
    if (categoryId == null || categoryId === '') return;

    await ensureTaskCategoryMirrorForApiUpload(opts.rowsByTable);

    const cid = String(categoryId);
    const categoryRow = (opts.rowsByTable.get('task_categories') ?? []).find(c => String(c.id) === cid);
    if (!categoryRow) return;

    const categoryPkCols = opts.pkColsByTable?.get('task_categories') ?? ['id'];
    await upsertRowToApi('task_categories', categoryRow, categoryPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('task_categories') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('task_categories')?.add(cid);
  };

  const tryUpsertReferencedMemoDimension = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'memos' || !opts?.rowsByTable) return;
    const dimensionId = payload.dimension_id;
    if (dimensionId == null || dimensionId === '') return;

    await upsertMemoDimensionsReferencedByMemos(
      [payload],
      opts.rowsByTable,
      opts.pkColsByTable ?? new Map(),
      opts.uploadedPkByTable ?? new Map(),
      opts.fkRefsByTable ?? new Map(),
      opts?.signal,
    );
    opts.uploadedPkByTable?.get('memo_dimensions')?.add(String(dimensionId));
  };

  try {
    return await runUpsert(body);
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (e instanceof ApiRequestError && (e.httpStatus === 413 || /entity too large/i.test(e.message))) {
      const idHint = pk ? `（id: ${pk}）` : '';
      throw new ApiRequestError(
        `上传表「${table}」时单行数据过大${idHint}。应用已自动去掉本地图片并截断长文本；若仍失败请让管理员将 Node/nginx 请求体上限调至至少 2MB（当前服务器返回 413）。`,
        e.httpStatus,
        e.apiCode,
      );
    }
    if (isRecoverableParentReferenceError(e)) {
      try {
        if (table === 'habit_check_ins') {
          await tryUpsertReferencedHabit(body);
        }
        if (table === 'tasks') {
          await tryUpsertReferencedTaskCategory(body);
          await tryUpsertReferencedProject(body);
        }
        if (table === 'projects') await tryUpsertReferencedProjectCategory(body);
        if (table === 'memos') await tryUpsertReferencedMemoDimension(body);
        return await runUpsert(body);
      } catch {
        /* 补传父表后仍失败，继续去掉外键重试 */
      }
      if (opts?.fkRefs?.length) {
        const retried = nullifyRowForeignKeys(table, body, opts.fkRefs);
        try {
          return await runUpsert(retried);
        } catch (retryErr) {
          if (isRecoverableParentReferenceError(retryErr)) {
            const msg =
              retryErr instanceof ApiRequestError
                ? retryErr.message
                : retryErr instanceof Error
                  ? retryErr.message
                  : String(retryErr);
            throw new ApiRowUploadSkippedError(table, pk, msg);
          }
          throw retryErr;
        }
      }
      if (e instanceof ApiRequestError) {
        throw new ApiRowUploadSkippedError(table, pk, e.message);
      }
    }
    throw e;
  }
}

export async function upsertProjectCategoriesReferencedByProjects(
  projectRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  await ensureProjectCategoryRefsForApiUpload(rowsByTable);
  await ensureTaskCategoryMirrorForApiUpload(rowsByTable);

  const categoryIds = new Set<string>();
  for (const project of projectRows) {
    const cid = project.category_id;
    if (cid != null && cid !== '') categoryIds.add(String(cid));
  }
  categoryIds.add(INBOX_PROJECT_CATEGORY_ID);

  const categoryRows = sortProjectCategoriesForApiUpload(rowsByTable.get('project_categories') ?? []);
  const categoryPkCols = pkColsByTable.get('project_categories') ?? ['id'];
  const uploadedCategories = uploadedPkByTable.get('project_categories') ?? new Set<string>();
  uploadedPkByTable.set('project_categories', uploadedCategories);

  for (const cid of categoryIds) {
    const categoryRow = categoryRows.find(c => String(c.id) === cid);
    if (!categoryRow) continue;
    await upsertRowToApi('project_categories', categoryRow, categoryPkCols, {
      signal,
      uploadedPkByTable,
      fkRefs: fkRefsByTable.get('project_categories') ?? [],
      rowsByTable,
      pkColsByTable,
      fkRefsByTable,
    });
    uploadedCategories.add(cid);
  }
}

export async function upsertTaskCategoriesReferencedByTasks(
  taskRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  await ensureProjectCategoryRefsForApiUpload(rowsByTable);
  await ensureTaskCategoryMirrorForApiUpload(rowsByTable);

  const categoryIds = new Set<string>();
  for (const task of taskRows) {
    const cid = task.category_id;
    if (cid != null && cid !== '') categoryIds.add(String(cid));
  }
  categoryIds.add(INBOX_PROJECT_CATEGORY_ID);

  const categoryRows = rowsByTable.get('task_categories') ?? [];
  const categoryPkCols = pkColsByTable.get('task_categories') ?? ['id'];
  const uploadedCategories = uploadedPkByTable.get('task_categories') ?? new Set<string>();
  uploadedPkByTable.set('task_categories', uploadedCategories);

  for (const cid of categoryIds) {
    const categoryRow = categoryRows.find(c => String(c.id) === cid);
    if (!categoryRow) continue;
    try {
      await upsertRowToApi('task_categories', categoryRow, categoryPkCols, {
        signal,
        uploadedPkByTable,
        fkRefs: fkRefsByTable.get('task_categories') ?? [],
        rowsByTable,
        pkColsByTable,
        fkRefsByTable,
      });
      uploadedCategories.add(cid);
    } catch (e) {
      if (e instanceof ApiRowUploadSkippedError) {
        if (__DEV__) console.warn('[api-sync] 预上传 task_categories 跳过', cid, e.message);
        continue;
      }
      throw e;
    }
  }
}

export async function upsertFinanceAccountsReferencedByTransactions(
  txnRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  const accountIds = new Set<string>();
  for (const txn of txnRows) {
    const aid = txn.account_id;
    if (aid != null && aid !== '') accountIds.add(String(aid));
  }
  if (accountIds.size === 0) return;

  const accountRows = rowsByTable.get('finance_accounts') ?? [];
  const accountPkCols = pkColsByTable.get('finance_accounts') ?? ['id'];
  const uploadedAccounts = uploadedPkByTable.get('finance_accounts') ?? new Set<string>();
  uploadedPkByTable.set('finance_accounts', uploadedAccounts);

  for (const aid of accountIds) {
    if (uploadedAccounts.has(aid)) continue;
    const accountRow = accountRows.find(a => String(a.id) === aid);
    if (!accountRow) continue;
    try {
      await upsertRowToApi('finance_accounts', accountRow, accountPkCols, {
        signal,
        uploadedPkByTable,
        fkRefs: fkRefsByTable.get('finance_accounts') ?? [],
        rowsByTable,
        pkColsByTable,
        fkRefsByTable,
      });
      uploadedAccounts.add(aid);
    } catch (e) {
      if (e instanceof ApiRowUploadSkippedError) {
        if (__DEV__) console.warn('[api-sync] 预上传 finance_accounts 跳过', aid, e.message);
        continue;
      }
      throw e;
    }
  }
}

export async function upsertMemoDimensionsReferencedByMemos(
  memoRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  const dimensionIds = new Set<string>();
  for (const memo of memoRows) {
    const did = memo.dimension_id;
    if (did != null && did !== '') dimensionIds.add(String(did));
  }
  if (dimensionIds.size === 0) return;

  const dimensionRows = rowsByTable.get('memo_dimensions') ?? [];
  const dimensionPkCols = pkColsByTable.get('memo_dimensions') ?? ['id'];
  const uploadedDimensions = uploadedPkByTable.get('memo_dimensions') ?? new Set<string>();
  uploadedPkByTable.set('memo_dimensions', uploadedDimensions);

  const { getDatabase } = await import('@/lib/database');
  const db = await getDatabase();

  for (const did of dimensionIds) {
    let dimensionRow = dimensionRows.find(d => String(d.id) === did);
    if (!dimensionRow && db) {
      dimensionRow =
        (await db.getFirstAsync<Record<string, unknown>>(
          'SELECT * FROM memo_dimensions WHERE id = ? LIMIT 1',
          [did],
        )) ?? undefined;
    }
    if (!dimensionRow) continue;
    try {
      await upsertRowToApi('memo_dimensions', dimensionRow, dimensionPkCols, {
        signal,
        uploadedPkByTable,
        fkRefs: fkRefsByTable.get('memo_dimensions') ?? [],
        rowsByTable,
        pkColsByTable,
        fkRefsByTable,
      });
      uploadedDimensions.add(did);
    } catch (e) {
      if (e instanceof ApiRowUploadSkippedError) {
        if (__DEV__) console.warn('[api-sync] 预上传 memo_dimensions 跳过', did, e.message);
        continue;
      }
      throw e;
    }
  }
}

export async function upsertHabitsReferencedByCheckIns(
  checkInRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  const habitIds = new Set<string>();
  for (const row of checkInRows) {
    const hid = row.habit_id;
    if (hid != null && hid !== '') habitIds.add(String(hid));
  }
  if (habitIds.size === 0) return;

  const habitRows = rowsByTable.get('habits') ?? [];
  const habitPkCols = pkColsByTable.get('habits') ?? ['id'];
  const uploadedHabits = uploadedPkByTable.get('habits') ?? new Set<string>();
  uploadedPkByTable.set('habits', uploadedHabits);

  for (const hid of habitIds) {
    const habitRow = habitRows.find(h => String(h.id) === hid);
    if (!habitRow) continue;
    try {
      await upsertRowToApi('habits', habitRow, habitPkCols, {
        signal,
        uploadedPkByTable,
        fkRefs: fkRefsByTable.get('habits') ?? [],
        rowsByTable,
        pkColsByTable,
        fkRefsByTable,
      });
      uploadedHabits.add(hid);
    } catch (e) {
      if (e instanceof ApiRowUploadSkippedError) {
        if (__DEV__) console.warn('[api-sync] 预上传 habits 跳过', hid, e.message);
        continue;
      }
      throw e;
    }
  }
}

export async function upsertProjectsReferencedByTasks(
  taskRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  const projectIds = new Set<string>();
  for (const task of taskRows) {
    const pid = task.project_id;
    if (pid != null && pid !== '') projectIds.add(String(pid));
  }
  if (projectIds.size === 0) return;

  const projectRows = rowsByTable.get('projects') ?? [];
  const projectPkCols = pkColsByTable.get('projects') ?? ['id'];
  const uploadedProjects = uploadedPkByTable.get('projects') ?? new Set<string>();
  uploadedPkByTable.set('projects', uploadedProjects);

  for (const pid of projectIds) {
    const projectRow = projectRows.find(p => String(p.id) === pid);
    if (!projectRow) continue;
    await upsertRowToApi('projects', projectRow, projectPkCols, {
      signal,
      uploadedPkByTable,
      fkRefs: fkRefsByTable.get('projects') ?? [],
      rowsByTable,
      pkColsByTable,
      fkRefsByTable,
    });
    uploadedProjects.add(pid);
  }
}

export { rowPrimaryKeyValue };
