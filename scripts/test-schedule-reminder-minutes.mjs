/**
 * 阶段 I：提醒 / glance 分钟优先契约（无 React / 无 DB）
 * - 存库分钟 → 触发点与卡片开始一致（非格起点）
 * - 无分钟 → slot 派生
 * - orphaned → 不提醒
 * 运行：npm run test:schedule-reminder-minutes
 */
import assert from 'node:assert/strict';
import {
  axisMinutesToLocalDate,
  resolvePlacementReminderStart,
} from '../lib/schedule/timeline/reminder-start.ts';
import { resolvePlacementInterval } from '../lib/schedule/timeline/from-placement.ts';
import { formatAxisHm } from '../lib/widgets/frog-schedule-glance.ts';
import { slotStartMinutes } from '../lib/schedule/axis.ts';

const hm = (h, m = 0) => h * 60 + m;

const axis = { startMinutes: hm(8), endMinutes: hm(22), slotHours: 2 };

function placement(partial) {
  return {
    id: partial.id ?? 'p1',
    weekStartYmd: '2026-11-02',
    weekday: 3, // 周三 = 2026-11-04
    startSlotIndex: partial.startSlotIndex ?? null,
    spanSlots: partial.spanSlots ?? 1,
    startMinutes: partial.startMinutes ?? null,
    endMinutes: partial.endMinutes ?? null,
    allDay: partial.allDay ?? 0,
    subjectKind: 'task',
    subjectId: 't1',
    orphaned: partial.orphaned ?? 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  };
}

// 1) 存库 15:05：提醒开始 ≠ 格起点 14:00
{
  const p = placement({
    startSlotIndex: 3, // 14–16
    spanSlots: 1,
    startMinutes: hm(15, 5),
    endMinutes: hm(16, 20),
  });
  const slotStart = slotStartMinutes(axis, 3);
  assert.equal(slotStart, hm(14));

  const rem = resolvePlacementReminderStart(p, axis);
  assert.ok(rem);
  assert.equal(rem.startMinutes, hm(15, 5));
  assert.notEqual(rem.startMinutes, slotStart);

  const iv = resolvePlacementInterval(p, axis);
  assert.equal(iv.source, 'stored');
  assert.equal(iv.startMinutes, rem.startMinutes);
  assert.equal(formatAxisHm(iv.startMinutes), '15:05');
  assert.equal(formatAxisHm(iv.endMinutes), '16:20');

  // 本地 Date 时分与轴分钟一致
  assert.equal(rem.startAt.getHours(), 15);
  assert.equal(rem.startAt.getMinutes(), 5);
  assert.equal(rem.assignYmd, '2026-11-04');
}

// 2) 无分钟：由 slot 派生
{
  const p = placement({
    startSlotIndex: 3,
    spanSlots: 1,
    startMinutes: null,
    endMinutes: null,
  });
  const rem = resolvePlacementReminderStart(p, axis);
  assert.ok(rem);
  assert.equal(rem.startMinutes, hm(14));
  assert.equal(formatAxisHm(rem.startMinutes), '14:00');
}

// 3) orphaned → null
{
  const p = placement({ orphaned: 1, startSlotIndex: null, startMinutes: hm(15), endMinutes: hm(16) });
  assert.equal(resolvePlacementReminderStart(p, axis), null);
  assert.equal(resolvePlacementInterval(p, axis), null);
}

// 4) 跨午夜轴分钟 → Date 滚到次日
{
  const d = axisMinutesToLocalDate('2026-11-04', 25 * 60 + 30); // 次日 01:30
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 5);
  assert.equal(d.getHours(), 1);
  assert.equal(d.getMinutes(), 30);
}

console.log('ok: schedule reminder minutes (phase I)');
