/**
 * AI 能力门面：请求统一走自建后端 /api/ai/*（见 AI_API.md）。
 * 保留与原 `lib/zhipu-image-parse.ts` 相同的函数签名与 `{ ok, ... }` 返回形态，便于 App 各页无痛迁移。
 */

import { ApiRequestError } from '@/lib/api-client';
import * as aiApi from '@/lib/ai-api-client';
import { extractBillHappenedAtFromAiJson } from '@/lib/finance-bill-happened-at';

export type {
  AiFinanceDashboardInsight,
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FoodNutritionJson,
  FoodTextIntakeJson,
  PersonaPortraitAiData,
  UserSkillAiPortfolioPayload,
  UserSkillAiPortfolioSkillRow,
  VisionWallAiAssessmentPayload,
  VisionWallAiPerGoalRow,
  VisionWallAiSection,
} from '@/lib/ai-types';

import type {
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FoodNutritionJson,
  FoodTextIntakeJson,
  PersonaPortraitAiData,
  UserSkillAiPortfolioPayload,
  VisionWallAiAssessmentPayload,
} from '@/lib/ai-types';

const FOOD_NUTRITION_FALLBACK: FoodNutritionJson = {
  is_food: 0,
  non_food_code: 2,
  food_name: '',
  ai_evaluation: '',
  protein_g: 0,
  carbohydrate_g: 0,
  sodium_mg: 0,
};

/** 极小 JPEG（约几十字节），用于调试页连通性测试 */
export const TINY_TEST_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

export const PERSONA_PORTRAIT_OVERVIEW_MIN_LEN = 280;
export const PERSONA_PORTRAIT_OVERVIEW_TARGET_MAX_LEN = 420;
export const PERSONA_PORTRAIT_BULLET_MIN_COUNT = 4;
export const PERSONA_PORTRAIT_BULLET_MAX_COUNT = 6;
export const PERSONA_PORTRAIT_BULLET_MIN_EACH = 28;

/** @deprecated 智谱 Key 已迁至服务端；保留兼容，恒为空 */
export function getZhipuApiKeyFromEnv(): string {
  return '';
}

/** @deprecated 请使用后端 AI；保留兼容 */
export function getZhipuApiKey(): string {
  return '';
}

/** 服务端 AI 可用（不再依赖客户端智谱 Key） */
export function getActiveAiLlmApiKey(): string {
  return isActiveAiLlmConfigured() ? 'server' : '';
}

export function isActiveAiLlmConfigured(): boolean {
  return true;
}

export type ZhipuConnectivityProbeResult = {
  httpStatus: number;
  httpOk: boolean;
  bodySnippet: string;
};

/** 探测后端 → 智谱链路（GET /api/ai/health） */
export async function probeZhipuTextConnectivity(_apiKey?: string): Promise<ZhipuConnectivityProbeResult> {
  try {
    const data = await aiApi.aiGetHealth();
    return {
      httpStatus: 200,
      httpOk: true,
      bodySnippet: JSON.stringify(data, null, 2),
    };
  } catch (e) {
    const httpStatus = e instanceof ApiRequestError ? e.httpStatus : 0;
    const bodySnippet = e instanceof Error ? e.message : String(e);
    return { httpStatus, httpOk: false, bodySnippet };
  }
}

function mapApiError(e: unknown): { error: string; httpStatus?: number; details?: unknown } {
  if (e instanceof ApiRequestError) {
    return { error: e.message, httpStatus: e.httpStatus };
  }
  return { error: e instanceof Error ? e.message : String(e) };
}

function rejectNoApiKey(attempts = 0): { ok: false; error: string; attempts: number } {
  return { ok: false, error: '未配置服务器 AI（请先登录服务器同步）', attempts };
}

function ensureApiKeyOption(apiKey: string): boolean {
  return Boolean(apiKey.trim()) || isActiveAiLlmConfigured();
}

// --- 饮食 ---

export type ParseFoodIntakeFromTextOptions = {
  apiKey: string;
  text: string;
  question?: string;
};

export type ParseFoodIntakeFromTextResult =
  | { ok: true; data: FoodTextIntakeJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function parseFoodIntakeFromText(
  options: ParseFoodIntakeFromTextOptions,
): Promise<ParseFoodIntakeFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.text.trim();
  if (!text) return { ok: false, error: '描述为空', attempts: 0 };
  try {
    const data = await aiApi.aiFoodIntakeFromText({ text, question: options.question });
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type EstimateDailyIntakeTargetsFromContextOptions = {
  apiKey: string;
  contextBlock: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type EstimateDailyIntakeTargetsFromContextResult =
  | { ok: true; data: DailyIntakeTargetsEstimateJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function estimateDailyIntakeTargetsFromContext(
  options: EstimateDailyIntakeTargetsFromContextOptions,
): Promise<EstimateDailyIntakeTargetsFromContextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const context = options.contextBlock.trim();
  if (!context) return { ok: false, error: '上下文为空', attempts: 0 };
  try {
    const data = await aiApi.aiFoodDailyTargets({ context_block: context });
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFoodNutritionOptions = {
  apiKey: string;
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeFoodNutritionResult =
  | { ok: true; data: FoodNutritionJson; attempts: number; rawContent: string; repaired: boolean }
  | {
      ok: false;
      error: string;
      attempts: number;
      httpStatus?: number;
      data: FoodNutritionJson;
    };

function toNonNegativeFiniteNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''));
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function toIsFoodFlag(v: unknown): 0 | 1 {
  if (v === 1 || v === true) return 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return 1;
  }
  return 0;
}

function toNonFoodCode(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : Number(String(v).trim());
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(0, Math.round(n)));
}

export function normalizeFoodNutritionPayload(raw: unknown): { data: FoodNutritionJson; repaired: boolean } {
  let repaired = false;
  if (typeof raw !== 'object' || raw === null) {
    return { data: { ...FOOD_NUTRITION_FALLBACK }, repaired: true };
  }
  const o = raw as Record<string, unknown>;
  const is_food = toIsFoodFlag(o.is_food);
  let non_food_code = toNonFoodCode(o.non_food_code);
  let food_name =
    typeof o.food_name === 'string'
      ? o.food_name.trim()
      : o.food_name != null
        ? String(o.food_name).trim()
        : '';
  let ai_evaluation =
    typeof o.ai_evaluation === 'string'
      ? o.ai_evaluation.trim()
      : o.ai_evaluation != null
        ? String(o.ai_evaluation).trim()
        : '';
  let protein_g = toNonNegativeFiniteNumber(o.protein_g);
  let carbohydrate_g = toNonNegativeFiniteNumber(o.carbohydrate_g ?? o.carb_g ?? o.carbs_g);
  if (o.carbohydrate_g === undefined && (o.carb_g !== undefined || o.carbs_g !== undefined)) repaired = true;
  let sodium_mg = toNonNegativeFiniteNumber(o.sodium_mg ?? o.sodium);

  if (is_food === 1) {
    if (non_food_code !== 0) repaired = true;
    non_food_code = 0;
  } else {
    if (non_food_code < 1 || non_food_code > 3) {
      non_food_code = non_food_code < 1 ? 1 : 3;
      repaired = true;
    }
    protein_g = 0;
    carbohydrate_g = 0;
    sodium_mg = 0;
    food_name = '';
    ai_evaluation = '';
  }

  return {
    data: { is_food, non_food_code, food_name, ai_evaluation, protein_g, carbohydrate_g, sodium_mg },
    repaired,
  };
}

export async function analyzeFoodNutritionFromImage(
  options: AnalyzeFoodNutritionOptions,
): Promise<AnalyzeFoodNutritionResult> {
  if (!ensureApiKeyOption(options.apiKey)) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0, data: { ...FOOD_NUTRITION_FALLBACK } };
  }
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) {
    return { ok: false, error: '图片数据为空', attempts: 0, data: { ...FOOD_NUTRITION_FALLBACK } };
  }
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(
    rawB64,
    (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg',
  );
  try {
    const raw = await aiApi.aiFoodNutritionFromImage({
      image_base64,
      image_mime_type,
      supplement_text: options.supplementText?.trim() || undefined,
    });
    const { data, repaired } = normalizeFoodNutritionPayload(raw);
    return {
      ok: true,
      data,
      attempts: 1,
      rawContent: JSON.stringify(raw),
      repaired,
    };
  } catch (e) {
    const err = mapApiError(e);
    return {
      ok: false,
      error: err.error,
      attempts: 1,
      httpStatus: err.httpStatus,
      data: { ...FOOD_NUTRITION_FALLBACK, non_food_code: 2 },
    };
  }
}

// --- 财务 ---

export type AnalyzeFinanceBillSummaryFromTextOptions = {
  apiKey: string;
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeFinanceBillSummaryFromTextResult =
  | { ok: true; analysis: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceBillSummaryFromText(
  options: AnalyzeFinanceBillSummaryFromTextOptions,
): Promise<AnalyzeFinanceBillSummaryFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const { analysis } = await aiApi.aiFinanceBillSummaryAnalysis({ summary_text: text });
    return { ok: true, analysis, rawContent: JSON.stringify({ analysis }), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeCashFlowDashboardFromTextOptions = {
  apiKey: string;
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeCashFlowDashboardFromTextResult =
  | { ok: true; analysis: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeCashFlowDashboardFromText(
  options: AnalyzeCashFlowDashboardFromTextOptions,
): Promise<AnalyzeCashFlowDashboardFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const { analysis } = await aiApi.aiFinanceCashFlowAnalysis({ summary_text: text });
    return { ok: true, analysis, rawContent: JSON.stringify({ analysis }), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeWishListRationalReviewFromTextOptions = {
  apiKey: string;
  contextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeWishListRationalReviewFromTextResult =
  | { ok: true; headline: string; review: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeWishListRationalReviewFromText(
  options: AnalyzeWishListRationalReviewFromTextOptions,
): Promise<AnalyzeWishListRationalReviewFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.contextText.trim();
  if (!text) return { ok: false, error: '清单上下文为空', attempts: 0 };
  try {
    const data = await aiApi.aiWishListRationalReview({ context_text: text });
    return {
      ok: true,
      headline: data.headline,
      review: data.review,
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type GeneratePersonaPortraitOptions = {
  apiKey: string;
  personaSlug: string;
  contextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type GeneratePersonaPortraitResult =
  | { ok: true; data: PersonaPortraitAiData; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function personaTextLen(s: string): number {
  return s.trim().length;
}

function personaBulletsOk(d: PersonaPortraitAiData, minItems: number, maxItems: number, minEach: number): boolean {
  const items = d.bullets.map(b => b.trim()).filter(b => personaTextLen(b) >= minEach);
  return items.length >= minItems && items.length <= maxItems;
}

export function validatePersonaPortraitForSlug(
  slug: string,
  d: PersonaPortraitAiData,
): { ok: true } | { ok: false; error: string } {
  const min = PERSONA_PORTRAIT_BULLET_MIN_COUNT;
  const max = PERSONA_PORTRAIT_BULLET_MAX_COUNT;
  const each = PERSONA_PORTRAIT_BULLET_MIN_EACH;

  if (!personaBulletsOk(d, min, max, each)) {
    const n = d.bullets.map(b => b.trim()).filter(b => personaTextLen(b) >= each).length;
    return {
      ok: false,
      error: `bullets 须 ${min}～${max} 条且每条 ≥${each} 字（当前有效 ${n} 条）`,
    };
  }

  if (personaTextLen(d.overview) > 160) {
    return { ok: false, error: 'overview 须为 0～160 字短导语，勿写长段落（主内容放在 bullets）' };
  }

  switch (slug) {
    case 'savings':
      if (d.milestones.filter(m => m.trim()).length < 2) {
        return { ok: false, error: 'milestones 须至少 2 条' };
      }
      break;
    case 'ai-insight': {
      const dims = d.dims.filter(x => x.title.trim() && x.sub.trim());
      if (dims.length < 3) {
        return { ok: false, error: 'dims 须 3 条且含 title/sub' };
      }
      for (const dim of dims) {
        if (personaTextLen(dim.sub) < 24) {
          return { ok: false, error: 'dims.sub 每条须 ≥24 字（分点式一句）' };
        }
        if (personaTextLen(dim.sub) > 100) {
          return { ok: false, error: 'dims.sub 每条勿超过 100 字' };
        }
      }
      if (personaTextLen(d.ai_quote) > 120) {
        return { ok: false, error: 'ai_quote 须 ≤120 字或留空（主解读用 bullets）' };
      }
      break;
    }
    default:
      break;
  }
  return { ok: true };
}

export async function generatePersonaPortraitFromContext(
  options: GeneratePersonaPortraitOptions,
): Promise<GeneratePersonaPortraitResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const slug = options.personaSlug.trim();
  if (!slug) return { ok: false, error: 'personaSlug 为空', attempts: 0 };
  const text = options.contextText.trim();
  if (!text) return { ok: false, error: '数据摘要为空', attempts: 0 };
  try {
    const data = await aiApi.aiPersonaPortrait({ persona_slug: slug, context_text: text });
    const check = validatePersonaPortraitForSlug(slug, data);
    if (!check.ok) {
      return { ok: false, error: check.error, attempts: 1, details: data };
    }
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFinanceTxnCommentFromTextOptions = {
  apiKey: string;
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeFinanceTxnCommentFromTextResult =
  | { ok: true; comment: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceTxnCommentFromText(
  options: AnalyzeFinanceTxnCommentFromTextOptions,
): Promise<AnalyzeFinanceTxnCommentFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const { comment } = await aiApi.aiFinanceTxnComment({ summary_text: text });
    return { ok: true, comment, rawContent: JSON.stringify({ comment }), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeWishItemAiCommentFromTextOptions = {
  apiKey: string;
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeWishItemAiCommentFromTextResult =
  | { ok: true; comment: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeWishItemAiCommentFromText(
  options: AnalyzeWishItemAiCommentFromTextOptions,
): Promise<AnalyzeWishItemAiCommentFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const { comment } = await aiApi.aiWishItemComment({ summary_text: text });
    return { ok: true, comment, rawContent: JSON.stringify({ comment }), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoReviewFromTextOptions = {
  apiKey: string;
  memoContextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeMemoReviewFromTextResult =
  | { ok: true; evaluation: string; suggestions: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type MemoReviewJsonNormalizeMode = 'memo' | 'full';

export async function analyzeMemoReviewFromText(
  options: AnalyzeMemoReviewFromTextOptions,
): Promise<AnalyzeMemoReviewFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  try {
    const data = await aiApi.aiMemoReview({ memo_context_text: text });
    return {
      ok: true,
      evaluation: data.evaluation,
      suggestions: data.suggestions,
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type GenerateWeeklyReviewCoachingFromTextOptions = {
  apiKey: string;
  userPrompt: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type GenerateWeeklyReviewCoachingFromTextResult =
  | { ok: true; text: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function generateWeeklyReviewCoachingFromText(
  options: GenerateWeeklyReviewCoachingFromTextOptions,
): Promise<GenerateWeeklyReviewCoachingFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const userPrompt = options.userPrompt.trim();
  if (!userPrompt) return { ok: false, error: '复盘内容为空', attempts: 0 };
  try {
    const { text } = await aiApi.aiWeeklyReviewCoaching({ user_prompt: userPrompt });
    return { ok: true, text, attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeWeaknessReviewFromTextOptions = {
  apiKey: string;
  weaknessContextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeProjectTasksReviewFromTextOptions = {
  apiKey: string;
  projectContextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export async function analyzeProjectTasksReviewFromText(
  options: AnalyzeProjectTasksReviewFromTextOptions,
): Promise<AnalyzeMemoReviewFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.projectContextText.trim();
  if (!text) return { ok: false, error: '项目任务摘要为空', attempts: 0 };
  try {
    const data = await aiApi.aiProjectTasksReview({ project_context_text: text });
    return {
      ok: true,
      evaluation: data.evaluation,
      suggestions: data.suggestions,
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function analyzeWeaknessReviewFromText(
  options: AnalyzeWeaknessReviewFromTextOptions,
): Promise<AnalyzeMemoReviewFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.weaknessContextText.trim();
  if (!text) return { ok: false, error: '缺点描述为空', attempts: 0 };
  try {
    const data = await aiApi.aiWeaknessReview({ weakness_context_text: text });
    return {
      ok: true,
      evaluation: data.evaluation,
      suggestions: data.suggestions,
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeUserSkillsPortfolioFromTextOptions = {
  apiKey: string;
  userDisplayName: string;
  lines: { skill_id: string; dimension: string; name: string; description: string }[];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeUserSkillsPortfolioFromTextResult =
  | { ok: true; data: UserSkillAiPortfolioPayload; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeUserSkillsPortfolioFromText(
  options: AnalyzeUserSkillsPortfolioFromTextOptions,
): Promise<AnalyzeUserSkillsPortfolioFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const lines = options.lines.filter(
    l =>
      l.skill_id.trim().length > 0 &&
      l.dimension.trim().length > 0 &&
      l.name.trim().length > 0 &&
      l.description.trim().length > 0,
  );
  if (lines.length === 0) return { ok: false, error: '没有可评估的技能条目', attempts: 0 };
  try {
    const data = await aiApi.aiSkillsPortfolio({
      user_display_name: options.userDisplayName.trim() || '用户',
      lines: lines.map(l => ({
        skill_id: l.skill_id.trim(),
        dimension: l.dimension.trim(),
        name: l.name.trim(),
        description: l.description.trim(),
      })),
    });
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeVisionWallGoalsFromTextOptions = {
  apiKey: string;
  userDisplayName?: string;
  planDigestText: string;
  expectedGoalIds: string[];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeVisionWallGoalsFromTextResult =
  | { ok: true; data: VisionWallAiAssessmentPayload; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeVisionWallGoalsFromText(
  options: AnalyzeVisionWallGoalsFromTextOptions,
): Promise<AnalyzeVisionWallGoalsFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const planDigestText = options.planDigestText.trim();
  if (!planDigestText) return { ok: false, error: '计划摘要为空', attempts: 0 };
  const expectedGoalIds = options.expectedGoalIds.map(id => id.trim()).filter(Boolean);
  if (expectedGoalIds.length === 0) {
    return { ok: false, error: 'expected_goal_ids 为空', attempts: 0 };
  }
  try {
    const data = await aiApi.aiVisionWallAssessment({
      plan_digest_text: planDigestText,
      expected_goal_ids: expectedGoalIds,
      user_display_name: options.userDisplayName?.trim() || undefined,
    });
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseFinanceOneLinerFromImageAccountHint = {
  name: string;
  account_no?: string | null;
};

export type ParseFinanceOneLinerFromTextOptions = {
  apiKey: string;
  text: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  accounts?: ParseFinanceOneLinerFromImageAccountHint[];
};

export type ParseFinanceOneLinerFromTextResult =
  | {
      ok: true;
      transaction_type: 'expense' | 'income';
      amount: number;
      name: string;
      category_label: string | null;
      payment_account_label: string | null;
      account_name: string | null;
      /** 截图记账：账单上的消费时间（ISO8601），无法识别时为 null */
      happened_at?: string | null;
      rawContent: string;
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function mapFinanceOneLinerOk(
  data: aiApi.FinanceOneLinerJson,
  rawContent: string,
  options?: { extractBillHappenedAt?: boolean },
): ParseFinanceOneLinerFromTextResult {
  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    return { ok: false, error: '未能从话中解析出有效金额与标题', attempts: 1, details: data };
  }
  const happened_at = options?.extractBillHappenedAt ? extractBillHappenedAtFromAiJson(data) : undefined;
  return {
    ok: true,
    transaction_type: data.transaction_type,
    amount: data.amount,
    name: data.name,
    category_label: data.category_label,
    payment_account_label: data.payment_account_label,
    account_name: data.account_name,
    ...(happened_at !== undefined ? { happened_at } : {}),
    rawContent,
    attempts: 1,
  };
}

export async function parseFinanceOneLinerFromText(
  options: ParseFinanceOneLinerFromTextOptions,
): Promise<ParseFinanceOneLinerFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.text.trim();
  if (!text) return { ok: false, error: '输入为空', attempts: 0 };
  try {
    const data = await aiApi.aiFinanceParseOneLiner({
      text,
      accounts: options.accounts?.map(a => ({ name: a.name, account_no: a.account_no })),
    });
    return mapFinanceOneLinerOk(data, JSON.stringify(data));
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseFinanceOneLinerFromImageOptions = {
  apiKey: string;
  imageDataUri: string;
  accounts?: ParseFinanceOneLinerFromImageAccountHint[];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type ParseFinanceOneLinerFromImageResult =
  | {
      ok: true;
      transaction_type: 'expense' | 'income';
      amount: number;
      name: string;
      category_label: string | null;
      payment_account_label: string | null;
      account_name: string | null;
      happened_at: string | null;
      rawContent: string;
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; notBill?: boolean; httpStatus?: number; details?: unknown };

export async function parseFinanceOneLinerFromImage(
  options: ParseFinanceOneLinerFromImageOptions,
): Promise<ParseFinanceOneLinerFromImageResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const uri = options.imageDataUri.trim();
  if (!uri) return { ok: false, error: '图片为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(uri);
  if (!image_base64) return { ok: false, error: '无法解析图片数据', attempts: 0 };
  try {
    const data = await aiApi.aiFinanceParseOneLinerFromImage({
      image_base64,
      image_mime_type,
      accounts: options.accounts?.map(a => ({ name: a.name, account_no: a.account_no })),
    });
    if (data.is_bill === false) {
      return {
        ok: false,
        error: '这不是账单或支付凭证截图',
        notBill: true,
        attempts: 1,
        details: data,
      };
    }
    const mapped = mapFinanceOneLinerOk(data, JSON.stringify(data), { extractBillHappenedAt: true });
    if (!mapped.ok) return mapped;
    return { ...mapped, happened_at: mapped.happened_at ?? null };
  } catch (e) {
    const err = mapApiError(e);
    const notBill = /不是账单|支付凭证/.test(err.error);
    return {
      ok: false,
      error: err.error,
      attempts: 1,
      httpStatus: err.httpStatus,
      details: err.details,
      ...(notBill ? { notBill: true } : {}),
    };
  }
}

export type AnalyzeAiFinanceDashboardFromTextOptions = {
  apiKey: string;
  summaryText: string;
  past6NetSavings?: number[];
  past6Income?: number[];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeAiFinanceDashboardFromTextResult =
  | { ok: true; data: AiFinanceDashboardPayload; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeAiFinanceDashboardFromText(
  options: AnalyzeAiFinanceDashboardFromTextOptions,
): Promise<AnalyzeAiFinanceDashboardFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const data = await aiApi.aiFinanceDashboardAnalysis({
      summary_text: text,
      past6_net_savings: options.past6NetSavings,
      past6_income: options.past6Income,
    });
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}
