/**
 * @deprecated 截止日待办提醒已废除。
 * 请使用 `syncScheduleSlotReminderNotifications`（课程表占用提醒）。
 * 本文件保留 re-export，避免旧 import 路径立即崩溃。
 */
export {
  syncScheduleSlotReminderNotifications as syncScheduledTaskReminders,
  syncScheduleSlotReminderNotifications,
  cancelAllScheduleSlotReminders,
  scheduleSlotReminderIdentifier,
} from '@/lib/schedule-slot-reminder-notifications';
