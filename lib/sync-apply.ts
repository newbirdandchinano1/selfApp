import { getDatabase } from '@/lib/database.native';
import {
  fingerprintOf,
  type ApplyDecision,
  type LocalRowState,
  type PullEvent,
} from '@/lib/sync-apply-core';

export {
  allowAlignCursor,
  allowBootstrapDone,
  decide,
  decidePushSuccess,
  emptyLocal,
  fingerprintOf,
  localOwnMutationIds,
  shouldDeleteSyncedAbsent,
  shouldSkipSnapshotRow,
  shouldSkipStaleFetchPk,
  type ApplyDecision,
  type LocalRowState,
  type PullEvent,
  type PullOp,
} from '@/lib/sync-apply-core';

type ColMeta = { names: Set<string>; notNull: Set<string> };

async function getColMeta(db: any, table: string): Promise<ColMeta> {
  const rows = await db.getAllAsync<any>(`PRAGMA table_info(\`${table}\`)`);
  const names = new Set<string>();
  const notNull = new Set<string>();
  for (const r of rows ?? []) {
    const name = String(r.name);
    names.add(name);
    // pk 列在 SQLite 里 notnull 标志可能为 0，但仍不可空
    if (Number(r.notnull) === 1 || Number(r.pk) === 1) notNull.add(name);
  }
  return { names, notNull };
}

async function getCols(db: any, table: string): Promise<Set<string>> {
  return (await getColMeta(db, table)).names;
}

async function resolvePkCol(db: any, table: string): Promise<string> {
  try {
    const rows = await db.getAllAsync<any>(`PRAGMA table_info(\`${table}\`)`);
    const pk = (rows ?? []).find((r: any) => Number(r.pk) === 1);
    if (pk?.name) return String(pk.name);
  } catch {}
  return 'id';
}

/** SQLite bind 只接受标量；服务端 JSON 列常以 object 下发 */
function sqliteBindValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function readLocalRowState(table: string, pk: string): Promise<LocalRowState> {
  const db = await getDatabase();
  const pkCol = await resolvePkCol(db, table);
  try {
    const cols = await getCols(db, table);
    const sel: string[] = [`\`${pkCol}\``];
    if (cols.has('sync_status')) sel.push('`sync_status`');
    if (cols.has('server_rev')) sel.push('`server_rev`');
    if (cols.has('mutation_id')) sel.push('`mutation_id`');
    if (cols.has('last_pushed_mutation_id')) sel.push('`last_pushed_mutation_id`');
    const rows = await db.getAllAsync<any>(
      `SELECT ${sel.join(',')} FROM \`${table}\` WHERE \`${pkCol}\` = ? LIMIT 1`,
      [pk],
    );
    const r = rows?.[0] as any;
    if (r) {
      return {
        exists: true,
        sync_status: (r.sync_status as string) ?? null,
        server_rev: Number(r.server_rev ?? 0) || 0,
        mutation_id: (r.mutation_id as string) ?? null,
        last_pushed_mutation_id: (r.last_pushed_mutation_id as string) ?? null,
        fingerprint: fingerprintOf(r as Record<string, unknown>),
      };
    }
  } catch {}
  return { exists: false, sync_status: null, server_rev: 0, mutation_id: null, last_pushed_mutation_id: null, fingerprint: '' };
}

export async function applyOneEvent(table: string, pk: string, event: PullEvent, decision: ApplyDecision): Promise<void> {
  // 服务端权威落库：不得 mark 脏表 / 清页面会话，否则回前台 pull 会连环触发「正在同步数据…」
  const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
    '@/lib/cloud-sql-dirty-track'
  );
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    const db = await getDatabase();
    const pkCol = await resolvePkCol(db, table);
    const cols = await getCols(db, table);
    const hasRev = cols.has('server_rev');
    if (decision === 'IGNORE') return;
    if (decision === 'ACK_REBASE') {
      if (hasRev && event.serverRev != null) {
        await db.runAsync(`UPDATE \`${table}\` SET \`server_rev\` = ? WHERE \`${pkCol}\` = ?`, [event.serverRev, pk]);
      }
      if (cols.has('last_pushed_mutation_id')) {
        try {
          await db.runAsync(`UPDATE \`${table}\` SET \`last_pushed_mutation_id\` = NULL WHERE \`${pkCol}\` = ?`, [pk]);
        } catch {}
      }
      return;
    }
    if (decision === 'ACK_EXACT') {
      if (event.op === 'delete') {
        await db.runAsync(`DELETE FROM \`${table}\` WHERE \`${pkCol}\` = ?`, [pk]);
        return;
      }
      if (hasRev) {
        await db.runAsync(
          `UPDATE \`${table}\` SET \`sync_status\`='synced', \`server_rev\`=?, \`mutation_id\`=NULL, \`last_pushed_mutation_id\`=NULL WHERE \`${pkCol}\` = ?`,
          [event.serverRev ?? 0, pk],
        );
      } else {
        await db.runAsync(`UPDATE \`${table}\` SET \`sync_status\`='synced' WHERE \`${pkCol}\` = ?`, [pk]);
      }
      return;
    }
    if (event.op === 'delete') {
      await db.runAsync(`DELETE FROM \`${table}\` WHERE \`${pkCol}\` = ?`, [pk]);
      return;
    }
    if (event.row) {
      await upsertRowFromServer(db, table, pkCol, cols, event.row, event.serverRev ?? 0);
    } else if (decision === 'APPLY_SERVER') {
      await db.runAsync(`DELETE FROM \`${table}\` WHERE \`${pkCol}\` = ?`, [pk]);
    }
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

async function upsertRowFromServer(db: any, table: string, pkCol: string, cols: Set<string>, row: Record<string, unknown>, rev: number): Promise<void> {
  // 与 REST 落库共用 sanitize：补 user_id 等 NOT NULL、压平 JSON 字段；禁止网络拉父行，避免同步风暴
  const { sanitizeRowForLocalSeed } = await import('@/lib/api-local-row-seed');
  const sanitized = await sanitizeRowForLocalSeed(table, { ...row }, { allowNetwork: false });
  const { notNull } = await getColMeta(db, table);

  // 服务端新增列（如 tasks.frog_assigned_on）老端本地表尚无该列时必须过滤，否则 prepareAsync 报 no such column
  const keys = Object.keys(sanitized).filter(
    (k) => k !== 'sync_status' && k !== 'last_pushed_mutation_id' && cols.has(k),
  );
  if (!keys.includes(pkCol)) return;

  // 父行尚未落库时：可空外键置空；NOT NULL 外键则跳过本行，等父行到达后再 apply
  const FK_PARENTS: Array<[string, string]> = [
    ['task_id', 'tasks'],
    ['project_id', 'projects'],
    ['habit_id', 'habits'],
    ['tag_id', 'tags'],
    ['account_id', 'finance_accounts'],
    ['parent_task_id', 'tasks'],
    ['user_id', 'users'],
    ['flow_category_id', 'finance_flow_categories'],
    ['category_id', 'task_categories'],
  ];
  for (const [fkCol, parentTable] of FK_PARENTS) {
    if (!keys.includes(fkCol)) continue;
    const fkVal = sanitized[fkCol];
    if (fkVal == null || fkVal === '') {
      if (notNull.has(fkCol)) return;
      continue;
    }
    try {
      const parentCols = await getCols(db, parentTable);
      if (parentCols.size === 0) continue;
      const parentPk = await resolvePkCol(db, parentTable);
      const hit = await db.getFirstAsync(
        `SELECT \`${parentPk}\` FROM \`${parentTable}\` WHERE \`${parentPk}\` = ? LIMIT 1`,
        [fkVal],
      );
      if (!hit) {
        if (notNull.has(fkCol)) {
          if (__DEV__) {
            console.warn(
              `[sync-apply] skip ${table}: missing NOT NULL parent ${parentTable}=${String(fkVal)}`,
            );
          }
          return;
        }
        sanitized[fkCol] = null;
      }
    } catch {
      if (notNull.has(fkCol)) return;
    }
  }

  const placeholders = keys.map(() => '?').join(',');
  const vals = keys.map((k) => sqliteBindValue(sanitized[k]));
  const updates = keys.filter((k) => k !== pkCol).map((k) => `\`${k}\`=excluded.\`${k}\``).join(',');
  const extra = [
    cols.has('sync_status') ? `, \`sync_status\`='synced'` : '',
    cols.has('server_rev') ? `, \`server_rev\`=${Number(rev) || 0}` : '',
    cols.has('mutation_id') ? `, \`mutation_id\`=NULL` : '',
    cols.has('last_pushed_mutation_id') ? `, \`last_pushed_mutation_id\`=NULL` : '',
  ].join('');
  if (!updates && !extra) return;
  await db.runAsync(
    `INSERT INTO \`${table}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders}) ON CONFLICT(\`${pkCol}\`) DO UPDATE SET ${updates}${extra}`,
    vals,
  );
}
