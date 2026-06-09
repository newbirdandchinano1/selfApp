import AsyncStorage from '@react-native-async-storage/async-storage';

/** REST 后端根地址 */
export const DEFAULT_API_BASE_URL = 'http://47.109.78.229:3000';

/** 内置管理员账号（应用内固定，不可在设置中修改） */
export const DEFAULT_API_USERNAME = 'admin';
export const DEFAULT_API_PASSWORD = 'zhen8907146';

const BASE_URL_STORAGE_KEY = '@selfapp/api-base-url';
const USERNAME_STORAGE_KEY = '@selfapp/api-username';
const PASSWORD_STORAGE_KEY = '@selfapp/api-password';
const TOKEN_STORAGE_KEY = '@selfapp/api-auth-token';

export const API_NOT_CONFIGURED_MSG =
  '无法连接服务器：请检查网络，或确认内置 REST 服务可用。';

let cachedToken: string | null = null;

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export async function getApiBaseUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(BASE_URL_STORAGE_KEY);
    if (isNonEmpty(stored)) return normalizeBaseUrl(stored);
  } catch {
    /* ignore */
  }
  if (__DEV__) {
    const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (isNonEmpty(fromEnv)) return normalizeBaseUrl(fromEnv);
  }
  return DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(BASE_URL_STORAGE_KEY, normalizeBaseUrl(url));
}

export async function clearApiBaseUrlOverride(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BASE_URL_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function getApiUsername(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(USERNAME_STORAGE_KEY);
    if (isNonEmpty(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_API_USERNAME;
}

export async function getApiPassword(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(PASSWORD_STORAGE_KEY);
    if (isNonEmpty(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_API_PASSWORD;
}

export async function setApiCredentials(username: string, password: string): Promise<void> {
  await AsyncStorage.multiSet([
    [USERNAME_STORAGE_KEY, username.trim()],
    [PASSWORD_STORAGE_KEY, password],
  ]);
}

export async function clearApiCredentials(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([USERNAME_STORAGE_KEY, PASSWORD_STORAGE_KEY]);
  } catch {
    /* ignore */
  }
}

export async function getApiAuthToken(): Promise<string | null> {
  if (isNonEmpty(cachedToken)) return cachedToken;
  try {
    const stored = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (isNonEmpty(stored)) {
      cachedToken = stored;
      return stored;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function setApiAuthToken(token: string): Promise<void> {
  cachedToken = token;
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export async function clearApiAuthToken(): Promise<void> {
  cachedToken = null;
  try {
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    const { resetPageApiSession } = await import('@/lib/page-api-session');
    resetPageApiSession();
  } catch {
    /* ignore */
  }
}

export async function hasCustomApiCredentials(): Promise<boolean> {
  try {
    const [user, pass] = await AsyncStorage.multiGet([USERNAME_STORAGE_KEY, PASSWORD_STORAGE_KEY]);
    return isNonEmpty(user[1]) || isNonEmpty(pass[1]);
  } catch {
    return false;
  }
}
