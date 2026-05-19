import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** 与 `plugins/with-zheng-app-intents.js` 中 Swift 写入的文件名保持一致 */
export const SHORTCUT_AUTO_LEDGER_PENDING_FILENAME = 'shortcut-auto-ledger-pending.png';

/** App Intent 未传截图时写入，财务页改走剪贴板记账 */
export const SHORTCUT_AUTO_LEDGER_CLIPBOARD_MARKER_FILENAME =
  'shortcut-auto-ledger-clipboard.marker';

export function getShortcutAutoLedgerPendingFile(): File {
  return new File(Paths.document, SHORTCUT_AUTO_LEDGER_PENDING_FILENAME);
}

export function getShortcutClipboardMarkerFile(): File {
  return new File(Paths.document, SHORTCUT_AUTO_LEDGER_CLIPBOARD_MARKER_FILENAME);
}

/** 是否有待处理的快捷指令截图（不删除文件） */
export function hasShortcutAutoLedgerPending(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }
  return getShortcutAutoLedgerPendingFile().exists;
}

/** 是否有剪贴板记账标记（不删除） */
export function hasShortcutClipboardMarker(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }
  return getShortcutClipboardMarkerFile().exists;
}

function isFileOlderThan(file: File, maxAgeMs: number): boolean {
  if (!file.exists) {
    return false;
  }
  const mtime = file.modificationTime;
  if (mtime == null || !Number.isFinite(mtime)) {
    return false;
  }
  return Date.now() - mtime > maxAgeMs;
}

/** 删除超时未处理的 handoff 文件，避免每次启动都误触发跳转 */
export function clearShortcutHandoffArtifacts(maxAgeMs: number): void {
  if (Platform.OS === 'web') {
    return;
  }
  const pending = getShortcutAutoLedgerPendingFile();
  const marker = getShortcutClipboardMarkerFile();
  try {
    if (isFileOlderThan(pending, maxAgeMs)) {
      pending.delete();
    }
  } catch {
    /* ignore */
  }
  try {
    if (isFileOlderThan(marker, maxAgeMs)) {
      marker.delete();
    }
  } catch {
    /* ignore */
  }
}

/**
 * 消费「走剪贴板」标记；存在则删除并返回 true。
 */
export function consumeShortcutClipboardMarker(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }
  const file = getShortcutClipboardMarkerFile();
  if (!file.exists) {
    return false;
  }
  try {
    file.delete();
  } catch {
    /* ignore */
  }
  return true;
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
