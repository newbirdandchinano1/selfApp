/**
 * S9.3 W2：commit_profile（动态 import；合并现有用户行后 updateDefaultUser）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

export async function commitProfile(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const persona =
    draftString(draft, 'persona_portrait') ||
    draftString(draft, 'persona') ||
    draftString(draft, 'text') ||
    draftString(draft, 'prefill_text');
  const name = draftString(draft, 'name');
  const gender = draftString(draft, 'gender');
  const lifestyle = draftString(draft, 'lifestyle');
  const goal = draftString(draft, 'goal');
  const birthday = draftString(draft, 'birthday');
  const height = draftNumber(draft, 'height');
  const weight = draftNumber(draft, 'weight');

  const workoutDaysRaw =
    draft.workout_days ?? draft.workoutDays ?? draft.fitness_days ?? draft.days;
  const hasWorkoutDays = Array.isArray(workoutDaysRaw) || typeof workoutDaysRaw === 'string';
  const hasDietary =
    draft.dietary != null ||
    draft.dietary_prefs != null ||
    draft.tags != null ||
    draft.allergies != null ||
    draft.avoidFoods != null ||
    draft.notes != null;

  if (
    !persona &&
    !name &&
    !gender &&
    !lifestyle &&
    !goal &&
    !birthday &&
    height == null &&
    weight == null &&
    !hasWorkoutDays &&
    !hasDietary
  ) {
    return fail('incomplete_draft', '画像/资料草稿为空，请补充后再确认');
  }

  const { getDefaultUser, updateDefaultUser } = await import('@/lib/repositories/users/user');
  const { isFitnessLifestyle, parseUserWeekDaysJson, USER_WEEK_DAYS } = await import(
    '@/lib/user-workout-schedule'
  );

  const current = await getDefaultUser();
  if (!current) {
    return fail('no_user', '无法读取当前用户资料，请稍后重试');
  }

  const nextLifestyle = lifestyle || current.lifestyle || '长期静坐不运动';
  let nextWorkoutDays = parseUserWeekDaysJson(current.workout_days);
  if (hasWorkoutDays) {
    const list = Array.isArray(workoutDaysRaw)
      ? workoutDaysRaw
      : (() => {
          try {
            const parsed = JSON.parse(String(workoutDaysRaw));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return String(workoutDaysRaw)
              .split(/[,，、\s]+/)
              .map((s) => s.trim())
              .filter(Boolean);
          }
        })();
    nextWorkoutDays = USER_WEEK_DAYS.filter((d) => list.includes(d));
  }
  if (!isFitnessLifestyle(nextLifestyle)) {
    nextWorkoutDays = [];
  }

  await updateDefaultUser({
    name: name || current.name || '',
    persona_portrait: persona
      ? persona.slice(0, 500)
      : current.persona_portrait ?? null,
    gender: gender || current.gender || '男',
    lifestyle: nextLifestyle,
    goal: goal || current.goal || '无',
    workout_days: JSON.stringify(nextWorkoutDays),
    birthday: birthday || current.birthday,
    height: height ?? current.height ?? 0,
    weight: weight ?? current.weight ?? 0,
  });

  if (hasDietary) {
    const { loadDietaryPrefs, normalizeDietaryPrefs, saveDietaryPrefs } = await import(
      '@/lib/dietary-prefs'
    );
    const currentDietary = await loadDietaryPrefs();
    const dietarySrc =
      (draft.dietary as Record<string, unknown> | undefined) ??
      (draft.dietary_prefs as Record<string, unknown> | undefined) ??
      draft;
    const merged = normalizeDietaryPrefs({
      ...currentDietary,
      ...dietarySrc,
      tags: Array.isArray(dietarySrc.tags)
        ? dietarySrc.tags
        : Array.isArray(draft.tags)
          ? draft.tags
          : currentDietary.tags,
      allergies:
        typeof dietarySrc.allergies === 'string'
          ? dietarySrc.allergies
          : typeof draft.allergies === 'string'
            ? draft.allergies
            : currentDietary.allergies,
      avoidFoods:
        typeof dietarySrc.avoidFoods === 'string'
          ? dietarySrc.avoidFoods
          : typeof draft.avoid_foods === 'string'
            ? draft.avoid_foods
            : currentDietary.avoidFoods,
      notes:
        typeof dietarySrc.notes === 'string'
          ? dietarySrc.notes
          : typeof draft.notes === 'string'
            ? draft.notes
            : currentDietary.notes,
    });
    await saveDietaryPrefs(merged);
  }

  await requestPushPending();

  const summary = persona
    ? `已保存人物画像（${persona.slice(0, 24)}${persona.length > 24 ? '…' : ''}）`
    : hasWorkoutDays
      ? `已更新健身日（${nextWorkoutDays.join('、') || '已清空'}）`
      : hasDietary
        ? '已更新饮食偏好'
        : name
          ? `已更新资料「${name.slice(0, 40)}」`
          : '已更新个人资料';
  return ok(current.id || 'default', summary);
}

export const profileCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_profile: async input => commitProfile(input.draft),
};
