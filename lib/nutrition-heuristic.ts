import type { UserDayScheduleKind } from '@/lib/user-workout-schedule';

export type NutritionV2ActivityLevel = 'Sedentary' | 'Fitness' | 'High-Intensity';
export type NutritionV2Goal = 'None' | 'Fat Loss' | 'Muscle Gain';
export type NutritionV2Gender = 'Male' | 'Female';

export type NutritionV2Metrics = {
  Water_ml: number;
  Protein_g: number;
  Carbohydrate_g: number;
  Calories_kcal: number;
};

/** 1 斤脂肪约 3850 kcal（0.5 kg × 7700 kcal/kg） */
export const KCAL_PER_JIN = 3850;

export function calcCalorieDeficit(budgetKcal: number, consumedKcal: number): number {
  return Math.round(budgetKcal - consumedKcal);
}

export function estimateWeightLossJinFromDeficit(deficitKcal: number): number {
  if (deficitKcal <= 0) return 0;
  return Math.round((deficitKcal / KCAL_PER_JIN) * 100) / 100;
}

/** 在基础公式目标上按今日健身日/休息日微调（仅健身/高强度档案生效） */
export function adjustNutritionMetricsForDaySchedule(
  metrics: NutritionV2Metrics,
  kind: UserDayScheduleKind,
): NutritionV2Metrics {
  if (kind === 'sedentary') return metrics;
  if (kind === 'workout') {
    return {
      Water_ml: Math.round(metrics.Water_ml * 1.08),
      Protein_g: Math.round(metrics.Protein_g * 1.12),
      Carbohydrate_g: Math.round(metrics.Carbohydrate_g * 1.1),
      Calories_kcal: Math.round(metrics.Calories_kcal * 1.08),
    };
  }
  return {
    Water_ml: Math.round(metrics.Water_ml * 0.98),
    Protein_g: Math.round(metrics.Protein_g * 0.92),
    Carbohydrate_g: Math.round(metrics.Carbohydrate_g * 0.88),
    Calories_kcal: Math.round(metrics.Calories_kcal * 0.92),
  };
}

export function mapLifestyleToActivityLevel(lifestyle?: string | null): NutritionV2ActivityLevel {
  if (lifestyle === '健身') return 'Fitness';
  if (lifestyle === '高强度锻炼') return 'High-Intensity';
  return 'Sedentary';
}

export function mapGoalToNutritionGoal(goal?: string | null): NutritionV2Goal {
  if (goal === '减脂') return 'Fat Loss';
  if (goal === '增肌') return 'Muscle Gain';
  return 'None';
}

export function mapGenderToNutritionGender(gender?: string | null): NutritionV2Gender {
  return gender === '男' ? 'Male' : 'Female';
}

function activityMultiplier(activityLevel: NutritionV2ActivityLevel): number {
  if (activityLevel === 'Fitness') return 1.55;
  if (activityLevel === 'High-Intensity') return 1.725;
  return 1.2;
}

export function calculateNutritionV2(
  weight: number,
  height: number,
  age: number,
  gender: NutritionV2Gender,
  activityLevel: NutritionV2ActivityLevel,
  goal: NutritionV2Goal,
  actualCalories: number,
) {
  void actualCalories;
  const PROTEIN_MULTIPLIER_CAP = 1.8;
  const PROTEIN_GRAMS_CAP = 130;
  const WATER_ML_CAP = 4000;
  const CALORIES_KCAL_CAP = 4500;
  const CARBOHYDRATE_G_CAP = 420;

  let proteinMultiplier = 1.0;
  if (activityLevel === 'Fitness') proteinMultiplier = 1.5;
  if (activityLevel === 'High-Intensity') proteinMultiplier = 2.0;

  if (age >= 65) proteinMultiplier += 0.2;
  if (goal === 'Fat Loss') proteinMultiplier += 0.2;
  if (goal === 'Muscle Gain') proteinMultiplier += 0.3;
  proteinMultiplier = Math.min(proteinMultiplier, PROTEIN_MULTIPLIER_CAP);

  const totalProteinG = Math.min(weight * proteinMultiplier, PROTEIN_GRAMS_CAP);
  let carbohydrateMultiplier = 3.2;
  if (activityLevel === 'Fitness') carbohydrateMultiplier = 4.0;
  if (activityLevel === 'High-Intensity') carbohydrateMultiplier = 4.8;
  if (goal === 'Fat Loss') carbohydrateMultiplier -= 0.35;
  if (goal === 'Muscle Gain') carbohydrateMultiplier += 0.4;
  carbohydrateMultiplier = Math.max(2.2, carbohydrateMultiplier);
  const totalCarbohydrateG = Math.min(weight * carbohydrateMultiplier, CARBOHYDRATE_G_CAP);

  const safeWeight = Math.max(weight, 40);
  const safeHeight = Math.max(height, 140);
  const safeAge = Math.max(age, 18);
  let bmr = 10 * safeWeight + 6.25 * safeHeight - 5 * safeAge;
  bmr += gender === 'Male' ? 5 : -161;
  let tdee = bmr * activityMultiplier(activityLevel);
  if (goal === 'Fat Loss') tdee *= 0.85;
  if (goal === 'Muscle Gain') tdee *= 1.1;
  const totalCaloriesKcal = Math.min(Math.max(Math.round(tdee), 1200), CALORIES_KCAL_CAP);

  const waterMultiplier = age < 30 ? 35 : age <= 55 ? 30 : 25;
  let totalWaterMl = weight * waterMultiplier;
  if (activityLevel === 'Fitness') totalWaterMl += 300;
  if (activityLevel === 'High-Intensity') totalWaterMl += 600;
  if (goal === 'Fat Loss') totalWaterMl += 300;
  if (goal === 'Muscle Gain') totalWaterMl += 200;
  totalWaterMl = Math.min(totalWaterMl, WATER_ML_CAP);

  return {
    Water_ml: Math.round(totalWaterMl),
    Protein_g: Math.round(totalProteinG),
    Carbohydrate_g: Math.round(totalCarbohydrateG),
    Calories_kcal: totalCaloriesKcal,
  } satisfies NutritionV2Metrics;
}
