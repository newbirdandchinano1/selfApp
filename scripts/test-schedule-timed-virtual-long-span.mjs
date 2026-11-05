/**
 * 长时段定点：开始落在午休时仍要算出 13:00–17:00 分钟区间
 * 运行：npx tsx scripts/test-schedule-timed-virtual-long-span.mjs
 */
import assert from 'node:assert/strict';
import {
  clockHmToAxisMinutes,
  listWorkSlots,
} from '../lib/schedule/axis.ts';
import { isAllDayByWorkCoverage } from '../lib/schedule/timeline/from-placement.ts';
import {
  eventFrameInAxis,
  layoutOverlappingEvents,
} from '../lib/schedule/timeline/layout.ts';

const axis = {
  startMinutes: 8 * 60,
  endMinutes: 22 * 60,
  slotHours: 2,
  breaks: [{ startMinutes: 12 * 60, endMinutes: 14 * 60, label: '午休' }],
};

function mapWorkSlot(axisLike, hour, minute) {
  const mins = clockHmToAxisMinutes(axisLike, hour, minute);
  if (mins == null) return null;
  for (const slot of listWorkSlots(axisLike)) {
    if (mins >= slot.startMinutes && mins < slot.endMinutes) return slot.slotIndex;
  }
  return null;
}

function nearestWorkSlotIndex(axisLike, axisMinutes) {
  const slots = listWorkSlots(axisLike);
  if (slots.length === 0) return 0;
  for (const slot of slots) {
    if (axisMinutes >= slot.startMinutes && axisMinutes < slot.endMinutes) {
      return slot.slotIndex;
    }
  }
  for (const slot of slots) {
    if (slot.startMinutes >= axisMinutes) return slot.slotIndex;
  }
  return slots[slots.length - 1].slotIndex;
}

function resolveTimed(axisLike, startH, startM, endH, endM) {
  const startMinutes = clockHmToAxisMinutes(axisLike, startH, startM);
  if (startMinutes == null) return null;
  const slotIndex =
    mapWorkSlot(axisLike, startH, startM) ?? nearestWorkSlotIndex(axisLike, startMinutes);
  let endMinutes = startMinutes + 30;
  const endAxis = clockHmToAxisMinutes(axisLike, endH, endM);
  if (endAxis != null && endAxis > startMinutes) endMinutes = endAxis;
  endMinutes = Math.min(endMinutes, axisLike.endMinutes);
  if (!(endMinutes > startMinutes)) return null;
  return { slotIndex, startMinutes, endMinutes };
}

assert.equal(mapWorkSlot(axis, 13, 0), null, '13:00 is inside lunch break');

const timed = resolveTimed(axis, 13, 0, 17, 0);
assert.ok(timed, '13:00–17:00 must resolve through lunch break');
assert.equal(timed.startMinutes, 13 * 60);
assert.equal(timed.endMinutes, 17 * 60);
assert.equal(isAllDayByWorkCoverage(axis, timed.startMinutes, timed.endMinutes), false);

const frame = eventFrameInAxis(timed, axis);
assert.ok(frame);
assert.ok(frame.height > 26);

const afternoon = { startMinutes: 14 * 60, endMinutes: 16 * 60 };
assert.ok(
  timed.startMinutes < afternoon.endMinutes && timed.endMinutes > afternoon.startMinutes,
  'long span must overlap afternoon work slot for minimal focus',
);

// 旧最简态 bug：spanSlots=1 → 只覆盖 12–14 断开邻格，下午 overlap 失败
const oldSlotOnly = { startMinutes: 10 * 60, endMinutes: 12 * 60 };
assert.equal(
  oldSlotOnly.startMinutes < afternoon.endMinutes &&
    oldSlotOnly.endMinutes > afternoon.startMinutes,
  false,
);

const laid = layoutOverlappingEvents([
  { id: 'long', startMinutes: timed.startMinutes, endMinutes: timed.endMinutes, allDay: false },
  { id: 'short', startMinutes: 15 * 60, endMinutes: 15 * 60 + 30, allDay: false },
]);
assert.equal(laid.length, 2);

console.log('ok: long timed span 13:00–17:00 through lunch');
