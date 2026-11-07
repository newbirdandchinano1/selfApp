/**
 * S9.2：ConfirmCard 状态机 + 可插拔 ChatCommitExecutor。
 * 验收：双域 mock handler 走通同一状态机；重复确认不双写；新增域只注册 handler。
 * 运行：npm run test:assistant-s9.2
 */
import assert from 'node:assert/strict';

import { parseActionCard } from '../lib/assistant/action-card';
import {
  buildClientCapabilities,
  ChatCommitExecutor,
  BASE_CLIENT_CAPABILITIES,
} from '../lib/assistant/chat-commit';
import {
  cancelChatCommit,
  confirmChatCommit,
  patchChatCommitDraft,
} from '../lib/assistant/chat-commit-controller';
import {
  clearExecutionResults,
  drainExecutionResults,
  formatCommitResultBubble,
  peekExecutionResults,
} from '../lib/assistant/commit-result';
import type { ChatSession } from '../lib/assistant/chat-types';
import {
  WriteOperationStore,
  canTransitionWriteStatus,
  deriveDraftFields,
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

function emptySession(cards: ReturnType<typeof parseActionCard>[]): ChatSession {
  const now = Date.now();
  return {
    id: 'cs_test',
    title: '测试',
    remoteSessionId: null,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: 'cm_a',
        role: 'assistant',
        createdAt: now,
        status: 'done',
        parts: cards.map(card => ({ type: 'action_card' as const, card })),
      },
    ],
  };
}

check('状态机合法迁移', () => {
  assert.equal(canTransitionWriteStatus('drafted', 'awaiting_confirmation'), true);
  assert.equal(canTransitionWriteStatus('awaiting_confirmation', 'committing'), true);
  assert.equal(canTransitionWriteStatus('committing', 'succeeded'), true);
  assert.equal(canTransitionWriteStatus('committing', 'failed'), true);
  assert.equal(canTransitionWriteStatus('failed', 'committing'), true);
  assert.equal(canTransitionWriteStatus('succeeded', 'committing'), false);
  assert.equal(canTransitionWriteStatus('cancelled', 'committing'), false);
});

check('parseActionCard 解析 commit_* 与 draft_fields', () => {
  const card = parseActionCard({
    id: 'c1',
    domain: 'memo',
    intent: 'create',
    title: '备忘草稿',
    confidence: 0.9,
    needs_confirm: true,
    confirm_action: 'commit_memo',
    draft: { title: '买菜', body: '牛奶' },
    draft_fields: [
      { key: 'title', label: '标题', value: '买菜', editable: true },
      { key: 'body', label: '正文', value: '牛奶', editable: true },
    ],
  });
  assert.equal(card.confirm_action, 'commit_memo');
  assert.equal(card.operation_id, 'c1');
  assert.equal(card.write_status, 'awaiting_confirmation');
  assert.equal(card.needs_confirm, true);
  assert.equal(card.draft_fields?.length, 2);
  assert.equal(card.idempotency_key, 'c1');
});

check('parseActionCard 仍拒绝红线', () => {
  const card = parseActionCard({
    id: 'x',
    domain: 'wish',
    intent: 'create',
    title: '兑奖',
    confidence: 0.9,
    needs_confirm: true,
    confirm_action: 'redeem_wish',
  });
  assert.equal(card.intent, 'clarify');
  assert.equal(card.confirm_action, undefined);
});

check('CLIENT_CAPABILITIES 随 handler 注册递增', () => {
  const ex = new ChatCommitExecutor();
  const base = buildClientCapabilities(ex);
  for (const c of BASE_CLIENT_CAPABILITIES) {
    assert.ok(base.includes(c), c);
  }
  assert.ok(!base.includes('commit_memo'));

  ex.register('commit_memo', async () => ({ ok: true, entity_id: 'm1' }));
  ex.register('commit_task', async () => ({ ok: true, entity_id: 't1' }));
  const next = buildClientCapabilities(ex);
  assert.ok(next.includes('commit_memo'));
  assert.ok(next.includes('commit_task'));
  assert.ok(next.includes('preview_memo'));
});

check('禁止注册红线 handler', () => {
  const ex = new ChatCommitExecutor();
  assert.throws(() => {
    ex.register('redeem_wish', async () => ({ ok: true }));
  });
});

check('deriveDraftFields 兜底', () => {
  const fields = deriveDraftFields({ title: '待办', amount: 18, nested: { a: 1 } });
  assert.ok(fields.some(f => f.key === 'title' && f.value === '待办' && f.label === '标题'));
  assert.ok(fields.some(f => f.key === 'amount' && f.value === '18' && f.label === '金额'));
  assert.ok(!fields.some(f => f.key === 'nested'));
});

check('结果气泡文案诚实', () => {
  assert.match(
    formatCommitResultBubble({
      status: 'succeeded',
      title: '午饭',
      result: { entity_id: 'txn_1', sync_status: 'pending' },
    }),
    /已成功保存/,
  );
  assert.match(
    formatCommitResultBubble({
      status: 'failed',
      error: { code: 'x', message: '账户不存在' },
    }),
    /未能保存/,
  );
  assert.match(formatCommitResultBubble({ status: 'cancelled' }), /未写入/);
});

async function main() {
await checkAsync('双域 mock handler 走通同一状态机', async () => {
  clearExecutionResults();
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let memoWrites = 0;
  let taskWrites = 0;

  executor.register('commit_memo', async input => {
    memoWrites += 1;
    return {
      ok: true,
      entity_id: `memo_${input.operation_id}`,
      sync_status: 'pending',
      message: `已保存备忘「${String(input.draft.title || '')}」`,
    };
  });
  executor.register('commit_task', async input => {
    taskWrites += 1;
    return {
      ok: true,
      entity_id: `task_${input.operation_id}`,
      sync_status: 'pending',
      message: `已创建待办「${String(input.draft.title || '')}」`,
    };
  });

  const memoCard = parseActionCard({
    id: 'op_memo',
    domain: 'memo',
    intent: 'create',
    title: '备忘',
    confidence: 0.9,
    confirm_action: 'commit_memo',
    draft: { title: '购物清单' },
    draft_fields: [{ key: 'title', label: '标题', value: '购物清单', editable: true }],
  });
  const taskCard = parseActionCard({
    id: 'op_task',
    domain: 'task',
    intent: 'create',
    title: '待办',
    confidence: 0.9,
    confirm_action: 'commit_task',
    draft: { title: '跑步' },
  });

  let session = emptySession([memoCard, taskCard]);
  const r1 = await confirmChatCommit({ session, card: memoCard, store, executor });
  assert.equal(r1.skipped, false);
  assert.equal(r1.op?.status, 'succeeded');
  assert.equal(memoWrites, 1);
  assert.equal(r1.op?.result?.entity_id, 'memo_op_memo');
  session = r1.session;

  const r2 = await confirmChatCommit({ session, card: taskCard, store, executor });
  assert.equal(r2.op?.status, 'succeeded');
  assert.equal(taskWrites, 1);
  session = r2.session;

  // 结果气泡（方案 A）
  const texts = session.messages
    .filter(m => m.role === 'assistant')
    .flatMap(m => m.parts.filter(p => p.type === 'text').map(p => p.text));
  assert.ok(texts.some(t => t.includes('备忘') || t.includes('已保存')));
  assert.ok(texts.some(t => t.includes('待办') || t.includes('已创建')));

  // 方案 B 预留队列
  const pending = peekExecutionResults();
  assert.ok(pending.length >= 2);
  assert.ok(pending.every(p => p.ok === true));
  drainExecutionResults();
});

await checkAsync('重复确认不双写（幂等）', async () => {
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let writes = 0;
  executor.register('commit_memo', async () => {
    writes += 1;
    return { ok: true, entity_id: 'm_once', sync_status: 'pending' };
  });

  const card = parseActionCard({
    id: 'op_idem',
    domain: 'memo',
    intent: 'create',
    title: '幂等',
    confidence: 0.95,
    confirm_action: 'commit_memo',
    draft: { title: '只写一次' },
  });
  let session = emptySession([card]);

  const first = await confirmChatCommit({ session, card, store, executor });
  session = first.session;
  assert.equal(writes, 1);
  assert.equal(first.op?.status, 'succeeded');

  const second = await confirmChatCommit({
    session,
    card: parseActionCard({
      ...card,
      write_status: 'succeeded',
      result: first.op?.result,
    }),
    store,
    executor,
  });
  assert.equal(second.skipped, true);
  assert.equal(writes, 1);

  // journal 层再防一层
  const third = await executor.execute({
    confirm_action: 'commit_memo',
    operation_id: 'op_idem',
    idempotency_key: 'op_idem',
    draft: { title: '只写一次' },
  });
  assert.equal(third.from_journal, true);
  assert.equal(writes, 1);
});

await checkAsync('committing 期间重复 begin 忽略', async () => {
  const store = new WriteOperationStore();
  store.upsertFromCard({
    operation_id: 'op_busy',
    confirm_action: 'commit_task',
    draft: { title: 'x' },
    write_status: 'awaiting_confirmation',
  });
  const a = store.beginCommit('op_busy');
  assert.equal(a.started, true);
  const b = store.beginCommit('op_busy');
  assert.equal(b.started, false);
  assert.equal(b.record?.status, 'committing');
});

await checkAsync('取消 / 失败 / 重试', async () => {
  clearExecutionResults();
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  let shouldFail = true;
  let writes = 0;
  executor.register('commit_task', async () => {
    writes += 1;
    if (shouldFail) {
      return { ok: false, error: { code: 'mock_fail', message: '模拟失败' } };
    }
    return { ok: true, entity_id: 't_ok', sync_status: 'pending', message: '已创建待办' };
  });

  const card = parseActionCard({
    id: 'op_retry',
    domain: 'task',
    intent: 'create',
    title: '重试卡',
    confidence: 0.9,
    confirm_action: 'commit_task',
    draft: { title: '草稿' },
  });

  // 取消
  let session = emptySession([card]);
  const cancelled = cancelChatCommit({ session, card, store });
  assert.equal(cancelled.op?.status, 'cancelled');
  assert.ok(
    cancelled.session.messages.some(m =>
      m.parts.some(p => p.type === 'text' && p.text.includes('取消')),
    ),
  );

  // 失败
  const store2 = new WriteOperationStore();
  session = emptySession([card]);
  const fail = await confirmChatCommit({ session, card, store: store2, executor });
  assert.equal(fail.op?.status, 'failed');
  assert.equal(writes, 1);
  assert.equal(fail.op?.error?.code, 'mock_fail');

  // 改稿后重试成功
  shouldFail = false;
  const patched = patchChatCommitDraft({
    session: fail.session,
    card: parseActionCard({
      ...card,
      write_status: 'failed',
      draft: { title: '草稿' },
    }),
    patches: [{ key: 'title', value: '改后标题' }],
    store: store2,
  });
  assert.equal(patched.op?.status, 'awaiting_confirmation');
  assert.equal(patched.op?.draft.title, '改后标题');

  const retry = await confirmChatCommit({
    session: patched.session,
    card: parseActionCard({
      ...card,
      write_status: 'awaiting_confirmation',
      draft: patched.op?.draft,
    }),
    store: store2,
    executor,
  });
  assert.equal(retry.op?.status, 'succeeded');
  assert.equal(writes, 2);
  assert.equal(retry.op?.result?.entity_id, 't_ok');
});

await checkAsync('新增域只需注册 handler，不改主流程', async () => {
  const store = new WriteOperationStore();
  const executor = new ChatCommitExecutor();
  // 新域：未改 confirmChatCommit / Runtime，只 register
  executor.register('commit_wish', async input => ({
    ok: true,
    entity_id: 'wish_1',
    message: `心愿「${String(input.draft.title || '')}」`,
    sync_status: 'pending',
  }));

  const card = parseActionCard({
    id: 'op_wish',
    domain: 'wish',
    intent: 'create',
    title: '心愿',
    confidence: 0.88,
    confirm_action: 'commit_wish',
    draft: { title: '相机' },
  });
  const session = emptySession([card]);
  const r = await confirmChatCommit({ session, card, store, executor });
  assert.equal(r.op?.status, 'succeeded');
  assert.ok(buildClientCapabilities(executor).includes('commit_wish'));
});

  console.log(`\nS9.2 chat-commit: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
