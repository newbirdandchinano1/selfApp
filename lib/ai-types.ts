/** AI 接口与 UI 共用类型（与 AI_API.md、后端 data 形状一致） */

export type FoodTextIntakeJson = {
  food_summary: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  ai_evaluation: string;
};

export type FoodNutritionJson = {
  is_food: 0 | 1;
  non_food_code: number;
  food_name: string;
  ai_evaluation: string;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  /** 汤/粥/饮料等可饮水；旧端可忽略，默认 0 */
  hydration_ml: number;
};

export type FoodWeeklyInsightItem = {
  title: string;
  body: string;
  metric_hint?: string;
};

export type FoodWeeklyInsightsJson = {
  score?: number;
  insights: FoodWeeklyInsightItem[];
  suggestion: string;
  tags?: string[];
};

export type FoodSuggestNextMealDraft = {
  food_summary: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  ai_evaluation: string;
};

export type FoodSuggestNextMealJson = {
  tips: string[];
  quick_add_keys: string[];
  recipe_ids: string[];
  draft_intake?: FoodSuggestNextMealDraft | null;
};

/** 一图拆多条中的单条草稿 */
export type FoodNutritionSplitItem = {
  food_name: string;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  hydration_ml: number;
  ai_evaluation: string;
};

export type FoodNutritionSplitJson = {
  is_food: 0 | 1;
  non_food_code: number;
  items: FoodNutritionSplitItem[];
};

/** 份量修正草稿（与文字记饮食形状对齐） */
export type FoodAdjustIntakeJson = {
  food_summary: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  ai_evaluation: string;
};

export type FoodDailyWrapupJson = {
  title: string;
  body: string;
};

/** 体重趋势短评（只读；非医疗） */
export type FoodWeightCommentJson = {
  comment: string;
  caution?: string;
};

/** 包装营养标签识图草稿 */
export type FoodNutritionLabelJson = {
  is_label: 0 | 1;
  non_label_code: number;
  product_name: string;
  /** 标签数字基准 */
  basis: 'per_100g' | 'per_serving';
  serving_size_g: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  hydration_ml: number;
  ai_evaluation: string;
};

export type FoodIntakeCommentJson = {
  ai_evaluation: string;
};

export type DailyIntakeTargetsEstimateJson = {
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  rationale_zh?: string;
};

export type AiFinanceDashboardInsight = { title: string; body: string };

export type AiFinanceDashboardPayload = {
  health_score: number;
  health_summary: string;
  insights: [AiFinanceDashboardInsight, AiFinanceDashboardInsight];
  expense_breakdown_comment: string;
  savings_forecast_12: number[];
  income_forecast_12: number[];
  surplus_forecast_12: number[];
};

/** 预算周期建议（Agent `finance/budget-suggest`；确认后由 App 写设置） */
export type FinanceBudgetSuggestJson = {
  suggested_base_amount: number;
  rationale_zh: string;
  daily_cap_hint?: number | null;
  cut_tips?: string[];
};

export type FinanceSavingsGoalAdjustKind =
  | 'extend_days'
  | 'lower_target'
  | 'raise_daily'
  | 'other';

export type FinanceSavingsGoalAdjustOption = {
  kind: FinanceSavingsGoalAdjustKind;
  label: string;
  days?: number;
  amount?: number;
};

/** 储蓄目标教练（Agent `finance/savings-goal-coach`；只读） */
export type FinanceSavingsGoalCoachJson = {
  feasible: boolean;
  pace_comment: string;
  adjust_options?: FinanceSavingsGoalAdjustOption[];
};

export type FinanceSimulateRiskLevel = 'low' | 'medium' | 'high';

/** 决策模拟建议（Agent `finance/simulate-advice`；失败回退规则文案） */
export type FinanceSimulateAdviceJson = {
  advice: string;
  risk_level?: FinanceSimulateRiskLevel | null;
};

/** 一句话转账草稿（Agent `finance/parse-transfer`） */
export type FinanceParseTransferJson = {
  amount: number;
  name: string;
  from_account_hint: string | null;
  to_account_hint: string | null;
  fee_amount?: number | null;
};

export type FinanceMultiItemJson = {
  is_bill?: boolean;
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  category_label: string | null;
  payment_account_label?: string | null;
  account_name?: string | null;
  happened_at?: string | null;
};

/** 一图拆多笔（Agent `finance/parse-multi-from-image`） */
export type FinanceParseMultiFromImageJson = {
  items: FinanceMultiItemJson[];
};

export type FinanceScheduledRepeatHint = 'daily' | 'weekly' | 'monthly';

/** 定时支出草稿（Agent `finance/parse-scheduled-expense`） */
export type FinanceParseScheduledExpenseJson = {
  name: string;
  amount: number;
  repeat_hint: FinanceScheduledRepeatHint;
  days: number[];
  hour: number;
  minute: number;
  account_hint: string | null;
  category_hint: string | null;
  include_in_budget: boolean;
};

/** 分类纠偏（Agent `finance/suggest-category`） */
export type FinanceSuggestCategoryJson = {
  category_label: string;
  confidence: number;
  reason: string;
};

/** 异常消费提示（Agent `finance/anomaly-hints`；只读） */
export type FinanceAnomalyHintItem = {
  txn_ids: string[];
  title: string;
  body: string;
};

export type FinanceAnomalyHintsJson = {
  hints: FinanceAnomalyHintItem[];
};

/** 日终/周财务收口（Agent `finance/daily-wrapup`；失败回退规则文案） */
export type FinanceDailyWrapupJson = {
  title: string;
  body: string;
};

export type FinanceDailyWrapupPeriod = 'daily' | 'weekly';

export type FinanceCashFlowEntryKind =
  | 'income'
  | 'necessary'
  | 'unnecessary'
  | 'asset'
  | 'liability';

export type FinanceCashFlowQuadrant = 'E' | 'S' | 'B' | 'I';

/** 现金流记一笔自然语言草稿（Agent `finance/parse-cash-flow-entry`） */
export type FinanceParseCashFlowEntryJson = {
  entry_kind: FinanceCashFlowEntryKind;
  amount: number;
  name_hint: string;
  quadrant?: FinanceCashFlowQuadrant | null;
  asset_return?: number | null;
  liability_months?: number | null;
};

/** 备忘点评结构化增量（Agent `memo/review`；旧端可忽略） */
export type MemoSuggestedAction = 'todo' | 'project' | 'keep' | 'archive';

export type MemoReviewJson = {
  evaluation: string;
  suggestions: string;
  bullets?: string[];
  suggested_action?: MemoSuggestedAction;
  draft_title?: string;
};

/** 备忘 → 开放项目/待办关联建议（Agent `memo/link-suggest`） */
export type MemoLinkSuggestJson = {
  project_ids: string[];
  task_ids: string[];
  reasons: Record<string, string>;
  create_todo_draft?: { title: string; note: string } | null;
};

/** 备忘 → 待办/项目结构化草稿（Agent `memo/convert-draft`） */
export type MemoConvertTarget = 'todo' | 'project' | 'auto';

export type MemoConvertTodoDraft = {
  title: string;
  note: string;
  priority: number;
  due_hint?: string;
};

export type MemoConvertProjectDraft = {
  name: string;
  note: string;
};

export type MemoConvertDraftJson = {
  mode: 'todo' | 'project' | 'split_todos';
  todo?: MemoConvertTodoDraft;
  project?: MemoConvertProjectDraft;
  split_todos?: MemoConvertTodoDraft[];
  rationale: string;
};

/** 备忘 → 标签建议（Agent `memo/suggest-tags`） */
export type MemoSuggestTagsJson = {
  tag_ids: string[];
  new_tag_names: string[];
};

/** 一句话 → 备忘草稿（Agent `memo/draft-from-text`） */
export type MemoDraftStyle = 'brief' | 'checklist' | 'meeting';

export type MemoDraftFromTextJson = {
  title: string;
  body_plain: string;
  tag_name_hints: string[];
};

/** 图 → 备忘草稿（Agent `memo/draft-from-image`） */
export type MemoDraftFromImageJson = {
  title: string;
  body_plain: string;
  confidence: number;
  reject_reason?: string;
};

/** 备忘改写（Agent `memo/rewrite`） */
export type MemoRewriteMode = 'polish' | 'shorten' | 'checklist' | 'fill_gaps';

export type MemoRewriteJson = {
  title?: string;
  body_plain: string;
  change_summary: string;
};

/** 去重 / 洞察共用摘要行 */
export type MemoAiSummaryItem = {
  id: string;
  title_preview: string;
  tag_names?: string[];
  updated_at?: string;
  body_preview?: string;
};

export type MemoDedupeSimilarItem = {
  memo_id: string;
  score: number;
  reason: string;
};

export type MemoDedupeHintsJson = {
  similar: MemoDedupeSimilarItem[];
};

export type MemoCollectionInsightsJson = {
  themes: string[];
  open_loops: string[];
  tips: string[];
  memo_ids: string[];
};

/** 一句话 → 心愿草稿（Agent `wish-board/draft-from-text`） */
export type WishBoardDraftFromTextJson = {
  title: string;
  description_text: string;
  icon_key: string;
  wish_type: 'once' | 'repeat';
  cost_points: number;
  cost_reason: string;
  confidence: number;
};

/** 建议积分定价（Agent `wish-board/suggest-cost`） */
export type WishBoardIncentiveStrength = 'soft' | 'normal' | 'strong';

export type WishBoardSuggestCostJson = {
  cost_points: number;
  range: { min: number; max: number };
  reason: string;
  /** repeat 节奏建议文案；不自动写入 available_from */
  available_from_hint?: string | null;
};

/** 缺口解锁文案（Agent `wish-board/coach-unlock`；一期 App 也可纯模板） */
export type WishBoardCoachUnlockStep = {
  text: string;
  action_kind: string;
  action_id?: string | null;
};

export type WishBoardCoachUnlockJson = {
  headline: string;
  steps: WishBoardCoachUnlockStep[];
};

export type WishBoardAiCandidate = {
  id: string;
  title: string;
  progress_hint?: string;
  eligible?: boolean;
};

export type WishBoardSuggestConditionsJson = {
  redeem_conditions: {
    project_ids: string[];
    task_ids: string[];
    todo_ids: string[];
    habit_ids: string[];
    min_net_worth: number | null;
    available_from: string | null;
  };
  reason: string;
};

/** 图 → 心愿草稿（同 draft-from-text 字段） */
export type WishBoardDraftFromImageJson = WishBoardDraftFromTextJson;

export type WishBoardSuggestNextCandidate = {
  title: string;
  cost_points: number;
  icon_key: string;
  wish_type: 'once' | 'repeat';
  reason: string;
};

export type WishBoardSuggestNextJson = {
  candidates: WishBoardSuggestNextCandidate[];
};

/** 积分与心愿健康度（Agent `wish-board/insights`；只读） */
export type WishBoardInsightsJson = {
  tips: string[];
};

export type WishBoardAiSummaryItem = {
  title: string;
  cost_points?: number;
  wish_type?: string;
  status?: string;
  icon_key?: string;
};
