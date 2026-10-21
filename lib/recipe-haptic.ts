import { AppSettingKey, getAppSettingFromCache, setAppSetting } from '@/lib/app-settings-store';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** 进程内缓存，供底栏等同步路径读取；默认开 */
let cachedEnabled = true;
let hydrated = false;

export function isRecipeHapticEnabledSync(): boolean {
  return cachedEnabled;
}

export async function hydrateRecipeHaptic(): Promise<boolean> {
  const raw = await getAppSettingFromCache<unknown>(AppSettingKey.recipeHaptic);
  // 未写入过 → 默认开；显式 false / 0 / '0' 为关
  cachedEnabled = !(raw === false || raw === 0 || raw === '0');
  hydrated = true;
  return cachedEnabled;
}

export async function getRecipeHapticEnabled(): Promise<boolean> {
  if (!hydrated) await hydrateRecipeHaptic();
  return cachedEnabled;
}

export async function setRecipeHapticEnabled(enabled: boolean): Promise<void> {
  cachedEnabled = enabled;
  hydrated = true;
  await setAppSetting(AppSettingKey.recipeHaptic, enabled);
}

/** 菜谱底栏 / 轻触选择反馈；尊重开关 */
export function recipeSelectionHaptic(): void {
  if (Platform.OS === 'web' || !cachedEnabled) return;
  void Haptics.selectionAsync().catch(() => {});
}
