/**
 * 项目完成条件 ↔ 小习惯周期成功。
 * 存于 projects.extra_data.completion_habit_ids；口径为养成/戒除「周期目标已达成」，非当日打卡。
 */
import { isBreakHabitSucceeded } from '@/lib/repositories/habits/habit-break-success';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { parseBuildHabitExpectedGoal, parseHabitConsecutiveTargetDays } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { getHabitById, getHabits } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { applyProjectCompletionPointsReward } from '@/lib/repositories/habits/habit-points-grant';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { ensureProjectCompletionLogFromProject } from '@/lib/repositories/projects/project-completion-logs';
import { parseProjectExtraData, type ProjectExtraDataBag } from '@/lib/repositories/projects/project-extra-data';
import { areAllTasksInProjectTreeDone } from '@/lib/repositories/projects/project-prerequisites';
import { getProjectById, getProjects, updateProject } from '@/lib/repositories/projects/project';
import { getTasksByProjectId, type TaskTreeNode } from '@/lib/repositories/tasks/task';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';

export const COMPLETION_HABIT_IDS_KEY = 'completion_habit_ids';

export type ProjectHabitConditionCheck = {
  habitId: string;
  title: string;
  /** 周期目标已达成 */
  done: boolean;
  /** 习惯已删除或不存在 */
  missing: boolean;
  /** 未设周期目标，无法作为完成条件 */
  ineligible: boolean;
};

export type ProjectCompletionHabitsEvaluation = {
  habitIds: string[];
  checks: ProjectHabitConditionCheck[];
  pending: ProjectHabitConditionCheck[];
  ok: boolean;
};

export type AutoCompletedProjectChange = {
  projectId: string;
  name: string;
  pointsDelta: number;
};

function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function parseCompletionHabitIds(extraData: string | null | undefined): string[] {
  const extra = parseProjectExtraData(extraData ?? null);
  return normalizeIdList(extra[COMPLETION_HABIT_IDS_KEY]);
}

export function mergeCompletionHabitIdsIntoExtraData(
  extra: ProjectExtraDataBag | string | null | undefined,
  habitIds: readonly string[] | null | undefined,
): ProjectExtraDataBag {
  const base: ProjectExtraDataBag =
    typeof extra === 'string' || extra == null
      ? parseProjectExtraData(typeof extra === 'string' ? extra : null)
      : { ...extra };
  const ids = normalizeIdList(habitIds ?? []);
  if (ids.length === 0) {
    delete base[COMPLETION_HABIT_IDS_KEY];
  } else {
    base[COMPLETION_HABIT_IDS_KEY] = ids;
  }
  return base;
}

export function mergeCompletionHabitIdsIntoExtraDataString(
  extraData: string | null | undefined,
  habitIds: readonly string[] | null | undefined,
): string | null {
  const next = mergeCompletionHabitIdsIntoExtraData(extraData, habitIds);
  if (Object.keys(next).length === 0) return null;
  return JSON.stringify(next);
}

/** 可否作为项目完成条件：养成须有预期目标，戒除须有连续天数；任务型周期习惯不纳入 */
export function isHabitEligibleForProjectCompletion(habit: Pick<HabitRow, 'extra_data'>): boolean {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'build') return parseBuildHabitExpectedGoal(habit.extra_data) != null;
  if (kind === 'break') return parseHabitConsecutiveTargetDays(habit.extra_data) != null;
  return false;
}

export function isHabitCycleSucceededForProject(habit: Pick<HabitRow, 'extra_data'>): boolean {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'build') return isBuildHabitSucceeded(habit.extra_data);
  if (kind === 'break') return isBreakHabitSucceeded(habit.extra_data);
  return false;
}

export async function evaluateProjectCompletionHabits(
  extraData: string | null | undefined,
  opts?: { habitById?: ReadonlyMap<string, HabitRow | null> },
): Promise<ProjectCompletionHabitsEvaluation> {
  const habitIds = parseCompletionHabitIds(extraData);
  if (habitIds.length === 0) {
    return { habitIds: [], checks: [], pending: [], ok: true };
  }

  const checks: ProjectHabitConditionCheck[] = [];
  for (const habitId of habitIds) {
    const habit =
      opts?.habitById?.has(habitId)
        ? (opts.habitById.get(habitId) ?? null)
        : await getHabitById(habitId);
    if (!habit) {
      checks.push({
        habitId,
        title: '未知习惯',
        done: false,
        missing: true,
        ineligible: false,
      });
      continue;
    }
    const eligible = isHabitEligibleForProjectCompletion(habit);
    const done = eligible && isHabitCycleSucceededForProject(habit);
    checks.push({
      habitId,
      title: habit.name.trim() || '未命名习惯',
      done,
      missing: false,
      ineligible: !eligible,
    });
  }

  const pending = checks.filter((c) => !c.done);
  return { habitIds, checks, pending, ok: pending.length === 0 };
}

export function formatProjectCompletionHabitsBlockMessage(
  evaluation: ProjectCompletionHabitsEvaluation,
): string {
  if (evaluation.ok) return '';
  const parts = evaluation.pending.map((c) => {
    if (c.missing) return `「${c.title}」已不存在`;
    if (c.ineligible) return `「${c.title}」未设周期目标`;
    return `「${c.title}」`;
  });
  if (parts.length === 1) {
    const only = evaluation.pending[0];
    if (only?.missing) return `完成条件中的小习惯已失效：${parts[0]}。可改绑定或仍要归档。`;
    if (only?.ineligible) return `完成条件中的小习惯未设周期目标：${parts[0]}。可改绑定或仍要归档。`;
    return `还需小习惯达成周期目标：${parts[0]}。`;
  }
  return `还需小习惯达成周期目标：${parts.join('、')}。`;
}

function countTaskTreeProgress(nodes: TaskTreeNode[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  const walk = (list: TaskTreeNode[]) => {
    for (const n of list) {
      total += 1;
      if (n.status === 'done' || n.status === 'cancelled') done += 1;
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return { total, done };
}

/** 任务侧是否已可收尾：无任务，或整棵树均为 done/cancelled */
export function areProjectTasksReadyForHabitCompletion(tree: TaskTreeNode[]): boolean {
  if (tree.length === 0) return true;
  return areAllTasksInProjectTreeDone(tree);
}

/**
 * 某习惯周期成功后：扫描引用它的活跃项目，任务已齐且全部完成条件习惯已成功时，自动收入收集箱归档。
 * 不强制完成未完成任务（与手动「收入归档」不同）。
 */
export async function completeProjectsBoundToHabitIfReady(
  habitId: string,
  opts?: { logicalTodayYmd?: string },
): Promise<AutoCompletedProjectChange[]> {
  const trimmed = habitId.trim();
  if (!trimmed) return [];

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd = opts?.logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);
  const projects = await getProjects();
  const candidates = projects.filter((p) => {
    if (p.status === 'completed' || p.status === 'archived') return false;
    return parseCompletionHabitIds(p.extra_data).includes(trimmed);
  });
  if (candidates.length === 0) return [];

  const completed: AutoCompletedProjectChange[] = [];
  for (const project of candidates) {
    try {
      const evaluation = await evaluateProjectCompletionHabits(project.extra_data);
      if (!evaluation.ok) continue;

      const tree = await getTasksByProjectId(project.id, { forceRefresh: false });
      if (!areProjectTasksReadyForHabitCompletion(tree)) continue;

      const progress = countTaskTreeProgress(tree);
      await updateProject(project.id, {
        category_id: INBOX_PROJECT_CATEGORY_ID,
        status: 'completed',
      });
      let pointsDelta = 0;
      try {
        pointsDelta = await applyProjectCompletionPointsReward(project.id, 'earn', project.extra_data);
      } catch (ptsErr) {
        console.warn('项目习惯联动完成发奖失败', project.id, ptsErr);
      }
      try {
        await ensureProjectCompletionLogFromProject(project, {
          completedYmd: logicalTodayYmd,
          taskCount: progress.total,
          doneTaskCount: progress.done,
          pointsDelta,
          source: 'habit_completion',
          skipIfExists: false,
        });
      } catch (logErr) {
        console.warn('项目习惯联动写入履历失败', project.id, logErr);
      }
      completed.push({
        projectId: project.id,
        name: project.name,
        pointsDelta,
      });
    } catch (err) {
      console.warn('项目习惯联动自动收尾失败', project.id, err);
    }
  }
  return completed;
}

/** 保存绑定时：若条件已齐则尝试自动收尾（返回是否已归档） */
export async function tryCompleteProjectByCompletionHabits(
  projectId: string,
): Promise<AutoCompletedProjectChange | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.status === 'completed' || project.status === 'archived') return null;

  const ids = parseCompletionHabitIds(project.extra_data);
  if (ids.length === 0) return null;

  const evaluation = await evaluateProjectCompletionHabits(project.extra_data);
  if (!evaluation.ok) return null;

  const tree = await getTasksByProjectId(projectId, { forceRefresh: false });
  if (!areProjectTasksReadyForHabitCompletion(tree)) return null;

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
  const progress = countTaskTreeProgress(tree);
  await updateProject(projectId, {
    category_id: INBOX_PROJECT_CATEGORY_ID,
    status: 'completed',
  });
  let pointsDelta = 0;
  try {
    pointsDelta = await applyProjectCompletionPointsReward(projectId, 'earn', project.extra_data);
  } catch (ptsErr) {
    console.warn('项目习惯条件收尾发奖失败', projectId, ptsErr);
  }
  try {
    await ensureProjectCompletionLogFromProject(project, {
      completedYmd: logicalTodayYmd,
      taskCount: progress.total,
      doneTaskCount: progress.done,
      pointsDelta,
      source: 'habit_completion',
      skipIfExists: false,
    });
  } catch (logErr) {
    console.warn('项目习惯条件收尾履历失败', projectId, logErr);
  }
  return { projectId, name: project.name, pointsDelta };
}

/** 供选择器：仅保留可作完成条件的习惯；已选中的仍保留以便取消 */
export function filterHabitsForProjectCompletionPicker(
  habits: HabitRow[],
  selectedIds: readonly string[],
): HabitRow[] {
  const selected = new Set(selectedIds);
  return habits.filter(
    (h) => selected.has(h.id) || isHabitEligibleForProjectCompletion(h),
  );
}

/** 预热：批量取习惯（评价时少打库） */
export async function loadHabitMapForIds(ids: readonly string[]): Promise<Map<string, HabitRow | null>> {
  const map = new Map<string, HabitRow | null>();
  if (ids.length === 0) return map;
  const all = await getHabits();
  const byId = new Map(all.map((h) => [h.id, h]));
  for (const id of ids) {
    map.set(id, byId.get(id) ?? null);
  }
  return map;
}
