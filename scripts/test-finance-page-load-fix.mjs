/**
 * 财务页加载 / 记账合并逻辑单测（与 lib 内纯函数同逻辑，脚本内联避免 TS 加载）。
 * 用法：node scripts/test-finance-page-load-fix.mjs
 */

function shouldReadPageLocalOnly(input) {
  if (input.forceApi || input.needsRestRefresh) return false;
  if (input.hasSynced) return true;
  if (input.isPageApiOnly) return false;
  if ((input.scopeTableCount ?? 0) === 0) return true;
  return false;
}

function mergeFinanceHomeTransactions(apiWindow, withPending) {
  const byId = new Map();
  for (const row of apiWindow) {
    const id = String(row?.id ?? '').trim();
    if (id) byId.set(id, row);
  }
  for (const row of withPending) {
    const id = String(row?.id ?? '').trim();
    if (!id) continue;
    byId.set(id, row);
  }
  return [...byId.values()];
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL:', msg);
}

// --- shouldReadPageLocalOnly ---
assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    needsRestRefresh: false,
    hasSynced: false,
    isPageApiOnly: true,
    scopeTableCount: 0,
  }) === false,
  '未同步的专用 page API Tab（财务）必须打网，不能因 scope 为空走 localOnly',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    needsRestRefresh: false,
    hasSynced: true,
    isPageApiOnly: true,
    scopeTableCount: 0,
  }) === true,
  '已同步的财务 Tab 应 localOnly',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: true,
    needsRestRefresh: false,
    hasSynced: true,
    isPageApiOnly: true,
    scopeTableCount: 0,
  }) === false,
  'forceApi / 下拉刷新必须打网',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    needsRestRefresh: false,
    hasSynced: false,
    isPageApiOnly: false,
    scopeTableCount: 0,
  }) === true,
  '普通子页无 scope 仍直读本地',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    needsRestRefresh: false,
    hasSynced: false,
    isPageApiOnly: false,
    scopeTableCount: 3,
  }) === false,
  '有 scope 表的未同步页应打网',
);

// --- mergeFinanceHomeTransactions ---
const apiWindow = [
  { id: 'ft_a', name: '午餐', amount: 20, sync_status: 'synced' },
  { id: 'ft_b', name: '地铁', amount: 5, sync_status: 'synced' },
];
const withPending = [
  { id: 'ft_a', name: '午餐', amount: 20, sync_status: 'synced' },
  { id: 'ft_b', name: '地铁', amount: 5, sync_status: 'synced' },
  { id: 'ft_new', name: '咖啡', amount: 18, sync_status: 'pending_create' },
];

const merged = mergeFinanceHomeTransactions(apiWindow, withPending);
assert(merged.length === 3, '合并后应包含 API 窗口 + 本地 pending 新流水');
assert(
  merged.some((r) => r.id === 'ft_new' && r.sync_status === 'pending_create'),
  '刚记账的 pending_create 必须出现在收支明细数据中',
);

const overwritten = mergeFinanceHomeTransactions(
  [{ id: 'ft_x', name: '旧名', amount: 1, sync_status: 'synced' }],
  [{ id: 'ft_x', name: '本地改', amount: 1, sync_status: 'pending_update' }],
);
assert(overwritten.length === 1 && overwritten[0].name === '本地改', '同 id 以本地 pending 为准');

console.log(`finance-page-load-fix: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
