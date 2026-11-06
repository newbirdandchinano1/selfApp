/**
 * 进度计数轨纯函数契约自测（不依赖 SQLite）。
 * 运行：node scripts/test-progress-counters.mjs
 */
import assert from 'node:assert/strict';

const KEY = 'progress_counters';
const TARGET_MIN = 1;
const TARGET_MAX = 9999;

function clampInt(raw, min, max) {
  let n = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return null;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  const byId = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const target = clampInt(item.target, TARGET_MIN, TARGET_MAX);
    if (!id || !title || target == null) continue;
    byId.set(id, {
      id,
      title,
      target,
      current: Math.max(0, Math.round(Number(item.current) || 0)),
      unit: (typeof item.unit === 'string' && item.unit.trim()) || '次',
      period: item.period === 'week' ? 'week' : 'none',
    });
  }
  return [...byId.values()];
}

function parse(extraData) {
  if (!extraData?.trim()) return [];
  try {
    const parsed = JSON.parse(extraData);
    if (!parsed || typeof parsed !== 'object') return [];
    return normalizeList(parsed[KEY]);
  } catch {
    return [];
  }
}

function evaluate(counters) {
  if (counters.length === 0) return { ratio: null, full: false };
  const usable = counters.filter((c) => c.target > 0);
  if (usable.length === 0) return { ratio: null, full: false };
  const ratio = usable.reduce((s, c) => s + Math.min(1, c.current / c.target), 0) / usable.length;
  return { ratio: Math.min(1, ratio), full: usable.every((c) => c.current >= c.target) };
}

function merge(extraData, counters) {
  let base = {};
  if (extraData?.trim()) {
    try {
      const parsed = JSON.parse(extraData);
      if (parsed && typeof parsed === 'object') base = { ...parsed };
    } catch {
      /* ignore */
    }
  }
  const normalized = normalizeList(counters);
  if (normalized.length === 0) delete base[KEY];
  else base[KEY] = normalized;
  return Object.keys(base).length === 0 ? null : JSON.stringify(base);
}

const empty = parse(null);
assert.equal(empty.length, 0);
assert.equal(evaluate(empty).ratio, null);

const merged = merge(null, [
  { id: 'pc_1', title: '看书', target: 3, current: 1, unit: '次', period: 'week' },
]);
assert.ok(merged);
const parsed = parse(merged);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].title, '看书');
assert.equal(parsed[0].period, 'week');
assert.equal(evaluate(parsed).ratio, 1 / 3);
assert.equal(evaluate(parsed).full, false);

parsed[0].current = 3;
assert.equal(evaluate(parsed).full, true);
assert.equal(evaluate(parsed).ratio, 1);

const cleared = merge(merged, []);
assert.equal(cleared, null);

console.log('progress-counters contract ok');
