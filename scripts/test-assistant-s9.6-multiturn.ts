/**
 * S9.6：多轮草稿 / 幂等 / 超时核实 / sync_status。
 * 覆盖 §14 用例 7、9、10 + 至少两域改稿与幂等。
 * 运行：npm run test:assistant-s9.6
 */
import assert from 'node:assert/strict';

import { parseActionCard } from '../lib/assistant/action-card';
import { ChatCommitExecutor } from '../lib/assistant/chat-commit';
import {
  confirmChatCommit,
  patchChatCommitDraft,
  resolveOperationId,
} from '../lib/assistant/chat-commit-controller';
import {
  collectPendingOperations,
  looksLikeDraftAmendment,
  looksLikeNewSiblingWrite,
  reconcileIncomingCommitCards,
} from '../lib/assistant/commit-reconcile';
import {
  formatCommitResultBubble,
  formatSyncStatusLabel,
} from '../lib/assistant/commit-result';
import type { ChatSession } from '../lib/assistant/chat-types';
import {
  COMMIT_STALE_MS,
  WriteOperationStore,
} from '../lib/assistant/write-operation';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

function card(partial: Record<string, unknown>) {
  const c = parseActionCard({
    id: 'c_lunch',
    domain: 'finance',
    intent: 'create',
    title: '记一笔',
    confidence: 0.9,
    needs_confirm: true,
    confirm_action: 'commit_finance_txn',
    operation_id: 'op_lunch',
    idempotency_key: 'op_lunch',
    write_status: 'awaiting_confirmation',
    draft: { name: '午饭', amount: 18 },
    draft_fields: [
      { key: 'name', label: '名称', value: '午饭', editable: true },
      { key: 'amount', label: '金额', value: '18', editable: true },
    ],
    ...partial,
  });
  assert.ok(c);
  return c!;
}

function sessionWithCards(cards: NonNullable<ReturnType<typeof parseActionCard>>[]): ChatSession {
  const now = Date.now();
  return {
    id: 'cs_s96',
    title: 'S9.6',
    remoteSessionId: null,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: 'cm_a',
        role: 'assistant',
        createdAt: now,
        status: 'done',
        parts: cards.map(c => ({ type: 'action_card' as const, card: c })),
      },
    ],
  };
}

check('用例7 信号：改成20 识别为改稿', () => {
  assert.equal(looksLikeDraftAmendment('改成20'), true);
  assert.equal(looksLikeDraftAmendment('把金额改为20元'), true);
  assert.equal(looksLikeDraftAmendment('再记一笔晚饭25'), false);
});

check('用例9 信号：再记一笔 识别为新草稿', () => {
  assert.equal(looksLikeNewSiblingWrite('再记一笔晚饭25'), true);
  assert.equal(looksLikeNewSiblingWrite('另外记一笔咖啡'), true);
  assert.equal(looksLikeNewSiblingWrite('改成20'), false);
});

check('用例7：改稿同 operation_id 不双建', () => {
  const open = card({});
  const session = sessionWithCards([open]);
  const incoming = card({
    id: 'c_new_wrong',
    operation_id: 'op_other',
    draft: { name: '午饭', amount: 20 },
    draft_fields: [
      { key: 'name', label: '名称', value: '午饭', editable: true },
      { key: 'amount', label: '金额', value: '20', editable: true },
    ],
  })!;
  const { session: next, cards } = reconcileIncomingCommitCards({
    session,
    incoming: [incoming],
    userMessage: '改成20',
  });
  assert.equal(cards.length, 0, '改稿不应再追加新卡');
  const parts = next.messages[0].parts;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'action_card');
  if (parts[0].type !== 'action_card') throw new Error('expected card');
  assert.equal(resolveOperationId(parts[0].card), 'op_lunch');
  assert.equal(parts[0].card.draft?.amount, 20);
  assert.equal(parts[0].card.id, 'c_lunch');
});

check('用例9：再记一笔开新 operation_id', () => {
  const open = card({});
  const session = sessionWithCards([open]);
  const dinner = card({
    id: 'c_dinner',
    operation_id: 'op_dinner',
    idempotency_key: 'op_dinner',
    title: '晚饭',
    draft: { name: '晚饭', amount: 25 },
  })!;
  const { session: next, cards } = reconcileIncomingCommitCards({
    session,
    incoming: [dinner],
    userMessage: '再记一笔晚饭25',
  });
  assert.equal(cards.length, 1);
  assert.equal(resolveOperationId(cards[0]), 'op_dinner');
  // 原卡仍在
  const first = next.messages[0].parts[0];
  assert.equal(first.type, 'action_card');
  if (first.type === 'action_card') {
    assert.equal(resolveOperationId(first.card), 'op_lunch');
  }
});

check('pending_operations 收集未确认卡', () => {
  const session = sessionWithCards([card({}), card({
    id: 'c_memo',
    domain: 'memo',
    confirm_action: 'commit_memo',
    operation_id: 'op_memo',
    idempotency_key: 'op_memo',
    title: '备忘',
    draft: { title: '买菜' },
  })]);
  const pending = collectPendingOperations(session);
  assert.equal(pending.length, 2);
  assert.ok(pending.some(p => p.operation_id === 'op_lunch'));
  assert.ok(pending.some(p => p.operation_id === 'op_memo' && p.domain === 'memo'));
});

check('sync_status 文案诚实', () => {
  assert.match(formatSyncStatusLabel('sync_failed'), /同步待重试/);
  assert.match(formatSyncStatusLabel('pending'), /同步进行中/);
  assert.match(formatSyncStatusLabel('synced'), /已保存并同步/);
  const bubble = formatCommitResultBubble({
    status: 'succeeded',
    title: '午饭',
    result: { entity_id: 't1', sync_status: 'sync_failed', message: '已记一笔' },
  });
  assert.match(bubble, /同步待重试/);
});

async function main() {
await checkAsync('用例10：连续确认幂等不双写（finance）', async () => {
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let calls = 0;
  executor.register('commit_finance_txn', async () => {
    calls += 1;
    return { ok: true, entity_id: `txn_${calls}`, sync_status: 'pending', message: '已记账' };
  });
  const c = card({});
  let session = sessionWithCards([c]);
  const r1 = await confirmChatCommit({ session, card: c, store, executor });
  session = r1.session;
  assert.equal(r1.skipped, false);
  assert.equal(calls, 1);
  const r2 = await confirmChatCommit({
    session,
    card: parseActionCard({
      ...c,
      write_status: 'succeeded',
      result: r1.op?.result,
    })!,
    store,
    executor,
  });
  assert.equal(r2.skipped, true);
  assert.equal(calls, 1);
  // journal 命中
  const r3 = await confirmChatCommit({
    session: r2.session,
    card: card({ write_status: 'awaiting_confirmation' }),
    store,
    executor,
  });
  // store 已 succeeded → beginCommit 跳过
  assert.equal(r3.skipped, true);
  assert.equal(calls, 1);
});

await checkAsync('两域：memo 改稿 + 幂等', async () => {
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let calls = 0;
  executor.register('commit_memo', async input => {
    calls += 1;
    return {
      ok: true,
      entity_id: 'm1',
      sync_status: 'sync_failed',
      message: `备忘已保存：${String(input.draft.title || '')}`,
    };
  });
  const memo = card({
    id: 'c_memo',
    domain: 'memo',
    confirm_action: 'commit_memo',
    operation_id: 'op_memo',
    idempotency_key: 'op_memo',
    title: '备忘',
    draft: { title: '买菜' },
    draft_fields: [{ key: 'title', label: '标题', value: '买菜', editable: true }],
  })!;
  let session = sessionWithCards([memo]);
  const patched = patchChatCommitDraft({
    session,
    card: memo,
    patches: [{ key: 'title', value: '买水果' }],
    store,
  });
  session = patched.session;
  assert.equal(patched.op?.draft.title, '买水果');

  const r1 = await confirmChatCommit({
    session,
    card: parseActionCard({
      ...memo,
      draft: { title: '买水果' },
    })!,
    store,
    executor,
  });
  assert.equal(calls, 1);
  assert.equal(r1.op?.result?.sync_status, 'sync_failed');
  const bubble = formatCommitResultBubble({
    status: 'succeeded',
    result: r1.op?.result,
  });
  assert.match(bubble, /同步待重试|买水果/);

  const r2 = await confirmChatCommit({
    session: r1.session,
    card: memo,
    store,
    executor,
  });
  assert.equal(r2.skipped, true);
  assert.equal(calls, 1);
});

await checkAsync('超时核实：journal 已成功则禁止盲目再 create', async () => {
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let calls = 0;
  executor.register('commit_finance_txn', async () => {
    calls += 1;
    return { ok: true, entity_id: 'txn_x', sync_status: 'pending', message: 'ok' };
  });
  const c = card({});
  store.upsertFromCard({
    operation_id: 'op_lunch',
    confirm_action: 'commit_finance_txn',
    domain: 'finance',
    draft: { name: '午饭', amount: 18 },
    idempotency_key: 'op_lunch',
    write_status: 'awaiting_confirmation',
  });
  // 模拟首次执行写入 journal，但 store 卡在 committing
  await executor.execute({
    confirm_action: 'commit_finance_txn',
    operation_id: 'op_lunch',
    idempotency_key: 'op_lunch',
    draft: { name: '午饭', amount: 18 },
  });
  assert.equal(calls, 1);
  store.beginCommit('op_lunch');
  const stuck = store.get('op_lunch')!;
  assert.equal(stuck.status, 'committing');
  // 拨回时间戳制造超时
  (stuck as { commitStartedAt?: number }).commitStartedAt = Date.now() - COMMIT_STALE_MS - 1000;
  store['byId'].set('op_lunch', { ...stuck, commitStartedAt: Date.now() - COMMIT_STALE_MS - 1000 });

  const session = sessionWithCards([c]);
  const r = await confirmChatCommit({ session, card: c, store, executor });
  assert.equal(r.skipped, true);
  assert.equal(r.op?.status, 'succeeded');
  assert.equal(calls, 1, '超时后核实 journal，不得再次 create');
});

await checkAsync('超时无 journal：迁 failed，允许重试一次', async () => {
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let calls = 0;
  executor.register('commit_finance_txn', async () => {
    calls += 1;
    return { ok: true, entity_id: `txn_${calls}`, message: 'ok' };
  });
  const c = card({ operation_id: 'op_timeout', idempotency_key: 'op_timeout', id: 'c_t' });
  store.upsertFromCard({
    operation_id: 'op_timeout',
    confirm_action: 'commit_finance_txn',
    draft: { name: '午饭', amount: 18 },
    idempotency_key: 'op_timeout',
    write_status: 'awaiting_confirmation',
  });
  const began = store.beginCommit('op_timeout');
  assert.equal(began.started, true);
  store['byId'].set('op_timeout', {
    ...store.get('op_timeout')!,
    commitStartedAt: Date.now() - COMMIT_STALE_MS - 1,
  });

  const session = sessionWithCards([c]);
  // 第一次：超时核实 → failed（无 journal）后 beginCommit 会再执行
  const r1 = await confirmChatCommit({ session, card: c, store, executor });
  assert.equal(r1.skipped, false);
  assert.equal(r1.op?.status, 'succeeded');
  assert.equal(calls, 1);
});

console.log(`\nS9.6: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
}

void main();
