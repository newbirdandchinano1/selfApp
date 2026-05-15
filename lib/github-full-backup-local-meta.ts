import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_FULL_BACKUP_AT_KEY = 'selfapp:last-full-github-backup-at-iso';

export async function getLastFullGithubBackupAtIso(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(LAST_FULL_BACKUP_AT_KEY);
  const s = raw?.trim();
  return s && s.length > 0 ? s : null;
}

export async function setLastFullGithubBackupAtIso(iso: string): Promise<void> {
  await AsyncStorage.setItem(LAST_FULL_BACKUP_AT_KEY, iso);
}
