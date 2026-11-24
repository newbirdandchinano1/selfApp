/**
 * 阶段 D：模块 LoadState / 骨架策略 / 错误分类 / 并发 gate 自测
 * 运行：node --experimental-strip-types scripts/test-tasks-module-loading.mjs
 * 或：npx --yes tsx scripts/test-tasks-module-loading.mjs
 */
import assert from 'node:assert/strict';

import {
  classifyPageApiError,
  isPageApiAbortError,
  shouldReportPageApiError,
} from '../lib/page-api-error-kind.ts';
import { createConcurrencyGate } from '../lib/tasks-page-load-scheduler.ts';
import {
  IDLE_TASKS_LOAD_STATE,
  markModuleLoading,
  markModuleResult,
  shouldShowTasksFullPageSkeleton,
} from '../lib/tasks-page-module-loading.ts';

let passed = 0;
let failed = 0;

function check(name, fn) {
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

async function checkAsync(name, fn) {
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

check('整页骨架：无本地 + core loading → 显示', () => {
  assert.equal(
    shouldShowTasksFullPageSkeleton({
      enabled: true,
      hasLocalSnapshot: false,
      core: 'loading',
    }),
    true,
  );
});

check('整页骨架：有本地快照 → 不显示（即使 core loading）', () => {
  assert.equal(
    shouldShowTasksFullPageSkeleton({
      enabled: true,
      hasLocalSnapshot: true,
      core: 'loading',
    }),
    false,
  );
});

check('整页骨架：旧路径 legacyPending', () => {
  assert.equal(
    shouldShowTasksFullPageSkeleton({
      enabled: false,
      hasLocalSnapshot: false,
      core: 'ready',
      legacyPending: true,
    }),
    true,
  );
  assert.equal(
    shouldShowTasksFullPageSkeleton({
      enabled: false,
      hasLocalSnapshot: false,
      core: 'ready',
      legacyPending: false,
    }),
    false,
  );
});

check('LoadState patch / mark', () => {
  const loading = markModuleLoading(IDLE_TASKS_LOAD_STATE, ['core', 'habits']);
  assert.equal(loading.core, 'loading');
  assert.equal(loading.habits, 'loading');
  assert.equal(loading.matrix, 'idle');
  const ready = markModuleResult(loading, 'core', true);
  assert.equal(ready.core, 'ready');
  const err = markModuleResult(ready, 'habits', false);
  assert.equal(err.habits, 'error');
});

check('错误分类：abort / 429 / 503 / 4xx', () => {
  const abort = new DOMException('Aborted', 'AbortError');
  assert.equal(classifyPageApiError(abort), 'abort');
  assert.equal(isPageApiAbortError(abort), true);
  assert.equal(shouldReportPageApiError(abort), false);

  class FakeApiErr extends Error {
    constructor(status) {
      super('x');
      this.httpStatus = status;
      this.name = 'ApiRequestError';
    }
  }
  assert.equal(classifyPageApiError(new FakeApiErr(429)), 'rate_limit');
  assert.equal(shouldReportPageApiError(new FakeApiErr(429)), false);
  assert.equal(classifyPageApiError(new FakeApiErr(503)), 'server_busy');
  assert.equal(shouldReportPageApiError(new FakeApiErr(503)), false);
  assert.equal(classifyPageApiError(new FakeApiErr(400)), 'business_4xx');
  assert.equal(shouldReportPageApiError(new FakeApiErr(400)), true);
});

await checkAsync('并发 gate 上限 3', async () => {
  const gate = createConcurrencyGate(3);
  let peak = 0;
  let active = 0;
  const jobs = Array.from({ length: 8 }, (_, i) =>
    gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return i;
    }),
  );
  const results = await Promise.all(jobs);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(peak <= 3, `peak=${peak}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
