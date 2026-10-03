/**
 * Phase 5：页面同步状态机拆除的源码不变量。
 * 用法：node scripts/test-sync-phase5-ui.mjs
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

const focus = read('hooks/use-page-focus-reload.ts');
assert(!/pullAndApplySyncChanges/.test(focus), 'usePageFocusReload 不得 pull');
assert(!/pullChanges\(/.test(focus), 'usePageFocusReload 不得调 pullChanges');
assert(!/AppState/.test(focus), 'usePageFocusReload 不得自己听 AppState');
assert(/reloadRef\.current\?\.\(false\)/.test(focus), 'focus 重载须 forceApi=false');

const session = read('lib/page-api-session.ts');
assert(!/pagesNeedingRestRefresh/.test(session), '不得保留 pagesNeedingRestRefresh');
assert(!/function shouldForceApiOnFocusRefresh/.test(session), '应删除 shouldForceApiOnFocusRefresh');
assert(!/function markTabPagesDirtyForRemoteSync/.test(session), '应删除 markTabPagesDirtyForRemoteSync');
assert(!/function pageNeedsRestRefresh/.test(session), '应删除 pageNeedsRestRefresh');
assert(
  /return true;\s*\}/.test(session.replace(/\s+/g, ' ')) ||
    /if \(input\.forceApi\) return false;\s*return true;/.test(session),
  'shouldReadPageLocalOnly 默认 true',
);

const wrap = read('hooks/use-page-api-sync.ts');
assert(/refreshFromUser/.test(wrap), '下拉刷新须走 SyncManager.refreshFromUser');
assert(!/reload\(true\)/.test(wrap), 'usePagePullRefresh 不得 reload(true)');

const manager = read('lib/sync-manager.ts');
assert(/function startSyncRuntime/.test(manager), '须有进程级 startSyncRuntime');
assert(/AppState/.test(manager), '回前台 pull 须在 Manager');
assert(/refreshFromUser/.test(manager), '须有 refreshFromUser');

const layout = read('app/_layout.tsx');
assert(/SyncManager\.start/.test(layout), '_layout 应 SyncManager.start');
assert(!/startSyncPullPolling\(/.test(layout), '_layout 不得直接 startSyncPullPolling');

const tabs = [
  'screens/home/HomeScreen.tsx',
  'screens/tasks/TasksScreen.tsx',
  'screens/finance/FinanceScreen.tsx',
  'screens/profile/ProfileScreen.tsx',
  'components/review/review-hub-screen.tsx',
];
for (const rel of tabs) {
  const src = read(rel);
  assert(/useLocalQuery/.test(src), `${rel} 应使用 useLocalQuery`);
  assert(/observeLocal:\s*false/.test(src), `${rel} 的 usePageFocusReload 应交由 useLocalQuery 观察本地表`);
}

console.log('[pass] phase5 ui invariants');
