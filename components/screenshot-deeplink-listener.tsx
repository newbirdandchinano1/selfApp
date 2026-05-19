import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import {
  consumeShortcutClipboardMarker,
  hasShortcutAutoLedgerPending,
} from '@/lib/shortcut-auto-ledger-pending';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

function matchesScreenshotDeepLink(url: string): boolean {
  const { hostname, path } = Linking.parse(url);
  const normalizedPath = (path ?? '').replace(/^\/+|\/+$/g, '');
  return (
    hostname === 'screenshot' ||
    normalizedPath === 'screenshot' ||
    /:\/\/screenshot(\/|\?|$)/i.test(url)
  );
}

function matchesAutoLedgerDeepLink(url: string): boolean {
  const { hostname, path } = Linking.parse(url);
  const normalizedPath = (path ?? '').replace(/^\/+|\/+$/g, '');
  return (
    hostname === 'auto-ledger' ||
    normalizedPath === 'auto-ledger' ||
    /:\/\/auto-ledger(\/|\?|$)/i.test(url)
  );
}

/**
 * 在数据库就绪后挂载：处理冷启动 `getInitialURL` 与后台唤起 `url` 事件。
 * - `zheng://auto-ledger`：App Intent 已写入待处理截图 → 财务 Tab 自动记账
 * - `zheng://screenshot`：兼容旧剪贴板流程，在财务页弹窗内读取剪贴板
 */
export function ScreenshotDeepLinkListener() {
  const router = useRouter();

  useEffect(() => {
    const goToFinanceForShortcutHandoff = () => {
      if (Platform.OS === 'web') return;
      if (hasShortcutAutoLedgerPending()) {
        router.replace('/(tabs)/finance');
        return;
      }
      if (consumeShortcutClipboardMarker()) {
        setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_pending' });
        router.replace('/(tabs)/finance');
      }
    };

    const go = (url: string) => {
      if (matchesAutoLedgerDeepLink(url)) {
        router.replace('/(tabs)/finance');
        return;
      }
      if (matchesScreenshotDeepLink(url)) {
        setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_pending' });
        router.replace('/(tabs)/finance');
      }
    };

    goToFinanceForShortcutHandoff();

    void Linking.getInitialURL().then((initial) => {
      if (initial) go(initial);
    });

    const linkingSub = Linking.addEventListener('url', ({ url }) => go(url));
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        goToFinanceForShortcutHandoff();
      }
    });
    return () => {
      linkingSub.remove();
      appStateSub.remove();
    };
  }, [router]);

  return null;
}
