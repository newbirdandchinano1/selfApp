/**
 * 剪贴板「用助手处理」：读图 / 读文，不写库。
 */
import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

import { readClipboardImageForAutoLedger } from '@/lib/auto-ledger-clipboard';

export type AssistantClipboardPayload = {
  text?: string;
  imageDataUri?: string;
};

/** 优先图，其次纯文本；都没有则 null。 */
export async function readClipboardForAssistant(): Promise<AssistantClipboardPayload | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const imageDataUri = (await readClipboardImageForAutoLedger()) || undefined;
    let text: string | undefined;
    try {
      const has = await Clipboard.hasStringAsync();
      if (has) {
        const s = (await Clipboard.getStringAsync()).trim();
        if (s) text = s.slice(0, 500);
      }
    } catch {
      /* ignore text */
    }
    if (!imageDataUri && !text) return null;
    // 有图时若文本像 data URI / 无意义则丢掉
    if (imageDataUri && text && (/^data:image\//i.test(text) || text.length > 200)) {
      return { imageDataUri };
    }
    return { text, imageDataUri };
  } catch {
    return null;
  }
}
