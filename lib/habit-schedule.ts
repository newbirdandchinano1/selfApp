/** 习惯循环日程判断（与任务页 `isHabitScheduledToday` 一致，按逻辑日 YMD） */

const HABIT_CN_WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

type HabitCycleTab = '每周定期' | '每周N天' | '每月定期' | '每月N天';

type HabitScheduleMeta = {
  activeTab?: HabitCycleTab | string;
  selectedDays?: unknown;
  monthlySpecificDays?: unknown;
};

function parseHabitSchedule(extraData: string | null): HabitScheduleMeta | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { schedule?: unknown };
    const s = p?.schedule;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return s as HabitScheduleMeta;
  } catch {
    return null;
  }
}

function logicalYmdToLocalDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/** 逻辑日是否为该习惯循环模式下允许打卡的日历日 */
export function isHabitScheduledOnLogicalYmd(extraData: string | null, logicalYmd: string): boolean {
  const schedule = parseHabitSchedule(extraData);
  const tab = schedule?.activeTab;
  if (!tab || typeof tab !== 'string') return true;

  if (tab === '每周N天' || tab === '每月N天') return true;

  const d = logicalYmdToLocalDate(logicalYmd);

  if (tab === '每周定期') {
    const selected = Array.isArray(schedule.selectedDays)
      ? schedule.selectedDays.filter((x): x is string => typeof x === 'string')
      : [];
    if (selected.length === 0) return false;
    return selected.includes(HABIT_CN_WEEKDAY_LABELS[d.getDay()]);
  }

  if (tab === '每月定期') {
    const dom = d.getDate();
    const days = Array.isArray(schedule.monthlySpecificDays)
      ? schedule.monthlySpecificDays.filter(
          (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 31
        )
      : [];
    if (days.length === 0) return false;
    return days.includes(dom);
  }

  return true;
}
