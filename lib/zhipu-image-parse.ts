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
  calories_kcal: 0,
};

/** 极小 JPEG（约几十字节），用于调试页连通性测试 */
export const TINY_TEST_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

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

function resolveCaloriesKcal(raw: Record<string, unknown>, protein_g: number, carbohydrate_g: number): number {
  let calories_kcal = toNonNegativeFiniteNumber(raw.calories_kcal ?? raw.calories ?? raw.sodium_mg ?? raw.sodium);
  if (!calories_kcal && (protein_g > 0 || carbohydrate_g > 0)) {
    calories_kcal = Math.round(protein_g * 4 + carbohydrate_g * 4);
  }
  return calories_kcal;
}

export function normalizeFoodTextIntakePayload(raw: unknown): FoodTextIntakeJson {
  if (typeof raw !== 'object' || raw === null) {
    return {
      food_summary: '',
      hydration_ml: 0,
      protein_g: 0,
      carbohydrate_g: 0,
      calories_kcal: 0,
      ai_evaluation: '',
    };
  }
  const o = raw as Record<string, unknown>;
  const protein_g = toNonNegativeFiniteNumber(o.protein_g);
  const carbohydrate_g = toNonNegativeFiniteNumber(o.carbohydrate_g ?? o.carb_g ?? o.carbs_g);
  return {
    food_summary: typeof o.food_summary === 'string' ? o.food_summary.trim() : String(o.food_summary ?? '').trim(),
    hydration_ml: toNonNegativeFiniteNumber(o.hydration_ml),
    protein_g,
    carbohydrate_g,
    calories_kcal: resolveCaloriesKcal(o, protein_g, carbohydrate_g),
    ai_evaluation:
      typeof o.ai_evaluation === 'string' ? o.ai_evaluation.trim() : String(o.ai_evaluation ?? '').trim(),
  };
}

/** 摄入估算策略：不确定时一律取偏大值（与 parseAiIntakeNumericValue 区间取高值一致）。 */
const FOOD_INTAKE_HIGH_ESTIMATE_DIRECTIVE =
  '估算规则：份量、热量、蛋白质、碳水、水分有任何不确定时，一律按较大端/上限估算（区间取高值；单点估值取该份量合理范围内的偏高值，例如一碗饭按约 500 kcal 而非 300 kcal），禁止保守偏低估算。';

const FOOD_TEXT_INTAKE_DEFAULT_QUESTION =
  `${FOOD_INTAKE_HIGH_ESTIMATE_DIRECTIVE} 请完整分析这段饮食描述并估算 hydration_ml、protein_g、carbohydrate_g、calories_kcal。`;

const FOOD_TEXT_INTAKE_RETRY_QUESTION =
  `${FOOD_INTAKE_HIGH_ESTIMATE_DIRECTIVE} 用户输入的是饮食记录。只要描述的是食物或饮品（含简写如「一碗饭」「一碗冒菜」），必须给出大于 0 的蛋白质、碳水化合物、热量估算；仅当完全不是食物时才将全部数值设为 0，并在 food_summary 中明确写「非食物」。`;

/**
 * 拼接文字饮食解析的 question：始终附带偏大估算指令。
 */
function buildFoodIntakeQuestion(custom?: string): string {
  const extra = custom?.trim();
  return extra ? `${FOOD_INTAKE_HIGH_ESTIMATE_DIRECTIVE}\n${extra}` : FOOD_TEXT_INTAKE_DEFAULT_QUESTION;
}

/**
 * 拼接识图补充说明：始终附带偏大估算指令。
 */
function buildFoodNutritionSupplementText(userNote?: string): string {
  const note = userNote?.trim();
  return note ? `${FOOD_INTAKE_HIGH_ESTIMATE_DIRECTIVE}\n${note}` : FOOD_INTAKE_HIGH_ESTIMATE_DIRECTIVE;
}

export function foodTextIntakeNutrientSum(data: FoodTextIntakeJson): number {
  return data.hydration_ml + data.protein_g + data.carbohydrate_g + data.calories_kcal;
}

const NON_FOOD_TEXT_INTAKE_MARKERS =
  /非食物|不是食物|并非食物|无法按食物|无法识别为食物|不属于食物|非餐饮|非饮食/i;

const OBVIOUS_NON_FOOD_INPUT =
  /^(跑步|走路|健身|游泳|骑车|骑行|瑜伽|拉伸|开会|上班|加班|睡觉|洗澡|刷牙|洗脸|通勤|地铁|公交|打车|开车|学习|看书|写代码|编程|开会)/;

function isClearlyNonFoodTextIntake(text: string, data: FoodTextIntakeJson): boolean {
  const summaryBlock = `${data.food_summary} ${data.ai_evaluation}`.trim();
  if (NON_FOOD_TEXT_INTAKE_MARKERS.test(summaryBlock)) return true;
  const t = text.trim();
  if (!t) return true;
  return OBVIOUS_NON_FOOD_INPUT.test(t);
}

function fallbackFoodTextIntakeEstimate(text: string, base: FoodTextIntakeJson): FoodTextIntakeJson {
  const t = text.trim();
  const isDrink = /杯|瓶|罐|毫升|ml|水|茶|咖啡|奶|汁|汤|啤酒|可乐|雪碧|饮料|豆浆/.test(t);
  let hydration_ml = 0;
  let protein_g = 0;
  let carbohydrate_g = 0;
  let calories_kcal = 0;

  if (isDrink) {
    hydration_ml = /大杯|特大|500/.test(t) ? 500 : /小杯|迷你|250/.test(t) ? 300 : 400;
    calories_kcal = /牛奶|拿铁|奶茶|果汁|可乐|雪碧|啤酒|酒| latte/i.test(t) ? 250 : /水|清茶|无糖/.test(t) ? 0 : 120;
    protein_g = /牛奶|奶|豆浆|拿铁/.test(t) ? 8 : 0;
    carbohydrate_g = /奶茶|果汁|可乐|雪碧|啤酒|豆浆/.test(t) ? 35 : /牛奶|拿铁/.test(t) ? 14 : 0;
    if (!calories_kcal && (protein_g > 0 || carbohydrate_g > 0)) {
      calories_kcal = Math.round(protein_g * 4 + carbohydrate_g * 4);
    }
  } else if (/饭|米饭|白饭|盖饭|炒饭/.test(t) && !/大碗|两份|双份|火锅|烧烤|冒菜|麻辣烫|汉堡|披萨/.test(t)) {
    protein_g = 8;
    carbohydrate_g = 75;
    calories_kcal = 500;
  } else if (/小菜|水果|苹果|香蕉|一个/.test(t)) {
    protein_g = 3;
    carbohydrate_g = 28;
    calories_kcal = 180;
  } else if (/大碗|两份|双份|汉堡|披萨|火锅|烧烤|冒菜|麻辣烫/.test(t)) {
    protein_g = 35;
    carbohydrate_g = 75;
    calories_kcal = 750;
  } else {
    protein_g = 25;
    carbohydrate_g = 65;
    calories_kcal = 550;
  }

  if (!calories_kcal && (protein_g > 0 || carbohydrate_g > 0)) {
    calories_kcal = Math.round(protein_g * 4 + carbohydrate_g * 4);
  }

  const fallbackNote = '模型未给出可靠数值，已按常见份量作偏大估算；如需更精确可补充做法与份量后重新解析。';
  const ai_evaluation = base.ai_evaluation?.trim()
    ? `${base.ai_evaluation.trim()}（${fallbackNote}）`
    : `根据「${t}」${fallbackNote}`;

  return {
    food_summary: base.food_summary || t,
    hydration_ml: base.hydration_ml > 0 ? base.hydration_ml : hydration_ml,
    protein_g,
    carbohydrate_g,
    calories_kcal,
    ai_evaluation,
  };
}

export type FinalizeFoodTextIntakeResult =
  | { ok: true; data: FoodTextIntakeJson }
  | { ok: false; error: string };

/** 确保文字饮食记录有可落库的摄入量；仅明确非食物时拒绝。 */
export function finalizeFoodTextIntakeForRecord(
  text: string,
  data: FoodTextIntakeJson,
): FinalizeFoodTextIntakeResult {
  if (foodTextIntakeNutrientSum(data) > 0) {
    return { ok: true, data };
  }
  if (isClearlyNonFoodTextIntake(text, data)) {
    return { ok: false, error: '描述似乎不是食物，无法记录摄入。' };
  }
  return { ok: true, data: fallbackFoodTextIntakeEstimate(text, data) };
}

export function normalizeDailyIntakeTargetsPayload(raw: unknown): DailyIntakeTargetsEstimateJson {
  if (typeof raw !== 'object' || raw === null) {
    return { hydration_ml: 0, protein_g: 0, carbohydrate_g: 0, calories_kcal: 0 };
  }
  const o = raw as Record<string, unknown>;
  const protein_g = toNonNegativeFiniteNumber(o.protein_g);
  const carbohydrate_g = toNonNegativeFiniteNumber(o.carbohydrate_g ?? o.carb_g ?? o.carbs_g);
  const rationale =
    typeof o.rationale_zh === 'string' && o.rationale_zh.trim() ? o.rationale_zh.trim() : undefined;
  return {
    hydration_ml: Math.round(toNonNegativeFiniteNumber(o.hydration_ml)),
    protein_g: Math.round(protein_g),
    carbohydrate_g: Math.round(carbohydrate_g),
    calories_kcal: Math.round(resolveCaloriesKcal(o, protein_g, carbohydrate_g)),
    rationale_zh: rationale,
  };
}

export async function parseFoodIntakeFromText(
  options: ParseFoodIntakeFromTextOptions,
): Promise<ParseFoodIntakeFromTextResult> {
  if (!ensureApiKeyOption(options.apiKey)) return rejectNoApiKey(0);
  const text = options.text.trim();
  if (!text) return { ok: false, error: '描述为空', attempts: 0 };
  try {
    let attempts = 1;
    const raw = await aiApi.aiFoodIntakeFromText({ text, question: buildFoodIntakeQuestion(options.question) });
    let data = normalizeFoodTextIntakePayload(raw);
    if (foodTextIntakeNutrientSum(data) <= 0) {
      attempts += 1;
      try {
        const retryRaw = await aiApi.aiFoodIntakeFromText({ text, question: FOOD_TEXT_INTAKE_RETRY_QUESTION });
        data = normalizeFoodTextIntakePayload(retryRaw);
      } catch {
        /* 保留首次解析结果，由 finalize 兜底 */
      }
    }
    const finalized = finalizeFoodTextIntakeForRecord(text, data);
    if (!finalized.ok) {
      return { ok: false, error: finalized.error, attempts };
    }
    return { ok: true, data: finalized.data, rawContent: JSON.stringify(finalized.data), attempts };
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
    const raw = await aiApi.aiFoodDailyTargets({ context_block: context });
    const data = normalizeDailyIntakeTargetsPayload(raw);
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
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

/** AI 摄入区间字符串分隔符（如 300-500、300~500、300至500） */
const INTAKE_NUMERIC_RANGE_RE = /(\d+(?:\.\d+)?)\s*[-~～—–－至到]\s*(\d+(?:\.\d+)?)/;

/**
 * 解析 AI 返回的摄入量：单值或区间字符串统一按较大端计算（如 `300-500` → `500`）。
 */
export function parseAiIntakeNumericValue(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === 'string' && v.trim() !== '') {
    const s = v.trim().replace(/,/g, '');
    const rangeMatch = s.match(INTAKE_NUMERIC_RANGE_RE);
    if (rangeMatch) {
      const low = Number(rangeMatch[1]);
      const high = Number(rangeMatch[2]);
      if (Number.isFinite(low) && Number.isFinite(high)) {
        return Math.max(0, Math.max(low, high));
      }
    }
    const n = Number(s);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function toNonNegativeFiniteNumber(v: unknown): number {
  return parseAiIntakeNumericValue(v);
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
  let calories_kcal = resolveCaloriesKcal(o, protein_g, carbohydrate_g);
  if (o.calories_kcal === undefined && (o.sodium_mg !== undefined || o.sodium !== undefined)) repaired = true;

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
    calories_kcal = 0;
    food_name = '';
    ai_evaluation = '';
  }

  return {
    data: { is_food, non_food_code, food_name, ai_evaluation, protein_g, carbohydrate_g, calories_kcal },
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
      supplement_text: buildFoodNutritionSupplementText(options.supplementText),
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
