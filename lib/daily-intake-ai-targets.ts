import { AppSettingKey, getAppSettingRaw, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';

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
  sodium_mg: number;
  rationale_zh: string | null;
};

function buildProfileFingerprint(user: UserRow, todayYmd: string): string {
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
  });
}

function aggregateIntakeByDate(records: HealthRecordRow[]): Map<string, { h: number; p: number; c: number; s: number }> {
  const map = new Map<string, { h: number; p: number; c: number; s: number }>();
  for (const r of records) {
    const key = r.record_date;
    const cur = map.get(key) ?? { h: 0, p: 0, c: 0, s: 0 };
    cur.h += Number(r.hydration) || 0;
    cur.p += Number(r.protein) || 0;
    cur.c += Number(r.carbohydrate) || 0;
    cur.s += Number(r.sodium) || 0;
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
        `${d}：水分 ${Math.round(v.h)} ml，蛋白质 ${Math.round(v.p)} g，碳水 ${Math.round(v.c)} g，钠 ${Math.round(v.s)} mg`,
      );
    }
    return lines.length ? lines.join('\n') : '（近7日无摄入记录）';
  }
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${day}`;
    const v = byDate.get(ymd) ?? { h: 0, p: 0, c: 0, s: 0 };
    lines.push(
      `${ymd}：水分 ${Math.round(v.h)} ml，蛋白质 ${Math.round(v.p)} g，碳水 ${Math.round(v.c)} g，钠 ${Math.round(v.s)} mg`,
    );
  }
  return lines.join('\n');
}

function buildContextBlock(params: {
  user: UserRow;
  todayYmd: string;
  records: HealthRecordRow[];
}): string {
  const { user, todayYmd, records } = params;
  const activity = mapLifestyleToActivityLevel(user.lifestyle);
  const g = mapGoalToNutritionGoal(user.goal);
  const gender = mapGenderToNutritionGender(user.gender);
  const w = Number(user.weight) || 0;
  const h = Number(user.height) || 0;
  const age = Number(user.age) || 0;
  const recentSodium = aggregateIntakeByDate(records).get(todayYmd)?.s ?? 0;
  const baseHeuristic = calculateNutritionV2(w, h, age, gender, activity, g, recentSodium);
  const daySchedule = getUserDayScheduleKind(user, todayYmd);
  const heuristic = adjustNutritionMetricsForDaySchedule(baseHeuristic, daySchedule);
  const weekdayLabel = getChineseWeekdayLabelFromYmd(todayYmd);
  const scheduleLine =
    daySchedule === 'sedentary'
      ? '【今日日程】静坐习惯，无周训练/休息日划分。'
      : `【今日日程】${weekdayLabel ?? todayYmd} 为${getUserDayScheduleLabelZh(daySchedule)}。周计划：${formatUserWorkoutWeekPlanZh(user)}。请按今日类型调整四项摄入目标：健身日适度提高蛋白质、碳水、水分与钠以支持训练与出汗；休息日温和降低训练日定量（尤其碳水与钠），仍保证基础营养。`;

  return [
    `【今日日期】${todayYmd}`,
    `【用户档案】称呼：${user.name ?? '用户'}；性别：${user.gender}；生日：${user.birthday ?? '未填'}；年龄(档案)：${age}；身高 cm：${h}；体重 kg：${w}；生活方式：${user.lifestyle}；目标：${user.goal}`,
    scheduleLine,
    `【本地公式参考目标（已按今日${getUserDayScheduleLabelZh(daySchedule)}微调，供你对齐数量级）】水分 ${heuristic.Water_ml} ml；蛋白质 ${heuristic.Protein_g} g；碳水 ${heuristic.Carbohydrate_g} g；钠 ${heuristic.Sodium_mg} mg`,
    `【近7日（含今日）每日摄入合计】`,
    buildSevenDayDigest(records, todayYmd),
  ].join('\n\n');
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
    const sodium_mg = Number(o.sodium_mg);
    if (![hydration_ml, protein_g, carbohydrate_g, sodium_mg].every((x) => Number.isFinite(x) && x >= 0)) return null;
    const rationale_zh = typeof o.rationale_zh === 'string' && o.rationale_zh.trim() ? o.rationale_zh.trim() : null;
    return {
      dateYmd,
      userId,
      profileFingerprint,
      hydration_ml: Math.round(hydration_ml),
      protein_g: Math.round(protein_g),
      carbohydrate_g: Math.round(carbohydrate_g),
      sodium_mg: Math.round(sodium_mg),
      rationale_zh,
    };
  } catch {
    return null;
  }
}

async function writeCache(row: DailyAiIntakeTargetsRow): Promise<void> {
  await setAppSetting(AppSettingKey.dailyIntakeAiTargets, row);
}

/** 个人资料变更后调用，使下次进入首页重新请求 AI */
export async function invalidateDailyIntakeAiTargetsCache(): Promise<void> {
  await removeAppSetting(AppSettingKey.dailyIntakeAiTargets);
}

export type EnsureDailyAiIntakeTargetsResult =
  | { status: 'cached'; row: DailyAiIntakeTargetsRow }
  | { status: 'fresh'; row: DailyAiIntakeTargetsRow }
  | { status: 'no_api_key' }
  | { status: 'failed'; error: string };

/**
 * 每个自然日、每位用户档案指纹最多请求一次模型；成功则写入 app_settings。
 */
export async function ensureDailyAiIntakeTargetsForToday(params: {
  user: UserRow;
  todayYmd: string;
  /** 首页已在同一次 wrapLoad 内同步 health_records 后传 true，避免重复 REST */
  healthRecordsLocalOnly?: boolean;
}): Promise<EnsureDailyAiIntakeTargetsResult> {
  const { user, todayYmd, healthRecordsLocalOnly } = params;
  const fingerprint = buildProfileFingerprint(user, todayYmd);
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
    localOnly: healthRecordsLocalOnly,
  });
  const context = buildContextBlock({ user, todayYmd, records });
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
    sodium_mg: ai.data.sodium_mg,
    rationale_zh: ai.data.rationale_zh?.trim() ?? null,
  };
  await writeCache(row);
  return { status: 'fresh', row };
}
