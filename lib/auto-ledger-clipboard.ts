import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

/** 读取剪贴板 PNG 截图，返回 data URI；失败返回 null。 */
export async function readClipboardImageForAutoLedger(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const has = await Clipboard.hasImageAsync();
    if (!has) {
      return null;
    }
    const img = await Clipboard.getImageAsync({ format: 'png' });
    if (!img?.data) {
      return null;
    }
    return img.data;
  } catch {
    return null;
  }
}
