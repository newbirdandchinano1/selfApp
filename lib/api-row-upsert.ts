import {
    apiCreateRecord,
    apiDeleteRecord,
    apiListRecords,
    ApiRequestError,
    apiUpdateRecord,
    isDuplicateRecordApiError,
} from '@/lib/api-client';
import { isApiGenericWriteForbidden } from '@/lib/api-allowed-tables';
import { shouldPreserveForeignKeyOnUpload } from '@/lib/api-fk-preserve';
import { isAbortError } from '@/lib/cloud-fetch-retry';
import {
    ensureProjectCategoryRefsForApiUpload,
    ensureTaskCategoryMirrorForApiUpload,
    readLocalForeignKeyRefs,
    sortProjectCategoriesForApiUpload,
} from '@/lib/cloud-sql-sync';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import {
  attachPushOccFields,
  isSyncOccConflictApiError,
  occPayloadOf,
  parseMutationId,
} from '@/lib/sync-write-meta';

/**
 * 积分钱包为单例行，余额权威在 POST /points/adjust。
 * 通用 CRUD 已 403，增量同步不得再推余额。
 */
async function upsertPointsWalletRowToApi(
  _payload: Record<string, unknown>,
  localPk: string | null,
  _signal?: AbortSignal,
): Promise<'created' | 'updated'> {
  throw new ApiRowUploadSkippedError(
    'points_wallet',
    localPk,
    '积分钱包禁止通用写；余额请走 POST /api/app/points/adjust',
  );
}

/** 后端 403 / 客户端拦截：高危表禁止通用写（或专用接口未覆盖该操作） */
function isGenericWriteForbiddenClientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (/禁止通过通用 CRUD|App domain fallback/i.test(err.message)) return true;
  if (
    err instanceof ApiRequestError &&
    err.httpStatus === 403 &&
    /禁止通过|专用业务|writeForbidden/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

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
      /请先同步\s*finance_accounts/i.test(err.message) ||
      /请先.*task_categories/i.test(err.message) ||
      /任务分类.*不存在/i.test(err.message) ||
      /项目分类.*不存在/i.test(err.message) ||
      /习惯.*不存在/i.test(err.message) ||
      /财务账户.*不存在/i.test(err.message) ||
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
    const existingServerRow = await db.getFirstAsync<{ id: string; count: number; sync_status: string }>(
      `SELECT id, count, sync_status FROM habit_check_ins WHERE id = ? LIMIT 1`,
      [serverId],
    );
    if (existingServerRow) {
      const localRow = await db.getFirstAsync<{ count: number; sync_status: string }>(
        `SELECT count, sync_status FROM habit_check_ins WHERE id = ? LIMIT 1`,
        [localId],
      );
      // 合并到保留行：取较大 count，避免删掉本地更高次数后只剩服务端旧值
      if (localRow && localRow.sync_status !== 'pending_delete') {
        const mergedCount = Math.max(
          Math.max(0, Math.floor(Number(existingServerRow.count) || 0)),
          Math.max(0, Math.floor(Number(localRow.count) || 0)),
        );
        const needsUpdate =
          mergedCount !== Math.max(0, Math.floor(Number(existingServerRow.count) || 0)) ||
          existingServerRow.sync_status === 'pending_delete';
        if (needsUpdate) {
          await db.runAsync(
            `UPDATE habit_check_ins
              SET count = ?,
                  updated_at = datetime('now'),
                  sync_status = CASE
                    WHEN sync_status = 'pending_delete' THEN 'pending_update'
                    WHEN sync_status = 'synced' THEN 'pending_update'
                    ELSE sync_status
                  END
              WHERE id = ?`,
            [mergedCount, serverId],
          );
        }
      }
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

async function stampLastPushedMutation(
  table: string,
  pkCol: string,
  pk: string,
  mutationId: string | null,
): Promise<void> {
  if (!mutationId) return;
  const { getDatabase } = await import('@/lib/database');
  const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
    '@/lib/cloud-sql-dirty-track'
  );
  const db = await getDatabase();
  if (!db) return;
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.runAsync(
      `UPDATE \`${table}\` SET last_pushed_mutation_id = ? WHERE \`${pkCol}\` = ?`,
      [mutationId, pk],
    );
  } catch {
    /* 列尚未迁移时忽略 */
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

async function applyPushOccConflict(table: string, pk: string, err: unknown): Promise<boolean> {
  if (!isSyncOccConflictApiError(err)) return false;
  const payload = occPayloadOf(err);
  const { applyOneEvent, decide, readLocalRowState } = await import('@/lib/sync-apply');
  const event = {
    id: 0,
    table,
    pk,
    op: (payload?.kind === 'tombstone' ? 'delete' : 'upsert') as 'upsert' | 'delete',
    serverRev: payload?.serverRev ?? null,
    mutationId: payload?.mutationId ?? null,
    row: payload?.row ?? null,
  };
  const local = await readLocalRowState(table, pk);
  const decision = decide(local, event);
  await applyOneEvent(table, pk, event, decision);
  return true;
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

/** 财务子表 account_id 为 NOT NULL；上传前归一并拒绝空值，避免服务端 Column 'account_id' cannot be null */
function ensureFinanceAccountIdOnUploadBody(
  table: string,
  row: Record<string, unknown>,
  pk: string | null,
): Record<string, unknown> {
  if (table !== 'finance_transactions' && table !== 'finance_scheduled_expenses') return row;
  const fromSnake = row.account_id;
  const fromCamel = row.accountId;
  const aid =
    fromSnake != null && fromSnake !== ''
      ? String(fromSnake).trim()
      : fromCamel != null && fromCamel !== ''
        ? String(fromCamel).trim()
        : '';
  if (!aid) {
    // 必须抛普通 Error（非 ApiRowUploadSkippedError），否则 awaitSync 会静默跳过并误判成功
    throw new Error(`account_id 缺失，无法同步到服务器（表 ${table}，id: ${pk ?? 'unknown'}）`);
  }
  const out = { ...row, account_id: aid };
  delete out.accountId;
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
): Promise<'created' | 'updated' | 'deleted' | 'occ'> {
  let body = row;
  if (opts?.uploadedPkByTable && opts.fkRefs) {
    body = sanitizeRowForeignKeysForApiUpload(table, row, opts.uploadedPkByTable, opts.fkRefs);
  }
  const pk = rowPrimaryKeyValue(body, pkCols);
  body = ensureFinanceAccountIdOnUploadBody(table, body, pk);
  const pkCol = pkCols[0] ?? 'id';
  const mutationId = parseMutationId(body.mutation_id ?? body.mutationId);
  const occBody = attachPushOccFields(body);
  if (pk && mutationId) {
    await stampLastPushedMutation(table, pkCol, pk, mutationId);
  }

  if (body.sync_status === 'pending_delete') {
    if (!pk) {
      throw new ApiRowUploadSkippedError(table, null, '待删除行缺少主键');
    }
    try {
      await apiDeleteRecord(table, pk, {
        signal: opts?.signal,
        mutationId,
        expectedRev: occBody.expected_rev as number,
      });
      return 'deleted';
    } catch (e) {
      if (await applyPushOccConflict(table, pk, e)) return 'occ';
      if (e instanceof ApiRequestError && e.httpStatus === 404) {
        return 'deleted';
      }
      if (isGenericWriteForbiddenClientError(e) || isApiGenericWriteForbidden(table)) {
        throw new ApiRowUploadSkippedError(
          table,
          pk,
          e instanceof Error ? e.message : '高危表禁止通用删除，且专用接口未覆盖',
        );
      }
      throw e;
    }
  }

  const runUpsert = async (payload: Record<string, unknown>): Promise<'created' | 'updated' | 'occ'> => {
    const send = attachPushOccFields(payload);
    const status = String(payload.sync_status ?? body.sync_status ?? '');
    if (table === 'habit_check_ins') {
      return upsertHabitCheckInRowToApi(send, pk, opts?.signal, status);
    }
    if (table === 'points_wallet') {
      return upsertPointsWalletRowToApi(payload, pk, opts?.signal);
    }
    const doUpdate = async (): Promise<'updated' | 'occ'> => {
      if (!pk) throw new ApiRowUploadSkippedError(table, null, '待更新行缺少主键');
      try {
        await apiUpdateRecord(table, pk, send, { signal: opts?.signal });
        return 'updated';
      } catch (updateErr) {
        if (await applyPushOccConflict(table, pk, updateErr)) return 'occ';
        if (isGenericWriteForbiddenClientError(updateErr)) {
          throw new ApiRowUploadSkippedError(
            table,
            pk,
            updateErr instanceof Error ? updateErr.message : '高危表禁止通用写',
          );
        }
        throw updateErr;
      }
    };
    if (status === 'pending_update') {
      return doUpdate();
    }
    try {
      await apiCreateRecord(table, send, { signal: opts?.signal });
      return 'created';
    } catch (e) {
      if (await applyPushOccConflict(table, pk ?? '', e)) return 'occ';
      if (isGenericWriteForbiddenClientError(e)) {
        throw new ApiRowUploadSkippedError(
          table,
          pk,
          e instanceof Error ? e.message : '高危表禁止通用写',
        );
      }
      if (isDuplicateRecordApiError(e)) {
        return doUpdate();
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

  const tryUpsertReferencedParentTask = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'tasks' || !opts?.rowsByTable) return;
    const parentTaskId = payload.parent_task_id;
    if (parentTaskId == null || parentTaskId === '') return;

    const pid = String(parentTaskId);
    const parentRow = (opts.rowsByTable.get('tasks') ?? []).find(t => String(t.id) === pid);
    if (!parentRow) return;

    const taskPkCols = opts.pkColsByTable?.get('tasks') ?? ['id'];
    await upsertRowToApi('tasks', parentRow, taskPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('tasks') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('tasks')?.add(pid);
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

  const tryUpsertReferencedFinanceAccount = async (payload: Record<string, unknown>): Promise<void> => {
    if (
      (table !== 'finance_transactions' && table !== 'finance_scheduled_expenses') ||
      !opts?.rowsByTable
    ) {
      return;
    }
    const accountId = payload.account_id ?? payload.accountId;
    if (accountId == null || accountId === '') return;

    const aid = String(accountId);
    if (opts.uploadedPkByTable?.get('finance_accounts')?.has(aid)) return;

    let accountRow = (opts.rowsByTable.get('finance_accounts') ?? []).find(a => String(a.id) === aid);
    if (!accountRow) {
      const { getDatabase } = await import('@/lib/database');
      const db = await getDatabase();
      if (db) {
        const fresh = await db.getFirstAsync<Record<string, unknown>>(
          'SELECT * FROM finance_accounts WHERE id = ? AND sync_status != ? LIMIT 1',
          [aid, 'pending_delete'],
        );
        if (fresh) {
          accountRow = fresh;
          const accountRows = opts.rowsByTable.get('finance_accounts') ?? [];
          accountRows.push(fresh);
          opts.rowsByTable.set('finance_accounts', accountRows);
        }
      }
    }
    if (!accountRow) return;

    const accountPkCols = opts.pkColsByTable?.get('finance_accounts') ?? ['id'];
    await upsertRowToApi('finance_accounts', accountRow, accountPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('finance_accounts') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    const uploaded = opts.uploadedPkByTable?.get('finance_accounts') ?? new Set<string>();
    uploaded.add(aid);
    opts.uploadedPkByTable?.set('finance_accounts', uploaded);
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

  try {
    return await runUpsert(body);
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (e instanceof ApiRowUploadSkippedError) throw e;
    if (isGenericWriteForbiddenClientError(e)) {
      throw new ApiRowUploadSkippedError(
        table,
        pk,
        e instanceof Error ? e.message : '高危表禁止通用写',
      );
    }
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
        if (table === 'finance_transactions' || table === 'finance_scheduled_expenses') {
          await tryUpsertReferencedFinanceAccount(body);
        }
        if (table === 'tasks') {
          await tryUpsertReferencedTaskCategory(body);
          await tryUpsertReferencedProject(body);
          await tryUpsertReferencedParentTask(body);
        }
        if (table === 'projects') await tryUpsertReferencedProjectCategory(body);
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

  const { getDatabase } = await import('@/lib/database');
  const db = await getDatabase();

  for (const aid of accountIds) {
    if (uploadedAccounts.has(aid)) continue;
    let accountRow = accountRows.find(a => String(a.id) === aid);
    if (!accountRow && db) {
      // bundle 可能漏带已 synced 账户：再读一次本地，避免流水先上传导致服务端「账户不存在」
      const fresh = await db.getFirstAsync<Record<string, unknown>>(
        'SELECT * FROM finance_accounts WHERE id = ? AND sync_status != ? LIMIT 1',
        [aid, 'pending_delete'],
      );
      if (fresh) {
        accountRow = fresh;
        accountRows.push(fresh);
        rowsByTable.set('finance_accounts', accountRows);
      }
    }
    if (!accountRow) {
      // 本地缺账户行时不阻断流水上传：账户权威在服务端；余额校正等写路径已直连专用接口。
      // 若服务端也无该账户，后续 POST 流水会返回明确错误。
      if (__DEV__) {
        console.warn(
          '[api-sync] 关联账户本地不存在，假定服务端已有，跳过预传',
          aid,
        );
      }
      uploadedAccounts.add(aid);
      continue;
    }
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
        // 跳过会导致后续流水在服务端报「账户不存在」；必须失败以便重试
        throw new Error(
          `关联账户「${String(accountRow.name ?? aid)}」未能同步到服务器：${e.message}`,
        );
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

/** 子任务上传前先确保 parent_task_id 指向的父任务已入库（含 pending 父任务） */
export async function upsertParentTasksReferencedByTasks(
  taskRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  const parentIds = new Set<string>();
  for (const task of taskRows) {
    const pid = task.parent_task_id;
    if (pid != null && pid !== '') parentIds.add(String(pid));
  }
  if (parentIds.size === 0) return;

  const taskTableRows = rowsByTable.get('tasks') ?? [];
  const taskPkCols = pkColsByTable.get('tasks') ?? ['id'];
  const uploadedTasks = uploadedPkByTable.get('tasks') ?? new Set<string>();
  uploadedPkByTable.set('tasks', uploadedTasks);

  for (const pid of parentIds) {
    if (uploadedTasks.has(pid)) continue;
    const parentRow = taskTableRows.find(t => String(t.id) === pid);
    if (!parentRow) continue;
    await upsertRowToApi('tasks', parentRow, taskPkCols, {
      signal,
      uploadedPkByTable,
      fkRefs: fkRefsByTable.get('tasks') ?? [],
      rowsByTable,
      pkColsByTable,
      fkRefsByTable,
    });
    uploadedTasks.add(pid);
  }
}

export { rowPrimaryKeyValue };

