import { assignFrogForDay } from '@/lib/frog-candidates-api';
import {
  unassignFrogFromApi,
  unassignProjectFrogFromApi,
} from '@/lib/frog-assignment';
import { getProjectById } from '@/lib/repositories/projects/project';
import { getTaskById } from '@/lib/repositories/tasks/task';
import {
  axisFromSnapshot,
  findAxisRangeConflicts,
  getSlotCount,
  maxSpanFromSlot,
  normalizeAxisSettings,
  remapPlacementsForSlotHours,
  validateAxisRange,
} from '@/lib/schedule/axis';
import {
  addWeeksToWeekStart,
  getWeekStartMondayYmd,
  isEditableWeek,
  isHistoricalWeek,
  ymdForWeekday,
} from '@/lib/schedule/week';
import type {
  ScheduleAxisSettings,
  SchedulePlacementInput,
  SchedulePlacementRow,
  ScheduleSubjectKind,
} from '@/lib/schedule/types';
import {
  countSubjectPlacementsOnDay,
  ensureScheduleTables,
  getPlacementById,
  getScheduleAxisSettings,
  insertPlacement,
  listOrphanedPlacements,
  listPlacementsForEditableWeeks,
  listPlacementsForWeek,
  listSubjectPlacementsOnDay,
  saveScheduleAxisSettingsLocal,
  softDeletePlacement,
  softDeletePlacementsForWeek,
  updatePlacementSlots,
  upsertWeekAxisSnapshot,
} from '@/lib/repositories/schedule/schedule-store';
import { apiGetFrogScheduleWeek, apiPostFrogSchedulePlacement, apiSaveFrogScheduleAxis } from '@/lib/schedule-api';

export type WeekScheduleView = {
  weekStartYmd: string;
  editable: boolean;
  axis: Omit<ScheduleAxisSettings, 'updatedAt'>;
  placements: SchedulePlacementRow[];
  orphanedCount: number;
  fromSnapshot: boolean;
};

export async function resolveAxisForWeek(
  weekStartYmd: string,
  logicalTodayYmd: string,
): Promise<{ axis: Omit<ScheduleAxisSettings, 'updatedAt'>; fromSnapshot: boolean }> {
  await ensureScheduleTables();
  const globalAxis = await getScheduleAxisSettings();
  if (isHistoricalWeek(weekStartYmd, logicalTodayYmd)) {
    const snap = await upsertWeekAxisSnapshot(weekStartYmd, globalAxis);
    return { axis: axisFromSnapshot(snap), fromSnapshot: true };
  }
  return {
    axis: {
      startMinutes: globalAxis.startMinutes,
      endMinutes: globalAxis.endMinutes,
      slotHours: globalAxis.slotHours,
    },
    fromSnapshot: false,
  };
}

export async function loadWeekSchedule(
  weekStartYmd: string,
  logicalTodayYmd: string,
): Promise<WeekScheduleView> {
  await ensureScheduleTables();
  const { axis, fromSnapshot } = await resolveAxisForWeek(weekStartYmd, logicalTodayYmd);

  // Best-effort hydrate from API（不阻塞本地）
  try {
    const remote = await apiGetFrogScheduleWeek(weekStartYmd);
    if (remote?.placements?.length) {
      // 本地优先：仅在本地该周为空时灌入
      const local = await listPlacementsForWeek(weekStartYmd);
      if (local.length === 0) {
        for (const p of remote.placements) {
          if (p.orphaned || p.startSlotIndex == null) continue;
          await insertPlacement({
            weekStartYmd: p.weekStartYmd,
            weekday: p.weekday,
            startSlotIndex: p.startSlotIndex,
            spanSlots: p.spanSlots,
            subjectKind: p.subjectKind,
            subjectId: p.subjectId,
          });
        }
      }
    }
  } catch {
    /* offline ok */
  }

  const placements = await listPlacementsForWeek(weekStartYmd);
  const orphanedCount = placements.filter((p) => p.orphaned || p.startSlotIndex == null).length;
  return {
    weekStartYmd,
    editable: isEditableWeek(weekStartYmd, logicalTodayYmd),
    axis,
    placements,
    orphanedCount,
    fromSnapshot,
  };
}

async function unassignSubjectDay(
  kind: ScheduleSubjectKind,
  id: string,
  assignYmd: string,
): Promise<void> {
  if (kind === 'project') {
    const project = await getProjectById(id);
    if (!project) return;
    await unassignProjectFrogFromApi(
      id,
      project.extra_data,
      project as unknown as Record<string, unknown>,
      assignYmd,
    );
    return;
  }
  const task = await getTaskById(id);
  if (!task) return;
  await unassignFrogFromApi(
    id,
    task.extra_data,
    task as unknown as Record<string, unknown>,
    assignYmd,
  );
}

export async function placeFrogOnSchedule(params: {
  weekStartYmd: string;
  weekday: number;
  startSlotIndex: number;
  spanSlots: number;
  subjectKind: ScheduleSubjectKind;
  subjectId: string;
  logicalTodayYmd: string;
}): Promise<SchedulePlacementRow> {
  await ensureScheduleTables();
  if (!isEditableWeek(params.weekStartYmd, params.logicalTodayYmd)) {
    throw new Error('历史周不可编辑');
  }
  const { axis } = await resolveAxisForWeek(params.weekStartYmd, params.logicalTodayYmd);
  const maxSpan = maxSpanFromSlot(axis, params.startSlotIndex);
  if (params.startSlotIndex < 0 || params.startSlotIndex >= getSlotCount(axis)) {
    throw new Error('格子索引超出时间轴');
  }
  if (params.spanSlots < 1 || params.spanSlots > maxSpan) {
    throw new Error(`连续格数须为 1–${maxSpan}`);
  }

  const assignYmd = ymdForWeekday(params.weekStartYmd, params.weekday);
  await assignFrogForDay({
    kind: params.subjectKind,
    id: params.subjectId,
    assignYmd,
  });

  const input: SchedulePlacementInput = {
    weekStartYmd: params.weekStartYmd,
    weekday: params.weekday,
    startSlotIndex: params.startSlotIndex,
    spanSlots: params.spanSlots,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  };
  const row = await insertPlacement(input);

  void apiPostFrogSchedulePlacement({ action: 'upsert', placement: row }).catch(() => undefined);
  return row;
}

/** 从本格段移除：只删这一段；若该主体当日已无占用 → 取消该日指派 */
export async function removePlacementSegment(
  placementId: string,
  logicalTodayYmd: string,
): Promise<void> {
  await ensureScheduleTables();
  const placement = await getPlacementById(placementId);
  if (!placement) return;
  if (!isEditableWeek(placement.weekStartYmd, logicalTodayYmd)) {
    throw new Error('历史周不可编辑');
  }

  await softDeletePlacement(placementId);
  void apiPostFrogSchedulePlacement({ action: 'delete', id: placementId }).catch(() => undefined);

  const remain = await countSubjectPlacementsOnDay(
    placement.weekStartYmd,
    placement.weekday,
    placement.subjectKind,
    placement.subjectId,
    placementId,
  );
  if (remain === 0) {
    const assignYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
    await unassignSubjectDay(placement.subjectKind, placement.subjectId, assignYmd);
  }
}

/** 取消指派：去掉该日该主体全部占用 + 取消该日指派 */
export async function cancelAssignForPlacementDay(
  placementId: string,
  logicalTodayYmd: string,
): Promise<void> {
  await ensureScheduleTables();
  const placement = await getPlacementById(placementId);
  if (!placement) return;
  if (!isEditableWeek(placement.weekStartYmd, logicalTodayYmd)) {
    throw new Error('历史周不可编辑');
  }

  const all = await listSubjectPlacementsOnDay(
    placement.weekStartYmd,
    placement.weekday,
    placement.subjectKind,
    placement.subjectId,
  );
  for (const p of all) {
    await softDeletePlacement(p.id);
    void apiPostFrogSchedulePlacement({ action: 'delete', id: p.id }).catch(() => undefined);
  }
  const assignYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
  await unassignSubjectDay(placement.subjectKind, placement.subjectId, assignYmd);
}

export type SaveAxisResult =
  | { ok: true; axis: ScheduleAxisSettings; orphanedCount: number; remappedCount: number }
  | { ok: false; error: string; conflicts?: { placementId: string; reason: string }[] };

export async function saveScheduleAxisWithRemap(
  nextRaw: { startMinutes: number; endMinutes: number; slotHours: number },
  logicalTodayYmd: string,
): Promise<SaveAxisResult> {
  await ensureScheduleTables();
  const next = normalizeAxisSettings({
    startMinutes: nextRaw.startMinutes,
    endMinutes: nextRaw.endMinutes,
    slotHours: nextRaw.slotHours as ScheduleAxisSettings['slotHours'],
  });
  const rangeErr = validateAxisRange(next);
  if (rangeErr) return { ok: false, error: rangeErr };

  const thisMonday = getWeekStartMondayYmd(logicalTodayYmd);
  const oldAxis = await getScheduleAxisSettings();
  const editablePlacements = await listPlacementsForEditableWeeks(thisMonday);

  // 日开始/结束变更：禁止裁切（按旧轴绝对时间对照新起止）
  if (next.startMinutes !== oldAxis.startMinutes || next.endMinutes !== oldAxis.endMinutes) {
    const conflicts = findAxisRangeConflicts(oldAxis, next, editablePlacements);
    if (conflicts.length > 0) {
      return {
        ok: false,
        error: `新时间范围会裁掉 ${conflicts.length} 条已有占用，请先调整课程表后再改设置。`,
        conflicts: conflicts.map((c) => ({ placementId: c.placementId, reason: c.reason })),
      };
    }
  }

  let remappedCount = 0;
  let orphanedCount = 0;

  const axisChanged =
    next.startMinutes !== oldAxis.startMinutes ||
    next.endMinutes !== oldAxis.endMinutes ||
    next.slotHours !== oldAxis.slotHours;

  if (axisChanged) {
    // 按绝对开始时间重映射到新轴（格宽或起止变更均适用）
    const byWeek = new Map<string, typeof editablePlacements>();
    for (const p of editablePlacements) {
      const list = byWeek.get(p.weekStartYmd) ?? [];
      list.push(p);
      byWeek.set(p.weekStartYmd, list);
    }
    for (const [, list] of byWeek) {
      const results = remapPlacementsForSlotHours(oldAxis, next, list);
      for (const r of results) {
        if (r.orphaned) {
          orphanedCount += 1;
          await updatePlacementSlots(r.placementId, {
            startSlotIndex: null,
            orphaned: true,
          });
        } else if (r.nextStartSlotIndex != null) {
          remappedCount += 1;
          await updatePlacementSlots(r.placementId, {
            startSlotIndex: r.nextStartSlotIndex,
            orphaned: false,
          });
        }
      }
    }
  }

  const axis = await saveScheduleAxisSettingsLocal(next);
  void apiSaveFrogScheduleAxis(axis).catch(() => undefined);

  const orphans = await listOrphanedPlacements();
  return {
    ok: true,
    axis,
    orphanedCount: orphanedCount || orphans.length,
    remappedCount,
  };
}

export type CopyWeekResult = {
  copied: number;
  skipped: { subjectId: string; subjectKind: ScheduleSubjectKind; reason: string }[];
  overwritten: number;
};

export async function copyPreviousWeekToThisWeek(params: {
  thisWeekStartYmd: string;
  logicalTodayYmd: string;
  overwrite: boolean;
}): Promise<CopyWeekResult> {
  await ensureScheduleTables();
  if (!isEditableWeek(params.thisWeekStartYmd, params.logicalTodayYmd)) {
    throw new Error('历史周不可复制写入');
  }
  const prevWeek = addWeeksToWeekStart(params.thisWeekStartYmd, -1);
  const source = await listPlacementsForWeek(prevWeek);
  const existing = await listPlacementsForWeek(params.thisWeekStartYmd);

  if (existing.length > 0 && !params.overwrite) {
    throw new Error('NEED_CONFIRM_OVERWRITE');
  }

  let overwritten = 0;
  if (existing.length > 0 && params.overwrite) {
    overwritten = await softDeletePlacementsForWeek(params.thisWeekStartYmd);
  }

  const skipped: CopyWeekResult['skipped'] = [];
  let copied = 0;

  for (const src of source) {
    if (src.orphaned || src.startSlotIndex == null) {
      skipped.push({
        subjectId: src.subjectId,
        subjectKind: src.subjectKind,
        reason: '源占用未入格',
      });
      continue;
    }
    try {
      await placeFrogOnSchedule({
        weekStartYmd: params.thisWeekStartYmd,
        weekday: src.weekday,
        startSlotIndex: src.startSlotIndex,
        spanSlots: src.spanSlots,
        subjectKind: src.subjectKind,
        subjectId: src.subjectId,
        logicalTodayYmd: params.logicalTodayYmd,
      });
      copied += 1;
    } catch (err) {
      skipped.push({
        subjectId: src.subjectId,
        subjectKind: src.subjectKind,
        reason: err instanceof Error ? err.message : '无法指派',
      });
    }
  }

  return { copied, skipped, overwritten };
}

export async function getOrphanedPlacementCount(): Promise<number> {
  await ensureScheduleTables();
  const list = await listOrphanedPlacements();
  return list.length;
}
