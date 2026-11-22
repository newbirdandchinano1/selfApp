/**
 * S9.3 W1+W3：commit_food_intake（新建/按 id 更新）/ commit_food_intake_delete /
 * commit_weight / commit_intake_targets（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function draftIntakeId(draft: Record<string, unknown>): string {
  return (
    draftString(draft, 'intake_id') ||
    draftString(draft, 'intakeId') ||
    draftString(draft, 'health_record_id') ||
    draftString(draft, 'id')
  );
}

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

  const { getResolvedGlobalIntakeTargets } = await import('@/lib/global-intake-targets');
  const { formatYmd } = await import('@/lib/date');
  const {
    createHealthRecord,
    getHealthRecordById,
    updateHealthRecord,
  } = await import('@/lib/repositories/health/health');
  const { getDefaultUser } = await import('@/lib/repositories/users/user');

  const user = await getDefaultUser();
  if (!user?.id) {
    return fail('no_user', '无法确定当前用户，请稍后重试');
  }

  const targets = getResolvedGlobalIntakeTargets();
  const recordDate = draftString(draft, 'record_date') || formatYmd(new Date());
  const existingId = draftIntakeId(draft);
  const aiComment =
    draftString(draft, 'ai_evaluation') || draftString(draft, 'ai_comment') || null;

  if (existingId) {
    const current = await getHealthRecordById(existingId);
    if (!current) {
      return fail('intake_missing', '找不到要更新的摄入记录，请改为新建或打开健康页');
    }
    await updateHealthRecord(existingId, {
      hydration,
      target_hydration: targets.hydrationMl,
      protein,
      target_protein: targets.proteinG,
      carbohydrate,
      target_carbohydrate: targets.carbohydrateG,
      calories,
      target_calories: targets.caloriesKcal,
      record_date: recordDate || current.record_date,
      intake_display_title: foodSummary.slice(0, 80),
      intake_ai_comment: aiComment,
      source_image_uri:
        draftString(draft, 'source_image_uri') || current.source_image_uri || null,
    });
    return ok(existingId, `已更新饮食「${foodSummary.slice(0, 40)}」`);
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
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
    intake_ai_comment: aiComment,
    source_image_uri: draftString(draft, 'source_image_uri') || null,
  });

  return ok(recordId, `已记录饮食「${foodSummary.slice(0, 40)}」`);
}

export async function commitFoodIntakeDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  let id = draftIntakeId(draft);
  const titleHint =
    draftString(draft, 'title') ||
    draftString(draft, 'food_summary') ||
    draftString(draft, 'food_name');

  const { getDefaultUser } = await import('@/lib/repositories/users/user');
  const {
    deleteHealthRecord,
    getHealthRecordById,
    getHealthRecordsByUserId,
    getHealthRecordsForUserOnDate,
  } = await import('@/lib/repositories/health/health');
  const { formatYmd } = await import('@/lib/date');

  const user = await getDefaultUser();
  if (!user?.id) {
    return fail('no_user', '无法确定当前用户，请稍后重试');
  }

  let label = titleHint || '摄入记录';
  if (id) {
    const row = await getHealthRecordById(id);
    if (row) label = row.intake_display_title?.trim() || label;
    else id = '';
  }

  if (!id && titleHint) {
    const day =
      draftString(draft, 'record_date') ||
      draftString(draft, 'day_ymd') ||
      formatYmd(new Date());
    const dayRows = await getHealthRecordsForUserOnDate(user.id, day.slice(0, 10));
    const needle = titleHint.toLowerCase();
    const hit =
      dayRows.find(r => (r.intake_display_title || '').trim().toLowerCase() === needle) ||
      dayRows.find(r => (r.intake_display_title || '').toLowerCase().includes(needle));
    if (hit) {
      id = hit.id;
      label = hit.intake_display_title?.trim() || label;
    } else {
      const all = await getHealthRecordsByUserId(user.id);
      const soft =
        all.find(r => (r.intake_display_title || '').trim().toLowerCase() === needle) ||
        all.find(r => (r.intake_display_title || '').toLowerCase().includes(needle));
      if (soft) {
        id = soft.id;
        label = soft.intake_display_title?.trim() || label;
      }
    }
  }

  if (!id) {
    return fail('incomplete_draft', '请指定要删除的摄入（id 或标题）');
  }

  await deleteHealthRecord(id);
  await requestPushPending();
  return ok(id, `已删除饮食「${label.slice(0, 40)}」`);
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
  const { getDefaultUser, updateDefaultUser } = await import('@/lib/repositories/users/user');
  const { requestPushPending } = await import('./shared');
  const ymd =
    draftString(draft, 'ymd') ||
    draftString(draft, 'record_date') ||
    draftString(draft, 'recorded_ymd') ||
    formatYmd(new Date());
  await upsertWeightLog(ymd, kg);
  const user = await getDefaultUser();
  if (user) {
    await updateDefaultUser({
      name: user.name,
      persona_portrait: user.persona_portrait,
      gender: user.gender,
      lifestyle: user.lifestyle,
      goal: user.goal,
      workout_days: user.workout_days ?? '[]',
      birthday: user.birthday,
      height: user.height,
      weight: kg,
    });
  }
  await requestPushPending();
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
    getResolvedGlobalIntakeTargets,
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

  // 同步云端：全局键 + 今日 health_daily_targets，供 Agent snapshot / metrics 对齐
  try {
    const { apiRequest } = await import('@/lib/api/http');
    const { APP_API_PREFIX } = await import('@/lib/api-app-domain');
    const { formatYmd } = await import('@/lib/date');
    const resolved = getResolvedGlobalIntakeTargets();
    const dayYmd =
      draftString(draft, 'date') ||
      draftString(draft, 'day_ymd') ||
      draftString(draft, 'record_date') ||
      formatYmd(new Date());
    await apiRequest(`${APP_API_PREFIX}/health/targets`, {
      method: 'PUT',
      body: {
        date: dayYmd,
        hydration_ml: resolved.hydrationMl,
        protein_g: resolved.proteinG,
        carbohydrate_g: resolved.carbohydrateG,
        calories_kcal: resolved.caloriesKcal,
        source: 'manual',
      },
      skipGlobalLoading: true,
    });
  } catch {
    // 离线时仅本地全局目标生效；联网后可由设置同步补齐
  }

  return ok('intake_targets', `已更新摄入目标：${parts.join(' · ')}`);
}

export const foodCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_food_intake: async input => commitFoodIntake(input.draft),
  commit_food_intake_delete: async input => commitFoodIntakeDelete(input.draft),
  commit_weight: async input => commitWeight(input.draft),
  commit_intake_targets: async input => commitIntakeTargets(input.draft),
};
