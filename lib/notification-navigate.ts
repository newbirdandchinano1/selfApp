/**
 * 通知点击后的业务跳转（供 Router 与强提醒处置页共用）。
 */

import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { resyncHabitReminderForHabitId } from '@/lib/habit-reminder-notifications';
import type { Router } from 'expo-router';

type AppRouter = Pick<Router, 'push'>;

function notificationDataRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/** 用户确认完成后，登记下一天/下一次业务提醒。 */
export function resyncReminderAfterAcknowledge(data: unknown): void {
  const record = notificationDataRecord(data);
  if (!record || typeof record.type !== 'string') return;
  if (record.type === 'habit-reminder' && typeof record.habitId === 'string' && record.habitId) {
    void resyncHabitReminderForHabitId(record.habitId);
    return;
  }
  if (record.type === 'daily-review-reminder') {
    void syncDailyReviewReminderNotification();
  }
}

export function navigateByNotificationType(router: AppRouter, data: unknown): void {
  const record = notificationDataRecord(data);
  if (!record || typeof record.type !== 'string') return;

  switch (record.type) {
    case 'schedule-slot-reminder': {
      const subjectId = typeof record.subjectId === 'string' ? record.subjectId.trim() : '';
      if (!subjectId) return;
      if (record.subjectKind === 'habit') {
        router.push({ pathname: '/add-habit', params: { id: subjectId } });
      } else if (record.subjectKind === 'project') {
        router.push({ pathname: '/edit-project', params: { id: subjectId } });
      } else {
        router.push({ pathname: '/edit-task', params: { id: subjectId } });
      }
      return;
    }
    case 'health-intake-reminder': {
      router.push('/' as never);
      return;
    }
    case 'daily-review-reminder': {
      router.push('/(tabs)/review');
      return;
    }
    case 'habit-reminder': {
      const habitId = typeof record.habitId === 'string' ? record.habitId.trim() : '';
      if (habitId) {
        router.push({ pathname: '/add-habit', params: { id: habitId } });
      }
      return;
    }
    default:
      return;
  }
}
