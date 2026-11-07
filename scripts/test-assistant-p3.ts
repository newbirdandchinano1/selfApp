/**
 * P3：深链解析 / host-controller / 会话快照形状（不打网、不依赖 RN 原生模块以外的最小面）。
 * 运行：npm run test:assistant-p3
 */
import assert from 'node:assert/strict';

import {
  ASSISTANT_DEEP_LINKS,
  parseAssistantDeepLink,
} from '../lib/assistant/deeplink';
import {
  consumeGlobalAssistantPending,
  openGlobalAssistant,
  peekGlobalAssistantPending,
  subscribeGlobalAssistant,
  takeAssistantLaunchPayload,
} from '../lib/assistant/host-controller';

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

check('zheng://assistant → open', () => {
  assert.equal(parseAssistantDeepLink('zheng://assistant').kind, 'assistant_open');
});

check('zheng://assistant/clipboard → clipboard', () => {
  assert.equal(parseAssistantDeepLink(ASSISTANT_DEEP_LINKS.clipboard).kind, 'assistant_clipboard');
});

check('zheng://assistant/brief → brief', () => {
  const p = parseAssistantDeepLink(ASSISTANT_DEEP_LINKS.brief);
  assert.equal(p.kind, 'assistant_brief');
});

check('zheng://health → tab_health', () => {
  assert.equal(parseAssistantDeepLink(ASSISTANT_DEEP_LINKS.health).kind, 'tab_health');
});

check('zheng://finance → tab_finance', () => {
  assert.equal(parseAssistantDeepLink('zheng://finance').kind, 'tab_finance');
});

check('zheng://tasks?placement=abc → tab_tasks', () => {
  const p = parseAssistantDeepLink('zheng://tasks?placement=abc');
  assert.equal(p.kind, 'tab_tasks');
  assert.equal(p.query.placement, 'abc');
});

check('zheng://wardrobe → wardrobe', () => {
  assert.equal(parseAssistantDeepLink('zheng://wardrobe').kind, 'wardrobe');
});

check('zheng://profile → tab_profile', () => {
  assert.equal(parseAssistantDeepLink('zheng://profile').kind, 'tab_profile');
});

check('未知深链 → unknown', () => {
  assert.equal(parseAssistantDeepLink('zheng://nope').kind, 'unknown');
});

check('host-controller：无订阅时 pending，订阅后投递', () => {
  // 清掉可能残留
  consumeGlobalAssistantPending();
  openGlobalAssistant({ text: '咖啡 18', autoSubmit: true });
  assert.ok(peekGlobalAssistantPending()?.text === '咖啡 18');
  let got: string | undefined;
  const unsub = subscribeGlobalAssistant(opts => {
    got = opts.text;
  });
  assert.equal(got, '咖啡 18');
  assert.equal(peekGlobalAssistantPending(), null);
  unsub();
});

check('host-controller：有订阅时立即回调', () => {
  let n = 0;
  const unsub = subscribeGlobalAssistant(() => {
    n += 1;
  });
  openGlobalAssistant({ openOnly: true });
  assert.equal(n, 1);
  unsub();
});

check('host-controller：launchPayload 可供聊天页取走', () => {
  takeAssistantLaunchPayload();
  openGlobalAssistant({ text: '记一笔咖啡', autoSubmit: true });
  const payload = takeAssistantLaunchPayload();
  assert.equal(payload?.text, '记一笔咖啡');
  assert.equal(payload?.autoSubmit, true);
  assert.equal(takeAssistantLaunchPayload(), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
