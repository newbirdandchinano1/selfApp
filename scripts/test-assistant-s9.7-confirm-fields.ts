/**
 * S9.7：分域 ConfirmCard 字段模板 + 中文标签兜底。
 * 运行：npm run test:assistant-s9.7
 */
import assert from 'node:assert/strict';

import {
  CONFIRM_CARD_FIELD_TEMPLATES,
  COMMON_FIELD_LABELS,
  isMultilineFieldKey,
  isNumericFieldKey,
  resolveFieldTemplate,
} from '../lib/assistant/confirm-card-fields';
import { S93_COMMIT_ACTIONS } from '../lib/assistant/chat-commit-handlers/index';
import { deriveDraftFields } from '../lib/assistant/write-operation';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(e);
  }
}

console.log('S9.7 confirm-card field templates');

check('核心 commit_* 均有字段模板', () => {
  const must = [
    'commit_finance_txn',
    'commit_finance_transfer',
    'commit_memo',
    'commit_task',
    'commit_food_intake',
    'commit_habit',
    'commit_recipe',
    'commit_wardrobe_item',
    'commit_wish',
    'commit_profile',
    'commit_life_road_node',
    'commit_review_journal',
    'commit_project',
  ];
  for (const a of must) {
    assert.ok(
      CONFIRM_CARD_FIELD_TEMPLATES[a]?.length,
      `missing template: ${a}`,
    );
  }
});

check('S9.3 全量 commit_* 均可 resolve 模板或通用标签', () => {
  for (const action of S93_COMMIT_ACTIONS) {
    const tpl = resolveFieldTemplate(action, null);
    // 允许少数走通用兜底，但 resolve 不应抛错；有模板更好
    if (!tpl) {
      assert.ok(action.startsWith('commit_'), action);
    }
  }
  // 覆盖率：至少 90% 有显式模板
  const covered = S93_COMMIT_ACTIONS.filter(a => CONFIRM_CARD_FIELD_TEMPLATES[a]).length;
  assert.ok(
    covered / S93_COMMIT_ACTIONS.length >= 0.9,
    `template coverage ${covered}/${S93_COMMIT_ACTIONS.length}`,
  );
});

check('finance 记账：中文标签 + 可编辑金额', () => {
  const fields = deriveDraftFields(
    {
      name: '午饭',
      amount: 18,
      category_label: '餐饮',
      account_name: '支付宝',
      transaction_type: 'expense',
      nested: { x: 1 },
    },
    undefined,
    { confirmAction: 'commit_finance_txn', domain: 'finance' },
  );
  const amount = fields.find(f => f.key === 'amount');
  assert.equal(amount?.label, '金额');
  assert.equal(amount?.editable, true);
  assert.equal(amount?.value, '18');
  assert.ok(fields.some(f => f.key === 'name' && f.label === '标题'));
  assert.ok(!fields.some(f => f.key === 'nested'));
});

check('转账模板：转出/转入账户', () => {
  const fields = deriveDraftFields(
    { amount: 500, from_account_name: '支付宝', to_account_name: '银行卡' },
    undefined,
    'commit_finance_transfer',
  );
  assert.ok(fields.some(f => f.label === '转出账户' && f.value === '支付宝'));
  assert.ok(fields.some(f => f.label === '转入账户' && f.value === '银行卡'));
});

check('饮食模板：热量标签中文', () => {
  const fields = deriveDraftFields(
    { food_summary: '鸡胸肉沙拉', calories_kcal: 420, protein_g: 35 },
    undefined,
    { confirmAction: 'commit_food_intake', domain: 'food' },
  );
  assert.ok(fields.some(f => f.label === '食物'));
  assert.ok(fields.some(f => f.label === '热量(kcal)' && f.value === '420'));
});

check('无模板时仍用中文通用标签', () => {
  const fields = deriveDraftFields({ title: '待办', amount: 18 });
  assert.ok(fields.some(f => f.key === 'title' && f.label === '标题'));
  assert.ok(fields.some(f => f.key === 'amount' && f.label === '金额'));
});

check('preferred draft_fields：英文 label=key 时补中文', () => {
  const fields = deriveDraftFields(
    { amount: 20 },
    [{ key: 'amount', label: 'amount', value: '20', editable: true }],
    'commit_finance_txn',
  );
  assert.equal(fields[0]?.label, '金额');
});

check('域兜底：仅 domain=memo', () => {
  const fields = deriveDraftFields(
    { title: '买菜', body: '周六超市' },
    undefined,
    { domain: 'memo' },
  );
  assert.ok(fields.some(f => f.label === '标题'));
  assert.ok(fields.some(f => f.label === '正文' && f.editable === true));
});

check('别名：payment_account_label → 账户', () => {
  const fields = deriveDraftFields(
    { name: '咖啡', amount: 15, payment_account_label: '微信' },
    undefined,
    'commit_finance_txn',
  );
  assert.ok(fields.some(f => f.key === 'account_name' && f.value === '微信' && f.label === '账户'));
});

check('键盘辅助：金额数字 / 正文多行', () => {
  assert.equal(isNumericFieldKey('amount'), true);
  assert.equal(isNumericFieldKey('calories_kcal'), true);
  assert.equal(isMultilineFieldKey('body'), true);
  assert.equal(isMultilineFieldKey('persona'), true);
  assert.equal(isMultilineFieldKey('name'), false);
});

check('COMMON_FIELD_LABELS 覆盖主路径键', () => {
  for (const k of ['name', 'amount', 'food_summary', 'due_ymd', 'persona']) {
    assert.ok(COMMON_FIELD_LABELS[k], k);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
