import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { GitHubBackupConfig } from '@/lib/github-backup-manager';

/** Cloudflare Worker KV 接口根地址 */
export const DEFAULT_KV_API_URL = 'https://odd-cloud-eae0.1594834072.workers.dev/';
/** 内置访问密钥（可在设置中覆盖） */
export const DEFAULT_KV_AUTH_TOKEN = 'zhen8907146';
/** 账单单文件自动同步 key */
export const DEFAULT_GITHUB_BACKUP_PATH = 'backups/user_data.json';
/** 全量备份根前缀（含 sqlite/、kv/、manifest.json） */
export const DEFAULT_GITHUB_FULL_BACKUP_ROOT = 'backups/selfapp';

/** @deprecated 已迁移至 Cloudflare KV，保留常量名避免大范围重命名 */
export const DEFAULT_GITHUB_OWNER = '';
/** @deprecated 已迁移至 Cloudflare KV */
export const DEFAULT_GITHUB_REPO = '';

const TOKEN_STORAGE_KEY = '@selfapp/kv-backup-auth-token';
const LEGACY_TOKEN_SECURE_KEY = 'selfapp:github-backup-token';
const LEGACY_TOKEN_WEB_KEY = '@selfapp/github-backup-token-web';
const LEGACY_TOKEN_STORAGE_KEY = '@selfapp/github-backup-token';

export const GITHUB_BACKUP_NOT_CONFIGURED_MSG =
  '未配置云端访问密钥：请在「设置 → 云备份与同步」中填写密钥，或使用应用内置默认值。';

let cachedToken: string | null = null;

function isNonEmptyToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function migrateLegacyTokenIfNeeded(): Promise<string | null> {
  try {
    const fromNewKey = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (isNonEmptyToken(fromNewKey)) return fromNewKey;

    const fromLegacyAsync = await AsyncStorage.getItem(LEGACY_TOKEN_STORAGE_KEY);
    if (isNonEmptyToken(fromLegacyAsync)) {
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, fromLegacyAsync);
      await AsyncStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
      return fromLegacyAsync;
    }

    if (Platform.OS !== 'web') {
      const legacy = await SecureStore.getItemAsync(LEGACY_TOKEN_SECURE_KEY);
      if (isNonEmptyToken(legacy)) {
        await AsyncStorage.setItem(TOKEN_STORAGE_KEY, legacy);
        try {
          await SecureStore.deleteItemAsync(LEGACY_TOKEN_SECURE_KEY);
        } catch {
          // ignore
        }
        return legacy;
      }
    }
    const legacyWeb = await AsyncStorage.getItem(LEGACY_TOKEN_WEB_KEY);
    if (isNonEmptyToken(legacyWeb)) {
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, legacyWeb);
      await AsyncStorage.removeItem(LEGACY_TOKEN_WEB_KEY);
      return legacyWeb;
    }
  } catch {
    // ignore
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

async function resolveKvAuthToken(): Promise<string> {
  if (isNonEmptyToken(cachedToken)) return cachedToken;
  const stored = await readPersistedToken();
  if (isNonEmptyToken(stored)) {
    cachedToken = stored;
    return stored;
  }
  if (__DEV__) {
    const fromEnv = process.env.EXPO_PUBLIC_KV_AUTH_TOKEN ?? process.env.EXPO_PUBLIC_GITHUB_TOKEN;
    if (isNonEmptyToken(fromEnv)) return fromEnv;
  }
  return DEFAULT_KV_AUTH_TOKEN;
}

/** 启动时调用：从 AsyncStorage 灌入内存缓存 */
export async function loadGithubBackupTokenCache(): Promise<boolean> {
  cachedToken = await readPersistedToken();
  return isNonEmptyToken(cachedToken) || isNonEmptyToken(DEFAULT_KV_AUTH_TOKEN);
}

export function hasGithubUserTokenSync(): boolean {
  return isNonEmptyToken(cachedToken) || isNonEmptyToken(DEFAULT_KV_AUTH_TOKEN);
}

/** 仅返回用户在本机保存的自定义密钥（不含内置默认值） */
export async function getGithubUserCustomToken(): Promise<string | null> {
  if (isNonEmptyToken(cachedToken)) return cachedToken;
  return readPersistedToken();
}

export async function getGithubUserToken(): Promise<string | null> {
  const token = await resolveKvAuthToken();
  return isNonEmptyToken(token) ? token : null;
}

export async function setGithubUserToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
  cachedToken = token;
}

export async function clearGithubUserToken(): Promise<void> {
  cachedToken = null;
  try {
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(LEGACY_TOKEN_SECURE_KEY);
    }
    await AsyncStorage.removeItem(LEGACY_TOKEN_WEB_KEY);
    await AsyncStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getGitHubFullBackupRoot(): string {
  return DEFAULT_GITHUB_FULL_BACKUP_ROOT.replace(/^\/+/, '').replace(/\/+$/, '');
}

export async function getGitHubBackupConfig(): Promise<GitHubBackupConfig | null> {
  const token = await resolveKvAuthToken();
  if (!isNonEmptyToken(token)) return null;
  return {
    token,
    apiUrl: DEFAULT_KV_API_URL,
    path: DEFAULT_GITHUB_BACKUP_PATH,
  };
}
