/**
 * 通知点击后的业务跳转（供 Router 与强提醒处置页共用）。
 */

import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { syncWeeklyReviewReminderNotification } from '@/lib/weekly-review-reminder-notifications';
import { syncAllFinanceReminders } from '@/lib/finance-reminder-notifications';
import { syncHealthIntakeReminderNotifications } from '@/lib/health-intake-reminder-notifications';
import { resyncHabitReminderForHabitId } from '@/lib/habit-reminder-notifications';
import { resyncTaskDeadlineReminderForTaskId } from '@/lib/task-deadline-reminder-notifications';
import { syncProjectProgressReminderNotifications } from '@/lib/project-progress-reminder-notifications';
import { formatYmd } from '@/lib/date';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';

type AppRouter = {
  push: (href: string | { pathname: string; params?: Record<string, string> }) => void;
};

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
  if (record.type === 'task-deadline-reminder' && typeof record.taskId === 'string' && record.taskId) {
    void resyncTaskDeadlineReminderForTaskId(record.taskId);
    return;
  }
  if (record.type === 'project-progress-reminder') {
    void syncProjectProgressReminderNotifications();
    return;
  }
  if (record.type === 'daily-review-reminder') {
    void syncDailyReviewReminderNotification();
    return;
  }
  if (record.type === 'weekly-review-reminder') {
    void syncWeeklyReviewReminderNotification();
    return;
  }
  if (record.type === 'health-intake-reminder') {
    void syncHealthIntakeReminderNotifications();
    return;
  }
  if (
    record.type === 'finance-scheduled-expense-reminder' ||
    record.type === 'finance-savings-nudge-reminder' ||
    record.type === 'finance-ledger-wrap-reminder' ||
    record.type === 'finance-budget-threshold-reminder'
  ) {
    void syncAllFinanceReminders();
  }
}

async function resolveReviewLogicalYmd(record: Record<string, unknown>): Promise<string> {
  const fromData = typeof record.ymd === 'string' ? record.ymd.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromData)) return fromData;
  try {
    const boundary = await resolveDayBoundaryForPage('review');
    return getLogicalLocalYmd(new Date(), boundary);
  } catch {
    return formatYmd(new Date());
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
      router.push('/');
      return;
    }
    case 'daily-review-reminder': {
      void (async () => {
        const ymd = await resolveReviewLogicalYmd(record);
        router.push({
          pathname: '/daily-review/[ymd]',
          params: { ymd, focusEmpty: '1' },
        });
      })();
      return;
    }
    case 'weekly-review-reminder': {
      router.push({ pathname: '/(tabs)/review', params: { focus: 'weekly' } });
      return;
    }
    case 'habit-reminder': {
      const habitId = typeof record.habitId === 'string' ? record.habitId.trim() : '';
      if (habitId) {
        router.push({ pathname: '/add-habit', params: { id: habitId } });
      }
      return;
    }
    case 'task-deadline-reminder': {
      const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : '';
      if (taskId) {
        router.push({ pathname: '/edit-task', params: { id: taskId } });
      }
      return;
    }
    case 'project-progress-reminder': {
      const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
      if (projectId) {
        router.push({ pathname: '/edit-project', params: { id: projectId } });
      }
      return;
    }
    case 'auto-ledger':
    case 'auto-ledger-hint':
    case 'auto-ledger-failure': {
      router.push('/auto-ledger');
      return;
    }
    case 'finance-scheduled-expense-reminder': {
      const expenseId = typeof record.expenseId === 'string' ? record.expenseId.trim() : '';
      if (expenseId) {
        router.push({ pathname: '/add-scheduled-expense', params: { id: expenseId } });
      } else {
        router.push('/scheduled-expenses');
      }
      return;
    }
    case 'finance-budget-threshold-reminder':
    case 'finance-savings-nudge-reminder':
    case 'finance-ledger-wrap-reminder': {
      router.push('/(tabs)/finance');
      return;
    }
    default:
      return;
  }
}
