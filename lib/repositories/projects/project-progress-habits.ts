/**
 * 项目进度燃料 ↔ 小习惯。
 * 存于 projects.extra_data.progress_habit_bindings；与 completion_habit_ids（结案门禁）分键。
 *
 * 口径（按习惯类别，不再清一色「累计达标日 / 手填天数」）：
 * 双轨：
 * - 轨 A（有自身目标）：养成跟 expectedGoal；戒除跟 consecutiveTargetDays
 * - 轨 B（无自身目标）：用 binding.target_days + 日历达标天数（一天计 1）
 * 周期配额不纳入。习惯已删时回退 binding.target_days。
 *
 * 计入窗口：仅 since_ymd（含）之后的打卡；缺省回退项目 created_at 的本地日。
 * 零进度也出评价（ratio=0），列表应立刻显示进度条。
 *
 * 项目级 ratio = 各 binding ratio 的简单平均（天/次混绑时可比较）；full = 全部达标。
 * 满进度只通知，不自动归档。
 */
import { ymdFromDatetime } from '@/lib/api-mysql-datetime';
import { isValidYmd } from '@/lib/date';
import { getCheckInsMapByHabitId } from '@/lib/repositories/habits/habit-check-in';
import {
  computeBuildExpectedGoalProgress,
  computeConsecutiveGoalMetDays,
  formatBuildExpectedGoalShort,
  isBreakHabitDayCompleted,
  isHabitDayGoalMet,
  parseBuildHabitExpectedGoal,
  parseHabitConsecutiveTargetDays,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  parseProjectExtraData,
  type ProjectExtraDataBag,
} from '@/lib/repositories/projects/project-extra-data';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';

export const PROGRESS_HABIT_BINDINGS_KEY = 'progress_habit_bindings';

/** target_days 合法范围；解析时非法条目丢弃（作快照/回退） */
export const PROGRESS_HABIT_TARGET_DAYS_MIN = 1;
export const PROGRESS_HABIT_TARGET_DAYS_MAX = 365;

export type ProjectProgressHabitBinding = {
  habitId: string;
  /** 绑定时快照或回退目标；评价时优先用习惯自身目标 */
  targetDays: number;
  /** 计入打卡的起始逻辑日（含当日）；首次绑定写入 */
  sinceYmd?: string;
};

export type ProgressFuelMode =
  | 'build_days'
  | 'build_times'
  | 'build_consecutive'
  | 'break_consecutive'
  | 'fallback_days';

export type ProjectProgressHabitBindingCheck = {
  habitId: string;
  title: string;
  kind: HabitKind | 'unknown';
  mode: ProgressFuelMode;
  /** 展示用：养成 / 戒除 */
  kindLabel: string;
  /** 展示用短说明，如「养成 12/21 天」「戒除连续 5/30 天」 */
  progressCaption: string;
  unitLabel: string;
  targetDays: number;
  doneDays: number;
  /** 习惯已删除或不存在 */
  missing: boolean;
  ratio: number;
};

export type ProjectProgressHabitsEvaluation = {
  bindings: ProjectProgressHabitBinding[];
  checks: ProjectProgressHabitBindingCheck[];
  /** 兼容旧字段：各轨 done 之和（单位可能混杂，仅作摘要） */
  doneDays: number;
  targetDays: number;
  /** 无有效 binding 时为 null（不展示习惯轨） */
  ratio: number | null;
  full: boolean;
};

export type ProjectProgressHabitsNotifyUpdate = {
  projectId: string;
  projectName: string;
  evaluation: ProjectProgressHabitsEvaluation;
  /** 相对会话内上次缓存，是否刚变为满进度 */
  becameFull: boolean;
};

export type ProjectProgressHabitsNotifyResult = {
  updates: ProjectProgressHabitsNotifyUpdate[];
};

/** 会话内上次评价缓存：用于判断「刚满」；撤销导致未满时清除 */
const lastFullByProjectId = new Map<string, boolean>();

function clampTargetDays(raw: unknown): number | null {
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return null;
  const rounded = Math.round(n);
  if (rounded < PROGRESS_HABIT_TARGET_DAYS_MIN || rounded > PROGRESS_HABIT_TARGET_DAYS_MAX) {
    return null;
  }
  return rounded;
}

function parseSinceYmd(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return isValidYmd(t) ? t : undefined;
}

function normalizeBindingList(raw: unknown): ProjectProgressHabitBinding[] {
  if (!Array.isArray(raw)) return [];
  const byHabit = new Map<string, ProjectProgressHabitBinding>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const habitRaw = row.habit_id ?? row.habitId;
    if (typeof habitRaw !== 'string') continue;
    const habitId = habitRaw.trim();
    if (!habitId) continue;
    const targetDays = clampTargetDays(row.target_days ?? row.targetDays);
    if (targetDays == null) continue;
    const sinceYmd = parseSinceYmd(row.since_ymd ?? row.sinceYmd);
    // 同一 habit_id 后写覆盖
    byHabit.set(habitId, {
      habitId,
      targetDays,
      ...(sinceYmd ? { sinceYmd } : {}),
    });
  }
  return [...byHabit.values()];
}

/** 首次绑定写入 sinceYmd；已有绑定保留原 sinceYmd */
export function stampProgressHabitBindingsSinceYmd(
  bindings: readonly ProjectProgressHabitBinding[],
  sinceYmd: string,
  previous?: readonly ProjectProgressHabitBinding[] | null,
): ProjectProgressHabitBinding[] {
  const anchor = parseSinceYmd(sinceYmd);
  const prevById = new Map((previous ?? []).map((b) => [b.habitId, b]));
  return bindings.map((b) => {
    const prev = prevById.get(b.habitId);
    const kept = prev?.sinceYmd || b.sinceYmd || anchor;
    return kept ? { ...b, sinceYmd: kept } : { ...b };
  });
}

/** 仅保留 sinceYmd（含）之后的打卡 */
export function filterCheckInsSinceYmd(
  checkIns: Record<string, number>,
  sinceYmd: string | null | undefined,
): Record<string, number> {
  const since = parseSinceYmd(sinceYmd ?? undefined);
  if (!since) return checkIns;
  const out: Record<string, number> = {};
  for (const [ymd, count] of Object.entries(checkIns)) {
    if (ymd >= since) out[ymd] = count;
  }
  return out;
}

function resolveBindingSinceYmd(
  binding: ProjectProgressHabitBinding,
  projectCreatedAt?: string | null,
): string | undefined {
  if (binding.sinceYmd) return binding.sinceYmd;
  return ymdFromDatetime(projectCreatedAt) ?? undefined;
}

export function parseProgressHabitBindings(
  extraData: string | null | undefined,
): ProjectProgressHabitBinding[] {
  const extra = parseProjectExtraData(extraData ?? null);
  return normalizeBindingList(extra[PROGRESS_HABIT_BINDINGS_KEY]);
}

export function projectHasProgressHabit(
  extraData: string | null | undefined,
  habitId: string,
): boolean {
  const trimmed = habitId.trim();
  if (!trimmed) return false;
  return parseProgressHabitBindings(extraData).some((b) => b.habitId === trimmed);
}

export function mergeProgressHabitBindingsIntoExtraData(
  extra: ProjectExtraDataBag | string | null | undefined,
  bindings: readonly ProjectProgressHabitBinding[] | null | undefined,
): ProjectExtraDataBag {
  const base: ProjectExtraDataBag =
    typeof extra === 'string' || extra == null
      ? parseProjectExtraData(typeof extra === 'string' ? extra : null)
      : { ...extra };
  const normalized = normalizeBindingList(
    (bindings ?? []).map((b) => ({
      habit_id: b.habitId,
      target_days: b.targetDays,
      since_ymd: b.sinceYmd,
    })),
  );
  if (normalized.length === 0) {
    delete base[PROGRESS_HABIT_BINDINGS_KEY];
  } else {
    base[PROGRESS_HABIT_BINDINGS_KEY] = normalized.map((b) => ({
      habit_id: b.habitId,
      target_days: b.targetDays,
      ...(b.sinceYmd ? { since_ymd: b.sinceYmd } : {}),
    }));
  }
  return base;
}

export function mergeProgressHabitBindingsIntoExtraDataString(
  extraData: string | null | undefined,
  bindings: readonly ProjectProgressHabitBinding[] | null | undefined,
): string | null {
  const next = mergeProgressHabitBindingsIntoExtraData(extraData, bindings);
  if (Object.keys(next).length === 0) return null;
  return JSON.stringify(next);
}

/** 某逻辑日是否计入回退口径的日历达标天 */
export function isHabitDayCountedForProjectProgress(
  habit: Pick<HabitRow, 'extra_data'>,
  opts: {
    todayCount: number;
    hasDayRecord: boolean;
    ymd: string;
    logicalTodayYmd: string;
  },
): boolean {
  const kind = parseHabitKind(habit.extra_data);
  const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
  if (kind === 'break') {
    return isBreakHabitDayCompleted({
      todayCount: opts.todayCount,
      dailyGoal,
      hasDayRecord: opts.hasDayRecord,
      ymd: opts.ymd,
      logicalTodayYmd: opts.logicalTodayYmd,
    });
  }
  return isHabitDayGoalMet({
    kind,
    todayCount: opts.todayCount,
    dailyGoal,
    hasDayRecord: opts.hasDayRecord,
    ymd: opts.ymd,
    logicalTodayYmd: opts.logicalTodayYmd,
  });
}

/** 回退：习惯打卡表中达标天数（一天最多计 1） */
export function countHabitProgressGoalMetDays(
  habit: Pick<HabitRow, 'extra_data'>,
  checkIns: Record<string, number>,
  logicalTodayYmd: string,
): number {
  let days = 0;
  for (const ymd of Object.keys(checkIns)) {
    const todayCount = Math.max(0, Math.floor(Number(checkIns[ymd]) || 0));
    const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
    if (
      isHabitDayCountedForProjectProgress(habit, {
        todayCount,
        hasDayRecord,
        ymd,
        logicalTodayYmd,
      })
    ) {
      days += 1;
    }
  }
  return days;
}

export type HabitNativeProgressFuel = {
  mode: Exclude<ProgressFuelMode, 'fallback_days'>;
  target: number;
  unitLabel: string;
  kindLabel: string;
  /** 如「21 天」「连续 30 天」「100 次」 */
  goalShort: string;
};

/** 从习惯自身目标解析进度燃料口径；无则 null（选择器应排除） */
export function resolveHabitNativeProgressFuel(
  habit: Pick<HabitRow, 'extra_data'>,
): HabitNativeProgressFuel | null {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'build') {
    const expected = parseBuildHabitExpectedGoal(habit.extra_data);
    if (!expected) return null;
    const mode: HabitNativeProgressFuel['mode'] =
      expected.type === 'times'
        ? 'build_times'
        : expected.type === 'consecutive_days'
          ? 'build_consecutive'
          : 'build_days';
    return {
      mode,
      target: expected.value,
      unitLabel: expected.type === 'times' ? '次' : '天',
      kindLabel: '养成',
      goalShort: formatBuildExpectedGoalShort(expected),
    };
  }
  if (kind === 'break') {
    const consecutive = parseHabitConsecutiveTargetDays(habit.extra_data);
    if (consecutive == null) return null;
    return {
      mode: 'break_consecutive',
      target: consecutive,
      unitLabel: '天',
      kindLabel: '戒除',
      goalShort: `连续 ${consecutive} 天`,
    };
  }
  return null;
}

/** 绑定时写入的 target_days 快照（优先习惯自身目标） */
export function snapshotProgressTargetDaysForHabit(
  habit: Pick<HabitRow, 'extra_data'>,
  fallback = 21,
): number {
  const native = resolveHabitNativeProgressFuel(habit);
  if (native) {
    return Math.min(
      PROGRESS_HABIT_TARGET_DAYS_MAX,
      Math.max(PROGRESS_HABIT_TARGET_DAYS_MIN, native.target),
    );
  }
  return Math.min(
    PROGRESS_HABIT_TARGET_DAYS_MAX,
    Math.max(PROGRESS_HABIT_TARGET_DAYS_MIN, fallback),
  );
}

function evaluateOneBinding(params: {
  binding: ProjectProgressHabitBinding;
  habit: HabitRow | null;
  checkIns: Record<string, number>;
  logicalTodayYmd: string;
  projectCreatedAt?: string | null;
}): ProjectProgressHabitBindingCheck {
  const { binding, habit, checkIns, logicalTodayYmd, projectCreatedAt } = params;
  const sinceYmd = resolveBindingSinceYmd(binding, projectCreatedAt);
  const windowedCheckIns = filterCheckInsSinceYmd(checkIns, sinceYmd);

  if (!habit) {
    return {
      habitId: binding.habitId,
      title: '未知习惯',
      kind: 'unknown',
      mode: 'fallback_days',
      kindLabel: '习惯',
      progressCaption: `达标日 0/${binding.targetDays} 天`,
      unitLabel: '天',
      targetDays: binding.targetDays,
      doneDays: 0,
      missing: true,
      ratio: 0,
    };
  }

  const kind = parseHabitKind(habit.extra_data);
  const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
  const native = resolveHabitNativeProgressFuel(habit);
  const title = habit.name.trim() || '未命名习惯';

  let mode: ProgressFuelMode = 'fallback_days';
  let target = binding.targetDays;
  let done = 0;
  let unitLabel = '天';
  let kindLabel = kind === 'break' ? '戒除' : kind === 'build' ? '养成' : '习惯';

  if (native) {
    mode = native.mode;
    target = native.target;
    unitLabel = native.unitLabel;
    kindLabel = native.kindLabel;
    if (native.mode === 'break_consecutive') {
      done = computeConsecutiveGoalMetDays({
        checkIns: windowedCheckIns,
        endYmd: logicalTodayYmd,
        kind: 'break',
        dailyGoal,
        logicalTodayYmd,
        maxLookback: Math.max(target, 1),
        minYmd: sinceYmd ?? null,
      });
    } else {
      const expected = parseBuildHabitExpectedGoal(habit.extra_data)!;
      done = computeBuildExpectedGoalProgress({
        expectedGoal: expected,
        checkIns: windowedCheckIns,
        dailyGoal,
        endYmd: logicalTodayYmd,
        kind: 'build',
      });
    }
  } else {
    done = countHabitProgressGoalMetDays(habit, windowedCheckIns, logicalTodayYmd);
  }

  const cappedDone = Math.min(target, Math.max(0, done));
  const ratio = target > 0 ? Math.min(1, cappedDone / target) : 0;
  const progressCaption =
    mode === 'break_consecutive' || mode === 'build_consecutive'
      ? `${kindLabel}连续 ${cappedDone}/${target} ${unitLabel}`
      : mode === 'build_times'
        ? `${kindLabel} ${cappedDone}/${target} ${unitLabel}`
        : mode === 'fallback_days'
          ? `达标日 ${cappedDone}/${target} ${unitLabel}`
          : `${kindLabel} ${cappedDone}/${target} ${unitLabel}`;

  return {
    habitId: binding.habitId,
    title,
    kind,
    mode,
    kindLabel,
    progressCaption,
    unitLabel,
    targetDays: target,
    doneDays: cappedDone,
    missing: false,
    ratio,
  };
}

function emptyEvaluation(
  bindings: ProjectProgressHabitBinding[] = [],
): ProjectProgressHabitsEvaluation {
  return {
    bindings,
    checks: [],
    doneDays: 0,
    targetDays: 0,
    ratio: null,
    full: false,
  };
}

/**
 * 列表占位：有绑定但评价尚未回填时，立刻画出 0 进度轨（避免「不打卡就不显示」）。
 */
export function buildProgressHabitsPlaceholderEvaluation(
  extraData: string | null | undefined,
): ProjectProgressHabitsEvaluation | null {
  const bindings = parseProgressHabitBindings(extraData);
  if (bindings.length === 0) return null;
  const checks: ProjectProgressHabitBindingCheck[] = bindings.map((b) => ({
    habitId: b.habitId,
    title: '习惯',
    kind: 'unknown',
    mode: 'fallback_days',
    kindLabel: '习惯',
    progressCaption: `达标日 0/${b.targetDays} 天`,
    unitLabel: '天',
    targetDays: b.targetDays,
    doneDays: 0,
    missing: false,
    ratio: 0,
  }));
  const targetDays = checks.reduce((s, c) => s + c.targetDays, 0);
  return {
    bindings,
    checks,
    doneDays: 0,
    targetDays,
    ratio: 0,
    full: false,
  };
}

export async function evaluateProjectProgressHabits(
  extraData: string | null | undefined,
  opts?: {
    logicalTodayYmd?: string;
    habitById?: ReadonlyMap<string, HabitRow | null>;
    checkInsByHabitId?: ReadonlyMap<string, Record<string, number>>;
    /** 旧数据无 since_ymd 时，用项目创建日落成计入起点 */
    projectCreatedAt?: string | null;
  },
): Promise<ProjectProgressHabitsEvaluation> {
  const bindings = parseProgressHabitBindings(extraData);
  if (bindings.length === 0) return emptyEvaluation();

  let logicalTodayYmd = opts?.logicalTodayYmd;
  if (!logicalTodayYmd) {
    const boundary = await loadTasksDayBoundary();
    logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
  }

  const checks: ProjectProgressHabitBindingCheck[] = [];
  for (const binding of bindings) {
    const habit =
      opts?.habitById?.has(binding.habitId)
        ? (opts.habitById.get(binding.habitId) ?? null)
        : await getHabitById(binding.habitId);
    const checkIns =
      opts?.checkInsByHabitId?.get(binding.habitId) ??
      (await getCheckInsMapByHabitId(binding.habitId));
    checks.push(
      evaluateOneBinding({
        binding,
        habit,
        checkIns,
        logicalTodayYmd,
        projectCreatedAt: opts?.projectCreatedAt,
      }),
    );
  }

  const usable = checks.filter((c) => c.targetDays > 0);
  if (usable.length === 0) {
    return {
      bindings,
      checks,
      doneDays: 0,
      targetDays: 0,
      ratio: null,
      full: false,
    };
  }

  const sumDone = usable.reduce((s, c) => s + c.doneDays, 0);
  const sumTarget = usable.reduce((s, c) => s + c.targetDays, 0);
  const ratio =
    usable.reduce((s, c) => s + c.ratio, 0) / usable.length;
  const full = usable.every((c) => c.ratio >= 1);

  return {
    bindings,
    checks,
    doneDays: sumDone,
    targetDays: sumTarget,
    ratio: Math.min(1, ratio),
    full,
  };
}

export function formatProjectProgressHabitsFullMessage(
  updates: readonly ProjectProgressHabitsNotifyUpdate[],
): string {
  const full = updates.filter((u) => u.becameFull);
  if (full.length === 0) return '';
  if (full.length === 1) {
    return `「${full[0].projectName}」习惯进度已满，可考虑结案`;
  }
  const names = full.map((u) => `「${u.projectName}」`).join('、');
  return `${names}习惯进度已满，可考虑结案`;
}

function isActiveProject(project: ProjectRow): boolean {
  return project.status !== 'completed' && project.status !== 'archived';
}

/**
 * 习惯打卡（或撤销）后：重算绑定了该习惯的活跃项目进度。
 * 不归档、不写履历。silent 时只更新缓存（撤销回落），不标 becameFull。
 */
export async function notifyProjectsProgressHabitsAfterCheckIn(
  habitId: string,
  options?: {
    logicalTodayYmd?: string;
    /** 撤销打卡等：只重算，不产生「刚满」提示 */
    silent?: boolean;
  },
): Promise<ProjectProgressHabitsNotifyResult> {
  const trimmed = habitId.trim();
  if (!trimmed) return { updates: [] };

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd =
    options?.logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);

  const projects = await getProjects();
  const candidates = projects.filter(
    (p) => isActiveProject(p) && projectHasProgressHabit(p.extra_data, trimmed),
  );
  if (candidates.length === 0) return { updates: [] };

  const habitIds = new Set<string>();
  for (const project of candidates) {
    for (const b of parseProgressHabitBindings(project.extra_data)) {
      habitIds.add(b.habitId);
    }
  }

  const habitById = new Map<string, HabitRow | null>();
  const checkInsByHabitId = new Map<string, Record<string, number>>();
  await Promise.all(
    [...habitIds].map(async (id) => {
      habitById.set(id, await getHabitById(id));
      checkInsByHabitId.set(id, await getCheckInsMapByHabitId(id));
    }),
  );

  const updates: ProjectProgressHabitsNotifyUpdate[] = [];
  for (const project of candidates) {
    try {
      const evaluation = await evaluateProjectProgressHabits(project.extra_data, {
        logicalTodayYmd,
        habitById,
        checkInsByHabitId,
        projectCreatedAt: project.created_at,
      });
      if (evaluation.ratio == null && evaluation.checks.length === 0) continue;

      const wasFull = lastFullByProjectId.get(project.id) === true;
      let becameFull = false;
      if (options?.silent) {
        lastFullByProjectId.set(project.id, evaluation.full);
      } else if (evaluation.full && !wasFull) {
        becameFull = true;
        lastFullByProjectId.set(project.id, true);
      } else {
        lastFullByProjectId.set(project.id, evaluation.full);
      }

      updates.push({
        projectId: project.id,
        projectName: project.name.trim() || '未命名项目',
        evaluation,
        becameFull,
      });
    } catch (err) {
      console.warn('项目习惯进度重算失败', project.id, err);
    }
  }

  return { updates };
}

/** 测试或登出时可清「刚满」缓存 */
export function clearProjectProgressHabitsFullCache(): void {
  lastFullByProjectId.clear();
}

/** 可否作为项目进度燃料：养成 / 戒除均可（有无自身目标走双轨）；周期配额不纳入 */
export function isHabitEligibleForProjectProgress(habit: Pick<HabitRow, 'extra_data'>): boolean {
  const kind = parseHabitKind(habit.extra_data);
  return kind === 'build' || kind === 'break';
}

/** 供选择器：全部养成/戒除；已选中的仍保留以便取消（含已改成配额的） */
export function filterHabitsForProjectProgressPicker(
  habits: HabitRow[],
  selectedIds: readonly string[],
): HabitRow[] {
  const selected = new Set(selectedIds);
  return habits.filter((h) => selected.has(h.id) || isHabitEligibleForProjectProgress(h));
}

export type ProgressHabitBindingsSaveValidation =
  | { ok: true; bindings: ProjectProgressHabitBinding[] }
  | { ok: false; message: string };

/** 保存前校验：须有合法快照天数；空列表合法；保留 sinceYmd */
export function validateProgressHabitBindingsForSave(
  bindings: readonly {
    habitId: string;
    targetDays: number | string;
    sinceYmd?: string;
  }[],
): ProgressHabitBindingsSaveValidation {
  if (bindings.length === 0) return { ok: true, bindings: [] };
  const seen = new Set<string>();
  const next: ProjectProgressHabitBinding[] = [];
  for (const row of bindings) {
    const habitId = typeof row.habitId === 'string' ? row.habitId.trim() : '';
    if (!habitId) {
      return { ok: false, message: '推进进度习惯无效，请重新选择。' };
    }
    if (seen.has(habitId)) continue;
    seen.add(habitId);
    const targetDays = clampTargetDays(row.targetDays);
    if (targetDays == null) {
      return {
        ok: false,
        message: '推进进度的目标天数须为 1～365 的整数。',
      };
    }
    const sinceYmd = parseSinceYmd(row.sinceYmd);
    next.push({
      habitId,
      targetDays,
      ...(sinceYmd ? { sinceYmd } : {}),
    });
  }
  return { ok: true, bindings: next };
}

export function formatProjectProgressHabitsRemainMessage(
  evaluation: ProjectProgressHabitsEvaluation,
): string {
  if (evaluation.ratio == null || evaluation.full) return '';
  const parts = evaluation.checks
    .filter((c) => !c.missing && c.ratio < 1)
    .map((c) => {
      const remain = Math.max(0, c.targetDays - c.doneDays);
      if (c.mode === 'break_consecutive' || c.mode === 'build_consecutive') {
        return `${c.title}连续 ${remain}${c.unitLabel}`;
      }
      return `${c.title} ${remain}${c.unitLabel}`;
    });
  if (parts.length === 0) return '';
  return `任务与结案条件已齐，习惯进度还差：${parts.join('、')}`;
}

/**
 * 列表页批量评价：预热 habit / 打卡 map，避免 N+1。
 * 仅对含 progress_habit_bindings 的项目写入结果；无绑定不占位。
 */
export async function evaluateProjectsProgressHabitsMap(
  projects: readonly ProjectRow[],
  opts?: { logicalTodayYmd?: string },
): Promise<Map<string, ProjectProgressHabitsEvaluation>> {
  const result = new Map<string, ProjectProgressHabitsEvaluation>();
  const withBindings = projects.filter(
    (p) => parseProgressHabitBindings(p.extra_data).length > 0,
  );
  if (withBindings.length === 0) return result;

  let logicalTodayYmd = opts?.logicalTodayYmd;
  if (!logicalTodayYmd) {
    const boundary = await loadTasksDayBoundary();
    logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
  }

  const habitIds = new Set<string>();
  for (const project of withBindings) {
    for (const b of parseProgressHabitBindings(project.extra_data)) {
      habitIds.add(b.habitId);
    }
  }

  const habitById = new Map<string, HabitRow | null>();
  const checkInsByHabitId = new Map<string, Record<string, number>>();
  await Promise.all(
    [...habitIds].map(async (id) => {
      habitById.set(id, await getHabitById(id));
      checkInsByHabitId.set(id, await getCheckInsMapByHabitId(id));
    }),
  );

  await Promise.all(
    withBindings.map(async (project) => {
      try {
        const evaluation = await evaluateProjectProgressHabits(project.extra_data, {
          logicalTodayYmd,
          habitById,
          checkInsByHabitId,
          projectCreatedAt: project.created_at,
        });
        // 零进度 ratio=0 也要写入，否则未打卡时列表不出轨
        if (evaluation.checks.length > 0 || evaluation.ratio != null) {
          result.set(project.id, evaluation);
        }
      } catch (err) {
        console.warn('批量评价项目习惯进度失败', project.id, err);
      }
    }),
  );

  return result;
}
