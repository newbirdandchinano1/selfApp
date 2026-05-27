import AsyncStorage from '@react-native-async-storage/async-storage';
import { markGithubKvSliceDirty } from '@/lib/github-sqlite-dirty-track';

const STORAGE_KEY = '@selfapp/ai_llm_provider_id';

export type AiLlmProviderId = 'zhipu';

let cachedProvider: AiLlmProviderId = 'zhipu';

/** 同步读取当前偏好（启动后由 `loadAiLlmProviderPreference` 灌入缓存；恒为智谱）。 */
export function getPreferredAiLlmProviderSync(): AiLlmProviderId {
  return cachedProvider;
}

export async function loadAiLlmProviderPreference(): Promise<AiLlmProviderId> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === 'gemini') {
      cachedProvider = 'zhipu';
      await AsyncStorage.setItem(STORAGE_KEY, 'zhipu');
      markGithubKvSliceDirty('ai_llm_provider');
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
    await AsyncStorage.setItem(STORAGE_KEY, 'zhipu');
  } catch {
    return;
  }
  markGithubKvSliceDirty('ai_llm_provider');
}
