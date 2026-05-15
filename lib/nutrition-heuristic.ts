export type NutritionV2ActivityLevel = 'Sedentary' | 'Fitness' | 'High-Intensity';
export type NutritionV2Goal = 'None' | 'Fat Loss' | 'Muscle Gain';
export type NutritionV2Gender = 'Male' | 'Female';

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

export function calculateNutritionV2(
  weight: number,
  height: number,
  age: number,
  gender: NutritionV2Gender,
  activityLevel: NutritionV2ActivityLevel,
  goal: NutritionV2Goal,
  actualSodium: number
) {
  void height;
  const PROTEIN_MULTIPLIER_CAP = 1.8;
  const PROTEIN_GRAMS_CAP = 130;
  const WATER_ML_CAP = 4000;
  const SODIUM_MG_CAP = 2500;
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

  const baseSodium = 1500;
  let sodiumActivityBonus = activityLevel === 'Sedentary' ? 0 : activityLevel === 'Fitness' ? 500 : 1000;
  if (activityLevel === 'High-Intensity' && gender === 'Male') {
    sodiumActivityBonus += 200;
  }
  const sodiumGoalBonus = goal === 'Muscle Gain' ? 200 : 0;
  const totalSodiumMg = Math.min(baseSodium + sodiumActivityBonus + sodiumGoalBonus, SODIUM_MG_CAP);

  const waterMultiplier = age < 30 ? 35 : age <= 55 ? 30 : 25;
  let totalWaterMl = weight * waterMultiplier;
  if (activityLevel === 'Fitness') totalWaterMl += 300;
  if (activityLevel === 'High-Intensity') totalWaterMl += 600;
  if (goal === 'Fat Loss') totalWaterMl += 300;
  if (goal === 'Muscle Gain') totalWaterMl += 200;
  if (actualSodium > totalSodiumMg) {
    const excessSodium = actualSodium - totalSodiumMg;
    totalWaterMl += excessSodium * 0.282;
  }
  totalWaterMl = Math.min(totalWaterMl, WATER_ML_CAP);

  return {
    Water_ml: Math.round(totalWaterMl),
    Protein_g: Math.round(totalProteinG),
    Carbohydrate_g: Math.round(totalCarbohydrateG),
    Sodium_mg: Math.round(totalSodiumMg),
  };
}
