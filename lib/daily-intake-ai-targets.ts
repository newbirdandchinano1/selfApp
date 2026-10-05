import { AppSettingKey, getAppSettingRaw, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';
import {
  formatDietaryPrefsForAi,
  loadDietaryPrefs,
  type DietaryPrefs,
} from '@/lib/dietary-prefs';

import {
  adjustNutritionMetricsForDaySchedule,
  calculateNutritionV2,
  mapGenderToNutritionGender,
  mapGoalToNutritionGoal,
  mapLifestyleToActivityLevel,
} from '@/lib/nutrition-heuristic';
import {
  formatUserWorkoutWeekPlanZh,
  getChineseWeekdayLabelFromYmd,
  getUserDayScheduleKind,
  getUserDayScheduleLabelZh,
} from '@/lib/user-workout-schedule';
import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { estimateDailyIntakeTargetsFromContext, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

export type DailyAiIntakeTargetsRow = {
  dateYmd: string;
  userId: string;
  profileFingerprint: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  rationale_zh: string | null;
};

function buildProfileFingerprint(user: UserRow, todayYmd: string, dietary: DietaryPrefs): string {
  return JSON.stringify({
    id: user.id,
    gender: user.gender,
    lifestyle: user.lifestyle,
    goal: user.goal,
    workout_days: user.workout_days,
    rest_days: user.rest_days,
    todayDaySchedule: getUserDayScheduleKind(user, todayYmd),
    height: user.height,
    weight: user.weight,
    birthday: user.birthday,
    age: user.age,
    updated_at: user.updated_at,
    dietary,
  });
}

function aggregateIntakeByDate(records: HealthRecordRow[]): Map<string, { h: number; p: number; c: number; k: number }> {
  const map = new Map<string, { h: number; p: number; c: number; k: number }>();
  for (const r of records) {
    const key = r.record_date;
    const cur = map.get(key) ?? { h: 0, p: 0, c: 0, k: 0 };
    cur.h += Number(r.hydration) || 0;
    cur.p += Number(r.protein) || 0;
    cur.c += Number(r.carbohydrate) || 0;
    cur.k += Number(r.calories) || 0;
    map.set(key, cur);
  }
  return map;
}

function parseLocalYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function buildSevenDayDigest(records: HealthRecordRow[], endYmd: string): string {
  const byDate = aggregateIntakeByDate(records);
  const lines: string[] = [];
  const end = parseLocalYmd(endYmd);
  if (Number.isNaN(end.getTime())) {
    for (const [d, v] of [...byDate.entries()].sort()) {
      lines.push(
        `${d}??? ${Math.round(v.h)} ml???? ${Math.round(v.p)} g??? ${Math.round(v.c)} g??? ${Math.round(v.k)} kcal`,
      );
    }
    return lines.length ? lines.join('\n') : '?7????';
  }
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${day}`;
    const v = byDate.get(ymd) ?? { h: 0, p: 0, c: 0, k: 0 };
    lines.push(
      `${ymd}??? ${Math.round(v.h)} ml???? ${Math.round(v.p)} g??? ${Math.round(v.c)} g??? ${Math.round(v.k)} kcal`,
    );
  }
  return lines.join('\n');
}

function buildContextBlock(params: {
  user: UserRow;
  todayYmd: string;
  records: HealthRecordRow[];
  dietary: DietaryPrefs;
}): string {
  const { user, todayYmd, records, dietary } = params;
  const activity = mapLifestyleToActivityLevel(user.lifestyle);
  const g = mapGoalToNutritionGoal(user.goal);
  const gender = mapGenderToNutritionGender(user.gender);
  const w = Number(user.weight) || 0;
  const h = Number(user.height) || 0;
  const age = Number(user.age) || 0;
  const recentCalories = aggregateIntakeByDate(records).get(todayYmd)?.k ?? 0;
  const baseHeuristic = calculateNutritionV2(w, h, age, gender, activity, g, recentCalories);
  const daySchedule = getUserDayScheduleKind(user, todayYmd);
  const heuristic = adjustNutritionMetricsForDaySchedule(baseHeuristic, daySchedule);
  const weekdayLabel = getChineseWeekdayLabelFromYmd(todayYmd);
  const scheduleLine =
    daySchedule === 'sedentary'
      ? '???????????????/??????'
      : `??????${weekdayLabel ?? todayYmd} ?${getUserDayScheduleLabelZh(daySchedule)}?????${formatUserWorkoutWeekPlanZh(user)}???????????????????????????????????????????????????????????????????????`;
  const dietaryLine = formatDietaryPrefsForAi(dietary);

  return [
    `??????${todayYmd}`,
    `?????????${user.name ?? '??'}????${user.gender}????${user.birthday ?? '??'}???(??)?${age}??? cm?${h}??? kg?${w}??????${user.lifestyle}????${user.goal}`,
    scheduleLine,
    dietaryLine
      ? `?????????${dietaryLine}??????????????????????????`
      : null,
    `??????????????${getUserDayScheduleLabelZh(daySchedule)}?????????????? ${heuristic.Water_ml} ml???? ${heuristic.Protein_g} g??? ${heuristic.Carbohydrate_g} g??? ${heuristic.Calories_kcal} kcal`,
    `??7?????????????`,
    buildSevenDayDigest(records, todayYmd),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function readCache(): Promise<DailyAiIntakeTargetsRow | null> {
  const raw = await getAppSettingRaw(AppSettingKey.dailyIntakeAiTargets);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    const dateYmd = typeof o.dateYmd === 'string' ? o.dateYmd : '';
    const userId = typeof o.userId === 'string' ? o.userId : '';
    const profileFingerprint = typeof o.profileFingerprint === 'string' ? o.profileFingerprint : '';
    if (!dateYmd || !userId || !profileFingerprint) return null;
    const hydration_ml = Number(o.hydration_ml);
    const protein_g = Number(o.protein_g);
    const carbohydrate_g = Number(o.carbohydrate_g);
    const calories_kcal = Number(o.calories_kcal ?? o.sodium_mg);
    if (![hydration_ml, protein_g, carbohydrate_g, calories_kcal].every((x) => Number.isFinite(x) && x >= 0)) return null;
    const rationale_zh = typeof o.rationale_zh === 'string' && o.rationale_zh.trim() ? o.rationale_zh.trim() : null;
    return {
      dateYmd,
      userId,
      profileFingerprint,
      hydration_ml: Math.round(hydration_ml),
      protein_g: Math.round(protein_g),
      carbohydrate_g: Math.round(carbohydrate_g),
      calories_kcal: Math.round(calories_kcal),
      rationale_zh,
    };
  } catch {
    return null;
  }
}

async function writeCache(row: DailyAiIntakeTargetsRow): Promise<void> {
  await setAppSetting(AppSettingKey.dailyIntakeAiTargets, row);
}

/** ????????????????????? AI */
export async function invalidateDailyIntakeAiTargetsCache(): Promise<void> {
  await removeAppSetting(AppSettingKey.dailyIntakeAiTargets);
}

export type EnsureDailyAiIntakeTargetsResult =
  | { status: 'cached'; row: DailyAiIntakeTargetsRow }
  | { status: 'fresh'; row: DailyAiIntakeTargetsRow }
  | { status: 'no_api_key' }
  | { status: 'failed'; error: string };

/**
 * ???????????????????????????? app_settings?
 */
export async function ensureDailyAiIntakeTargetsForToday(params: {
  user: UserRow;
  todayYmd: string;
  /** ??????? wrapLoad ??? health_records ?? true????? REST */
  healthRecordsSkipFetch?: boolean;
}): Promise<EnsureDailyAiIntakeTargetsResult> {
  const { user, todayYmd, healthRecordsSkipFetch } = params;
  const dietary = await loadDietaryPrefs();
  const fingerprint = buildProfileFingerprint(user, todayYmd, dietary);
  const cached = await readCache();
  if (
    cached &&
    cached.dateYmd === todayYmd &&
    cached.userId === user.id &&
    cached.profileFingerprint === fingerprint
  ) {
    return { status: 'cached', row: cached };
  }

  const apiKey = getActiveAiLlmApiKey().trim();
  if (!apiKey) {
    return { status: 'no_api_key' };
  }

  const records = await getHealthRecordsLast7Days(user.id, todayYmd, {
    forceRefresh: true,
  });
  const context = buildContextBlock({ user, todayYmd, records, dietary });
  const ai = await estimateDailyIntakeTargetsFromContext({ apiKey, contextBlock: context });
  if (!ai.ok) {
    return { status: 'failed', error: ai.error };
  }

  const row: DailyAiIntakeTargetsRow = {
    dateYmd: todayYmd,
    userId: user.id,
    profileFingerprint: fingerprint,
    hydration_ml: ai.data.hydration_ml,
    protein_g: ai.data.protein_g,
    carbohydrate_g: ai.data.carbohydrate_g,
    calories_kcal: ai.data.calories_kcal,
    rationale_zh: ai.data.rationale_zh?.trim() ?? null,
  };
  await writeCache(row);
  return { status: 'fresh', row };
}
