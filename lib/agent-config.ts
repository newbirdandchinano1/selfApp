import AsyncStorage from '@react-native-async-storage/async-storage';

/** Agent 编排层默认根地址（场景 AI：`/api/v1/ai/*`） */
export const DEFAULT_AGENT_BASE_URL = 'http://124.223.161.79:8000';

/** 与 Agent `.env` 中 `API_KEY` 对齐；生产请用环境变量覆盖 */
export const DEFAULT_AGENT_API_KEY = 'change-me';

const AGENT_BASE_URL_STORAGE_KEY = '@selfapp/agent-base-url';
const AGENT_API_KEY_STORAGE_KEY = '@selfapp/agent-api-key';

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_AGENT_BASE_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export async function getAgentBaseUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(AGENT_BASE_URL_STORAGE_KEY);
    if (isNonEmpty(stored)) return normalizeBaseUrl(stored);
  } catch {
    /* ignore */
  }
  if (__DEV__) {
    const fromEnv = process.env.EXPO_PUBLIC_AGENT_BASE_URL;
    if (isNonEmpty(fromEnv)) return normalizeBaseUrl(fromEnv);
  }
  return DEFAULT_AGENT_BASE_URL;
}

export async function setAgentBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(AGENT_BASE_URL_STORAGE_KEY, normalizeBaseUrl(url));
}

export async function clearAgentBaseUrlOverride(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AGENT_BASE_URL_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function getAgentApiKey(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(AGENT_API_KEY_STORAGE_KEY);
    if (isNonEmpty(stored)) return stored;
  } catch {
    /* ignore */
  }
  const fromEnv = process.env.EXPO_PUBLIC_AGENT_API_KEY;
  if (isNonEmpty(fromEnv)) return fromEnv;
  return DEFAULT_AGENT_API_KEY;
}

export async function setAgentApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(AGENT_API_KEY_STORAGE_KEY, key.trim());
}

export async function clearAgentApiKeyOverride(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AGENT_API_KEY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
