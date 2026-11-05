/**
 * 阶段 H：改轴 remap 分钟优先契约（无 React / 无 DB）
 * - 存库分钟保留绝对时间 + 双写 slot
 * - 无分钟旧行：先 derived 再 remap
 * - 新轴外 / 与 break 相交 → orphaned
 * - 全天随新轴工作覆盖重算
 * 运行：npm run test:schedule-axis-remap-minutes
 */
import assert from 'node:assert/strict';
import {
  intervalFitsAxisRange,
  remapPlacementsForMinutes,
} from '../lib/schedule/timeline/remap-minutes.ts';
import { resolvePlacementInterval } from '../lib/schedule/timeline/from-placement.ts';
import { deriveSlotSpanForMinutes, listWorkSlots } from '../lib/schedule/axis.ts';

const hm = (h, m = 0) => h * 60 + m;

function placement(partial) {
  return {
    id: partial.id ?? 'p1',
    weekStartYmd: '2026-11-02',
    weekday: 1,
    startSlotIndex: partial.startSlotIndex ?? null,
    spanSlots: partial.spanSlots ?? 1,
    startMinutes: partial.startMinutes ?? null,
    endMinutes: partial.endMinutes ?? null,
    allDay: partial.allDay ?? null,
    subjectKind: 'task',
    subjectId: 't1',
    orphaned: partial.orphaned ?? 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  };
}

const oldAxis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 2 };
// 2h → 7 格：0=8-10 … 3=14-16 …

// 1) 存库分钟 15:05–16:20：改格宽 2→1 后仍保留绝对分钟，slot 双写一致
{
  const newAxis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 1 };
  const p = placement({
    id: 'stored',
    startSlotIndex: 3,
    spanSlots: 2,
    startMinutes: hm(15, 5),
    endMinutes: hm(16, 20),
    allDay: 0,
  });
  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, false);
  assert.equal(r.startMinutes, hm(15, 5));
  assert.equal(r.endMinutes, hm(16, 20));
  const cover = deriveSlotSpanForMinutes(newAxis, hm(15, 5), hm(16, 20));
  assert.equal(r.nextStartSlotIndex, cover.startSlotIndex);
  assert.equal(r.nextSpanSlots, cover.spanSlots);
  assert.equal(r.reason, 'stored_minutes');
}

// 2) 无分钟旧行：由旧轴 slot 派生后再 remap（改格宽）
{
  const newAxis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 1 };
  const p = placement({
    id: 'derived',
    startSlotIndex: 3, // 14:00–16:00 on 2h
    spanSlots: 1,
    startMinutes: null,
    endMinutes: null,
  });
  const derived = resolvePlacementInterval(p, oldAxis);
  assert.equal(derived.startMinutes, hm(14));
  assert.equal(derived.endMinutes, hm(16));

  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, false);
  assert.equal(r.startMinutes, hm(14));
  assert.equal(r.endMinutes, hm(16));
  assert.equal(r.reason, 'derived_then_remap');
  // 1h 格：14–15 + 15–16 → start 6, span 2
  assert.equal(r.nextStartSlotIndex, 6);
  assert.equal(r.nextSpanSlots, 2);
}

// 3) 缩轴：占用超出新范围 → orphaned
{
  const newAxis = { startMinutes: hm(8), endMinutes: hm(14), slotHours: 2 };
  const p = placement({
    id: 'oor',
    startSlotIndex: 3,
    spanSlots: 1,
    startMinutes: hm(15, 5),
    endMinutes: hm(16, 20),
  });
  assert.equal(intervalFitsAxisRange(newAxis, hm(15, 5), hm(16, 20)), false);
  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, true);
  assert.ok(String(r.reason).startsWith('out_of_range'));
  assert.equal(r.nextStartSlotIndex, null);
}

// 4) 新增午休与占用相交 → orphaned（与写入禁排一致）
{
  const newAxis = {
    startMinutes: hm(8),
    endMinutes: hm(22),
    slotHours: 2,
    breaks: [{ startMinutes: hm(12), endMinutes: hm(14), label: '午休' }],
  };
  const p = placement({
    id: 'cross-break',
    startSlotIndex: 2,
    spanSlots: 1,
    startMinutes: hm(11),
    endMinutes: hm(13),
  });
  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, true);
  assert.ok(String(r.reason).includes('break'));
}

// 5) 半开：占用贴着 break 边界不算相交 → 仍可入轴
{
  const newAxis = {
    startMinutes: hm(8),
    endMinutes: hm(22),
    slotHours: 2,
    breaks: [{ startMinutes: hm(12), endMinutes: hm(14), label: '午休' }],
  };
  const p = placement({
    id: 'touch-break',
    startSlotIndex: 1,
    spanSlots: 1,
    startMinutes: hm(10),
    endMinutes: hm(12),
  });
  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, false);
  assert.equal(r.startMinutes, hm(10));
  assert.equal(r.endMinutes, hm(12));
  assert.equal(listWorkSlots(newAxis).length, 6);
}

// 6) 全天：随新轴工作覆盖重算
{
  const newAxis = { startMinutes: hm(9), endMinutes: hm(18), slotHours: 3 };
  const p = placement({
    id: 'allday',
    startSlotIndex: 0,
    spanSlots: 7,
    startMinutes: hm(8),
    endMinutes: hm(22),
    allDay: 1,
  });
  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, false);
  assert.equal(r.startMinutes, hm(9));
  assert.equal(r.endMinutes, hm(18));
  assert.equal(r.allDay, 1);
  assert.equal(r.nextStartSlotIndex, 0);
  assert.equal(r.nextSpanSlots, listWorkSlots(newAxis).length);
}

// 7) 已 orphaned 保持 orphaned
{
  const newAxis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 1 };
  const p = placement({ id: 'orphan', orphaned: 1, startSlotIndex: null });
  const [r] = remapPlacementsForMinutes(oldAxis, newAxis, [p]);
  assert.equal(r.orphaned, true);
  assert.equal(r.reason, 'already_orphaned');
}

console.log('ok: schedule axis remap minutes (phase H)');
