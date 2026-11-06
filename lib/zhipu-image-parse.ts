/**
 * AI 能力门面：请求统一走 Agent `/api/v1/ai/*`（见 AI_API.md）。
 * 成功时返回 `{ ok: true, ... }`，失败时返回 `{ ok: false, error, ... }`。
 */

import { ApiRequestError } from '@/lib/api-client';
import * as aiApi from '@/lib/ai-api-client';
import { extractBillHappenedAtFromAiJson } from '@/lib/finance-bill-happened-at';

export type {
  AiFinanceDashboardInsight,
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FinanceAnomalyHintItem,
  FinanceAnomalyHintsJson,
  FinanceBudgetSuggestJson,
  FinanceCashFlowEntryKind,
  FinanceCashFlowQuadrant,
  FinanceDailyWrapupJson,
  FinanceDailyWrapupPeriod,
  FinanceMultiItemJson,
  FinanceParseCashFlowEntryJson,
  FinanceParseMultiFromImageJson,
  FinanceParseScheduledExpenseJson,
  FinanceParseTransferJson,
  FinanceSavingsGoalAdjustKind,
  FinanceSavingsGoalAdjustOption,
  FinanceSavingsGoalCoachJson,
  FinanceScheduledRepeatHint,
  FinanceSimulateAdviceJson,
  FinanceSimulateRiskLevel,
  FinanceSuggestCategoryJson,
  FoodAdjustIntakeJson,
  FoodDailyWrapupJson,
  FoodIntakeCommentJson,
  FoodNutritionJson,
  FoodNutritionLabelJson,
  FoodNutritionSplitItem,
  FoodNutritionSplitJson,
  FoodSuggestNextMealDraft,
  FoodSuggestNextMealJson,
  FoodTextIntakeJson,
  FoodWeeklyInsightItem,
  FoodWeeklyInsightsJson,
  FoodWeightCommentJson,
  MemoAiSummaryItem,
  MemoCollectionInsightsJson,
  MemoConvertDraftJson,
  MemoConvertTarget,
  MemoDedupeHintsJson,
  MemoDraftFromImageJson,
  MemoDraftFromTextJson,
  MemoDraftStyle,
  MemoLinkSuggestJson,
  MemoReviewJson,
  MemoRewriteJson,
  MemoRewriteMode,
  MemoSuggestTagsJson,
  MemoSuggestedAction,
} from '@/lib/ai-types';

import type {
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FinanceAnomalyHintItem,
  FinanceAnomalyHintsJson,
  FinanceBudgetSuggestJson,
  FinanceCashFlowEntryKind,
  FinanceCashFlowQuadrant,
  FinanceDailyWrapupJson,
  FinanceDailyWrapupPeriod,
  FinanceMultiItemJson,
  FinanceParseCashFlowEntryJson,
  FinanceParseMultiFromImageJson,
  FinanceParseScheduledExpenseJson,
  FinanceParseTransferJson,
  FinanceSavingsGoalAdjustKind,
  FinanceSavingsGoalAdjustOption,
  FinanceSavingsGoalCoachJson,
  FinanceScheduledRepeatHint,
  FinanceSimulateAdviceJson,
  FinanceSimulateRiskLevel,
  FinanceSuggestCategoryJson,
  FoodAdjustIntakeJson,
  FoodDailyWrapupJson,
  FoodIntakeCommentJson,
  FoodNutritionJson,
  FoodNutritionLabelJson,
  FoodNutritionSplitItem,
  FoodNutritionSplitJson,
  FoodSuggestNextMealDraft,
  FoodSuggestNextMealJson,
  FoodTextIntakeJson,
  FoodWeeklyInsightItem,
  FoodWeeklyInsightsJson,
  FoodWeightCommentJson,
  MemoAiSummaryItem,
  MemoCollectionInsightsJson,
  MemoConvertDraftJson,
  MemoConvertTarget,
  MemoDedupeHintsJson,
  MemoDraftFromImageJson,
  MemoDraftFromTextJson,
  MemoDraftStyle,
  MemoLinkSuggestJson,
  MemoReviewJson,
  MemoRewriteJson,
  MemoRewriteMode,
  MemoSuggestTagsJson,
  MemoSuggestedAction,
} from '@/lib/ai-types';

const FOOD_NUTRITION_FALLBACK: FoodNutritionJson = {
  is_food: 0,
  non_food_code: 2,
  food_name: '',
  ai_evaluation: '',
  protein_g: 0,
  carbohydrate_g: 0,
  calories_kcal: 0,
  hydration_ml: 0,
};

/** 极小 JPEG（约几十字节），用于调试页连通性测试 */
export const TINY_TEST_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

export type ZhipuConnectivityProbeResult = {
  httpStatus: number;
  httpOk: boolean;
  bodySnippet: string;
};

/** 探测 Agent → 智谱链路（GET /api/v1/ai/health） */
export async function probeZhipuTextConnectivity(): Promise<ZhipuConnectivityProbeResult> {
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

// --- 饮食 ---

export type ParseFoodIntakeFromTextOptions = {
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
  let hydration_ml = toNonNegativeFiniteNumber(o.hydration_ml ?? o.water_ml);

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
    hydration_ml = 0;
    food_name = '';
    ai_evaluation = '';
  }

  return {
    data: {
      is_food,
      non_food_code,
      food_name,
      ai_evaluation,
      protein_g,
      carbohydrate_g,
      calories_kcal,
      hydration_ml,
    },
    repaired,
  };
}

export async function analyzeFoodNutritionFromImage(
  options: AnalyzeFoodNutritionOptions,
): Promise<AnalyzeFoodNutritionResult> {
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

// --- 健康 P0：周洞察 / 下一餐 ---

export type AnalyzeFoodWeeklyInsightsOptions = {
  contextBlock: string;
  ruleInsights?: FoodWeeklyInsightItem[];
};

export type AnalyzeFoodWeeklyInsightsResult =
  | { ok: true; data: FoodWeeklyInsightsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodWeeklyInsightsPayload(raw: unknown): FoodWeeklyInsightsJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const insights: FoodWeeklyInsightItem[] = [];
  if (Array.isArray(o.insights)) {
    for (const row of o.insights) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = typeof r.title === 'string' ? r.title.trim().slice(0, 40) : '';
      const body = typeof r.body === 'string' ? r.body.trim().slice(0, 160) : '';
      if (!title && !body) continue;
      const metric_hint =
        typeof r.metric_hint === 'string' ? r.metric_hint.trim().toLowerCase().slice(0, 20) : '';
      insights.push({
        title: title || '本周观察',
        body: body || title,
        ...(metric_hint ? { metric_hint } : {}),
      });
      if (insights.length >= 3) break;
    }
  }
  let suggestion = typeof o.suggestion === 'string' ? o.suggestion.trim().slice(0, 160) : '';
  if (!suggestion && Array.isArray(o.suggestions)) {
    suggestion = o.suggestions
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map(x => x.trim())
      .slice(0, 3)
      .join('；')
      .slice(0, 160);
  }
  const tags = Array.isArray(o.tags)
    ? o.tags
        .filter((t): t is string => typeof t === 'string' && !!t.trim())
        .map(t => t.trim().slice(0, 12))
        .slice(0, 6)
    : [];
  let score: number | undefined;
  if (typeof o.score === 'number' && Number.isFinite(o.score)) {
    score = Math.max(0, Math.min(100, Math.round(o.score)));
  }
  if (!insights.length && !suggestion) return null;
  return {
    ...(score != null ? { score } : {}),
    insights,
    suggestion,
    ...(tags.length ? { tags } : {}),
  };
}

export async function analyzeFoodWeeklyInsights(
  options: AnalyzeFoodWeeklyInsightsOptions,
): Promise<AnalyzeFoodWeeklyInsightsResult> {
  const context = options.contextBlock.trim();
  if (!context) return { ok: false, error: '上下文为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFoodWeeklyInsights({
      context_block: context,
      rule_insights: options.ruleInsights?.map(i => ({
        title: i.title,
        body: i.body,
        ...(i.metric_hint ? { metric_hint: i.metric_hint } : {}),
      })),
    });
    const data = normalizeFoodWeeklyInsightsPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效周洞察', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type SuggestFoodNextMealOptions = {
  contextBlock: string;
  quickAdds?: aiApi.FoodQuickAddHint[];
  recipes?: aiApi.FoodRecipeHint[];
};

export type SuggestFoodNextMealResult =
  | { ok: true; data: FoodSuggestNextMealJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodSuggestNextMealPayload(
  raw: unknown,
  allowedQuick: Set<string>,
  allowedRecipes: Set<string>,
): FoodSuggestNextMealJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tips: string[] = [];
  if (Array.isArray(o.tips)) {
    for (const t of o.tips) {
      if (typeof t !== 'string' || !t.trim()) continue;
      tips.push(t.trim().slice(0, 80));
      if (tips.length >= 5) break;
    }
  }
  const quick_add_keys: string[] = [];
  if (Array.isArray(o.quick_add_keys)) {
    for (const k of o.quick_add_keys) {
      if (typeof k !== 'string') continue;
      const key = k.trim();
      if (!key || !allowedQuick.has(key) || quick_add_keys.includes(key)) continue;
      quick_add_keys.push(key);
      if (quick_add_keys.length >= 5) break;
    }
  }
  const recipe_ids: string[] = [];
  if (Array.isArray(o.recipe_ids)) {
    for (const id of o.recipe_ids) {
      if (typeof id !== 'string') continue;
      const rid = id.trim();
      if (!rid || !allowedRecipes.has(rid) || recipe_ids.includes(rid)) continue;
      recipe_ids.push(rid);
      if (recipe_ids.length >= 5) break;
    }
  }
  let draft_intake: FoodSuggestNextMealDraft | null = null;
  const draftRaw = o.draft_intake;
  if (draftRaw && typeof draftRaw === 'object' && !Array.isArray(draftRaw)) {
    const d = draftRaw as Record<string, unknown>;
    const food_summary =
      typeof d.food_summary === 'string'
        ? d.food_summary.trim().slice(0, 80)
        : typeof d.food_name === 'string'
          ? d.food_name.trim().slice(0, 80)
          : '';
    const protein_g = toNonNegativeFiniteNumber(d.protein_g);
    const carbohydrate_g = toNonNegativeFiniteNumber(d.carbohydrate_g ?? d.carb_g ?? d.carbs_g);
    const calories_kcal = resolveCaloriesKcal(d, protein_g, carbohydrate_g);
    const hydration_ml = toNonNegativeFiniteNumber(d.hydration_ml);
    const ai_evaluation =
      typeof d.ai_evaluation === 'string' ? d.ai_evaluation.trim().slice(0, 400) : '';
    if (food_summary || protein_g || carbohydrate_g || calories_kcal || hydration_ml) {
      draft_intake = {
        food_summary: food_summary || '建议加餐',
        hydration_ml,
        protein_g,
        carbohydrate_g,
        calories_kcal,
        ai_evaluation,
      };
    }
  }
  if (!tips.length && !quick_add_keys.length && !recipe_ids.length && !draft_intake) return null;
  return { tips, quick_add_keys, recipe_ids, draft_intake };
}

export async function suggestFoodNextMeal(
  options: SuggestFoodNextMealOptions,
): Promise<SuggestFoodNextMealResult> {
  const context = options.contextBlock.trim();
  if (!context) return { ok: false, error: '上下文为空', attempts: 0 };
  const quickAdds = options.quickAdds ?? [];
  const recipes = options.recipes ?? [];
  try {
    const raw = await aiApi.aiFoodSuggestNextMeal({
      context_block: context,
      quick_adds: quickAdds.length ? quickAdds : undefined,
      recipes: recipes.length ? recipes : undefined,
    });
    const data = normalizeFoodSuggestNextMealPayload(
      raw,
      new Set(quickAdds.map(q => q.key).filter(Boolean)),
      new Set(recipes.map(r => r.id).filter(Boolean)),
    );
    if (!data) return { ok: false, error: '未能生成有效下一餐建议', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFoodNutritionSplitOptions = {
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
  dishCountHint?: number;
};

export type AnalyzeFoodNutritionSplitResult =
  | { ok: true; data: FoodNutritionSplitJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodNutritionSplitPayload(raw: unknown): FoodNutritionSplitJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const is_food = toIsFoodFlag(o.is_food) as 0 | 1;
  let non_food_code = toNonFoodCode(o.non_food_code);
  const items: FoodNutritionSplitItem[] = [];
  if (is_food === 1) {
    non_food_code = 0;
    const list = Array.isArray(o.items) ? o.items : [];
    for (const row of list) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const food_name =
        typeof r.food_name === 'string'
          ? r.food_name.trim().slice(0, 40)
          : typeof r.food_summary === 'string'
            ? r.food_summary.trim().slice(0, 40)
            : '';
      const protein_g = toNonNegativeFiniteNumber(r.protein_g);
      const carbohydrate_g = toNonNegativeFiniteNumber(r.carbohydrate_g ?? r.carb_g ?? r.carbs_g);
      const calories_kcal = resolveCaloriesKcal(r, protein_g, carbohydrate_g);
      const hydration_ml = toNonNegativeFiniteNumber(r.hydration_ml ?? r.water_ml);
      const ai_evaluation =
        typeof r.ai_evaluation === 'string' ? r.ai_evaluation.trim().slice(0, 400) : '';
      if (!food_name && protein_g + carbohydrate_g + calories_kcal + hydration_ml <= 0) continue;
      items.push({
        food_name: food_name || '食物',
        protein_g,
        carbohydrate_g,
        calories_kcal,
        hydration_ml,
        ai_evaluation,
      });
      if (items.length >= 8) break;
    }
    if (!items.length) return null;
  } else if (non_food_code < 1 || non_food_code > 3) {
    non_food_code = non_food_code < 1 ? 1 : 3;
  }
  return { is_food, non_food_code, items };
}

export async function analyzeFoodNutritionFromImageSplit(
  options: AnalyzeFoodNutritionSplitOptions,
): Promise<AnalyzeFoodNutritionSplitResult> {
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) return { ok: false, error: '图片数据为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(
    rawB64,
    (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg',
  );
  try {
    const raw = await aiApi.aiFoodNutritionFromImageSplit({
      image_base64,
      image_mime_type,
      supplement_text: buildFoodNutritionSupplementText(options.supplementText),
      ...(options.dishCountHint != null && options.dishCountHint >= 1 && options.dishCountHint <= 8
        ? { dish_count_hint: Math.round(options.dishCountHint) }
        : {}),
    });
    const data = normalizeFoodNutritionSplitPayload(raw);
    if (!data) return { ok: false, error: '未能拆出有效菜品', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AdjustFoodIntakeOptions = {
  title?: string;
  hydrationMl: number;
  proteinG: number;
  carbohydrateG: number;
  caloriesKcal: number;
  aiComment?: string;
  adjustmentText: string;
};

export type AdjustFoodIntakeResult =
  | { ok: true; data: FoodAdjustIntakeJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodAdjustIntakePayload(raw: unknown): FoodAdjustIntakeJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const food_summary =
    typeof o.food_summary === 'string'
      ? o.food_summary.trim().slice(0, 80)
      : typeof o.food_name === 'string'
        ? o.food_name.trim().slice(0, 80)
        : '';
  const protein_g = toNonNegativeFiniteNumber(o.protein_g);
  const carbohydrate_g = toNonNegativeFiniteNumber(o.carbohydrate_g ?? o.carb_g ?? o.carbs_g);
  const calories_kcal = resolveCaloriesKcal(o, protein_g, carbohydrate_g);
  const hydration_ml = toNonNegativeFiniteNumber(o.hydration_ml);
  const ai_evaluation =
    typeof o.ai_evaluation === 'string'
      ? o.ai_evaluation.trim().slice(0, 400)
      : typeof o.ai_comment === 'string'
        ? o.ai_comment.trim().slice(0, 400)
        : '';
  if (!food_summary && protein_g + carbohydrate_g + calories_kcal + hydration_ml <= 0) return null;
  return {
    food_summary: food_summary || '修正后的摄入',
    hydration_ml,
    protein_g,
    carbohydrate_g,
    calories_kcal,
    ai_evaluation,
  };
}

export async function adjustFoodIntake(
  options: AdjustFoodIntakeOptions,
): Promise<AdjustFoodIntakeResult> {
  const adjustment = options.adjustmentText.trim();
  if (!adjustment) return { ok: false, error: '请填写修正说明', attempts: 0 };
  try {
    const raw = await aiApi.aiFoodAdjustIntake({
      title: options.title?.trim() || undefined,
      hydration_ml: Math.max(0, Number(options.hydrationMl) || 0),
      protein_g: Math.max(0, Number(options.proteinG) || 0),
      carbohydrate_g: Math.max(0, Number(options.carbohydrateG) || 0),
      calories_kcal: Math.max(0, Number(options.caloriesKcal) || 0),
      ai_comment: options.aiComment?.trim() || undefined,
      adjustment_text: adjustment,
    });
    const data = normalizeFoodAdjustIntakePayload(raw);
    if (!data) return { ok: false, error: '未能生成有效修正结果', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFoodDailyWrapupOptions = {
  contextBlock: string;
};

export type AnalyzeFoodDailyWrapupResult =
  | { ok: true; data: FoodDailyWrapupJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodDailyWrapupPayload(raw: unknown): FoodDailyWrapupJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title =
    typeof o.title === 'string' && o.title.trim()
      ? o.title.trim().slice(0, 28)
      : '今日小结';
  const body =
    typeof o.body === 'string'
      ? o.body.trim().slice(0, 120)
      : typeof o.text === 'string'
        ? o.text.trim().slice(0, 120)
        : '';
  if (!body) return null;
  return { title, body };
}

export async function analyzeFoodDailyWrapup(
  options: AnalyzeFoodDailyWrapupOptions,
): Promise<AnalyzeFoodDailyWrapupResult> {
  const context = options.contextBlock.trim();
  if (!context) return { ok: false, error: '上下文为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFoodDailyWrapup({ context_block: context });
    const data = normalizeFoodDailyWrapupPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效收口文案', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFoodWeightCommentOptions = {
  contextBlock: string;
};

export type AnalyzeFoodWeightCommentResult =
  | { ok: true; data: FoodWeightCommentJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodWeightCommentPayload(raw: unknown): FoodWeightCommentJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const comment =
    typeof o.comment === 'string'
      ? o.comment.trim().slice(0, 160)
      : typeof o.body === 'string'
        ? o.body.trim().slice(0, 160)
        : '';
  if (!comment) return null;
  const caution =
    typeof o.caution === 'string' && o.caution.trim()
      ? o.caution.trim().slice(0, 80)
      : typeof o.note === 'string' && o.note.trim()
        ? o.note.trim().slice(0, 80)
        : undefined;
  return caution ? { comment, caution } : { comment };
}

export async function analyzeFoodWeightComment(
  options: AnalyzeFoodWeightCommentOptions,
): Promise<AnalyzeFoodWeightCommentResult> {
  const context = options.contextBlock.trim();
  if (!context) return { ok: false, error: '上下文为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFoodWeightComment({ context_block: context });
    const data = normalizeFoodWeightCommentPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效体重短评', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFoodNutritionFromLabelImageOptions = {
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
};

export type AnalyzeFoodNutritionFromLabelImageResult =
  | { ok: true; data: FoodNutritionLabelJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodNutritionLabelPayload(raw: unknown): FoodNutritionLabelJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const isLabelRaw = o.is_label ?? o.is_food;
  const is_label: 0 | 1 =
    isLabelRaw === 1 || isLabelRaw === true || isLabelRaw === '1' ? 1 : 0;
  const non_label_code = Math.max(
    0,
    Math.min(3, Math.round(toNonNegativeFiniteNumber(o.non_label_code ?? o.non_food_code))),
  );
  const product_name =
    typeof o.product_name === 'string'
      ? o.product_name.trim().slice(0, 60)
      : typeof o.food_name === 'string'
        ? o.food_name.trim().slice(0, 60)
        : '';
  const basisRaw = typeof o.basis === 'string' ? o.basis.trim().toLowerCase() : '';
  const basis: 'per_100g' | 'per_serving' =
    basisRaw.includes('serving') || basisRaw.includes('份') ? 'per_serving' : 'per_100g';
  const serving_size_g = toNonNegativeFiniteNumber(o.serving_size_g ?? o.serving_g);
  const protein_g = toNonNegativeFiniteNumber(o.protein_g);
  const carbohydrate_g = toNonNegativeFiniteNumber(o.carbohydrate_g ?? o.carb_g ?? o.carbs_g);
  const calories_kcal = toNonNegativeFiniteNumber(o.calories_kcal ?? o.calories);
  const hydration_ml = toNonNegativeFiniteNumber(o.hydration_ml ?? o.water_ml);
  const ai_evaluation =
    typeof o.ai_evaluation === 'string' ? o.ai_evaluation.trim().slice(0, 400) : '';
  if (is_label === 1 && protein_g + carbohydrate_g + calories_kcal <= 0 && !product_name) {
    return null;
  }
  return {
    is_label,
    non_label_code: is_label === 1 ? 0 : non_label_code || 1,
    product_name: is_label === 1 ? product_name : '',
    basis,
    serving_size_g: is_label === 1 ? serving_size_g : 0,
    protein_g: is_label === 1 ? protein_g : 0,
    carbohydrate_g: is_label === 1 ? carbohydrate_g : 0,
    calories_kcal: is_label === 1 ? calories_kcal : 0,
    hydration_ml: is_label === 1 ? hydration_ml : 0,
    ai_evaluation: is_label === 1 ? ai_evaluation : '',
  };
}

/** 按份数 / 克数把标签基准值换算成实际摄入四项 */
export function scaleFoodNutritionLabel(
  label: FoodNutritionLabelJson,
  opts: { servings?: number; grams?: number },
): {
  food_name: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  ai_evaluation: string;
} {
  const servings = Math.max(0, Number(opts.servings) || 0);
  const grams = Math.max(0, Number(opts.grams) || 0);
  let factor = 1;
  if (label.basis === 'per_serving') {
    factor = servings > 0 ? servings : 1;
  } else if (grams > 0) {
    factor = grams / 100;
  } else if (label.serving_size_g > 0 && servings > 0) {
    factor = (servings * label.serving_size_g) / 100;
  } else {
    factor = servings > 0 ? servings : 1;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    food_name: label.product_name.trim() || '包装食品',
    hydration_ml: Math.round(label.hydration_ml * factor),
    protein_g: round1(label.protein_g * factor),
    carbohydrate_g: round1(label.carbohydrate_g * factor),
    calories_kcal: Math.round(label.calories_kcal * factor),
    ai_evaluation: label.ai_evaluation,
  };
}

export async function analyzeFoodNutritionFromLabelImage(
  options: AnalyzeFoodNutritionFromLabelImageOptions,
): Promise<AnalyzeFoodNutritionFromLabelImageResult> {
  const imageBase64 = options.imageBase64.trim();
  if (!imageBase64) return { ok: false, error: '图片为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFoodNutritionFromLabelImage({
      image_base64: imageBase64,
      image_mime_type: options.imageMimeType,
      ...(options.supplementText?.trim()
        ? { supplement_text: options.supplementText.trim() }
        : {}),
    });
    const data = normalizeFoodNutritionLabelPayload(raw);
    if (!data) return { ok: false, error: '未能识别营养标签', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeFoodIntakeCommentOptions = {
  title?: string;
  hydrationMl: number;
  proteinG: number;
  carbohydrateG: number;
  caloriesKcal: number;
  gapHint?: string;
};

export type AnalyzeFoodIntakeCommentResult =
  | { ok: true; data: FoodIntakeCommentJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFoodIntakeCommentPayload(raw: unknown): FoodIntakeCommentJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const ai_evaluation =
    typeof o.ai_evaluation === 'string'
      ? o.ai_evaluation.trim().slice(0, 400)
      : typeof o.comment === 'string'
        ? o.comment.trim().slice(0, 400)
        : '';
  if (!ai_evaluation) return null;
  return { ai_evaluation };
}

export async function analyzeFoodIntakeComment(
  options: AnalyzeFoodIntakeCommentOptions,
): Promise<AnalyzeFoodIntakeCommentResult> {
  try {
    const raw = await aiApi.aiFoodIntakeComment({
      title: options.title?.trim() || undefined,
      hydration_ml: Math.max(0, Number(options.hydrationMl) || 0),
      protein_g: Math.max(0, Number(options.proteinG) || 0),
      carbohydrate_g: Math.max(0, Number(options.carbohydrateG) || 0),
      calories_kcal: Math.max(0, Number(options.caloriesKcal) || 0),
      gap_hint: options.gapHint?.trim() || undefined,
    });
    const data = normalizeFoodIntakeCommentPayload(raw);
    if (!data) return { ok: false, error: '未能生成点评', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

/** 快捷卡 AI 填入：复用文字记饮食，映射为 name + 四项 */
export type ParseQuickAddFromTextResult =
  | {
      ok: true;
      data: {
        name: string;
        hydration_ml: number;
        protein_g: number;
        carbohydrate_g: number;
        calories_kcal: number;
      };
      rawContent: string;
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function parseQuickAddFromText(text: string): Promise<ParseQuickAddFromTextResult> {
  const r = await parseFoodIntakeFromText({ text });
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      attempts: r.attempts,
      httpStatus: r.httpStatus,
      details: r.details,
    };
  }
  const name = (r.data.food_summary || text).trim().slice(0, 24) || '快捷卡';
  return {
    ok: true,
    data: {
      name,
      hydration_ml: r.data.hydration_ml,
      protein_g: r.data.protein_g,
      carbohydrate_g: r.data.carbohydrate_g,
      calories_kcal: r.data.calories_kcal,
    },
    rawContent: r.rawContent,
    attempts: r.attempts,
  };
}

// --- 财务 ---

export type AnalyzeFinanceBillSummaryFromTextOptions = {
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

export type AnalyzeFinanceTxnCommentFromTextOptions = {
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

function parseFinanceMoneyField(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.round(raw * 100) / 100;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim().replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return null;
}

function clampFinanceText(raw: unknown, maxLen: number): string {
  const s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  if (!s) return '';
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

export function normalizeFinanceBudgetSuggestPayload(raw: unknown): FinanceBudgetSuggestJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const amount = parseFinanceMoneyField(o.suggested_base_amount);
  const rationale = clampFinanceText(o.rationale_zh, 240);
  if (amount == null || !rationale) return null;
  const daily = parseFinanceMoneyField(o.daily_cap_hint);
  const tips: string[] = [];
  if (Array.isArray(o.cut_tips)) {
    for (const tip of o.cut_tips) {
      const t = clampFinanceText(tip, 60);
      if (t && !tips.includes(t)) tips.push(t);
      if (tips.length >= 5) break;
    }
  }
  return {
    suggested_base_amount: Math.min(amount, 9_999_999),
    rationale_zh: rationale,
    ...(daily != null ? { daily_cap_hint: daily } : {}),
    ...(tips.length ? { cut_tips: tips } : {}),
  };
}

export type AnalyzeFinanceBudgetSuggestOptions = {
  summaryText: string;
  currentBaseAmount?: number | null;
};

export type AnalyzeFinanceBudgetSuggestResult =
  | { ok: true; data: FinanceBudgetSuggestJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceBudgetSuggest(
  options: AnalyzeFinanceBudgetSuggestOptions,
): Promise<AnalyzeFinanceBudgetSuggestResult> {
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceBudgetSuggest({
      summary_text: text,
      current_base_amount: options.currentBaseAmount ?? null,
    });
    const data = normalizeFinanceBudgetSuggestPayload(raw);
    if (!data) return { ok: false, error: '预算建议无效', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

const SAVINGS_ADJUST_KINDS = new Set<FinanceSavingsGoalAdjustKind>([
  'extend_days',
  'lower_target',
  'raise_daily',
  'other',
]);

export function normalizeFinanceSavingsGoalCoachPayload(raw: unknown): FinanceSavingsGoalCoachJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  let feasible: boolean | null = null;
  if (typeof o.feasible === 'boolean') feasible = o.feasible;
  else if (typeof o.feasible === 'string') {
    const low = o.feasible.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '可行'].includes(low)) feasible = true;
    else if (['false', '0', 'no', 'n', '不可行'].includes(low)) feasible = false;
  }
  const pace = clampFinanceText(o.pace_comment, 200);
  if (feasible == null || !pace) return null;
  const options: FinanceSavingsGoalAdjustOption[] = [];
  if (Array.isArray(o.adjust_options)) {
    for (const row of o.adjust_options) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const kindRaw = String(r.kind ?? '')
        .trim()
        .toLowerCase() as FinanceSavingsGoalAdjustKind;
      const kind = SAVINGS_ADJUST_KINDS.has(kindRaw) ? kindRaw : 'other';
      const label = clampFinanceText(r.label, 80);
      if (!label) continue;
      const item: FinanceSavingsGoalAdjustOption = { kind, label };
      if (typeof r.days === 'number' && Number.isFinite(r.days) && r.days > 0) {
        item.days = Math.round(r.days);
      }
      const amount = parseFinanceMoneyField(r.amount);
      if (amount != null) item.amount = amount;
      options.push(item);
      if (options.length >= 4) break;
    }
  }
  return {
    feasible,
    pace_comment: pace,
    ...(options.length ? { adjust_options: options } : {}),
  };
}

export type AnalyzeFinanceSavingsGoalCoachOptions = {
  summaryText: string;
};

export type AnalyzeFinanceSavingsGoalCoachResult =
  | { ok: true; data: FinanceSavingsGoalCoachJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceSavingsGoalCoach(
  options: AnalyzeFinanceSavingsGoalCoachOptions,
): Promise<AnalyzeFinanceSavingsGoalCoachResult> {
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceSavingsGoalCoach({ summary_text: text });
    const data = normalizeFinanceSavingsGoalCoachPayload(raw);
    if (!data) return { ok: false, error: '储蓄教练结果无效', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

const SIMULATE_RISK = new Set<FinanceSimulateRiskLevel>(['low', 'medium', 'high']);

export function normalizeFinanceSimulateAdvicePayload(raw: unknown): FinanceSimulateAdviceJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const advice = clampFinanceText(o.advice ?? o.analysis ?? o.comment, 240);
  if (!advice) return null;
  let risk: FinanceSimulateRiskLevel | null = null;
  if (typeof o.risk_level === 'string') {
    const low = o.risk_level.trim().toLowerCase() as FinanceSimulateRiskLevel;
    if (SIMULATE_RISK.has(low)) risk = low;
  }
  return {
    advice,
    ...(risk ? { risk_level: risk } : {}),
  };
}

export type AnalyzeFinanceSimulateAdviceOptions = {
  summaryText: string;
};

export type AnalyzeFinanceSimulateAdviceResult =
  | { ok: true; data: FinanceSimulateAdviceJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceSimulateAdvice(
  options: AnalyzeFinanceSimulateAdviceOptions,
): Promise<AnalyzeFinanceSimulateAdviceResult> {
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceSimulateAdvice({ summary_text: text });
    const data = normalizeFinanceSimulateAdvicePayload(raw);
    if (!data) return { ok: false, error: '模拟建议无效', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export function normalizeFinanceParseTransferPayload(raw: unknown): FinanceParseTransferJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const amount = parseFinanceMoneyField(o.amount);
  if (amount == null || amount <= 0) return null;
  const name = clampFinanceText(o.name || '转账', 40) || '转账';
  const fee = parseFinanceMoneyField(o.fee_amount);
  const from =
    typeof o.from_account_hint === 'string' && o.from_account_hint.trim()
      ? o.from_account_hint.trim()
      : null;
  const to =
    typeof o.to_account_hint === 'string' && o.to_account_hint.trim()
      ? o.to_account_hint.trim()
      : null;
  return {
    amount: Math.min(amount, 99_999_999.99),
    name,
    from_account_hint: from,
    to_account_hint: from && to && from === to ? null : to,
    fee_amount: fee != null && fee > 0 ? fee : null,
  };
}

export type ParseFinanceTransferOptions = {
  text: string;
  accounts?: { name: string; account_no?: string | null }[];
};

export type ParseFinanceTransferResult =
  | { ok: true; data: FinanceParseTransferJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function parseFinanceTransferFromText(
  options: ParseFinanceTransferOptions,
): Promise<ParseFinanceTransferResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '输入为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceParseTransfer({
      text,
      accounts: options.accounts?.map((a) => ({ name: a.name, account_no: a.account_no })),
    });
    const data = normalizeFinanceParseTransferPayload(raw);
    if (!data) return { ok: false, error: '未能解析出有效转账', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export function normalizeFinanceMultiFromImagePayload(raw: unknown): FinanceParseMultiFromImageJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.items)) return null;
  const items: FinanceMultiItemJson[] = [];
  for (const row of o.items) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (r.is_bill === false) continue;
    const amount = parseFinanceMoneyField(r.amount);
    const name = clampFinanceText(r.name, 40);
    if (amount == null || amount <= 0 || !name) continue;
    const typeRaw = String(r.transaction_type || 'expense').toLowerCase();
    const transaction_type = typeRaw === 'income' ? 'income' : 'expense';
    const category_label =
      typeof r.category_label === 'string' && r.category_label.trim()
        ? r.category_label.trim().slice(0, 40)
        : null;
    const payment_account_label =
      typeof r.payment_account_label === 'string' && r.payment_account_label.trim()
        ? r.payment_account_label.trim().slice(0, 80)
        : null;
    const account_name =
      typeof r.account_name === 'string' && r.account_name.trim()
        ? r.account_name.trim().slice(0, 80)
        : null;
    const happened_at =
      typeof r.happened_at === 'string' && r.happened_at.trim()
        ? r.happened_at.trim()
        : extractBillHappenedAtFromAiJson(r);
    items.push({
      is_bill: true,
      transaction_type,
      amount: Math.min(amount, 99_999_999.99),
      name,
      category_label,
      payment_account_label,
      account_name,
      ...(happened_at ? { happened_at } : {}),
    });
    if (items.length >= 12) break;
  }
  if (!items.length) return null;
  return { items };
}

export type ParseFinanceMultiFromImageOptions = {
  imageDataUri: string;
  accounts?: { name: string; account_no?: string | null }[];
  maxItems?: number;
};

export type ParseFinanceMultiFromImageResult =
  | { ok: true; data: FinanceParseMultiFromImageJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function parseFinanceMultiFromImage(
  options: ParseFinanceMultiFromImageOptions,
): Promise<ParseFinanceMultiFromImageResult> {
  const uri = options.imageDataUri.trim();
  if (!uri) return { ok: false, error: '图片为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(uri);
  if (!image_base64) return { ok: false, error: '无法解析图片数据', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceParseMultiFromImage({
      image_base64,
      image_mime_type,
      accounts: options.accounts?.map((a) => ({ name: a.name, account_no: a.account_no })),
      max_items: options.maxItems ?? 8,
    });
    const data = normalizeFinanceMultiFromImagePayload(raw);
    if (!data) return { ok: false, error: '未能识别出多笔账单', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export function normalizeFinanceScheduledExpensePayload(
  raw: unknown,
): FinanceParseScheduledExpenseJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const amount = parseFinanceMoneyField(o.amount);
  const name = clampFinanceText(o.name, 40);
  if (amount == null || amount <= 0 || !name) return null;
  const repeatRaw = String(o.repeat_hint || 'monthly').toLowerCase();
  const repeat_hint: FinanceScheduledRepeatHint =
    repeatRaw === 'daily' || repeatRaw === 'weekly' || repeatRaw === 'monthly'
      ? repeatRaw
      : 'monthly';
  const days: number[] = [];
  if (Array.isArray(o.days)) {
    for (const d of o.days) {
      const n = typeof d === 'number' ? d : Number(d);
      if (!Number.isFinite(n)) continue;
      const i = Math.round(n);
      if (repeat_hint === 'weekly' && i >= 1 && i <= 7) days.push(i);
      else if (repeat_hint === 'monthly' && i >= 1 && i <= 31) days.push(i);
      if (days.length >= 8) break;
    }
  }
  let hour = 9;
  let minute = 0;
  if (typeof o.hour === 'number' && Number.isFinite(o.hour)) hour = Math.max(0, Math.min(23, Math.round(o.hour)));
  if (typeof o.minute === 'number' && Number.isFinite(o.minute))
    minute = Math.max(0, Math.min(59, Math.round(o.minute)));
  return {
    name,
    amount: Math.min(amount, 99_999_999.99),
    repeat_hint,
    days:
      repeat_hint === 'daily'
        ? []
        : days.length
          ? days
          : repeat_hint === 'weekly'
            ? [1]
            : [1],
    hour,
    minute,
    account_hint:
      typeof o.account_hint === 'string' && o.account_hint.trim() ? o.account_hint.trim() : null,
    category_hint:
      typeof o.category_hint === 'string' && o.category_hint.trim()
        ? o.category_hint.trim().slice(0, 40)
        : null,
    include_in_budget: typeof o.include_in_budget === 'boolean' ? o.include_in_budget : true,
  };
}

export type ParseFinanceScheduledExpenseOptions = {
  text: string;
  accounts?: { name: string; account_no?: string | null }[];
  categoryNames?: string[];
};

export type ParseFinanceScheduledExpenseResult =
  | { ok: true; data: FinanceParseScheduledExpenseJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function parseFinanceScheduledExpenseFromText(
  options: ParseFinanceScheduledExpenseOptions,
): Promise<ParseFinanceScheduledExpenseResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '输入为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceParseScheduledExpense({
      text,
      accounts: options.accounts?.map((a) => ({ name: a.name, account_no: a.account_no })),
      category_names: options.categoryNames,
    });
    const data = normalizeFinanceScheduledExpensePayload(raw);
    if (!data) return { ok: false, error: '未能解析出定时支出草稿', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export function normalizeFinanceSuggestCategoryPayload(
  raw: unknown,
  allowedLabels: string[],
): FinanceSuggestCategoryJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const allowed = allowedLabels.map((x) => x.trim()).filter(Boolean);
  if (!allowed.length) return null;
  let label = typeof o.category_label === 'string' ? o.category_label.trim() : '';
  if (!allowed.includes(label)) {
    const hit = allowed.find((a) => label && (label.includes(a) || a.includes(label)));
    if (!hit) return null;
    label = hit;
  }
  let confidence = 0.6;
  if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
    confidence = Math.max(0, Math.min(1, o.confidence));
  }
  return {
    category_label: label,
    confidence: Math.round(confidence * 1000) / 1000,
    reason: clampFinanceText(o.reason || '与流水语义更匹配', 80) || '与流水语义更匹配',
  };
}

export type SuggestFinanceCategoryOptions = {
  summaryText: string;
  categoryNames: string[];
};

export type SuggestFinanceCategoryResult =
  | { ok: true; data: FinanceSuggestCategoryJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function suggestFinanceCategory(
  options: SuggestFinanceCategoryOptions,
): Promise<SuggestFinanceCategoryResult> {
  const text = options.summaryText.trim();
  const names = options.categoryNames.map((n) => n.trim()).filter(Boolean);
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  if (!names.length) return { ok: false, error: '候选分类为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceSuggestCategory({
      summary_text: text,
      category_names: names,
    });
    const data = normalizeFinanceSuggestCategoryPayload(raw, names);
    if (!data) return { ok: false, error: '未返回候选内分类', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export function normalizeFinanceAnomalyHintsPayload(
  raw: unknown,
  allowedTxnIds: string[],
): FinanceAnomalyHintsJson {
  const allowed = new Set(allowedTxnIds.map((x) => x.trim()).filter(Boolean));
  if (!raw || typeof raw !== 'object') return { hints: [] };
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.hints) ? o.hints : [];
  const hints: FinanceAnomalyHintItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = clampFinanceText(r.title || r.headline, 28);
    const body = clampFinanceText(r.body || r.text || r.message, 120);
    if (!title || !body) continue;
    const txn_ids: string[] = [];
    const rawIds = r.txn_ids ?? r.transaction_ids ?? r.ids;
    if (Array.isArray(rawIds)) {
      for (const x of rawIds) {
        const id =
          typeof x === 'string'
            ? x.trim()
            : x && typeof x === 'object'
              ? String((x as Record<string, unknown>).id ?? (x as Record<string, unknown>).txn_id ?? '').trim()
              : '';
        if (id && allowed.has(id) && !txn_ids.includes(id)) txn_ids.push(id);
        if (txn_ids.length >= 8) break;
      }
    }
    hints.push({ txn_ids, title, body });
    if (hints.length >= 5) break;
  }
  return { hints };
}

export type AnalyzeFinanceAnomalyHintsOptions = {
  summaryText: string;
  txnIds?: string[];
};

export type AnalyzeFinanceAnomalyHintsResult =
  | { ok: true; data: FinanceAnomalyHintsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceAnomalyHints(
  options: AnalyzeFinanceAnomalyHintsOptions,
): Promise<AnalyzeFinanceAnomalyHintsResult> {
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  const txnIds = (options.txnIds ?? []).map((x) => x.trim()).filter(Boolean);
  try {
    const raw = await aiApi.aiFinanceAnomalyHints({
      summary_text: text,
      txn_ids: txnIds.length ? txnIds : undefined,
    });
    const data = normalizeFinanceAnomalyHintsPayload(raw, txnIds);
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export function normalizeFinanceDailyWrapupPayload(raw: unknown): FinanceDailyWrapupJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = clampFinanceText(o.title || o.headline, 28) || '财务收口';
  const body = clampFinanceText(o.body || o.text || o.wrapup || o.message, 120);
  if (!body) return null;
  return { title, body };
}

export type AnalyzeFinanceDailyWrapupOptions = {
  summaryText: string;
  period?: FinanceDailyWrapupPeriod;
};

export type AnalyzeFinanceDailyWrapupResult =
  | { ok: true; data: FinanceDailyWrapupJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeFinanceDailyWrapup(
  options: AnalyzeFinanceDailyWrapupOptions,
): Promise<AnalyzeFinanceDailyWrapupResult> {
  const text = options.summaryText.trim();
  if (!text) return { ok: false, error: '摘要为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceDailyWrapup({
      summary_text: text,
      period: options.period ?? 'daily',
    });
    const data = normalizeFinanceDailyWrapupPayload(raw);
    if (!data) return { ok: false, error: '收口文案无效', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

const CASH_FLOW_ENTRY_KINDS = new Set<FinanceCashFlowEntryKind>([
  'income',
  'necessary',
  'unnecessary',
  'asset',
  'liability',
]);
const CASH_FLOW_QUADRANTS = new Set<FinanceCashFlowQuadrant>(['E', 'S', 'B', 'I']);

export function normalizeFinanceParseCashFlowEntryPayload(
  raw: unknown,
): FinanceParseCashFlowEntryJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kindRaw = String(o.entry_kind ?? o.kind ?? '')
    .trim()
    .toLowerCase();
  const kindMap: Record<string, FinanceCashFlowEntryKind> = {
    income: 'income',
    主动收入: 'income',
    necessary: 'necessary',
    必要: 'necessary',
    必要支出: 'necessary',
    unnecessary: 'unnecessary',
    非必要: 'unnecessary',
    非必要支出: 'unnecessary',
    asset: 'asset',
    资产: 'asset',
    资产投入: 'asset',
    holding: 'asset',
    liability: 'liability',
    负债: 'liability',
    负债偿还: 'liability',
  };
  const entry_kind = kindMap[kindRaw];
  if (!entry_kind || !CASH_FLOW_ENTRY_KINDS.has(entry_kind)) return null;
  const amount = parseFinanceMoneyField(o.amount);
  if (amount == null || amount <= 0) return null;
  let name_hint = clampFinanceText(o.name_hint || o.name, 40);
  if (!name_hint) {
    name_hint =
      entry_kind === 'income'
        ? '新增收入'
        : entry_kind === 'necessary'
          ? '必要支出'
          : entry_kind === 'unnecessary'
            ? '非必要消费'
            : entry_kind === 'asset'
              ? '资产投入'
              : '负债偿还';
  }
  let quadrant: FinanceCashFlowQuadrant | null = null;
  if (entry_kind === 'income') {
    const q = String(o.quadrant ?? '')
      .trim()
      .toUpperCase() as FinanceCashFlowQuadrant;
    quadrant = CASH_FLOW_QUADRANTS.has(q) ? q : 'E';
  }
  let asset_return: number | null = null;
  let liability_months: number | null = null;
  if (entry_kind === 'asset') {
    const ar = parseFinanceMoneyField(o.asset_return);
    asset_return = ar != null ? ar : 0;
  }
  if (entry_kind === 'liability') {
    const lm =
      typeof o.liability_months === 'number'
        ? o.liability_months
        : Number(o.liability_months);
    liability_months =
      Number.isFinite(lm) && lm >= 1 ? Math.max(1, Math.min(600, Math.round(lm))) : 12;
  }
  return {
    entry_kind,
    amount: Math.min(amount, 99_999_999.99),
    name_hint,
    quadrant,
    asset_return,
    liability_months,
  };
}

export type ParseFinanceCashFlowEntryOptions = {
  text: string;
  existingNames?: string[];
};

export type ParseFinanceCashFlowEntryResult =
  | { ok: true; data: FinanceParseCashFlowEntryJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function parseFinanceCashFlowEntryFromText(
  options: ParseFinanceCashFlowEntryOptions,
): Promise<ParseFinanceCashFlowEntryResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '输入为空', attempts: 0 };
  try {
    const raw = await aiApi.aiFinanceParseCashFlowEntry({
      text,
      existing_names: options.existingNames,
    });
    const data = normalizeFinanceParseCashFlowEntryPayload(raw);
    if (!data) return { ok: false, error: '未能解析出有效现金流草稿', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoReviewFromTextOptions = {
  memoContextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeMemoReviewFromTextResult =
  | {
      ok: true;
      evaluation: string;
      suggestions: string;
      bullets?: string[];
      suggested_action?: MemoSuggestedAction;
      draft_title?: string;
      rawContent: string;
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type MemoReviewJsonNormalizeMode = 'memo' | 'full';

function pickMemoSuggestedAction(raw: unknown): MemoSuggestedAction | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'todo' || v === 'project' || v === 'keep' || v === 'archive') return v;
  return undefined;
}

function normalizeMemoReviewPayload(data: MemoReviewJson): Omit<
  Extract<AnalyzeMemoReviewFromTextResult, { ok: true }>,
  'ok' | 'rawContent' | 'attempts'
> {
  const bullets = (data.bullets ?? [])
    .filter((t): t is string => typeof t === 'string' && !!t.trim())
    .map(t => t.trim().slice(0, 80))
    .slice(0, 6);
  const draft =
    typeof data.draft_title === 'string' && data.draft_title.trim()
      ? data.draft_title.trim().slice(0, 50)
      : undefined;
  const action = pickMemoSuggestedAction(data.suggested_action);
  return {
    evaluation: data.evaluation,
    suggestions: data.suggestions,
    ...(bullets.length ? { bullets } : {}),
    ...(action ? { suggested_action: action } : {}),
    ...(draft ? { draft_title: draft } : {}),
  };
}

export async function analyzeMemoReviewFromText(
  options: AnalyzeMemoReviewFromTextOptions,
): Promise<AnalyzeMemoReviewFromTextResult> {
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  try {
    const data = await aiApi.aiMemoReview({ memo_context_text: text });
    return {
      ok: true,
      ...normalizeMemoReviewPayload(data),
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoConvertDraftOptions = {
  memoContextText: string;
  target?: MemoConvertTarget;
  aiSummary?: string;
};

export type AnalyzeMemoConvertDraftResult =
  | { ok: true; data: MemoConvertDraftJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoConvertDraft(
  options: AnalyzeMemoConvertDraftOptions,
): Promise<AnalyzeMemoConvertDraftResult> {
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  try {
    const data = await aiApi.aiMemoConvertDraft({
      memo_context_text: text,
      target: options.target,
      ai_summary: options.aiSummary?.trim() || undefined,
    });
    return { ok: true, data, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoSuggestTagsOptions = {
  memoContextText: string;
  tags: { id: string; name: string }[];
  tagIds?: string[];
};

export type AnalyzeMemoSuggestTagsResult =
  | { ok: true; data: MemoSuggestTagsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoSuggestTags(
  options: AnalyzeMemoSuggestTagsOptions,
): Promise<AnalyzeMemoSuggestTagsResult> {
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  try {
    const data = await aiApi.aiMemoSuggestTags({
      memo_context_text: text,
      tags: options.tags,
      tag_ids: options.tagIds,
    });
    const allowed = new Set(options.tags.map(t => t.id));
    const tag_ids = (data.tag_ids ?? []).filter(id => typeof id === 'string' && allowed.has(id));
    const new_tag_names = (data.new_tag_names ?? [])
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map(n => n.trim().slice(0, 20))
      .slice(0, 5);
    return {
      ok: true,
      data: { tag_ids, new_tag_names },
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoDraftFromTextOptions = {
  text: string;
  style?: MemoDraftStyle;
};

export type AnalyzeMemoDraftFromTextResult =
  | { ok: true; data: MemoDraftFromTextJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoDraftFromText(
  options: AnalyzeMemoDraftFromTextOptions,
): Promise<AnalyzeMemoDraftFromTextResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '输入为空', attempts: 0 };
  try {
    const data = await aiApi.aiMemoDraftFromText({
      text,
      style: options.style,
    });
    const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
    const body_plain = typeof data.body_plain === 'string' ? data.body_plain.trim().slice(0, 4000) : '';
    if (!title && !body_plain) {
      return { ok: false, error: '未能生成有效备忘草稿', attempts: 1, details: data };
    }
    const tag_name_hints = (data.tag_name_hints ?? [])
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map(n => n.trim().slice(0, 20))
      .slice(0, 5);
    return {
      ok: true,
      data: { title: title || '未命名备忘', body_plain, tag_name_hints },
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoDraftFromImageOptions = {
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
};

export type AnalyzeMemoDraftFromImageResult =
  | { ok: true; data: MemoDraftFromImageJson; rawContent: string; attempts: number }
  | {
      ok: false;
      error: string;
      attempts: number;
      notMemo?: boolean;
      httpStatus?: number;
      details?: unknown;
    };

export async function analyzeMemoDraftFromImage(
  options: AnalyzeMemoDraftFromImageOptions,
): Promise<AnalyzeMemoDraftFromImageResult> {
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) return { ok: false, error: '图片数据为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(
    rawB64,
    (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg',
  );
  if (!image_base64) return { ok: false, error: '无法解析图片数据', attempts: 0 };
  try {
    const data = await aiApi.aiMemoDraftFromImage({
      image_base64,
      image_mime_type,
      supplement_text: options.supplementText?.trim() || undefined,
    });
    const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
    const body_plain = typeof data.body_plain === 'string' ? data.body_plain.trim().slice(0, 4000) : '';
    const confidence =
      typeof data.confidence === 'number' && Number.isFinite(data.confidence)
        ? Math.min(1, Math.max(0, data.confidence))
        : 0;
    if (!title && !body_plain) {
      return {
        ok: false,
        error: data.reject_reason?.trim() || '未能识别为备忘内容',
        notMemo: true,
        attempts: 1,
        details: data,
      };
    }
    return {
      ok: true,
      data: {
        title: title || '图片备忘',
        body_plain,
        confidence,
        ...(data.reject_reason ? { reject_reason: data.reject_reason } : {}),
      },
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    const notMemo = /不像备忘|不是备忘|未能识别为备忘/.test(err.error);
    return {
      ok: false,
      error: err.error,
      attempts: 1,
      httpStatus: err.httpStatus,
      details: err.details,
      ...(notMemo ? { notMemo: true } : {}),
    };
  }
}

export type AnalyzeMemoRewriteOptions = {
  memoContextText: string;
  mode?: MemoRewriteMode;
};

export type AnalyzeMemoRewriteResult =
  | { ok: true; data: MemoRewriteJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoRewrite(
  options: AnalyzeMemoRewriteOptions,
): Promise<AnalyzeMemoRewriteResult> {
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  try {
    const data = await aiApi.aiMemoRewrite({
      memo_context_text: text,
      mode: options.mode,
    });
    const body_plain = typeof data.body_plain === 'string' ? data.body_plain.trim().slice(0, 4000) : '';
    if (!body_plain) {
      return { ok: false, error: '未能生成有效改写', attempts: 1, details: data };
    }
    const title =
      typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 80) : undefined;
    const change_summary =
      typeof data.change_summary === 'string' ? data.change_summary.trim().slice(0, 80) : '';
    return {
      ok: true,
      data: { ...(title ? { title } : {}), body_plain, change_summary },
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoDedupeHintsOptions = {
  memoContextText: string;
  currentMemoId: string;
  candidates: MemoAiSummaryItem[];
};

export type AnalyzeMemoDedupeHintsResult =
  | { ok: true; data: MemoDedupeHintsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoDedupeHints(
  options: AnalyzeMemoDedupeHintsOptions,
): Promise<AnalyzeMemoDedupeHintsResult> {
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  const allowed = new Set(options.candidates.map(c => c.id).filter(Boolean));
  try {
    const data = await aiApi.aiMemoDedupeHints({
      memo_context_text: text,
      current_memo_id: options.currentMemoId,
      candidates: options.candidates,
    });
    const similar = (data.similar ?? [])
      .filter(
        s =>
          s &&
          typeof s.memo_id === 'string' &&
          allowed.has(s.memo_id) &&
          s.memo_id !== options.currentMemoId,
      )
      .map(s => ({
        memo_id: s.memo_id,
        score: typeof s.score === 'number' && Number.isFinite(s.score) ? Math.min(1, Math.max(0, s.score)) : 0,
        reason: typeof s.reason === 'string' ? s.reason.trim().slice(0, 80) : '',
      }))
      .slice(0, 8);
    return { ok: true, data: { similar }, rawContent: JSON.stringify(data), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoCollectionInsightsOptions = {
  periodLabel?: string;
  memos: MemoAiSummaryItem[];
};

export type AnalyzeMemoCollectionInsightsResult =
  | { ok: true; data: MemoCollectionInsightsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoCollectionInsights(
  options: AnalyzeMemoCollectionInsightsOptions,
): Promise<AnalyzeMemoCollectionInsightsResult> {
  if (!options.memos.length) return { ok: false, error: '备忘列表为空', attempts: 0 };
  const allowed = new Set(options.memos.map(m => m.id).filter(Boolean));
  try {
    const data = await aiApi.aiMemoCollectionInsights({
      period_label: options.periodLabel,
      memos: options.memos,
    });
    const themes = (data.themes ?? []).filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 6);
    const open_loops = (data.open_loops ?? [])
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .slice(0, 8);
    const tips = (data.tips ?? []).filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 6);
    const memo_ids = (data.memo_ids ?? []).filter((id): id is string => typeof id === 'string' && allowed.has(id));
    return {
      ok: true,
      data: { themes, open_loops, tips, memo_ids },
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeMemoLinkSuggestOptions = {
  memoContextText: string;
  projects: { id: string; name: string }[];
  todos: { id: string; title: string }[];
};

export type AnalyzeMemoLinkSuggestResult =
  | { ok: true; data: MemoLinkSuggestJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function analyzeMemoLinkSuggest(
  options: AnalyzeMemoLinkSuggestOptions,
): Promise<AnalyzeMemoLinkSuggestResult> {
  const text = options.memoContextText.trim();
  if (!text) return { ok: false, error: '备忘内容为空', attempts: 0 };
  if (!options.projects.length && !options.todos.length) {
    return { ok: false, error: '没有可关联的项目或待办', attempts: 0 };
  }
  const allowedProjects = new Set(options.projects.map(p => p.id).filter(Boolean));
  const allowedTodos = new Set(options.todos.map(t => t.id).filter(Boolean));
  try {
    const data = await aiApi.aiMemoLinkSuggest({
      memo_context_text: text,
      projects: options.projects,
      todos: options.todos,
    });
    const project_ids = (data.project_ids ?? []).filter(
      (id): id is string => typeof id === 'string' && allowedProjects.has(id),
    );
    const task_ids = (data.task_ids ?? []).filter(
      (id): id is string => typeof id === 'string' && allowedTodos.has(id),
    );
    const reasons: Record<string, string> = {};
    const rawReasons = data.reasons && typeof data.reasons === 'object' ? data.reasons : {};
    for (const [k, v] of Object.entries(rawReasons)) {
      if ((project_ids.includes(k) || task_ids.includes(k)) && typeof v === 'string' && v.trim()) {
        reasons[k] = v.trim().slice(0, 120);
      }
    }
    let create_todo_draft: MemoLinkSuggestJson['create_todo_draft'] = null;
    const draft = data.create_todo_draft;
    if (draft && typeof draft === 'object' && typeof draft.title === 'string' && draft.title.trim()) {
      create_todo_draft = {
        title: draft.title.trim().slice(0, 50),
        note: typeof draft.note === 'string' ? draft.note.trim().slice(0, 500) : '',
      };
    }
    return {
      ok: true,
      data: { project_ids, task_ids, reasons, create_todo_draft },
      rawContent: JSON.stringify(data),
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type GenerateWeeklyReviewCoachingFromTextOptions = {
  /** @deprecated 仅兼容旧调用；优先传 reviewType + dimensions */
  userPrompt?: string;
  reviewType?: 'daily' | 'weekly' | 'monthly';
  periodLabel?: string;
  dimensions?: aiApi.ReviewCoachingDimension[];
  metricsText?: string | null;
  relatedDigest?: string | null;
  executionScore?: number | null;
  reviewData?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type GenerateWeeklyReviewCoachingFromTextResult =
  | {
      ok: true;
      text: string;
      title: string;
      overview: string;
      tags: string[];
      suggestions: aiApi.ReviewCoachingSuggestion[];
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

/** 把结构化复盘拼成整段正文；兼容仍只认 user_prompt 的旧版 Agent */
function assembleReviewUserPrompt(options: GenerateWeeklyReviewCoachingFromTextOptions): string {
  const explicit = (options.userPrompt ?? '').trim();
  if (explicit) return explicit;

  const parts: string[] = [];
  const label = (options.periodLabel ?? '').trim();
  if (label) parts.push(`复盘周期：${label}`);
  if (options.executionScore != null) parts.push(`自评执行分（1-5）：${options.executionScore}`);
  if (parts.length > 0) parts.push('');

  const dims = options.dimensions ?? [];
  dims.forEach((dim, idx) => {
    const title = (dim.title ?? '').trim() || `维度${idx + 1}`;
    parts.push(`${idx + 1}、${title}：`);
    const columns = dim.columns;
    if (!columns || columns.length === 0) {
      parts.push((dim.value ?? '').trim() || '（未填写）');
      parts.push('');
      return;
    }
    for (const col of columns) {
      const colTitle = (col.title ?? '').trim();
      const colValue = (col.value ?? '').trim();
      if (columns.length > 1 && colTitle) parts.push(`【${colTitle}】`);
      parts.push(colValue || '（未填写）');
      parts.push('');
    }
  });

  const metrics = (options.metricsText ?? '').trim();
  if (metrics) {
    parts.push('App 内本周期统计：');
    parts.push(metrics);
    parts.push('');
  }

  const digest = (options.relatedDigest ?? '').trim();
  if (digest) {
    parts.push('相关周期原文：');
    parts.push(digest);
    parts.push('');
  }

  const blob = (options.reviewData ?? '').trim();
  if (blob) {
    if (dims.length > 0 || metrics || digest) parts.push('补充原文：');
    parts.push(blob);
  }

  return parts.join('\n').trim();
}

export async function generateWeeklyReviewCoachingFromText(
  options: GenerateWeeklyReviewCoachingFromTextOptions,
): Promise<GenerateWeeklyReviewCoachingFromTextResult> {
  const userPrompt = assembleReviewUserPrompt(options);
  if (!userPrompt) return { ok: false, error: '复盘内容为空', attempts: 0 };
  try {
    const data = await aiApi.aiWeeklyReviewCoaching({
      review_type: options.reviewType ?? 'weekly',
      period_label: options.periodLabel ?? '',
      dimensions: options.dimensions,
      metrics_text: options.metricsText,
      related_digest: options.relatedDigest,
      execution_score: options.executionScore,
      review_data: options.reviewData,
      // 线上旧 Agent 仍强制校验 user_prompt；新 Agent 会优先用 dimensions
      user_prompt: userPrompt,
    });
    // 调试：控制台查看 Agent 回传的完整复盘 JSON
    console.log('[review-ai] coaching response', JSON.stringify(data, null, 2));
    const title = (data.title ?? '').trim();
    const overview = (data.overview ?? '').trim();
    const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [];
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    // 优先用服务端规范 JSON；缺字段时本地再序列化一份，保证落库可解析
    let text = (data.text ?? '').trim();
    if (!text && (title || overview || suggestions.length > 0)) {
      text = JSON.stringify({
        title,
        overview,
        tags,
        suggestions: suggestions.map(s => ({
          text: s.text,
          action: s.action,
          draft_title: s.draft_title,
          draft_body: s.draft_body ?? '',
        })),
      });
    }
    return {
      ok: true,
      text,
      title,
      overview,
      tags,
      suggestions,
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] coaching failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type DraftReviewDimensionOptions = {
  scope?: 'daily' | 'weekly' | 'monthly';
  periodLabel?: string;
  dimensionTitle: string;
  columnTitle?: string | null;
  factsText?: string;
  existingText?: string | null;
  userHint?: string | null;
};

export type DraftReviewDimensionResult =
  | { ok: true; data: aiApi.ReviewDraftDimensionResult; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function draftReviewDimension(
  options: DraftReviewDimensionOptions,
): Promise<DraftReviewDimensionResult> {
  const facts = (options.factsText ?? '').trim();
  const existing = (options.existingText ?? '').trim();
  const hint = (options.userHint ?? '').trim();
  if (!facts && !existing && !hint) return { ok: false, error: '起草素材为空', attempts: 0 };
  try {
    const data = await aiApi.aiReviewDraftDimension({
      scope: options.scope ?? 'daily',
      period_label: options.periodLabel ?? '',
      dimension_title: options.dimensionTitle,
      column_title: options.columnTitle,
      facts_text: facts,
      existing_text: existing || null,
      user_hint: hint || null,
    });
    const draft_text = (data.draft_text ?? '').trim();
    if (!draft_text) return { ok: false, error: 'AI 未返回草稿', attempts: 1 };
    return {
      ok: true,
      data: {
        draft_text,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.7,
      },
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] draft-dimension failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ConvertReviewActionsOptions = {
  scope?: 'daily' | 'weekly' | 'monthly';
  periodLabel?: string;
  dimensionTitle?: string;
  text: string;
  openItems?: { id: string; title: string }[];
};

export type ConvertReviewActionsResult =
  | { ok: true; data: aiApi.ReviewConvertActionsResult; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function convertReviewActions(
  options: ConvertReviewActionsOptions,
): Promise<ConvertReviewActionsResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '复盘正文为空', attempts: 0 };
  try {
    const data = await aiApi.aiReviewConvertActions({
      scope: options.scope ?? 'daily',
      period_label: options.periodLabel ?? '',
      dimension_title: options.dimensionTitle ?? '',
      text,
      open_items: options.openItems,
    });
    const actions = Array.isArray(data.actions) ? data.actions : [];
    if (actions.length === 0) return { ok: false, error: 'AI 未返回行动草稿', attempts: 1 };
    return { ok: true, data: { actions }, attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] convert-actions failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type RewriteReviewDimensionOptions = {
  text: string;
  mode?: aiApi.ReviewRewriteDimensionMode;
  dimensionTitle?: string;
  scope?: 'daily' | 'weekly' | 'monthly';
  periodLabel?: string;
  columnTitle?: string | null;
};

export type RewriteReviewDimensionResult =
  | { ok: true; data: aiApi.ReviewRewriteDimensionResult; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function rewriteReviewDimension(
  options: RewriteReviewDimensionOptions,
): Promise<RewriteReviewDimensionResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '复盘正文为空', attempts: 0 };
  try {
    const data = await aiApi.aiReviewRewriteDimension({
      text,
      mode: options.mode ?? 'tighten',
      dimension_title: options.dimensionTitle ?? '',
      scope: options.scope ?? 'daily',
      period_label: options.periodLabel ?? '',
      column_title: options.columnTitle,
    });
    const rewritten = (data.text ?? '').trim();
    if (!rewritten) return { ok: false, error: 'AI 未返回改写草稿', attempts: 1 };
    return {
      ok: true,
      data: {
        text: rewritten,
        change_summary: (data.change_summary ?? '').trim() || undefined,
      },
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] rewrite-dimension failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type OutlineReviewOptions = {
  scope?: 'daily' | 'weekly';
  periodLabel?: string;
  factsText?: string;
  metricsText?: string | null;
  dimensionTitles?: string[];
  openDefectHint?: string | null;
};

export type OutlineReviewResult =
  | { ok: true; data: aiApi.ReviewOutlineResult; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function outlineReview(options: OutlineReviewOptions): Promise<OutlineReviewResult> {
  const facts = (options.factsText ?? '').trim();
  const metrics = (options.metricsText ?? '').trim();
  const defect = (options.openDefectHint ?? '').trim();
  const titles = (options.dimensionTitles ?? []).map(t => t.trim()).filter(Boolean);
  if (!facts && !metrics && titles.length === 0 && !defect) {
    return { ok: false, error: '提纲素材为空', attempts: 0 };
  }
  try {
    const data = await aiApi.aiReviewOutline({
      scope: options.scope ?? 'daily',
      period_label: options.periodLabel ?? '',
      facts_text: facts,
      metrics_text: metrics || null,
      dimension_titles: titles.length ? titles : undefined,
      open_defect_hint: defect || null,
    });
    const outline = Array.isArray(data.outline) ? data.outline : [];
    if (outline.length === 0) return { ok: false, error: 'AI 未返回提纲', attempts: 1 };
    return {
      ok: true,
      data: {
        headline: (data.headline ?? '').trim() || undefined,
        outline: outline.map(item => ({
          dimension_title: (item.dimension_title ?? '').trim(),
          prompts: Array.isArray(item.prompts)
            ? item.prompts.map(p => String(p ?? '').trim()).filter(Boolean)
            : [],
        })).filter(item => item.dimension_title && item.prompts.length > 0),
      },
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] outline failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type PeriodInsightsReviewOptions = {
  scope?: 'weekly' | 'monthly';
  periods: aiApi.ReviewPeriodSummaryItem[];
  aggregateMetrics?: string | null;
};

export type PeriodInsightsReviewResult =
  | { ok: true; data: aiApi.ReviewPeriodInsightsResult; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function periodInsightsReview(
  options: PeriodInsightsReviewOptions,
): Promise<PeriodInsightsReviewResult> {
  const periods = Array.isArray(options.periods) ? options.periods : [];
  const agg = (options.aggregateMetrics ?? '').trim();
  if (periods.length === 0 && !agg) {
    return { ok: false, error: '跨周期素材为空', attempts: 0 };
  }
  try {
    const data = await aiApi.aiReviewPeriodInsights({
      scope: options.scope ?? 'weekly',
      periods,
      aggregate_metrics: agg || null,
    });
    const themes = Array.isArray(data.themes) ? data.themes.map(t => String(t ?? '').trim()).filter(Boolean) : [];
    const recurring = Array.isArray(data.recurring_defects)
      ? data.recurring_defects.map(t => String(t ?? '').trim()).filter(Boolean)
      : [];
    const tips = Array.isArray(data.tips) ? data.tips.map(t => String(t ?? '').trim()).filter(Boolean) : [];
    const suggested = Array.isArray(data.suggested_actions) ? data.suggested_actions : [];
    if (!themes.length && !recurring.length && !tips.length && suggested.length === 0) {
      return { ok: false, error: 'AI 未返回跨周期洞察', attempts: 1 };
    }
    return {
      ok: true,
      data: {
        themes,
        recurring_defects: recurring,
        tips,
        suggested_actions: suggested,
      },
      attempts: 1,
    };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] period-insights failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type SuggestReviewTemplateCopyOptions = {
  scope?: 'daily' | 'weekly' | 'monthly';
  dimensionTitles?: string[];
  userGoal?: string;
};

export type SuggestReviewTemplateCopyResult =
  | { ok: true; data: aiApi.ReviewSuggestTemplateCopyResult; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export async function suggestReviewTemplateCopy(
  options: SuggestReviewTemplateCopyOptions,
): Promise<SuggestReviewTemplateCopyResult> {
  const titles = (options.dimensionTitles ?? []).map(t => t.trim()).filter(Boolean);
  const goal = (options.userGoal ?? '').trim();
  if (!titles.length && !goal) {
    return { ok: false, error: '模板建议素材为空', attempts: 0 };
  }
  try {
    const data = await aiApi.aiReviewSuggestTemplateCopy({
      scope: options.scope ?? 'daily',
      dimension_titles: titles.length ? titles : undefined,
      user_goal: goal,
    });
    const columns = Array.isArray(data.columns) ? data.columns : [];
    const normalized = columns
      .map(c => ({
        dimension_title: (c.dimension_title ?? '').trim(),
        column_title: (c.column_title ?? '记录').trim() || '记录',
        placeholder: (c.placeholder ?? '').trim(),
        hint: (c.hint ?? '').trim() || undefined,
      }))
      .filter(c => c.dimension_title && c.placeholder);
    if (!normalized.length) return { ok: false, error: 'AI 未返回模板文案', attempts: 1 };
    return { ok: true, data: { columns: normalized }, attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    console.warn('[review-ai] suggest-template-copy failed', err);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseFinanceOneLinerFromImageAccountHint = {
  name: string;
  account_no?: string | null;
};

export type ParseFinanceOneLinerFromTextOptions = {
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

// --- 菜谱 ---

export type RecipeParseDraft = aiApi.RecipeParseDraftJson;

export type ParseRecipeFromTextOptions = {
  text: string;
  categoryHints?: string[];
};

export type ParseRecipeFromTextResult =
  | { ok: true; data: RecipeParseDraft; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type ParseRecipeFromImageOptions = {
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
  categoryHints?: string[];
};

export type ParseRecipeFromImageResult =
  | { ok: true; data: RecipeParseDraft; rawContent: string; attempts: number }
  | {
      ok: false;
      error: string;
      attempts: number;
      notRecipe?: boolean;
      httpStatus?: number;
      details?: unknown;
    };

function clampRecipeLine(s: string, max = 200): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** 将 Agent 草稿规范化为可预填表单的结构 */
export function normalizeRecipeParseDraft(raw: unknown): RecipeParseDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? clampRecipeLine(o.title, 120) : '';
  const hintRaw = o.category_hint ?? o.category;
  const category_hint =
    typeof hintRaw === 'string' && hintRaw.trim() ? clampRecipeLine(hintRaw, 40) : null;
  const ingredients: aiApi.RecipeIngredientDraft[] = [];
  if (Array.isArray(o.ingredients)) {
    for (const x of o.ingredients) {
      if (typeof x === 'string') {
        const name = clampRecipeLine(x);
        if (name) ingredients.push({ name, amount: '' });
      } else if (x && typeof x === 'object') {
        const row = x as Record<string, unknown>;
        const name = typeof row.name === 'string' ? clampRecipeLine(row.name) : '';
        const amount = typeof row.amount === 'string' ? clampRecipeLine(row.amount) : '';
        const remark = typeof row.remark === 'string' ? clampRecipeLine(row.remark) : '';
        if (!name && !amount && !remark) continue;
        ingredients.push({
          name,
          amount,
          ...(remark ? { remark } : {}),
        });
      }
      if (ingredients.length >= 80) break;
    }
  }
  const steps: string[] = [];
  if (Array.isArray(o.steps)) {
    for (const x of o.steps) {
      if (typeof x !== 'string') continue;
      const t = clampRecipeLine(x);
      if (!t) continue;
      steps.push(t);
      if (steps.length >= 80) break;
    }
  }
  const notes =
    typeof o.notes === 'string' ? (o.notes.trim().length > 2000 ? o.notes.trim().slice(0, 2000) : o.notes.trim()) : '';
  let confidence = 0;
  if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
    confidence = Math.min(1, Math.max(0, o.confidence));
  } else if (typeof o.confidence === 'string') {
    const n = Number(o.confidence);
    if (Number.isFinite(n)) confidence = Math.min(1, Math.max(0, n));
  }
  if (!title && ingredients.length === 0 && steps.length === 0) return null;
  return { title, category_hint, ingredients, steps, notes, confidence };
}

export async function parseRecipeFromText(
  options: ParseRecipeFromTextOptions,
): Promise<ParseRecipeFromTextResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '输入为空', attempts: 0 };
  try {
    const raw = await aiApi.aiRecipeParseFromText({
      text,
      category_hints: options.categoryHints,
    });
    const data = normalizeRecipeParseDraft(raw);
    if (!data) {
      return { ok: false, error: '未能从文本解析出有效菜谱', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function parseRecipeFromImage(
  options: ParseRecipeFromImageOptions,
): Promise<ParseRecipeFromImageResult> {
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) return { ok: false, error: '图片数据为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(
    rawB64,
    (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg',
  );
  if (!image_base64) return { ok: false, error: '无法解析图片数据', attempts: 0 };
  try {
    const raw = await aiApi.aiRecipeParseFromImage({
      image_base64,
      image_mime_type,
      supplement_text: options.supplementText?.trim() || undefined,
      category_hints: options.categoryHints,
    });
    const data = normalizeRecipeParseDraft(raw);
    if (!data) {
      return {
        ok: false,
        error: '未能识别为菜谱内容',
        notRecipe: true,
        attempts: 1,
        details: raw,
      };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    const notRecipe = /未能识别为菜谱|不是菜谱/.test(err.error);
    return {
      ok: false,
      error: err.error,
      attempts: 1,
      httpStatus: err.httpStatus,
      details: err.details,
      ...(notRecipe ? { notRecipe: true } : {}),
    };
  }
}

// --- 菜谱 P1：周排餐 / 食材选菜 ---

export type SuggestRecipeWeekPlanOptions = {
  startDate: string;
  endDate: string;
  recipes: aiApi.RecipeAiSummaryItem[];
  existingPlan?: aiApi.RecipeAiPlanSummaryItem[];
  preferences?: string;
  targetSlots?: string[];
};

export type SuggestRecipeWeekPlanResult =
  | { ok: true; data: aiApi.RecipeWeekPlanSuggestJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type SuggestRecipeFromPantryOptions = {
  pantry: string[];
  recipes: aiApi.RecipeAiSummaryItem[];
  servings?: number;
  mealSlot?: string;
  preferences?: string;
  limit?: number;
};

export type SuggestRecipeFromPantryResult =
  | { ok: true; data: aiApi.RecipePantrySuggestJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeWeekPlanPayload(raw: unknown): aiApi.RecipeWeekPlanSuggestJson {
  const empty: aiApi.RecipeWeekPlanSuggestJson = {
    entries: [],
    unmet_slots: [],
    notes: '',
    suggest_new_drafts: [],
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const entries: aiApi.RecipeWeekPlanEntryJson[] = [];
  if (Array.isArray(o.entries)) {
    for (const row of o.entries) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const date = typeof r.date === 'string' ? r.date.trim() : '';
      const slot = typeof r.slot === 'string' ? r.slot.trim() : '';
      const recipeId = typeof r.recipeId === 'string' ? r.recipeId.trim() : '';
      const recipeTitle = typeof r.recipeTitle === 'string' ? r.recipeTitle.trim() : '';
      const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
      if (!date || !slot || !recipeId) continue;
      entries.push({
        date,
        slot,
        recipeId,
        recipeTitle: recipeTitle || '未命名菜谱',
        reason,
      });
      if (entries.length >= 40) break;
    }
  }
  const unmet_slots: { date: string; slot: string; hint: string }[] = [];
  if (Array.isArray(o.unmet_slots)) {
    for (const row of o.unmet_slots) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const date = typeof r.date === 'string' ? r.date.trim() : '';
      const slot = typeof r.slot === 'string' ? r.slot.trim() : '';
      const hint = typeof r.hint === 'string' ? r.hint.trim() : '';
      if (!date || !slot) continue;
      unmet_slots.push({ date, slot, hint });
      if (unmet_slots.length >= 20) break;
    }
  }
  const suggest_new_drafts: string[] = [];
  if (Array.isArray(o.suggest_new_drafts)) {
    for (const x of o.suggest_new_drafts) {
      if (typeof x !== 'string' || !x.trim()) continue;
      suggest_new_drafts.push(x.trim().slice(0, 80));
      if (suggest_new_drafts.length >= 8) break;
    }
  }
  const notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 400) : '';
  return { entries, unmet_slots, notes, suggest_new_drafts };
}

function normalizePantrySuggestPayload(raw: unknown): aiApi.RecipePantrySuggestJson {
  const empty: aiApi.RecipePantrySuggestJson = { suggestions: [], notes: '' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const suggestions: aiApi.RecipePantrySuggestionJson[] = [];
  if (Array.isArray(o.suggestions)) {
    for (const row of o.suggestions) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const recipeId = typeof r.recipeId === 'string' ? r.recipeId.trim() : '';
      if (!recipeId) continue;
      const recipeTitle = typeof r.recipeTitle === 'string' ? r.recipeTitle.trim() : '';
      const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
      const missing_ingredients: string[] = [];
      if (Array.isArray(r.missing_ingredients)) {
        for (const m of r.missing_ingredients) {
          if (typeof m !== 'string' || !m.trim()) continue;
          missing_ingredients.push(m.trim().slice(0, 40));
          if (missing_ingredients.length >= 12) break;
        }
      }
      suggestions.push({
        recipeId,
        recipeTitle: recipeTitle || '未命名菜谱',
        reason,
        missing_ingredients,
      });
      if (suggestions.length >= 12) break;
    }
  }
  const notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 400) : '';
  return { suggestions, notes };
}

export async function suggestRecipeWeekPlan(
  options: SuggestRecipeWeekPlanOptions,
): Promise<SuggestRecipeWeekPlanResult> {
  if (!options.startDate.trim() || !options.endDate.trim()) {
    return { ok: false, error: '日期范围无效', attempts: 0 };
  }
  if (!options.recipes.length) {
    return { ok: false, error: '菜谱库为空', attempts: 0 };
  }
  try {
    const raw = await aiApi.aiRecipeSuggestWeekPlan({
      start_date: options.startDate.trim(),
      end_date: options.endDate.trim(),
      recipes: options.recipes,
      existing_plan: options.existingPlan,
      preferences: options.preferences?.trim() || undefined,
      target_slots: options.targetSlots,
    });
    const allowed = new Set(options.recipes.map(r => r.id));
    const data = normalizeWeekPlanPayload(raw);
    data.entries = data.entries.filter(e => allowed.has(e.recipeId));
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function suggestRecipeFromPantry(
  options: SuggestRecipeFromPantryOptions,
): Promise<SuggestRecipeFromPantryResult> {
  const pantry = options.pantry.map(s => s.trim()).filter(Boolean);
  if (!pantry.length) return { ok: false, error: '请至少提供一种现有食材', attempts: 0 };
  if (!options.recipes.length) return { ok: false, error: '菜谱库为空', attempts: 0 };
  try {
    const raw = await aiApi.aiRecipeSuggestFromPantry({
      pantry,
      recipes: options.recipes,
      servings: options.servings,
      meal_slot: options.mealSlot,
      preferences: options.preferences?.trim() || undefined,
      limit: options.limit,
    });
    const allowed = new Set(options.recipes.map(r => r.id));
    const data = normalizePantrySuggestPayload(raw);
    data.suggestions = data.suggestions.filter(s => allowed.has(s.recipeId));
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 菜谱 P2：改写 / 做菜短评 ---

export type ScaleOrRewriteRecipeOptions = {
  title: string;
  ingredients: aiApi.RecipeIngredientDraft[];
  steps: string[];
  notes?: string;
  goal: string;
};

export type ScaleOrRewriteRecipeResult =
  | { ok: true; data: aiApi.RecipeScaleRewriteJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type RecipeCookCommentOptions = {
  recipeTitle: string;
  rating: number;
  userNote?: string;
  improvementHint?: string;
};

export type RecipeCookCommentResult =
  | { ok: true; comment: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeScaleRewritePayload(raw: unknown): aiApi.RecipeScaleRewriteJson | null {
  const draft = normalizeRecipeParseDraft(
    raw && typeof raw === 'object'
      ? {
          ...(raw as Record<string, unknown>),
          category_hint: null,
          confidence: 1,
        }
      : raw,
  );
  if (!draft) return null;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const summary =
    typeof o.summary === 'string'
      ? o.summary.trim().slice(0, 120)
      : typeof o.change_summary === 'string'
        ? o.change_summary.trim().slice(0, 120)
        : '';
  return {
    title: draft.title,
    ingredients: draft.ingredients,
    steps: draft.steps,
    notes: draft.notes,
    summary,
  };
}

export async function scaleOrRewriteRecipe(
  options: ScaleOrRewriteRecipeOptions,
): Promise<ScaleOrRewriteRecipeResult> {
  const goal = options.goal.trim();
  if (!goal) return { ok: false, error: '请填写改写目标', attempts: 0 };
  try {
    const raw = await aiApi.aiRecipeScaleOrRewrite({
      title: options.title.trim(),
      ingredients: options.ingredients,
      steps: options.steps,
      notes: options.notes?.trim() || undefined,
      goal,
    });
    const data = normalizeScaleRewritePayload(raw);
    if (!data) {
      return { ok: false, error: '未能生成有效改写结果', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function generateRecipeCookComment(
  options: RecipeCookCommentOptions,
): Promise<RecipeCookCommentResult> {
  const recipeTitle = options.recipeTitle.trim();
  if (!recipeTitle) return { ok: false, error: '菜名为空', attempts: 0 };
  if (options.rating < 1 || options.rating > 5) {
    return { ok: false, error: '请先选择 1～5 星', attempts: 0 };
  }
  try {
    const data = await aiApi.aiRecipeCookComment({
      recipe_title: recipeTitle,
      rating: options.rating,
      user_note: options.userNote?.trim() || undefined,
      improvement_hint: options.improvementHint?.trim() || undefined,
    });
    const comment = (data.comment ?? '').trim().slice(0, 200);
    if (!comment) return { ok: false, error: '未返回有效备注', attempts: 1, details: data };
    return { ok: true, comment, attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 衣橱 P0：识图填属性 / 今天穿什么 ---

const WARDROBE_ART_KEYS = new Set([
  'hoodie',
  'knit',
  'shirt',
  'pants',
  'jeans',
  'skirt',
  'coat',
  'jacket',
  'dress',
  'suit',
  'sneaker',
  'bag',
]);

export type ParseWardrobeItemFromImageOptions = {
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
  categoryNames?: string[];
  optionHints?: aiApi.WardrobeOptionHints;
};

export type ParseWardrobeItemFromImageResult =
  | { ok: true; data: aiApi.WardrobeItemParseDraftJson; rawContent: string; attempts: number }
  | {
      ok: false;
      error: string;
      attempts: number;
      notWardrobeItem?: boolean;
      httpStatus?: number;
      details?: unknown;
    };

export type SuggestWardrobeTodayOptions = {
  todayYmd?: string;
  seasonHint?: string;
  weatherHint?: string;
  occasionPref?: string;
  items: aiApi.WardrobeAiItemSummary[];
  outfits?: aiApi.WardrobeAiOutfitSummary[];
  recentlyWornItemIds?: string[];
  recentlyWornOutfitIds?: string[];
  seedItemIds?: string[];
  avoidRepeat?: boolean;
};

export type SuggestWardrobeTodayResult =
  | { ok: true; data: aiApi.WardrobeSuggestTodayJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeWardrobeItemDraft(raw: unknown): aiApi.WardrobeItemParseDraftJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  const category_hint =
    typeof o.category_hint === 'string'
      ? o.category_hint.trim().slice(0, 40) || null
      : typeof o.category === 'string'
        ? o.category.trim().slice(0, 40) || null
        : null;
  const field = (key: string) =>
    typeof o[key] === 'string' ? (o[key] as string).trim().slice(0, 40) : '';
  const color = field('color');
  const season = field('season');
  const brand = field('brand');
  const fit = field('fit');
  const warmth = field('warmth');
  const tags: string[] = [];
  if (Array.isArray(o.tags)) {
    for (const t of o.tags) {
      if (typeof t !== 'string' || !t.trim()) continue;
      tags.push(t.trim().slice(0, 20));
      if (tags.length >= 8) break;
    }
  }
  const artRaw = typeof o.art_key === 'string' ? o.art_key.trim().toLowerCase() : '';
  const art_key = WARDROBE_ART_KEYS.has(artRaw) ? artRaw : null;
  let confidence = 0;
  if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
    confidence = Math.min(1, Math.max(0, o.confidence));
  }
  if (!name && !category_hint && !color && !season && !brand && tags.length === 0) {
    return null;
  }
  return {
    name,
    category_hint,
    color,
    season,
    brand,
    fit,
    warmth,
    tags,
    art_key,
    confidence,
  };
}

function normalizeSuggestTodayPayload(
  raw: unknown,
  allowedItems: Set<string>,
  allowedOutfits: Set<string>,
): aiApi.WardrobeSuggestTodayJson {
  const empty: aiApi.WardrobeSuggestTodayJson = {
    mode: 'items',
    outfitId: null,
    outfitName: null,
    itemIds: [],
    reason: '',
    alternatives: [],
    avoid_repeat: true,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;

  const filterIds = (list: unknown, allowed: Set<string>, max = 12): string[] => {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const x of list) {
      if (typeof x !== 'string') continue;
      const id = x.trim();
      if (!id || !allowed.has(id) || out.includes(id)) continue;
      out.push(id);
      if (out.length >= max) break;
    }
    return out;
  };

  let mode = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : '';
  let outfitId =
    typeof o.outfitId === 'string'
      ? o.outfitId.trim()
      : typeof o.outfit_id === 'string'
        ? o.outfit_id.trim()
        : '';
  if (outfitId && !allowedOutfits.has(outfitId)) outfitId = '';
  let outfitName =
    typeof o.outfitName === 'string'
      ? o.outfitName.trim().slice(0, 80)
      : typeof o.outfit_name === 'string'
        ? o.outfit_name.trim().slice(0, 80)
        : '';
  let itemIds = filterIds(o.itemIds ?? o.item_ids, allowedItems);
  if (mode !== 'outfit' && mode !== 'items') {
    mode = outfitId ? 'outfit' : 'items';
  }
  if (mode === 'outfit') {
    if (!outfitId) {
      mode = 'items';
      outfitName = '';
    } else {
      itemIds = [];
    }
  } else {
    outfitId = '';
    outfitName = '';
  }

  const alternatives: aiApi.WardrobeSuggestTodayAltJson[] = [];
  if (Array.isArray(o.alternatives)) {
    for (const row of o.alternatives) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const amode = typeof r.mode === 'string' ? r.mode.trim().toLowerCase() : '';
      const aReason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 160) : '';
      let aOid =
        typeof r.outfitId === 'string'
          ? r.outfitId.trim()
          : typeof r.outfit_id === 'string'
            ? r.outfit_id.trim()
            : '';
      if (aOid && !allowedOutfits.has(aOid)) aOid = '';
      const aName =
        typeof r.outfitName === 'string'
          ? r.outfitName.trim().slice(0, 80)
          : typeof r.outfit_name === 'string'
            ? r.outfit_name.trim().slice(0, 80)
            : '';
      const aItems = filterIds(r.itemIds ?? r.item_ids, allowedItems);
      if (amode === 'outfit' && aOid) {
        alternatives.push({
          mode: 'outfit',
          outfitId: aOid,
          outfitName: aName || null,
          itemIds: [],
          reason: aReason,
        });
      } else if (aItems.length) {
        alternatives.push({
          mode: 'items',
          outfitId: null,
          outfitName: null,
          itemIds: aItems,
          reason: aReason,
        });
      }
      if (alternatives.length >= 3) break;
    }
  }

  return {
    mode,
    outfitId: outfitId || null,
    outfitName: outfitName || null,
    itemIds,
    reason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 200) : '',
    alternatives,
    avoid_repeat: typeof o.avoid_repeat === 'boolean' ? o.avoid_repeat : true,
  };
}

export async function parseWardrobeItemFromImage(
  options: ParseWardrobeItemFromImageOptions,
): Promise<ParseWardrobeItemFromImageResult> {
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) return { ok: false, error: '图片数据为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(
    rawB64,
    (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg',
  );
  if (!image_base64) return { ok: false, error: '无法解析图片数据', attempts: 0 };
  try {
    const raw = await aiApi.aiWardrobeParseItemFromImage({
      image_base64,
      image_mime_type,
      supplement_text: options.supplementText?.trim() || undefined,
      category_names: options.categoryNames,
      option_hints: options.optionHints,
    });
    const data = normalizeWardrobeItemDraft(raw);
    if (!data) {
      return {
        ok: false,
        error: '未能识别为衣物单品',
        notWardrobeItem: true,
        attempts: 1,
        details: raw,
      };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    const notWardrobeItem = /未能识别为衣物|不是衣物/.test(err.error);
    return {
      ok: false,
      error: err.error,
      attempts: 1,
      httpStatus: err.httpStatus,
      details: err.details,
      ...(notWardrobeItem ? { notWardrobeItem: true } : {}),
    };
  }
}

export async function suggestWardrobeToday(
  options: SuggestWardrobeTodayOptions,
): Promise<SuggestWardrobeTodayResult> {
  if (!options.items.length) {
    return { ok: false, error: '衣橱单品为空', attempts: 0 };
  }
  try {
    const raw = await aiApi.aiWardrobeSuggestToday({
      today_ymd: options.todayYmd?.trim() || undefined,
      season_hint: options.seasonHint?.trim() || undefined,
      weather_hint: options.weatherHint?.trim() || undefined,
      occasion_pref: options.occasionPref?.trim() || undefined,
      items: options.items,
      outfits: options.outfits,
      recently_worn_item_ids: options.recentlyWornItemIds,
      recently_worn_outfit_ids: options.recentlyWornOutfitIds,
      seed_item_ids: options.seedItemIds,
      avoid_repeat: options.avoidRepeat,
    });
    const allowedItems = new Set(options.items.map(i => i.id));
    const allowedOutfits = new Set((options.outfits ?? []).map(o => o.id));
    const data = normalizeSuggestTodayPayload(raw, allowedItems, allowedOutfits);
    if (data.mode === 'outfit' && !data.outfitId) {
      return { ok: false, error: '推荐结果无有效搭配', attempts: 1, details: raw };
    }
    if (data.mode === 'items' && data.itemIds.length === 0) {
      return { ok: false, error: '推荐结果无有效单品', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 衣橱 P1：文本速记 / 组一套 / 闲置洞察 ---

export type ParseWardrobeItemFromTextOptions = {
  text: string;
  categoryNames?: string[];
  optionHints?: aiApi.WardrobeOptionHints;
};

export type ParseWardrobeItemFromTextResult =
  | { ok: true; data: aiApi.WardrobeItemParseDraftJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type SuggestWardrobeOutfitOptions = {
  occasion?: string;
  seasonHint?: string;
  weatherHint?: string;
  seedItemIds?: string[];
  items: aiApi.WardrobeAiItemSummary[];
  outfits?: aiApi.WardrobeAiOutfitSummary[];
  preferences?: string;
};

export type SuggestWardrobeOutfitResult =
  | { ok: true; data: aiApi.WardrobeSuggestOutfitJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type AnalyzeWardrobeIdleInsightsOptions = {
  items: aiApi.WardrobeAiItemSummary[];
  wearSummary90d?: string;
  categoryNames?: string[];
  limit?: number;
};

export type AnalyzeWardrobeIdleInsightsResult =
  | { ok: true; data: aiApi.WardrobeIdleInsightsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeSuggestOutfitPayload(
  raw: unknown,
  allowedItems: Set<string>,
  allowedOutfits: Set<string>,
  seedIds: string[],
): aiApi.WardrobeSuggestOutfitJson {
  const empty: aiApi.WardrobeSuggestOutfitJson = {
    itemIds: [],
    name_hint: '',
    occasion_hint: null,
    reason: '',
    near_outfit_id: null,
    near_outfit_name: null,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const itemIds: string[] = [];
  const list = o.itemIds ?? o.item_ids;
  if (Array.isArray(list)) {
    for (const x of list) {
      if (typeof x !== 'string') continue;
      const id = x.trim();
      if (!id || !allowedItems.has(id) || itemIds.includes(id)) continue;
      itemIds.push(id);
      if (itemIds.length >= 8) break;
    }
  }
  for (const sid of seedIds) {
    if (allowedItems.has(sid) && !itemIds.includes(sid)) itemIds.unshift(sid);
  }
  let near =
    typeof o.near_outfit_id === 'string'
      ? o.near_outfit_id.trim()
      : typeof o.nearOutfitId === 'string'
        ? o.nearOutfitId.trim()
        : '';
  if (near && !allowedOutfits.has(near)) near = '';
  const nearName =
    typeof o.near_outfit_name === 'string'
      ? o.near_outfit_name.trim().slice(0, 80)
      : typeof o.nearOutfitName === 'string'
        ? o.nearOutfitName.trim().slice(0, 80)
        : '';
  return {
    itemIds: itemIds.slice(0, 8),
    name_hint:
      typeof o.name_hint === 'string'
        ? o.name_hint.trim().slice(0, 80)
        : typeof o.name === 'string'
          ? o.name.trim().slice(0, 80)
          : '',
    occasion_hint:
      typeof o.occasion_hint === 'string'
        ? o.occasion_hint.trim().slice(0, 40) || null
        : typeof o.occasion === 'string'
          ? o.occasion.trim().slice(0, 40) || null
          : null,
    reason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 200) : '',
    near_outfit_id: near || null,
    near_outfit_name: nearName || null,
  };
}

function normalizeIdleInsightsPayload(
  raw: unknown,
  allowedItems: Set<string>,
  limit: number,
): aiApi.WardrobeIdleInsightsJson {
  const empty: aiApi.WardrobeIdleInsightsJson = {
    idle_item_ids: [],
    capsule_gaps: [],
    tips: [],
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const idle_item_ids: string[] = [];
  const idleRaw = o.idle_item_ids ?? o.idleItemIds;
  if (Array.isArray(idleRaw)) {
    for (const x of idleRaw) {
      if (typeof x !== 'string') continue;
      const id = x.trim();
      if (!id || !allowedItems.has(id) || idle_item_ids.includes(id)) continue;
      idle_item_ids.push(id);
      if (idle_item_ids.length >= limit) break;
    }
  }
  const capsule_gaps: string[] = [];
  const gapsRaw = o.capsule_gaps ?? o.gaps;
  if (Array.isArray(gapsRaw)) {
    for (const x of gapsRaw) {
      if (typeof x !== 'string' || !x.trim()) continue;
      capsule_gaps.push(x.trim().slice(0, 60));
      if (capsule_gaps.length >= 8) break;
    }
  }
  const tips: string[] = [];
  if (Array.isArray(o.tips)) {
    for (const x of o.tips) {
      if (typeof x !== 'string' || !x.trim()) continue;
      tips.push(x.trim().slice(0, 80));
      if (tips.length >= 5) break;
    }
  }
  return { idle_item_ids, capsule_gaps, tips };
}

export async function parseWardrobeItemFromText(
  options: ParseWardrobeItemFromTextOptions,
): Promise<ParseWardrobeItemFromTextResult> {
  const text = options.text?.trim() ?? '';
  if (!text) return { ok: false, error: '请输入一句话描述', attempts: 0 };
  try {
    const raw = await aiApi.aiWardrobeParseItemFromText({
      text,
      category_names: options.categoryNames,
      option_hints: options.optionHints,
    });
    const data = normalizeWardrobeItemDraft(raw);
    if (!data) {
      return { ok: false, error: '未能解析出有效单品属性', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function suggestWardrobeOutfit(
  options: SuggestWardrobeOutfitOptions,
): Promise<SuggestWardrobeOutfitResult> {
  if (!options.items.length) return { ok: false, error: '衣橱单品为空', attempts: 0 };
  const seedItemIds = (options.seedItemIds ?? []).filter(Boolean).slice(0, 8);
  try {
    const raw = await aiApi.aiWardrobeSuggestOutfit({
      occasion: options.occasion?.trim() || undefined,
      season_hint: options.seasonHint?.trim() || undefined,
      weather_hint: options.weatherHint?.trim() || undefined,
      seed_item_ids: seedItemIds.length ? seedItemIds : undefined,
      items: options.items,
      outfits: options.outfits,
      preferences: options.preferences?.trim() || undefined,
    });
    const allowedItems = new Set(options.items.map(i => i.id));
    const allowedOutfits = new Set((options.outfits ?? []).map(o => o.id));
    const data = normalizeSuggestOutfitPayload(raw, allowedItems, allowedOutfits, seedItemIds);
    if (!data.itemIds.length) {
      return { ok: false, error: '推荐结果无有效单品', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function analyzeWardrobeIdleInsights(
  options: AnalyzeWardrobeIdleInsightsOptions,
): Promise<AnalyzeWardrobeIdleInsightsResult> {
  if (!options.items.length) return { ok: false, error: '衣橱单品为空', attempts: 0 };
  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  try {
    const raw = await aiApi.aiWardrobeIdleInsights({
      items: options.items,
      wear_summary_90d: options.wearSummary90d?.trim() || undefined,
      category_names: options.categoryNames,
      limit,
    });
    const allowed = new Set(options.items.map(i => i.id));
    const data = normalizeIdleInsightsPayload(raw, allowed, limit);
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 衣橱 P2：穿着短评 / 相似单品 ---

export type WardrobeWearCommentOptions = {
  subjectName: string;
  subjectKind?: 'item' | 'outfit';
  occasion?: string;
  weatherHint?: string;
  userNote?: string;
};

export type WardrobeWearCommentResult =
  | { ok: true; comment: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

export type AnalyzeWardrobeSimilarItemsOptions = {
  items: aiApi.WardrobeAiItemSummary[];
  targetItemId?: string;
  targetDescription?: string;
  imageBase64?: string;
  imageMimeType?: string;
  limit?: number;
};

export type AnalyzeWardrobeSimilarItemsResult =
  | { ok: true; data: aiApi.WardrobeSimilarItemsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeWardrobeSimilarItemsPayload(
  raw: unknown,
  allowedItems: Set<string>,
  excludeId: string,
  limit: number,
): aiApi.WardrobeSimilarItemsJson {
  const empty: aiApi.WardrobeSimilarItemsJson = { similar: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const list = o.similar ?? o.items;
  if (!Array.isArray(list)) return empty;
  const similar: aiApi.WardrobeSimilarItemJson[] = [];
  for (const row of list) {
    let itemId = '';
    let score = 0;
    let reason = '';
    if (typeof row === 'string') {
      itemId = row.trim();
    } else if (row && typeof row === 'object' && !Array.isArray(row)) {
      const r = row as Record<string, unknown>;
      itemId =
        typeof r.item_id === 'string'
          ? r.item_id.trim()
          : typeof r.itemId === 'string'
            ? r.itemId.trim()
            : typeof r.id === 'string'
              ? r.id.trim()
              : '';
      reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 80) : '';
      const sc = r.score;
      if (typeof sc === 'number' && Number.isFinite(sc)) score = Math.max(0, Math.min(1, sc));
      else if (typeof sc === 'string') {
        const n = Number(sc.trim());
        if (Number.isFinite(n)) score = Math.max(0, Math.min(1, n));
      }
    }
    if (!itemId || itemId === excludeId || !allowedItems.has(itemId)) continue;
    if (similar.some(s => s.item_id === itemId)) continue;
    similar.push({ item_id: itemId, score, reason });
    if (similar.length >= limit) break;
  }
  similar.sort((a, b) => b.score - a.score);
  return { similar };
}

export async function generateWardrobeWearComment(
  options: WardrobeWearCommentOptions,
): Promise<WardrobeWearCommentResult> {
  const subjectName = options.subjectName?.trim() ?? '';
  if (!subjectName) return { ok: false, error: '名称为空', attempts: 0 };
  try {
    const data = await aiApi.aiWardrobeWearComment({
      subject_name: subjectName,
      subject_kind: options.subjectKind,
      occasion: options.occasion?.trim() || undefined,
      weather_hint: options.weatherHint?.trim() || undefined,
      user_note: options.userNote?.trim() || undefined,
    });
    const comment = (data.comment ?? '').trim().slice(0, 200);
    if (!comment) return { ok: false, error: '未返回有效备注', attempts: 1, details: data };
    return { ok: true, comment, attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export async function analyzeWardrobeSimilarItems(
  options: AnalyzeWardrobeSimilarItemsOptions,
): Promise<AnalyzeWardrobeSimilarItemsResult> {
  if (!options.items.length) return { ok: false, error: '衣橱单品为空', attempts: 0 };
  const targetItemId = options.targetItemId?.trim() || undefined;
  const targetDescription = options.targetDescription?.trim() || undefined;
  const imageBase64 = options.imageBase64?.trim() || undefined;
  if (!targetItemId && !targetDescription && !imageBase64) {
    return { ok: false, error: '请提供目标单品、描述或参考图', attempts: 0 };
  }
  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  try {
    const raw = await aiApi.aiWardrobeSimilarItems({
      items: options.items,
      target_item_id: targetItemId,
      target_description: targetDescription,
      image_base64: imageBase64,
      image_mime_type: options.imageMimeType,
      limit,
    });
    const allowed = new Set(
      options.items.map(i => i.id).filter(id => id && id !== (targetItemId ?? '')),
    );
    const data = normalizeWardrobeSimilarItemsPayload(raw, allowed, targetItemId ?? '', limit);
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 任务 P0：一句话建待办 / 今日优先 / 拆解 ---

export type ParseTaskOneLinerOptions = {
  text: string;
  todayYmd?: string;
  categoryNames?: string[];
  tagNames?: string[];
};

export type ParseTaskOneLinerResult =
  | { ok: true; data: aiApi.TaskParseOneLinerJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskParseOneLinerPayload(raw: unknown): aiApi.TaskParseOneLinerJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : String(o.title ?? '').trim();
  if (!title) return null;
  const note =
    typeof o.note === 'string' && o.note.trim()
      ? o.note.trim()
      : null;
  const priorityRaw = typeof o.priority === 'number' ? o.priority : Number(o.priority);
  const priority = Number.isFinite(priorityRaw)
    ? Math.max(0, Math.min(4, Math.trunc(priorityRaw)))
    : 0;
  const due =
    typeof o.due_ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.due_ymd.trim())
      ? o.due_ymd.trim()
      : null;
  let schedule: aiApi.TaskAiScheduleDraft | null = null;
  if (o.schedule && typeof o.schedule === 'object' && !Array.isArray(o.schedule)) {
    const s = o.schedule as Record<string, unknown>;
    const reminder =
      typeof s.reminderOption === 'string' ? s.reminderOption.trim() : '不提前';
    const repeat = typeof s.repeatOption === 'string' ? s.repeatOption.trim() : '不重复';
    schedule = {
      mode: typeof s.mode === 'string' ? s.mode : 'date',
      allDay: typeof s.allDay === 'boolean' ? s.allDay : true,
      hasExactTime: typeof s.hasExactTime === 'boolean' ? s.hasExactTime : false,
      date: typeof s.date === 'string' ? s.date : due ? `${due}T12:00:00` : undefined,
      startTime: typeof s.startTime === 'string' ? s.startTime : undefined,
      endTime: typeof s.endTime === 'string' ? s.endTime : undefined,
      reminderOption: reminder || '不提前',
      repeatOption: repeat || '不重复',
      repeatSummary: typeof s.repeatSummary === 'string' ? s.repeatSummary : repeat || '不重复',
      weeklyDays: [],
      monthlyDays: [],
      yearlyDate: '',
    };
  }
  const tagHints: string[] = [];
  if (Array.isArray(o.tag_hints)) {
    for (const t of o.tag_hints) {
      const s = String(t ?? '').trim();
      if (s && !tagHints.includes(s)) tagHints.push(s.slice(0, 24));
      if (tagHints.length >= 8) break;
    }
  }
  const rewardRaw = o.reward_points;
  let reward_points: number | null = null;
  if (rewardRaw != null && rewardRaw !== '') {
    const n = Number(rewardRaw);
    if (Number.isFinite(n)) reward_points = Math.max(0, Math.min(9999, Math.trunc(n)));
  }
  const confRaw = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
  return {
    title: title.slice(0, 50),
    note,
    priority,
    due_ymd: due,
    schedule,
    category_hint:
      typeof o.category_hint === 'string' && o.category_hint.trim()
        ? o.category_hint.trim().slice(0, 40)
        : null,
    tag_hints: tagHints,
    reward_points,
    confidence: Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5,
  };
}

export async function parseTaskOneLiner(
  options: ParseTaskOneLinerOptions,
): Promise<ParseTaskOneLinerResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '请输入一句话待办', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskParseOneLiner({
      text,
      today_ymd: options.todayYmd?.trim() || undefined,
      category_names: options.categoryNames,
      tag_names: options.tagNames,
    });
    const data = normalizeTaskParseOneLinerPayload(raw);
    if (!data) return { ok: false, error: '未能解析出有效待办', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type SuggestTaskTodayOptions = {
  todayYmd?: string;
  dayBoundary?: string;
  preference?: string;
  tasks: aiApi.TaskAiTaskSummary[];
  frogCandidates?: aiApi.TaskAiFrogCandidateSummary[];
  habits?: aiApi.TaskAiHabitSummary[];
};

export type SuggestTaskTodayResult =
  | { ok: true; data: aiApi.TaskSuggestTodayJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskSuggestTodayPayload(
  raw: unknown,
  allowedTasks: Set<string>,
  allowedHabits: Set<string>,
  allowedFrogs: Set<string>,
): aiApi.TaskSuggestTodayJson {
  const empty: aiApi.TaskSuggestTodayJson = {
    primary_task_ids: [],
    frog_task_id: null,
    habit_ids: [],
    reason: '',
    tips: [],
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const primary: string[] = [];
  const list = o.primary_task_ids ?? o.primaryTaskIds;
  if (Array.isArray(list)) {
    for (const x of list) {
      const id = String(x ?? '').trim();
      if (!id || !allowedTasks.has(id) || primary.includes(id)) continue;
      primary.push(id);
      if (primary.length >= 3) break;
    }
  }
  let frog = String(o.frog_task_id ?? o.frogTaskId ?? '').trim();
  if (frog && !allowedFrogs.has(frog) && !allowedTasks.has(frog)) frog = '';
  const habitIds: string[] = [];
  const hlist = o.habit_ids ?? o.habitIds;
  if (Array.isArray(hlist)) {
    for (const x of hlist) {
      const id = String(x ?? '').trim();
      if (!id || !allowedHabits.has(id) || habitIds.includes(id)) continue;
      habitIds.push(id);
      if (habitIds.length >= 5) break;
    }
  }
  const tips: string[] = [];
  if (Array.isArray(o.tips)) {
    for (const t of o.tips) {
      const s = String(t ?? '').trim();
      if (s) tips.push(s.slice(0, 60));
      if (tips.length >= 4) break;
    }
  }
  return {
    primary_task_ids: primary,
    frog_task_id: frog || null,
    habit_ids: habitIds,
    reason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 200) : '',
    tips,
  };
}

export async function suggestTaskToday(
  options: SuggestTaskTodayOptions,
): Promise<SuggestTaskTodayResult> {
  if (!options.tasks.length && !(options.frogCandidates?.length)) {
    return { ok: false, error: '暂无任务可推荐', attempts: 0 };
  }
  try {
    const raw = await aiApi.aiTaskSuggestToday({
      today_ymd: options.todayYmd?.trim() || undefined,
      day_boundary: options.dayBoundary?.trim() || undefined,
      preference: options.preference?.trim() || undefined,
      tasks: options.tasks,
      frog_candidates: options.frogCandidates,
      habits: options.habits,
    });
    const allowedTasks = new Set(options.tasks.map(t => t.id));
    const allowedHabits = new Set((options.habits ?? []).map(h => h.id));
    const allowedFrogs = new Set([
      ...allowedTasks,
      ...(options.frogCandidates ?? []).map(f => f.id),
    ]);
    const data = normalizeTaskSuggestTodayPayload(raw, allowedTasks, allowedHabits, allowedFrogs);
    if (!data.primary_task_ids.length && !data.frog_task_id && !data.habit_ids.length) {
      return { ok: false, error: '推荐结果无有效任务', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type BreakdownTaskOptions = {
  title: string;
  note?: string;
  dueYmd?: string;
  projectName?: string;
  existingSubtaskTitles?: string[];
  mode?: 'subtasks' | 'acceptance' | 'both' | string;
  todayYmd?: string;
};

export type BreakdownTaskResult =
  | { ok: true; data: aiApi.TaskBreakdownJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskBreakdownPayload(raw: unknown): aiApi.TaskBreakdownJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  let mode = String(o.mode ?? 'both').trim().toLowerCase();
  if (mode !== 'subtasks' && mode !== 'acceptance' && mode !== 'both') mode = 'both';
  const subtasks: aiApi.TaskBreakdownSubtaskJson[] = [];
  if (Array.isArray(o.subtasks)) {
    for (const row of o.subtasks) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = String(r.title ?? r.name ?? '').trim().slice(0, 50);
      if (!title) continue;
      const item: aiApi.TaskBreakdownSubtaskJson = { title };
      if (r.priority != null && Number.isFinite(Number(r.priority))) {
        item.priority = Math.max(0, Math.min(4, Math.trunc(Number(r.priority))));
      }
      if (r.due_ymd_offset != null && Number.isFinite(Number(r.due_ymd_offset))) {
        item.due_ymd_offset = Math.trunc(Number(r.due_ymd_offset));
      }
      subtasks.push(item);
      if (subtasks.length >= 12) break;
    }
  }
  const acceptance: { text: string }[] = [];
  const rawAcc = o.acceptance_items ?? o.acceptanceItems;
  if (Array.isArray(rawAcc)) {
    for (const row of rawAcc) {
      let text = '';
      if (row && typeof row === 'object') {
        text = String((row as Record<string, unknown>).text ?? '').trim();
      } else {
        text = String(row ?? '').trim();
      }
      if (!text) continue;
      acceptance.push({ text: text.slice(0, 80) });
      if (acceptance.length >= 12) break;
    }
  }
  if (mode === 'subtasks') acceptance.length = 0;
  if (mode === 'acceptance') subtasks.length = 0;
  if (!subtasks.length && !acceptance.length) return null;
  return {
    mode,
    subtasks,
    acceptance_items: acceptance,
    reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim().slice(0, 200) : null,
  };
}

export async function breakdownTask(
  options: BreakdownTaskOptions,
): Promise<BreakdownTaskResult> {
  const title = options.title.trim();
  if (!title) return { ok: false, error: '任务标题为空', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskBreakdown({
      title,
      note: options.note?.trim() || undefined,
      due_ymd: options.dueYmd?.trim() || undefined,
      project_name: options.projectName?.trim() || undefined,
      existing_subtask_titles: options.existingSubtaskTitles,
      mode: options.mode || 'both',
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const data = normalizeTaskBreakdownPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效拆解', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 任务 P1 ---

export type ParseTaskScheduleOptions = {
  text: string;
  todayYmd?: string;
  dueYmd?: string;
  schedule?: aiApi.TaskAiScheduleDraft | Record<string, unknown> | null;
};

export type ParseTaskScheduleResult =
  | { ok: true; data: aiApi.TaskParseScheduleJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskParseSchedulePayload(raw: unknown): aiApi.TaskParseScheduleJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.ok === false) return null;
  const due =
    typeof o.due_ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.due_ymd.trim())
      ? o.due_ymd.trim()
      : null;
  let schedule: aiApi.TaskAiScheduleDraft | null = null;
  if (o.schedule && typeof o.schedule === 'object' && !Array.isArray(o.schedule)) {
    const s = o.schedule as Record<string, unknown>;
    const mode = String(s.mode ?? 'date').toLowerCase() === 'time' ? 'time' : 'date';
    const reminder = String(s.reminderOption ?? s.reminder_option ?? '不提前').trim() || '不提前';
    const repeat = String(s.repeatOption ?? s.repeat_option ?? '不重复').trim() || '不重复';
    schedule = {
      mode,
      allDay: typeof s.allDay === 'boolean' ? s.allDay : true,
      hasExactTime: typeof s.hasExactTime === 'boolean' ? s.hasExactTime : false,
      date: typeof s.date === 'string' ? s.date : undefined,
      startTime: typeof s.startTime === 'string' ? s.startTime : undefined,
      endTime: typeof s.endTime === 'string' ? s.endTime : undefined,
      reminderOption: reminder,
      repeatOption: repeat,
      repeatSummary: typeof s.repeatSummary === 'string' ? s.repeatSummary : repeat,
      weeklyDays: Array.isArray(s.weeklyDays)
        ? s.weeklyDays.map(n => Number(n)).filter(n => Number.isFinite(n))
        : [],
      monthlyDays: Array.isArray(s.monthlyDays)
        ? s.monthlyDays.map(n => Number(n)).filter(n => Number.isFinite(n))
        : [],
      yearlyDate: typeof s.yearlyDate === 'string' ? s.yearlyDate : undefined,
    };
  }
  if (!schedule && !due) return null;
  const conf = Number(o.confidence);
  return {
    ok: true,
    due_ymd: due,
    schedule,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  };
}

export async function parseTaskSchedule(
  options: ParseTaskScheduleOptions,
): Promise<ParseTaskScheduleResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '请输入一句话日程', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskParseSchedule({
      text,
      today_ymd: options.todayYmd?.trim() || undefined,
      due_ymd: options.dueYmd?.trim() || undefined,
      schedule: options.schedule ?? undefined,
    });
    const data = normalizeTaskParseSchedulePayload(raw);
    if (!data) return { ok: false, error: '无法解析该日程描述', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseTaskFromImageOptions = {
  imageDataUri: string;
  supplementText?: string;
  todayYmd?: string;
};

export type ParseTaskFromImageResult =
  | { ok: true; data: aiApi.TaskParseFromImageJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskParseFromImagePayload(raw: unknown): aiApi.TaskParseFromImageJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = o.items ?? o.tasks;
  if (!Array.isArray(list)) return null;
  const items: aiApi.TaskParseFromImageItemJson[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') {
      const title = String(row ?? '').trim().slice(0, 50);
      if (!title) continue;
      items.push({ title, priority: 0, due_ymd: null, note: null });
    } else {
      const r = row as Record<string, unknown>;
      const title = String(r.title ?? r.name ?? '').trim().slice(0, 50);
      if (!title) continue;
      const dueRaw = String(r.due_ymd ?? r.due_date ?? '').trim();
      const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
      const pri = Number(r.priority);
      items.push({
        title,
        priority: Number.isFinite(pri) ? Math.max(0, Math.min(4, Math.trunc(pri))) : 0,
        due_ymd: due,
        note:
          typeof r.note === 'string' && r.note.trim()
            ? r.note.trim().slice(0, 400)
            : null,
      });
    }
    if (items.length >= 20) break;
  }
  if (!items.length) return null;
  return { items };
}

export async function parseTaskFromImage(
  options: ParseTaskFromImageOptions,
): Promise<ParseTaskFromImageResult> {
  const uri = options.imageDataUri.trim();
  if (!uri) return { ok: false, error: '图片为空', attempts: 0 };
  const { image_base64, image_mime_type } = aiApi.splitImageBase64AndMime(uri);
  if (!image_base64) return { ok: false, error: '无法解析图片数据', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskParseFromImage({
      image_base64,
      image_mime_type,
      supplement_text: options.supplementText?.trim() || undefined,
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const data = normalizeTaskParseFromImagePayload(raw);
    if (!data) return { ok: false, error: '未能从图中识别出待办', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseTaskHabitOptions = {
  text: string;
  todayYmd?: string;
};

export type ParseTaskHabitResult =
  | { ok: true; data: aiApi.TaskParseHabitJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskParseHabitPayload(raw: unknown): aiApi.TaskParseHabitJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? o.title ?? '').trim().slice(0, 24);
  if (!name) return null;
  let kind = String(o.habitKind ?? o.habit_kind ?? 'build').trim().toLowerCase();
  if (kind !== 'build' && kind !== 'break' && kind !== 'task') kind = 'build';
  let dailyGoal: number | null = null;
  if (o.daily_goal != null && o.daily_goal !== '') {
    const g = Number(o.daily_goal);
    if (Number.isFinite(g)) dailyGoal = Math.max(1, Math.min(99, Math.trunc(g)));
  } else if (kind === 'build' || kind === 'break') {
    dailyGoal = 1;
  }
  let reminder: aiApi.TaskParseHabitReminderJson | null = null;
  if (o.reminder && typeof o.reminder === 'object' && !Array.isArray(o.reminder)) {
    const rem = o.reminder as Record<string, unknown>;
    if (rem.enabled === false) {
      reminder = { enabled: false };
    } else if (rem.enabled === true) {
      const hour = Number(rem.hour ?? 8);
      const minute = Number(rem.minute ?? 0);
      reminder = {
        enabled: true,
        hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.trunc(hour))) : 8,
        minute: Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.trunc(minute))) : 0,
      };
    }
  }
  let reward: number | null = null;
  if (o.reward_points != null && o.reward_points !== '') {
    const rp = Number(o.reward_points);
    if (Number.isFinite(rp)) reward = Math.max(-9999, Math.min(9999, Math.trunc(rp)));
  }
  return {
    name,
    habitKind: kind,
    daily_goal: dailyGoal,
    reminder,
    reward_points: reward,
    rationale_zh:
      typeof o.rationale_zh === 'string' && o.rationale_zh.trim()
        ? o.rationale_zh.trim().slice(0, 120)
        : null,
  };
}

export async function parseTaskHabit(
  options: ParseTaskHabitOptions,
): Promise<ParseTaskHabitResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '请输入一句话习惯', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskParseHabit({
      text,
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const data = normalizeTaskParseHabitPayload(raw);
    if (!data) return { ok: false, error: '未能解析出习惯名称', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type TaskOverviewInsightsOptions = {
  insightCounts?: Record<string, number | string | null>;
  completionCounts7d?: number;
  completionCounts14d?: number;
  openTasks?: aiApi.TaskAiTaskSummary[];
  reopenCount?: number;
  todayYmd?: string;
};

export type TaskOverviewInsightsResult =
  | { ok: true; data: aiApi.TaskOverviewInsightsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskOverviewInsightsPayload(
  raw: unknown,
  allowedIds: Set<string>,
): aiApi.TaskOverviewInsightsJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const insights: aiApi.TaskOverviewInsightItemJson[] = [];
  if (Array.isArray(o.insights)) {
    for (const row of o.insights) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = String(r.title ?? '').trim().slice(0, 40);
      const body = String(r.body ?? r.text ?? '').trim().slice(0, 200);
      if (!title || !body) continue;
      insights.push({ title, body });
      if (insights.length >= 3) break;
    }
  }
  const suggestion = typeof o.suggestion === 'string' ? o.suggestion.trim().slice(0, 120) : '';
  const focus: string[] = [];
  const rawFocus = o.focus_task_ids ?? o.focusTaskIds;
  if (Array.isArray(rawFocus)) {
    for (const x of rawFocus) {
      const id = String(x ?? '').trim();
      if (!id || !allowedIds.has(id) || focus.includes(id)) continue;
      focus.push(id);
      if (focus.length >= 5) break;
    }
  }
  if (!insights.length && !suggestion && !focus.length) return null;
  return { insights, suggestion, focus_task_ids: focus };
}

export async function analyzeTaskOverviewInsights(
  options: TaskOverviewInsightsOptions,
): Promise<TaskOverviewInsightsResult> {
  try {
    const openTasks = options.openTasks ?? [];
    const raw = await aiApi.aiTaskOverviewInsights({
      insight_counts: options.insightCounts,
      completion_counts_7d: options.completionCounts7d,
      completion_counts_14d: options.completionCounts14d,
      open_tasks: openTasks,
      reopen_count: options.reopenCount,
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const allowed = new Set(openTasks.map(t => t.id));
    const data = normalizeTaskOverviewInsightsPayload(raw, allowed);
    if (!data) return { ok: false, error: '未能生成有效洞察', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type PlanTaskProjectOptions = {
  projectName: string;
  description?: string;
  dueYmd?: string;
  existingTopTitles?: string[];
  todayYmd?: string;
};

export type PlanTaskProjectResult =
  | { ok: true; data: aiApi.TaskPlanProjectJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskPlanProjectPayload(raw: unknown): aiApi.TaskPlanProjectJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = o.milestones ?? o.phases;
  if (!Array.isArray(list)) return null;
  const milestones: aiApi.TaskPlanProjectMilestoneJson[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = String(r.title ?? r.name ?? '').trim().slice(0, 50);
    if (!title) continue;
    const children: string[] = [];
    const rawCh = r.children_titles ?? r.children ?? r.subtasks;
    if (Array.isArray(rawCh)) {
      for (const c of rawCh) {
        let ct = '';
        if (c && typeof c === 'object') {
          ct = String((c as Record<string, unknown>).title ?? '').trim();
        } else {
          ct = String(c ?? '').trim();
        }
        if (ct && !children.includes(ct)) children.push(ct.slice(0, 50));
        if (children.length >= 8) break;
      }
    }
    const item: aiApi.TaskPlanProjectMilestoneJson = { title, children_titles: children };
    if (r.priority != null && Number.isFinite(Number(r.priority))) {
      item.priority = Math.max(0, Math.min(4, Math.trunc(Number(r.priority))));
    }
    milestones.push(item);
    if (milestones.length >= 8) break;
  }
  if (!milestones.length) return null;
  return { milestones };
}

export async function planTaskProject(
  options: PlanTaskProjectOptions,
): Promise<PlanTaskProjectResult> {
  const projectName = options.projectName.trim();
  if (!projectName) return { ok: false, error: '项目名为空', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskPlanProject({
      project_name: projectName,
      description: options.description?.trim() || undefined,
      due_ymd: options.dueYmd?.trim() || undefined,
      existing_top_titles: options.existingTopTitles,
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const data = normalizeTaskPlanProjectPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效里程碑', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 任务 P2 ---

export type AnalyzeTaskCommentOptions = {
  title: string;
  note?: string;
  status?: string;
  subtaskDoneRatio?: number;
  overdueDays?: number;
  todayYmd?: string;
};

export type AnalyzeTaskCommentResult =
  | { ok: true; data: aiApi.TaskCommentJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskCommentPayload(raw: unknown): aiApi.TaskCommentJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const comment = String(o.comment ?? o.suggestion ?? o.text ?? '')
    .trim()
    .replace(/^(AI|短评|点评|建议|下一步)[：:\s]*/i, '')
    .slice(0, 160);
  if (!comment) return null;
  return { comment };
}

export async function analyzeTaskComment(
  options: AnalyzeTaskCommentOptions,
): Promise<AnalyzeTaskCommentResult> {
  const title = options.title.trim();
  if (!title) return { ok: false, error: '标题为空', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskComment({
      title,
      note: options.note?.trim() || undefined,
      status: options.status?.trim() || undefined,
      subtask_done_ratio:
        typeof options.subtaskDoneRatio === 'number' && Number.isFinite(options.subtaskDoneRatio)
          ? Math.max(0, Math.min(1, options.subtaskDoneRatio))
          : undefined,
      overdue_days:
        typeof options.overdueDays === 'number' && Number.isFinite(options.overdueDays)
          ? Math.max(0, Math.trunc(options.overdueDays))
          : undefined,
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const data = normalizeTaskCommentPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效短评', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeTaskHabitNudgeOptions = {
  habits: aiApi.TaskAiHabitSummary[];
  boundTaskIds?: string[];
  todayYmd?: string;
};

export type AnalyzeTaskHabitNudgeResult =
  | { ok: true; data: aiApi.TaskHabitNudgeJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeTaskHabitNudgePayload(
  raw: unknown,
  allowed: Set<string>,
): aiApi.TaskHabitNudgeJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tips: string[] = [];
  const rawTips = o.tips ?? o.suggestions;
  if (Array.isArray(rawTips)) {
    for (const t of rawTips) {
      const s = String(t ?? '').trim().slice(0, 80);
      if (s && !tips.includes(s)) tips.push(s);
      if (tips.length >= 4) break;
    }
  }
  const habitIds: string[] = [];
  const rawIds = o.habit_ids ?? o.habits;
  if (Array.isArray(rawIds)) {
    for (const x of rawIds) {
      let id = '';
      if (x && typeof x === 'object') id = String((x as Record<string, unknown>).id ?? '').trim();
      else id = String(x ?? '').trim();
      if (id && allowed.has(id) && !habitIds.includes(id)) habitIds.push(id);
      if (habitIds.length >= 5) break;
    }
  }
  if (!tips.length && !habitIds.length) return null;
  return { tips, habit_ids: habitIds };
}

export async function analyzeTaskHabitNudge(
  options: AnalyzeTaskHabitNudgeOptions,
): Promise<AnalyzeTaskHabitNudgeResult> {
  const habits = options.habits.filter(h => h.id?.trim() && h.name?.trim());
  if (!habits.length) return { ok: false, error: '习惯摘要为空', attempts: 0 };
  try {
    const raw = await aiApi.aiTaskHabitNudge({
      today_ymd: options.todayYmd?.trim() || undefined,
      habits,
      bound_task_ids: options.boundTaskIds,
    });
    const allowed = new Set(habits.map(h => h.id));
    const data = normalizeTaskHabitNudgePayload(raw, allowed);
    if (!data) return { ok: false, error: '未能生成补打建议', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseTaskFilterOptions = {
  text: string;
  todayYmd?: string;
  tagNames?: string[];
};

export type ParseTaskFilterResult =
  | { ok: true; data: aiApi.TaskParseFilterJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const TASK_DATE_PRESETS = new Set(['today', 'tomorrow', 'week', 'month', 'year']);
const TASK_LONG_TERMS = new Set(['all', 'yes', 'no']);
const TASK_ENTITY_SCOPES = new Set(['all', 'project', 'task']);

function normalizeTaskParseFilterPayload(
  raw: unknown,
  allowedTagNames: Set<string>,
): aiApi.TaskParseFilterJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.ok === false) return null;
  const search = String(o.search ?? o.query ?? '').trim().slice(0, 60);
  const dpRaw = String(o.date_preset ?? o.datePreset ?? '')
    .trim()
    .toLowerCase();
  const date_preset = TASK_DATE_PRESETS.has(dpRaw)
    ? (dpRaw as aiApi.TaskParseFilterJson['date_preset'])
    : null;
  const priorities: number[] = [];
  const rawP = o.priorities ?? o.priority;
  if (Array.isArray(rawP)) {
    for (const x of rawP) {
      const n = Math.trunc(Number(x));
      if (n >= 1 && n <= 4 && !priorities.includes(n)) priorities.push(n);
    }
  } else if (rawP != null && rawP !== '') {
    const n = Math.trunc(Number(rawP));
    if (n >= 1 && n <= 4) priorities.push(n);
  }
  const tag_hints: string[] = [];
  const rawTags = o.tag_hints ?? o.tags;
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      let name = String(t ?? '').trim().slice(0, 24);
      if (!name) continue;
      if (allowedTagNames.size > 0 && !allowedTagNames.has(name)) {
        const hit = [...allowedTagNames].find(a => a.toLowerCase() === name.toLowerCase());
        if (!hit) continue;
        name = hit;
      }
      if (!tag_hints.includes(name)) tag_hints.push(name);
      if (tag_hints.length >= 8) break;
    }
  }
  const ltRaw = String(o.long_term ?? o.longTerm ?? 'all')
    .trim()
    .toLowerCase();
  const long_term = TASK_LONG_TERMS.has(ltRaw) ? ltRaw : 'all';
  const esRaw = String(o.entity_scope ?? o.entityScope ?? 'all')
    .trim()
    .toLowerCase();
  const entity_scope = TASK_ENTITY_SCOPES.has(esRaw) ? esRaw : 'all';
  const conf = Number(o.confidence);
  const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;
  if (
    !search &&
    !date_preset &&
    !priorities.length &&
    !tag_hints.length &&
    long_term === 'all' &&
    entity_scope === 'all'
  ) {
    return null;
  }
  return {
    ok: true,
    search,
    date_preset,
    priorities,
    tag_hints,
    long_term,
    entity_scope,
    confidence,
  };
}

export async function parseTaskFilter(
  options: ParseTaskFilterOptions,
): Promise<ParseTaskFilterResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '请输入筛选描述', attempts: 0 };
  try {
    const tagNames = (options.tagNames ?? []).map(n => n.trim()).filter(Boolean);
    const raw = await aiApi.aiTaskParseFilter({
      text,
      today_ymd: options.todayYmd?.trim() || undefined,
      tag_names: tagNames.length ? tagNames : undefined,
    });
    const data = normalizeTaskParseFilterPayload(raw, new Set(tagNames));
    if (!data) return { ok: false, error: '无法映射到现有筛选，请手选', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 我的页 P0 ---

export type DraftProfilePersonaOptions = {
  text?: string;
  currentPersona?: string;
  mode?: aiApi.ProfilePersonaDraftMode;
  gender?: string;
  lifestyle?: string;
  goal?: string;
  dietarySummary?: string;
};

export type DraftProfilePersonaResult =
  | { ok: true; data: aiApi.ProfilePersonaDraftJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeProfilePersonaDraftPayload(raw: unknown): aiApi.ProfilePersonaDraftJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const portrait = String(o.persona_portrait ?? o.persona ?? o.text ?? '')
    .trim()
    .slice(0, 500);
  if (!portrait) return null;
  const hints: string[] = [];
  const rawHints = o.keyword_hints ?? o.keywords;
  if (Array.isArray(rawHints)) {
    for (const x of rawHints) {
      const s = String(x ?? '').trim().slice(0, 12);
      if (s && !hints.includes(s)) hints.push(s);
      if (hints.length >= 8) break;
    }
  }
  let confidence = 0.5;
  if (o.confidence != null && Number.isFinite(Number(o.confidence))) {
    confidence = Math.max(0, Math.min(1, Number(o.confidence)));
  }
  return { persona_portrait: portrait, keyword_hints: hints, confidence };
}

export async function draftProfilePersona(
  options: DraftProfilePersonaOptions,
): Promise<DraftProfilePersonaResult> {
  const mode = options.mode ?? 'write';
  const text = options.text?.trim() ?? '';
  const current = options.currentPersona?.trim() ?? '';
  if (mode === 'write' && !text && !current) {
    return { ok: false, error: '请先写一句线索或保留现有画像', attempts: 0 };
  }
  if ((mode === 'polish' || mode === 'shorten') && !text && !current) {
    return { ok: false, error: '润色/缩短需要现有画像', attempts: 0 };
  }
  try {
    const raw = await aiApi.aiProfilePersonaDraft({
      text: text || undefined,
      current_persona: current || undefined,
      mode,
      gender: options.gender?.trim() || undefined,
      lifestyle: options.lifestyle?.trim() || undefined,
      goal: options.goal?.trim() || undefined,
      dietary_summary: options.dietarySummary?.trim() || undefined,
    });
    const data = normalizeProfilePersonaDraftPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效画像', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeProfileWeekRhythmInsightsOptions = {
  week?: Record<string, number | string | boolean | null>;
  roadFocusLine?: string;
  wishGapLine?: string;
  personaOneLiner?: string;
  todayYmd?: string;
};

export type AnalyzeProfileWeekRhythmInsightsResult =
  | { ok: true; data: aiApi.ProfileWeekRhythmInsightsJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const PROFILE_OPEN_HINTS = new Set(['tasks', 'review', 'life-road', 'wish-board']);

function normalizeProfileWeekRhythmInsightsPayload(
  raw: unknown,
): aiApi.ProfileWeekRhythmInsightsJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const insights: aiApi.ProfileWeekRhythmInsightItemJson[] = [];
  if (Array.isArray(o.insights)) {
    for (const row of o.insights) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = String(r.title ?? '').trim().slice(0, 40);
      const body = String(r.body ?? r.text ?? '').trim().slice(0, 200);
      if (!title || !body) continue;
      insights.push({ title, body });
      if (insights.length >= 3) break;
    }
  }
  const suggestion = typeof o.suggestion === 'string' ? o.suggestion.trim().slice(0, 120) : '';
  const openRaw = String(o.open_hint ?? o.open ?? '')
    .trim()
    .toLowerCase();
  const open_hint = PROFILE_OPEN_HINTS.has(openRaw)
    ? (openRaw as aiApi.ProfileWeekRhythmOpenHint)
    : null;
  if (!insights.length && !suggestion) return null;
  return { insights, suggestion, open_hint };
}

export async function analyzeProfileWeekRhythmInsights(
  options: AnalyzeProfileWeekRhythmInsightsOptions,
): Promise<AnalyzeProfileWeekRhythmInsightsResult> {
  try {
    const raw = await aiApi.aiProfileWeekRhythmInsights({
      week: options.week,
      road_focus_line: options.roadFocusLine?.trim() || undefined,
      wish_gap_line: options.wishGapLine?.trim() || undefined,
      persona_one_liner: options.personaOneLiner?.trim() || undefined,
      today_ymd: options.todayYmd?.trim() || undefined,
    });
    const data = normalizeProfileWeekRhythmInsightsPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效洞察', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type PlanLifeRoadFromDirectionOptions = {
  body: string;
  yearTheme?: string;
  calendarYear?: number;
  existingNodeTitles?: string[];
  preference?: string;
};

export type PlanLifeRoadFromDirectionResult =
  | { ok: true; data: aiApi.LifeRoadPlanFromDirectionJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeLifeRoadPlanPayload(raw: unknown): aiApi.LifeRoadPlanFromDirectionJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const year_theme =
    typeof o.year_theme === 'string' ? o.year_theme.trim().slice(0, 40) || null : null;
  const list = o.nodes;
  if (!Array.isArray(list)) return null;
  const nodes: aiApi.LifeRoadPlanNodeJson[] = [];
  for (let idx = 0; idx < list.length; idx++) {
    const row = list[idx];
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const kind = String(r.kind ?? '').trim().toLowerCase();
    if (kind !== 'year' && kind !== 'quarter' && kind !== 'month') continue;
    const title = String(r.title ?? r.name ?? '').trim().slice(0, 40);
    if (!title) continue;
    const noteRaw = r.note == null ? null : String(r.note).trim().slice(0, 200);
    const note = noteRaw || null;
    const acceptance: aiApi.LifeRoadPlanAcceptanceItemJson[] = [];
    const rawAcc = r.acceptance_items ?? r.acceptance;
    if (Array.isArray(rawAcc)) {
      for (const a of rawAcc) {
        let text = '';
        if (a && typeof a === 'object') {
          text = String((a as Record<string, unknown>).text ?? '').trim();
        } else {
          text = String(a ?? '').trim();
        }
        text = text.slice(0, 80);
        if (text && !acceptance.some(x => x.text === text)) acceptance.push({ text });
        if (acceptance.length >= 20) break;
      }
    }
    let quarter: number | null =
      r.quarter != null && Number.isFinite(Number(r.quarter)) ? Math.trunc(Number(r.quarter)) : null;
    let month: number | null =
      r.month != null && Number.isFinite(Number(r.month)) ? Math.trunc(Number(r.month)) : null;
    if (kind === 'year') {
      quarter = null;
      month = null;
    } else if (kind === 'quarter') {
      if (quarter == null || quarter < 1 || quarter > 4) continue;
      month = null;
    } else {
      if (month == null || month < 1 || month > 12) continue;
      quarter = Math.floor((month - 1) / 3) + 1;
    }
    let parent_hint: number | null = null;
    if (r.parent_hint != null && Number.isFinite(Number(r.parent_hint))) {
      const ph = Math.trunc(Number(r.parent_hint));
      if (ph >= 0 && ph < idx) parent_hint = ph;
    }
    const calendar_year =
      r.calendar_year != null && Number.isFinite(Number(r.calendar_year))
        ? Math.trunc(Number(r.calendar_year))
        : undefined;
    nodes.push({
      kind,
      title,
      note,
      quarter,
      month,
      calendar_year,
      parent_hint,
      acceptance_items: acceptance,
    });
    if (nodes.length >= 16) break;
  }
  if (!nodes.length) return null;
  return { year_theme, nodes };
}

export async function planLifeRoadFromDirection(
  options: PlanLifeRoadFromDirectionOptions,
): Promise<PlanLifeRoadFromDirectionResult> {
  const body = options.body.trim();
  if (!body) return { ok: false, error: '请先写下总方向', attempts: 0 };
  try {
    const raw = await aiApi.aiLifeRoadPlanFromDirection({
      body,
      year_theme: options.yearTheme?.trim() || undefined,
      calendar_year: options.calendarYear,
      existing_node_titles: options.existingNodeTitles,
      preference: options.preference?.trim() || undefined,
    });
    const data = normalizeLifeRoadPlanPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效道路草稿', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 我的页 P1 ---

export type DraftLifeRoadAcceptanceOptions = {
  title: string;
  note?: string;
  kind?: string;
  existingAcceptance?: string[];
  directionBody?: string;
};

export type DraftLifeRoadAcceptanceResult =
  | { ok: true; data: aiApi.LifeRoadAcceptanceDraftJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeLifeRoadAcceptanceDraftPayload(
  raw: unknown,
): aiApi.LifeRoadAcceptanceDraftJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const acceptance: aiApi.LifeRoadPlanAcceptanceItemJson[] = [];
  const rawAcc = o.acceptance_items ?? o.acceptance;
  if (Array.isArray(rawAcc)) {
    for (const a of rawAcc) {
      let text = '';
      if (a && typeof a === 'object') {
        text = String((a as Record<string, unknown>).text ?? '').trim();
      } else {
        text = String(a ?? '').trim();
      }
      text = text.slice(0, 80);
      if (text && !acceptance.some((x) => x.text === text)) acceptance.push({ text });
      if (acceptance.length >= 20) break;
    }
  }
  if (!acceptance.length) return null;
  return { acceptance_items: acceptance };
}

export async function draftLifeRoadAcceptance(
  options: DraftLifeRoadAcceptanceOptions,
): Promise<DraftLifeRoadAcceptanceResult> {
  const title = options.title.trim();
  if (!title) return { ok: false, error: '请先填写节点标题', attempts: 0 };
  try {
    const raw = await aiApi.aiLifeRoadAcceptanceDraft({
      title,
      note: options.note?.trim() || undefined,
      kind: options.kind?.trim() || undefined,
      existing_acceptance: options.existingAcceptance,
      direction_body: options.directionBody?.trim() || undefined,
    });
    const data = normalizeLifeRoadAcceptanceDraftPayload(raw);
    if (!data) return { ok: false, error: '未能生成有效验收项', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseLifeRoadNodeUpdateOptions = {
  text: string;
  node?: Record<string, unknown>;
};

export type ParseLifeRoadNodeUpdateResult =
  | { ok: true; data: aiApi.LifeRoadNodeUpdatePatchJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const LIFE_ROAD_STATUSES = new Set(['on_track', 'paused', 'arrived', 'dropped']);

function normalizeLifeRoadNodeUpdatePayload(
  raw: unknown,
): aiApi.LifeRoadNodeUpdatePatchJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: aiApi.LifeRoadNodeUpdatePatchJson = {};
  const statusRaw = String(o.status ?? '')
    .trim()
    .toLowerCase();
  if (LIFE_ROAD_STATUSES.has(statusRaw)) out.status = statusRaw;
  if ('title' in o && o.title != null) {
    const title = String(o.title).trim().slice(0, 40);
    if (title) out.title = title;
  }
  if ('note' in o) {
    if (o.note == null) out.note = null;
    else {
      const note = String(o.note).trim().slice(0, 200);
      out.note = note || null;
    }
  }
  if ('acceptance_items' in o || 'acceptance' in o) {
    const acceptance: aiApi.LifeRoadPlanAcceptanceItemJson[] = [];
    const rawAcc = o.acceptance_items ?? o.acceptance;
    if (Array.isArray(rawAcc)) {
      for (const a of rawAcc) {
        let text = '';
        if (a && typeof a === 'object') {
          text = String((a as Record<string, unknown>).text ?? '').trim();
        } else {
          text = String(a ?? '').trim();
        }
        text = text.slice(0, 80);
        if (text && !acceptance.some((x) => x.text === text)) acceptance.push({ text });
        if (acceptance.length >= 20) break;
      }
    }
    if (acceptance.length) out.acceptance_items = acceptance;
  }
  if (!Object.keys(out).length) return null;
  return out;
}

export async function parseLifeRoadNodeUpdate(
  options: ParseLifeRoadNodeUpdateOptions,
): Promise<ParseLifeRoadNodeUpdateResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, error: '请输入一句话更新', attempts: 0 };
  try {
    const raw = await aiApi.aiLifeRoadParseNodeUpdate({
      text,
      node: options.node,
    });
    const data = normalizeLifeRoadNodeUpdatePayload(raw);
    if (!data) return { ok: false, error: '未能解析出有效更新', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type NudgeProfileCompletenessOptions = {
  fillChips?: Array<Record<string, unknown>>;
  filledSummary?: Record<string, unknown>;
  completenessPercent?: number;
};

export type NudgeProfileCompletenessResult =
  | { ok: true; data: aiApi.ProfileCompletenessNudgeJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const PROFILE_FILL_CHIP_KEYS = new Set(['persona', 'dietary', 'birthday', 'body']);

function normalizeProfileCompletenessNudgePayload(
  raw: unknown,
): aiApi.ProfileCompletenessNudgeJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const chip = String(o.primary_chip ?? o.chip ?? o.key ?? '')
    .trim()
    .toLowerCase();
  if (!PROFILE_FILL_CHIP_KEYS.has(chip)) return null;
  const reason = String(o.reason ?? '').trim().slice(0, 160);
  const example_fill = String(o.example_fill ?? o.example ?? '')
    .trim()
    .slice(0, 120);
  if (!reason) return null;
  return { primary_chip: chip, reason, example_fill };
}

export async function nudgeProfileCompleteness(
  options: NudgeProfileCompletenessOptions,
): Promise<NudgeProfileCompletenessResult> {
  try {
    const raw = await aiApi.aiProfileCompletenessNudge({
      fill_chips: options.fillChips,
      filled_summary: options.filledSummary,
      completeness_percent: options.completenessPercent,
    });
    const data = normalizeProfileCompletenessNudgePayload(raw);
    if (!data) return { ok: false, error: '未能生成有效引导', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type ParseLifeRoadFromImageOptions = {
  imageBase64: string;
  imageMimeType?: string;
  supplementText?: string;
  calendarYear?: number;
};

export type ParseLifeRoadFromImageResult =
  | { ok: true; data: aiApi.LifeRoadParseFromImageJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeLifeRoadParseFromImagePayload(
  raw: unknown,
): aiApi.LifeRoadParseFromImageJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const direction_body =
    typeof o.direction_body === 'string'
      ? o.direction_body.trim().slice(0, 200) || null
      : typeof o.body === 'string'
        ? o.body.trim().slice(0, 200) || null
        : null;
  const year_theme =
    typeof o.year_theme === 'string' ? o.year_theme.trim().slice(0, 40) || null : null;
  const plan = normalizeLifeRoadPlanPayload({
    year_theme,
    nodes: o.nodes,
  });
  const nodes = plan?.nodes ?? [];
  if (!direction_body && !nodes.length) return null;
  return {
    direction_body,
    year_theme: plan?.year_theme ?? year_theme,
    nodes,
  };
}

export async function parseLifeRoadFromImage(
  options: ParseLifeRoadFromImageOptions,
): Promise<ParseLifeRoadFromImageResult> {
  const image_base64 = options.imageBase64.trim();
  if (!image_base64) return { ok: false, error: '请先选择图片', attempts: 0 };
  try {
    const raw = await aiApi.aiLifeRoadParseFromImage({
      image_base64,
      image_mime_type: options.imageMimeType?.trim() || undefined,
      supplement_text: options.supplementText?.trim() || undefined,
      calendar_year: options.calendarYear,
    });
    const data = normalizeLifeRoadParseFromImagePayload(raw);
    if (!data) return { ok: false, error: '未能从图片识别出道路草稿', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type SuggestLifeRoadLinksOptions = {
  focusNode?: Record<string, unknown>;
  candidateTasks?: Array<{ id: string; title?: string }>;
  candidateHabits?: Array<{ id: string; title?: string }>;
  candidateProjects?: Array<{ id: string; title?: string }>;
};

export type SuggestLifeRoadLinksResult =
  | { ok: true; data: aiApi.LifeRoadSuggestLinksJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function filterIds(raw: unknown, allowed: Set<string>, limit = 5): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const id =
      x && typeof x === 'object'
        ? String((x as Record<string, unknown>).id ?? '').trim()
        : String(x ?? '').trim();
    if (!id || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeLifeRoadSuggestLinksPayload(
  raw: unknown,
  allowed: {
    tasks: Set<string>;
    habits: Set<string>;
    projects: Set<string>;
  },
): aiApi.LifeRoadSuggestLinksJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    suggested_task_ids: filterIds(o.suggested_task_ids ?? o.task_ids, allowed.tasks),
    suggested_habit_ids: filterIds(o.suggested_habit_ids ?? o.habit_ids, allowed.habits),
    suggested_project_ids: filterIds(
      o.suggested_project_ids ?? o.project_ids,
      allowed.projects,
    ),
    reason: String(o.reason ?? '').trim().slice(0, 120) || '与焦点方向最接近的执行面',
  };
}

export async function suggestLifeRoadLinks(
  options: SuggestLifeRoadLinksOptions,
): Promise<SuggestLifeRoadLinksResult> {
  const tasks = options.candidateTasks ?? [];
  const habits = options.candidateHabits ?? [];
  const projects = options.candidateProjects ?? [];
  if (!tasks.length && !habits.length && !projects.length) {
    return {
      ok: true,
      data: {
        suggested_task_ids: [],
        suggested_habit_ids: [],
        suggested_project_ids: [],
        reason: '没有可关联的候选',
      },
      rawContent: '{}',
      attempts: 0,
    };
  }
  try {
    const raw = await aiApi.aiLifeRoadSuggestLinks({
      focus_node: options.focusNode,
      candidate_tasks: tasks,
      candidate_habits: habits,
      candidate_projects: projects,
    });
    const data = normalizeLifeRoadSuggestLinksPayload(raw, {
      tasks: new Set(tasks.map((t) => t.id).filter(Boolean)),
      habits: new Set(habits.map((h) => h.id).filter(Boolean)),
      projects: new Set(projects.map((p) => p.id).filter(Boolean)),
    });
    if (!data) return { ok: false, error: '未能生成关联建议', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

// --- 我的页 P2 ---

export type AnalyzeProfileWeightCommentOptions = {
  points: Array<{ ymd: string; kg: number }>;
  goal?: string;
  heightCm?: number;
};

export type AnalyzeProfileWeightCommentResult =
  | { ok: true; data: aiApi.ProfileWeightCommentJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeProfileWeightCommentPayload(
  raw: unknown,
): aiApi.ProfileWeightCommentJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const comment = String(o.comment ?? '').trim().slice(0, 240);
  if (!comment) return null;
  const cautionRaw = typeof o.caution === 'string' ? o.caution.trim().slice(0, 120) : '';
  return { comment, caution: cautionRaw || null };
}

export async function analyzeProfileWeightComment(
  options: AnalyzeProfileWeightCommentOptions,
): Promise<AnalyzeProfileWeightCommentResult> {
  const points = options.points
    .filter(
      (p) => typeof p.ymd === 'string' && p.ymd.trim() && Number.isFinite(p.kg),
    )
    .slice(-30)
    .map((p) => ({ ymd: p.ymd.trim(), kg: p.kg }));
  if (!points.length) return { ok: false, error: '没有可分析的体重记录', attempts: 0 };
  try {
    const raw = await aiApi.aiProfileWeightComment({
      points,
      goal: options.goal?.trim() || undefined,
      height_cm:
        options.heightCm != null && Number.isFinite(options.heightCm)
          ? options.heightCm
          : undefined,
    });
    const data = normalizeProfileWeightCommentPayload(raw);
    if (!data) return { ok: false, error: '未能生成体重短评', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type DraftProfileCompletionLogCommentOptions = {
  projectTitle: string;
  archiveSummary?: string;
  durationLabel?: string;
  pointsDelta?: number;
  source?: string;
};

export type DraftProfileCompletionLogCommentResult =
  | { ok: true; data: aiApi.ProfileCompletionLogCommentJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeProfileCompletionLogCommentPayload(
  raw: unknown,
): aiApi.ProfileCompletionLogCommentJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const comment = String(o.comment ?? '').trim().slice(0, 200);
  if (!comment) return null;
  return { comment };
}

export async function draftProfileCompletionLogComment(
  options: DraftProfileCompletionLogCommentOptions,
): Promise<DraftProfileCompletionLogCommentResult> {
  const project_title = options.projectTitle.trim();
  if (!project_title) return { ok: false, error: '缺少项目标题', attempts: 0 };
  try {
    const raw = await aiApi.aiProfileCompletionLogComment({
      project_title,
      archive_summary: options.archiveSummary?.trim() || undefined,
      duration_label: options.durationLabel?.trim() || undefined,
      points_delta:
        options.pointsDelta != null && Number.isFinite(options.pointsDelta)
          ? options.pointsDelta
          : undefined,
      source: options.source?.trim() || undefined,
    });
    const data = normalizeProfileCompletionLogCommentPayload(raw);
    if (!data) return { ok: false, error: '未能生成履历短评', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type DraftProfileNotificationCopyItem = {
  identifier: string;
  fingerprint: string;
  contextBlock: string;
  fallbackTitle?: string;
  fallbackBody?: string;
};

export type DraftProfileNotificationCopyResult =
  | { ok: true; data: aiApi.ProfileNotificationCopyJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeProfileNotificationCopyPayload(
  raw: unknown,
  allowed: Map<string, { identifier: string; fingerprint: string }>,
): aiApi.ProfileNotificationCopyJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.copies)
    ? o.copies
    : Array.isArray(o.items)
      ? o.items
      : null;
  if (!list) return null;
  const copies: aiApi.ProfileNotificationCopyItemJson[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const identifier = String(r.identifier ?? '').trim();
    const fingerprint = String(r.fingerprint ?? '').trim();
    if (!allowed.has(`${identifier}\u0000${fingerprint}`)) continue;
    const title = String(r.title ?? '').trim();
    const body = String(r.body ?? '').trim();
    if (!title && !body) continue;
    copies.push({ identifier, fingerprint, title: title || '提醒', body });
    if (copies.length >= 10) break;
  }
  return { copies };
}

export async function draftProfileNotificationCopy(
  items: DraftProfileNotificationCopyItem[],
): Promise<DraftProfileNotificationCopyResult> {
  const cleaned = items
    .map((i) => ({
      identifier: i.identifier.trim(),
      fingerprint: i.fingerprint.trim(),
      context_block: i.contextBlock.trim(),
      fallback_title: i.fallbackTitle?.trim() || undefined,
      fallback_body: i.fallbackBody?.trim() || undefined,
    }))
    .filter((i) => i.identifier && i.fingerprint && i.context_block)
    .slice(0, 10);
  if (!cleaned.length) return { ok: false, error: '没有可预热的通知', attempts: 0 };
  try {
    const raw = await aiApi.aiProfileNotificationCopy({ items: cleaned });
    const allowed = new Map<string, { identifier: string; fingerprint: string }>();
    for (const i of cleaned) {
      allowed.set(`${i.identifier}\u0000${i.fingerprint}`, {
        identifier: i.identifier,
        fingerprint: i.fingerprint,
      });
    }
    const data = normalizeProfileNotificationCopyPayload(raw, allowed);
    if (!data || !data.copies.length) {
      return { ok: false, error: '未能生成有效文案', attempts: 1, details: raw };
    }
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

export type AnalyzeLifeRoadPeriodReviewOptions = {
  period: string;
  calendarYear?: number;
  quarter?: number;
  directionBody?: string;
  yearTheme?: string;
  statusCounts?: Record<string, number>;
  arrivedTitles?: string[];
  nodeSummaries?: Array<Record<string, unknown>>;
};

export type AnalyzeLifeRoadPeriodReviewResult =
  | { ok: true; data: aiApi.LifeRoadPeriodReviewJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const LIFE_ROAD_PERIOD_OPEN_HINTS = new Set(['tasks', 'review', 'life-road', 'wish-board']);

function normalizeLifeRoadPeriodReviewPayload(
  raw: unknown,
): aiApi.LifeRoadPeriodReviewJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const review = String(o.review ?? o.body ?? '').trim().slice(0, 600);
  if (!review) return null;
  const highlights: string[] = [];
  if (Array.isArray(o.highlights)) {
    for (const h of o.highlights) {
      const text = String(h ?? '').trim().slice(0, 120);
      if (text && !highlights.includes(text)) highlights.push(text);
      if (highlights.length >= 6) break;
    }
  }
  const themeRaw =
    typeof o.next_theme_draft === 'string' ? o.next_theme_draft.trim().slice(0, 40) : '';
  const hintRaw = String(o.open_hint ?? '').trim().toLowerCase();
  return {
    review,
    highlights,
    next_theme_draft: themeRaw || null,
    open_hint: LIFE_ROAD_PERIOD_OPEN_HINTS.has(hintRaw) ? hintRaw : null,
  };
}

export async function analyzeLifeRoadPeriodReview(
  options: AnalyzeLifeRoadPeriodReviewOptions,
): Promise<AnalyzeLifeRoadPeriodReviewResult> {
  const period = options.period.trim() || 'year';
  try {
    const raw = await aiApi.aiLifeRoadPeriodReview({
      period,
      calendar_year: options.calendarYear,
      quarter: options.quarter,
      direction_body: options.directionBody?.trim() || undefined,
      year_theme: options.yearTheme?.trim() || undefined,
      status_counts: options.statusCounts,
      arrived_titles: options.arrivedTitles,
      node_summaries: options.nodeSummaries,
    });
    const data = normalizeLifeRoadPeriodReviewPayload(raw);
    if (!data) return { ok: false, error: '未能生成回顾', attempts: 1, details: raw };
    return { ok: true, data, rawContent: JSON.stringify(raw), attempts: 1 };
  } catch (e) {
    const err = mapApiError(e);
    return { ok: false, error: err.error, attempts: 1, httpStatus: err.httpStatus, details: err.details };
  }
}

