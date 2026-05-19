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

const TOKEN_SECURE_KEY = 'selfapp:github-backup-token';
const TOKEN_WEB_FALLBACK_KEY = '@selfapp/github-backup-token-web';

export const GITHUB_BACKUP_NOT_CONFIGURED_MSG =
  '未配置 GitHub：请在「设置 → 云备份与同步」中填写 Personal Access Token（需 repo 权限）。';

let cachedHasToken: boolean | null = null;

async function readStoredToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const raw = await AsyncStorage.getItem(TOKEN_WEB_FALLBACK_KEY);
      return raw?.trim() || null;
    }
    const raw = await SecureStore.getItemAsync(TOKEN_SECURE_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

async function writeStoredToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(TOKEN_WEB_FALLBACK_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_SECURE_KEY, token);
}

async function deleteStoredToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(TOKEN_WEB_FALLBACK_KEY);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_SECURE_KEY);
    }
  } catch {
    // ignore
  }
}

/** 启动时调用，供设置页同步展示「已配置」状态 */
export async function loadGithubBackupTokenCache(): Promise<boolean> {
  const token = await resolveGithubBackupToken();
  cachedHasToken = !!token;
  return cachedHasToken;
}

export function hasGithubUserTokenSync(): boolean {
  return cachedHasToken === true;
}

async function resolveGithubBackupToken(): Promise<string | null> {
  const stored = await readStoredToken();
  if (stored) return stored;
  if (__DEV__) {
    const fromEnv = process.env.EXPO_PUBLIC_GITHUB_TOKEN?.trim();
    if (fromEnv) return fromEnv;
  }
  return null;
}

export async function getGithubUserToken(): Promise<string | null> {
  return resolveGithubBackupToken();
}

export async function setGithubUserToken(token: string): Promise<void> {
  const t = token.trim();
  if (!t) {
    await clearGithubUserToken();
    return;
  }
  await writeStoredToken(t);
  cachedHasToken = true;
}

export async function clearGithubUserToken(): Promise<void> {
  await deleteStoredToken();
  cachedHasToken = false;
}

export function getGitHubFullBackupRoot(): string {
  return DEFAULT_GITHUB_FULL_BACKUP_ROOT.replace(/^\/+/, '').replace(/\/+$/, '');
}

export async function getGitHubBackupConfig(): Promise<GitHubBackupConfig | null> {
  const token = await resolveGithubBackupToken();
  if (!token) return null;
  return {
    token,
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
    path: DEFAULT_GITHUB_BACKUP_PATH,
  };
}
