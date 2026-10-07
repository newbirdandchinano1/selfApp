/**
 * 定时预扣：过点不显示 / 多条叠加 / 新周期恢复
 * 用法：node scripts/test-finance-scheduled-withholding.mjs
 *
 * 算法与 lib/finance-scheduled-expense.ts 的 estimate/sum（含 now/paidSlots）对齐。
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function compareYmd(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addDaysToYmd(ymd, delta) {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + delta);
  return formatYmd(d);
}

function parseStoredDatetime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim());
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

function scheduledExpenseHappenedAtIso(ymd, hour, minute, slotIndex) {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const totalMinutes = hour * 60 + minute + slotIndex;
  const h = Math.floor(totalMinutes / 60) % 24;
  const min = totalMinutes % 60;
  const d = new Date(+m[1], +m[2] - 1, +m[3], h, min, 0, 0);
  return `${formatYmd(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function buildSlotKey(expenseId, ymd, slotIndex) {
  return `${expenseId}:${ymd}:${slotIndex}`;
}

function isDueMonthly(item, ymd) {
  const day = Number(ymd.slice(8, 10));
  return item.monthlyDays.includes(day);
}

function isDueDaily() {
  return true;
}

function isDue(item, ymd) {
  if (item.repeatOption === 'daily') return isDueDaily();
  if (item.repeatOption === 'monthly') return isDueMonthly(item, ymd);
  return false;
}

function estimateInRange(item, startInclusive, endExclusive, opts = {}) {
  if (!item.enabled) return 0;
  if (opts.onlyIncludeInBudget !== false && !item.includeInBudget) return 0;
  const startYmd = formatYmd(startInclusive);
  const endYmd = formatYmd(endExclusive);
  if (compareYmd(startYmd, endYmd) >= 0) return 0;

  const filterRemaining = opts.now != null || opts.paidSlots != null;
  const now = opts.now ?? null;
  const nowYmd = now ? formatYmd(now) : null;
  const nowMs = now ? now.getTime() : null;
  const times = Math.max(1, Math.floor(item.timesPerDay) || 1);

  let total = 0;
  let cursor = startYmd;
  while (cursor && compareYmd(cursor, endYmd) < 0) {
    if (isDue(item, cursor)) {
      if (!filterRemaining) {
        total += item.amount * times;
      } else {
        for (let slot = 0; slot < times; slot += 1) {
          if (opts.paidSlots?.has(buildSlotKey(item.id, cursor, slot))) continue;
          if (nowYmd != null && nowMs != null) {
            const dayCmp = compareYmd(cursor, nowYmd);
            if (dayCmp < 0) continue;
            if (dayCmp === 0) {
              const happenedMs = parseStoredDatetime(
                scheduledExpenseHappenedAtIso(cursor, item.hour, item.minute, slot),
              ).getTime();
              if (Number.isFinite(happenedMs) && nowMs >= happenedMs) continue;
            }
          }
          total += item.amount;
        }
      }
    }
    const next = addDaysToYmd(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return total;
}

function sumInRange(items, start, end, opts) {
  return items.reduce((s, it) => s + estimateInRange(it, start, end, opts), 0);
}

/** 与 FinanceScreen / computeScheduledWithholdingRemaining 同口径 */
function computeRemaining(items, today, budgetPeriodEndExclusive, opts = {}) {
  const now = opts.now ?? new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let endExclusive = budgetPeriodEndExclusive;
  if (opts.savingsGoalTargetDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.savingsGoalTargetDate);
    if (m) endExclusive = new Date(+m[1], +m[2] - 1, +m[3] + 1);
  }
  if (endExclusive.getTime() <= start.getTime()) return 0;
  return sumInRange(items, start, endExclusive, {
    now,
    paidSlots: opts.paidSlots ?? new Set(),
  });
}

function clampDay(year, monthIndex0, day) {
  const last = new Date(year, monthIndex0 + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

function getBudgetPeriodStart(d, refreshDay) {
  const r = Math.min(31, Math.max(1, refreshDay));
  const y = d.getFullYear();
  const m = d.getMonth();
  const dom = d.getDate();
  const rThis = clampDay(y, m, r);
  if (dom >= rThis) return new Date(y, m, rThis, 0, 0, 0, 0);
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 11 : m - 1;
  return new Date(py, pm, clampDay(py, pm, r), 0, 0, 0, 0);
}

function getNextBudgetPeriodStart(periodStart, refreshDay) {
  const r = Math.min(31, Math.max(1, refreshDay));
  const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
  return new Date(cursor.getFullYear(), cursor.getMonth(), clampDay(cursor.getFullYear(), cursor.getMonth(), r), 0, 0, 0, 0);
}

function item(partial) {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    amount: partial.amount,
    accountId: 'acc',
    repeatOption: partial.repeatOption ?? 'monthly',
    weeklyDays: [],
    monthlyDays: partial.monthlyDays ?? [],
    hour: partial.hour ?? 9,
    minute: partial.minute ?? 0,
    timesPerDay: partial.timesPerDay ?? 1,
    includeInBudget: partial.includeInBudget !== false,
    enabled: partial.enabled !== false,
    createdAt: '2026-01-01T00:00:00',
  };
}

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

function eq(name, actual, expected) {
  check(name, actual === expected, `got ${actual}, want ${expected}`);
}

// ---------- 场景 ----------

const rent = item({ id: 'rent', amount: 500, monthlyDays: [19], hour: 9, minute: 0 });
const vip = item({ id: 'vip', amount: 200, monthlyDays: [25], hour: 10, minute: 0 });
const dailyCoffee = item({
  id: 'coffee',
  amount: 30,
  repeatOption: 'daily',
  monthlyDays: [],
  hour: 8,
  minute: 0,
});

// 1) 未过点：10/8 看本月周期，应显示 19 日 500
{
  const today = new Date(2026, 9, 8);
  const periodStart = getBudgetPeriodStart(today, 1);
  const periodEnd = getNextBudgetPeriodStart(periodStart, 1);
  const now = new Date(2026, 9, 8, 12, 0, 0);
  const v = computeRemaining([rent], today, periodEnd, { now });
  eq('未过点：10/8 显示 19 日预扣 500', v, 500);
  check('周期含 10/19', formatYmd(periodStart) === '2026-10-01' && formatYmd(periodEnd) === '2026-11-01');
}

// 2) 过了支付时间：10/19 10:00，计划 09:00 → 不显示
{
  const today = new Date(2026, 9, 19);
  const periodStart = getBudgetPeriodStart(today, 1);
  const periodEnd = getNextBudgetPeriodStart(periodStart, 1);
  const now = new Date(2026, 9, 19, 10, 0, 0);
  const v = computeRemaining([rent], today, periodEnd, { now });
  eq('过点后：10/19 10:00 预扣为 0', v, 0);
}

// 3) 当天尚未到点：10/19 08:00 → 仍显示
{
  const today = new Date(2026, 9, 19);
  const periodEnd = getNextBudgetPeriodStart(getBudgetPeriodStart(today, 1), 1);
  const now = new Date(2026, 9, 19, 8, 0, 0);
  const v = computeRemaining([rent], today, periodEnd, { now });
  eq('当天未到点：10/19 08:00 仍显示 500', v, 500);
}

// 4) 已支付（未过点也排除）
{
  const today = new Date(2026, 9, 8);
  const periodEnd = getNextBudgetPeriodStart(getBudgetPeriodStart(today, 1), 1);
  const now = new Date(2026, 9, 8, 12, 0, 0);
  const paid = new Set([buildSlotKey('rent', '2026-10-19', 0)]);
  const v = computeRemaining([rent], today, periodEnd, { now, paidSlots: paid });
  eq('已支付：即使未过点也不显示', v, 0);
}

// 5) 多条叠加
{
  const today = new Date(2026, 9, 8);
  const periodEnd = getNextBudgetPeriodStart(getBudgetPeriodStart(today, 1), 1);
  const now = new Date(2026, 9, 8, 12, 0, 0);
  const v = computeRemaining([rent, vip], today, periodEnd, { now });
  eq('多条叠加：500+200=700', v, 700);
}

// 6) 多条中一条过点后只剩另一条
{
  const today = new Date(2026, 9, 20);
  const periodEnd = getNextBudgetPeriodStart(getBudgetPeriodStart(today, 1), 1);
  const now = new Date(2026, 9, 20, 12, 0, 0);
  const v = computeRemaining([rent, vip], today, periodEnd, { now });
  eq('19 日已过后只剩 25 日 200', v, 200);
}

// 7) 新周期恢复：11/1 起，11/19 的 500 重新出现
{
  const today = new Date(2026, 10, 1);
  const periodStart = getBudgetPeriodStart(today, 1);
  const periodEnd = getNextBudgetPeriodStart(periodStart, 1);
  const now = new Date(2026, 10, 1, 9, 0, 0);
  const v = computeRemaining([rent], today, periodEnd, { now });
  eq('新周期：11/1 恢复显示 11/19 的 500', v, 500);
  check('新周期为 11/1–12/1', formatYmd(periodStart) === '2026-11-01' && formatYmd(periodEnd) === '2026-12-01');
}

// 8) 旧周期已过点为 0，新周期独立恢复（对照）
{
  const oct19after = computeRemaining([rent], new Date(2026, 9, 20), new Date(2026, 10, 1), {
    now: new Date(2026, 9, 20, 12, 0, 0),
  });
  const novFresh = computeRemaining([rent], new Date(2026, 10, 5), new Date(2026, 11, 1), {
    now: new Date(2026, 10, 5, 12, 0, 0),
  });
  eq('10/20 本周期剩余为 0', oct19after, 0);
  eq('11/5 新周期再次为 500', novFresh, 500);
}

// 9) 有存款目标时：统计到目标日（跨周期仍含下次扣款）
{
  const today = new Date(2026, 9, 20);
  // 本周期到 11/1，19 日已过 → 周期内 0；目标到 12/1 则含 11/19
  const periodEnd = new Date(2026, 10, 1);
  const now = new Date(2026, 9, 20, 12, 0, 0);
  const withoutGoal = computeRemaining([rent], today, periodEnd, { now });
  const withGoal = computeRemaining([rent], today, periodEnd, {
    now,
    savingsGoalTargetDate: '2026-12-01',
  });
  eq('无目标且 19 日已过：本周期 0', withoutGoal, 0);
  eq('有目标到 12/1：含 11/19 → 500', withGoal, 500);
}

// 10) 每日项：过了今天的点后不含今天，仍含未来日
{
  const today = new Date(2026, 9, 8);
  const periodEnd = new Date(2026, 9, 11); // 10/8–10/10 共 3 天窗口
  const before = computeRemaining([dailyCoffee], today, periodEnd, {
    now: new Date(2026, 9, 8, 7, 0, 0),
  });
  const after = computeRemaining([dailyCoffee], today, periodEnd, {
    now: new Date(2026, 9, 8, 9, 0, 0),
  });
  eq('每日 08:00：7 点含今天共 3×30=90', before, 90);
  eq('每日 08:00：9 点不含今天共 2×30=60', after, 60);
}

// 11) includeInBudget=false 不计入预扣栏
{
  const noBudget = item({ id: 'x', amount: 999, monthlyDays: [19], includeInBudget: false });
  const today = new Date(2026, 9, 8);
  const periodEnd = new Date(2026, 10, 1);
  const v = computeRemaining([noBudget, rent], today, periodEnd, {
    now: new Date(2026, 9, 8, 12, 0, 0),
  });
  eq('未开预扣预算的项不叠加', v, 500);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
