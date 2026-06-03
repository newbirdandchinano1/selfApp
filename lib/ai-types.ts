/** AI 接口与 UI 共用类型（与 AI_API.md、后端 data 形状一致） */

export type FoodTextIntakeJson = {
  food_summary: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  sodium_mg: number;
  ai_evaluation: string;
};

export type FoodNutritionJson = {
  is_food: 0 | 1;
  non_food_code: number;
  food_name: string;
  ai_evaluation: string;
  protein_g: number;
  carbohydrate_g: number;
  sodium_mg: number;
};

export type DailyIntakeTargetsEstimateJson = {
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  sodium_mg: number;
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

export type PersonaPortraitAiData = {
  hero_kicker: string;
  hero_main: string;
  hero_caption: string;
  overview: string;
  bullets: string[];
  stats: { label: string; value: string; hint: string }[];
  milestones: string[];
  dims: { title: string; sub: string }[];
  ai_quote: string;
};

export type VisionWallAiSection = {
  title: string;
  body: string;
};

export type VisionWallAiPerGoalRow = {
  goal_id: string;
  title: string;
  feasibility_level: string;
  remain_assessment: string;
  optimization: string;
};

export type VisionWallAiAssessmentPayload = {
  feasibility_score: number;
  headline: string;
  sections: VisionWallAiSection[];
  per_goal: VisionWallAiPerGoalRow[];
  closing_summary: string;
};

export type UserSkillAiPortfolioSkillRow = {
  skill_id: string;
  evaluation: string;
  suggestions: string;
};

export type UserSkillAiPortfolioPayload = {
  per_skill: UserSkillAiPortfolioSkillRow[];
  overall_suggestions: string;
  profile_analysis: string;
};
