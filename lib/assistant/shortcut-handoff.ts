/**
 * App Intent「用助手处理」pending 文件（与 with-zheng-app-intents.js 文件名一致）。
 */
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export const SHORTCUT_ASSISTANT_PENDING_FILENAME = 'shortcut-assistant-pending.png';
export const SHORTCUT_ASSISTANT_CLIPBOARD_MARKER_FILENAME =
  'shortcut-assistant-clipboard.marker';

export function getShortcutAssistantPendingFile(): File {
  return new File(Paths.document, SHORTCUT_ASSISTANT_PENDING_FILENAME);
}

export function getShortcutAssistantClipboardMarkerFile(): File {
  return new File(Paths.document, SHORTCUT_ASSISTANT_CLIPBOARD_MARKER_FILENAME);
}

export function hasShortcutAssistantPending(): boolean {
  if (Platform.OS === 'web') return false;
  return getShortcutAssistantPendingFile().exists;
}

export function hasShortcutAssistantClipboardMarker(): boolean {
  if (Platform.OS === 'web') return false;
  return getShortcutAssistantClipboardMarkerFile().exists;
}

function isFileOlderThan(file: File, maxAgeMs: number): boolean {
  if (!file.exists) return false;
  const mtime = file.modificationTime;
  if (mtime == null || !Number.isFinite(mtime)) return false;
  return Date.now() - mtime > maxAgeMs;
}

export function clearShortcutAssistantArtifacts(maxAgeMs = 15 * 60 * 1000): void {
  if (Platform.OS === 'web') return;
  for (const file of [
    getShortcutAssistantPendingFile(),
    getShortcutAssistantClipboardMarkerFile(),
  ]) {
    try {
      if (isFileOlderThan(file, maxAgeMs)) file.delete();
    } catch {
      /* ignore */
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('globalThis.btoa 不可用');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

/** 读取并删除 pending 图，返回 data URI */
export async function consumeShortcutAssistantPendingImage(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const file = getShortcutAssistantPendingFile();
  if (!file.exists) return null;
  try {
    const buf = await file.arrayBuffer();
    if (!buf.byteLength) {
      file.delete();
      return null;
    }
    const dataUri = `data:image/png;base64,${bytesToBase64(new Uint8Array(buf))}`;
    file.delete();
    return dataUri;
  } catch {
    try {
      if (file.exists) file.delete();
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function consumeShortcutAssistantClipboardMarker(): boolean {
  if (Platform.OS === 'web') return false;
  const file = getShortcutAssistantClipboardMarkerFile();
  if (!file.exists) return false;
  try {
    file.delete();
    return true;
  } catch {
    return false;
  }
}

export function getShortcutAssistantHandoffKey(): string | null {
  if (hasShortcutAssistantPending()) return 'assistant:image';
  if (hasShortcutAssistantClipboardMarker()) return 'assistant:clipboard';
  return null;
}
