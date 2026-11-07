/**
 * S9.3 W1+W3：commit_food_intake / commit_weight / commit_intake_targets（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok } from './shared';

export async function commitFoodIntake(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const foodSummary =
    draftString(draft, 'food_summary') ||
    draftString(draft, 'food_name') ||
    draftString(draft, 'title') ||
    '饮食';

  const hydration = Math.max(0, draftNumber(draft, 'hydration_ml') ?? 0);
  const protein = Math.max(0, draftNumber(draft, 'protein_g') ?? 0);
  const carbohydrate = Math.max(0, draftNumber(draft, 'carbohydrate_g') ?? 0);
  const calories = Math.max(0, draftNumber(draft, 'calories_kcal') ?? 0);

  if (hydration + protein + carbohydrate + calories <= 0) {
    return fail('incomplete_draft', '请至少填写一项摄入量（水分/蛋白/碳水/热量）');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { getResolvedGlobalIntakeTargets } = await import('@/lib/global-intake-targets');
  const { formatYmd } = await import('@/lib/date');
  const { createHealthRecord } = await import('@/lib/repositories/health/health');
  const { getDefaultUser } = await import('@/lib/repositories/users/user');

  const user = await getDefaultUser();
  if (!user?.id) {
    return fail('no_user', '无法确定当前用户，请稍后重试');
  }

  const targets = getResolvedGlobalIntakeTargets();
  const recordDate = draftString(draft, 'record_date') || formatYmd(new Date());
  const recordId = makeTimestampEntityId('hr_', 8);

  await createHealthRecord({
    id: recordId,
    user_id: user.id,
    hydration,
    target_hydration: targets.hydrationMl,
    protein,
    target_protein: targets.proteinG,
    carbohydrate,
    target_carbohydrate: targets.carbohydrateG,
    calories,
    target_calories: targets.caloriesKcal,
    record_date: recordDate,
    intake_display_title: foodSummary.slice(0, 80),
    intake_ai_comment:
      draftString(draft, 'ai_evaluation') || draftString(draft, 'ai_comment') || null,
    source_image_uri: draftString(draft, 'source_image_uri') || null,
  });

  return ok(recordId, `已记录饮食「${foodSummary.slice(0, 40)}」`);
}

export async function commitWeight(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const kg =
    draftNumber(draft, 'weight_kg') ??
    draftNumber(draft, 'weight') ??
    draftNumber(draft, 'kg');
  if (kg == null || kg <= 0) {
    return fail('incomplete_draft', '缺少有效体重（kg）');
  }

  const { formatYmd } = await import('@/lib/date');
  const { upsertWeightLog } = await import('@/lib/repositories/health/weight-log');
  const ymd =
    draftString(draft, 'ymd') ||
    draftString(draft, 'record_date') ||
    draftString(draft, 'recorded_ymd') ||
    formatYmd(new Date());
  await upsertWeightLog(ymd, kg);
  return ok(`${ymd}:${kg}`, `已记录体重 ${kg} kg（${ymd}）`);
}

export async function commitIntakeTargets(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const hydration = draftNumber(draft, 'hydration_ml') ?? draftNumber(draft, 'hydrationMl');
  const protein = draftNumber(draft, 'protein_g') ?? draftNumber(draft, 'proteinG');
  const carb =
    draftNumber(draft, 'carbohydrate_g') ?? draftNumber(draft, 'carbohydrateG');
  const calories =
    draftNumber(draft, 'calories_kcal') ??
    draftNumber(draft, 'calories') ??
    draftNumber(draft, 'caloriesKcal');

  if (
    (hydration == null || hydration < 0) &&
    (protein == null || protein < 0) &&
    (carb == null || carb < 0) &&
    (calories == null || calories < 0)
  ) {
    return fail('incomplete_draft', '请至少提供一个有效的摄入目标');
  }

  const {
    setGlobalHydrationTargetMl,
    setGlobalProteinTargetG,
    setGlobalCarbohydrateTargetG,
    setGlobalCaloriesTargetKcal,
  } = await import('@/lib/global-intake-targets');

  const parts: string[] = [];
  if (hydration != null && hydration >= 0) {
    setGlobalHydrationTargetMl(hydration);
    parts.push(`饮水 ${hydration}ml`);
  }
  if (protein != null && protein >= 0) {
    setGlobalProteinTargetG(protein);
    parts.push(`蛋白 ${protein}g`);
  }
  if (carb != null && carb >= 0) {
    setGlobalCarbohydrateTargetG(carb);
    parts.push(`碳水 ${carb}g`);
  }
  if (calories != null && calories >= 0) {
    setGlobalCaloriesTargetKcal(calories);
    parts.push(`热量 ${calories}kcal`);
  }

  return ok('intake_targets', `已更新摄入目标：${parts.join(' · ')}`);
}

export const foodCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_food_intake: async input => commitFoodIntake(input.draft),
  commit_weight: async input => commitWeight(input.draft),
  commit_intake_targets: async input => commitIntakeTargets(input.draft),
};
