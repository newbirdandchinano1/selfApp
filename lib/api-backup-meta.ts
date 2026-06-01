import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_API_UPLOAD_KEY = 'selfapp:api-last-full-upload-at';
const LAST_API_INCREMENTAL_SYNC_KEY = 'selfapp:api-last-incremental-sync-at';

export async function getLastApiFullUploadAtIso(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_API_UPLOAD_KEY);
  } catch {
    return null;
  }
}

export async function setLastApiFullUploadAtIso(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_API_UPLOAD_KEY, iso);
  } catch {
    /* ignore */
  }
}

export async function getLastApiIncrementalSyncAtIso(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_API_INCREMENTAL_SYNC_KEY);
  } catch {
    return null;
  }
}

export async function setLastApiIncrementalSyncAtIso(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_API_INCREMENTAL_SYNC_KEY, iso);
  } catch {
    /* ignore */
  }
}
