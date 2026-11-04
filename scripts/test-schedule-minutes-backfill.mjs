/**
 * 阶段 D：分钟回填纯逻辑（轴选择 + compute，不写 DB）
 * 运行：npm run test:schedule-minutes-backfill
 */
import assert from 'node:assert/strict';
import {
  getSlotCount,
  normalizeAxisSettings,
  placementEndMinutes,
  slotStartMinutes,
} from '../lib/schedule/axis.ts';
import {
  computePlacementMinutesBackfill,
  pickAxisForBackfillWeek,
} from '../lib/schedule/timeline/backfill-minutes-logic.ts';
import { resolvePlacementInterval } from '../lib/schedule/timeline/from-placement.ts';

const currentAxis = normalizeAxisSettings({
  startMinutes: 8 * 60,
  endMinutes: 22 * 60,
  slotHours: 2,
  breaks: [{ startMinutes: 12 * 60, endMinutes: 14 * 60, label: '午休' }],
});

const snapAxis = {
  weekStartYmd: '2026-10-27',
  startMinutes: 9 * 60,
  endMinutes: 18 * 60,
  slotHours: 1,
  breaks: [],
  createdAt: '2026-10-27T00:00:00.000Z',
};

// 有快照 → 必须用快照轴（不可静默用当前轴）
{
  const picked = pickAxisForBackfillWeek(snapAxis, currentAxis);
  assert.equal(picked.source, 'snapshot');
  assert.equal(picked.axis.startMinutes, 9 * 60);
  assert.equal(picked.axis.slotHours, 1);
}

// 无快照 → current + 标记
{
  const picked = pickAxisForBackfillWeek(null, currentAxis);
  assert.equal(picked.source, 'current');
  assert.equal(picked.axis.startMinutes, currentAxis.startMinutes);
  assert.equal(picked.axis.slotHours, currentAxis.slotHours);
}

const daySlots = getSlotCount(currentAxis);

// 缺分钟 → 回填与 resolve / slot 换算一致
{
  const p = {
    id: 'scp_test1',
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
  };
  const computed = computePlacementMinutesBackfill(p, currentAxis);
  assert.ok(computed);
  assert.equal(computed.startMinutes, slotStartMinutes(currentAxis, 0));
  assert.equal(computed.endMinutes, placementEndMinutes(currentAxis, 0, 1));
  assert.equal(computed.allDay, 0);
  const iv = resolvePlacementInterval(p, currentAxis);
  assert.ok(iv);
  assert.equal(computed.startMinutes, iv.startMinutes);
  assert.equal(computed.endMinutes, iv.endMinutes);
}

// 全天铺满
{
  const p = {
    id: 'scp_allday',
    weekStartYmd: '2026-11-03',
    weekday: 2,
    startSlotIndex: 0,
    spanSlots: daySlots,
    startMinutes: null,
    endMinutes: null,
    allDay: null,
    subjectKind: 'project',
    subjectId: 'p1',
    orphaned: 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  };
  const computed = computePlacementMinutesBackfill(p, currentAxis);
  assert.ok(computed);
  assert.equal(computed.allDay, 1);
}

// 已有有效分钟 → 不回填
{
  const p = {
    id: 'scp_has',
    weekStartYmd: '2026-11-03',
    weekday: 3,
    startSlotIndex: 1,
    spanSlots: 1,
    startMinutes: 600,
    endMinutes: 720,
    allDay: 0,
    subjectKind: 'task',
    subjectId: 't2',
    orphaned: 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  };
  assert.equal(computePlacementMinutesBackfill(p, currentAxis), null);
}

// orphaned → null（调用方不得标 orphan；此处仅确认不算回填）
{
  const p = {
    id: 'scp_orph',
    weekStartYmd: '2026-11-03',
    weekday: 4,
    startSlotIndex: 0,
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
  };
  assert.equal(computePlacementMinutesBackfill(p, currentAxis), null);
}

// 无 slot → null
{
  const p = {
    id: 'scp_noslot',
    weekStartYmd: '2026-11-03',
    weekday: 5,
    startSlotIndex: null,
    spanSlots: 1,
    startMinutes: null,
    endMinutes: null,
    allDay: null,
    subjectKind: 'task',
    subjectId: 't4',
    orphaned: 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  };
  assert.equal(computePlacementMinutesBackfill(p, currentAxis), null);
}

// 历史快照轴与当前轴不同时，派生必须跟快照
{
  const picked = pickAxisForBackfillWeek(snapAxis, currentAxis);
  const p = {
    id: 'scp_hist',
    weekStartYmd: snapAxis.weekStartYmd,
    weekday: 1,
    startSlotIndex: 0,
    spanSlots: 1,
    startMinutes: null,
    endMinutes: null,
    allDay: null,
    subjectKind: 'task',
    subjectId: 't5',
    orphaned: 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  };
  const fromSnap = computePlacementMinutesBackfill(p, picked.axis);
  const fromCurrent = computePlacementMinutesBackfill(p, currentAxis);
  assert.ok(fromSnap);
  assert.ok(fromCurrent);
  assert.equal(fromSnap.startMinutes, slotStartMinutes(picked.axis, 0));
  assert.notEqual(fromSnap.startMinutes, fromCurrent.startMinutes);
}

console.log('ok: schedule minutes backfill logic');
