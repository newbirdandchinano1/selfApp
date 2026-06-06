/**
 * App → 自建后端 /api/ai/*（智谱 Key 仅存服务端）。
 * 规范见项目根目录 AI_API.md。
 */

import { apiRequest } from '@/lib/api-client';

import type {
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FoodNutritionJson,
  FoodTextIntakeJson,
  PersonaPortraitAiData,
  UserSkillAiPortfolioPayload,
  VisionWallAiAssessmentPayload,
} from '@/lib/ai-types';

const AI_PREFIX = '/api/ai';

export type AiHealthData = {
  ok: boolean;
  model: string;
  latency_ms: number;
};

export type FinanceOneLinerAccountHint = {
  name: string;
  account_no?: string | null;
};

export type FinanceOneLinerJson = {
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  category_label: string | null;
  payment_account_label: string | null;
  account_name: string | null;
  is_bill?: boolean;
  /** 截图记账：账单上的消费/支付时间（ISO8601 或常见中文日期时间） */
  happened_at?: string | null;
  consumption_time?: string | null;
  paid_at?: string | null;
  transaction_time?: string | null;
  payment_time?: string | null;
};

export async function aiGetHealth(): Promise<AiHealthData> {
  return apiRequest<AiHealthData>(`${AI_PREFIX}/health`, { method: 'GET' });
}

export async function aiFoodIntakeFromText(body: {
  text: string;
  question?: string;
}): Promise<FoodTextIntakeJson> {
  return apiRequest(`${AI_PREFIX}/food/intake-from-text`, { method: 'POST', body });
}

export async function aiFoodNutritionFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
}): Promise<FoodNutritionJson> {
  return apiRequest(`${AI_PREFIX}/food/nutrition-from-image`, { method: 'POST', body });
}

export async function aiFoodDailyTargets(body: { context_block: string }): Promise<DailyIntakeTargetsEstimateJson> {
  return apiRequest(`${AI_PREFIX}/food/daily-targets`, { method: 'POST', body });
}

export async function aiFinanceParseOneLiner(body: {
  text: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceOneLinerJson> {
  return apiRequest(`${AI_PREFIX}/finance/parse-one-liner`, { method: 'POST', body });
}

export async function aiFinanceParseOneLinerFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceOneLinerJson> {
  return apiRequest(`${AI_PREFIX}/finance/parse-one-liner-from-image`, { method: 'POST', body });
}

export async function aiFinanceTxnComment(body: { summary_text: string }): Promise<{ comment: string }> {
  return apiRequest(`${AI_PREFIX}/finance/txn-comment`, { method: 'POST', body });
}

export async function aiFinanceBillSummaryAnalysis(body: { summary_text: string }): Promise<{ analysis: string }> {
  return apiRequest(`${AI_PREFIX}/finance/bill-summary-analysis`, { method: 'POST', body });
}

export async function aiFinanceDashboardAnalysis(body: {
  summary_text: string;
  past6_net_savings?: number[];
  past6_income?: number[];
}): Promise<AiFinanceDashboardPayload> {
  return apiRequest(`${AI_PREFIX}/finance/dashboard-analysis`, { method: 'POST', body });
}

export async function aiFinanceCashFlowAnalysis(body: { summary_text: string }): Promise<{ analysis: string }> {
  return apiRequest(`${AI_PREFIX}/finance/cash-flow-analysis`, { method: 'POST', body });
}

export async function aiWishListRationalReview(body: { context_text: string }): Promise<{
  headline: string;
  review: string;
}> {
  return apiRequest(`${AI_PREFIX}/wish-list/rational-review`, { method: 'POST', body });
}

export async function aiWishItemComment(body: { summary_text: string }): Promise<{ comment: string }> {
  return apiRequest(`${AI_PREFIX}/wish-item/comment`, { method: 'POST', body });
}

export async function aiMemoReview(body: { memo_context_text: string }): Promise<{
  evaluation: string;
  suggestions: string;
}> {
  return apiRequest(`${AI_PREFIX}/memo/review`, { method: 'POST', body });
}

export async function aiProjectTasksReview(body: { project_context_text: string }): Promise<{
  evaluation: string;
  suggestions: string;
}> {
  return apiRequest(`${AI_PREFIX}/project/tasks-review`, { method: 'POST', body });
}

export async function aiWeaknessReview(body: { weakness_context_text: string }): Promise<{
  evaluation: string;
  suggestions: string;
}> {
  return apiRequest(`${AI_PREFIX}/weakness/review`, { method: 'POST', body });
}

export async function aiWeeklyReviewCoaching(body: { user_prompt: string }): Promise<{ text: string }> {
  return apiRequest(`${AI_PREFIX}/weekly-review/coaching`, { method: 'POST', body });
}

export async function aiPersonaPortrait(body: {
  persona_slug: string;
  context_text: string;
}): Promise<PersonaPortraitAiData> {
  return apiRequest(`${AI_PREFIX}/persona/portrait`, { method: 'POST', body });
}

export async function aiVisionWallAssessment(body: {
  plan_digest_text: string;
  expected_goal_ids: string[];
  user_display_name?: string;
}): Promise<VisionWallAiAssessmentPayload> {
  return apiRequest(`${AI_PREFIX}/vision-wall/assessment`, { method: 'POST', body });
}

export async function aiSkillsPortfolio(body: {
  user_display_name: string;
  lines: { skill_id: string; dimension: string; name: string; description: string }[];
}): Promise<UserSkillAiPortfolioPayload> {
  return apiRequest(`${AI_PREFIX}/skills/portfolio`, { method: 'POST', body });
}

/** 拆分 data URI 或纯 Base64，供图片类接口使用 */
export function splitImageBase64AndMime(
  input: string,
  defaultMime = 'image/jpeg',
): { image_base64: string; image_mime_type: string } {
  const s = input.trim();
  const m = s.match(/^data:([^;]+);base64,(.+)$/is);
  if (m) {
    const image_mime_type = (m[1] || defaultMime).trim() || defaultMime;
    return { image_mime_type, image_base64: m[2].replace(/\s/g, '') };
  }
  return { image_mime_type: defaultMime, image_base64: s.replace(/\s/g, '') };
}
