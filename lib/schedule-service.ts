import { assignFrogForDay, unassignFrogForDay } from '@/lib/frog-candidates-api';
import {
  axisFromSnapshot,
  breakIntersectingInterval,
  breaksEqual,
  deriveSlotSpanForMinutes,
  formatScheduleAxisTimeLabel,
  getSlotCount,
  maxSpanFromSlot,
  normalizeAxisSettings,
  remapPlacementsForSlotHours,
  validateAxisRange,
  workCoverageMinutes,
} from '@/lib/schedule/axis';
import { remapPlacementsForMinutes } from '@/lib/schedule/timeline/remap-minutes';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
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
  listPendingSchedulePlacements,
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
import {
  apiGetFrogScheduleWeek,
  apiPostFrogSchedulePlacement,
  apiSaveFrogScheduleAxis,
  pushFrogSchedulePlacement,
} from '@/lib/schedule-api';
import { notifyFrogScheduleChanged } from '@/lib/schedule-events';
import { clampSlotHours } from '@/lib/schedule/axis';
import { normalizePlacementsMinutesInMemory, resolvePlacementInterval } from '@/lib/schedule/timeline/from-placement';
import { mergeRemotePlacementMinutes } from '@/lib/schedule/timeline/merge-remote-minutes';

/**
 * 本地入格/指派已成功后，云端占用同步失败不应回滚整次操作，
 * 否则 UI 会当成失败（预选横幅残留、无成功提示），但格子里其实已有占用。
 */
async function pushPlacementUpsertBestEffort(row: SchedulePlacementRow): Promise<void> {
  try {
    await apiPostFrogSchedulePlacement({ action: 'upsert', placement: row });
  } catch (err) {
    console.warn('[schedule] 占用云端同步失败（本地已入格）', err);
  }
}

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
  // 日程表可视轴与全局日界相互独立：只用用户保存的起止时间
  const axis = normalizeAxisSettings(await getScheduleAxisSettings());
  if (isHistoricalWeek(weekStartYmd, logicalTodayYmd)) {
    const snap = await upsertWeekAxisSnapshot(weekStartYmd, axis);
    return { axis: axisFromSnapshot(snap), fromSnapshot: true };
  }
  return {
    axis,
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
  const rawPlacements = await listPlacementsForWeek(weekStartYmd);
  // 阶段 C：内存填充 derived 分钟，不回写 DB
  const placements = normalizePlacementsMinutesInMemory(rawPlacements, axis);
  const orphanedCount = placements.filter((p) => p.orphaned || p.startSlotIndex == null).length;
  const view: WeekScheduleView = {
    weekStartYmd,
    editable: isEditableWeek(weekStartYmd, logicalTodayYmd),
    axis,
    placements,
    orphanedCount,
    fromSnapshot,
  };

  // 后台：先推本地 pending / 出站队列，再合并远端（避免「APP 有、桌面无」）
  void syncWeekScheduleWithRemote(weekStartYmd, opts?.hydrateRemote !== false).catch((err) => {
    if (__DEV__) console.warn('[frog-schedule] week sync failed', weekStartYmd, err);
  });

  return view;
}

/** 加载跨周的多日窗口（单日课表邻日预载等）；轴取中日所在周 */
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
  // 各周已在 loadWeekSchedule 内按**该周轴** normalize；跨周窗口再按展示轴补一遍，
  // 避免邻周快照轴与当前展示轴不一致时分钟缺失（仍不回写 DB）。
  const placements = normalizePlacementsMinutesInMemory([...byId.values()], axis);
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

/**
 * 将本地尚未上云的占用直连推到 frog-schedule REST。
 */
async function pushPendingLocalPlacements(): Promise<number> {
  const pending = await listPendingSchedulePlacements();
  let pushed = 0;
  for (const p of pending) {
    if (p.syncStatus === 'pending_delete') {
      await pushFrogSchedulePlacement({ action: 'delete', id: p.id });
    } else {
      await pushFrogSchedulePlacement({ action: 'upsert', placement: p });
    }
    pushed += 1;
  }
  return pushed;
}

/**
 * 合并远端占用到本地：
 * - 本地 pending_* 行不被远端覆盖（先推后合）
 * - 远端有、本地无（或已 synced）→ upsert
 * - 本地已有占用时也会执行（旧逻辑仅空周 hydrate，导致双向长期漂移）
 */
async function hydrateWeekFromRemote(weekStartYmd: string): Promise<number> {
  try {
    const remote = await apiGetFrogScheduleWeek(weekStartYmd);
    if (!remote) return 0;

    let changed = 0;
    if (await applyRemoteAxisIfUnset(remote.axis)) changed += 1;

    const local = await listPlacementsForWeek(weekStartYmd);
    const localById = new Map(local.map((p) => [p.id, p]));
    // 含 pending_delete：避免刚删又被远端灌回
    const pendingAll = await listPendingSchedulePlacements();
    const pendingIds = new Set(pendingAll.map((p) => p.id));

    for (const p of remote.placements ?? []) {
      if (!p.id) continue;
      if (pendingIds.has(p.id)) continue;
      const existing = localById.get(p.id);
      // 远端缺/null 分钟时不抹本地已有分钟（阶段 E / 决议桌面不覆盖为 null）
      const mergedMins = mergeRemotePlacementMinutes(p, existing);
      if (
        existing &&
        existing.weekStartYmd === p.weekStartYmd &&
        existing.weekday === p.weekday &&
        existing.startSlotIndex === p.startSlotIndex &&
        existing.spanSlots === p.spanSlots &&
        existing.startMinutes === mergedMins.startMinutes &&
        existing.endMinutes === mergedMins.endMinutes &&
        existing.allDay === mergedMins.allDay &&
        existing.subjectKind === p.subjectKind &&
        existing.subjectId === p.subjectId &&
        existing.orphaned === (p.orphaned ? 1 : 0) &&
        existing.syncStatus === 'synced'
      ) {
        continue;
      }
      await upsertPlacementFromRemote({
        id: p.id,
        weekStartYmd: p.weekStartYmd,
        weekday: p.weekday,
        startSlotIndex: p.startSlotIndex,
        spanSlots: p.spanSlots,
        startMinutes: mergedMins.startMinutes,
        endMinutes: mergedMins.endMinutes,
        allDay: mergedMins.allDay,
        subjectKind: p.subjectKind,
        subjectId: p.subjectId,
        orphaned: p.orphaned,
      });
      changed += 1;
    }

    // 他端删除走 Change Log delete → applyApiRecordMissingToLocal。
    // 这里不再按「远端没有就删本地 synced」：入格刚 markSynced 时周 GET 常滞后，会把刚指派的格子抹掉。

    if (__DEV__ && changed > 0) {
      console.log('[frog-schedule] merged from remote', weekStartYmd, 'changes', changed);
    }
    return changed;
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] week hydrate failed', weekStartYmd, err);
    return 0;
  }
}

async function syncWeekScheduleWithRemote(
  weekStartYmd: string,
  hydrateRemote: boolean,
): Promise<void> {
  try {
    await pushPendingLocalPlacements();
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] pending push failed', err);
  }

  if (!hydrateRemote) return;

  const merged = await hydrateWeekFromRemote(weekStartYmd);
  if (merged > 0) {
    notifyFrogScheduleChanged();
    return;
  }
  // 无占用合并时仍尝试灌入从未设置过的全局轴
  const applied = await hydrateAxisFromRemoteIfUnset(weekStartYmd);
  if (applied) notifyFrogScheduleChanged();
}

async function unassignSubjectDay(
  kind: ScheduleSubjectKind,
  id: string,
  assignYmd: string,
): Promise<void> {
  await unassignFrogForDay({ kind, id, assignYmd });
}

/** 两段格子是否有重叠（同一主体不可重复占用同一格） */
function placementSlotsOverlap(
  startA: number,
  spanA: number,
  startB: number,
  spanB: number,
): boolean {
  const endA = startA + Math.max(1, spanA);
  const endB = startB + Math.max(1, spanB);
  return startA < endB && startB < endA;
}

/** 同主体同日是否已占用目标格段（可排除自身，供重新入格） */
async function assertSubjectNotAlreadyInSlots(params: {
  weekStartYmd: string;
  weekday: number;
  startSlotIndex: number;
  spanSlots: number;
  subjectKind: ScheduleSubjectKind;
  subjectId: string;
  excludePlacementId?: string;
}): Promise<void> {
  const existing = await listSubjectPlacementsOnDay(
    params.weekStartYmd,
    params.weekday,
    params.subjectKind,
    params.subjectId,
  );
  const conflict = existing.find((p) => {
    if (params.excludePlacementId && p.id === params.excludePlacementId) return false;
    if (p.orphaned || p.startSlotIndex == null) return false;
    return placementSlotsOverlap(
      params.startSlotIndex,
      params.spanSlots,
      p.startSlotIndex,
      p.spanSlots,
    );
  });
  if (conflict) {
    throw new Error('该项已在该格子内，请选择其他空格');
  }
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

  await assertSubjectNotAlreadyInSlots({
    weekStartYmd: params.weekStartYmd,
    weekday: params.weekday,
    startSlotIndex: params.startSlotIndex,
    spanSlots: params.spanSlots,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  });

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
      scheduleTime: { allDay: true },
    });
  } catch (err) {
    await softDeletePlacement(row.id);
    notifyFrogScheduleChanged();
    throw err;
  }

  await pushPlacementUpsertBestEffort(row);
  notifyFrogScheduleChanged();
  return row;
}

/** 阶段 G：同主体同日分钟区间是否冲突（半开；可排除自身） */
async function assertSubjectNotAlreadyInInterval(params: {
  axis: Omit<ScheduleAxisSettings, 'updatedAt'>;
  weekStartYmd: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  subjectKind: ScheduleSubjectKind;
  subjectId: string;
  excludePlacementId?: string;
}): Promise<void> {
  const existing = await listSubjectPlacementsOnDay(
    params.weekStartYmd,
    params.weekday,
    params.subjectKind,
    params.subjectId,
  );
  const conflict = existing.find((p) => {
    if (params.excludePlacementId && p.id === params.excludePlacementId) return false;
    if (p.orphaned) return false;
    const iv = resolvePlacementInterval(p, params.axis);
    if (!iv) return false;
    return params.startMinutes < iv.endMinutes && iv.startMinutes < params.endMinutes;
  });
  if (conflict) {
    throw new Error('该项在该时段已有占用，请选择其他时间');
  }
}

/** 阶段 G：分钟写入的校验 + 派生 slot（双写）。返回可直接入库的区间与格段。 */
function resolveMinuteWriteInterval(params: {
  axis: Omit<ScheduleAxisSettings, 'updatedAt'>;
  startMinutes: number;
  endMinutes: number;
  allDay?: boolean;
}): {
  startMinutes: number;
  endMinutes: number;
  allDay: number;
  startSlotIndex: number;
  spanSlots: number;
} {
  const coverage = workCoverageMinutes(params.axis);
  if (!coverage) throw new Error('当前时间轴没有可排时段');

  let startMinutes: number;
  let endMinutes: number;
  let allDay = 0;

  if (params.allDay) {
    startMinutes = coverage.startMinutes;
    endMinutes = coverage.endMinutes;
    allDay = 1;
  } else {
    startMinutes = Math.round(params.startMinutes);
    endMinutes = Math.round(params.endMinutes);
    if (!(endMinutes > startMinutes)) {
      throw new Error('结束时间须晚于开始时间');
    }
    if (
      startMinutes < params.axis.startMinutes ||
      endMinutes > params.axis.endMinutes
    ) {
      throw new Error(
        `所选时段须落在 ${formatScheduleAxisTimeLabel(params.axis.startMinutes)}–${formatScheduleAxisTimeLabel(params.axis.endMinutes)} 内`,
      );
    }
    const brk = breakIntersectingInterval(params.axis, startMinutes, endMinutes);
    if (brk) {
      throw new Error(
        `该时段跨越「${brk.label?.trim() || '休息'}」${formatScheduleAxisTimeLabel(brk.startMinutes)}–${formatScheduleAxisTimeLabel(brk.endMinutes)}，请避开`,
      );
    }
  }

  const cover = deriveSlotSpanForMinutes(params.axis, startMinutes, endMinutes);
  if (!cover) throw new Error('开始时间须落在可排时段内（避开休息）');

  return {
    startMinutes,
    endMinutes,
    allDay,
    startSlotIndex: cover.startSlotIndex,
    spanSlots: cover.spanSlots,
  };
}

/**
 * 阶段 G：按分钟入格（可自由起止；allDay=true 铺满当日可排时段）。
 * 写入同时派生 slot 双写，旧课表仍可读；禁跨 break / 同主体重叠。
 */
export async function placeFrogOnScheduleAt(params: {
  weekStartYmd: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  allDay?: boolean;
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
  const resolved = resolveMinuteWriteInterval({
    axis,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
    allDay: params.allDay,
  });

  await assertSubjectNotAlreadyInInterval({
    axis,
    weekStartYmd: params.weekStartYmd,
    weekday: params.weekday,
    startMinutes: resolved.startMinutes,
    endMinutes: resolved.endMinutes,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  });

  const input: SchedulePlacementInput = {
    weekStartYmd: params.weekStartYmd,
    weekday: params.weekday,
    startSlotIndex: resolved.startSlotIndex,
    spanSlots: resolved.spanSlots,
    startMinutes: resolved.startMinutes,
    endMinutes: resolved.endMinutes,
    allDay: resolved.allDay,
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
      scheduleTime: {
        startMinutes: resolved.startMinutes,
        endMinutes: resolved.endMinutes,
        allDay: resolved.allDay === 1,
      },
    });
  } catch (err) {
    await softDeletePlacement(row.id);
    notifyFrogScheduleChanged();
    throw err;
  }

  await pushPlacementUpsertBestEffort(row);
  notifyFrogScheduleChanged();
  return row;
}

/**
 * 改派 / 未入格重落入格（可改日、改时段）。
 * - 同日：更新本条占用时段
 * - 改到另一天且旧日仍可编辑：新建占用并累加指派日，保留旧日（不取消今天再派明天）
 * - 改到另一天且旧日已过去：迁移占用，并取消旧日指派
 */
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

  // 旧日仍可编辑且改到另一天：累加新日，保留旧日指派/占用
  if (oldYmd !== params.assignYmd && isEditableScheduleDay(oldYmd, params.logicalTodayYmd)) {
    return placeFrogOnSchedule({
      weekStartYmd,
      weekday,
      startSlotIndex: params.startSlotIndex,
      spanSlots: params.spanSlots,
      subjectKind: placement.subjectKind,
      subjectId: placement.subjectId,
      logicalTodayYmd: params.logicalTodayYmd,
    });
  }

  await assertSubjectNotAlreadyInSlots({
    weekStartYmd,
    weekday,
    startSlotIndex: params.startSlotIndex,
    spanSlots: params.spanSlots,
    subjectKind: placement.subjectKind,
    subjectId: placement.subjectId,
    excludePlacementId: placement.id,
  });

  await updatePlacementSlots(placement.id, {
    weekStartYmd,
    weekday,
    startSlotIndex: params.startSlotIndex,
    spanSlots: params.spanSlots,
    orphaned: false,
  });

  try {
    await assignFrogForDay({
      kind: placement.subjectKind,
      id: placement.subjectId,
      assignYmd: params.assignYmd,
      scheduleTime: { allDay: true },
    });
  } catch (err) {
    // 回滚为未入格，避免「格内但未指派」；清残留分钟以免画进时间线
    await updatePlacementSlots(placement.id, {
      weekStartYmd: placement.weekStartYmd,
      weekday: placement.weekday,
      startSlotIndex: null,
      spanSlots: placement.spanSlots,
      orphaned: true,
      startMinutes: null,
      endMinutes: null,
      allDay: null,
    });
    notifyFrogScheduleChanged();
    throw err;
  }

  // 仅过去日迁移：旧日已无占用时取消旧日指派
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
  }

  const row = (await getPlacementById(placement.id))!;
  await pushPlacementUpsertBestEffort(row);
  notifyFrogScheduleChanged();
  return row;
}

/**
 * 阶段 G：改派 / 未入格按分钟重落时段（可改日）。
 * 跨日且旧日仍可编辑时累加新日、保留旧日；仅过去日迁移时取消旧日指派。
 */
export async function rematerializeOrphanedPlacementAtMinutes(params: {
  placementId: string;
  assignYmd: string;
  startMinutes: number;
  endMinutes: number;
  allDay?: boolean;
  logicalTodayYmd: string;
}): Promise<SchedulePlacementRow> {
  await ensureScheduleTables();
  const placement = await getPlacementById(params.placementId);
  if (!placement) throw new Error('占用不存在');
  if (!isEditableScheduleDay(params.assignYmd, params.logicalTodayYmd)) {
    throw new Error('过去日程不可编辑');
  }

  const weekStartYmd = getWeekStartMondayYmd(params.assignYmd);
  const weekday = weekdayFromYmd(params.assignYmd);
  const { axis } = await resolveAxisForWeek(weekStartYmd, params.logicalTodayYmd);
  const resolved = resolveMinuteWriteInterval({
    axis,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
    allDay: params.allDay,
  });

  const oldYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);

  // 旧日仍可编辑且改到另一天：累加新日，保留旧日指派/占用
  if (oldYmd !== params.assignYmd && isEditableScheduleDay(oldYmd, params.logicalTodayYmd)) {
    return placeFrogOnScheduleAt({
      weekStartYmd,
      weekday,
      startMinutes: resolved.startMinutes,
      endMinutes: resolved.endMinutes,
      allDay: params.allDay,
      subjectKind: placement.subjectKind,
      subjectId: placement.subjectId,
      logicalTodayYmd: params.logicalTodayYmd,
    });
  }

  await assertSubjectNotAlreadyInInterval({
    axis,
    weekStartYmd,
    weekday,
    startMinutes: resolved.startMinutes,
    endMinutes: resolved.endMinutes,
    subjectKind: placement.subjectKind,
    subjectId: placement.subjectId,
    excludePlacementId: placement.id,
  });

  await updatePlacementSlots(placement.id, {
    weekStartYmd,
    weekday,
    startSlotIndex: resolved.startSlotIndex,
    spanSlots: resolved.spanSlots,
    orphaned: false,
    startMinutes: resolved.startMinutes,
    endMinutes: resolved.endMinutes,
    allDay: resolved.allDay,
  });

  try {
    await assignFrogForDay({
      kind: placement.subjectKind,
      id: placement.subjectId,
      assignYmd: params.assignYmd,
      scheduleTime: {
        startMinutes: resolved.startMinutes,
        endMinutes: resolved.endMinutes,
        allDay: resolved.allDay === 1,
      },
    });
  } catch (err) {
    // 回滚为未入格，避免「时段内但未指派」
    await updatePlacementSlots(placement.id, {
      weekStartYmd: placement.weekStartYmd,
      weekday: placement.weekday,
      startSlotIndex: null,
      spanSlots: placement.spanSlots,
      orphaned: true,
      startMinutes: null,
      endMinutes: null,
      allDay: null,
    });
    notifyFrogScheduleChanged();
    throw err;
  }

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
  }

  const row = (await getPlacementById(placement.id))!;
  await pushPlacementUpsertBestEffort(row);
  notifyFrogScheduleChanged();
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
  await apiPostFrogSchedulePlacement({ action: 'delete', id: placementId });

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
    await apiPostFrogSchedulePlacement({ action: 'delete', id: p.id });
  }
  await unassignSubjectDay(placement.subjectKind, placement.subjectId, assignYmd);
  notifyFrogScheduleChanged();
}

/**
 * 按主体+指派日清占用并取消指派（编辑待办清日期 / 改日时用）。
 * 过去日不可编辑时仍 best-effort 取消 frog 字段。
 */
export async function clearSubjectAssignDay(params: {
  subjectKind: ScheduleSubjectKind;
  subjectId: string;
  assignYmd: string;
  logicalTodayYmd: string;
}): Promise<void> {
  await ensureScheduleTables();
  const weekStartYmd = getWeekStartMondayYmd(params.assignYmd);
  const weekday = weekdayFromYmd(params.assignYmd);
  const editable = isEditableScheduleDay(params.assignYmd, params.logicalTodayYmd);

  if (editable) {
    const all = await listSubjectPlacementsOnDay(
      weekStartYmd,
      weekday,
      params.subjectKind,
      params.subjectId,
    );
    for (const p of all) {
      await softDeletePlacement(p.id);
      try {
        await apiPostFrogSchedulePlacement({ action: 'delete', id: p.id });
      } catch (err) {
        console.warn('[frog-schedule] 删除占用远端失败', p.id, err);
      }
    }
  }

  await unassignSubjectDay(params.subjectKind, params.subjectId, params.assignYmd);
  if (editable) notifyFrogScheduleChanged();
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
  /**
   * `remapMode`：阶段 H 默认 `minutes`（绝对分钟 + 双写 slot）；
   * 紧急回滚可传 `slots` 走旧 `remapPlacementsForSlotHours`。
   * 其余字段保留以免旧调用方报错（日程轴与日界已解耦）。
   */
  opts?: {
    orphanOnRangeConflict?: boolean;
    dayBoundary?: TasksDayBoundary;
    remapMode?: 'minutes' | 'slots';
  },
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
  const oldAxis = normalizeAxisSettings(await getScheduleAxisSettings());
  const editablePlacements = await listPlacementsForEditableWeeks(thisMonday);
  const remapMode = opts?.remapMode ?? 'minutes';

  let remappedCount = 0;
  let orphanedCount = 0;

  const axisChanged =
    next.startMinutes !== oldAxis.startMinutes ||
    next.endMinutes !== oldAxis.endMinutes ||
    next.slotHours !== oldAxis.slotHours ||
    !breaksEqual(next.breaks, oldAxis.breaks);

  if (axisChanged) {
    // 按绝对时间（或旧格派生）重映射到新轴；落在范围外 / 跨 break → 未入格（不阻塞保存）
    const byWeek = new Map<string, typeof editablePlacements>();
    for (const p of editablePlacements) {
      const list = byWeek.get(p.weekStartYmd) ?? [];
      list.push(p);
      byWeek.set(p.weekStartYmd, list);
    }
    for (const [, list] of byWeek) {
      if (remapMode === 'slots') {
        const results = remapPlacementsForSlotHours(oldAxis, next, list);
        for (const r of results) {
          if (r.orphaned) {
            orphanedCount += 1;
            await updatePlacementSlots(r.placementId, {
              startSlotIndex: null,
              orphaned: true,
              startMinutes: null,
              endMinutes: null,
              allDay: null,
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
        continue;
      }

      const results = remapPlacementsForMinutes(oldAxis, next, list);
      for (const r of results) {
        if (r.orphaned) {
          // 已 orphaned 也清残留分钟，避免历史脏数据仍被分钟区间画进时间线
          if (r.reason !== 'already_orphaned') orphanedCount += 1;
          if (__DEV__ && r.reason && r.reason !== 'already_orphaned') {
            console.log('[schedule-remap]', r.placementId, r.reason);
          }
          await updatePlacementSlots(r.placementId, {
            startSlotIndex: null,
            orphaned: true,
            startMinutes: null,
            endMinutes: null,
            allDay: null,
          });
        } else if (r.nextStartSlotIndex != null) {
          remappedCount += 1;
          if (__DEV__ && r.reason) {
            console.log(
              '[schedule-remap]',
              r.placementId,
              r.reason,
              `${r.startMinutes}–${r.endMinutes}`,
              `slot=${r.nextStartSlotIndex}+${r.nextSpanSlots}`,
            );
          }
          await updatePlacementSlots(r.placementId, {
            startSlotIndex: r.nextStartSlotIndex,
            spanSlots: r.nextSpanSlots,
            orphaned: false,
            startMinutes: r.startMinutes,
            endMinutes: r.endMinutes,
            allDay: r.allDay,
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

/**
 * @deprecated 日程表时间轴与全局日界已解耦，日界变更不再改写日程轴。保留为空操作以免旧调用方报错。
 */
export async function syncScheduleAxisEndWithDayBoundary(
  _boundary: TasksDayBoundary,
  _logicalTodayYmd: string,
): Promise<void> {
  return;
}

export type CopyWeekResult = {
  copied: number;
  skipped: { subjectId: string; subjectKind: ScheduleSubjectKind; reason: string }[];
  overwritten: number;
};

/** @deprecated 阶段 L：复制上周 UI 已删；保留函数供脚本/应急，勿再接产品入口 */
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
