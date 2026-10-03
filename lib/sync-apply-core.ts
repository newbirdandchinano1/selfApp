/**
 * 纯判定：Pull 2.4.1 / Push 2.4.2 / Bootstrap 快照 overlay / 四段闸门。
 * 无 SQLite、无 device_id 分支。
 */

export type PullOp = 'upsert' | 'delete';

export type LocalRowState = {
  exists: boolean;
  sync_status: string | null;
  server_rev: number;
  mutation_id: string | null;
  last_pushed_mutation_id: string | null;
  fingerprint: string;
};

export type PullEvent = {
  id: number;
  table: string;
  pk: string;
  op: PullOp;
  serverRev: number | null;
  mutationId: string | null;
  row: Record<string, unknown> | null;
};

export type ApplyDecision = 'APPLY_SERVER' | 'IGNORE' | 'ACK_EXACT' | 'ACK_REBASE' | 'SERVER_WINS';

export function localOwnMutationIds(local: LocalRowState): Set<string> {
  const s = new Set<string>();
  if (local.mutation_id) s.add(local.mutation_id);
  if (local.last_pushed_mutation_id) s.add(local.last_pushed_mutation_id);
  return s;
}

export function fingerprintOf(row: Record<string, unknown> | null): string {
  if (!row) return '';
  try {
    return JSON.stringify(row);
  } catch {
    return String(row);
  }
}

export function emptyLocal(): LocalRowState {
  return {
    exists: false,
    sync_status: null,
    server_rev: 0,
    mutation_id: null,
    last_pushed_mutation_id: null,
    fingerprint: '',
  };
}

/** 2.4.1 有序判定。禁止读取 deviceId。 */
export function decide(local: LocalRowState, event: PullEvent): ApplyDecision {
  const own = localOwnMutationIds(local);
  const isPendingCreate = local.sync_status === 'pending_create';
  const isSynced = !local.exists || local.sync_status === 'synced' || local.sync_status == null;
  if (isPendingCreate && event.op === 'delete' && !(event.mutationId && own.has(event.mutationId))) {
    return 'IGNORE';
  }
  if (isSynced) return 'APPLY_SERVER';
  const evRev = event.serverRev ?? 0;
  if (evRev <= local.server_rev) return 'IGNORE';
  if (event.mutationId && own.has(event.mutationId)) {
    const exactPending = event.mutationId === local.mutation_id;
    const contentMoved = event.op === 'upsert' && local.fingerprint !== fingerprintOf(event.row);
    if (exactPending && !contentMoved) return 'ACK_EXACT';
    return 'ACK_REBASE';
  }
  if (evRev > local.server_rev) return 'SERVER_WINS';
  return 'SERVER_WINS';
}

/** 2.4.2 成功 2xx：mutation 命中则 B-ack / B-rebase；否则保持 pending。 */
export function decidePushSuccess(
  local: LocalRowState,
  body: { mutationId: string | null; serverRev: number | null },
): ApplyDecision | 'KEEP_PENDING' {
  const own = localOwnMutationIds(local);
  if (!body.mutationId || !own.has(body.mutationId)) return 'KEEP_PENDING';
  if (local.mutation_id === body.mutationId) return 'ACK_EXACT';
  return 'ACK_REBASE';
}

/** Bootstrap 快照：pending_* 整行不动；空缺与 synced 才写快照。 */
export function shouldSkipSnapshotRow(
  localExists: boolean,
  syncStatus: string | null | undefined,
): boolean {
  if (!localExists) return false;
  return String(syncStatus) !== 'synced';
}

/** synced 且快照无 pk → 删除；pending 不得因缺 pk 删除。 */
export function shouldDeleteSyncedAbsent(
  syncStatus: string | null | undefined,
  pkInSnapshot: boolean,
): boolean {
  return String(syncStatus) === 'synced' && !pkInSnapshot;
}

export function allowAlignCursor(snapshotComplete: boolean): boolean {
  return snapshotComplete === true;
}

export function allowBootstrapDone(args: {
  snapshotComplete: boolean;
  cursorAligned: boolean;
  windowPullSucceeded: boolean;
  needFullSync: boolean;
}): boolean {
  return (
    args.snapshotComplete &&
    args.cursorAligned &&
    args.windowPullSucceeded &&
    !args.needFullSync
  );
}

/** 场景 8：generation 已 bump 或 fetch 期间该 pk 又变 pending 内容 → 跳过。 */
export function shouldSkipStaleFetchPk(opts: {
  fetchGeneration: number;
  currentGeneration: number;
  localPending: boolean;
  contentChangedSinceFetch: boolean;
}): boolean {
  if (opts.currentGeneration !== opts.fetchGeneration) return true;
  if (opts.localPending && opts.contentChangedSinceFetch) return true;
  return false;
}
