import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_FULL_BACKUP_KEY = 'selfapp:cloud-sql-last-full-backup-at';
const LAST_ALIGN_KEY = 'selfapp:cloud-sql-last-align-at';

export async function getLastFullCloudBackupAtIso(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_FULL_BACKUP_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export async function setLastFullCloudBackupAtIso(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_FULL_BACKUP_KEY, iso);
  } catch {
    /* 非致命 */
  }
}

export async function getLastCloudAlignAtIso(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ALIGN_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export async function setLastCloudAlignAtIso(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ALIGN_KEY, iso);
  } catch {
    /* 非致命 */
  }
}
