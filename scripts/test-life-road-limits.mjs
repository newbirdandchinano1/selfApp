/**
 * 阶段 1 自测 1-C：限额与字段校验（纯逻辑，不连网）。
 * 运行：node scripts/test-life-road-limits.mjs
 */
import assert from 'node:assert/strict';

const LIFE_BET_YEAR_ACTIVE_LIMIT = 5;
const LIFE_BET_HORIZON_VALUES = ['year', 'multi', 'farther'];
const LIFE_BET_STATUS_VALUES = ['on_track', 'paused', 'arrived', 'dropped'];
const ACTIVE = new Set(['on_track', 'paused']);

function unicodeLen(text) {
  return [...text].length;
}

function trimRequiredText(value, field, maxChars) {
  if (value == null) throw new Error(`${field} 必填`);
  const text = String(value).trim();
  if (!text) throw new Error(`${field} 必填`);
  if (unicodeLen(text) > maxChars) throw new Error(`${field} 最多 ${maxChars} 字`);
  return text;
}

function assertLifeBetYearRulesMerged({ horizon, year, status, activeCountSameYear }) {
  if (horizon === 'year' && year == null) {
    throw new Error('「今年」桶必须填写公历年');
  }
  if (!ACTIVE.has(status)) return;
  if (horizon !== 'year' || year == null) return;
  if (activeCountSameYear >= LIFE_BET_YEAR_ACTIVE_LIMIT) {
    throw new Error(
      `今年进行中的道路赌注最多 ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条（在路上/暂搁）；已抵达或放弃不占名额`,
    );
  }
}

function expectThrow(fn, re) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (re && !re.test(String(e.message))) {
      throw new Error(`期望匹配 ${re}，实际：${e.message}`);
    }
  }
  assert.equal(threw, true, '应抛错');
}

console.log('=== life-road limits (1-C) ===\n');

assert.equal(LIFE_BET_YEAR_ACTIVE_LIMIT, 5);
assert.ok(LIFE_BET_HORIZON_VALUES.includes('year'));
assert.ok(LIFE_BET_STATUS_VALUES.includes('on_track'));

assert.equal(trimRequiredText('  方向  ', '总方向', 200), '方向');
expectThrow(() => trimRequiredText('  ', '总方向', 200), /必填/);
expectThrow(() => trimRequiredText('x'.repeat(201), '总方向', 200), /最多/);

// 第 5 条仍可创建（count=4）
assertLifeBetYearRulesMerged({
  horizon: 'year',
  year: 2026,
  status: 'on_track',
  activeCountSameYear: 4,
});
console.log('ok: 第 5 条进行中允许');

// 第 6 条拦截（count=5）
expectThrow(
  () =>
    assertLifeBetYearRulesMerged({
      horizon: 'year',
      year: 2026,
      status: 'on_track',
      activeCountSameYear: 5,
    }),
  /最多 5/,
);
console.log('ok: 第 6 条进行中拦截');

// 已抵达不占名额
assertLifeBetYearRulesMerged({
  horizon: 'year',
  year: 2026,
  status: 'arrived',
  activeCountSameYear: 5,
});
console.log('ok: 已抵达不占名额');

// multi 不限额
assertLifeBetYearRulesMerged({
  horizon: 'multi',
  year: null,
  status: 'on_track',
  activeCountSameYear: 99,
});
console.log('ok: multi 不限额');

expectThrow(
  () =>
    assertLifeBetYearRulesMerged({
      horizon: 'year',
      year: null,
      status: 'on_track',
      activeCountSameYear: 0,
    }),
  /公历年/,
);
console.log('ok: year 桶缺 year 拒绝');

console.log('\n全部通过\n');
