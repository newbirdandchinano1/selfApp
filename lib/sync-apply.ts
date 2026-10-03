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

async function getCols(db: any, table: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<any>(`PRAGMA table_info(\`${table}\`)`);
  return new Set((rows ?? []).map((r: any) => String(r.name)));
}

async function resolvePkCol(db: any, table: string): Promise<string> {
  try {
    const rows = await db.getAllAsync<any>(`PRAGMA table_info(\`${table}\`)`);
    const pk = (rows ?? []).find((r: any) => Number(r.pk) === 1);
    if (pk?.name) return String(pk.name);
  } catch {}
  return 'id';
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
}

async function upsertRowFromServer(db: any, table: string, pkCol: string, cols: Set<string>, row: Record<string, unknown>, rev: number): Promise<void> {
  // 服务端新增列（如 tasks.frog_assigned_on）老端本地表尚无该列时必须过滤，否则 prepareAsync 报 no such column
  const keys = Object.keys(row).filter((k) => k !== 'sync_status' && k !== 'last_pushed_mutation_id' && cols.has(k));
  if (!keys.includes(pkCol)) return;
  // 父行尚未落库时将可空外键置空（task_execution_events.task_id 等为 SET NULL 语义），避免 FOREIGN KEY constraint failed；
  // 父行到达后的后续事件会把真实引用带回来
  const FK_PARENTS: Array<[string, string]> = [
    ['task_id', 'tasks'],
    ['project_id', 'projects'],
    ['habit_id', 'habits'],
    ['tag_id', 'tags'],
    ['account_id', 'finance_accounts'],
    ['parent_task_id', 'tasks'],
  ];
  for (const [fkCol, parentTable] of FK_PARENTS) {
    if (!keys.includes(fkCol)) continue;
    const fkVal = (row as any)[fkCol];
    if (fkVal == null || fkVal === '') continue;
    try {
      const parentCols = await getCols(db, parentTable);
      if (parentCols.size === 0) continue;
      const parentPk = await resolvePkCol(db, parentTable);
      const hit = await db.getFirstAsync(`SELECT \`${parentPk}\` FROM \`${parentTable}\` WHERE \`${parentPk}\` = ? LIMIT 1`, [fkVal]);
      if (!hit) (row as any)[fkCol] = null;
    } catch {}
  }
  const placeholders = keys.map(() => '?').join(',');
  const vals = keys.map((k) => (row as any)[k] ?? null);
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
