import { ymdFromAuditDatetime } from '@/lib/api-mysql-datetime';
import { getDatabase } from '@/lib/database.native';
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import { getFinanceTransactionCategoryLabel } from '@/lib/repositories/finance/finance-transaction-extra';
import { getFinanceFlowCategories, getFinanceTransactionsByYmd } from '@/lib/repositories/finance/finance';
import { getResolvedGlobalIntakeTargets } from '@/lib/global-intake-targets';
import { getHealthRecordsForUserOnDate } from '@/lib/repositories/health/health';
import { listWeightLogsBetween } from '@/lib/repositories/health/weight-log';
import { getHabits } from '@/lib/repositories/habits/habit';
import {
  isHabitDayDisplayCompleted,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { addDaysToYmd } from '@/lib/date';
import {
  BUILTIN_REVIEW_COLUMN_IDS,
} from '@/lib/repositories/insights/review-template-defaults';
import type { ReviewTemplateScope } from '@/lib/repositories/insights/review-template.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { standaloneTodoPassesStandaloneListFilter } from '@/lib/standalone-todo-visibility';
import { resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';

/** 复盘一键写入 / 周月汇总排版规范（文本框纯文本，日·周·月共用）
 *
 * 统一约定：
 * - 区块标题用【】，块与块之间空一行
 * - 列表项以「· 」开头；完成/未完成分小节，标题带数量
 * - 健康：仅摄入汇总（+ 体重），不写入逐条记录与 AI 点评
 * - 任务：青蛙任务 / 待办 / 小习惯 分开，并列出未完成
 * - 财务：周期汇总 + 流水
 */

export type ReviewFactsScope = ReviewTemplateScope;

export type ReviewDayFactItem = {
  kind: 'frog' | 'todo' | 'habit';
  id: string;
  title: string;
  done: boolean;
  /** 习惯当日打卡次数（>1 时展示 ×N） */
  count?: number;
  /** 周/月：周期内应出现天数 */
  scheduledDays?: number;
  /** 周/月：周期内已打卡/已完成天数 */
  doneDays?: number;
};

/** @deprecated 兼容旧预览；优先用 frogs / todos / habits */
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
  /** 当日青蛙指派任务 */
  frogs: ReviewDayFactItem[];
  /** 当日独立待办 */
  todos: ReviewDayFactItem[];
  /** 当日应打卡的小习惯（含未打卡） */
  habits: ReviewDayFactItem[];
  /**
   * 兼容旧 UI：青蛙 + 待办（标题可含状态前缀）
   * @deprecated 请用 frogs / todos
   */
  tasks: ReviewDayFactItem[];
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
    /** 仅供内部汇总热量；一键写入不再输出逐条 */
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
    frogs: [],
    todos: [],
    habits: [],
    tasks: [],
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

function txnTypeLabel(type: string): string {
  if (type === 'income') return '收入';
  if (type === 'expense') return '支出';
  if (type === 'transfer') return '转账';
  return type || '流水';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isTaskDone(status: string): boolean {
  return status === 'done';
}

function pushUnique(
  list: ReviewDayFactItem[],
  seen: Set<string>,
  item: ReviewDayFactItem,
): void {
  if (seen.has(item.id)) return;
  const t = item.title.trim();
  if (!t) return;
  seen.add(item.id);
  list.push({ ...item, title: t });
}

function itemDisplayTitle(item: ReviewDayFactItem, scope: ReviewFactsScope): string {
  if (item.kind === 'habit' && scope !== 'daily' && item.scheduledDays != null && item.doneDays != null) {
    return `${item.title}（${item.doneDays}/${item.scheduledDays}天）`;
  }
  const count = item.count != null && item.count > 1 ? ` ×${item.count}` : '';
  return `${item.title}${count}`;
}

function formatDoneSection(
  title: string,
  items: ReviewDayFactItem[],
  labelDone: string,
  labelTodo: string,
  scope: ReviewFactsScope = 'daily',
): string[] {
  const done = items.filter(i => i.done);
  const pending = items.filter(i => !i.done);
  const lines: string[] = [`【${title}】`];
  lines.push(`${labelDone}（${done.length}）`);
  if (done.length === 0) {
    lines.push('· （无）');
  } else {
    for (const i of done) lines.push(`· ${itemDisplayTitle(i, scope)}`);
  }
  lines.push(`${labelTodo}（${pending.length}）`);
  if (pending.length === 0) {
    lines.push('· （无）');
  } else {
    for (const i of pending) lines.push(`· ${itemDisplayTitle(i, scope)}`);
  }
  return lines;
}

function scopeIntakeTitle(scope: ReviewFactsScope): string {
  if (scope === 'weekly') return '本周摄入汇总';
  if (scope === 'monthly') return '本月摄入汇总';
  return '摄入汇总';
}

function scopeFinanceTitle(scope: ReviewFactsScope): string {
  if (scope === 'weekly') return '本周汇总';
  if (scope === 'monthly') return '本月汇总';
  return '当日汇总';
}

function scopeEmptyIntake(scope: ReviewFactsScope): string {
  if (scope === 'weekly') return '本周暂无摄入数据';
  if (scope === 'monthly') return '本月暂无摄入数据';
  return '今日暂无摄入数据';
}

function listYmdsInclusive(startYmd: string, endYmd: string): string[] {
  const start = startYmd.trim();
  const end = endYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return [];
  }
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < 62; i++) {
    out.push(cur);
    if (cur >= end) break;
    cur = addDaysToYmd(cur, 1);
  }
  return out;
}

/** 合并多日事实（周/月结构化排版用） */
export function mergeReviewDayFacts(parts: ReviewDayFacts[]): ReviewDayFacts {
  const out = emptyFacts();
  const frogMap = new Map<string, ReviewDayFactItem>();
  const todoMap = new Map<string, ReviewDayFactItem>();
  const habitMap = new Map<string, ReviewDayFactItem>();
  const txnSeen = new Set<string>();

  for (const part of parts) {
    out.health.hydration += part.health.hydration;
    out.health.protein += part.health.protein;
    out.health.carbohydrate += part.health.carbohydrate;
    out.health.calories += part.health.calories;
    if (part.health.targetHydration > 0) out.health.targetHydration = part.health.targetHydration;
    if (part.health.targetProtein > 0) out.health.targetProtein = part.health.targetProtein;
    if (part.health.targetCarbohydrate > 0) out.health.targetCarbohydrate = part.health.targetCarbohydrate;
    if (part.health.targetCalories > 0) out.health.targetCalories = part.health.targetCalories;
    if (part.health.weightKg != null) out.health.weightKg = part.health.weightKg;
    // records 不并入输出；仅保留聚合热量

    for (const f of part.frogs) {
      const prev = frogMap.get(f.id);
      if (!prev) {
        frogMap.set(f.id, {
          ...f,
          scheduledDays: 1,
          doneDays: f.done ? 1 : 0,
        });
      } else {
        prev.scheduledDays = (prev.scheduledDays ?? 1) + 1;
        prev.doneDays = (prev.doneDays ?? 0) + (f.done ? 1 : 0);
        prev.done = prev.done || f.done;
      }
    }
    for (const t of part.todos) {
      const prev = todoMap.get(t.id);
      if (!prev) {
        todoMap.set(t.id, {
          ...t,
          scheduledDays: 1,
          doneDays: t.done ? 1 : 0,
        });
      } else {
        prev.scheduledDays = (prev.scheduledDays ?? 1) + 1;
        prev.doneDays = (prev.doneDays ?? 0) + (t.done ? 1 : 0);
        prev.done = prev.done || t.done;
      }
    }
    for (const h of part.habits) {
      const prev = habitMap.get(h.id);
      if (!prev) {
        habitMap.set(h.id, {
          ...h,
          scheduledDays: 1,
          doneDays: h.done ? 1 : 0,
          count: h.count ?? (h.done ? 1 : 0),
        });
      } else {
        prev.scheduledDays = (prev.scheduledDays ?? 1) + 1;
        prev.doneDays = (prev.doneDays ?? 0) + (h.done ? 1 : 0);
        prev.count = (prev.count ?? 0) + (h.count ?? 0);
        prev.done = (prev.doneDays ?? 0) > 0;
      }
    }

    out.finance.income += part.finance.income;
    out.finance.expense += part.finance.expense;
    for (const txn of part.finance.txns) {
      if (txnSeen.has(txn.id)) continue;
      txnSeen.add(txn.id);
      out.finance.txns.push(txn);
    }
  }

  out.finance.net = out.finance.income - out.finance.expense;
  out.frogs = [...frogMap.values()];
  out.todos = [...todoMap.values()];
  out.habits = [...habitMap.values()];
  out.tasks = [...out.frogs, ...out.todos];
  return out;
}

/** 加载闭区间内多日事实并合并（跳过 skipYmds，如周复盘日） */
export async function loadReviewPeriodFacts(
  startYmd: string,
  endYmd: string,
  opts?: { skipYmds?: ReadonlySet<string> },
): Promise<ReviewDayFacts> {
  const skip = opts?.skipYmds;
  const days = listYmdsInclusive(startYmd, endYmd).filter(d => !skip?.has(d));
  if (days.length === 0) return emptyFacts();
  if (days.length === 1) return loadReviewDayFacts(days[0]!);
  const parts = await Promise.all(days.map(d => loadReviewDayFacts(d)));
  return mergeReviewDayFacts(parts);
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
           WHERE record_date = ? AND sync_status != 'pending_delete'`,
          [day],
        )) ?? []
      );
    })(),
    getHealthRecordsForUserOnDate(userId, day).catch(() => []),
    listWeightLogsBetween(day, day).catch(() => []),
    getFinanceTransactionsByYmd(day, { cacheOnly: true }).catch(() => []),
    getFinanceFlowCategories({ cacheOnly: true }).catch(() => []),
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

  const frogs: ReviewDayFactItem[] = [];
  const todos: ReviewDayFactItem[] = [];
  const seenFrog = new Set<string>();
  const seenTodo = new Set<string>();

  for (const t of tasks) {
    if (!isFrogAssignedOn(t.extra_data, day)) continue;
    pushUnique(frogs, seenFrog, {
      kind: 'frog',
      id: String(t.id),
      title: t.title ?? '',
      done: isTaskDone(t.status),
    });
  }

  for (const t of tasks) {
    if (!isStandaloneTodoTask(t)) continue;
    if (!standaloneTodoPassesStandaloneListFilter(t, boundary, day)) continue;
    pushUnique(todos, seenTodo, {
      kind: 'todo',
      id: String(t.id),
      title: t.title ?? '',
      done: isTaskDone(t.status),
    });
  }

  // 当日完成、但未进青蛙/待办列表的项目子任务，归入任务已完成
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completed_at) continue;
    const doneDay = ymdFromAuditDatetime(t.completed_at);
    if (doneDay !== day) continue;
    if (seenFrog.has(String(t.id)) || seenTodo.has(String(t.id))) continue;
    if (isStandaloneTodoTask(t)) continue;
    pushUnique(frogs, seenFrog, {
      kind: 'frog',
      id: String(t.id),
      title: t.title ?? '',
      done: true,
    });
  }

  const checkInByHabit = new Map<string, number>();
  for (const row of checkIns) {
    checkInByHabit.set(row.habit_id, Math.max(0, Math.floor(Number(row.count ?? 0))));
  }

  const habitItems: ReviewDayFactItem[] = [];
  for (const h of habits) {
    if (!isHabitScheduledOnLogicalYmd(h.extra_data, day)) continue;
    const kind = parseHabitKind(h.extra_data);
    const hasDayRecord = checkInByHabit.has(h.id);
    const todayCount = checkInByHabit.get(h.id) ?? 0;
    const dailyGoal = parseHabitDailyGoal(h.extra_data, kind);
    const done = isHabitDayDisplayCompleted({
      kind,
      todayCount,
      dailyGoal,
      hasDayRecord,
      ymd: day,
      logicalTodayYmd: day,
    });
    habitItems.push({
      kind: 'habit',
      id: h.id,
      title: (h.name ?? '').trim() || '未命名习惯',
      done,
      count: todayCount > 0 ? todayCount : undefined,
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

  const compatTasks: ReviewDayFactItem[] = [
    ...frogs.map(f => ({
      ...f,
      title: f.done ? f.title : `[未完成] ${f.title}`,
    })),
    ...todos.map(t => ({
      ...t,
      title: t.done ? t.title : `[未完成] ${t.title}`,
    })),
  ];

  return {
    frogs,
    todos,
    habits: habitItems,
    tasks: compatTasks,
    health,
    finance: {
      income,
      expense,
      net: income - expense,
      txns: financeTxns,
    },
  };
}

/** 健康栏：仅摄入汇总 + 体重，不含逐条记录 / AI 点评（日/周/月同构） */
export function formatHealthFactsText(
  facts: ReviewDayFacts,
  scope: ReviewFactsScope = 'daily',
): string {
  const h = facts.health;
  const lines: string[] = [`【${scopeIntakeTitle(scope)}】`];
  const hasIntake = h.hydration > 0 || h.protein > 0 || h.carbohydrate > 0 || h.calories > 0;
  if (hasIntake) {
    if (scope === 'daily') {
      lines.push(
        `水分 ${round1(h.hydration)}/${h.targetHydration}ml · 蛋白 ${round1(h.protein)}/${h.targetProtein}g · 碳水 ${round1(h.carbohydrate)}/${h.targetCarbohydrate}g · 热量 ${Math.round(h.calories)}/${h.targetCalories}kcal`,
      );
    } else {
      lines.push(
        `水分 ${round1(h.hydration)}ml · 蛋白 ${round1(h.protein)}g · 碳水 ${round1(h.carbohydrate)}g · 热量 ${Math.round(h.calories)}kcal`,
      );
    }
  } else {
    lines.push(scopeEmptyIntake(scope));
  }
  if (h.weightKg != null) {
    lines.push(`体重：${h.weightKg}kg`);
  }
  return lines.join('\n').trim();
}

/** 任务栏：青蛙 / 待办 / 小习惯，分已完成与未完成（日/周/月同构） */
export function formatTasksFactsText(
  facts: ReviewDayFacts,
  scope: ReviewFactsScope = 'daily',
): string {
  const habitDoneLabel = scope === 'daily' ? '已打卡' : '有打卡';
  const habitTodoLabel = scope === 'daily' ? '未打卡' : '零打卡';
  const blocks = [
    formatDoneSection('任务（青蛙）', facts.frogs, '已完成', '未完成', scope),
    formatDoneSection('待办', facts.todos, '已完成', '未完成', scope),
    formatDoneSection('小习惯', facts.habits, habitDoneLabel, habitTodoLabel, scope),
  ];
  return blocks.map(b => b.join('\n')).join('\n\n').trim();
}

/** 财务栏：周期汇总 + 流水（日/周/月同构） */
export function formatFinanceFactsText(
  facts: ReviewDayFacts,
  scope: ReviewFactsScope = 'daily',
): string {
  const f = facts.finance;
  const lines: string[] = ['【财务】'];
  lines.push(
    `${scopeFinanceTitle(scope)}：收入 ${formatMoney(f.income)} · 支出 ${formatMoney(f.expense)} · 净额 ${formatMoney(f.net)}`,
  );
  if (f.txns.length > 0) {
    lines.push('');
    lines.push('流水：');
    for (const t of f.txns) {
      const cat = t.category ? ` ${t.category}` : '';
      const note = t.note ? ` · ${t.note}` : '';
      lines.push(`· ${t.typeLabel}${cat} ${t.name} ${formatMoney(t.amount)}${note}`);
    }
  } else {
    lines.push('流水：· （无）');
  }
  return lines.join('\n').trim();
}

function hasHealthFacts(facts: ReviewDayFacts): boolean {
  const h = facts.health;
  return (
    h.weightKg != null ||
    h.hydration > 0 ||
    h.protein > 0 ||
    h.carbohydrate > 0 ||
    h.calories > 0 ||
    h.records.length > 0
  );
}

function hasTaskFacts(facts: ReviewDayFacts): boolean {
  return facts.frogs.length > 0 || facts.todos.length > 0 || facts.habits.length > 0;
}

function hasFinanceFacts(facts: ReviewDayFacts): boolean {
  const f = facts.finance;
  return f.txns.length > 0 || f.income > 0 || f.expense > 0;
}

/**
 * 写入内置三栏（健康 / 任务 / 财务）：日/周/月共用排版；
 * 只写确有数据的栏，无数据的栏不进 patch。
 */
export function builtinReviewFactsFieldPatch(
  scope: ReviewFactsScope,
  facts: ReviewDayFacts,
): ReviewFieldValues {
  const ids = BUILTIN_REVIEW_COLUMN_IDS[scope];
  const patch: ReviewFieldValues = {};
  if (hasHealthFacts(facts)) {
    patch[ids.health] = formatHealthFactsText(facts, scope);
  }
  if (hasTaskFacts(facts)) {
    patch[ids.tasks] = formatTasksFactsText(facts, scope);
  }
  if (hasFinanceFacts(facts)) {
    patch[ids.finance] = formatFinanceFactsText(facts, scope);
  }
  return patch;
}

/** @deprecated 使用 builtinReviewFactsFieldPatch('daily', facts) */
export function builtinDailyReviewFieldPatch(facts: ReviewDayFacts): ReviewFieldValues {
  return builtinReviewFactsFieldPatch('daily', facts);
}

/** 单个内置栏目对应的周期事实文本；非内置栏目或无数据返回 null */
export function reviewFactsTextForColumn(
  facts: ReviewDayFacts,
  scope: ReviewFactsScope,
  columnId: string,
): string | null {
  const ids = BUILTIN_REVIEW_COLUMN_IDS[scope];
  if (columnId === ids.health) {
    return hasHealthFacts(facts) ? formatHealthFactsText(facts, scope) : null;
  }
  if (columnId === ids.tasks) {
    return hasTaskFacts(facts) ? formatTasksFactsText(facts, scope) : null;
  }
  if (columnId === ids.finance) {
    return hasFinanceFacts(facts) ? formatFinanceFactsText(facts, scope) : null;
  }
  return null;
}

/** @deprecated 使用 reviewFactsTextForColumn(facts, 'daily', columnId) */
export function dailyReviewFactsTextForColumn(
  facts: ReviewDayFacts,
  columnId: string,
): string | null {
  return reviewFactsTextForColumn(facts, 'daily', columnId);
}

/** 生成可插入复盘正文的素材文本（兼容旧「写入当前栏目」） */
export function formatReviewDayFactsInsertText(
  facts: ReviewDayFacts,
  scope: ReviewFactsScope = 'daily',
): string {
  const out: string[] = [];
  if (hasHealthFacts(facts)) out.push(formatHealthFactsText(facts, scope));
  if (hasTaskFacts(facts)) out.push(formatTasksFactsText(facts, scope));
  if (hasFinanceFacts(facts)) out.push(formatFinanceFactsText(facts, scope));
  return out.join('\n\n').trim();
}

export function reviewDayFactsIsEmpty(facts: ReviewDayFacts): boolean {
  return !hasHealthFacts(facts) && !hasTaskFacts(facts) && !hasFinanceFacts(facts);
}

export function reviewDayFactsPreviewLines(facts: ReviewDayFacts): string[] {
  const out: string[] = [];
  const h = facts.health;
  if (h.calories > 0 || h.hydration > 0 || h.protein > 0) {
    out.push(`健康 · 热量 ${Math.round(h.calories)}kcal`);
  } else if (h.weightKg != null) {
    out.push(`健康 · 体重 ${h.weightKg}kg`);
  }
  const frogDone = facts.frogs.filter(f => f.done).length;
  const frogPending = facts.frogs.length - frogDone;
  if (facts.frogs.length > 0) {
    out.push(`任务 · 完成 ${frogDone} · 未完成 ${frogPending}`);
  }
  const todoDone = facts.todos.filter(t => t.done).length;
  const todoPending = facts.todos.length - todoDone;
  if (facts.todos.length > 0) {
    out.push(`待办 · 完成 ${todoDone} · 未完成 ${todoPending}`);
  }
  const habitDone = facts.habits.filter(hb => hb.done).length;
  const habitPending = facts.habits.length - habitDone;
  if (facts.habits.length > 0) {
    out.push(`习惯 · 已打卡 ${habitDone} · 未打卡 ${habitPending}`);
  }
  if (facts.finance.txns.length > 0) {
    out.push(
      `财务 · 收入 ${formatMoney(facts.finance.income)} · 支出 ${formatMoney(facts.finance.expense)}`,
    );
  }
  return out.slice(0, PREVIEW_MAX);
}
