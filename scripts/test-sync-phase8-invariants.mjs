/**
 * Phase 8：同步不变量（源码 grep）。
 * 运行：npm run test:sync-phase8-invariants
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..');

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(abs) {
  return fs.readFileSync(abs, 'utf8');
}

function walkFiles(dir, acc = []) {
  const skip = new Set(['node_modules', 'dist', '.git', '.expo', 'android', 'ios']);
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

console.log('=== Phase 8: source invariants ===\n');

const applyCore = read(path.join(appRoot, 'lib', 'sync-apply-core.ts'));
const applyCoreCode = stripComments(applyCore);
check(
  'apply 核心无 device_id 比较',
  !/\bdeviceId\b/.test(applyCoreCode) && !/\bdevice_id\b/.test(applyCoreCode),
);
check('decide() 存在且不读 device', /export function decide\(local: LocalRowState, event: PullEvent\)/.test(applyCore));

const mgr = read(path.join(appRoot, 'lib', 'sync-manager.ts'));
check('关 SSE 配置 EXPO_PUBLIC_SYNC_SSE_ENABLED', /EXPO_PUBLIC_SYNC_SSE_ENABLED/.test(mgr));
check('SSE onChanges 只调 pullChanges', /onChanges:\s*\(\)\s*=>\s*schedulePullFromSse\(\)/.test(mgr));

const sse = read(path.join(appRoot, 'lib', 'sync-sse.ts'));
const sseCode = stripComments(sse);
check('App SSE 不写 SQLite', !/getDatabase\(/.test(sseCode) && !/runAsync\(/.test(sseCode));

const focus = read(path.join(appRoot, 'hooks', 'use-page-focus-reload.ts'));
check('页面 focus 不再 pull', !/pullChanges\(/.test(focus) && !/pullAndApplySyncChanges/.test(focus));

const session = read(path.join(appRoot, 'lib', 'page-api-session.ts'));
check('未复活 pagesNeedingRestRefresh', !/pagesNeedingRestRefresh/.test(session));

const appFiles = walkFiles(appRoot);
const restRefreshHits = appFiles.filter((f) => {
  const rel = f.replace(appRoot, '');
  if (rel.includes('test-sync-phase')) return false;
  const src = read(f);
  return /pagesNeedingRestRefresh/.test(src);
});
check('App 无 pagesNeedingRestRefresh', restRefreshHits.length === 0, restRefreshHits.join(', '));

const syncFullHits = [];
for (const root of [
  path.join(repoRoot, 'self_app_back', 'src'),
  path.join(appRoot, 'lib'),
  path.join(repoRoot, 'selfAPP_destop', 'src'),
]) {
  for (const f of walkFiles(root)) {
    const code = stripComments(read(f));
    if (/['"`]\/api\/app\/sync\/full['"`]/.test(code) || /router\.(get|post)\(\s*['"`]\/full['"`]/.test(code)) {
      syncFullHits.push(f);
    }
  }
}
check('禁止 /api/app/sync/full 路由', syncFullHits.length === 0, syncFullHits.join(', '));

const pullSrc = read(path.join(appRoot, 'lib', 'sync-pull.ts'));
check('App pull 使用 decide 按页 apply', /decide\(local/.test(pullSrc));
check('App pull 不逐 pk GET 业务行', !/apiGetRecord\(/.test(pullSrc));

const deskMgr = path.join(repoRoot, 'selfAPP_destop', 'src', 'renderer', 'src', 'shared', 'sync', 'sync-manager.ts');
if (fs.existsSync(deskMgr)) {
  const d = read(deskMgr);
  check('桌面关 SSE 配置 VITE_SYNC_SSE_ENABLED', /VITE_SYNC_SSE_ENABLED/.test(d));
  check('桌面 SSE 只调 pullChanges', /onChanges:\s*\(\)\s*=>\s*schedulePullFromSse\(\)/.test(d));
}

const deskPull = path.join(repoRoot, 'selfAPP_destop', 'src', 'renderer', 'src', 'shared', 'sync', 'sync-pull.ts');
if (fs.existsSync(deskPull)) {
  const d = stripComments(read(deskPull));
  check(
    '桌面 apply 不按 deviceId 分支',
    !/event\.deviceId\s*===/.test(d) && !/ev\.deviceId\s*===/.test(d),
  );
}

console.log(`\n=== 结果：${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
