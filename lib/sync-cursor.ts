import AsyncStorage from '@react-native-async-storage/async-storage';

const CURSOR_KEY = '@selfapp/sync-change-cursor-v1';

let cachedCursor: number | null = null;

export async function getSyncChangeCursor(): Promise<number> {
  if (cachedCursor != null) return cachedCursor;
  try {
    const raw = await AsyncStorage.getItem(CURSOR_KEY);
    if (raw != null && /^\d+$/.test(raw.trim())) {
      cachedCursor = parseInt(raw.trim(), 10);
      return cachedCursor;
    }
  } catch {
    /* ignore */
  }
  cachedCursor = 0;
  return 0;
}

export async function setSyncChangeCursor(cursor: number): Promise<void> {
  const n = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
  cachedCursor = n;
  try {
    await AsyncStorage.setItem(CURSOR_KEY, String(n));
  } catch {
    /* ignore */
  }
}

/** 登出 / 换号时清除游标 */
export async function clearSyncChangeCursor(): Promise<void> {
  cachedCursor = 0;
  try {
    await AsyncStorage.removeItem(CURSOR_KEY);
  } catch {
    /* ignore */
  }
}
