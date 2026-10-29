import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  areAllReviewDimensionsFilled,
  countFilledReviewDimensions,
  totalFilledLength,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { generateWeeklyReviewCoachingFromText } from '@/lib/zhipu-image-parse';

export type ReviewAiScope = 'daily' | 'weekly' | 'monthly';

export type ReviewAiAnalysisInput = {
  scope: ReviewAiScope;
  periodLabel: string;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
};

function buildDimensions(input: ReviewAiAnalysisInput) {
  return input.template.map(dim => ({
    title: dim.title,
    columns: dim.columns.map(col => ({
      title: col.title,
      value: input.fields[col.id] ?? '',
    })),
  }));
}

/** 仅走 Agent 云端；失败直接抛错，不做本地模板兜底 */
export async function generateReviewAiAnalysis(input: ReviewAiAnalysisInput): Promise<string> {
  const r = await generateWeeklyReviewCoachingFromText({
    reviewType: input.scope,
    periodLabel: input.periodLabel,
    dimensions: buildDimensions(input),
  });
  if (r.ok) return r.text;
  throw new Error(r.error || 'AI 分析失败，请检查网络后重试');
}

export function reviewHasEnoughTextForAi(fields: ReviewFieldValues): boolean {
  return totalFilledLength(fields) >= 30;
}

export type ReviewAiGateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * 日复盘 AI 门禁：须全部维度格子写完，且正文约满 30 字。
 * 周/月复盘仍以字数为主（不强制「格子全满」）。
 */
export function reviewCanRunAiAnalysis(opts: {
  scope: ReviewAiScope;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
}): ReviewAiGateResult {
  if (opts.scope === 'daily') {
    if (!areAllReviewDimensionsFilled(opts.template, opts.fields)) {
      const { filled, total } = countFilledReviewDimensions(opts.template, opts.fields);
      return {
        ok: false,
        reason: `请先写完今日全部复盘格子（${filled}/${total}），再生成 AI 分析`,
      };
    }
  }
  if (!reviewHasEnoughTextForAi(opts.fields)) {
    return { ok: false, reason: '内容偏少，请先写满约 30 字再生成' };
  }
  return { ok: true };
}
