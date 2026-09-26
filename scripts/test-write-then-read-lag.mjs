/**
 * 写后读卡：可执行自证（不依赖真机 UI）。
 * 1) 源码不变量：写后保留冷却、forceApi≠forceRefresh、任务写不 awaitSync
 * 2) 冷却逻辑模拟：脏标后 8s 内应跳过 focus 强制打网
 * 3) 打真实后端：量化「全量 vs 增量」耗时差
 *
 * 用法：node scripts/test-write-then-read-lag.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function testSourceInvariants() {
  const session = read('lib/page-api-session.ts');
  assert(
    /preserveFocusCooldown:\s*true/.test(session),
    'markTabPagesDirtyForTable 应保留 focus 冷却 (preserveFocusCooldown: true)',
  );
  assert(
    /opts\?\.preserveFocusCooldown/.test(session),
    'clearPageLoadedInSession 应支持 preserveFocusCooldown',
  );

  const tasksScreen = read('screens/tasks/TasksScreen.tsx');
  assert(
    /forceRefresh:\s*forceFullRefresh/.test(tasksScreen),
    'TasksScreen 应只在清库后 forceFullRefresh，而不是 forceApi',
  );
  assert(
    !/forceRefresh:\s*forceApiRefresh/.test(tasksScreen),
    'TasksScreen 不应再把 forceApi 映射成 forceRefresh',
  );

  const taskRepo = read('lib/repositories/tasks/task.ts');
  const createPush = taskRepo.match(/export async function createTask[\s\S]*?^export async function getTaskById/m)?.[0] ?? '';
  const updatePush = taskRepo.match(/export async function updateTask[\s\S]*?^\/\*\* 将根任务/m)?.[0] ?? '';
  assert(
    /void pushLocalChangesToApi\(\)/.test(createPush),
    'createTask 应为后台 push，不能 awaitSync',
  );
  assert(
    !/awaitSync:\s*true/.test(createPush),
    'createTask 不得 awaitSync: true',
  );
  assert(
    /void pushLocalChangesToApi\(\)/.test(updatePush),
    'updateTask 应为后台 push，不能 awaitSync',
  );
  assert(
    !/awaitSync:\s*true/.test(updatePush),
    'updateTask 不得 awaitSync: true',
  );

  const addTask = read('app/(tasks)/add-task.tsx');
  const awaitSyncCount = (addTask.match(/awaitSync:\s*true/g) || []).length;
  assert(
    awaitSyncCount === 0,
    `add-task 不应再 awaitSync 阻塞返回（仍有 ${awaitSyncCount} 处）`,
  );

  assert(
    /shouldForceApiOnFocusRefresh[\s\S]*?return false/.test(session) ||
      !/shouldForceApiOnFocusRefresh\(pageKey\)/.test(read('hooks/use-page-focus-reload.ts')),
    'focus 重载不得再对 tasks 恒 forceApi（写后会变全局 REST）',
  );
  const focusReload = read('hooks/use-page-focus-reload.ts');
  assert(
    !/shouldForceApiOnFocusRefresh\(pageKey\)/.test(focusReload),
    'usePageFocusReload 不得在 Tab focus 时调用 shouldForceApiOnFocusRefresh',
  );
  assert(
    /reloadRef\.current\?\.\(false\)/.test(focusReload),
    'Tab focus 重载应显式 forceApi=false（只重读本地）',
  );

  console.log('[pass] source invariants');
}

/** 复刻 shouldSkipPageFocusApiRefresh 的 tasks 冷却逻辑 */
function testCooldownLogic() {
  const COOLDOWN_MS = 8_000;
  const pageLastFocusRefreshAtMs = new Map();
  const sessionLoadedPages = new Set();
  const TASKS = 'tabs/tasks';

  function markLoaded(key) {
    sessionLoadedPages.add(key);
    pageLastFocusRefreshAtMs.set(key, Date.now());
  }

  function clearLoaded(key, { preserveFocusCooldown = false } = {}) {
    sessionLoadedPages.delete(key);
    if (!preserveFocusCooldown) pageLastFocusRefreshAtMs.delete(key);
  }

  function shouldSkipTasksFocus() {
    const last = pageLastFocusRefreshAtMs.get(TASKS) ?? 0;
    return Date.now() - last < COOLDOWN_MS;
  }

  // 首次加载后在冷却内
  markLoaded(TASKS);
  assert(shouldSkipTasksFocus() === true, '加载后 8s 内应跳过 focus 打网');

  // 旧 bug：脏标清会话时顺带清冷却 → 立刻不能 skip
  clearLoaded(TASKS, { preserveFocusCooldown: false });
  assert(shouldSkipTasksFocus() === false, '清冷却后应无法 skip（复现旧 bug）');

  // 修复：保留冷却
  markLoaded(TASKS);
  clearLoaded(TASKS, { preserveFocusCooldown: true });
  assert(sessionLoadedPages.has(TASKS) === false, '会话加载标记应被清掉以便重读本地');
  assert(shouldSkipTasksFocus() === true, '保留冷却后写操作不应立刻强制打网');

  console.log('[pass] cooldown logic (旧 bug 可复现，修复后可跳过)');
}

async function testLiveApiCost() {
  const base = process.env.API_BASE_URL || 'http://124.223.161.79:3000';
  const loginRes = await fetch(`${base}/api/app/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'zhen8907146' }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson?.data?.token;
  assert(token, `登录失败: ${JSON.stringify(loginJson).slice(0, 200)}`);
  const headers = { Authorization: `Bearer ${token}` };

  async function timed(label, url) {
    const t0 = Date.now();
    const res = await fetch(url, { headers });
    const json = await res.json();
    const ms = Date.now() - t0;
    return { label, ms, ok: res.ok && json?.code === 0, json };
  }

  const page1 = await timed('tasks page1', `${base}/api/app/data/tasks?page=1&limit=200`);
  assert(page1.ok, 'tasks page1 失败');
  const total = page1.json?.data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, page1.json?.data?.pagination?.totalPages ?? 1);

  let fetched = (page1.json?.data?.list || []).length;
  const tFull0 = Date.now();
  for (let page = 2; page <= totalPages && page <= 50; page += 1) {
    const r = await fetch(`${base}/api/app/data/tasks?page=${page}&limit=200`, { headers });
    const j = await r.json();
    fetched += (j?.data?.list || []).length;
  }
  const fullMs = Date.now() - tFull0 + page1.ms;

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const incr = await timed(
    'tasks incr 1d',
    `${base}/api/app/data/tasks?page=1&limit=200&updatedSince=${encodeURIComponent(since)}`,
  );

  const bundle = await Promise.all([
    timed('pages/tasks', `${base}/api/app/pages/tasks`),
    timed('pages/catalog', `${base}/api/app/pages/tasks/catalog`),
    timed('pages/projects', `${base}/api/app/pages/projects?page=1&limit=200`),
    timed('habits-grid', `${base}/api/app/pages/tasks/habits-grid`),
  ]);
  const parallelWorst = Math.max(...bundle.map(b => b.ms));
  const parallelSum = bundle.reduce((s, b) => s + b.ms, 0);

  console.log('[api] tasks total rows =', total);
  console.log(`[api] FULL table scan ~${fullMs}ms (pages=${totalPages}, fetched=${fetched})`);
  console.log(`[api] INCR 1d ~${incr.ms}ms (list=${(incr.json?.data?.list || []).length})`);
  console.log(
    `[api] write-after focus bundle (parallel worst≈${parallelWorst}ms, serial sum≈${parallelSum}ms):`,
  );
  for (const b of bundle) {
    console.log(`  - ${b.label}: ${b.ms}ms ok=${b.ok}`);
  }

  assert(fullMs > incr.ms, '全量应明显慢于增量（否则测不到差异）');
  assert(
    fullMs / Math.max(1, incr.ms) >= 3,
    `全量/增量比过小: full=${fullMs} incr=${incr.ms}（数据量太少或后端异常）`,
  );
  console.log(
    `[pass] live API cost — 写后若走全量，仅 HTTP 就约 ${fullMs + parallelWorst}ms+；增量约 ${incr.ms}ms`,
  );
}

async function main() {
  console.log('=== write-then-read lag selftest ===');
  testSourceInvariants();
  testCooldownLogic();
  await testLiveApiCost();
  console.log('=== ALL PASSED ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
