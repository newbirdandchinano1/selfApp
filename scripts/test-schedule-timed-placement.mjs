/**
 * 阶段 G：按分钟入格的纯逻辑契约（无 React / 无 DB）
 * - 分钟区间 → 工作格派生（双写 slot）
 * - 禁跨 break（半开相交）
 * - 全天覆盖 / 分钟优先解析
 * 运行：npm run test:schedule-timed-placement
 */
import assert from 'node:assert/strict';
import {
  breakIntersectingInterval,
  deriveSlotSpanForMinutes,
  listWorkSlots,
  workCoverageMinutes,
} from '../lib/schedule/axis.ts';
import {
  isAllDayByWorkCoverage,
  resolvePlacementInterval,
} from '../lib/schedule/timeline/from-placement.ts';

const hm = (h, m = 0) => h * 60 + m;

// 基础轴：8:00–22:00，2h/格，无断开 → 7 格
{
  const axis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 2 };
  assert.equal(listWorkSlots(axis).length, 7);

  const cover = deriveSlotSpanForMinutes(axis, hm(15, 5), hm(16, 20));
  assert.ok(cover, 'expected cover');
  assert.equal(cover.startSlotIndex, 3); // 14–16
  assert.equal(cover.spanSlots, 2); // 覆盖到 16–18

  // 结束恰好落在格边界：只覆盖到该格
  const edge = deriveSlotSpanForMinutes(axis, hm(15, 5), hm(16));
  assert.equal(edge.startSlotIndex, 3);
  assert.equal(edge.spanSlots, 1);

  // 起点落在轴外 / 结束不晚于开始 → null
  assert.equal(deriveSlotSpanForMinutes(axis, hm(7), hm(9)), null);
  assert.equal(deriveSlotSpanForMinutes(axis, hm(9), hm(9)), null);

  // 无断开
  assert.equal(breakIntersectingInterval(axis, hm(9), hm(15)), null);

  // 全天覆盖
  const cov = workCoverageMinutes(axis);
  assert.deepEqual(cov, { startMinutes: hm(8), endMinutes: hm(22) });
}

// 含午休 12:00–14:00：工作格 8-10,10-12,14-16,16-18,18-20,20-22（6 格）
{
  const axis = {
    startMinutes: hm(8),
    endMinutes: hm(22),
    slotHours: 2,
    breaks: [{ startMinutes: hm(12), endMinutes: hm(14), label: '午休' }],
  };
  assert.equal(listWorkSlots(axis).length, 6);

  // 跨越午休 → 命中
  const brk = breakIntersectingInterval(axis, hm(9), hm(13));
  assert.ok(brk);
  assert.equal(brk.label, '午休');

  // 半开：11–12 正好到午休起点不算相交；14–15 从午休终点开始也不算
  assert.equal(breakIntersectingInterval(axis, hm(11), hm(12)), null);
  assert.equal(breakIntersectingInterval(axis, hm(14), hm(15)), null);

  // 起点落在午休内 → 无法派生
  assert.equal(deriveSlotSpanForMinutes(axis, hm(12, 30), hm(13, 30)), null);

  // 11:30–15:00：起点在 10-12 格内，end 在 14-16 格内 → slot1 起，span 2
  const cover = deriveSlotSpanForMinutes(axis, hm(11, 30), hm(15));
  assert.equal(cover.startSlotIndex, 1);
  assert.equal(cover.spanSlots, 2);

  // 全天覆盖仍跨断开：8:00–22:00
  assert.deepEqual(workCoverageMinutes(axis), { startMinutes: hm(8), endMinutes: hm(22) });
}

// 跨午夜轴：20:00 – 次日 02:00（1200–1560）
{
  const axis = { startMinutes: hm(20), endMinutes: 26 * 60, slotHours: 2 };
  assert.equal(listWorkSlots(axis).length, 3);
  const cover = deriveSlotSpanForMinutes(axis, 25 * 60 + 5, 25 * 60 + 50);
  assert.equal(cover.startSlotIndex, 2); // 24–26 点（次日 0–2）
  assert.equal(cover.spanSlots, 1);
  assert.deepEqual(workCoverageMinutes(axis), { startMinutes: hm(20), endMinutes: 26 * 60 });
}

// 分钟优先解析：有存库分钟 → stored；全天覆盖识别
{
  const axis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 2 };
  const iv = resolvePlacementInterval(
    {
      startSlotIndex: 1,
      spanSlots: 1,
      startMinutes: hm(15, 5),
      endMinutes: hm(16, 20),
      allDay: 0,
      orphaned: 0,
    },
    axis,
  );
  assert.ok(iv);
  assert.equal(iv.source, 'stored');
  assert.equal(iv.startMinutes, hm(15, 5));
  assert.equal(iv.endMinutes, hm(16, 20));
  assert.equal(iv.allDay, false);

  assert.equal(isAllDayByWorkCoverage(axis, hm(8), hm(22)), true);
  assert.equal(isAllDayByWorkCoverage(axis, hm(9), hm(17)), false);

  const allDayIv = resolvePlacementInterval(
    {
      startSlotIndex: 0,
      spanSlots: 7,
      startMinutes: hm(8),
      endMinutes: hm(22),
      allDay: 1,
      orphaned: 0,
    },
    axis,
  );
  assert.equal(allDayIv.allDay, true);
}

console.log('ok: schedule timed placement (phase G)');
