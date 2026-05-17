import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** 与 `plugins/with-zheng-app-intents.js` 中 Swift 写入的文件名保持一致 */
export const SHORTCUT_AUTO_LEDGER_PENDING_FILENAME = 'shortcut-auto-ledger-pending.png';

export function getShortcutAutoLedgerPendingFile(): File {
  return new File(Paths.document, SHORTCUT_AUTO_LEDGER_PENDING_FILENAME);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('globalThis.btoa 不可用，无法读取快捷指令截图');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

/**
 * 读取 App Intent 写入的待处理截图，返回 `data:image/png;base64,...`。
 * 成功读取后会删除 pending 文件，避免重复记账。
 */
export async function consumeShortcutAutoLedgerImageDataUri(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  const file = getShortcutAutoLedgerPendingFile();
  if (!file.exists) {
    return null;
  }

  try {
    const buf = await file.arrayBuffer();
    if (!buf.byteLength) {
      file.delete();
      return null;
    }
    const b64 = bytesToBase64(new Uint8Array(buf));
    const dataUri = `data:image/png;base64,${b64}`;
    file.delete();
    return dataUri;
  } catch (e) {
    console.warn('consumeShortcutAutoLedgerImageDataUri failed:', e);
    try {
      if (file.exists) {
        file.delete();
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}
