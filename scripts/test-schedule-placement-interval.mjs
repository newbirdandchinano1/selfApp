/**
 * 阶段 C：resolvePlacementInterval 与 slot→分钟 / formatMinuteRangeLabel 一致
 * 运行：npm run test:schedule-placement-interval
 */
import assert from 'node:assert/strict';
import {
  formatMinuteRangeLabel,
  getSlotCount,
  normalizeAxisSettings,
  placementEndMinutes,
  slotStartMinutes,
} from '../lib/schedule/axis.ts';
import {
  isAllDaySpan,
  normalizePlacementsMinutesInMemory,
  resolvePlacementInterval,
} from '../lib/schedule/timeline/from-placement.ts';

const axis = normalizeAxisSettings({
  startMinutes: 8 * 60,
  endMinutes: 22 * 60,
  slotHours: 2,
  breaks: [{ startMinutes: 12 * 60, endMinutes: 14 * 60, label: '午休' }],
});

const daySlots = getSlotCount(axis);
assert.ok(daySlots >= 2, `expected work slots, got ${daySlots}`);

// 派生：首格
{
  const p = {
    startSlotIndex: 0,
    spanSlots: 1,
    orphaned: 0,
    startMinutes: null,
    endMinutes: null,
    allDay: null,
  };
  const iv = resolvePlacementInterval(p, axis);
  assert.ok(iv, 'first slot should resolve');
  assert.equal(iv.source, 'derived');
  assert.equal(iv.startMinutes, slotStartMinutes(axis, 0));
  assert.equal(iv.endMinutes, placementEndMinutes(axis, 0, 1));
  assert.equal(
    formatMinuteRangeLabel(iv.startMinutes, iv.endMinutes),
    formatMinuteRangeLabel(slotStartMinutes(axis, 0), placementEndMinutes(axis, 0, 1)),
  );
  assert.equal(iv.allDay, isAllDaySpan(0, 1, daySlots));
}

// 派生：跨多格（午休前后仍可连续工作格索引）
{
  const startSlot = Math.min(1, daySlots - 1);
  const span = Math.min(2, daySlots - startSlot);
  const p = {
    startSlotIndex: startSlot,
    spanSlots: span,
    orphaned: 0,
  };
  const iv = resolvePlacementInterval(p, axis);
  assert.ok(iv);
  assert.equal(iv.source, 'derived');
  assert.equal(iv.startMinutes, slotStartMinutes(axis, startSlot));
  assert.equal(iv.endMinutes, placementEndMinutes(axis, startSlot, span));
  assert.ok(iv.endMinutes > iv.startMinutes);
}

// 全天（自首格铺满）
{
  const p = {
    startSlotIndex: 0,
    spanSlots: daySlots,
    orphaned: 0,
  };
  const iv = resolvePlacementInterval(p, axis);
  assert.ok(iv);
  assert.equal(iv.allDay, true);
  assert.equal(isAllDaySpan(0, daySlots, daySlots), true);
}

// 存库分钟优先
{
  const p = {
    startSlotIndex: 0,
    spanSlots: 1,
    orphaned: 0,
    startMinutes: 15 * 60 + 5,
    endMinutes: 16 * 60 + 20,
    allDay: null,
  };
  const iv = resolvePlacementInterval(p, axis);
  assert.ok(iv);
  assert.equal(iv.source, 'stored');
  assert.equal(iv.startMinutes, 15 * 60 + 5);
  assert.equal(iv.endMinutes, 16 * 60 + 20);
  assert.equal(iv.allDay, false);
  assert.equal(formatMinuteRangeLabel(iv.startMinutes, iv.endMinutes), '15-16');
}

// orphaned → null
{
  const iv = resolvePlacementInterval(
    { startSlotIndex: null, spanSlots: 1, orphaned: 1 },
    axis,
  );
  assert.equal(iv, null);
}

// 无格无分钟 → null
{
  const iv = resolvePlacementInterval(
    { startSlotIndex: null, spanSlots: 1, orphaned: 0 },
    axis,
  );
  assert.equal(iv, null);
}

// 无效存库分钟回退派生
{
  const p = {
    startSlotIndex: 0,
    spanSlots: 1,
    orphaned: 0,
    startMinutes: 100,
    endMinutes: 100,
  };
  const iv = resolvePlacementInterval(p, axis);
  assert.ok(iv);
  assert.equal(iv.source, 'derived');
  assert.equal(iv.startMinutes, slotStartMinutes(axis, 0));
}

// 内存 normalize：填 null，不改已有
{
  const rows = [
    {
      id: 'a',
      weekStartYmd: '2026-11-03',
      weekday: 1,
      startSlotIndex: 0,
      spanSlots: 1,
      startMinutes: null,
      endMinutes: null,
      allDay: null,
      subjectKind: 'task',
      subjectId: 't1',
      orphaned: 0,
      createdAt: '',
      updatedAt: '',
      syncStatus: 'synced',
    },
    {
      id: 'b',
      weekStartYmd: '2026-11-03',
      weekday: 1,
      startSlotIndex: 0,
      spanSlots: 1,
      startMinutes: 9 * 60,
      endMinutes: 9 * 60 + 30,
      allDay: 0,
      subjectKind: 'task',
      subjectId: 't2',
      orphaned: 0,
      createdAt: '',
      updatedAt: '',
      syncStatus: 'synced',
    },
    {
      id: 'c',
      weekStartYmd: '2026-11-03',
      weekday: 1,
      startSlotIndex: null,
      spanSlots: 1,
      startMinutes: null,
      endMinutes: null,
      allDay: null,
      subjectKind: 'task',
      subjectId: 't3',
      orphaned: 1,
      createdAt: '',
      updatedAt: '',
      syncStatus: 'synced',
    },
  ];
  const next = normalizePlacementsMinutesInMemory(rows, axis);
  assert.equal(next[0].startMinutes, slotStartMinutes(axis, 0));
  assert.equal(next[0].endMinutes, placementEndMinutes(axis, 0, 1));
  assert.equal(next[0].allDay, 0);
  assert.equal(next[1].startMinutes, 9 * 60);
  assert.equal(next[1].endMinutes, 9 * 60 + 30);
  assert.equal(next[2].startMinutes, null);
  assert.equal(next[2].orphaned, 1);
}

console.log('ok: schedule placement interval (phase C)');
