import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Cloudflare D1 SQL Worker 根地址 */
export const DEFAULT_CLOUD_SQL_API_URL = 'https://odd-cloud-eae0.1594834072.workers.dev';

/** 内置访问密钥（可在设置中覆盖；Worker 若未启用鉴权可忽略） */
export const DEFAULT_CLOUD_AUTH_TOKEN = 'zhen8907146';

const TOKEN_STORAGE_KEY = '@selfapp/cloud-sql-auth-token';
const LEGACY_TOKEN_KEYS = [
  '@selfapp/kv-backup-auth-token',
  '@selfapp/github-backup-token',
  '@selfapp/github-backup-token-web',
] as const;
const LEGACY_TOKEN_SECURE_KEY = 'selfapp:github-backup-token';

export const CLOUD_BACKUP_NOT_CONFIGURED_MSG =
  '未配置云端访问密钥：请在「设置 → 云备份与同步」中填写密钥，或使用应用内置默认值。';

let cachedToken: string | null = null;

function isNonEmptyToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function migrateLegacyTokenIfNeeded(): Promise<string | null> {
  try {
    const fromNewKey = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (isNonEmptyToken(fromNewKey)) return fromNewKey;

    for (const legacyKey of LEGACY_TOKEN_KEYS) {
      const legacy = await AsyncStorage.getItem(legacyKey);
      if (isNonEmptyToken(legacy)) {
        await AsyncStorage.setItem(TOKEN_STORAGE_KEY, legacy);
        await AsyncStorage.removeItem(legacyKey);
        return legacy;
      }
    }

    if (Platform.OS !== 'web') {
      const legacy = await SecureStore.getItemAsync(LEGACY_TOKEN_SECURE_KEY);
      if (isNonEmptyToken(legacy)) {
        await AsyncStorage.setItem(TOKEN_STORAGE_KEY, legacy);
        try {
          await SecureStore.deleteItemAsync(LEGACY_TOKEN_SECURE_KEY);
        } catch {
          /* ignore */
        }
        return legacy;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function readPersistedToken(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (isNonEmptyToken(raw)) return raw;
    return await migrateLegacyTokenIfNeeded();
  } catch {
    return null;
  }
}

async function resolveCloudAuthToken(): Promise<string> {
  if (isNonEmptyToken(cachedToken)) return cachedToken;
  const stored = await readPersistedToken();
  if (isNonEmptyToken(stored)) {
    cachedToken = stored;
    return stored;
  }
  if (__DEV__) {
    const fromEnv = process.env.EXPO_PUBLIC_CLOUD_AUTH_TOKEN ?? process.env.EXPO_PUBLIC_KV_AUTH_TOKEN;
    if (isNonEmptyToken(fromEnv)) return fromEnv;
  }
  return DEFAULT_CLOUD_AUTH_TOKEN;
}

export async function loadCloudBackupTokenCache(): Promise<boolean> {
  cachedToken = await readPersistedToken();
  return isNonEmptyToken(cachedToken) || isNonEmptyToken(DEFAULT_CLOUD_AUTH_TOKEN);
}

export function hasCloudUserTokenSync(): boolean {
  return isNonEmptyToken(cachedToken) || isNonEmptyToken(DEFAULT_CLOUD_AUTH_TOKEN);
}

export async function getCloudUserCustomToken(): Promise<string | null> {
  if (isNonEmptyToken(cachedToken)) return cachedToken;
  return readPersistedToken();
}

export async function getCloudAuthToken(): Promise<string | null> {
  const token = await resolveCloudAuthToken();
  return isNonEmptyToken(token) ? token : null;
}

export async function setCloudUserToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
  cachedToken = token;
}

export async function clearCloudUserToken(): Promise<void> {
  cachedToken = null;
  try {
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(LEGACY_TOKEN_SECURE_KEY);
    }
    for (const key of LEGACY_TOKEN_KEYS) {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export async function getCloudSqlApiUrl(): Promise<string> {
  return DEFAULT_CLOUD_SQL_API_URL.replace(/\/+$/, '');
}
