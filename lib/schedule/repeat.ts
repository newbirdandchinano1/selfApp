/**
 * 统一重复规则：任务 ScheduleMeta、定时支出共用同一套日/周/月判定。
 * 定时支出 DB 仍存 daily|weekly|monthly，经本模块映射到 TaskRepeatSchedule。
 */

import { normalizeMonthlyDays, normalizeWeeklyDays } from '@/lib/schedule/repeat-days';
import {
  isTaskRepeatDueOnLogicalDay,
  type TaskRepeatOption,
  type TaskRepeatSchedule,
} from '@/lib/task-repeat-rollover';

export { normalizeMonthlyDays, normalizeWeeklyDays } from '@/lib/schedule/repeat-days';

/** 定时支出持久化用的英文枚举（表字段 repeat_option） */
export type ScheduledExpenseRepeatStorage = 'daily' | 'weekly' | 'monthly';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export function normalizeScheduledExpenseRepeatStorage(raw: unknown): ScheduledExpenseRepeatStorage {
  if (raw === 'weekly' || raw === 'monthly' || raw === 'daily') return raw;
  if (raw === '每周') return 'weekly';
  if (raw === '每月') return 'monthly';
  if (raw === '每天') return 'daily';
  return 'daily';
}

export function scheduledExpenseStorageToTaskRepeat(
  repeatOption: ScheduledExpenseRepeatStorage,
  weeklyDays: number[],
  monthlyDays: number[],
): TaskRepeatSchedule {
  const option: TaskRepeatOption =
    repeatOption === 'daily' ? '每天' : repeatOption === 'weekly' ? '每周' : '每月';
  return {
    repeatOption: option,
    weeklyDays: normalizeWeeklyDays(weeklyDays),
    monthlyDays: normalizeMonthlyDays(monthlyDays),
    yearlyDate: '',
  };
}

export function taskRepeatToScheduledExpenseStorage(
  schedule: Pick<TaskRepeatSchedule, 'repeatOption'>,
): ScheduledExpenseRepeatStorage | null {
  switch (schedule.repeatOption) {
    case '每天':
      return 'daily';
    case '每周':
      return 'weekly';
    case '每月':
      return 'monthly';
    default:
      return null;
  }
}

export function isRepeatDueOnLogicalDay(
  logicalYmd: string,
  schedule: TaskRepeatSchedule,
): boolean {
  return isTaskRepeatDueOnLogicalDay(logicalYmd, schedule);
}

export function describeTaskRepeatSchedule(
  schedule: TaskRepeatSchedule,
  opts?: { hour?: number; minute?: number; timesPerDay?: number },
): string {
  const time =
    opts?.hour != null && opts?.minute != null
      ? ` ${String(opts.hour).padStart(2, '0')}:${String(opts.minute).padStart(2, '0')}`
      : '';
  const timesLabel =
    opts?.timesPerDay != null && opts.timesPerDay > 1 ? ` · 每天${opts.timesPerDay}次` : '';

  if (schedule.repeatOption === '每天') {
    return `每天${time}${timesLabel}`.trim();
  }
  if (schedule.repeatOption === '每周') {
    const days = schedule.weeklyDays.map((d) => WEEKDAY_LABELS[d - 1] ?? `周${d}`).join('、');
    return `每周 ${days}${time}${timesLabel}`.trim();
  }
  if (schedule.repeatOption === '每月') {
    const days = schedule.monthlyDays.map((d) => `${d}日`).join('、');
    return `每月 ${days}${time}${timesLabel}`.trim();
  }
  if (schedule.repeatOption === '每年' && schedule.yearlyDate) {
    const m = schedule.yearlyDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (m) return `每年 ${Number(m[1])}月${Number(m[2])}日${time}`.trim();
  }
  return schedule.repeatOption;
}
