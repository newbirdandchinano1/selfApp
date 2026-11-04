/**
 * 阶段 E：App 侧分钟 payload / hydrate 合并契约
 * 运行：npm run test:schedule-placement-api-minutes
 */
import assert from 'node:assert/strict';
import { mergeRemotePlacementMinutes } from '../lib/schedule/timeline/merge-remote-minutes.ts';
import { serializeFrogSchedulePlacementUpsert } from '../lib/schedule/timeline/serialize-placement-upsert.ts';

// upsert 序列化始终带分钟键（含 null）
{
  const body = serializeFrogSchedulePlacementUpsert({
    id: 'scp_1',
    weekStartYmd: '2026-11-03',
    weekday: 1,
    startSlotIndex: 0,
    spanSlots: 1,
    startMinutes: 480,
    endMinutes: 600,
    allDay: 0,
    subjectKind: 'task',
    subjectId: 't1',
    orphaned: 0,
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    syncStatus: 'pending_update',
  });
  assert.equal(body.startMinutes, 480);
  assert.equal(body.endMinutes, 600);
  assert.equal(body.allDay, 0);
  assert.ok('startMinutes' in body);
}

{
  const body = serializeFrogSchedulePlacementUpsert({
    id: 'scp_2',
    weekStartYmd: '2026-11-03',
    weekday: 1,
    startSlotIndex: 0,
    spanSlots: 1,
    startMinutes: null,
    endMinutes: null,
    allDay: null,
    subjectKind: 'task',
    subjectId: 't2',
    orphaned: 0,
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
  });
  assert.equal(body.startMinutes, null);
  assert.equal(body.endMinutes, null);
  assert.ok(Object.prototype.hasOwnProperty.call(body, 'startMinutes'));
}

// 远端有效分钟优先
{
  const m = mergeRemotePlacementMinutes(
    { startMinutes: 500, endMinutes: 620, allDay: 0 },
    { startMinutes: 480, endMinutes: 600, allDay: 0 },
  );
  assert.equal(m.startMinutes, 500);
  assert.equal(m.endMinutes, 620);
}

// 远端 null / 缺省 → 保留本地
{
  const m = mergeRemotePlacementMinutes(
    { startMinutes: null, endMinutes: null, allDay: null },
    { startMinutes: 480, endMinutes: 600, allDay: 1 },
  );
  assert.equal(m.startMinutes, 480);
  assert.equal(m.endMinutes, 600);
  assert.equal(m.allDay, 1);
}

{
  const m = mergeRemotePlacementMinutes({}, { startMinutes: 480, endMinutes: 600, allDay: 0 });
  assert.equal(m.startMinutes, 480);
  assert.equal(m.endMinutes, 600);
}

// 两端都无 → null
{
  const m = mergeRemotePlacementMinutes({}, null);
  assert.equal(m.startMinutes, null);
  assert.equal(m.endMinutes, null);
  assert.equal(m.allDay, null);
}

console.log('ok: schedule placement api minutes');
