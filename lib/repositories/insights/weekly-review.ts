import { readApiTable } from '@/lib/api-read';
import { isYmdInRange, ymdFromDatetime } from '@/lib/api-read-helpers';

export type WeeklyReviewMetrics = {
  /** 统计区间类型：近 7 个自然日（含锚定日）或本地自然周（周一至周日） */
  rangeKind: 'rolling-7' | 'calendar-week';
  weekStartYmd: string;
  weekEndYmd: string;
  rangeDisplay: string;
  weekTitle: string;
  tasksCompleted: number;
  tasksCreated: number;
  habitCheckInTotal: number;
  savingsWeekTotal: number;
  financeIncome: number;
  financeExpense: number;
  wishUpdates: number;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 本周一至本周日（本地日历） */
export function getCurrentWeekRange(anchor: Date = new Date()): {
  startYmd: string;
  endYmd: string;
  start: Date;
  end: Date;
} {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = d.getDay();
  const offsetMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offsetMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday,
    end: sunday,
    startYmd: toYmd(monday),
    endYmd: toYmd(sunday),
  };
}

/** 以锚定日为结束日，向前共 7 个自然日（含结束日） */
export function getRollingSevenDayRange(anchor: Date = new Date()): {
  startYmd: string;
  endYmd: string;
  start: Date;
  end: Date;
} {
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return {
    start,
    end,
    startYmd: toYmd(start),
    endYmd: toYmd(end),
  };
}

/** 从 anchor 的日历日起，下一个「星期几 = reviewWeekday」的日期（若当天已是该星期几则含当天） */
export function getNextConfiguredReviewDayOnOrAfter(anchor: Date, reviewWeekday: number): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const cur = d.getDay();
  const delta = (reviewWeekday - cur + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * 以「即将到来的每周复盘日」为周期终点（含该日），向前连续 7 个自然日。
 * 与「今日倒推七天」不同：在非复盘日也会展示至「下一次复盘日」为止的同一周区间，便于提前写每日复盘。
 */
export function getRollingSevenDayRangeEndingOnNextReviewDay(
  anchor: Date,
  reviewWeekday: number,
): {
  startYmd: string;
  endYmd: string;
  start: Date;
  end: Date;
} {
  const end = getNextConfiguredReviewDayOnOrAfter(anchor, reviewWeekday);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return {
    start,
    end,
    startYmd: toYmd(start),
    endYmd: toYmd(end),
  };
}

function formatRangeChinese(start: Date, end: Date): string {
  return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

export async function fetchWeeklyReviewMetrics(
  anchor: Date = new Date(),
  range: 'rolling-7' | 'calendar-week' = 'rolling-7',
): Promise<WeeklyReviewMetrics> {
  const { startYmd, endYmd, start, end } =
    range === 'rolling-7' ? getRollingSevenDayRange(anchor) : getCurrentWeekRange(anchor);

  const [tasks, habitCheckIns, habits, deposits, plans, transactions, wishes] = await Promise.all([
    readApiTable<{ status?: string; completed_at?: string | null; created_at?: string }>('tasks', {
      offlineFallback: true,
    }),
    readApiTable<{ habit_id: string; record_date: string; count: number }>('habit_check_ins', {
      offlineFallback: true,
    }),
    readApiTable<{ id: string }>('habits', { offlineFallback: true }),
    readApiTable<{ savings_plan_id: string; amount: number; created_at?: string }>('savings_plan_deposits', {
      offlineFallback: true,
    }),
    readApiTable<{ id: string }>('savings_plans', { offlineFallback: true }),
    readApiTable<{ transaction_type?: string; amount?: number; happened_at?: string }>('finance_transactions', {
      offlineFallback: true,
    }),
    readApiTable<{ updated_at?: string }>('wish_items', { offlineFallback: true }),
  ]);

  const activeHabitIds = new Set(habits.map(h => h.id));
  const activePlanIds = new Set(plans.map(p => p.id));

  const tasksCompleted = tasks.filter(t => {
    if (t.status !== 'done' || !t.completed_at) return false;
    const day = ymdFromDatetime(t.completed_at);
    return day != null && isYmdInRange(day, startYmd, endYmd);
  }).length;

  const tasksCreated = tasks.filter(t => {
    const day = ymdFromDatetime(t.created_at);
    return day != null && isYmdInRange(day, startYmd, endYmd);
  }).length;

  const habitCheckInTotal = habitCheckIns
    .filter(
      c =>
        activeHabitIds.has(c.habit_id) &&
        (c.count ?? 0) >= 1 &&
        isYmdInRange(c.record_date, startYmd, endYmd),
    )
    .reduce((sum, c) => sum + Number(c.count ?? 0), 0);

  const savingsWeekTotal = deposits
    .filter(d => {
      if (!activePlanIds.has(d.savings_plan_id)) return false;
      const day = ymdFromDatetime(d.created_at);
      return day != null && isYmdInRange(day, startYmd, endYmd);
    })
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  const financeIncome = transactions
    .filter(t => {
      if (t.transaction_type !== 'income') return false;
      const day = ymdFromDatetime(t.happened_at);
      return day != null && isYmdInRange(day, startYmd, endYmd);
    })
    .reduce((sum, t) => sum + Math.abs(Number(t.amount ?? 0)), 0);

  const financeExpense = transactions
    .filter(t => {
      if (t.transaction_type !== 'expense') return false;
      const day = ymdFromDatetime(t.happened_at);
      return day != null && isYmdInRange(day, startYmd, endYmd);
    })
    .reduce((sum, t) => sum + Math.abs(Number(t.amount ?? 0)), 0);

  const wishUpdates = wishes.filter(w => {
    const day = ymdFromDatetime(w.updated_at);
    return day != null && isYmdInRange(day, startYmd, endYmd);
  }).length;

  const rangeDisplay = formatRangeChinese(start, end);
  const weekTitle =
    range === 'rolling-7' ? `近七天复盘 · ${rangeDisplay}` : `本周复盘 · ${rangeDisplay}`;

  return {
    rangeKind: range,
    weekStartYmd: startYmd,
    weekEndYmd: endYmd,
    rangeDisplay,
    weekTitle,
    tasksCompleted,
    tasksCreated,
    habitCheckInTotal,
    savingsWeekTotal: Math.round(savingsWeekTotal),
    financeIncome: Math.round(financeIncome),
    financeExpense: Math.round(financeExpense),
    wishUpdates,
  };
}

export function buildWeeklyReviewNarrative(m: WeeklyReviewMetrics): string {
  const sentences: string[] = [];
  const span = m.rangeKind === 'rolling-7' ? '这七天' : '本周';
  const spanSavings = m.rangeKind === 'rolling-7' ? '近七天' : '本周';

  if (m.tasksCompleted > 0) {
    sentences.push(`${span}完成了 ${m.tasksCompleted} 项任务${m.tasksCreated > 0 ? `，并新建了 ${m.tasksCreated} 项` : ''}。`);
  } else if (m.tasksCreated > 0) {
    sentences.push(`${span}新建了 ${m.tasksCreated} 项任务，完成清单还空着，下周可以挑一件先收尾。`);
  }

  if (m.habitCheckInTotal > 0) {
    sentences.push(`习惯打卡合计 ${m.habitCheckInTotal} 次，节奏不错。`);
  }

  if (m.savingsWeekTotal > 0) {
    sentences.push(`存钱计划${spanSavings}入账 ¥${m.savingsWeekTotal.toLocaleString('zh-CN')}。`);
  }

  if (m.financeExpense > 0 || m.financeIncome > 0) {
    sentences.push(
      `记账流水：收入约 ¥${m.financeIncome.toLocaleString('zh-CN')}，支出约 ¥${m.financeExpense.toLocaleString('zh-CN')}。`,
    );
  }

  if (m.wishUpdates > 0) {
    sentences.push(`心愿单有 ${m.wishUpdates} 条更新，愿望也在被认真对待。`);
  }

  if (sentences.length === 0) {
    return `${span}还没有太多数据记录。试着完成一件小事、打一记习惯卡或记一笔账，下次复盘会更丰富。`;
  }

  return sentences.join('');
}
