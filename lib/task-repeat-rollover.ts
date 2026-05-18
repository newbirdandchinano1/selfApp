import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import { getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { insertTaskExecutionEvent } from '@/lib/repositories/tasks/task-execution-events';
import { updateTask } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';

export type TaskRepeatOption = '不重复' | '每天' | '每周' | '每月' | '每年';

export type TaskRepeatSchedule = {
  repeatOption: TaskRepeatOption;
  weeklyDays: number[];
  monthlyDays: number[];
  yearlyDate: string;
};

const REPEAT_OPTIONS: TaskRepeatOption[] = ['不重复', '每天', '每周', '每月', '每年'];

const CN_WEEKDAY_TO_MON1: Record<string, number> = {
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
  周日: 7,
};

function ymdToLocalDate(ymd: string): Date | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseExtraObject(extraData: string | null): Record<string, unknown> {
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

function normalizeWeeklyDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10)))
    .filter((n) => n >= 1 && n <= 7);
}

function normalizeMonthlyDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10)))
    .filter((n) => n >= 1 && n <= 31);
}

function parseWeeklyDaysFromRepeatText(repeat: string): number[] {
  const days: number[] = [];
  for (const [label, value] of Object.entries(CN_WEEKDAY_TO_MON1)) {
    if (repeat.includes(label)) days.push(value);
  }
  return days;
}

function parseMonthlyDaysFromRepeatText(repeat: string): number[] {
  const m = repeat.match(/每月\s*([\d、,，\s]+)/);
  if (!m) return [];
  const nums = m[1]
    .split(/[、,，\s]+/)
    .map((s) => parseInt(s.replace(/日/g, ''), 10))
    .filter((n) => n >= 1 && n <= 31);
  return nums;
}

/** 从 schedule 字段或 repeat 文案补全周/月重复日（兼容未写入 weeklyDays 的旧数据） */
function resolveRepeatDayFields(
  repeatOption: TaskRepeatOption,
  schedule: Record<string, unknown>,
  repeatFromRoot: string,
): Pick<TaskRepeatSchedule, 'weeklyDays' | 'monthlyDays' | 'yearlyDate'> {
  const repeatSummary = typeof schedule.repeatSummary === 'string' ? schedule.repeatSummary.trim() : '';
  const textFallback = repeatSummary || repeatFromRoot;

  let weeklyDays = normalizeWeeklyDays(schedule.weeklyDays);
  let monthlyDays = normalizeMonthlyDays(schedule.monthlyDays);
  let yearlyDate = typeof schedule.yearlyDate === 'string' ? schedule.yearlyDate.trim() : '';

  if (repeatOption === '每周' && weeklyDays.length === 0 && textFallback) {
    weeklyDays = parseWeeklyDaysFromRepeatText(textFallback);
  }
  if (repeatOption === '每月' && monthlyDays.length === 0 && textFallback) {
    monthlyDays = parseMonthlyDaysFromRepeatText(textFallback);
  }
  if (repeatOption === '每年' && !yearlyDate && textFallback) {
    const m = textFallback.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const mo = String(Number(m[1])).padStart(2, '0');
      const day = String(Number(m[2])).padStart(2, '0');
      yearlyDate = `2000-${mo}-${day}`;
    }
  }

  return { weeklyDays, monthlyDays, yearlyDate };
}

/** 从 extra_data 解析重复规则（优先 schedule，兼容仅 repeat 文案的旧数据） */
export function parseTaskRepeatSchedule(extraData: string | null): TaskRepeatSchedule | null {
  const root = parseExtraObject(extraData);
  const repeatFromRoot = typeof root.repeat === 'string' ? root.repeat.trim() : '';
  const schedule = root.schedule;
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    const s = schedule as Record<string, unknown>;
    const opt = s.repeatOption;
    if (typeof opt === 'string' && REPEAT_OPTIONS.includes(opt as TaskRepeatOption) && opt !== '不重复') {
      const resolved = resolveRepeatDayFields(opt as TaskRepeatOption, s, repeatFromRoot);
      return {
        repeatOption: opt as TaskRepeatOption,
        ...resolved,
      };
    }
  }

  const repeat = repeatFromRoot;
  if (!repeat || repeat === '不重复') return null;
  if (repeat === '每天' || repeat.startsWith('每天')) {
    return { repeatOption: '每天', weeklyDays: [], monthlyDays: [], yearlyDate: '' };
  }
  if (repeat.startsWith('每周')) {
    return {
      repeatOption: '每周',
      weeklyDays: parseWeeklyDaysFromRepeatText(repeat),
      monthlyDays: [],
      yearlyDate: '',
    };
  }
  if (repeat.startsWith('每月')) {
    return {
      repeatOption: '每月',
      weeklyDays: [],
      monthlyDays: parseMonthlyDaysFromRepeatText(repeat),
      yearlyDate: '',
    };
  }
  if (repeat.startsWith('每年')) {
    const m = repeat.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const mo = String(Number(m[1])).padStart(2, '0');
      const day = String(Number(m[2])).padStart(2, '0');
      return { repeatOption: '每年', weeklyDays: [], monthlyDays: [], yearlyDate: `2000-${mo}-${day}` };
    }
    return { repeatOption: '每年', weeklyDays: [], monthlyDays: [], yearlyDate: '' };
  }
  return null;
}

export function taskHasRepeatingSchedule(extraData: string | null): boolean {
  return parseTaskRepeatSchedule(extraData) != null;
}

function getWeekdayMonAs1(ymd: string): number {
  const d = ymdToLocalDate(ymd);
  if (!d) return 1;
  return ((d.getDay() + 6) % 7) + 1;
}

function getDayOfMonth(ymd: string): number {
  const d = ymdToLocalDate(ymd);
  return d ? d.getDate() : 1;
}

/** 逻辑日是否为该重复规则下的「应出现」日 */
export function isTaskRepeatDueOnLogicalDay(logicalYmd: string, schedule: TaskRepeatSchedule): boolean {
  switch (schedule.repeatOption) {
    case '每天':
      return true;
    case '每周':
      return (
        schedule.weeklyDays.length > 0 && schedule.weeklyDays.includes(getWeekdayMonAs1(logicalYmd))
      );
    case '每月':
      return (
        schedule.monthlyDays.length > 0 && schedule.monthlyDays.includes(getDayOfMonth(logicalYmd))
      );
    case '每年': {
      const anchor = schedule.yearlyDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return false;
      return logicalYmd.slice(5) === anchor.slice(5);
    }
    default:
      return false;
  }
}

export function getRepeatDoneOnYmd(extraData: string | null): string | null {
  const v = parseExtraObject(extraData).repeatDoneOnYmd;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  return null;
}

export function getCompletedLogicalYmd(
  completedAt: string | null,
  boundary: TasksDayBoundary,
): string | null {
  if (!completedAt?.trim()) return null;
  const d = new Date(completedAt);
  if (Number.isNaN(d.getTime())) return null;
  return getLogicalLocalYmd(d, boundary);
}

/** 标记完成时写入本重复周期的完成逻辑日 */
export function patchExtraDataOnRepeatTaskComplete(extraData: string | null, logicalYmd: string): string {
  return JSON.stringify({ ...parseExtraObject(extraData), repeatDoneOnYmd: logicalYmd });
}

/** 手动恢复为待办时清除周期完成标记 */
export function patchExtraDataOnRepeatTaskReopen(extraData: string | null): string {
  const base = parseExtraObject(extraData);
  delete base.repeatDoneOnYmd;
  return JSON.stringify(base);
}

function patchExtraDataOnRepeatRollover(extraData: string | null, logicalYmd: string): string {
  const base = parseExtraObject(extraData);
  delete base.repeatDoneOnYmd;
  return JSON.stringify({ ...base, repeatLastRolloverYmd: logicalYmd });
}

function shouldRolloverRepeatingTask(
  task: TaskRow,
  logicalTodayYmd: string,
  boundary: TasksDayBoundary,
): boolean {
  if (task.status !== 'done') return false;
  const schedule = parseTaskRepeatSchedule(task.extra_data);
  if (!schedule) return false;
  if (!isTaskRepeatDueOnLogicalDay(logicalTodayYmd, schedule)) return false;

  const doneOn = getRepeatDoneOnYmd(task.extra_data) ?? getCompletedLogicalYmd(task.completed_at, boundary);
  if (doneOn === logicalTodayYmd) return false;
  return true;
}

/**
 * 在重复日将上一周期已完成的待办恢复为「待办」。
 * @returns 实际更新的任务条数
 */
export async function applyRepeatingTaskRollovers(
  tasks: TaskRow[],
  logicalTodayYmd: string,
  boundary: TasksDayBoundary,
): Promise<number> {
  let changed = 0;
  for (const task of tasks) {
    if (!shouldRolloverRepeatingTask(task, logicalTodayYmd, boundary)) continue;
    try {
      await updateTask(task.id, {
        status: 'todo',
        completed_at: null,
        extra_data: patchExtraDataOnRepeatRollover(task.extra_data, logicalTodayYmd),
      });
      try {
        await insertTaskExecutionEvent(task.id, 'reopened', task.title ?? null);
      } catch (e) {
        console.warn('记录重复待办恢复事件失败', task.id, e);
      }
      changed += 1;
    } catch (e) {
      console.warn('重复待办刷新失败', task.id, e);
    }
  }
  return changed;
}
