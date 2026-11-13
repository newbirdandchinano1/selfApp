/**
 * 日程表虚拟入格（不写 schedule_placements）
 * - 独立待办：有时刻/重复/指派日规则（见 shouldShowVirtualTaskOnDay）
 * - 项目任务 / 项目：该日已青蛙指派但尚无真实占用 → 全天虚拟块（避免「已指派却日程空白」）
 * - 过期未完成青蛙：滞留今日全天（buildOverdueFrogCarryPlacementsForToday）
 * - 同日已有有效占用行（非未入格）则不再叠虚拟块
 * - 定点时刻落在轴外时回退全天，避免整条消失
 */
import {
  clockHmToAxisMinutes,
  listWorkSlots,
  type AxisLike,
} from '@/lib/schedule/axis';
import {
  allDaySpanForAxis,
  mapHabitTimeToWorkSlotIndex,
} from '@/lib/schedule/habit-virtual-placement';
import {
  parseScheduleMetaFromExtra,
  parseScheduleTimeHm,
  scheduleMetaToYmdBounds,
  type ScheduleMeta,
} from '@/lib/schedule/meta';
import { isAllDayByWorkCoverage } from '@/lib/schedule/timeline/from-placement';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import { ymdForWeekday } from '@/lib/schedule/week';
import { getFrogAssignedDates, isFrogAssignedOn } from '@/lib/frog-assignment';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { isTaskOverdueForList } from '@/lib/standalone-todo-visibility';
import { isHabitVisibleOnCalendarDay } from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import {
  getRepeatDoneOnYmd,
  isTaskRepeatDueOnLogicalDay,
  parseTaskRepeatSchedule,
} from '@/lib/task-repeat-rollover';
import {
  isTaskActiveStatus,
  isTaskShelvedStatus,
  isTaskTerminalStatus,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';

export type VirtualTaskPlacement = {
  taskId: string;
  title: string;
  assignYmd: string;
  startSlotIndex: number;
  spanSlots: number;
  hour: number;
  minute: number;
  /** 有具体起止时写入轴分钟，时间线按此时长算高度（不再整格拉伸） */
  startMinutes?: number;
  endMinutes?: number;
  done: boolean;
  priority: number;
  extraData: string | null;
  allDay: boolean;
  /** 截止日期/日程窗/漏做已过且未完成 → 今日列表置顶 */
  overdue?: boolean;
  /**
   * 过期未完成青蛙滞留今日时标注主体类型；
   * 缺省为独立待办（琥珀块）。
   */
  carrySubjectKind?: 'task' | 'project';
};

/** 默认定点时长（仅有开始、无有效结束时） */
const DEFAULT_TIMED_SPAN_MINUTES = 30;

/** 开始落在断开/缝隙时，取最近可排格索引（仅占位；时间线以分钟为准） */
function nearestWorkSlotIndex(axis: AxisLike, axisMinutes: number): number {
  const slots = listWorkSlots(axis);
  if (slots.length === 0) return 0;
  for (const slot of slots) {
    if (axisMinutes >= slot.startMinutes && axisMinutes < slot.endMinutes) {
      return slot.slotIndex;
    }
  }
  for (const slot of slots) {
    if (slot.startMinutes >= axisMinutes) return slot.slotIndex;
  }
  return slots[slots.length - 1]!.slotIndex;
}

function resolveTimedAxisInterval(
  axis: AxisLike,
  schedule: ScheduleMeta,
): {
  hour: number;
  minute: number;
  slotIndex: number;
  startMinutes: number;
  endMinutes: number;
} | null {
  const startHm = parseScheduleTimeHm(schedule.startTime);
  if (!startHm) return null;
  const startMinutes = clockHmToAxisMinutes(axis, startHm.hour, startHm.minute);
  if (startMinutes == null) return null;
  // 开始落在午休等断开时段时仍保留定点展示（13:00–17:00 不应整条消失）
  const slotIndex =
    mapHabitTimeToWorkSlotIndex(axis, startHm.hour, startHm.minute) ??
    nearestWorkSlotIndex(axis, startMinutes);

  let endMinutes = startMinutes + DEFAULT_TIMED_SPAN_MINUTES;
  const endHm = parseScheduleTimeHm(schedule.endTime);
  if (endHm) {
    const endAxis = clockHmToAxisMinutes(axis, endHm.hour, endHm.minute);
    if (endAxis != null && endAxis > startMinutes) endMinutes = endAxis;
  }
  endMinutes = Math.min(endMinutes, axis.endMinutes);
  if (!(endMinutes > startMinutes)) {
    endMinutes = Math.min(startMinutes + 1, axis.endMinutes);
  }
  if (!(endMinutes > startMinutes)) return null;

  return {
    hour: startHm.hour,
    minute: startHm.minute,
    slotIndex,
    startMinutes,
    endMinutes,
  };
}

function parseExtraObject(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** @deprecated 入格不再依赖此开关；保留解析以便读旧数据 */
export function parseAutoPlaceIntoSchedule(extraData: string | null | undefined): boolean {
  return parseExtraObject(extraData).autoPlaceIntoSchedule === true;
}

/** 日程 meta 是否具备具体开始时刻 */
export function scheduleMetaHasExactTimeForAutoPlace(
  schedule: ScheduleMeta | null | undefined,
): boolean {
  if (!schedule?.hasExactTime) return false;
  const raw = typeof schedule.startTime === 'string' ? schedule.startTime.trim() : '';
  if (!raw) return false;
  return parseStartTimeHm(raw) != null;
}

export function parseStartTimeHm(startTimeIsoOrEmpty: string): { hour: number; minute: number } | null {
  return parseScheduleTimeHm(startTimeIsoOrEmpty);
}

/** @deprecated 自动入格开关已移除 */
export function canEnableAutoPlaceIntoSchedule(
  schedule: ScheduleMeta | null | undefined,
  repeatText?: string | null,
): { ok: true } | { ok: false; reason: 'no-repeat' | 'no-exact-time' } {
  const repeatOpt = schedule?.repeatOption;
  const hasRepeat =
    (typeof repeatOpt === 'string' && repeatOpt !== '不重复') ||
    (!!repeatText?.trim() && repeatText.trim() !== '不重复');
  if (!hasRepeat) return { ok: false, reason: 'no-repeat' };
  if (!scheduleMetaHasExactTimeForAutoPlace(schedule)) {
    return { ok: false, reason: 'no-exact-time' };
  }
  return { ok: true };
}

function isTaskDoneOnAssignYmd(task: TaskRow, assignYmd: string): boolean {
  const doneOn = getRepeatDoneOnYmd(task.extra_data);
  if (doneOn) return doneOn === assignYmd;
  return task.status === 'done';
}

/**
 * 有日期窗：从 max(今天, start) 到 end 每天；
 * 若已过期仍未完成：今天起每日继续全天，直至完成。
 */
function isViewYmdInDatedAllDayWindow(params: {
  viewYmd: string;
  logicalTodayYmd: string;
  startYmd: string | null;
  endYmd: string | null;
}): boolean {
  const { viewYmd, logicalTodayYmd, startYmd, endYmd } = params;
  if (viewYmd < logicalTodayYmd) return false;
  if (!endYmd && !startYmd) return true;

  if (endYmd && logicalTodayYmd > endYmd) {
    // 过期未完成：继续每日入格
    return true;
  }

  const windowStart =
    startYmd && startYmd > logicalTodayYmd ? startYmd : logicalTodayYmd;
  if (viewYmd < windowStart) return false;
  if (endYmd && viewYmd > endYmd) return false;
  return true;
}

/** 重复待办：执行日入格；已过期/漏做则从今天起每日入格（与待办栏滞留口径一致） */
function shouldShowRepeatingVirtualTaskOnDay(
  task: TaskRow,
  viewYmd: string,
  logicalTodayYmd: string,
  repeat: NonNullable<ReturnType<typeof parseTaskRepeatSchedule>>,
): boolean {
  if (isTaskRepeatDueOnLogicalDay(viewYmd, repeat)) return true;
  return viewYmd >= logicalTodayYmd && isTaskOverdueForList(task, logicalTodayYmd);
}

/**
 * 独立待办因重复规则（或漏做滞留）在该日自动入格——不写 frog 指派字段。
 * 供时间线 / 焦点列表 / 列表「已入格」徽章与虚拟落格共用。
 */
export function isStandaloneRepeatAutoInGridOnDay(
  task: TaskRow,
  viewYmd: string,
  logicalTodayYmd: string,
): boolean {
  if (!isStandaloneTodoTask(task)) return false;
  if (isTaskShelvedStatus(task.status) || task.status === 'cancelled') return false;
  const repeat = parseTaskRepeatSchedule(task.extra_data);
  if (!repeat) return false;
  return shouldShowRepeatingVirtualTaskOnDay(task, viewYmd, logicalTodayYmd, repeat);
}

/** 该日是否算已入格：青蛙指派，或独立待办重复日自动入格 */
export function isTaskInScheduleGridOnDay(
  task: TaskRow,
  viewYmd: string,
  logicalTodayYmd: string,
): boolean {
  if (isFrogAssignedOn(task.extra_data, viewYmd)) return true;
  return isStandaloneRepeatAutoInGridOnDay(task, viewYmd, logicalTodayYmd);
}

/** 单日是否应虚拟入格（不含轴映射；不含与真实占用去重） */
export function shouldShowVirtualTaskOnDay(params: {
  task: TaskRow;
  viewYmd: string;
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
}): boolean {
  const { task, viewYmd, logicalTodayYmd, dayBoundary } = params;
  if (!isStandaloneTodoTask(task)) return false;
  if (viewYmd < logicalTodayYmd) return false;
  if (isTaskShelvedStatus(task.status) || task.status === 'cancelled') return false;
  if (!isHabitVisibleOnCalendarDay(task.created_at, viewYmd, dayBoundary)) return false;

  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  const hasExactTime = scheduleMetaHasExactTimeForAutoPlace(schedule);
  const repeat = parseTaskRepeatSchedule(task.extra_data);
  const frogOnDay = isFrogAssignedOn(task.extra_data, viewYmd);
  const repeatAuto =
    !!repeat && shouldShowRepeatingVirtualTaskOnDay(task, viewYmd, logicalTodayYmd, repeat);

  if (!isTaskActiveStatus(task.status)) {
    if (!isTaskDoneOnAssignYmd(task, viewYmd)) return false;
    // 完成态：该日指派或重复执行日仍展示已完成块
    return frogOnDay || (!!repeat && isTaskRepeatDueOnLogicalDay(viewYmd, repeat));
  }

  // 有重复：执行日 / 漏做滞留日自动入格（无需青蛙指派）
  if (repeatAuto) return true;

  /**
   * 无重复：与时间线 / 列表入格口径一致，必须是「该日」已指派，
   * 不因截止日 / 日程窗 / 其它指派日而虚拟铺进当天时间线。
   */
  if (!frogOnDay) return false;

  if (hasExactTime) {
    const bounds = scheduleMetaToYmdBounds(schedule, task.due_date);
    if (bounds.startYmd || bounds.endYmd) {
      return isViewYmdInDatedAllDayWindow({
        viewYmd,
        logicalTodayYmd,
        startYmd: bounds.startYmd,
        endYmd: bounds.endYmd,
      });
    }
    // 有时刻、无日期无重复：上方已确认该日指派 → 虚拟入格
    return true;
  }

  const bounds = scheduleMetaToYmdBounds(schedule, task.due_date);
  if (bounds.startYmd || bounds.endYmd) {
    return isViewYmdInDatedAllDayWindow({
      viewYmd,
      logicalTodayYmd,
      startYmd: bounds.startYmd,
      endYmd: bounds.endYmd,
    });
  }

  // 无日期无重复：上方已确认该日指派 → 虚拟全天（否则时间线顶栏空白）
  return true;
}

function buildPlacedTaskDayKeys(placements: SchedulePlacementRow[] | undefined): Set<string> {
  const keys = new Set<string>();
  if (!placements) return keys;
  for (const p of placements) {
    if (p.subjectKind !== 'task') continue;
    // 未入格/无格：勿拦虚拟块，否则占用行被时间线跳过 + 虚拟也被去重 = 整条消失
    if (p.orphaned || p.startSlotIndex == null) continue;
    const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
    keys.add(`${p.subjectId}:${ymd}`);
  }
  return keys;
}

/** 有效占用主体日键：`task|project:id:ymd` */
function buildPlacedSubjectDayKeys(placements: SchedulePlacementRow[] | undefined): Set<string> {
  const keys = new Set<string>();
  if (!placements) return keys;
  for (const p of placements) {
    if (p.orphaned || p.startSlotIndex == null) continue;
    const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
    keys.add(`${p.subjectKind}:${p.subjectId}:${ymd}`);
  }
  return keys;
}

export function buildVirtualTaskPlacementsForDays(params: {
  tasks: TaskRow[];
  dayYmds: string[];
  logicalTodayYmd: string;
  axis: AxisLike;
  dayBoundary: TasksDayBoundary;
  /** 已有真实占用时跳过同日同任务虚拟块 */
  placements?: SchedulePlacementRow[];
}): VirtualTaskPlacement[] {
  const { tasks, dayYmds, logicalTodayYmd, axis, dayBoundary, placements } = params;
  const placedKeys = buildPlacedTaskDayKeys(placements);
  const out: VirtualTaskPlacement[] = [];
  const allDay = allDaySpanForAxis(axis);
  const axisStartH = Math.floor(axis.startMinutes / 60);
  const axisStartM = axis.startMinutes % 60;

  for (const task of tasks) {
    if (!isStandaloneTodoTask(task)) continue;

    const schedule = parseScheduleMetaFromExtra(task.extra_data);
    const hasExactTime = scheduleMetaHasExactTimeForAutoPlace(schedule);
    /** 定点时刻落在轴外时回退全天，避免过期/当日待办整条消失 */
    let timedSlot: {
      hour: number;
      minute: number;
      slotIndex: number;
      startMinutes: number;
      endMinutes: number;
    } | null = null;
    if (hasExactTime && schedule) {
      timedSlot = resolveTimedAxisInterval(axis, schedule);
    }

    for (const ymd of dayYmds) {
      if (
        !shouldShowVirtualTaskOnDay({
          task,
          viewYmd: ymd,
          logicalTodayYmd,
          dayBoundary,
        })
      ) {
        continue;
      }
      if (placedKeys.has(`${task.id}:${ymd}`)) continue;

      const done = isTaskDoneOnAssignYmd(task, ymd);
      const overdue = !done && isTaskOverdueForList(task, logicalTodayYmd);

      // 起止盖住当日全部可排格 → 走全天顶栏，避免超长条盖住整条时间线
      const treatAsAllDay =
        !timedSlot ||
        isAllDayByWorkCoverage(axis, timedSlot.startMinutes, timedSlot.endMinutes);

      if (timedSlot && !treatAsAllDay) {
        out.push({
          taskId: task.id,
          title: task.title?.trim() || '待办',
          assignYmd: ymd,
          startSlotIndex: timedSlot.slotIndex,
          spanSlots: 1,
          hour: timedSlot.hour,
          minute: timedSlot.minute,
          startMinutes: timedSlot.startMinutes,
          endMinutes: timedSlot.endMinutes,
          done,
          priority: task.priority ?? 0,
          extraData: task.extra_data,
          allDay: false,
          overdue,
        });
      } else {
        out.push({
          taskId: task.id,
          title: task.title?.trim() || '待办',
          assignYmd: ymd,
          startSlotIndex: allDay.startSlotIndex,
          spanSlots: allDay.spanSlots,
          hour: timedSlot?.hour ?? axisStartH,
          minute: timedSlot?.minute ?? axisStartM,
          done,
          priority: task.priority ?? 0,
          extraData: task.extra_data,
          allDay: true,
          overdue,
        });
      }
    }
  }

  return out;
}

/**
 * 该日已青蛙指派、但尚无真实占用的项目任务 / 项目 → 全天虚拟块。
 * 覆盖 AI/助手仅写指派字段、或占用未落成时「列表已指派、日程空白」的空洞。
 * 独立待办仍走 buildVirtualTaskPlacementsForDays。
 */
export function buildAssignedFrogVirtualPlacementsForDays(params: {
  tasks: TaskRow[];
  projects: ProjectRow[];
  dayYmds: string[];
  logicalTodayYmd: string;
  axis: AxisLike;
  placements?: SchedulePlacementRow[];
}): VirtualTaskPlacement[] {
  const { tasks, projects, dayYmds, logicalTodayYmd, axis, placements } = params;
  const placedKeys = buildPlacedSubjectDayKeys(placements);
  const allDay = allDaySpanForAxis(axis);
  const axisStartH = Math.floor(axis.startMinutes / 60);
  const axisStartM = axis.startMinutes % 60;
  const out: VirtualTaskPlacement[] = [];
  const seen = new Set<string>();

  const pushAssigned = (
    kind: 'task' | 'project',
    id: string,
    title: string,
    priority: number,
    extraData: string | null,
    status: string,
    ymd: string,
  ) => {
    if (ymd < logicalTodayYmd) return;
    if (!isFrogAssignedOn(extraData, ymd)) return;
    if (isTaskTerminalStatus(status) || isTaskShelvedStatus(status)) return;
    const key = `${kind}:${id}:${ymd}`;
    if (seen.has(key) || placedKeys.has(key)) return;
    seen.add(key);
    out.push({
      taskId: id,
      title: title.trim() || (kind === 'project' ? '项目' : '青蛙'),
      assignYmd: ymd,
      startSlotIndex: allDay.startSlotIndex,
      spanSlots: allDay.spanSlots,
      hour: axisStartH,
      minute: axisStartM,
      done: isFrogDoneForToday(extraData, status, ymd),
      priority,
      extraData,
      allDay: true,
      overdue: false,
      carrySubjectKind: kind,
    });
  };

  for (const ymd of dayYmds) {
    for (const t of tasks) {
      if (isStandaloneTodoTask(t)) continue;
      pushAssigned('task', t.id, t.title, t.priority ?? 0, t.extra_data, t.status, ymd);
    }
    for (const p of projects) {
      const status =
        p.status === 'done' ||
        p.status === 'cancelled' ||
        p.status === 'completed' ||
        p.status === 'archived'
          ? 'done'
          : p.status === 'doing' || p.status === 'blocked' || p.status === 'shelved'
            ? p.status
            : 'todo';
      pushAssigned('project', p.id, p.name, p.priority ?? 0, p.extra_data, status, ymd);
    }
  }

  return out;
}

/**
 * 过期未完成青蛙 → 今日全天虚拟块（不写 schedule_placements）。
 * 仅当最近指派日早于今天、当日尚未再指派、且该指派日未完成会话时滞留。
 */
export function buildOverdueFrogCarryPlacementsForToday(params: {
  tasks: TaskRow[];
  projects: ProjectRow[];
  logicalTodayYmd: string;
  axis: AxisLike;
  /** 今日已有真实占用的主体，避免重复 */
  placements?: SchedulePlacementRow[];
}): VirtualTaskPlacement[] {
  const { tasks, projects, logicalTodayYmd, axis, placements } = params;
  const onToday = new Set<string>();
  if (placements) {
    for (const p of placements) {
      // 未入格/无格仍允许滞留虚拟块上轴（与 buildPlacedTaskDayKeys 同口径）
      if (p.orphaned || p.startSlotIndex == null) continue;
      const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
      if (ymd !== logicalTodayYmd) continue;
      onToday.add(`${p.subjectKind}:${p.subjectId}`);
    }
  }
  const allDay = allDaySpanForAxis(axis);
  const axisStartH = Math.floor(axis.startMinutes / 60);
  const axisStartM = axis.startMinutes % 60;
  const out: VirtualTaskPlacement[] = [];
  const seen = new Set<string>();

  const pushCarry = (
    kind: 'task' | 'project',
    id: string,
    title: string,
    priority: number,
    extraData: string | null,
    status: string,
  ) => {
    const key = `${kind}:${id}`;
    if (seen.has(key) || onToday.has(key)) return;
    if (isTaskTerminalStatus(status) || isTaskShelvedStatus(status)) return;
    const dates = getFrogAssignedDates(extraData);
    if (dates.includes(logicalTodayYmd)) return;
    const past = dates.filter((d) => d < logicalTodayYmd);
    if (past.length === 0) return;
    const lastAssignYmd = past[past.length - 1]!;
    // 上次指派日已完成会话：不滞留（长期青蛙须重新入格）
    if (isFrogDoneForToday(extraData, status, lastAssignYmd)) return;
    seen.add(key);
    out.push({
      taskId: id,
      title: title.trim() || (kind === 'project' ? '项目' : '青蛙'),
      assignYmd: logicalTodayYmd,
      startSlotIndex: allDay.startSlotIndex,
      spanSlots: allDay.spanSlots,
      hour: axisStartH,
      minute: axisStartM,
      done: false,
      priority,
      extraData,
      allDay: true,
      overdue: true,
      carrySubjectKind: kind,
    });
  };

  for (const t of tasks) {
    if (isStandaloneTodoTask(t)) continue;
    pushCarry('task', t.id, t.title, t.priority ?? 0, t.extra_data, t.status);
  }
  for (const p of projects) {
    const status =
      p.status === 'done' ||
      p.status === 'cancelled' ||
      p.status === 'completed' ||
      p.status === 'archived'
        ? 'done'
        : p.status === 'doing' || p.status === 'blocked' || p.status === 'shelved'
          ? p.status
          : 'todo';
    pushCarry('project', p.id, p.name, p.priority ?? 0, p.extra_data, status);
  }
  return out;
}

/** 是否为应发日程格提醒的虚拟待办（仅定点，非全天） */
export function virtualTaskUsesScheduleSlotReminder(placement: Pick<VirtualTaskPlacement, 'allDay' | 'done'>): boolean {
  return !placement.allDay && !placement.done;
}

export function virtualTaskScheduleReminderId(taskId: string, assignYmd: string): string {
  return `vtask:${taskId}:${assignYmd}`;
}
