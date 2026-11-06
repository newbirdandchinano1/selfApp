/**
 * App → selfAPP_AIAgent `/api/v1/ai/*`（智谱 Key 仅存 Agent；鉴权为 X-API-Key）。
 * 规范见项目根目录 AI_API.md 与各业务模块 APP 接入说明。
 */

import { getAgentApiKey, getAgentBaseUrl } from '@/lib/agent-config';
import { ApiRequestError } from '@/lib/api/http';
import { fetchWithTimeoutAndRetry } from '@/lib/cloud-fetch-retry';

import type {
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FinanceAnomalyHintsJson,
  FinanceBudgetSuggestJson,
  FinanceDailyWrapupJson,
  FinanceDailyWrapupPeriod,
  FinanceParseCashFlowEntryJson,
  FinanceParseMultiFromImageJson,
  FinanceParseScheduledExpenseJson,
  FinanceParseTransferJson,
  FinanceSavingsGoalCoachJson,
  FinanceSimulateAdviceJson,
  FinanceSuggestCategoryJson,
  FoodAdjustIntakeJson,
  FoodDailyWrapupJson,
  FoodIntakeCommentJson,
  FoodNutritionJson,
  FoodNutritionLabelJson,
  FoodNutritionSplitJson,
  FoodSuggestNextMealJson,
  FoodTextIntakeJson,
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
  WishBoardAiCandidate,
  WishBoardAiSummaryItem,
  WishBoardCoachUnlockJson,
  WishBoardDraftFromImageJson,
  WishBoardDraftFromTextJson,
  WishBoardIncentiveStrength,
  WishBoardInsightsJson,
  WishBoardSuggestConditionsJson,
  WishBoardSuggestCostJson,
  WishBoardSuggestNextJson,
} from '@/lib/ai-types';

const AI_PREFIX = '/api/v1/ai';
const AI_TIMEOUT_MS = 120_000;

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

type AgentEnvelope<T> = {
  code: number;
  message: string;
  data: T | null;
};

function extractEnvelope(parsed: unknown): AgentEnvelope<unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.code !== 'number' || typeof o.message !== 'string') return null;
  return { code: o.code, message: o.message, data: (o.data ?? null) as unknown };
}

async function agentAiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const baseUrl = await getAgentBaseUrl();
  const apiKey = await getAgentApiKey();
  const method = options.method ?? 'GET';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
  };
  let requestBody: string | undefined;
  if (options.body !== undefined && options.body !== null) {
    requestBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      method,
      headers,
      ...(requestBody !== undefined ? { body: requestBody } : {}),
    },
    { perAttemptTimeoutMs: AI_TIMEOUT_MS, maxAttempts: 2 },
  );

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  const envelope = extractEnvelope(parsed);
  if (!envelope) {
    throw new ApiRequestError(
      `Agent 响应格式异常：HTTP ${res.status}`,
      res.status,
      -1,
      { retryable: res.status >= 500 },
    );
  }

  if (!(res.status === 200 && envelope.code === 0)) {
    throw new ApiRequestError(
      envelope.message || `Agent 请求失败：HTTP ${res.status}`,
      res.status,
      envelope.code,
      {
        retryable: res.status === 500 || res.status === 502 || res.status === 503,
        data: envelope.data,
      },
    );
  }

  return envelope.data as T;
}

export async function aiGetHealth(): Promise<AiHealthData> {
  return agentAiRequest<AiHealthData>(`${AI_PREFIX}/health`, { method: 'GET' });
}

export async function aiFoodIntakeFromText(body: {
  text: string;
  question?: string;
}): Promise<FoodTextIntakeJson> {
  return agentAiRequest(`${AI_PREFIX}/food/intake-from-text`, { method: 'POST', body });
}

export async function aiFoodNutritionFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
}): Promise<FoodNutritionJson> {
  return agentAiRequest(`${AI_PREFIX}/food/nutrition-from-image`, { method: 'POST', body });
}

export async function aiFoodDailyTargets(body: { context_block: string }): Promise<DailyIntakeTargetsEstimateJson> {
  return agentAiRequest(`${AI_PREFIX}/food/daily-targets`, { method: 'POST', body });
}

export async function aiFoodWeeklyInsights(body: {
  context_block: string;
  rule_insights?: { title: string; body: string; metric_hint?: string }[];
}): Promise<FoodWeeklyInsightsJson> {
  return agentAiRequest(`${AI_PREFIX}/food/weekly-insights`, { method: 'POST', body });
}

export type FoodQuickAddHint = {
  key: string;
  name: string;
  nutrition_summary?: string;
};

export type FoodRecipeHint = {
  id: string;
  title: string;
  nutrition_summary?: string;
};

export async function aiFoodSuggestNextMeal(body: {
  context_block: string;
  quick_adds?: FoodQuickAddHint[];
  recipes?: FoodRecipeHint[];
}): Promise<FoodSuggestNextMealJson> {
  return agentAiRequest(`${AI_PREFIX}/food/suggest-next-meal`, { method: 'POST', body });
}

export async function aiFoodNutritionFromImageSplit(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
  dish_count_hint?: number;
}): Promise<FoodNutritionSplitJson> {
  return agentAiRequest(`${AI_PREFIX}/food/nutrition-from-image-split`, { method: 'POST', body });
}

export async function aiFoodAdjustIntake(body: {
  title?: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  ai_comment?: string;
  adjustment_text: string;
}): Promise<FoodAdjustIntakeJson> {
  return agentAiRequest(`${AI_PREFIX}/food/adjust-intake`, { method: 'POST', body });
}

export async function aiFoodDailyWrapup(body: {
  context_block: string;
}): Promise<FoodDailyWrapupJson> {
  return agentAiRequest(`${AI_PREFIX}/food/daily-wrapup`, { method: 'POST', body });
}

export async function aiFoodWeightComment(body: {
  context_block: string;
}): Promise<FoodWeightCommentJson> {
  return agentAiRequest(`${AI_PREFIX}/food/weight-comment`, { method: 'POST', body });
}

export async function aiFoodNutritionFromLabelImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
}): Promise<FoodNutritionLabelJson> {
  return agentAiRequest(`${AI_PREFIX}/food/nutrition-from-label-image`, { method: 'POST', body });
}

export async function aiFoodIntakeComment(body: {
  title?: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  gap_hint?: string;
}): Promise<FoodIntakeCommentJson> {
  return agentAiRequest(`${AI_PREFIX}/food/intake-comment`, { method: 'POST', body });
}

export async function aiFinanceParseOneLiner(body: {
  text: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceOneLinerJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-one-liner`, { method: 'POST', body });
}

export async function aiFinanceParseOneLinerFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceOneLinerJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-one-liner-from-image`, { method: 'POST', body });
}

export async function aiFinanceTxnComment(body: { summary_text: string }): Promise<{ comment: string }> {
  return agentAiRequest(`${AI_PREFIX}/finance/txn-comment`, { method: 'POST', body });
}

export async function aiFinanceBillSummaryAnalysis(body: { summary_text: string }): Promise<{ analysis: string }> {
  return agentAiRequest(`${AI_PREFIX}/finance/bill-summary-analysis`, { method: 'POST', body });
}

export async function aiFinanceDashboardAnalysis(body: {
  summary_text: string;
  past6_net_savings?: number[];
  past6_income?: number[];
}): Promise<AiFinanceDashboardPayload> {
  return agentAiRequest(`${AI_PREFIX}/finance/dashboard-analysis`, { method: 'POST', body });
}

export async function aiFinanceCashFlowAnalysis(body: { summary_text: string }): Promise<{ analysis: string }> {
  return agentAiRequest(`${AI_PREFIX}/finance/cash-flow-analysis`, { method: 'POST', body });
}

export async function aiFinanceBudgetSuggest(body: {
  summary_text: string;
  current_base_amount?: number | null;
}): Promise<FinanceBudgetSuggestJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/budget-suggest`, { method: 'POST', body });
}

export async function aiFinanceSavingsGoalCoach(body: {
  summary_text: string;
}): Promise<FinanceSavingsGoalCoachJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/savings-goal-coach`, { method: 'POST', body });
}

export async function aiFinanceSimulateAdvice(body: {
  summary_text: string;
}): Promise<FinanceSimulateAdviceJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/simulate-advice`, { method: 'POST', body });
}

export async function aiFinanceParseTransfer(body: {
  text: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceParseTransferJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-transfer`, { method: 'POST', body });
}

export async function aiFinanceParseMultiFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  accounts?: FinanceOneLinerAccountHint[];
  max_items?: number;
}): Promise<FinanceParseMultiFromImageJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-multi-from-image`, { method: 'POST', body });
}

export async function aiFinanceParseScheduledExpense(body: {
  text: string;
  accounts?: FinanceOneLinerAccountHint[];
  category_names?: string[];
}): Promise<FinanceParseScheduledExpenseJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-scheduled-expense`, { method: 'POST', body });
}

export async function aiFinanceSuggestCategory(body: {
  summary_text: string;
  category_names: string[];
}): Promise<FinanceSuggestCategoryJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/suggest-category`, { method: 'POST', body });
}

export async function aiFinanceAnomalyHints(body: {
  summary_text: string;
  txn_ids?: string[];
}): Promise<FinanceAnomalyHintsJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/anomaly-hints`, { method: 'POST', body });
}

export async function aiFinanceDailyWrapup(body: {
  summary_text: string;
  period?: FinanceDailyWrapupPeriod;
}): Promise<FinanceDailyWrapupJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/daily-wrapup`, { method: 'POST', body });
}

export async function aiFinanceParseCashFlowEntry(body: {
  text: string;
  existing_names?: string[];
}): Promise<FinanceParseCashFlowEntryJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-cash-flow-entry`, { method: 'POST', body });
}

export async function aiMemoReview(body: { memo_context_text: string }): Promise<MemoReviewJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/review`, { method: 'POST', body });
}

export async function aiMemoConvertDraft(body: {
  memo_context_text: string;
  target?: MemoConvertTarget;
  ai_summary?: string;
}): Promise<MemoConvertDraftJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/convert-draft`, { method: 'POST', body });
}

export async function aiMemoSuggestTags(body: {
  memo_context_text: string;
  tags?: { id: string; name: string }[];
  tag_ids?: string[];
}): Promise<MemoSuggestTagsJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/suggest-tags`, { method: 'POST', body });
}

export async function aiMemoDraftFromText(body: {
  text: string;
  style?: MemoDraftStyle;
}): Promise<MemoDraftFromTextJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/draft-from-text`, { method: 'POST', body });
}

export async function aiMemoDraftFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
}): Promise<MemoDraftFromImageJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/draft-from-image`, { method: 'POST', body });
}

export async function aiMemoRewrite(body: {
  memo_context_text: string;
  mode?: MemoRewriteMode;
}): Promise<MemoRewriteJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/rewrite`, { method: 'POST', body });
}

export async function aiMemoDedupeHints(body: {
  memo_context_text: string;
  current_memo_id?: string;
  candidates?: MemoAiSummaryItem[];
}): Promise<MemoDedupeHintsJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/dedupe-hints`, { method: 'POST', body });
}

export async function aiMemoCollectionInsights(body: {
  period_label?: string;
  memos: MemoAiSummaryItem[];
}): Promise<MemoCollectionInsightsJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/collection-insights`, { method: 'POST', body });
}

export async function aiMemoLinkSuggest(body: {
  memo_context_text: string;
  projects?: { id: string; name: string }[];
  todos?: { id: string; title: string }[];
}): Promise<MemoLinkSuggestJson> {
  return agentAiRequest(`${AI_PREFIX}/memo/link-suggest`, { method: 'POST', body });
}

export type ReviewCoachingDimensionColumn = {
  title: string;
  value: string;
};

export type ReviewCoachingDimension = {
  title: string;
  value?: string;
  columns?: ReviewCoachingDimensionColumn[];
};

export type ReviewCoachingRequestBody = {
  review_type?: 'daily' | 'weekly' | 'monthly';
  period_label?: string;
  dimensions?: ReviewCoachingDimension[];
  metrics_text?: string | null;
  related_digest?: string | null;
  execution_score?: number | null;
  review_data?: string;
  /** @deprecated 旧客户端整段正文；新调用请只传结构化复盘数据 */
  user_prompt?: string;
};

/** 与 `lib/review-ai-json-contract.ts` 对齐 */
export type ReviewCoachingSuggestionAction = 'memo' | 'project' | 'habit' | 'todo';

export type ReviewCoachingSuggestion = {
  text: string;
  action: ReviewCoachingSuggestionAction;
  draft_title: string;
  draft_body?: string;
};

/** Agent 复盘分析结果：结构化字段 + 落库用 text（规范 JSON 字符串） */
export type ReviewCoachingResult = {
  title: string;
  overview: string;
  tags: string[];
  suggestions: ReviewCoachingSuggestion[];
  text: string;
};

export async function aiWeeklyReviewCoaching(body: ReviewCoachingRequestBody): Promise<ReviewCoachingResult> {
  return agentAiRequest(`${AI_PREFIX}/weekly-review/coaching`, { method: 'POST', body });
}

export type ReviewDraftDimensionResult = {
  draft_text: string;
  confidence: number;
};

export type ReviewConvertActionItem = {
  action: ReviewCoachingSuggestionAction;
  draft_title: string;
  draft_body?: string;
  ref_task_id?: string | null;
  text?: string;
};

export type ReviewConvertActionsResult = {
  actions: ReviewConvertActionItem[];
};

export async function aiReviewDraftDimension(body: {
  scope?: 'daily' | 'weekly' | 'monthly';
  period_label?: string;
  dimension_title: string;
  column_title?: string | null;
  facts_text?: string;
  existing_text?: string | null;
  user_hint?: string | null;
}): Promise<ReviewDraftDimensionResult> {
  return agentAiRequest(`${AI_PREFIX}/review/draft-dimension`, { method: 'POST', body });
}

export async function aiReviewConvertActions(body: {
  scope?: 'daily' | 'weekly' | 'monthly';
  period_label?: string;
  dimension_title?: string;
  text: string;
  open_items?: { id: string; title: string }[];
}): Promise<ReviewConvertActionsResult> {
  return agentAiRequest(`${AI_PREFIX}/review/convert-actions`, { method: 'POST', body });
}

export type ReviewRewriteDimensionMode = 'tighten' | 'clarify' | 'gentle';

export type ReviewRewriteDimensionResult = {
  text: string;
  change_summary?: string;
};

export type ReviewOutlineItem = {
  dimension_title: string;
  prompts: string[];
};

export type ReviewOutlineResult = {
  headline?: string;
  outline: ReviewOutlineItem[];
};

export async function aiReviewRewriteDimension(body: {
  text: string;
  mode?: ReviewRewriteDimensionMode;
  dimension_title?: string;
  scope?: 'daily' | 'weekly' | 'monthly';
  period_label?: string;
  column_title?: string | null;
}): Promise<ReviewRewriteDimensionResult> {
  return agentAiRequest(`${AI_PREFIX}/review/rewrite-dimension`, { method: 'POST', body });
}

export async function aiReviewOutline(body: {
  scope?: 'daily' | 'weekly';
  period_label?: string;
  facts_text?: string;
  metrics_text?: string | null;
  dimension_titles?: string[];
  open_defect_hint?: string | null;
}): Promise<ReviewOutlineResult> {
  return agentAiRequest(`${AI_PREFIX}/review/outline`, { method: 'POST', body });
}

export type ReviewPeriodSummaryItem = {
  period_label: string;
  tags?: string[];
  title_or_overview?: string;
  defects_preview?: string;
  ideas_preview?: string;
  metrics?: string | null;
};

export type ReviewPeriodInsightsResult = {
  themes: string[];
  recurring_defects: string[];
  tips: string[];
  suggested_actions: ReviewConvertActionItem[];
};

export async function aiReviewPeriodInsights(body: {
  scope?: 'weekly' | 'monthly';
  periods?: ReviewPeriodSummaryItem[];
  aggregate_metrics?: string | null;
}): Promise<ReviewPeriodInsightsResult> {
  return agentAiRequest(`${AI_PREFIX}/review/period-insights`, { method: 'POST', body });
}

export type ReviewTemplateCopyColumn = {
  dimension_title: string;
  column_title: string;
  placeholder: string;
  hint?: string;
};

export type ReviewSuggestTemplateCopyResult = {
  columns: ReviewTemplateCopyColumn[];
};

export async function aiReviewSuggestTemplateCopy(body: {
  scope?: 'daily' | 'weekly' | 'monthly';
  dimension_titles?: string[];
  user_goal?: string;
}): Promise<ReviewSuggestTemplateCopyResult> {
  return agentAiRequest(`${AI_PREFIX}/review/suggest-template-copy`, { method: 'POST', body });
}

/** 菜谱结构化草稿（与 Agent `/recipe/*` 契约对齐；确认后再 create/update） */
export type RecipeIngredientDraft = {
  name: string;
  amount: string;
  remark?: string;
};

export type RecipeParseDraftJson = {
  title: string;
  category_hint: string | null;
  ingredients: RecipeIngredientDraft[];
  steps: string[];
  notes: string;
  confidence: number;
};

export async function aiRecipeParseFromText(body: {
  text: string;
  category_hints?: string[];
}): Promise<RecipeParseDraftJson> {
  return agentAiRequest(`${AI_PREFIX}/recipe/parse-from-text`, { method: 'POST', body });
}

export async function aiRecipeParseFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
  category_hints?: string[];
}): Promise<RecipeParseDraftJson> {
  return agentAiRequest(`${AI_PREFIX}/recipe/parse-from-image`, { method: 'POST', body });
}

export type RecipeAiSummaryItem = {
  id: string;
  title: string;
  ingredients?: string[];
  times_cooked?: number;
  avg_rating?: number | null;
};

export type RecipeAiPlanSummaryItem = {
  date: string;
  slot: string;
  recipeId: string;
  recipeTitle: string;
};

export type RecipeWeekPlanEntryJson = {
  date: string;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | string;
  recipeId: string;
  recipeTitle: string;
  reason: string;
};

export type RecipeWeekPlanSuggestJson = {
  entries: RecipeWeekPlanEntryJson[];
  unmet_slots: { date: string; slot: string; hint: string }[];
  notes: string;
  suggest_new_drafts: string[];
};

export type RecipePantrySuggestionJson = {
  recipeId: string;
  recipeTitle: string;
  reason: string;
  missing_ingredients: string[];
};

export type RecipePantrySuggestJson = {
  suggestions: RecipePantrySuggestionJson[];
  notes: string;
};

export async function aiRecipeSuggestWeekPlan(body: {
  start_date: string;
  end_date: string;
  recipes: RecipeAiSummaryItem[];
  existing_plan?: RecipeAiPlanSummaryItem[];
  preferences?: string;
  target_slots?: string[];
}): Promise<RecipeWeekPlanSuggestJson> {
  return agentAiRequest(`${AI_PREFIX}/recipe/suggest-week-plan`, { method: 'POST', body });
}

export async function aiRecipeSuggestFromPantry(body: {
  pantry: string[];
  recipes: RecipeAiSummaryItem[];
  servings?: number;
  meal_slot?: string;
  preferences?: string;
  limit?: number;
}): Promise<RecipePantrySuggestJson> {
  return agentAiRequest(`${AI_PREFIX}/recipe/suggest-from-pantry`, { method: 'POST', body });
}

export type RecipeScaleRewriteJson = {
  title: string;
  ingredients: RecipeIngredientDraft[];
  steps: string[];
  notes: string;
  summary: string;
};

export async function aiRecipeScaleOrRewrite(body: {
  title: string;
  ingredients: RecipeIngredientDraft[];
  steps: string[];
  notes?: string;
  goal: string;
}): Promise<RecipeScaleRewriteJson> {
  return agentAiRequest(`${AI_PREFIX}/recipe/scale-or-rewrite`, { method: 'POST', body });
}

export async function aiRecipeCookComment(body: {
  recipe_title: string;
  rating: number;
  user_note?: string;
  improvement_hint?: string;
}): Promise<{ comment: string }> {
  return agentAiRequest(`${AI_PREFIX}/recipe/cook-comment`, { method: 'POST', body });
}

/** 心愿板：草稿 / 估分 / 解锁文案（确认后再 create；兑换永不经 Agent） */
export async function aiWishBoardDraftFromText(body: {
  text: string;
  balance?: number;
  icon_keys?: string[];
  recent_titles?: string[];
}): Promise<WishBoardDraftFromTextJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/draft-from-text`, { method: 'POST', body });
}

export async function aiWishBoardSuggestCost(body: {
  title: string;
  description_text?: string;
  wish_type?: 'once' | 'repeat';
  balance?: number;
  month_earned?: number;
  existing_costs?: number[];
  incentive_strength?: WishBoardIncentiveStrength;
  recent_redeem_count?: number;
}): Promise<WishBoardSuggestCostJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/suggest-cost`, { method: 'POST', body });
}

export async function aiWishBoardCoachUnlock(body: {
  wish_title: string;
  eligibility?: {
    points_ok?: boolean;
    cost_points?: number;
    balance?: number;
    pending?: { kind: string; id: string; title: string; missing?: boolean }[];
    checks_summary?: string;
  };
}): Promise<WishBoardCoachUnlockJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/coach-unlock`, { method: 'POST', body });
}

export async function aiWishBoardSuggestConditions(body: {
  title: string;
  description_text?: string;
  wish_type?: 'once' | 'repeat';
  cost_points?: number;
  projects?: WishBoardAiCandidate[];
  tasks?: WishBoardAiCandidate[];
  todos?: WishBoardAiCandidate[];
  habits?: WishBoardAiCandidate[];
  current_net_worth?: number;
}): Promise<WishBoardSuggestConditionsJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/suggest-conditions`, { method: 'POST', body });
}

export async function aiWishBoardDraftFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
  balance?: number;
  icon_keys?: string[];
}): Promise<WishBoardDraftFromImageJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/draft-from-image`, { method: 'POST', body });
}

export async function aiWishBoardSuggestNext(body: {
  active?: WishBoardAiSummaryItem[];
  redeemed?: WishBoardAiSummaryItem[];
  balance?: number;
  month_earned?: number;
  preference?: string;
  icon_keys?: string[];
  limit?: number;
}): Promise<WishBoardSuggestNextJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/suggest-next`, { method: 'POST', body });
}

/** 心愿板健康度洞察（只读 tips；不改分、不改心愿） */
export async function aiWishBoardInsights(body: {
  balance?: number;
  month_earned?: number;
  active?: WishBoardAiSummaryItem[];
  redeemed?: WishBoardAiSummaryItem[];
  waiting_gap_avg?: number;
  repeat_ratio?: number;
  period_label?: string;
}): Promise<WishBoardInsightsJson> {
  return agentAiRequest(`${AI_PREFIX}/wish-board/insights`, { method: 'POST', body });
}

/** 衣橱：识图 → 单品属性草稿（确认后再 create/update） */
export type WardrobeOptionHints = {
  colors?: string[];
  seasons?: string[];
  brands?: string[];
  fits?: string[];
  warmth?: string[];
};

export type WardrobeItemParseDraftJson = {
  name: string;
  category_hint: string | null;
  color: string;
  season: string;
  brand: string;
  fit: string;
  warmth: string;
  tags: string[];
  art_key: string | null;
  confidence: number;
};

export async function aiWardrobeParseItemFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
  category_names?: string[];
  option_hints?: WardrobeOptionHints;
}): Promise<WardrobeItemParseDraftJson> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/parse-item-from-image`, { method: 'POST', body });
}

export type WardrobeAiItemSummary = {
  id: string;
  name: string;
  category?: string | null;
  color?: string | null;
  season?: string | null;
  brand?: string | null;
  warmth?: string | null;
  wear_count?: number | null;
  last_worn_on?: string | null;
  tags?: string[];
};

export type WardrobeAiOutfitSummary = {
  id: string;
  name: string;
  occasion?: string | null;
  itemIds?: string[];
  wear_count?: number | null;
  last_worn_on?: string | null;
};

export type WardrobeSuggestTodayAltJson = {
  mode: 'outfit' | 'items' | string;
  outfitId?: string | null;
  outfitName?: string | null;
  itemIds: string[];
  reason: string;
};

export type WardrobeSuggestTodayJson = {
  mode: 'outfit' | 'items' | string;
  outfitId: string | null;
  outfitName: string | null;
  itemIds: string[];
  reason: string;
  alternatives: WardrobeSuggestTodayAltJson[];
  avoid_repeat: boolean;
};

export async function aiWardrobeSuggestToday(body: {
  today_ymd?: string;
  season_hint?: string;
  weather_hint?: string;
  occasion_pref?: string;
  items: WardrobeAiItemSummary[];
  outfits?: WardrobeAiOutfitSummary[];
  recently_worn_item_ids?: string[];
  recently_worn_outfit_ids?: string[];
  seed_item_ids?: string[];
  avoid_repeat?: boolean;
}): Promise<WardrobeSuggestTodayJson> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/suggest-today`, { method: 'POST', body });
}

/** 衣橱：一句话 → 单品属性草稿 */
export async function aiWardrobeParseItemFromText(body: {
  text: string;
  category_names?: string[];
  option_hints?: WardrobeOptionHints;
}): Promise<WardrobeItemParseDraftJson> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/parse-item-from-text`, { method: 'POST', body });
}

export type WardrobeSuggestOutfitJson = {
  itemIds: string[];
  name_hint: string;
  occasion_hint: string | null;
  reason: string;
  near_outfit_id: string | null;
  near_outfit_name: string | null;
};

export async function aiWardrobeSuggestOutfit(body: {
  occasion?: string;
  season_hint?: string;
  weather_hint?: string;
  seed_item_ids?: string[];
  items: WardrobeAiItemSummary[];
  outfits?: WardrobeAiOutfitSummary[];
  preferences?: string;
}): Promise<WardrobeSuggestOutfitJson> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/suggest-outfit`, { method: 'POST', body });
}

export type WardrobeIdleInsightsJson = {
  idle_item_ids: string[];
  capsule_gaps: string[];
  tips: string[];
};

export async function aiWardrobeIdleInsights(body: {
  items: WardrobeAiItemSummary[];
  wear_summary_90d?: string;
  category_names?: string[];
  limit?: number;
}): Promise<WardrobeIdleInsightsJson> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/idle-insights`, { method: 'POST', body });
}

/** 衣橱：穿着短评草稿 → 写入 wear_logs.note */
export async function aiWardrobeWearComment(body: {
  subject_name: string;
  subject_kind?: 'item' | 'outfit' | string;
  occasion?: string;
  weather_hint?: string;
  user_note?: string;
}): Promise<{ comment: string }> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/wear-comment`, { method: 'POST', body });
}

export type WardrobeSimilarItemJson = {
  item_id: string;
  score: number;
  reason: string;
};

export type WardrobeSimilarItemsJson = {
  similar: WardrobeSimilarItemJson[];
};

/** 衣橱：库内找相似（id ⊆ 请求） */
export async function aiWardrobeSimilarItems(body: {
  items: WardrobeAiItemSummary[];
  target_item_id?: string;
  target_description?: string;
  image_base64?: string;
  image_mime_type?: string;
  limit?: number;
}): Promise<WardrobeSimilarItemsJson> {
  return agentAiRequest(`${AI_PREFIX}/wardrobe/similar-items`, { method: 'POST', body });
}

// --- 任务 P0 ---

export type TaskAiScheduleDraft = {
  mode?: 'date' | 'time' | string;
  allDay?: boolean;
  hasExactTime?: boolean;
  date?: string;
  startTime?: string;
  endTime?: string;
  reminderOption?: string;
  repeatOption?: string;
  repeatSummary?: string;
  weeklyDays?: number[];
  monthlyDays?: number[];
  yearlyDate?: string;
};

export type TaskParseOneLinerJson = {
  title: string;
  note: string | null;
  priority: number;
  due_ymd: string | null;
  schedule: TaskAiScheduleDraft | null;
  category_hint: string | null;
  tag_hints: string[];
  reward_points: number | null;
  confidence: number;
};

export async function aiTaskParseOneLiner(body: {
  text: string;
  today_ymd?: string;
  category_names?: string[];
  tag_names?: string[];
}): Promise<TaskParseOneLinerJson> {
  return agentAiRequest(`${AI_PREFIX}/task/parse-one-liner`, { method: 'POST', body });
}

export type TaskAiTaskSummary = {
  id: string;
  title: string;
  status?: string | null;
  priority?: number | null;
  due_ymd?: string | null;
  project_id?: string | null;
  parent_id?: string | null;
  is_frog_today?: boolean | null;
  is_overdue?: boolean | null;
  tags?: string[];
  has_repeat?: boolean | null;
};

export type TaskAiHabitSummary = {
  id: string;
  name: string;
  kind?: string | null;
  today_count?: number | null;
  daily_goal?: number | null;
  streak?: number | null;
};

export type TaskAiFrogCandidateSummary = {
  id: string;
  title: string;
  kind?: string | null;
  priority?: number | null;
  due_ymd?: string | null;
  is_overdue?: boolean | null;
  already_assigned?: boolean | null;
};

export type TaskSuggestTodayJson = {
  primary_task_ids: string[];
  frog_task_id: string | null;
  habit_ids: string[];
  reason: string;
  tips: string[];
};

export async function aiTaskSuggestToday(body: {
  today_ymd?: string;
  day_boundary?: string;
  preference?: string;
  tasks: TaskAiTaskSummary[];
  frog_candidates?: TaskAiFrogCandidateSummary[];
  habits?: TaskAiHabitSummary[];
}): Promise<TaskSuggestTodayJson> {
  return agentAiRequest(`${AI_PREFIX}/task/suggest-today`, { method: 'POST', body });
}

export type TaskBreakdownSubtaskJson = {
  title: string;
  priority?: number;
  due_ymd_offset?: number;
};

export type TaskBreakdownJson = {
  mode: 'subtasks' | 'acceptance' | 'both' | string;
  subtasks: TaskBreakdownSubtaskJson[];
  acceptance_items: { text: string }[];
  reason: string | null;
};

export async function aiTaskBreakdown(body: {
  title: string;
  note?: string;
  due_ymd?: string;
  project_name?: string;
  existing_subtask_titles?: string[];
  mode?: 'subtasks' | 'acceptance' | 'both' | string;
  today_ymd?: string;
}): Promise<TaskBreakdownJson> {
  return agentAiRequest(`${AI_PREFIX}/task/breakdown`, { method: 'POST', body });
}

export type TaskParseScheduleJson = {
  ok: boolean;
  due_ymd: string | null;
  schedule: TaskAiScheduleDraft | null;
  confidence: number;
};

export async function aiTaskParseSchedule(body: {
  text: string;
  today_ymd?: string;
  due_ymd?: string;
  schedule?: TaskAiScheduleDraft | Record<string, unknown> | null;
}): Promise<TaskParseScheduleJson> {
  return agentAiRequest(`${AI_PREFIX}/task/parse-schedule`, { method: 'POST', body });
}

export type TaskParseFromImageItemJson = {
  title: string;
  priority: number;
  due_ymd: string | null;
  note: string | null;
};

export type TaskParseFromImageJson = {
  items: TaskParseFromImageItemJson[];
};

export async function aiTaskParseFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
  today_ymd?: string;
}): Promise<TaskParseFromImageJson> {
  return agentAiRequest(`${AI_PREFIX}/task/parse-from-image`, { method: 'POST', body });
}

export type TaskParseHabitReminderJson = {
  enabled: boolean;
  hour?: number;
  minute?: number;
};

export type TaskParseHabitJson = {
  name: string;
  habitKind: 'build' | 'break' | 'task' | string;
  daily_goal: number | null;
  reminder: TaskParseHabitReminderJson | null;
  reward_points: number | null;
  rationale_zh: string | null;
};

export async function aiTaskParseHabit(body: {
  text: string;
  today_ymd?: string;
}): Promise<TaskParseHabitJson> {
  return agentAiRequest(`${AI_PREFIX}/task/parse-habit`, { method: 'POST', body });
}

export type TaskOverviewInsightItemJson = {
  title: string;
  body: string;
};

export type TaskOverviewInsightsJson = {
  insights: TaskOverviewInsightItemJson[];
  suggestion: string;
  focus_task_ids: string[];
};

export async function aiTaskOverviewInsights(body: {
  insight_counts?: Record<string, number | string | null>;
  completion_counts_7d?: number;
  completion_counts_14d?: number;
  open_tasks?: TaskAiTaskSummary[];
  reopen_count?: number;
  today_ymd?: string;
}): Promise<TaskOverviewInsightsJson> {
  return agentAiRequest(`${AI_PREFIX}/task/overview-insights`, { method: 'POST', body });
}

export type TaskPlanProjectMilestoneJson = {
  title: string;
  priority?: number;
  children_titles: string[];
};

export type TaskPlanProjectJson = {
  milestones: TaskPlanProjectMilestoneJson[];
};

export async function aiTaskPlanProject(body: {
  project_name: string;
  description?: string;
  due_ymd?: string;
  existing_top_titles?: string[];
  today_ymd?: string;
}): Promise<TaskPlanProjectJson> {
  return agentAiRequest(`${AI_PREFIX}/task/plan-project`, { method: 'POST', body });
}

// --- 任务 P2 ---

export type TaskCommentJson = {
  comment: string;
};

export async function aiTaskComment(body: {
  title: string;
  note?: string;
  status?: string;
  subtask_done_ratio?: number;
  overdue_days?: number;
  today_ymd?: string;
}): Promise<TaskCommentJson> {
  return agentAiRequest(`${AI_PREFIX}/task/task-comment`, { method: 'POST', body });
}

export type TaskHabitNudgeJson = {
  tips: string[];
  habit_ids: string[];
};

export async function aiTaskHabitNudge(body: {
  today_ymd?: string;
  habits: TaskAiHabitSummary[];
  bound_task_ids?: string[];
}): Promise<TaskHabitNudgeJson> {
  return agentAiRequest(`${AI_PREFIX}/task/habit-nudge`, { method: 'POST', body });
}

export type TaskParseFilterJson = {
  ok: boolean;
  search: string;
  date_preset: 'today' | 'tomorrow' | 'week' | 'month' | 'year' | null;
  priorities: number[];
  tag_hints: string[];
  long_term: 'all' | 'yes' | 'no' | string;
  entity_scope: 'all' | 'project' | 'task' | string;
  confidence: number;
};

export async function aiTaskParseFilter(body: {
  text: string;
  today_ymd?: string;
  tag_names?: string[];
}): Promise<TaskParseFilterJson> {
  return agentAiRequest(`${AI_PREFIX}/task/parse-filter`, { method: 'POST', body });
}

// --- 我的页 P0：画像 / 周节奏 / 道路拆解 ---

export type ProfilePersonaDraftMode = 'write' | 'polish' | 'shorten';

export type ProfilePersonaDraftJson = {
  persona_portrait: string;
  keyword_hints: string[];
  confidence: number;
};

export async function aiProfilePersonaDraft(body: {
  text?: string;
  current_persona?: string;
  mode?: ProfilePersonaDraftMode;
  gender?: string;
  lifestyle?: string;
  goal?: string;
  dietary_summary?: string;
}): Promise<ProfilePersonaDraftJson> {
  return agentAiRequest(`${AI_PREFIX}/profile/persona-draft`, { method: 'POST', body });
}

export type ProfileWeekRhythmInsightItemJson = {
  title: string;
  body: string;
};

export type ProfileWeekRhythmOpenHint = 'tasks' | 'review' | 'life-road' | 'wish-board';

export type ProfileWeekRhythmInsightsJson = {
  insights: ProfileWeekRhythmInsightItemJson[];
  suggestion: string;
  open_hint: ProfileWeekRhythmOpenHint | null;
};

export async function aiProfileWeekRhythmInsights(body: {
  week?: Record<string, number | string | boolean | null>;
  road_focus_line?: string;
  wish_gap_line?: string;
  persona_one_liner?: string;
  today_ymd?: string;
}): Promise<ProfileWeekRhythmInsightsJson> {
  return agentAiRequest(`${AI_PREFIX}/profile/week-rhythm-insights`, { method: 'POST', body });
}

export type LifeRoadPlanAcceptanceItemJson = {
  text: string;
};

export type LifeRoadPlanNodeJson = {
  kind: 'year' | 'quarter' | 'month' | string;
  title: string;
  note: string | null;
  quarter: number | null;
  month: number | null;
  calendar_year?: number;
  parent_hint: number | null;
  acceptance_items: LifeRoadPlanAcceptanceItemJson[];
};

export type LifeRoadPlanFromDirectionJson = {
  year_theme: string | null;
  nodes: LifeRoadPlanNodeJson[];
};

export async function aiLifeRoadPlanFromDirection(body: {
  body: string;
  year_theme?: string;
  calendar_year?: number;
  existing_node_titles?: string[];
  preference?: string;
}): Promise<LifeRoadPlanFromDirectionJson> {
  return agentAiRequest(`${AI_PREFIX}/life-road/plan-from-direction`, { method: 'POST', body });
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
