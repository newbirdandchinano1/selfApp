/**
 * brief_context 读库聚合（P0-1）。纯组装见 `brief-context.ts`。
 */

import { addDaysToYmd } from '@/lib/date';
import { getDatabase } from '@/lib/database';
import {
  getBudgetMonthKeyForDate,
  loadBudgetRefreshDay,
  loadMonthBudgetSettings,
  resolvePeriodBudgetSurplus,
} from '@/lib/finance-monthly-budget';
import {
  isScheduledFinanceExpenseDueOnDay,
  loadScheduledFinanceExpenses,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import {
  buildAssistantBriefContext,
  type AssistantBriefContext,
  type AssistantBriefHabitItem,
  type AssistantBriefFinanceTxn,
  type AssistantBriefScheduledExpense,
  type AssistantBriefTaskItem,
} from './brief-context';
import { loadReviewDayFacts } from '@/lib/review-day-facts';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { getFinanceTransactionsByYmd } from '@/lib/repositories/finance/finance';
import { buildTaskAiSummaries, buildHabitAiSummaries, type HabitAiSource } from '@/lib/task-ai-context';
import { getHabits } from '@/lib/repositories/habits/habit';
import { parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { getTasks } from '@/lib/repositories/tasks/task';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';

function pickUpcomingScheduled(
  items: ScheduledFinanceExpense[],
  todayYmd: string,
  max = 3,
): AssistantBriefScheduledExpense[] {
  const end = addDaysToYmd(todayYmd, 3);
  const out: AssistantBriefScheduledExpense[] = [];
  for (const item of items) {
    if (!item.enabled) continue;
    let cursor: string | null = todayYmd;
    while (cursor && cursor <= end) {
      if (isScheduledFinanceExpenseDueOnDay(item, cursor)) {
        out.push({
          id: item.id,
          name: (item.name ?? '').trim() || '定时支出',
          amount: item.amount,
          due_ymd: cursor,
        });
        break;
      }
      cursor = addDaysToYmd(cursor, 1);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

async function loadHabitGaps(todayYmd: string, max = 5): Promise<AssistantBriefHabitItem[]> {
  const habits = await getHabits().catch(() => []);
  const db = await getDatabase().catch(() => null);
  const checkInByHabit = new Map<string, number>();
  if (db) {
    const rows =
      (await db
        .getAllAsync<{ habit_id: string; count: number }>(
          `SELECT habit_id, count FROM habit_check_ins
           WHERE record_date = ? AND sync_status != 'pending_delete'`,
          [todayYmd],
        )
        .catch(() => [])) ?? [];
    for (const row of rows) {
      checkInByHabit.set(row.habit_id, Math.max(0, Math.floor(Number(row.count ?? 0))));
    }
  }

  const sources: HabitAiSource[] = habits.map(h => {
    const kind = parseHabitKind(h.extra_data);
    return {
      id: h.id,
      name: h.name,
      kind,
      todayCount: checkInByHabit.get(h.id) ?? 0,
      dailyGoal: parseHabitDailyGoal(h.extra_data, kind) ?? undefined,
    };
  });

  return buildHabitAiSummaries(sources, 40)
    .filter(h => (h.today_count ?? 0) < (h.daily_goal ?? 1))
    .slice(0, max)
    .map(h => ({
      id: h.id,
      name: h.name,
      today_count: h.today_count ?? 0,
      daily_goal: h.daily_goal ?? 1,
    }));
}

/**
 * 从本地仓库聚合轻量今日摘要（cacheOnly 优先；失败块降级为空）。
 */
export async function loadAssistantBriefContext(opts?: {
  now?: Date;
  timezone?: string;
}): Promise<AssistantBriefContext> {
  const now = opts?.now ?? new Date();
  const boundary = getDayBoundarySync();
  const todayYmd = getLogicalLocalYmd(now, boundary);

  const [facts, tasks, habitGaps, todayTxns, budgetRemaining, scheduled] = await Promise.all([
    loadReviewDayFacts(todayYmd).catch(() => null),
    getTasks().catch(() => []),
    loadHabitGaps(todayYmd).catch(() => [] as AssistantBriefHabitItem[]),
    getFinanceTransactionsByYmd(todayYmd, { cacheOnly: true }).catch(() => []),
    (async (): Promise<number | null> => {
      try {
        const [refreshDay, settings] = await Promise.all([
          loadBudgetRefreshDay(),
          loadMonthBudgetSettings(),
        ]);
        const key = getBudgetMonthKeyForDate(now, refreshDay);
        const setting = settings[key];
        if (!setting) return null;
        return resolvePeriodBudgetSurplus(setting.baseAmount, 0, setting.periodSurplusOverride);
      } catch {
        return null;
      }
    })(),
    loadScheduledFinanceExpenses().catch(() => [] as ScheduledFinanceExpense[]),
  ]);

  const summaries = buildTaskAiSummaries(tasks, { logicalTodayYmd: todayYmd, max: 80 });
  const overdueCount = summaries.filter(t => t.is_overdue).length;
  const frogCandidates: AssistantBriefTaskItem[] = summaries
    .filter(t => !t.is_frog_today)
    .sort((a, b) => {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      return (b.priority ?? 0) - (a.priority ?? 0);
    })
    .slice(0, 5)
    .map(t => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due_ymd: t.due_ymd,
      status: t.status,
    }));

  const openTodos: AssistantBriefTaskItem[] = [];
  for (const t of tasks) {
    if (!isStandaloneTodoTask(t)) continue;
    const s = summaries.find(x => x.id === t.id);
    if (!s) continue;
    openTodos.push({
      id: s.id,
      title: s.title,
      priority: s.priority,
      due_ymd: s.due_ymd,
      status: s.status,
    });
    if (openTodos.length >= 8) break;
  }

  const recentTxns: AssistantBriefFinanceTxn[] = (facts?.finance.txns ?? [])
    .slice(0, 3)
    .map(t => ({
      id: t.id,
      name: t.name,
      amount: t.amount,
      type_label: t.typeLabel,
    }));

  let dailyDone = false;
  try {
    const rows = await listDailyReviewsBetween(todayYmd, todayYmd);
    dailyDone = rows.some(r => (r.body ?? '').trim().length > 0);
  } catch {
    dailyDone = false;
  }

  return buildAssistantBriefContext({
    todayYmd,
    boundary,
    now,
    timezone: opts?.timezone,
    healthFacts: facts?.health ?? null,
    frogCandidates,
    openTodos,
    overdueCount,
    habitGaps,
    recentTxns,
    budgetRemaining,
    todayUnlogged: todayTxns.length === 0,
    upcomingScheduled: pickUpcomingScheduled(scheduled, todayYmd),
    review: { daily_done: dailyDone },
  });
}
