/**
 * 阶段 E：前端门禁 — 双 sync 去重、Abort 不重复写库、timeout 契约、错误分类、模块开关。
 *
 *   npx --yes tsx scripts/test-phase-e-gate.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyPageApiError,
  isPageApiAbortError,
  shouldReportPageApiError,
} from '../lib/page-api-error-kind.ts';
import { PAGE_API_TIMEOUTS_MS } from '../lib/page-api-timeouts.ts';
import { createInflightMerger, mergeAbortSignals } from '../lib/tasks-page-load-scheduler.ts';
import {
  TASKS_PAGE_MAX_CONCURRENCY,
  isTasksModuleLoadingEnabled,
} from '../lib/tasks-page-module-loading.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

check('D3 timeout 契约（与 A2 同灰度）', () => {
  assert.equal(PAGE_API_TIMEOUTS_MS.core, 5_000);
  assert.equal(PAGE_API_TIMEOUTS_MS.projects, 5_000);
  assert.equal(PAGE_API_TIMEOUTS_MS.habits, 3_000);
  assert.equal(PAGE_API_TIMEOUTS_MS.heatmap, 8_000);
  assert.equal(PAGE_API_TIMEOUTS_MS.backgroundSync, 20_000);
  assert.equal(TASKS_PAGE_MAX_CONCURRENCY, 3);
});

check('endpoints 使用契约超时（源码门禁）', () => {
  const src = readFileSync(join(root, 'lib/api/endpoints/tasks.ts'), 'utf8');
  assert.match(src, /PAGE_API_TIMEOUTS_MS/);
  assert.match(src, /PAGE_API_TIMEOUTS_MS\.core/);
  assert.match(src, /PAGE_API_TIMEOUTS_MS\.habits/);
  assert.match(src, /PAGE_API_TIMEOUTS_MS\.heatmap/);
  assert.match(src, /PAGE_API_TIMEOUTS_MS\.projects/);
});

check('模块加载灰度默认开', () => {
  assert.equal(isTasksModuleLoadingEnabled(), true);
});

check('错误分类：timeout vs abort / 429 / 503', () => {
  const abort = new DOMException('Aborted', 'AbortError');
  assert.equal(classifyPageApiError(abort), 'abort');
  assert.equal(shouldReportPageApiError(abort), false);

  const timeoutAbort = new DOMException('Timeout', 'AbortError');
  // message 含 timeout → timeout
  Object.defineProperty(timeoutAbort, 'message', { value: 'request timeout' });
  assert.equal(classifyPageApiError(timeoutAbort), 'timeout');

  class FakeApiErr extends Error {
    constructor(status, msg = 'x') {
      super(msg);
      this.httpStatus = status;
      this.name = 'ApiRequestError';
    }
  }
  assert.equal(classifyPageApiError(new FakeApiErr(429)), 'rate_limit');
  assert.equal(classifyPageApiError(new FakeApiErr(503)), 'server_busy');
  assert.equal(shouldReportPageApiError(new FakeApiErr(503)), false);
  assert.equal(classifyPageApiError(new FakeApiErr(400)), 'business_4xx');
});

await checkAsync('双 sync 去重：同 key in-flight 只跑一次', async () => {
  const merger = createInflightMerger();
  let runs = 0;
  let writes = 0;
  const work = async () => {
    runs += 1;
    await sleep(40);
    writes += 1;
    return writes;
  };
  const [a, b] = await Promise.all([
    merger.run('force', work),
    merger.run('force', work),
  ]);
  assert.equal(runs, 1, `runs=${runs}`);
  assert.equal(writes, 1, `writes=${writes}`);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

await checkAsync('Abort：共享 in-flight 写库仍只一次；等待方 abort 不报重复写', async () => {
  const merger = createInflightMerger();
  let writes = 0;
  const acWaiter = new AbortController();
  const leader = merger.run('incr', async () => {
    await sleep(50);
    writes += 1;
    return writes;
  });
  const waiter = merger.run('incr', async () => {
    writes += 1;
    return writes;
  }, acWaiter.signal);
  acWaiter.abort();
  const leaderVal = await leader;
  assert.equal(leaderVal, 1);
  assert.equal(writes, 1);
  let waiterThrew = false;
  try {
    await waiter;
  } catch {
    waiterThrew = true;
  }
  assert.equal(waiterThrew, true);
  assert.equal(writes, 1, 'abort 等待方不得触发第二次写库');
});

await checkAsync('Abort：请求在写库前取消 → 不写库', async () => {
  const merger = createInflightMerger();
  let writes = 0;
  const ac = new AbortController();
  const p = merger.run('force', async () => {
    await sleep(30);
    if (ac.signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    writes += 1;
    return 1;
  }, ac.signal);
  ac.abort();
  let threw = false;
  try {
    await p;
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
  assert.equal(writes, 0);
});

await checkAsync('mergeAbortSignals：任一 abort 即取消', async () => {
  const a = new AbortController();
  const b = new AbortController();
  const merged = mergeAbortSignals(a.signal, b.signal);
  assert.equal(merged.aborted, false);
  b.abort();
  assert.equal(merged.aborted, true);
});

check('对照：禁止只收紧后端（文档常量存在即视为前端已同灰度）', () => {
  if (process.env.PHASE_E_BACKEND_ONLY_LIMIT === '1') {
    throw new Error('拒绝上线：仅后端限流未收前端 timeout');
  }
  assert.ok(PAGE_API_TIMEOUTS_MS.core < 30_000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
