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
    if (p.orphaned) continue;
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
    const allDay =
      p.allDay === 1 ||
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
    });
  }

  for (const h of virtualHabits) {
    if (h.assignYmd !== dayYmd) continue;
    events.push({
      id: `h-${h.habitId}-${h.assignYmd}`,
      kind: 'habit',
      title: (h.name ?? '').trim() || '习惯',
      icon: h.icon && h.icon !== 'check' ? h.icon : null,
      done: !!h.done,
      overdue: false,
      allDay: true,
      startMinutes: axis.startMinutes,
      endMinutes: axis.endMinutes,
      priority: 0,
      assignYmd: h.assignYmd,
      source: { type: 'habit', habit: h },
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
    });
  }

  return events;
}
