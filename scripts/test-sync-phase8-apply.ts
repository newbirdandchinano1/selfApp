/**
 * Phase 8：Pull 2.4 A/B/C、Push 回声、bootstrap overlay、四段闸门（纯函数）。
 * 运行：npm run test:sync-phase8-apply
 */
import {
  allowAlignCursor,
  allowBootstrapDone,
  decide,
  decidePushSuccess,
  emptyLocal,
  fingerprintOf,
  shouldDeleteSyncedAbsent,
  shouldSkipSnapshotRow,
  shouldSkipStaleFetchPk,
  type LocalRowState,
  type PullEvent,
} from '../lib/sync-apply-core.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function row(title: string): Record<string, unknown> {
  return { id: 'pk1', title };
}

function pending(partial: Partial<LocalRowState> & Pick<LocalRowState, 'sync_status'>): LocalRowState {
  const content = row('local');
  return {
    exists: true,
    server_rev: 100,
    mutation_id: 'mut-current',
    last_pushed_mutation_id: 'mut-pushed',
    fingerprint: fingerprintOf(content),
    ...partial,
  };
}

function event(partial: Partial<PullEvent> & Pick<PullEvent, 'op'>): PullEvent {
  return {
    id: 1,
    table: 'tasks',
    pk: 'pk1',
    serverRev: 101,
    mutationId: 'mut-other',
    row: row('server'),
    ...partial,
  };
}

function main(): void {
  console.log('=== Phase 8: apply A/B/C + bootstrap overlay + gate ===\n');

  console.log('--- 2.4.1 步骤 0–5 ---\n');
  check(
    '步骤0 pending_create vs 他端旧 delete → IGNORE',
    decide(pending({ sync_status: 'pending_create', server_rev: 0, last_pushed_mutation_id: null }), event({
      op: 'delete',
      mutationId: 'mut-other',
      serverRev: 50,
      row: null,
    })) === 'IGNORE',
  );
  check(
    '步骤1 无本地行 upsert → APPLY_SERVER',
    decide(emptyLocal(), event({ op: 'upsert' })) === 'APPLY_SERVER',
  );
  check(
    '步骤1 synced delete → APPLY_SERVER',
    decide(pending({ sync_status: 'synced', mutation_id: null, last_pushed_mutation_id: null }), event({
      op: 'delete',
      row: null,
    })) === 'APPLY_SERVER',
  );
  check(
    '步骤2 pending + 过期 rev → IGNORE (B-stale)',
    decide(pending({ sync_status: 'pending_update' }), event({
      op: 'upsert',
      serverRev: 99,
      mutationId: 'mut-other',
    })) === 'IGNORE',
  );
  const ackRow = row('local');
  check(
    '步骤3 B-ack：mutation 命中且内容未变 → ACK_EXACT',
    decide(
      pending({
        sync_status: 'pending_update',
        last_pushed_mutation_id: 'mut-current',
        fingerprint: fingerprintOf(ackRow),
      }),
      event({ op: 'upsert', mutationId: 'mut-current', row: ackRow, serverRev: 101 }),
    ) === 'ACK_EXACT',
  );
  check(
    '步骤3 B-rebase：last_pushed 命中但当前 mutation 已换',
    decide(
      pending({
        sync_status: 'pending_update',
        mutation_id: 'mut-newer',
        last_pushed_mutation_id: 'mut-pushed',
      }),
      event({ op: 'upsert', mutationId: 'mut-pushed', serverRev: 101 }),
    ) === 'ACK_REBASE',
  );
  check(
    '步骤3 B-rebase：ack 到达时内容又改',
    decide(
      pending({
        sync_status: 'pending_update',
        fingerprint: fingerprintOf(row('edited-again')),
      }),
      event({
        op: 'upsert',
        mutationId: 'mut-current',
        row: row('local'),
        serverRev: 101,
      }),
    ) === 'ACK_REBASE',
  );
  check(
    '步骤4 C：rev 更大且非本机 mutation → SERVER_WINS',
    decide(pending({ sync_status: 'pending_update' }), event({
      op: 'upsert',
      mutationId: 'mut-other',
      serverRev: 200,
    })) === 'SERVER_WINS',
  );
  check(
    '步骤5 无 mutationId 且 rev 更大 → SERVER_WINS（当 C）',
    decide(pending({ sync_status: 'pending_update' }), event({
      op: 'upsert',
      mutationId: null,
      serverRev: 200,
    })) === 'SERVER_WINS',
  );
  check(
    'pending_delete 本机回声 → ACK_EXACT',
    decide(
      pending({ sync_status: 'pending_delete', mutation_id: 'mut-del', last_pushed_mutation_id: 'mut-del' }),
      event({ op: 'delete', mutationId: 'mut-del', row: null, serverRev: 101 }),
    ) === 'ACK_EXACT',
  );
  check(
    'pending_update vs 他端 delete 更大 rev → SERVER_WINS',
    decide(pending({ sync_status: 'pending_update' }), event({
      op: 'delete',
      mutationId: 'mut-other',
      row: null,
      serverRev: 200,
    })) === 'SERVER_WINS',
  );

  console.log('\n--- 2.4.2 Push 成功回声 ---\n');
  check(
    'Push 2xx mutation 仍是当前 → ACK_EXACT',
    decidePushSuccess(pending({ sync_status: 'pending_update', last_pushed_mutation_id: 'mut-current' }), {
      mutationId: 'mut-current',
      serverRev: 101,
    }) === 'ACK_EXACT',
  );
  check(
    'Push 2xx 时已换成新 mutation → ACK_REBASE',
    decidePushSuccess(
      pending({
        sync_status: 'pending_update',
        mutation_id: 'mut-newer',
        last_pushed_mutation_id: 'mut-pushed',
      }),
      { mutationId: 'mut-pushed', serverRev: 101 },
    ) === 'ACK_REBASE',
  );
  check(
    'Push 响应 mutation 对不上 → KEEP_PENDING',
    decidePushSuccess(pending({ sync_status: 'pending_update' }), {
      mutationId: 'mut-stranger',
      serverRev: 101,
    }) === 'KEEP_PENDING',
  );
  check(
    '网络失败无 body → KEEP_PENDING',
    decidePushSuccess(pending({ sync_status: 'pending_create' }), {
      mutationId: null,
      serverRev: null,
    }) === 'KEEP_PENDING',
  );

  console.log('\n--- Bootstrap overlay（不做 A/B/C）---\n');
  check('无本地行 → 写入快照', shouldSkipSnapshotRow(false, null) === false);
  check('synced → 覆盖快照', shouldSkipSnapshotRow(true, 'synced') === false);
  check('pending_create → 整行不动', shouldSkipSnapshotRow(true, 'pending_create') === true);
  check('pending_update → 整行不动', shouldSkipSnapshotRow(true, 'pending_update') === true);
  check('pending_delete → 整行不动', shouldSkipSnapshotRow(true, 'pending_delete') === true);
  check('synced 且快照无 pk → 删', shouldDeleteSyncedAbsent('synced', false) === true);
  check('synced 且快照有 pk → 不删', shouldDeleteSyncedAbsent('synced', true) === false);
  check('pending 且快照无 pk → 不删', shouldDeleteSyncedAbsent('pending_create', false) === false);

  console.log('\n--- 四段闸门 ---\n');
  check('snapshotComplete 前禁止写 cursor', allowAlignCursor(false) === false);
  check('snapshotComplete 后允许写 cursor', allowAlignCursor(true) === true);
  check(
    '跳过 pull 不得 bootstrap_done',
    allowBootstrapDone({
      snapshotComplete: true,
      cursorAligned: true,
      windowPullSucceeded: false,
      needFullSync: false,
    }) === false,
  );
  check(
    'cursor 未对齐不得 done',
    allowBootstrapDone({
      snapshotComplete: true,
      cursorAligned: false,
      windowPullSucceeded: true,
      needFullSync: false,
    }) === false,
  );
  check(
    'needFullSync 不得 done',
    allowBootstrapDone({
      snapshotComplete: true,
      cursorAligned: true,
      windowPullSucceeded: true,
      needFullSync: true,
    }) === false,
  );
  check(
    '四段齐全才 done',
    allowBootstrapDone({
      snapshotComplete: true,
      cursorAligned: true,
      windowPullSucceeded: true,
      needFullSync: false,
    }) === true,
  );

  console.log('\n--- 场景 8 旧请求 ---\n');
  check(
    'generation bump → 跳过整批',
    shouldSkipStaleFetchPk({
      fetchGeneration: 1,
      currentGeneration: 2,
      localPending: false,
      contentChangedSinceFetch: false,
    }) === true,
  );
  check(
    'fetch 期间 pending 内容已变 → 跳过该 pk',
    shouldSkipStaleFetchPk({
      fetchGeneration: 1,
      currentGeneration: 1,
      localPending: true,
      contentChangedSinceFetch: true,
    }) === true,
  );
  check(
    'generation 未变且内容未动 → 可 apply',
    shouldSkipStaleFetchPk({
      fetchGeneration: 1,
      currentGeneration: 1,
      localPending: true,
      contentChangedSinceFetch: false,
    }) === false,
  );

  console.log(`\n=== 结果：${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
