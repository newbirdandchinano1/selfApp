/**
 * 课表 / 任务日程 / 定时支出共用的日期与 ScheduleMeta 入口。
 * 业务代码优先从此处或子模块导入，避免再抄一份 formatYmd / parseProjectSchedule。
 */

export {
  addDaysToYmd,
  compareYmd,
  dueDateYmd,
  formatLocalYmd,
  formatYmd,
  formatYmdCN,
  isLogicalDayInYmdRange,
  isValidYmd,
  parseYmd,
  scheduleDateToYmd,
  toYmd,
  ymdToLocalDate,
  ymdToLocalNoon,
} from '@/lib/schedule/ymd';

export {
  dueDateFromScheduleMeta,
  hasScheduleRange,
  isLogicalDayCoveredBySchedule,
  parseProjectSchedule,
  parseScheduleMetaFromExtra,
  scheduleMetaHasConcreteDates,
  scheduleMetaToYmdBounds,
  type ScheduleDateBounds,
  type ScheduleMeta,
  type ScheduleMetaLike,
  type ScheduleYmdBounds,
} from '@/lib/schedule/meta';

export {
  describeTaskRepeatSchedule,
  isRepeatDueOnLogicalDay,
  normalizeMonthlyDays,
  normalizeScheduledExpenseRepeatStorage,
  normalizeWeeklyDays,
  scheduledExpenseStorageToTaskRepeat,
  taskRepeatToScheduledExpenseStorage,
  type ScheduledExpenseRepeatStorage,
} from '@/lib/schedule/repeat';
