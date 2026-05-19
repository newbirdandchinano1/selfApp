import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import {
  abandonStaleShortcutHandoff,
  getShortcutHandoffKey,
  prepareShortcutHandoffLaunchIntent,
} from '@/lib/shortcut-auto-ledger-handoff';
import { notifyShortcutHandoffConsume } from '@/lib/shortcut-auto-ledger-route-bridge';
import * as Linking from 'expo-linking';
import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { InteractionManager, Platform } from 'react-native';

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
export function ScreenshotDeepLinkListener() {
  const router = useRouter();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const navReady = rootNavigationState?.key != null;
  const lastHandoffKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !navReady) {
      return;
    }

    abandonStaleShortcutHandoff();

    const routeForHandoff = (handoffKey: string) => {
      if (lastHandoffKeyRef.current === handoffKey && isOnFinanceTab(pathname)) {
        prepareShortcutHandoffLaunchIntent();
        notifyShortcutHandoffConsume();
        return;
      }
      lastHandoffKeyRef.current = handoffKey;

      const run = () => {
        if (!prepareShortcutHandoffLaunchIntent()) {
          return;
        }
        if (isOnFinanceTab(pathname)) {
          notifyShortcutHandoffConsume();
          return;
        }
        router.replace('/(tabs)/finance');
      };

      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(run);
      });
    };

    const handoffFromPendingFiles = () => {
      const handoffKey = getShortcutHandoffKey();
      if (!handoffKey) {
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
    return () => {
      linkingSub.remove();
    };
  }, [navReady, pathname, router]);

  return null;
}
