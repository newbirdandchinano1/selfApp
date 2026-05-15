import AsyncStorage from '@react-native-async-storage/async-storage';
import { markGithubKvSliceDirty } from '@/lib/github-sqlite-dirty-track';

const STORAGE_KEY = '@selfapp/ai_llm_provider_id';

export type AiLlmProviderId = 'zhipu' | 'gemini';

let cachedProvider: AiLlmProviderId = 'zhipu';

function normalizeProvider(raw: string | null | undefined): AiLlmProviderId {
  return raw === 'gemini' ? 'gemini' : 'zhipu';
}

/** 同步读取当前偏好（启动后由 `loadAiLlmProviderPreference` 灌入缓存；未加载前默认为智谱）。 */
export function getPreferredAiLlmProviderSync(): AiLlmProviderId {
  return cachedProvider;
}

export async function loadAiLlmProviderPreference(): Promise<AiLlmProviderId> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cachedProvider = normalizeProvider(raw ?? undefined);
  } catch {
    cachedProvider = 'zhipu';
  }
  return cachedProvider;
}

export async function setPreferredAiLlmProvider(id: AiLlmProviderId): Promise<void> {
  cachedProvider = id === 'gemini' ? 'gemini' : 'zhipu';
  try {
    await AsyncStorage.setItem(STORAGE_KEY, cachedProvider);
  } catch {
    // 忽略持久化失败，内存缓存仍生效
    return;
  }
  markGithubKvSliceDirty('ai_llm_provider');
}
