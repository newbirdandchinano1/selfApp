import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { totalFilledLength } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';
import { generateWeeklyReviewCoachingFromText } from '@/lib/zhipu-image-parse';

export type WeeklyCoachingSection = {
  dimensionTitle: string;
  columns: { title: string; value: string }[];
};

export type WeeklyCoachingInput = {
  weekRangeLabel: string;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
  executionScore: number;
  metrics: WeeklyReviewMetrics | null;
  /** 近七日每日复盘原文汇编，供周度建议对照 */
  dailyReviewsDigest?: string;
};

function buildMetricsBlock(m: WeeklyReviewMetrics | null): string {
  if (!m) return '（本周期暂无自动统计数据或读取失败。）';
  return [
    `完成任务（系统）: ${m.tasksCompleted} 项`,
    `新建任务（系统）: ${m.tasksCreated} 项`,
    `习惯打卡合计: ${m.habitCheckInTotal} 次`,
    `存钱入账: ¥${m.savingsWeekTotal.toLocaleString('zh-CN')}`,
    `记账收入: ¥${m.financeIncome.toLocaleString('zh-CN')}，支出: ¥${m.financeExpense.toLocaleString('zh-CN')}`,
  ].join('\n');
}

function buildSections(input: WeeklyCoachingInput): WeeklyCoachingSection[] {
  const out: WeeklyCoachingSection[] = [];
  for (const dim of input.template) {
    const columns = dim.columns.map(col => ({
      title: col.title,
      value: input.fields[col.id] ?? '',
    }));
    out.push({ dimensionTitle: dim.title, columns });
  }
  return out;
}

/** 仅走 Agent 云端；失败直接抛错，不做本地模板兜底 */
export async function generateWeeklyReviewCoaching(input: WeeklyCoachingInput): Promise<string> {
  const dimensions = buildSections(input).map(sec => ({
    title: sec.dimensionTitle,
    columns: sec.columns,
  }));
  const remote = await generateWeeklyReviewCoachingFromText({
    reviewType: 'weekly',
    periodLabel: input.weekRangeLabel,
    dimensions,
    metricsText: buildMetricsBlock(input.metrics),
    relatedDigest: input.dailyReviewsDigest,
    executionScore: input.executionScore,
  });
  if (remote.ok) return remote.text;
  throw new Error(remote.error || 'AI 分析失败，请检查网络后重试');
}

/** 供 UI 校验最低填写量 */
export function weeklyReviewHasEnoughText(template: ReviewDimensionTemplate[], fields: ReviewFieldValues): boolean {
  return totalFilledLength(fields) >= 30;
}
