/**
 * 阶段 F：把单日占用 + 虚拟习惯 / 待办聚合成 `TimelineEvent[]`。
 * 纯函数，展示文案 / 颜色种类由调用方 `resolve` 提供，便于脚本单测。
 */
import {
  getSlotCount,
  placementEndMinutes,
  slotStartMinutes,
  type AxisLike,
} from '@/lib/schedule/axis';
import {
  isAllDayByWorkCoverage,
  isAllDaySpan,
} from '@/lib/schedule/timeline/from-placement';
import { ymdForWeekday } from '@/lib/schedule/week';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import type { VirtualHabitPlacement } from '@/lib/schedule/habit-virtual-placement';
import type { VirtualTaskPlacement } from '@/lib/schedule/task-virtual-placement';
import type {
  TimelineEvent,
  TimelineEventKind,
} from '@/lib/schedule/timeline/types';

export type PlacementDisplay = {
  title: string;
  done: boolean;
  priority: number;
  blockKind: TimelineEventKind;
  icon: string | null;
  overdue: boolean;
  /** 同类别内部排序键（对齐项目/任务/待办列表） */
  sortOrder?: number;
  dueMs?: number | null;
  rewardPoints?: number;
  updatedAt?: string | null;
  subjectId?: string | null;
};

export type PlacementDisplayResolver = (params: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
}) => PlacementDisplay | null;

function placementInterval(
  placement: SchedulePlacementRow,
  axis: AxisLike,
): { startMinutes: number; endMinutes: number } | null {
  if (
    placement.startMinutes != null &&
    placement.endMinutes != null &&
    placement.endMinutes > placement.startMinutes
  ) {
    return { startMinutes: placement.startMinutes, endMinutes: placement.endMinutes };
  }
  if (placement.startSlotIndex == null) return null;
  const startMinutes = slotStartMinutes(axis, placement.startSlotIndex);
  const endMinutes = placementEndMinutes(
    axis,
    placement.startSlotIndex,
    Math.max(1, placement.spanSlots),
  );
  if (!(endMinutes > startMinutes)) return null;
  return { startMinutes, endMinutes };
}

/** 构建某一天的时间线事件（含全天与定时） */
export function buildTimelineEventsForDay(params: {
  dayYmd: string;
  axis: AxisLike;
  placements: SchedulePlacementRow[];
  virtualHabits: VirtualHabitPlacement[];
  virtualTasks: VirtualTaskPlacement[];
  resolvePlacement: PlacementDisplayResolver;
}): TimelineEvent[] {
  const { dayYmd, axis, placements, virtualHabits, virtualTasks, resolvePlacement } = params;
  const daySlots = getSlotCount(axis);
  const events: TimelineEvent[] = [];

  for (const p of placements) {
    // 与课表/未入格池一致：orphaned 或无格均不算入轴（勿因残留分钟画进时间线）
    if (p.orphaned || p.startSlotIndex == null) continue;
    const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
    if (ymd !== dayYmd) continue;
    const iv = placementInterval(p, axis);
    if (!iv) continue;
    const display = resolvePlacement({
      kind: p.subjectKind,
      id: p.subjectId,
      assignYmd: ymd,
    });
    if (!display) continue;
    const rawAllDay = p.allDay as number | boolean | null | undefined;
    const allDay =
      rawAllDay === 1 ||
      rawAllDay === true ||
      isAllDaySpan(p.startSlotIndex, p.spanSlots, daySlots) ||
      isAllDayByWorkCoverage(axis, iv.startMinutes, iv.endMinutes);
    events.push({
      id: `p-${p.id}`,
      kind: display.blockKind,
      title: display.title.trim() || '青蛙',
      icon: display.icon,
      done: display.done,
      overdue: display.overdue,
      allDay,
      startMinutes: iv.startMinutes,
      endMinutes: iv.endMinutes,
      priority: display.priority,
      assignYmd: ymd,
      source: { type: 'placement', placement: p },
      sortOrder: display.sortOrder,
      dueMs: display.dueMs,
      rewardPoints: display.rewardPoints,
      updatedAt: display.updatedAt,
      subjectId: display.subjectId ?? p.subjectId,
    });
  }

  for (const h of virtualHabits) {
    if (h.assignYmd !== dayYmd) continue;
    let startMinutes = axis.startMinutes;
    let endMinutes = axis.endMinutes;
    const allDay = !!h.allDay;
    if (!allDay) {
      if (
        typeof h.startMinutes === 'number' &&
        typeof h.endMinutes === 'number' &&
        h.endMinutes > h.startMinutes
      ) {
        startMinutes = h.startMinutes;
        endMinutes = h.endMinutes;
      } else {
        startMinutes = slotStartMinutes(axis, h.startSlotIndex);
        endMinutes = placementEndMinutes(axis, h.startSlotIndex, Math.max(1, h.spanSlots));
      }
    }
    events.push({
      id: `h-${h.habitId}-${h.assignYmd}`,
      kind: 'habit',
      title: (h.name ?? '').trim() || '习惯',
      icon: h.icon && h.icon !== 'check' ? h.icon : null,
      done: !!h.done,
      overdue: false,
      allDay,
      startMinutes,
      endMinutes,
      priority: 0,
      assignYmd: h.assignYmd,
      source: { type: 'habit', habit: h },
      subjectId: h.habitId,
    });
  }

  for (const t of virtualTasks) {
    if (t.assignYmd !== dayYmd) continue;
    const blockKind: TimelineEventKind =
      t.carrySubjectKind === 'project'
        ? 'proj'
        : t.carrySubjectKind === 'task'
          ? 'frog'
          : 'todo';
    const display = resolvePlacement({
      kind: t.carrySubjectKind === 'project' ? 'project' : 'task',
      id: t.taskId,
      assignYmd: t.assignYmd,
    });
    /**
     * 与真实占用同一口径：resolve 拒绝（该日无青蛙指派 / 未入格）不进时间线。
     * 过期滞留块也不得例外——否则未入格项目/待办会以全天虚拟条漏进轴内。
     */
    if (!display) continue;
    let startMinutes = axis.startMinutes;
    let endMinutes = axis.endMinutes;
    if (!t.allDay) {
      if (
        typeof t.startMinutes === 'number' &&
        typeof t.endMinutes === 'number' &&
        t.endMinutes > t.startMinutes
      ) {
        startMinutes = t.startMinutes;
        endMinutes = t.endMinutes;
      } else {
        startMinutes = slotStartMinutes(axis, t.startSlotIndex);
        endMinutes = placementEndMinutes(axis, t.startSlotIndex, Math.max(1, t.spanSlots));
      }
    }
    events.push({
      id: `vt-${t.taskId}-${t.assignYmd}`,
      kind: blockKind,
      title: (t.title ?? '').trim() || '待办',
      icon: display?.icon ?? null,
      done: !!t.done,
      overdue: !!t.overdue || !!t.carrySubjectKind,
      allDay: !!t.allDay,
      startMinutes,
      endMinutes,
      priority: t.priority ?? 0,
      assignYmd: t.assignYmd,
      source: { type: 'virtualTask', task: t },
      sortOrder: display.sortOrder,
      dueMs: display.dueMs,
      rewardPoints: display.rewardPoints,
      updatedAt: display.updatedAt,
      subjectId: display.subjectId ?? t.taskId,
    });
  }

  return events;
}
