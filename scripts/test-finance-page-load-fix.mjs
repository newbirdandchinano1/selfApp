function shouldReadPageLocalOnly(input) {
  if (input.isApiOnly) return false;
  if (input.forceApi) return false;
  return true;
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

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    isApiOnly: false,
    hasSynced: false,
    isPageApiOnly: true,
    scopeTableCount: 0,
  }) === true,
  '专用 page API Tab 默认 localOnly，不由 sessionLoaded/hasSynced 决定打网',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    hasSynced: true,
    isPageApiOnly: true,
    scopeTableCount: 0,
  }) === true,
  'bootstrap 后财务 Tab 应 localOnly',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: true,
    hasSynced: true,
    isPageApiOnly: true,
    scopeTableCount: 0,
  }) === false,
  '显式 forceApi 仍可打网',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    hasSynced: false,
    isPageApiOnly: false,
    scopeTableCount: 0,
  }) === true,
  '普通子页直读本地',
);

assert(
  shouldReadPageLocalOnly({
    forceApi: false,
    hasSynced: false,
    isPageApiOnly: false,
    scopeTableCount: 3,
    needsRestRefresh: true,
  }) === true,
  '有 scope 表也不得用 RestRefresh/未同步当打网闸门',
);

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
