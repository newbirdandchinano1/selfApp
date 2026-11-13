import {
  computeNetWorthTotal,
  formatSignedMoneyTrunc2,
  isNetWorthAtLeast,
} from '@/lib/finance-net-worth';
import { isBreakHabitSucceeded } from '@/lib/repositories/habits/habit-break-success';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  parseBuildHabitExpectedGoal,
  parseHabitConsecutiveTargetDays,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { getProjectById } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTaskById } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import type { WishBoardRedeemConditionsInput } from '@/lib/repositories/wish-board/wish-board.types';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';

const REDEEM_CONDITIONS_KEY = 'redeem_conditions';
const NET_WORTH_CHECK_ID = 'min_net_worth';
const AVAILABLE_FROM_CHECK_ID = 'available_from';

export type WishBoardRedeemConditions = {
  /** 须全部完成（completed / archived）的项目 */
  project_ids: string[];
  /** 须全部 done 的项目任务（非独立待办） */
  task_ids: string[];
  /** 须全部 done 的独立待办 */
  todo_ids: string[];
  /**
   * 须养成/戒除「周期目标已达成」的小习惯（completedAt）；
   * 周期配额不纳入；非当日打卡。
   */
  habit_ids: string[];
  /** 当前净资产须 ≥ 该值（与资产页「当前净资产」同一公式）；null 表示不限制 */
  min_net_worth: number | null;
  /**
   * 开放兑换时间（本地墙上时钟，规范为 `YYYY-MM-DD HH:mm:00`）；
   * 到达该时刻后才可兑换；null 表示不限制。
   */
  available_from: string | null;
};

export type WishBoardRedeemConditionKind =
  | 'project'
  | 'task'
  | 'todo'
  | 'habit'
  | 'net_worth'
  | 'available_from';

export type WishBoardRedeemConditionCheck = {
  kind: WishBoardRedeemConditionKind;
  id: string;
  title: string;
  done: boolean;
  missing: boolean;
  /**
   * 子项进度（设计稿「2 / 4 · 还差 2 项子任务」）：
   * 项目=项目下有效任务完成比；任务/待办=子任务完成比；无子项或未提供 allTasks 时为 null。
   */
  progress: { done: number; total: number } | null;
  /** 小习惯类型（仅 kind=habit） */
  habit_kind?: Extract<HabitKind, 'build' | 'break'> | null;
  /** 小习惯未设周期目标，无法作为门槛 */
  ineligible?: boolean;
};

export type WishBoardRedeemEligibility = {
  ok: boolean;
  pointsOk: boolean;
  conditionsOk: boolean;
  costPoints: number;
  balance: number;
  conditions: WishBoardRedeemConditions;
  checks: WishBoardRedeemConditionCheck[];
  /** 未满足的条件；空表示条件侧通过 */
  pending: WishBoardRedeemConditionCheck[];
  /** 面向用户的简短原因（仅 ok=false 时有意义） */
  message: string | null;
};

function parseExtraObject(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData?.trim()) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function normalizeMinNetWorth(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return n;
}

/** 解析开放兑换时间为本地 `YYYY-MM-DD HH:mm:00`；无效则 null */
export function normalizeAvailableFrom(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!text) return null;

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (match) {
    const y = Number(match[1]);
    const mo = Number(match[2]);
    const d = Number(match[3]);
    const hh = match[4] != null ? Number(match[4]) : 0;
    const mm = match[5] != null ? Number(match[5]) : 0;
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(mo) ||
      !Number.isFinite(d) ||
      mo < 1 ||
      mo > 12 ||
      d < 1 ||
      d > 31 ||
      hh < 0 ||
      hh > 23 ||
      mm < 0 ||
      mm > 59
    ) {
      return null;
    }
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatAvailableFromDate(parsed);
}

export function formatAvailableFromDate(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${hh}:${mm}:00`;
}

/** 将规范/兼容字符串解析为本地 Date；无效返回 null */
export function parseAvailableFromDate(raw: string | null | undefined): Date | null {
  const normalized = normalizeAvailableFrom(raw);
  if (!normalized) return null;
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const date = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAvailableFromLabel(raw: string | null | undefined): string {
  const date = parseAvailableFromDate(raw);
  if (!date) return '未设置';
  const y = date.getFullYear();
  const mo = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}年${mo}月${d}日 ${hh}:${mm}`;
}

/** 当前本地时间是否已到达开放兑换时刻 */
export function isAvailableFromMet(
  availableFrom: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (availableFrom == null || availableFrom === '') return true;
  const date = parseAvailableFromDate(availableFrom);
  if (!date) return false;
  return now.getTime() >= date.getTime();
}

export function emptyWishBoardRedeemConditions(): WishBoardRedeemConditions {
  return {
    project_ids: [],
    task_ids: [],
    todo_ids: [],
    habit_ids: [],
    min_net_worth: null,
    available_from: null,
  };
}

export function parseWishBoardRedeemConditions(
  extraData: string | null | undefined,
): WishBoardRedeemConditions {
  const base = parseExtraObject(extraData);
  const raw = base[REDEEM_CONDITIONS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyWishBoardRedeemConditions();
  }
  const obj = raw as Record<string, unknown>;
  return {
    project_ids: normalizeIdList(obj.project_ids),
    task_ids: normalizeIdList(obj.task_ids),
    todo_ids: normalizeIdList(obj.todo_ids),
    habit_ids: normalizeIdList(obj.habit_ids),
    min_net_worth: normalizeMinNetWorth(obj.min_net_worth),
    available_from: normalizeAvailableFrom(obj.available_from),
  };
}

export function mergeWishBoardRedeemConditions(
  extraData: string | null | undefined,
  conditions: WishBoardRedeemConditions | WishBoardRedeemConditionsInput | null | undefined,
): string | null {
  const base = parseExtraObject(extraData);
  const next = conditions
    ? {
        project_ids: normalizeIdList(conditions.project_ids),
        task_ids: normalizeIdList(conditions.task_ids),
        todo_ids: normalizeIdList(conditions.todo_ids),
        habit_ids: normalizeIdList(conditions.habit_ids),
        min_net_worth: normalizeMinNetWorth(conditions.min_net_worth),
        available_from: normalizeAvailableFrom(conditions.available_from),
      }
    : emptyWishBoardRedeemConditions();

  if (
    next.project_ids.length === 0 &&
    next.task_ids.length === 0 &&
    next.todo_ids.length === 0 &&
    next.habit_ids.length === 0 &&
    next.min_net_worth == null &&
    next.available_from == null
  ) {
    delete base[REDEEM_CONDITIONS_KEY];
  } else {
    const payload: Record<string, unknown> = {
      project_ids: next.project_ids,
      task_ids: next.task_ids,
      todo_ids: next.todo_ids,
      habit_ids: next.habit_ids,
    };
    if (next.min_net_worth != null) payload.min_net_worth = next.min_net_worth;
    if (next.available_from != null) payload.available_from = next.available_from;
    base[REDEEM_CONDITIONS_KEY] = payload;
  }

  if (Object.keys(base).length === 0) return null;
  return JSON.stringify(base);
}

export function countWishBoardRedeemConditions(conditions: WishBoardRedeemConditions): number {
  return (
    conditions.project_ids.length +
    conditions.task_ids.length +
    conditions.todo_ids.length +
    conditions.habit_ids.length +
    (conditions.min_net_worth != null ? 1 : 0) +
    (conditions.available_from != null ? 1 : 0)
  );
}

/** 养成须有预期目标，戒除须有连续天数；周期配额不可绑 */
export function isHabitEligibleForWishRedeem(habit: Pick<HabitRow, 'extra_data'>): boolean {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'build') return parseBuildHabitExpectedGoal(habit.extra_data) != null;
  if (kind === 'break') return parseHabitConsecutiveTargetDays(habit.extra_data) != null;
  return false;
}

/** 养成：预期目标 completedAt；戒除：连续挑战 completedAt */
export function isHabitWishRedeemConditionMet(habit: Pick<HabitRow, 'extra_data'>): boolean {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'build') return isBuildHabitSucceeded(habit.extra_data);
  if (kind === 'break') return isBreakHabitSucceeded(habit.extra_data);
  return false;
}

export function wishHabitKindForRedeem(
  habit: Pick<HabitRow, 'extra_data'> | null | undefined,
): Extract<HabitKind, 'build' | 'break'> | null {
  if (!habit) return null;
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'build' || kind === 'break') return kind;
  return null;
}

/** 详情 / 缺口 / 列表副文案：按 kind 写清口径，禁止「完成小习惯」统称 */
export function formatWishHabitConditionMeta(check: WishBoardRedeemConditionCheck): string {
  if (check.kind !== 'habit') return '';
  if (check.missing) return '习惯已删除，请在编辑中重新绑定';
  if (check.ineligible) return '未设周期目标，无法作为兑换门槛';
  if (check.habit_kind === 'break') {
    return check.done ? '连续挑战已完成' : '连续挑战尚未完成';
  }
  return check.done ? '养成目标已达成' : '养成目标尚未达成';
}

export function formatWishHabitPickerSubtitle(habit: Pick<HabitRow, 'extra_data'>): string {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'task') return '周期配额 · 不可作为门槛';
  if (!isHabitEligibleForWishRedeem(habit)) {
    return kind === 'break' ? '戒除 · 未设连续挑战目标' : '养成 · 未设周期目标';
  }
  if (kind === 'break') {
    return isHabitWishRedeemConditionMet(habit) ? '戒除 · 连续挑战已完成' : '戒除 · 须连续挑战达成';
  }
  return isHabitWishRedeemConditionMet(habit) ? '养成 · 目标已达成' : '养成 · 须周期目标达成';
}

export function hasWishBoardRedeemConditions(conditions: WishBoardRedeemConditions): boolean {
  return countWishBoardRedeemConditions(conditions) > 0;
}

export function isProjectRedeemConditionMet(
  project: Pick<ProjectRow, 'status'> | null | undefined,
): boolean {
  if (!project) return false;
  return (
    project.status === 'done' ||
    project.status === 'cancelled' ||
    project.status === 'completed' ||
    project.status === 'archived'
  );
}

export function isTaskRedeemConditionMet(task: Pick<TaskRow, 'status'> | null | undefined): boolean {
  return task?.status === 'done';
}

/** 子项进度：排除已取消任务（cancelled 不计入总数，done 计入完成数） */
function computeSubTaskProgress(
  allTasks: TaskRow[] | undefined,
  match: (task: TaskRow) => boolean,
): { done: number; total: number } | null {
  if (!allTasks) return null;
  let total = 0;
  let done = 0;
  for (const task of allTasks) {
    if (!match(task)) continue;
    if (task.status === 'cancelled') continue;
    total += 1;
    if (task.status === 'done') done += 1;
  }
  return total > 0 ? { done, total } : null;
}

function kindLabel(kind: WishBoardRedeemConditionKind): string {
  if (kind === 'project') return '项目';
  if (kind === 'todo') return '待办';
  if (kind === 'habit') return '小习惯';
  if (kind === 'net_worth') return '净资产';
  if (kind === 'available_from') return '开放时间';
  return '任务';
}

function singlePendingMessage(pending: WishBoardRedeemConditionCheck[]): string | null {
  if (pending.length !== 1) return null;
  const only = pending[0]!;
  if (only.kind === 'net_worth') return `净资产不足（${only.title}）`;
  if (only.kind === 'available_from') {
    return `尚未到开放兑换时间（自 ${formatAvailableFromLabel(only.title)} 起）`;
  }
  if (only.kind === 'habit') {
    if (only.missing) return `绑定的小习惯「${only.title}」已删除`;
    if (only.ineligible) return `小习惯「${only.title}」未设周期目标`;
    if (only.habit_kind === 'break') return `戒除习惯「${only.title}」连续挑战尚未完成`;
    return `养成习惯「${only.title}」周期目标尚未达成`;
  }
  return null;
}

function buildEligibilityMessage(input: {
  pointsOk: boolean;
  costPoints: number;
  balance: number;
  pending: WishBoardRedeemConditionCheck[];
}): string | null {
  const single = singlePendingMessage(input.pending);
  if (!input.pointsOk && input.pending.length > 0) {
    if (single) {
      return `积分不足（需要 ${input.costPoints}，当前 ${input.balance}），且${single}`;
    }
    return `积分不足（需要 ${input.costPoints}，当前 ${input.balance}），且仍有未完成的绑定项`;
  }
  if (!input.pointsOk) {
    return `积分不足（需要 ${input.costPoints}，当前 ${input.balance}）`;
  }
  if (input.pending.length === 0) return null;
  if (single) return single;
  const names = input.pending.slice(0, 3).map(p => {
    if (p.kind === 'available_from') {
      return `「开放兑换时间」`;
    }
    const title = p.missing ? `已删除的${kindLabel(p.kind)}` : p.title;
    return `「${title}」`;
  });
  const more = input.pending.length > 3 ? ` 等 ${input.pending.length} 项` : '';
  return `尚有绑定项未完成：${names.join('、')}${more}`;
}

export function evaluateWishBoardRedeemEligibilitySync(
  item: { cost_points: number; extra_data?: string | null },
  balance: number,
  lookups: {
    projectsById: Map<string, ProjectRow>;
    tasksById: Map<string, TaskRow>;
    habitsById?: Map<string, HabitRow>;
    /** 与资产页「当前净资产」同一口径；未传入且设置了门槛时视为未达标 */
    currentNetWorth?: number;
    /** 全量任务（详情页展示子项进度用）；不传则 check.progress 为 null */
    allTasks?: TaskRow[];
  },
): WishBoardRedeemEligibility {
  const costPoints = Number.isFinite(item.cost_points) ? Math.max(0, item.cost_points) : 0;
  const pointsOk = costPoints <= 0 || balance >= costPoints;
  const conditions = parseWishBoardRedeemConditions(item.extra_data);
  const checks: WishBoardRedeemConditionCheck[] = [];
  const allTasks = lookups.allTasks;
  const habitsById = lookups.habitsById ?? new Map<string, HabitRow>();

  for (const id of conditions.project_ids) {
    const project = lookups.projectsById.get(id) ?? null;
    checks.push({
      kind: 'project',
      id,
      title: project?.name?.trim() || '未知项目',
      done: isProjectRedeemConditionMet(project),
      missing: !project,
      progress: computeSubTaskProgress(allTasks, t => t.project_id === id),
    });
  }
  for (const id of conditions.task_ids) {
    const task = lookups.tasksById.get(id) ?? null;
    checks.push({
      kind: 'task',
      id,
      title: task?.title?.trim() || '未知任务',
      done: isTaskRedeemConditionMet(task),
      missing: !task,
      progress: computeSubTaskProgress(allTasks, t => t.parent_task_id === id),
    });
  }
  for (const id of conditions.todo_ids) {
    const task = lookups.tasksById.get(id) ?? null;
    checks.push({
      kind: 'todo',
      id,
      title: task?.title?.trim() || '未知待办',
      done: isTaskRedeemConditionMet(task),
      missing: !task,
      progress: computeSubTaskProgress(allTasks, t => t.parent_task_id === id),
    });
  }
  for (const id of conditions.habit_ids) {
    const habit = habitsById.get(id) ?? null;
    const habitKind = wishHabitKindForRedeem(habit);
    const eligible = habit ? isHabitEligibleForWishRedeem(habit) : false;
    const done = Boolean(habit && eligible && isHabitWishRedeemConditionMet(habit));
    checks.push({
      kind: 'habit',
      id,
      title: habit?.name?.trim() || '未知习惯',
      done,
      missing: !habit,
      progress: null,
      habit_kind: habitKind,
      ineligible: Boolean(habit && !eligible),
    });
  }
  if (conditions.min_net_worth != null) {
    const current =
      typeof lookups.currentNetWorth === 'number' && Number.isFinite(lookups.currentNetWorth)
        ? lookups.currentNetWorth
        : null;
    const done = current != null && isNetWorthAtLeast(current, conditions.min_net_worth);
    const needLabel = formatSignedMoneyTrunc2(conditions.min_net_worth);
    const currentLabel = current != null ? formatSignedMoneyTrunc2(current) : '未知';
    checks.push({
      kind: 'net_worth',
      id: NET_WORTH_CHECK_ID,
      title: `净资产达到 ${needLabel}（当前 ${currentLabel}）`,
      done,
      missing: current == null,
      progress: null,
    });
  }
  if (conditions.available_from != null) {
    const done = isAvailableFromMet(conditions.available_from);
    checks.push({
      kind: 'available_from',
      id: AVAILABLE_FROM_CHECK_ID,
      /** title 存规范时间串；展示层用 formatAvailableFromLabel */
      title: conditions.available_from,
      done,
      missing: !parseAvailableFromDate(conditions.available_from),
      progress: null,
    });
  }

  const pending = checks.filter(c => !c.done);
  const conditionsOk = pending.length === 0;
  const ok = pointsOk && conditionsOk;
  return {
    ok,
    pointsOk,
    conditionsOk,
    costPoints,
    balance,
    conditions,
    checks,
    pending,
    message: ok
      ? null
      : buildEligibilityMessage({ pointsOk, costPoints, balance, pending }),
  };
}

/** 与资产页「当前净资产」同一公式：总资产 − 总负债 */
export async function loadWishBoardCurrentNetWorth(): Promise<number> {
  const { getFinanceAccountsWithBalance } = await import('@/lib/repositories/finance/finance');
  const accounts = await getFinanceAccountsWithBalance({ cacheOnly: true });
  return computeNetWorthTotal(accounts);
}

/** 按 id 拉取本地项目/任务/小习惯及当前净资产后评估兑换资格 */
export async function evaluateWishBoardRedeemEligibility(
  item: { cost_points: number; extra_data?: string | null },
  balance: number,
): Promise<WishBoardRedeemEligibility> {
  const conditions = parseWishBoardRedeemConditions(item.extra_data);
  const projectsById = new Map<string, ProjectRow>();
  const tasksById = new Map<string, TaskRow>();
  const habitsById = new Map<string, HabitRow>();

  const [, currentNetWorth] = await Promise.all([
    Promise.all([
      ...conditions.project_ids.map(async id => {
        const row = await getProjectById(id);
        if (row) projectsById.set(id, row);
      }),
      ...[...conditions.task_ids, ...conditions.todo_ids].map(async id => {
        const row = await getTaskById(id);
        if (row) tasksById.set(id, row);
      }),
      ...conditions.habit_ids.map(async id => {
        const row = await getHabitById(id);
        if (row) habitsById.set(id, row);
      }),
    ]),
    loadWishBoardCurrentNetWorth(),
  ]);

  return evaluateWishBoardRedeemEligibilitySync(item, balance, {
    projectsById,
    tasksById,
    habitsById,
    currentNetWorth,
  });
}

/** 兑换前硬校验：不满足则抛错 */
export async function assertWishBoardRedeemEligible(
  item: { cost_points: number; extra_data?: string | null },
  balance: number,
): Promise<void> {
  const result = await evaluateWishBoardRedeemEligibility(item, balance);
  if (!result.ok) {
    throw new Error(result.message || '兑换条件未满足');
  }
}

/** 供选择器过滤：归属项目的任务（含任意层级子任务）vs 独立待办 */
export function isProjectBoundTask(task: Pick<TaskRow, 'project_id' | 'parent_task_id'>): boolean {
  return Boolean(task.project_id);
}

export function isTodoBoundTask(task: Pick<TaskRow, 'project_id' | 'parent_task_id'>): boolean {
  return isStandaloneTodoTask(task);
}

export function formatWishBoardRedeemConditionsSummary(
  conditions: WishBoardRedeemConditions,
  lookups?: {
    projectsById?: Map<string, { name: string }>;
    tasksById?: Map<string, { title: string }>;
    habitsById?: Map<string, { name: string }>;
  },
): string | null {
  if (!hasWishBoardRedeemConditions(conditions)) return null;
  const parts: string[] = [];
  if (conditions.available_from != null) {
    parts.push(`自 ${formatAvailableFromLabel(conditions.available_from)} 起开放`);
  }
  if (conditions.min_net_worth != null) {
    parts.push(`净资产 ≥ ${formatSignedMoneyTrunc2(conditions.min_net_worth)}`);
  }
  if (conditions.project_ids.length > 0) {
    parts.push(`${conditions.project_ids.length} 个项目`);
  }
  if (conditions.task_ids.length > 0) {
    parts.push(`${conditions.task_ids.length} 个任务`);
  }
  if (conditions.todo_ids.length > 0) {
    parts.push(`${conditions.todo_ids.length} 个待办`);
  }
  if (conditions.habit_ids.length > 0) {
    parts.push(`${conditions.habit_ids.length} 个小习惯`);
  }
  const countLabel = parts.join(' · ');
  if (!lookups) return `另需：${countLabel}`;

  const names: string[] = [];
  if (conditions.available_from != null) {
    names.push(`自 ${formatAvailableFromLabel(conditions.available_from)} 起开放`);
  }
  if (conditions.min_net_worth != null) {
    names.push(`净资产 ≥ ${formatSignedMoneyTrunc2(conditions.min_net_worth)}`);
  }
  for (const id of conditions.project_ids) {
    const name = lookups.projectsById?.get(id)?.name?.trim();
    if (name) names.push(name);
  }
  for (const id of [...conditions.task_ids, ...conditions.todo_ids]) {
    const title = lookups.tasksById?.get(id)?.title?.trim();
    if (title) names.push(title);
  }
  for (const id of conditions.habit_ids) {
    const name = lookups.habitsById?.get(id)?.name?.trim();
    if (name) names.push(name);
  }
  if (names.length === 0) return `另需：${countLabel}`;
  if (names.length <= 2) return `另需：${names.join('、')}`;
  return `另需：${names.slice(0, 2).join('、')} 等 ${names.length} 项`;
}
