import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import { markShortcutImageHandoffExpected } from '@/lib/shortcut-auto-ledger-route-bridge';
import {
  clearShortcutHandoffArtifacts,
  consumeShortcutClipboardMarker,
  getShortcutAutoLedgerPendingFile,
  getShortcutClipboardMarkerFile,
  hasShortcutAutoLedgerPending,
  hasShortcutClipboardMarker,
} from '@/lib/shortcut-auto-ledger-pending';

export type ShortcutHandoffKind = 'image' | 'clipboard';

/** 是否存在待处理的快捷指令记账（不消费截图文件） */
export function peekShortcutHandoffKind(): ShortcutHandoffKind | null {
  if (hasShortcutAutoLedgerPending()) {
    return 'image';
  }
  if (hasShortcutClipboardMarker()) {
    return 'clipboard';
  }
  return null;
}

/** 用于区分多次快捷指令 handoff，避免重复导航但允许新截图再次触发 */
export function getShortcutHandoffKey(): string | null {
  const kind = peekShortcutHandoffKind();
  if (!kind) {
    return null;
  }
  if (kind === 'image') {
    const file = getShortcutAutoLedgerPendingFile();
    return `image:${file.modificationTime ?? 0}`;
  }
  const file = getShortcutClipboardMarkerFile();
  return `clipboard:${file.modificationTime ?? 0}`;
}

/**
 * 进入财务 Tab 前调用：剪贴板模式写入 launch intent；截图模式仅依赖 pending 文件。
 * 返回是否有 handoff。
 */
export function prepareShortcutHandoffLaunchIntent(): boolean {
  const kind = peekShortcutHandoffKind();
  if (kind === 'clipboard') {
    if (!consumeShortcutClipboardMarker()) {
      return false;
    }
    setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_pending' });
    return true;
  }
  if (kind === 'image') {
    markShortcutImageHandoffExpected();
    return true;
  }
  return false;
}

/** 清除可能卡死启动流程的陈旧 handoff 文件（如快捷指令中途失败） */
export function abandonStaleShortcutHandoff(maxAgeMs = 15 * 60 * 1000): void {
  clearShortcutHandoffArtifacts(maxAgeMs);
}
