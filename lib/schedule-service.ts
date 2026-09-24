import { assignFrogForDay } from '@/lib/frog-candidates-api';
import {
  unassignFrogFromApi,
  unassignProjectFrogFromApi,
} from '@/lib/frog-assignment';
import { getProjectById } from '@/lib/repositories/projects/project';
import { getTaskById } from '@/lib/repositories/tasks/task';
import {
  axisFromSnapshot,
  breaksEqual,
  findAxisRangeConflicts,
  getSlotCount,
  maxSpanFromSlot,
  normalizeAxisSettings,
  remapPlacementsForSlotHours,
  validateAxisRange,
} from '@/lib/schedule/axis';
import type {
  ScheduleAxisSettings,
  ScheduleBreak,
  SchedulePlacementInput,
  SchedulePlacementRow,
  ScheduleSubjectKind,
} from '@/lib/schedule/types';
import {
  addWeeksToWeekStart,
  getWeekStartMondayYmd,
  isEditableScheduleDay,
  isEditableWeek,
  isHistoricalWeek,
  weekdayFromYmd,
  ymdForWeekday,
} from '@/lib/schedule/week';
import {
  countSubjectPlacementsOnDay,
  ensureScheduleTables,
  getPlacementById,
  getScheduleAxisSettings,
  hasLocalScheduleAxisSetting,
  insertPlacement,
  listOrphanedPlacements,
  listPlacementsForEditableWeeks,
  listPlacementsForWeek,
  listSubjectPlacementsOnDay,
  saveScheduleAxisSettingsLocal,
  softDeletePlacement,
  softDeletePlacementsForWeek,
  updatePlacementSlots,
  upsertPlacementFromRemote,
  upsertWeekAxisSnapshot,
} from '@/lib/repositories/schedule/schedule-store';
import { apiGetFrogScheduleWeek, apiPostFrogSchedulePlacement, apiSaveFrogScheduleAxis } from '@/lib/schedule-api';
import { flushFrogScheduleApiOutbox } from '@/lib/schedule-api-outbox';
import { notifyFrogScheduleChanged } from '@/lib/schedule-events';
import { clampSlotHours } from '@/lib/schedule/axis';

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
      breaks: globalAxis.breaks ?? [],
    },
    fromSnapshot: false,
  };
}

export async function loadWeekSchedule(
  weekStartYmd: string,
  logicalTodayYmd: string,
  opts?: { hydrateRemote?: boolean },
): Promise<WeekScheduleView> {
  await ensureScheduleTables();
  const { axis, fromSnapshot } = await resolveAxisForWeek(weekStartYmd, logicalTodayYmd);

  // 本地优先：展示绝不阻塞在远程请求上（远程慢/挂起会导致「改完不刷新」）
  const placements = await listPlacementsForWeek(weekStartYmd);
  const orphanedCount = placements.filter((p) => p.orphaned || p.startSlotIndex == null).length;
  const view: WeekScheduleView = {
    weekStartYmd,
    editable: isEditableWeek(weekStartYmd, logicalTodayYmd),
    axis,
    placements,
    orphanedCount,
    fromSnapshot,
  };

  // 后台刷出站队列；空周则尝试从远端灌入轴+占用
  void flushFrogScheduleApiOutbox().catch((err) => {
    if (__DEV__) console.warn('[frog-schedule] outbox flush failed', err);
  });

  if (opts?.hydrateRemote !== false && placements.length === 0) {
    void hydrateWeekFromRemote(weekStartYmd).then((n) => {
      if (n > 0) notifyFrogScheduleChanged();
    });
  } else if (opts?.hydrateRemote !== false) {
    // 本地已有占用时仍尝试灌入「从未设置过」的全局轴（换机空设置）
    void hydrateAxisFromRemoteIfUnset(weekStartYmd).then((applied) => {
      if (applied) notifyFrogScheduleChanged();
    });
  }

  return view;
}

/** 加载跨周的多日窗口（三天周期等）；轴取中日所在周 */
export async function loadScheduleForDayWindow(
  dayYmds: string[],
  logicalTodayYmd: string,
  opts?: { hydrateRemote?: boolean },
): Promise<WeekScheduleView> {
  await ensureScheduleTables();
  const uniqueDays = [...new Set(dayYmds.filter(Boolean))].sort();
  if (uniqueDays.length === 0) {
    const weekStartYmd = getWeekStartMondayYmd(logicalTodayYmd);
    return loadWeekSchedule(weekStartYmd, logicalTodayYmd, opts);
  }

  const centerYmd = uniqueDays[Math.floor(uniqueDays.length / 2)] ?? uniqueDays[0]!;
  const preferredAxisDay = uniqueDays.includes(logicalTodayYmd)
    ? logicalTodayYmd
    : uniqueDays.find((d) => isEditableWeek(getWeekStartMondayYmd(d), logicalTodayYmd)) ??
      centerYmd;
  const axisWeek = getWeekStartMondayYmd(preferredAxisDay);
  const weekStarts = [...new Set(uniqueDays.map((d) => getWeekStartMondayYmd(d)))];

  const views = await Promise.all(
    weekStarts.map((w) => loadWeekSchedule(w, logicalTodayYmd, opts)),
  );
  // 可编辑周始终跟全局轴（避免快照/邻周拖累设置刷新）
  const { axis, fromSnapshot } = await resolveAxisForWeek(axisWeek, logicalTodayYmd);
  const daySet = new Set(uniqueDays);
  const byId = new Map<string, SchedulePlacementRow>();
  for (const v of views) {
    for (const p of v.placements) {
      const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
      if (!daySet.has(ymd)) continue;
      byId.set(p.id, p);
    }
  }
  const placements = [...byId.values()];
  return {
    weekStartYmd: axisWeek,
    editable: isEditableWeek(axisWeek, logicalTodayYmd),
    axis,
    placements,
    orphanedCount: placements.filter((p) => p.orphaned || p.startSlotIndex == null).length,
    fromSnapshot,
  };
}

async function applyRemoteAxisIfUnset(axis: {
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
  breaks?: ScheduleBreak[];
  fromSnapshot?: boolean;
}): Promise<boolean> {
  // 历史周返回的是快照轴，不能写进全局设置
  if (axis.fromSnapshot) return false;
  if (await hasLocalScheduleAxisSetting()) return false;
  await saveScheduleAxisSettingsLocal({
    startMinutes: axis.startMinutes,
    endMinutes: axis.endMinutes,
    slotHours: clampSlotHours(axis.slotHours),
    breaks: axis.breaks ?? [],
  });
  if (__DEV__) console.log('[frog-schedule] applied remote axis (local unset)');
  return true;
}

async function hydrateAxisFromRemoteIfUnset(weekStartYmd: string): Promise<boolean> {
  try {
    if (await hasLocalScheduleAxisSetting()) return false;
    const remote = await apiGetFrogScheduleWeek(weekStartYmd);
    if (!remote?.axis) return false;
    return applyRemoteAxisIfUnset(remote.axis);
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] axis hydrate failed', err);
    return false;
  }
}

async function hydrateWeekFromRemote(weekStartYmd: string): Promise<number> {
  try {
    const remote = await apiGetFrogScheduleWeek(weekStartYmd);
    if (!remote) return 0;

    let changed = 0;
    if (await applyRemoteAxisIfUnset(remote.axis)) changed += 1;

    const local = await listPlacementsForWeek(weekStartYmd);
    if (local.length > 0) return changed;

    for (const p of remote.placements ?? []) {
      if (p.orphaned || p.startSlotIndex == null || !p.id) continue;
      await upsertPlacementFromRemote({
        id: p.id,
        weekStartYmd: p.weekStartYmd,
        weekday: p.weekday,
        startSlotIndex: p.startSlotIndex,
        spanSlots: p.spanSlots,
        subjectKind: p.subjectKind,
        subjectId: p.subjectId,
        orphaned: p.orphaned,
      });
      changed += 1;
    }
    if (__DEV__ && changed > 0) {
      console.log('[frog-schedule] hydrated from remote', weekStartYmd, 'changes', changed);
    }
    return changed;
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] week hydrate failed', weekStartYmd, err);
    return 0;
  }
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
  const assignYmd = ymdForWeekday(params.weekStartYmd, params.weekday);
  if (!isEditableScheduleDay(assignYmd, params.logicalTodayYmd)) {
    throw new Error('过去日程不可编辑');
  }
  const { axis } = await resolveAxisForWeek(params.weekStartYmd, params.logicalTodayYmd);
  const maxSpan = maxSpanFromSlot(axis, params.startSlotIndex);
  if (params.startSlotIndex < 0 || params.startSlotIndex >= getSlotCount(axis)) {
    throw new Error('格子索引超出时间轴');
  }
  if (params.spanSlots < 1 || params.spanSlots > maxSpan) {
    throw new Error(`连续格数须为 1–${maxSpan}`);
  }

  // 先写本地占用并广播，避免指派接口挂起时页面一直不刷新
  const input: SchedulePlacementInput = {
    weekStartYmd: params.weekStartYmd,
    weekday: params.weekday,
    startSlotIndex: params.startSlotIndex,
    spanSlots: params.spanSlots,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  };
  const row = await insertPlacement(input);
  notifyFrogScheduleChanged();

  try {
    await assignFrogForDay({
      kind: params.subjectKind,
      id: params.subjectId,
      assignYmd,
    });
  } catch (err) {
    await softDeletePlacement(row.id);
    notifyFrogScheduleChanged();
    throw err;
  }

  void apiPostFrogSchedulePlacement({ action: 'upsert', placement: row }).catch(() => undefined);
  return row;
}

/** 未入格占用重新落入时间格（可改日）；已指派日按需迁移 */
export async function rematerializeOrphanedPlacement(params: {
  placementId: string;
  assignYmd: string;
  startSlotIndex: number;
  spanSlots: number;
  logicalTodayYmd: string;
}): Promise<SchedulePlacementRow> {
  await ensureScheduleTables();
  const placement = await getPlacementById(params.placementId);
  if (!placement) throw new Error('占用不存在');
  if (!(placement.orphaned || placement.startSlotIndex == null)) {
    throw new Error('该项已在格内');
  }
  if (!isEditableScheduleDay(params.assignYmd, params.logicalTodayYmd)) {
    throw new Error('过去日程不可编辑');
  }

  const weekStartYmd = getWeekStartMondayYmd(params.assignYmd);
  const weekday = weekdayFromYmd(params.assignYmd);
  const { axis } = await resolveAxisForWeek(weekStartYmd, params.logicalTodayYmd);
  const maxSpan = maxSpanFromSlot(axis, params.startSlotIndex);
  if (params.startSlotIndex < 0 || params.startSlotIndex >= getSlotCount(axis)) {
    throw new Error('格子索引超出时间轴');
  }
  if (params.spanSlots < 1 || params.spanSlots > maxSpan) {
    throw new Error(`连续格数须为 1–${maxSpan}`);
  }

  const oldYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);

  await updatePlacementSlots(placement.id, {
    weekStartYmd,
    weekday,
    startSlotIndex: params.startSlotIndex,
    spanSlots: params.spanSlots,
    orphaned: false,
  });

  if (oldYmd !== params.assignYmd) {
    const remainOnOld = (
      await listSubjectPlacementsOnDay(
        placement.weekStartYmd,
        placement.weekday,
        placement.subjectKind,
        placement.subjectId,
      )
    ).filter((p) => p.id !== placement.id).length;
    if (remainOnOld === 0) {
      await unassignSubjectDay(placement.subjectKind, placement.subjectId, oldYmd);
    }
    try {
      await assignFrogForDay({
        kind: placement.subjectKind,
        id: placement.subjectId,
        assignYmd: params.assignYmd,
      });
    } catch (err) {
      // 回滚为未入格，避免「格内但未指派」
      await updatePlacementSlots(placement.id, {
        weekStartYmd: placement.weekStartYmd,
        weekday: placement.weekday,
        startSlotIndex: null,
        spanSlots: placement.spanSlots,
        orphaned: true,
      });
      notifyFrogScheduleChanged();
      throw err;
    }
  }

  const row = (await getPlacementById(placement.id))!;
  notifyFrogScheduleChanged();
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
  const assignYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
  if (!isEditableScheduleDay(assignYmd, logicalTodayYmd)) {
    throw new Error('过去日程不可编辑');
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
    await unassignSubjectDay(placement.subjectKind, placement.subjectId, assignYmd);
  }
  notifyFrogScheduleChanged();
}

/** 取消指派：去掉该日该主体全部占用 + 取消该日指派 */
export async function cancelAssignForPlacementDay(
  placementId: string,
  logicalTodayYmd: string,
): Promise<void> {
  await ensureScheduleTables();
  const placement = await getPlacementById(placementId);
  if (!placement) return;
  const assignYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
  if (!isEditableScheduleDay(assignYmd, logicalTodayYmd)) {
    throw new Error('过去日程不可编辑');
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
  await unassignSubjectDay(placement.subjectKind, placement.subjectId, assignYmd);
  notifyFrogScheduleChanged();
}

export type SaveAxisResult =
  | { ok: true; axis: ScheduleAxisSettings; orphanedCount: number; remappedCount: number }
  | { ok: false; error: string; conflicts?: { placementId: string; reason: string }[] };

export async function saveScheduleAxisWithRemap(
  nextRaw: {
    startMinutes: number;
    endMinutes: number;
    slotHours: number;
    breaks?: ScheduleBreak[];
  },
  logicalTodayYmd: string,
): Promise<SaveAxisResult> {
  await ensureScheduleTables();
  const next = normalizeAxisSettings({
    startMinutes: nextRaw.startMinutes,
    endMinutes: nextRaw.endMinutes,
    slotHours: nextRaw.slotHours as ScheduleAxisSettings['slotHours'],
    breaks: nextRaw.breaks,
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
        error: `新时间范围会裁掉 ${conflicts.length} 条已有占用，请先调整日程表后再改设置。`,
        conflicts: conflicts.map((c) => ({ placementId: c.placementId, reason: c.reason })),
      };
    }
  }

  let remappedCount = 0;
  let orphanedCount = 0;

  const axisChanged =
    next.startMinutes !== oldAxis.startMinutes ||
    next.endMinutes !== oldAxis.endMinutes ||
    next.slotHours !== oldAxis.slotHours ||
    !breaksEqual(next.breaks, oldAxis.breaks);

  if (axisChanged) {
    // 按绝对开始时间重映射到新轴（格宽 / 起止 / 断开变更均适用）
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
            spanSlots: r.nextSpanSlots,
            orphaned: false,
          });
        }
      }
    }
  }

  const axis = await saveScheduleAxisSettingsLocal(next);
  void apiSaveFrogScheduleAxis(axis).catch(() => undefined);

  const orphans = await listOrphanedPlacements();
  notifyFrogScheduleChanged();
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

  notifyFrogScheduleChanged();
  return { copied, skipped, overwritten };
}

export async function getOrphanedPlacementCount(): Promise<number> {
  await ensureScheduleTables();
  const list = await listOrphanedPlacements();
  return list.length;
}
