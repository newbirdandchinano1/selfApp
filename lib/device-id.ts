import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@selfapp/sync-device-id-v1';

let cachedDeviceId: string | null = null;

function createDeviceId(): string {
  // 无额外依赖的 UUID v4 近似（足够作设备标识）
  const hex = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return hex;
}

/** 持久化设备 ID，用于 Change Log 回声跳过与运维 */
export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored && stored.trim()) {
      cachedDeviceId = stored.trim().slice(0, 64);
      return cachedDeviceId;
    }
  } catch {
    /* ignore */
  }
  const id = createDeviceId().slice(0, 64);
  cachedDeviceId = id;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}
