import { ymdFromAuditDatetime } from '@/lib/api-mysql-datetime';
import { getDatabase } from '@/lib/database.native';
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { getFinanceTransactionCategoryLabel } from '@/lib/repositories/finance/finance-transaction-extra';
import { getFinanceFlowCategories, getFinanceTransactionsByYmd } from '@/lib/repositories/finance/finance';
import { getResolvedGlobalIntakeTargets } from '@/lib/global-intake-targets';
import { getHealthRecordsForUserOnDate } from '@/lib/repositories/health/health';
import { listWeightLogsBetween } from '@/lib/repositories/health/weight-log';
import { getHabits } from '@/lib/repositories/habits/habit';
import {
  BUILTIN_DAILY_REVIEW_COLUMN_IDS,
} from '@/lib/repositories/insights/review-template-defaults';
import { getTasks } from '@/lib/repositories/tasks/task';
import { standaloneTodoPassesStandaloneListFilter } from '@/lib/standalone-todo-visibility';
import { resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';

export type ReviewDayFactItem = {
  kind: 'task' | 'habit';
  id: string;
  title: string;
};

export type ReviewDayHealthRecord = {
  id: string;
  title: string;
  calories: number;
  comment: string;
};

export type ReviewDayFinanceTxn = {
  id: string;
  name: string;
  typeLabel: string;
  amount: number;
  category: string;
  note: string;
};

export type ReviewDayFacts = {
  tasks: ReviewDayFactItem[];
  habits: ReviewDayFactItem[];
  health: {
    hydration: number;
    protein: number;
    carbohydrate: number;
    calories: number;
    targetHydration: number;
    targetProtein: number;
    targetCarbohydrate: number;
    targetCalories: number;
    weightKg: number | null;
    records: ReviewDayHealthRecord[];
  };
  finance: {
    income: number;
    expense: number;
    net: number;
    txns: ReviewDayFinanceTxn[];
  };
};

const PREVIEW_MAX = 8;

function emptyHealth(): ReviewDayFacts['health'] {
  const t = getResolvedGlobalIntakeTargets();
  return {
    hydration: 0,
    protein: 0,
    carbohydrate: 0,
    calories: 0,
    targetHydration: t.hydrationMl,
    targetProtein: t.proteinG,
    targetCarbohydrate: t.carbohydrateG,
    targetCalories: t.caloriesKcal,
    weightKg: null,
    records: [],
  };
}

function emptyFacts(): ReviewDayFacts {
  return {
    tasks: [],
    habits: [],
    health: emptyHealth(),
    finance: { income: 0, expense: 0, net: 0, txns: [] },
  };
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 100) / 100;
  const body = Number.isInteger(rounded) ? String(Math.round(rounded)) : rounded.toFixed(2);
  return `¥${body}`;
}

function taskStatusLabel(status: string): string {
  if (status === 'done') return '已完成';
  if (status === 'doing') return '进行中';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  if (status === 'shelved') return '搁置';
  return '待办';
}

function txnTypeLabel(type: string): string {
  if (type === 'income') return '收入';
  if (type === 'expense') return '支出';
  if (type === 'transfer') return '转账';
  return type || '流水';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 汇总某日健康 / 任务 / 财务，供复盘「今日事实」与一键写入 */
export async function loadReviewDayFacts(ymd: string): Promise<ReviewDayFacts> {
  const day = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return emptyFacts();
  }

  const user = await getDefaultUser().catch(() => null);
  const userId = user?.id?.trim() || 'default';
  const boundary = await resolveDayBoundaryForPage('tasks');

  const [tasks, habits, checkIns, healthRecords, weightRows, txns, categories] = await Promise.all([
    getTasks().catch(() => []),
    getHabits().catch(() => []),
    (async () => {
      const db = await getDatabase();
      if (!db) return [] as { habit_id: string; count: number }[];
      return (
        (await db.getAllAsync<{ habit_id: string; count: number }>(
          `SELECT habit_id, count FROM habit_check_ins
           WHERE record_date = ? AND sync_status != 'pending_delete' AND count >= 1`,
          [day],
        )) ?? []
      );
    })(),
    getHealthRecordsForUserOnDate(userId, day).catch(() => []),
    listWeightLogsBetween(day, day).catch(() => []),
    getFinanceTransactionsByYmd(day, { localOnly: true }).catch(() => []),
    getFinanceFlowCategories({ localOnly: true }).catch(() => []),
  ]);

  const health = emptyHealth();
  for (const r of healthRecords) {
    health.hydration += Number(r.hydration ?? 0);
    health.protein += Number(r.protein ?? 0);
    health.carbohydrate += Number(r.carbohydrate ?? 0);
    health.calories += Number(r.calories ?? 0);
    if (Number(r.target_hydration) > 0) health.targetHydration = Number(r.target_hydration);
    if (Number(r.target_protein) > 0) health.targetProtein = Number(r.target_protein);
    if (Number(r.target_carbohydrate) > 0) health.targetCarbohydrate = Number(r.target_carbohydrate);
    if (Number(r.target_calories) > 0) health.targetCalories = Number(r.target_calories);
    const title = (r.intake_display_title ?? r.quick_add_key ?? '').trim() || '摄入记录';
    health.records.push({
      id: String(r.id),
      title,
      calories: Number(r.calories ?? 0),
      comment: (r.intake_ai_comment ?? '').trim(),
    });
  }
  const weight = weightRows[0]?.weight_kg;
  health.weightKg = typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : null;

  const seenTask = new Set<string>();
  const taskItems: ReviewDayFactItem[] = [];
  const pushTask = (id: string, title: string, status: string) => {
    if (seenTask.has(id)) return;
    const t = title.trim();
    if (!t) return;
    seenTask.add(id);
    taskItems.push({ kind: 'task', id, title: `[${taskStatusLabel(status)}] ${t}` });
  };

  for (const t of tasks) {
    if (!isFrogAssignedOn(t.extra_data, day)) continue;
    pushTask(String(t.id), t.title ?? '', t.status);
  }
  for (const t of tasks) {
    if (t.project_id || t.parent_task_id) continue;
    if (!standaloneTodoPassesStandaloneListFilter(t, boundary, day)) continue;
    pushTask(String(t.id), t.title ?? '', t.status);
  }
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completed_at) continue;
    const doneDay = ymdFromAuditDatetime(t.completed_at);
    if (doneDay !== day) continue;
    pushTask(String(t.id), t.title ?? '', t.status);
  }

  const habitTitleById = new Map(habits.map(h => [h.id, (h.name ?? '').trim() || '未命名习惯']));
  const habitItems: ReviewDayFactItem[] = [];
  for (const row of checkIns) {
    const title = habitTitleById.get(row.habit_id);
    if (!title) continue;
    const count = Number(row.count ?? 0);
    habitItems.push({
      kind: 'habit',
      id: row.habit_id,
      title: count > 1 ? `${title} ×${count}` : title,
    });
  }

  const catMap = new Map(categories.map(c => [c.id, (c.name ?? '').trim()]));
  let income = 0;
  let expense = 0;
  const financeTxns: ReviewDayFinanceTxn[] = [];
  for (const t of txns) {
    const type = (t.transaction_type ?? '').trim();
    const amount = Number(t.amount ?? 0);
    if (type === 'income') income += Math.abs(amount);
    else if (type === 'expense') expense += Math.abs(amount);
    financeTxns.push({
      id: String(t.id),
      name: (t.name ?? '').trim() || '未命名',
      typeLabel: txnTypeLabel(type),
      amount,
      category: getFinanceTransactionCategoryLabel(t, catMap) ?? '',
      note: (t.note ?? '').trim(),
    });
  }

  return {
    tasks: taskItems,
    habits: habitItems,
    health,
    finance: {
      income,
      expense,
      net: income - expense,
      txns: financeTxns,
    },
  };
}

export function formatHealthFactsText(facts: ReviewDayFacts): string {
  const h = facts.health;
  const lines: string[] = [];
  const hasIntake = h.hydration > 0 || h.protein > 0 || h.carbohydrate > 0 || h.calories > 0 || h.records.length > 0;
  if (hasIntake) {
    lines.push(
      `摄入汇总：水分 ${round1(h.hydration)}/${h.targetHydration}ml · 蛋白 ${round1(h.protein)}/${h.targetProtein}g · 碳水 ${round1(h.carbohydrate)}/${h.targetCarbohydrate}g · 热量 ${Math.round(h.calories)}/${h.targetCalories}kcal`,
    );
  }
  if (h.weightKg != null) {
    lines.push(`体重：${h.weightKg}kg`);
  }
  if (h.records.length > 0) {
    if (lines.length) lines.push('');
    lines.push('记录：');
    for (const r of h.records) {
      const cal = r.calories > 0 ? ` ${Math.round(r.calories)}kcal` : '';
      const comment = r.comment ? `（${r.comment}）` : '';
      lines.push(`· ${r.title}${cal}${comment}`);
    }
  }
  return lines.join('\n').trim() || '今日暂无健康记录';
}

export function formatTasksFactsText(facts: ReviewDayFacts): string {
  const lines: string[] = [];
  if (facts.tasks.length > 0) {
    lines.push('任务：');
    for (const t of facts.tasks) lines.push(`· ${t.title}`);
  }
  if (facts.habits.length > 0) {
    if (lines.length) lines.push('');
    lines.push('习惯打卡：');
    for (const h of facts.habits) lines.push(`· ${h.title}`);
  }
  return lines.join('\n').trim() || '今日暂无任务或习惯打卡';
}

export function formatFinanceFactsText(facts: ReviewDayFacts): string {
  const f = facts.finance;
  const lines: string[] = [];
  if (f.txns.length > 0 || f.income > 0 || f.expense > 0) {
    lines.push(`当日汇总：收入 ${formatMoney(f.income)} · 支出 ${formatMoney(f.expense)} · 净额 ${formatMoney(f.net)}`);
  }
  if (f.txns.length > 0) {
    lines.push('');
    lines.push('流水：');
    for (const t of f.txns) {
      const cat = t.category ? ` ${t.category}` : '';
      const note = t.note ? ` ${t.note}` : '';
      lines.push(`· ${t.typeLabel}${cat} ${t.name} ${formatMoney(t.amount)}${note}`);
    }
  }
  return lines.join('\n').trim() || '今日暂无财务流水';
}

/** 写入内置三栏（覆盖这三栏，自定义栏目不动） */
export function builtinDailyReviewFieldPatch(facts: ReviewDayFacts): ReviewFieldValues {
  return {
    [BUILTIN_DAILY_REVIEW_COLUMN_IDS.health]: formatHealthFactsText(facts),
    [BUILTIN_DAILY_REVIEW_COLUMN_IDS.tasks]: formatTasksFactsText(facts),
    [BUILTIN_DAILY_REVIEW_COLUMN_IDS.finance]: formatFinanceFactsText(facts),
  };
}

/** 生成可插入复盘正文的素材文本（兼容旧「写入当前栏目」） */
export function formatReviewDayFactsInsertText(facts: ReviewDayFacts): string {
  const parts = [formatHealthFactsText(facts), formatTasksFactsText(facts), formatFinanceFactsText(facts)].filter(
    t => t && !t.startsWith('今日暂无'),
  );
  return parts.join('\n\n').trim();
}

export function reviewDayFactsIsEmpty(facts: ReviewDayFacts): boolean {
  const h = facts.health;
  const hasHealth =
    h.records.length > 0 ||
    h.weightKg != null ||
    h.hydration > 0 ||
    h.protein > 0 ||
    h.carbohydrate > 0 ||
    h.calories > 0;
  const hasFinance = facts.finance.txns.length > 0 || facts.finance.income > 0 || facts.finance.expense > 0;
  return facts.tasks.length === 0 && facts.habits.length === 0 && !hasHealth && !hasFinance;
}

export function reviewDayFactsPreviewLines(facts: ReviewDayFacts): string[] {
  const out: string[] = [];
  const h = facts.health;
  if (h.records.length > 0 || h.calories > 0 || h.hydration > 0) {
    out.push(`健康 · 热量 ${Math.round(h.calories)}kcal · ${h.records.length} 条记录`);
  } else if (h.weightKg != null) {
    out.push(`健康 · 体重 ${h.weightKg}kg`);
  }
  for (const t of facts.tasks.slice(0, 3)) out.push(`任务 · ${t.title}`);
  for (const hb of facts.habits.slice(0, 3)) out.push(`习惯 · ${hb.title}`);
  if (facts.finance.txns.length > 0) {
    out.push(
      `财务 · 收入 ${formatMoney(facts.finance.income)} · 支出 ${formatMoney(facts.finance.expense)}`,
    );
  }
  return out.slice(0, PREVIEW_MAX);
}
