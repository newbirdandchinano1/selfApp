/**
 * 阶段五：能力路由 / 历史压缩 / Markdown / 禁止动作 / 流式错误判定。
 * 运行：npm run test:assistant-p5
 */
import assert from 'node:assert/strict';

import {
  FORBIDDEN_CONFIRM_ACTIONS,
  parseActionCard,
} from '../lib/assistant/action-card';
import {
  createThinkingState,
  labelForToolName,
  shouldShowThinkingOrb,
} from '../lib/assistant/agent-thinking-status';
import {
  historyFromMessages,
  isStreamUnsupportedError,
} from '../lib/assistant/chat-history';
import {
  parseInlineMarkdown,
  parseMarkdownBlocks,
} from '../lib/assistant/chat-markdown-parse';
import type { ChatMessage } from '../lib/assistant/chat-types';
import { resolveModuleHref } from '../lib/assistant/capability-router';
import {
  isForbiddenConfirmAction,
  mapActionCardToConfirmPlan,
} from '../lib/assistant/confirm';
import { toUserMessage } from '../lib/app-feedback/to-user-message';

function fakeApiError(message: string, name = 'ApiRequestError') {
  const e = new Error(message);
  e.name = name;
  return e;
}

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

check('resolveModuleHref：tasks.home / tasks.add / 非法 id', () => {
  assert.equal(resolveModuleHref('tasks.home'), '/(tabs)/tasks');
  const add = resolveModuleHref('tasks.add');
  assert.ok(add && typeof add === 'object');
  if (add && typeof add === 'object') {
    assert.equal(add.pathname, '/add-task');
    assert.equal(add.params?.standalone, '1');
  }
  assert.equal(resolveModuleHref('not.a.module'), null);
});

check('resolveModuleHref：S1 横切模块（衣橱/心愿/复盘/道路）', () => {
  assert.equal(resolveModuleHref('wardrobe.home'), '/my-wardrobe');
  const outfit = resolveModuleHref('wardrobe.outfit');
  assert.ok(outfit && typeof outfit === 'object');
  if (outfit && typeof outfit === 'object') {
    assert.equal(outfit.pathname, '/my-wardrobe');
    assert.equal(outfit.params?.tab, 'outfits');
  }
  assert.equal(resolveModuleHref('wish.home'), '/wish-board');
  assert.equal(resolveModuleHref('wish.add'), '/add-wish-board-item');
  assert.equal(resolveModuleHref('life_road.home'), '/life-road');
  assert.equal(resolveModuleHref('profile.home'), '/(tabs)/profile');
  const daily = resolveModuleHref('review.daily');
  assert.ok(daily && typeof daily === 'object');
  if (daily && typeof daily === 'object') {
    assert.equal(daily.pathname, '/(tabs)/review');
    assert.equal(daily.params?.focus, 'daily');
  }
  assert.equal(resolveModuleHref('finance.stats'), '/finance-stats');
  assert.equal(resolveModuleHref('recipe.home'), '/my-recipes');
  assert.equal(resolveModuleHref('memo.home'), '/memo-list');
});

check('FORBIDDEN：parse + mapConfirm 均拒绝兑奖/删库等', () => {
  for (const action of FORBIDDEN_CONFIRM_ACTIONS) {
    assert.equal(isForbiddenConfirmAction(action), true);
    const card = parseActionCard({
      id: `f_${action}`,
      domain: 'wish',
      intent: 'create',
      title: '敏感',
      confidence: 0.9,
      needs_confirm: true,
      confirm_action: action,
    });
    assert.equal(card.confirm_action, undefined);
    assert.equal(card.intent, 'clarify');

    const plan = mapActionCardToConfirmPlan({
      id: `raw_${action}`,
      domain: 'wish',
      intent: 'create',
      title: '敏感',
      confidence: 0.9,
      needs_confirm: true,
      confirm_action: action as never,
    });
    assert.equal(plan.kind, 'rejected');
  }
});

check('historyFromMessages：附带 tool 摘要且限制条数', () => {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < 30; i += 1) {
    msgs.push({
      id: `u${i}`,
      role: 'user',
      parts: [{ type: 'text', text: `用户${i}` }],
      createdAt: i,
      status: 'done',
    });
    msgs.push({
      id: `a${i}`,
      role: 'assistant',
      parts: [
        {
          type: 'tool_result',
          toolName: i % 2 === 0 ? 'finance.summary' : 'task.list_upcoming',
          summary: i % 2 === 0 ? '预算剩余' : '待办摘要',
          ok: true,
        },
        { type: 'text', text: `回复${i}` },
      ],
      createdAt: i,
      status: 'done',
    });
  }
  const hist = historyFromMessages(msgs);
  assert.ok(hist.length <= 24);
  assert.ok(hist.some(h => h.content.includes('[已查询')));
  assert.ok(hist.at(-1)?.content.includes('回复29'));
});

check('Markdown：粗体 / 列表 / 标题 / 代码块 / 引用', () => {
  const src =
    '## 标题\n\n这是 **粗体** 和 `code`\n\n- 一项\n- 二项\n\n1. 甲\n2. 乙\n\n> 引用行\n\n```ts\nconst a = 1\n```';
  const blocks = parseMarkdownBlocks(src);
  const inline = parseInlineMarkdown('这是 **粗体** 和 `code`');
  assert.ok(blocks.some(b => b.kind === 'h'));
  assert.ok(blocks.some(b => b.kind === 'ul'));
  assert.ok(blocks.some(b => b.kind === 'ol'));
  assert.ok(blocks.some(b => b.kind === 'quote'));
  assert.ok(blocks.some(b => b.kind === 'code' && !b.incomplete));
  assert.ok(inline.some(s => s.type === 'bold' && s.value === '粗体'));
  assert.ok(inline.some(s => s.type === 'code' && s.value === 'code'));

  const incomplete = parseMarkdownBlocks('```js\nconst x = 1');
  assert.ok(incomplete.some(b => b.kind === 'code' && b.incomplete));
});

check('isStreamUnsupportedError 仅识别环境不支持', () => {
  assert.equal(isStreamUnsupportedError(fakeApiError('当前环境不支持流式响应')), true);
  assert.equal(isStreamUnsupportedError(fakeApiError('助手流式请求失败：HTTP 401')), false);
  assert.equal(isStreamUnsupportedError(new Error('network')), false);
});

check('toUserMessage：助手鉴权 / 断网文案', () => {
  assert.equal(
    toUserMessage(fakeApiError('助手服务鉴权失败，请检查 Agent API Key')),
    '助手服务鉴权失败，请检查 Agent API Key',
  );
  assert.equal(toUserMessage(new TypeError('Network request failed')), '网络异常，请检查连接后重试');
});

check('open_module 卡优先 module_id 映射', () => {
  const plan = mapActionCardToConfirmPlan({
    id: 'nav1',
    domain: 'task',
    intent: 'navigate',
    title: '打开待办',
    confidence: 0.9,
    needs_confirm: false,
    confirm_action: 'open_route',
    module_id: 'tasks.home',
    route_href: '/forged/path',
  });
  assert.equal(plan.kind, 'open_route');
  if (plan.kind === 'open_route') {
    assert.equal(plan.href, '/(tabs)/tasks');
  }
});

check('思考态文案：工具名映射与阶段切换', () => {
  assert.equal(labelForToolName('finance.summary'), '正在查询账单数据…');
  assert.equal(labelForToolName('kb.search'), '正在检索相关知识…');
  assert.equal(labelForToolName('task.list_upcoming'), '正在查询待办…');
  assert.match(labelForToolName('finance.unknown_ops'), /财务/);
  assert.match(labelForToolName('custom.tool'), /调用工具/);

  const thinking = createThinkingState('thinking');
  assert.equal(thinking.label, '正在思考…');
  assert.equal(thinking.visual, 'calm');
  assert.equal(shouldShowThinkingOrb(thinking, false), true);
  assert.equal(shouldShowThinkingOrb(thinking, true), false);

  const tool = createThinkingState('tool', { toolName: 'finance.summary' });
  assert.equal(tool.visual, 'active');
  assert.equal(tool.label, '正在查询账单数据…');

  const organizing = createThinkingState('organizing');
  assert.equal(organizing.label, '正在整理回答…');

  const generating = createThinkingState('generating');
  assert.equal(generating.visual, 'converging');
  assert.equal(shouldShowThinkingOrb(generating, false), true);
  assert.equal(shouldShowThinkingOrb(generating, true), false);
});

console.log(`\nassistant-p5: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
