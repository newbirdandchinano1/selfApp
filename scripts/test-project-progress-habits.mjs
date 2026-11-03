/**
 * Step 1–2 纯函数自测（不依赖 SQLite）。
 * 运行：node scripts/test-project-progress-habits.mjs
 */
import assert from 'node:assert/strict';

// 无 Metro 别名时不便直接 import TS；此处内联与仓库一致的纯规则做契约自测。
const KEY = 'progress_habit_bindings';
const MIN = 1;
const MAX = 365;

function clampTargetDays(raw) {
  let n = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return null;
  const rounded = Math.round(n);
  if (rounded < MIN || rounded > MAX) return null;
  return rounded;
}

function normalizeBindingList(raw) {
  if (!Array.isArray(raw)) return [];
  const byHabit = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const habitRaw = item.habit_id ?? item.habitId;
    if (typeof habitRaw !== 'string') continue;
    const habitId = habitRaw.trim();
    if (!habitId) continue;
    const targetDays = clampTargetDays(item.target_days ?? item.targetDays);
    if (targetDays == null) continue;
    byHabit.set(habitId, { habitId, targetDays });
  }
  return [...byHabit.values()];
}

function parseProgressHabitBindings(extraData) {
  if (!extraData?.trim()) return [];
  try {
    const parsed = JSON.parse(extraData);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return normalizeBindingList(parsed[KEY]);
  } catch {
    return [];
  }
}

function mergeProgressHabitBindingsIntoExtraDataString(extraData, bindings) {
  let base = {};
  if (extraData?.trim()) {
    try {
      const parsed = JSON.parse(extraData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = { ...parsed };
    } catch {
      /* ignore */
    }
  }
  const normalized = normalizeBindingList(
    (bindings ?? []).map((b) => ({ habit_id: b.habitId, target_days: b.targetDays })),
  );
  if (normalized.length === 0) delete base[KEY];
  else {
    base[KEY] = normalized.map((b) => ({ habit_id: b.habitId, target_days: b.targetDays }));
  }
  return Object.keys(base).length === 0 ? null : JSON.stringify(base);
}

function isHabitDayGoalMet({ kind, todayCount, dailyGoal, hasDayRecord }) {
  const count = Math.max(0, Math.floor(todayCount));
  if (kind === 'break') {
    if (!hasDayRecord) return false;
    const threshold = dailyGoal == null || dailyGoal < 1 ? 1 : dailyGoal;
    return count < threshold;
  }
  if (dailyGoal != null) return count >= dailyGoal;
  return count > 0;
}

function countGoalMetDays(kind, checkIns, dailyGoal) {
  let days = 0;
  for (const ymd of Object.keys(checkIns)) {
    const todayCount = Math.max(0, Math.floor(Number(checkIns[ymd]) || 0));
    const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
    if (isHabitDayGoalMet({ kind, todayCount, dailyGoal, hasDayRecord })) days += 1;
  }
  return days;
}

function aggregateRatio(checks) {
  let sumDone = 0;
  let sumTarget = 0;
  for (const c of checks) {
    sumDone += Math.min(c.targetDays, c.doneDays);
    sumTarget += c.targetDays;
  }
  if (sumTarget <= 0) return { doneDays: 0, targetDays: 0, ratio: null, full: false };
  const ratio = Math.min(1, sumDone / sumTarget);
  return { doneDays: sumDone, targetDays: sumTarget, ratio, full: sumDone >= sumTarget };
}

// --- cases ---
assert.deepEqual(parseProgressHabitBindings(null), []);
assert.deepEqual(parseProgressHabitBindings('{"completion_habit_ids":["a"]}'), []);

const merged = mergeProgressHabitBindingsIntoExtraDataString(
  '{"completion_habit_ids":["c1"],"foo":1}',
  [
    { habitId: 'h1', targetDays: 20 },
    { habitId: 'h1', targetDays: 10 },
    { habitId: 'h2', targetDays: 0 },
    { habitId: 'h3', targetDays: 400 },
  ],
);
const parsedExtra = JSON.parse(merged);
assert.deepEqual(parsedExtra.completion_habit_ids, ['c1']);
assert.equal(parsedExtra.foo, 1);
assert.deepEqual(parseProgressHabitBindings(merged), [{ habitId: 'h1', targetDays: 10 }]);

const checkIns = {};
for (let i = 1; i <= 10; i++) {
  checkIns[`2026-01-${String(i).padStart(2, '0')}`] = 2;
}
checkIns['2026-01-11'] = 2; // same day would still be 1 key
checkIns['2026-01-01'] = 5; // 同日多次仍 1 天
const done = countGoalMetDays('build', checkIns, 1);
assert.equal(done, 11);

const agg = aggregateRatio([
  { targetDays: 20, doneDays: 10 },
  { targetDays: 10, doneDays: 10 },
]);
assert.equal(agg.doneDays, 20);
assert.equal(agg.targetDays, 30);
assert.equal(agg.ratio, 20 / 30);
assert.equal(agg.full, false);

const full = aggregateRatio([{ targetDays: 20, doneDays: 25 }]);
assert.equal(full.doneDays, 20);
assert.equal(full.full, true);
assert.equal(full.ratio, 1);

const cleared = mergeProgressHabitBindingsIntoExtraDataString(merged, []);
assert.equal(JSON.parse(cleared)[KEY], undefined);
assert.deepEqual(JSON.parse(cleared).completion_habit_ids, ['c1']);

console.log('test-project-progress-habits: ok');
