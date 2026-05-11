import { getDatabase } from '../../database.native';

export type WeeklyReviewMetrics = {
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

function formatRangeChinese(start: Date, end: Date): string {
  return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

export async function fetchWeeklyReviewMetrics(anchor: Date = new Date()): Promise<WeeklyReviewMetrics> {
  const { startYmd, endYmd, start, end } = getCurrentWeekRange(anchor);
  const db = await getDatabase();

  const [
    tasksDoneRow,
    tasksNewRow,
    habitRow,
    savingsRow,
    incomeRow,
    expenseRow,
    wishRow,
  ] = await Promise.all([
    db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(1) AS c FROM tasks
        WHERE deleted_at IS NULL AND status = 'done' AND completed_at IS NOT NULL
          AND date(completed_at) >= date(?) AND date(completed_at) <= date(?)`,
      [startYmd, endYmd],
    ),
    db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(1) AS c FROM tasks
        WHERE deleted_at IS NULL
          AND date(created_at) >= date(?) AND date(created_at) <= date(?)`,
      [startYmd, endYmd],
    ),
    db.getFirstAsync<{ s: number }>(
      `SELECT COALESCE(SUM(hci.count), 0) AS s
         FROM habit_check_ins hci
         INNER JOIN habits h ON h.id = hci.habit_id AND h.deleted_at IS NULL
        WHERE hci.deleted_at IS NULL AND hci.count >= 1
          AND hci.record_date >= ? AND hci.record_date <= ?`,
      [startYmd, endYmd],
    ),
    db.getFirstAsync<{ s: number }>(
      `SELECT COALESCE(SUM(d.amount), 0) AS s
         FROM savings_plan_deposits d
         INNER JOIN savings_plans p ON p.id = d.savings_plan_id AND p.deleted_at IS NULL
        WHERE d.deleted_at IS NULL
          AND date(d.created_at) >= date(?) AND date(d.created_at) <= date(?)`,
      [startYmd, endYmd],
    ),
    db.getFirstAsync<{ s: number }>(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM finance_transactions
        WHERE deleted_at IS NULL AND transaction_type = 'income'
          AND date(happened_at) >= date(?) AND date(happened_at) <= date(?)`,
      [startYmd, endYmd],
    ),
    db.getFirstAsync<{ s: number }>(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM finance_transactions
        WHERE deleted_at IS NULL AND transaction_type = 'expense'
          AND date(happened_at) >= date(?) AND date(happened_at) <= date(?)`,
      [startYmd, endYmd],
    ),
    db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(1) AS c FROM wish_items
        WHERE deleted_at IS NULL
          AND date(updated_at) >= date(?) AND date(updated_at) <= date(?)`,
      [startYmd, endYmd],
    ),
  ]);

  return {
    weekStartYmd: startYmd,
    weekEndYmd: endYmd,
    rangeDisplay: formatRangeChinese(start, end),
    weekTitle: `本周复盘 · ${formatRangeChinese(start, end)}`,
    tasksCompleted: Number(tasksDoneRow?.c ?? 0),
    tasksCreated: Number(tasksNewRow?.c ?? 0),
    habitCheckInTotal: Number(habitRow?.s ?? 0),
    savingsWeekTotal: Math.round(Number(savingsRow?.s ?? 0)),
    financeIncome: Math.round(Number(incomeRow?.s ?? 0)),
    financeExpense: Math.round(Number(expenseRow?.s ?? 0)),
    wishUpdates: Number(wishRow?.c ?? 0),
  };
}

export function buildWeeklyReviewNarrative(m: WeeklyReviewMetrics): string {
  const sentences: string[] = [];

  if (m.tasksCompleted > 0) {
    sentences.push(`本周完成了 ${m.tasksCompleted} 项任务${m.tasksCreated > 0 ? `，并新建了 ${m.tasksCreated} 项` : ''}。`);
  } else if (m.tasksCreated > 0) {
    sentences.push(`本周新建了 ${m.tasksCreated} 项任务，完成清单还空着，下周可以挑一件先收尾。`);
  }

  if (m.habitCheckInTotal > 0) {
    sentences.push(`习惯打卡合计 ${m.habitCheckInTotal} 次，节奏不错。`);
  }

  if (m.savingsWeekTotal > 0) {
    sentences.push(`存钱计划本周入账 ¥${m.savingsWeekTotal.toLocaleString('zh-CN')}。`);
  }

  if (m.financeExpense > 0 || m.financeIncome > 0) {
    sentences.push(
      `记账流水：收入约 ¥${m.financeIncome.toLocaleString('zh-CN')}，支出约 ¥${m.financeExpense.toLocaleString('zh-CN')}。`,
    );
  }

  if (m.wishUpdates > 0) {
    sentences.push(`欲望清单有 ${m.wishUpdates} 条更新，愿望也在被认真对待。`);
  }

  if (sentences.length === 0) {
    return '本周还没有太多数据记录。试着完成一件小事、打一记习惯卡或记一笔账，下周复盘会更丰富。';
  }

  return sentences.join('');
}
