/**
 * 临期优先级：不紧急 → 紧急（保留重要轴）+ 写库/UI 锁定规则
 * 运行：npx --yes tsx scripts/test-due-soon-priority-bump.ts
 */
import assert from 'node:assert/strict';

import {
  bumpNonUrgentToUrgentPriority,
  clampPriorityForDeadline,
  getDeadlineEffectivePriority,
  getDueSoonEffectivePriority,
  isDeadlineRequiringUrgent,
  isDueWithinPriorityWindow,
  isNonUrgentPriorityKey,
  shouldLockNonUrgentPriority,
} from '../lib/due-soon-priority-bump';

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

check('bump：1→3 / 2→4 / 0→3 / 已紧急不变', () => {
  assert.equal(bumpNonUrgentToUrgentPriority(0), 3);
  assert.equal(bumpNonUrgentToUrgentPriority(1), 3);
  assert.equal(bumpNonUrgentToUrgentPriority(2), 4);
  assert.equal(bumpNonUrgentToUrgentPriority(3), null);
  assert.equal(bumpNonUrgentToUrgentPriority(4), null);
});

check('窗口：今天到 +3 天命中，+4 / 昨天不命中', () => {
  const today = '2026-11-10';
  assert.equal(isDueWithinPriorityWindow(today, '2026-11-10'), true);
  assert.equal(isDueWithinPriorityWindow(today, '2026-11-13'), true);
  assert.equal(isDueWithinPriorityWindow(today, '2026-11-14'), false);
  assert.equal(isDueWithinPriorityWindow(today, '2026-11-09'), false);
  assert.equal(isDueWithinPriorityWindow(today, null), false);
});

check('强制紧急：过期与临期都命中', () => {
  const today = '2026-11-10';
  assert.equal(isDeadlineRequiringUrgent(today, '2026-11-09'), true);
  assert.equal(isDeadlineRequiringUrgent(today, '2026-11-13'), true);
  assert.equal(isDeadlineRequiringUrgent(today, '2026-11-14'), false);
  assert.equal(shouldLockNonUrgentPriority(today, '2026-11-12'), true);
  assert.equal(shouldLockNonUrgentPriority(today, '2026-11-20'), false);
  assert.equal(shouldLockNonUrgentPriority(today, null, { overdue: true }), true);
});

check('写库 clamp：临期禁止保留不紧急', () => {
  assert.equal(clampPriorityForDeadline(1, '2026-11-10', '2026-11-12'), 3);
  assert.equal(clampPriorityForDeadline(2, '2026-11-10', '2026-11-12'), 4);
  assert.equal(clampPriorityForDeadline(1, '2026-11-10', '2026-11-20'), 1);
  assert.equal(clampPriorityForDeadline(3, '2026-11-10', '2026-11-12'), 3);
});

check('effective：临期才升，否则保持', () => {
  assert.equal(getDueSoonEffectivePriority(2, '2026-11-10', '2026-11-12'), 4);
  assert.equal(getDueSoonEffectivePriority(1, '2026-11-10', '2026-11-12'), 3);
  assert.equal(getDueSoonEffectivePriority(2, '2026-11-10', '2026-11-20'), 2);
  assert.equal(getDueSoonEffectivePriority(4, '2026-11-10', '2026-11-12'), 4);
});

check('过期也不要把「不重要」刷成「重要」', () => {
  assert.equal(
    getDeadlineEffectivePriority(1, { todayYmd: '2026-11-10', dueYmd: '2026-11-01', overdue: true }),
    3,
  );
  assert.equal(
    getDeadlineEffectivePriority(2, { todayYmd: '2026-11-10', dueYmd: '2026-11-01', overdue: true }),
    4,
  );
});

check('非紧急 key 识别', () => {
  assert.equal(isNonUrgentPriorityKey('not-urgent-important'), true);
  assert.equal(isNonUrgentPriorityKey('not-urgent-not-important'), true);
  assert.equal(isNonUrgentPriorityKey('urgent-important'), false);
  assert.equal(isNonUrgentPriorityKey('urgent-not-important'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
