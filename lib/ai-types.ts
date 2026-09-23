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
