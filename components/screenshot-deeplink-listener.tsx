import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import {
  abandonStaleShortcutHandoff,
  getShortcutHandoffKey,
  peekShortcutHandoffKind,
  prepareShortcutHandoffLaunchIntent,
} from '@/lib/shortcut-auto-ledger-handoff';
import { notifyShortcutHandoffConsume } from '@/lib/shortcut-auto-ledger-route-bridge';
import * as Linking from 'expo-linking';
import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
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

const FINANCE_TAB_PATH = '/finance';

function isOnFinanceTab(pathname: string): boolean {
  return pathname === FINANCE_TAB_PATH || pathname.endsWith('/finance');
}

/**
 * 在数据库就绪后挂载：处理深链与 App Intent 写入的 pending 文件。
 * 导航必须等 Root Navigation 就绪后再 replace，否则易出现全黑卡死屏。
 */
function scheduleHandoffConsumeNotify(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      notifyShortcutHandoffConsume();
    });
  });
}

export function ScreenshotDeepLinkListener() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const rootNavigationState = useRootNavigationState();
  const navReady = rootNavigationState?.key != null;
  const lastHandoffKeyRef = useRef<string | null>(null);

  pathnameRef.current = pathname;

  useEffect(() => {
    if (Platform.OS === 'web' || !navReady) {
      return;
    }

    abandonStaleShortcutHandoff();

    const routeForHandoff = (handoffKey: string) => {
      const currentPath = pathnameRef.current;
      if (lastHandoffKeyRef.current === handoffKey && isOnFinanceTab(currentPath)) {
        scheduleHandoffConsumeNotify();
        return;
      }
      lastHandoffKeyRef.current = handoffKey;

      const run = () => {
        if (!prepareShortcutHandoffLaunchIntent()) {
          return;
        }
        const pathAfterPrepare = pathnameRef.current;
        if (isOnFinanceTab(pathAfterPrepare)) {
          scheduleHandoffConsumeNotify();
          return;
        }
        router.replace('/(tabs)/finance');
        scheduleHandoffConsumeNotify();
      };

      requestAnimationFrame(run);
    };

    const handoffFromPendingFiles = () => {
      const handoffKey = getShortcutHandoffKey();
      if (!handoffKey) {
        lastHandoffKeyRef.current = null;
        return;
      }
      routeForHandoff(handoffKey);
    };

    const go = (url: string) => {
      if (matchesAutoLedgerDeepLink(url)) {
        routeForHandoff(`url:auto-ledger`);
        return;
      }
      if (matchesScreenshotDeepLink(url)) {
        setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_pending' });
        routeForHandoff('url:screenshot');
      }
    };

    handoffFromPendingFiles();

    void Linking.getInitialURL().then((initial) => {
      if (initial) {
        go(initial);
      }
    });

    const linkingSub = Linking.addEventListener('url', ({ url }) => go(url));

    let appStateRetryTimer: ReturnType<typeof setTimeout> | null = null;

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        return;
      }
      handoffFromPendingFiles();
      // Intent 写入 pending 图可能略晚于 active，截图参数流程再扫一次
      if (appStateRetryTimer != null) {
        clearTimeout(appStateRetryTimer);
        appStateRetryTimer = null;
      }
      if (peekShortcutHandoffKind() === 'image') {
        appStateRetryTimer = setTimeout(handoffFromPendingFiles, 180);
      }
    });

    return () => {
      linkingSub.remove();
      appStateSub.remove();
      if (appStateRetryTimer != null) {
        clearTimeout(appStateRetryTimer);
      }
    };
  }, [navReady, pathname, router]);

  return null;
}
