import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@global_intake_targets_v1';

type PersistedShape = {
  hydrationMl: number;
  proteinG: number;
  sodiumMg: number;
};

/** 无本地持久化数据时使用的默认目标（水分 ml、蛋白质 g、钠 mg）。 */
export const DEFAULT_HYDRATION_TARGET_ML = 2500;
export const DEFAULT_PROTEIN_TARGET_G = 80;
export const DEFAULT_SODIUM_TARGET_MG = 2000;

/**
 * 当前用户在应用内设定的摄入目标（模块级共享）。
 * 单位：水分 ml、蛋白质 g、钠 mg。会通过 AsyncStorage 在重启后恢复。
 *
 * 其他模块请通过 setGlobal* 写入；在 React 中更新后需 bump 本地 tick 触发重渲染（见首页）。
 */
export let globalHydrationTargetMl = DEFAULT_HYDRATION_TARGET_ML;
export let globalProteinTargetG = DEFAULT_PROTEIN_TARGET_G;
export let globalSodiumTargetMg = DEFAULT_SODIUM_TARGET_MG;

async function persistToDisk() {
  const payload: PersistedShape = {
    hydrationMl: globalHydrationTargetMl,
    proteinG: globalProteinTargetG,
    sodiumMg: globalSodiumTargetMg,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function assignIfValid(raw: unknown, apply: (n: number) => void) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return;
  apply(Math.round(raw));
}

/** 从本地存储恢复；应在首屏前与数据库初始化一并 await。 */
export async function loadPersistedIntakeTargets(): Promise<void> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const o = parsed as Record<string, unknown>;
  assignIfValid(o.hydrationMl, (n) => {
    globalHydrationTargetMl = n;
  });
  assignIfValid(o.proteinG, (n) => {
    globalProteinTargetG = n;
  });
  assignIfValid(o.sodiumMg, (n) => {
    globalSodiumTargetMg = n;
  });
}

export function setGlobalHydrationTargetMl(value: number) {
  globalHydrationTargetMl = value;
  void persistToDisk().catch(() => {});
}

export function setGlobalProteinTargetG(value: number) {
  globalProteinTargetG = value;
  void persistToDisk().catch(() => {});
}

export function setGlobalSodiumTargetMg(value: number) {
  globalSodiumTargetMg = value;
  void persistToDisk().catch(() => {});
}
