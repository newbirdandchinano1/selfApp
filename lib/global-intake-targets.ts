import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

type PersistedShape = {
  hydrationMl: number;
  proteinG: number;
  carbohydrateG: number;
  caloriesKcal: number;
};

/** 无本地持久化数据时使用的默认目标（水分 ml、蛋白质 g、碳水 g、热量 kcal）。 */
export const DEFAULT_HYDRATION_TARGET_ML = 2500;
export const DEFAULT_PROTEIN_TARGET_G = 80;
export const DEFAULT_CARBOHYDRATE_TARGET_G = 260;
export const DEFAULT_CALORIES_TARGET_KCAL = 2000;

/**
 * 当前用户在应用内设定的摄入目标（模块级共享）。
 * 单位：水分 ml、蛋白质 g、碳水 g、热量 kcal。会通过 app_settings 在重启后恢复。
 *
 * 其他模块请通过 setGlobal* 写入；在 React 中更新后需 bump 本地 tick 触发重渲染（见首页）。
 */
export let globalHydrationTargetMl = DEFAULT_HYDRATION_TARGET_ML;
export let globalProteinTargetG = DEFAULT_PROTEIN_TARGET_G;
export let globalCarbohydrateTargetG = DEFAULT_CARBOHYDRATE_TARGET_G;
export let globalCaloriesTargetKcal = DEFAULT_CALORIES_TARGET_KCAL;

async function persistToDisk() {
  const payload: PersistedShape = {
    hydrationMl: globalHydrationTargetMl,
    proteinG: globalProteinTargetG,
    carbohydrateG: globalCarbohydrateTargetG,
    caloriesKcal: globalCaloriesTargetKcal,
  };
  await setAppSetting(AppSettingKey.globalIntakeTargets, payload);
}

function coerceTarget(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  return fallback;
}

function ensureGlobalsValid() {
  globalHydrationTargetMl = coerceTarget(globalHydrationTargetMl, DEFAULT_HYDRATION_TARGET_ML);
  globalProteinTargetG = coerceTarget(globalProteinTargetG, DEFAULT_PROTEIN_TARGET_G);
  globalCarbohydrateTargetG = coerceTarget(globalCarbohydrateTargetG, DEFAULT_CARBOHYDRATE_TARGET_G);
  globalCaloriesTargetKcal = coerceTarget(globalCaloriesTargetKcal, DEFAULT_CALORIES_TARGET_KCAL);
}

/** 始终返回有效数值的目标快照（供 UI 读取，避免 undefined 导致渲染崩溃）。 */
export function getResolvedGlobalIntakeTargets(): PersistedShape {
  ensureGlobalsValid();
  return {
    hydrationMl: globalHydrationTargetMl,
    proteinG: globalProteinTargetG,
    carbohydrateG: globalCarbohydrateTargetG,
    caloriesKcal: globalCaloriesTargetKcal,
  };
}

function assignIfValid(raw: unknown, apply: (n: number) => void) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return;
  apply(Math.round(raw));
}

/** 从本地存储恢复；应在首屏前与数据库初始化一并 await。 */
export async function loadPersistedIntakeTargets(): Promise<void> {
  const parsed = await getAppSetting<Record<string, unknown>>(AppSettingKey.globalIntakeTargets);
  if (!parsed || typeof parsed !== 'object') return;
  const o = parsed;
  assignIfValid(o.hydrationMl, (n) => {
    globalHydrationTargetMl = n;
  });
  assignIfValid(o.proteinG, (n) => {
    globalProteinTargetG = n;
  });
  assignIfValid(o.carbohydrateG, (n) => {
    globalCarbohydrateTargetG = n;
  });
  assignIfValid(o.caloriesKcal, (n) => {
    globalCaloriesTargetKcal = n;
  });
  // 兼容旧版钠目标字段
  if (o.caloriesKcal === undefined) {
    assignIfValid(o.sodiumMg, (n) => {
      globalCaloriesTargetKcal = n;
    });
  }
  ensureGlobalsValid();
}

export function setGlobalHydrationTargetMl(value: number) {
  globalHydrationTargetMl = coerceTarget(value, globalHydrationTargetMl);
  void persistToDisk().catch(() => {});
}

export function setGlobalProteinTargetG(value: number) {
  globalProteinTargetG = coerceTarget(value, globalProteinTargetG);
  void persistToDisk().catch(() => {});
}

export function setGlobalCarbohydrateTargetG(value: number) {
  globalCarbohydrateTargetG = coerceTarget(value, globalCarbohydrateTargetG);
  void persistToDisk().catch(() => {});
}

export function setGlobalCaloriesTargetKcal(value: number) {
  globalCaloriesTargetKcal = coerceTarget(value, globalCaloriesTargetKcal);
  void persistToDisk().catch(() => {});
}
