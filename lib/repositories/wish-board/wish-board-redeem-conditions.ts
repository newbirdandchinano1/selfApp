import {
  computeNetWorthTotal,
  formatSignedMoneyTrunc2,
  isNetWorthAtLeast,
} from '@/lib/finance-net-worth';
import { getProjectById } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTaskById } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import type { WishBoardRedeemConditionsInput } from '@/lib/repositories/wish-board/wish-board.types';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';

const REDEEM_CONDITIONS_KEY = 'redeem_conditions';
const NET_WORTH_CHECK_ID = 'min_net_worth';

export type WishBoardRedeemConditions = {
  /** 须全部完成（completed / archived）的项目 */
  project_ids: string[];
  /** 须全部 done 的项目任务（非独立待办） */
  task_ids: string[];
  /** 须全部 done 的独立待办 */
  todo_ids: string[];
  /** 当前净资产须 ≥ 该值（与资产页「当前净资产」同一公式）；null 表示不限制 */
  min_net_worth: number | null;
};

export type WishBoardRedeemConditionKind = 'project' | 'task' | 'todo' | 'net_worth';

export type WishBoardRedeemConditionCheck = {
  kind: WishBoardRedeemConditionKind;
  id: string;
  title: string;
  done: boolean;
  missing: boolean;
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

export function emptyWishBoardRedeemConditions(): WishBoardRedeemConditions {
  return { project_ids: [], task_ids: [], todo_ids: [], min_net_worth: null };
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
    min_net_worth: normalizeMinNetWorth(obj.min_net_worth),
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
        min_net_worth: normalizeMinNetWorth(conditions.min_net_worth),
      }
    : emptyWishBoardRedeemConditions();

  if (
    next.project_ids.length === 0 &&
    next.task_ids.length === 0 &&
    next.todo_ids.length === 0 &&
    next.min_net_worth == null
  ) {
    delete base[REDEEM_CONDITIONS_KEY];
  } else {
    const payload: Record<string, unknown> = {
      project_ids: next.project_ids,
      task_ids: next.task_ids,
      todo_ids: next.todo_ids,
    };
    if (next.min_net_worth != null) payload.min_net_worth = next.min_net_worth;
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
    (conditions.min_net_worth != null ? 1 : 0)
  );
}

export function hasWishBoardRedeemConditions(conditions: WishBoardRedeemConditions): boolean {
  return countWishBoardRedeemConditions(conditions) > 0;
}

export function isProjectRedeemConditionMet(
  project: Pick<ProjectRow, 'status'> | null | undefined,
): boolean {
  if (!project) return false;
  return project.status === 'completed' || project.status === 'archived';
}

export function isTaskRedeemConditionMet(task: Pick<TaskRow, 'status'> | null | undefined): boolean {
  return task?.status === 'done';
}

function kindLabel(kind: WishBoardRedeemConditionKind): string {
  if (kind === 'project') return '项目';
  if (kind === 'todo') return '待办';
  if (kind === 'net_worth') return '净资产';
  return '任务';
}

function netWorthPendingMessage(pending: WishBoardRedeemConditionCheck[]): string | null {
  const net = pending.find(p => p.kind === 'net_worth');
  if (!net) return null;
  if (pending.length === 1) {
    return `净资产不足（${net.title}）`;
  }
  return null;
}

function buildEligibilityMessage(input: {
  pointsOk: boolean;
  costPoints: number;
  balance: number;
  pending: WishBoardRedeemConditionCheck[];
}): string | null {
  const netOnly = netWorthPendingMessage(input.pending);
  if (!input.pointsOk && input.pending.length > 0) {
    if (netOnly) {
      return `积分不足（需要 ${input.costPoints}，当前 ${input.balance}），且${netOnly}`;
    }
    return `积分不足（需要 ${input.costPoints}，当前 ${input.balance}），且仍有未完成的绑定项`;
  }
  if (!input.pointsOk) {
    return `积分不足（需要 ${input.costPoints}，当前 ${input.balance}）`;
  }
  if (input.pending.length === 0) return null;
  if (netOnly) return netOnly;
  const names = input.pending.slice(0, 3).map(p => {
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
    /** 与资产页「当前净资产」同一口径；未传入且设置了门槛时视为未达标 */
    currentNetWorth?: number;
  },
): WishBoardRedeemEligibility {
  const costPoints = Number.isFinite(item.cost_points) ? Math.max(0, item.cost_points) : 0;
  const pointsOk = costPoints <= 0 || balance >= costPoints;
  const conditions = parseWishBoardRedeemConditions(item.extra_data);
  const checks: WishBoardRedeemConditionCheck[] = [];

  for (const id of conditions.project_ids) {
    const project = lookups.projectsById.get(id) ?? null;
    checks.push({
      kind: 'project',
      id,
      title: project?.name?.trim() || '未知项目',
      done: isProjectRedeemConditionMet(project),
      missing: !project,
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
  const accounts = await getFinanceAccountsWithBalance({ localOnly: true });
  return computeNetWorthTotal(accounts);
}

/** 按 id 拉取本地项目/任务及当前净资产后评估兑换资格 */
export async function evaluateWishBoardRedeemEligibility(
  item: { cost_points: number; extra_data?: string | null },
  balance: number,
): Promise<WishBoardRedeemEligibility> {
  const conditions = parseWishBoardRedeemConditions(item.extra_data);
  const projectsById = new Map<string, ProjectRow>();
  const tasksById = new Map<string, TaskRow>();

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
    ]),
    loadWishBoardCurrentNetWorth(),
  ]);

  return evaluateWishBoardRedeemEligibilitySync(item, balance, {
    projectsById,
    tasksById,
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

/** 供选择器过滤：项目任务 vs 独立待办 */
export function isProjectBoundTask(task: Pick<TaskRow, 'project_id' | 'parent_task_id'>): boolean {
  return Boolean(task.project_id) && !task.parent_task_id;
}

export function isTodoBoundTask(task: Pick<TaskRow, 'project_id' | 'parent_task_id'>): boolean {
  return isStandaloneTodoTask(task);
}

export function formatWishBoardRedeemConditionsSummary(
  conditions: WishBoardRedeemConditions,
  lookups?: {
    projectsById?: Map<string, { name: string }>;
    tasksById?: Map<string, { title: string }>;
  },
): string | null {
  if (!hasWishBoardRedeemConditions(conditions)) return null;
  const parts: string[] = [];
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
  const countLabel = parts.join(' · ');
  if (!lookups) return `另需：${countLabel}`;

  const names: string[] = [];
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
  if (names.length === 0) return `另需：${countLabel}`;
  if (names.length <= 2) return `另需：${names.join('、')}`;
  return `另需：${names.slice(0, 2).join('、')} 等 ${names.length} 项`;
}
