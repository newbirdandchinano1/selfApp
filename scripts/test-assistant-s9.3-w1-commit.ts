/**
 * S9.3 W1：真实 commit handler 注册 + draft 校验 + 现金流合并纯函数。
 * 运行：npm run test:assistant-s9.3
 */
import assert from 'node:assert/strict';

import { parseActionCard } from '../lib/assistant/action-card';
import {
  buildClientCapabilities,
  ChatCommitExecutor,
  globalChatCommitExecutor,
} from '../lib/assistant/chat-commit';
import {
  confirmChatCommit,
} from '../lib/assistant/chat-commit-controller';
import {
  W1_COMMIT_ACTIONS,
  commitFinanceTxn,
  commitFoodIntake,
  commitHabit,
  commitMemo,
  commitTask,
  ensureChatCommitHandlersRegistered,
  mergeCashFlowDraftForTest,
  registerChatCommitHandlers,
} from '../lib/assistant/chat-commit-handlers';
import type { ChatSession } from '../lib/assistant/chat-types';
import { WriteOperationStore } from '../lib/assistant/write-operation';
const CASH_FLOW_EMPTY_STATE = {
  necessaryExpenses: 0,
  unnecessaryExpenses: 0,
  incomes: [] as Array<{ id: string; name: string; amount: number; quadrant: 'E' | 'S' | 'B' | 'I' }>,
  holdings: [] as Array<{
    id: string;
    name: string;
    principal: number;
    inflow: number;
    outflow: number;
  }>,
  expenseLines: [] as Array<{
    id: string;
    name: string;
    amount: number;
    bucket: 'necessary' | 'unnecessary';
  }>,
  goals: { targetPassiveIncome: 0, targetMonths: 60 },
};

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

ensureChatCommitHandlersRegistered();

check('W1 commit actions 已注册到全局 executor', () => {
  for (const action of W1_COMMIT_ACTIONS) {
    assert.equal(
      globalChatCommitExecutor.has(action),
      true,
      `missing handler: ${action}`,
    );
  }
});

check('CLIENT_CAPABILITIES 含 W1 commit_*', () => {
  const caps = buildClientCapabilities();
  for (const action of W1_COMMIT_ACTIONS) {
    assert.ok(caps.includes(action), `capability missing: ${action}`);
  }
});

check('测试 executor 不自动灌真实 handler（保护 mock）', () => {
  const ex = new ChatCommitExecutor();
  ensureChatCommitHandlersRegistered(ex);
  assert.equal(ex.listRegisteredActions().length, 0);
  registerChatCommitHandlers(ex);
  assert.ok(ex.has('commit_finance_txn'));
});

check('现金流 income 草稿合并', () => {
  const r = mergeCashFlowDraftForTest(CASH_FLOW_EMPTY_STATE, {
    entry_kind: 'income',
    amount: 15000,
    name_hint: '工资',
    quadrant: 'E',
  });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.equal(r.state.incomes.length, 1);
  assert.equal(r.state.incomes[0].name, '工资');
  assert.equal(r.state.incomes[0].amount, 15000);
  assert.equal(r.state.incomes[0].quadrant, 'E');
});

check('现金流 necessary 草稿合并', () => {
  const r = mergeCashFlowDraftForTest(CASH_FLOW_EMPTY_STATE, {
    entry_kind: 'necessary',
    amount: 3200,
    name_hint: '房租',
  });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.equal(r.state.necessaryExpenses, 3200);
  assert.equal(r.state.expenseLines.length, 1);
  assert.equal(r.state.expenseLines[0].bucket, 'necessary');
});

async function main() {
  await checkAsync('缺金额时 commit_finance_txn 失败且不抛', async () => {
    const r = await commitFinanceTxn({ name: '午饭', transaction_type: 'expense' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺标题时 commit_task 失败', async () => {
    const r = await commitTask({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_habit 失败', async () => {
    const r = await commitHabit({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('零摄入时 commit_food_intake 失败', async () => {
    const r = await commitFoodIntake({ food_summary: '空气' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('空备忘时 commit_memo 失败', async () => {
    const r = await commitMemo({ title: '', body: '', body_plain: '' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('确认卡走 W1 mock handler 仍可幂等（独立 executor）', async () => {
    const store = new WriteOperationStore();
    const executor = new ChatCommitExecutor();
    let calls = 0;
    executor.register('commit_finance_txn', async () => {
      calls += 1;
      return { ok: true, entity_id: 'ft_test', sync_status: 'pending', message: '已记账' };
    });

    const card = parseActionCard({
      id: 'ac_s93',
      domain: 'finance',
      intent: 'create',
      title: '记一笔支出',
      confidence: 0.9,
      needs_confirm: true,
      confirm_action: 'commit_finance_txn',
      operation_id: 'op_s93',
      draft: { name: '午饭', amount: 18, transaction_type: 'expense' },
    })!;

    const now = Date.now();
    const session: ChatSession = {
      id: 'cs_s93',
      title: 't',
      remoteSessionId: null,
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: 'cm1',
          role: 'assistant',
          createdAt: now,
          status: 'done',
          parts: [{ type: 'action_card', card }],
        },
      ],
    };

    const r1 = await confirmChatCommit({ session, card, store, executor });
    assert.equal(r1.op?.status, 'succeeded');
    assert.equal(calls, 1);
    const r2 = await confirmChatCommit({
      session: r1.session,
      card: { ...card, write_status: 'succeeded' },
      store,
      executor,
    });
    assert.equal(r2.skipped, true);
    assert.equal(calls, 1);
  });

  console.log(`\nS9.3 W1: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
