import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

export type AiLlmProviderId = 'zhipu';

let cachedProvider: AiLlmProviderId = 'zhipu';

/** 同步读取当前偏好（启动后由 `loadAiLlmProviderPreference` 灌入缓存；恒为智谱）。 */
export function getPreferredAiLlmProviderSync(): AiLlmProviderId {
  return cachedProvider;
}

export async function loadAiLlmProviderPreference(): Promise<AiLlmProviderId> {
  try {
    const raw = await getAppSettingRaw(AppSettingKey.aiLlmProvider);
    if (raw === 'gemini') {
      cachedProvider = 'zhipu';
      await setAppSetting(AppSettingKey.aiLlmProvider, 'zhipu');
    } else {
      cachedProvider = 'zhipu';
    }
  } catch {
    cachedProvider = 'zhipu';
  }
  return cachedProvider;
}

export async function setPreferredAiLlmProvider(_id: AiLlmProviderId = 'zhipu'): Promise<void> {
  cachedProvider = 'zhipu';
  try {
    await setAppSetting(AppSettingKey.aiLlmProvider, 'zhipu');
  } catch {
    return;
  }
}
