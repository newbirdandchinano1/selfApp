import { getDepositSumsByActivePlanId } from '@/lib/repositories/savings-plan/savings-plan-deposit';
import { getSavingsPlans } from '@/lib/repositories/savings-plan/savings-plan';
import type { SavingsPlanRow } from '@/lib/repositories/savings-plan/savings-plan.types';
import { formatVisionAmount } from '@/lib/repositories/visions/vision-amount';
import { visionRowToWallCard } from '@/lib/repositories/visions/vision-present';
import { listGoalDimensions } from '@/lib/repositories/goal-dimensions/goal-dimension';
import { listVisions, parseVisionExtra } from '@/lib/repositories/visions/vision';
import {
  collectLinkedProjectsFromSubGoal,
  collectVisionSubGoalsFromExtra,
  isBoundVisionSubGoalTaskComplete,
  isStandaloneVisionSubGoal,
  standaloneSubGoalTaskStats,
} from '@/lib/repositories/visions/vision.types';
import type { VisionRow, VisionTrackKind } from '@/lib/repositories/visions/vision.types';
import type { VisionWallCardModel } from '@/lib/visions-registry';
import { getTaskCompletionStatsByProjectIds } from '@/lib/repositories/tasks/task';

export type VisionWallPlanKind = 'vision' | 'savings_plan' | 'sub_goal';

export type VisionWallPlanItem = {
  goal_id: string;
  kind: VisionWallPlanKind;
  title: string;
  dimension: string;
  track_kind: string;
  deadline_ymd: string;
  remain_label: string;
  progress_summary: string;
  parent_vision_id?: string;
};

export type VisionWallPlanContext = {
  today_ymd: string;
  default_deadline_ymd: string;
  plans: VisionWallPlanItem[];
  digest_text: string;
  fingerprint: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getYearEndYmd(year?: number): string {
  const y = year ?? new Date().getFullYear();
  return `${y}-12-31`;
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function calendarDaysBetween(startYmd: string, endYmd: string): number {
  const s = parseYmd(startYmd);
  const e = parseYmd(endYmd);
  if (!s || !e) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000);
}

/** 计划剩余完成时间（默认截止日为当年 12-31，倒数日类用其 endDate） */
export function formatPlanRemainLabel(deadlineYmd: string, todayYmd?: string): string {
  const today = todayYmd ?? formatLocalYmd(new Date());
  const ahead = calendarDaysBetween(today, deadlineYmd);
  if (ahead > 0) return `还有 ${ahead} 天（截止 ${deadlineYmd}）`;
  if (ahead === 0) return `今天截止（${deadlineYmd}）`;
  const past = calendarDaysBetween(deadlineYmd, today);
  return `已过期 ${past} 天（截止 ${deadlineYmd}）`;
}

export function resolveVisionPlanDeadlineYmd(
  row: VisionRow,
  extra: ReturnType<typeof parseVisionExtra>,
  year?: number,
): string {
  if (row.track_kind === 'countdown' && extra?.endDate?.trim()) {
    return extra.endDate.trim();
  }
  return getYearEndYmd(year);
}

const TRACK_KIND_ZH: Record<VisionTrackKind, string> = {
  progress: '进度追踪',
  count: '计数',
  countdown: '倒数日',
  target: '目标',
};

function summarizeVisionCard(row: VisionRow, card: VisionWallCardModel, extra: NonNullable<ReturnType<typeof parseVisionExtra>>): string {
  switch (card.kind) {
    case 'progress':
      return `完成度 ${card.percentText}（${card.rightValue}）`;
    case 'count':
      return `${card.leftKicker} ${card.leftValue}；${card.rightKicker} ${card.rightValue}`;
    case 'target':
      return `完成度 ${card.percentText}${card.isComplete ? '（已达成）' : ''}`;
    case 'countdown':
      return card.countdownKind === 'countup'
        ? `记录日 ${card.dateText}；${card.remainText}`
        : `截止 ${card.dateText}；${card.remainText}`;
    default:
      return row.description?.trim() || '—';
  }
}

async function subGoalProgressSummary(sg: ReturnType<typeof collectVisionSubGoalsFromExtra>[number]): Promise<string> {
  const linked = collectLinkedProjectsFromSubGoal(sg);
  const ids = linked.map(p => p.id);
  if (ids.length > 0) {
    const stats = await getTaskCompletionStatsByProjectIds(ids);
    if (stats.total > 0) {
      const pct = Math.round((stats.completed / stats.total) * 100);
      const done = isBoundVisionSubGoalTaskComplete(stats) ? '，已全部完成' : '';
      return `绑定 ${linked.length} 个项目，任务 ${stats.completed}/${stats.total}（${pct}%）${done}`;
    }
    return `绑定 ${linked.length} 个项目，暂无任务`;
  }
  if (sg.done) return '独立小目标，已手动完成';
  return '独立小目标，未完成';
}

function summarizeSavingsPlan(row: SavingsPlanRow, saved: number): string {
  const target = Math.max(0, row.target_amount);
  const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  return `已存 ¥${formatVisionAmount(saved)} / 目标 ¥${formatVisionAmount(target)}（${pct}%）`;
}

function buildFingerprint(plans: VisionWallPlanItem[]): string {
  return JSON.stringify(
    plans.map(p => ({
      id: p.goal_id,
      d: p.deadline_ymd,
      r: p.remain_label,
      p: p.progress_summary,
    })),
  );
}

function buildDigestText(plans: VisionWallPlanItem[], todayYmd: string, defaultDeadline: string): string {
  const lines: string[] = [
    `评估基准日：${todayYmd}`,
    `默认计划截止日（未单独设置者）：${defaultDeadline}`,
    `计划条目数：${plans.length}`,
    '',
  ];
  for (const p of plans) {
    lines.push(
      `【${p.kind === 'savings_plan' ? '存钱计划' : p.kind === 'sub_goal' ? '小目标' : '总目标'}】${p.title}`,
      `goal_id：${p.goal_id}`,
      `所属维度：${p.dimension}`,
      `追踪类型：${p.track_kind}`,
      `截止日：${p.deadline_ymd}`,
      `剩余完成时间：${p.remain_label}`,
      `进度：${p.progress_summary}`,
      p.parent_vision_id ? `父总目标 id：${p.parent_vision_id}` : '',
      '---',
    );
  }
  return lines.filter(Boolean).join('\n');
}

export async function buildVisionWallPlanContext(): Promise<VisionWallPlanContext> {
  const today = new Date();
  const todayYmd = formatLocalYmd(today);
  const defaultDeadline = getYearEndYmd(today.getFullYear());

  const [visionRows, dimensions, savingsRows, depositSums] = await Promise.all([
    listVisions(),
    listGoalDimensions(),
    getSavingsPlans(),
    getDepositSumsByActivePlanId(),
  ]);

  const dimTitleById = new Map(dimensions.map(d => [d.id, d.title.trim()]));

  const plans: VisionWallPlanItem[] = [];

  for (const row of visionRows) {
    const extra = parseVisionExtra(row.extra_data) ?? {};
    const card = await visionRowToWallCard(row);
    const dimensionId = extra.dimensionId?.trim();
    const dimension =
      (dimensionId && dimTitleById.get(dimensionId)) ||
      extra.dimensionName?.trim() ||
      '未归类';
    const deadline = resolveVisionPlanDeadlineYmd(row, extra, today.getFullYear());
    const remain =
      row.track_kind === 'countdown' && card.kind === 'countdown'
        ? card.remainText
        : formatPlanRemainLabel(deadline, todayYmd);

    plans.push({
      goal_id: row.id,
      kind: 'vision',
      title: row.title.trim() || '未命名总目标',
      dimension,
      track_kind: TRACK_KIND_ZH[row.track_kind] ?? row.track_kind,
      deadline_ymd: deadline,
      remain_label: remain,
      progress_summary: summarizeVisionCard(row, card, extra),
    });

    const subGoals = collectVisionSubGoalsFromExtra(extra);
    for (const sg of subGoals) {
      const sgDeadline = defaultDeadline;
      let sgProgress = '';
      if (isStandaloneVisionSubGoal(sg)) {
        const st = standaloneSubGoalTaskStats(sg);
        sgProgress = sg.done ? '独立小目标，已完成' : '独立小目标，未完成';
      } else {
        sgProgress = await subGoalProgressSummary(sg);
      }
      plans.push({
        goal_id: `${row.id}::${sg.id}`,
        kind: 'sub_goal',
        title: sg.name.trim() || '未命名小目标',
        dimension,
        track_kind: '小目标',
        deadline_ymd: sgDeadline,
        remain_label: formatPlanRemainLabel(sgDeadline, todayYmd),
        progress_summary: sgProgress,
        parent_vision_id: row.id,
      });
    }
  }

  for (const sp of savingsRows) {
    const saved = depositSums[sp.id] ?? 0;
    const deadline = sp.end_date?.trim() || defaultDeadline;
    plans.push({
      goal_id: `savings:${sp.id}`,
      kind: 'savings_plan',
      title: sp.name.trim() || '存钱计划',
      dimension: '财务 · 存钱计划',
      track_kind: '储蓄',
      deadline_ymd: deadline,
      remain_label: formatPlanRemainLabel(deadline, todayYmd),
      progress_summary: summarizeSavingsPlan(sp, saved),
    });
  }

  const digest_text = buildDigestText(plans, todayYmd, defaultDeadline);
  return {
    today_ymd: todayYmd,
    default_deadline_ymd: defaultDeadline,
    plans,
    digest_text,
    fingerprint: buildFingerprint(plans),
  };
}
