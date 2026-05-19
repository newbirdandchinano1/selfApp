import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { GitHubBackupConfig } from '@/lib/github-backup-manager';

/** 内置仓库归属（用户只需填 Token） */
export const DEFAULT_GITHUB_OWNER = 'newbirdandchinano1';
export const DEFAULT_GITHUB_REPO = 'APP-data';
/** 账单单文件自动同步路径 */
export const DEFAULT_GITHUB_BACKUP_PATH = 'backups/user_data.json';
/** 全量备份根目录（含 sqlite/、kv/、manifest.json） */
export const DEFAULT_GITHUB_FULL_BACKUP_ROOT = 'backups/selfapp';

const TOKEN_STORAGE_KEY = '@selfapp/github-backup-token';
/** 旧版 SecureStore / Web 键，首次读取时迁移到 {@link TOKEN_STORAGE_KEY} */
const LEGACY_TOKEN_SECURE_KEY = 'selfapp:github-backup-token';
const LEGACY_TOKEN_WEB_KEY = '@selfapp/github-backup-token-web';

export const GITHUB_BACKUP_NOT_CONFIGURED_MSG =
  '未配置 GitHub：请在「设置 → 云备份与同步」中填写 Personal Access Token（需 repo 权限）。';

let cachedToken: string | null = null;

function isNonEmptyToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function migrateLegacyTokenIfNeeded(): Promise<string | null> {
  try {
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

async function resolveGithubBackupToken(): Promise<string | null> {
  if (isNonEmptyToken(cachedToken)) return cachedToken;
  const stored = await readPersistedToken();
  if (isNonEmptyToken(stored)) {
    cachedToken = stored;
    return stored;
  }
  if (__DEV__) {
    const fromEnv = process.env.EXPO_PUBLIC_GITHUB_TOKEN;
    if (isNonEmptyToken(fromEnv)) return fromEnv;
  }
  return null;
}

/** 启动时调用：从 AsyncStorage 灌入内存缓存，供设置页与云备份读取 */
export async function loadGithubBackupTokenCache(): Promise<boolean> {
  cachedToken = await readPersistedToken();
  return isNonEmptyToken(cachedToken);
}

export function hasGithubUserTokenSync(): boolean {
  return isNonEmptyToken(cachedToken);
}

export async function getGithubUserToken(): Promise<string | null> {
  return resolveGithubBackupToken();
}

/** 原样持久化，不做 trim 或格式校验 */
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
  } catch {
    // ignore
  }
}

export function getGitHubFullBackupRoot(): string {
  return DEFAULT_GITHUB_FULL_BACKUP_ROOT.replace(/^\/+/, '').replace(/\/+$/, '');
}

export async function getGitHubBackupConfig(): Promise<GitHubBackupConfig | null> {
  const token = await resolveGithubBackupToken();
  if (!isNonEmptyToken(token)) return null;
  return {
    token,
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
    path: DEFAULT_GITHUB_BACKUP_PATH,
  };
}
