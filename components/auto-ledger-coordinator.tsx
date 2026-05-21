import { scheduleConsumeAutoLedger } from '@/lib/auto-ledger-runner';
import { subscribeShortcutHandoffConsume } from '@/lib/shortcut-auto-ledger-route-bridge';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

type Props = {
  dbReady: boolean;
};

/**
 * 根级挂载：快捷指令/深链触发的自动记账在后台继续执行，不依赖财务 Tab 聚焦或应用保持前台。
 */
export function AutoLedgerCoordinator({ dbReady }: Props) {
  useEffect(() => {
    if (!dbReady || Platform.OS === 'web') {
      return;
    }

    scheduleConsumeAutoLedger('bootstrap');

    const unsubHandoff = subscribeShortcutHandoffConsume(() => {
      scheduleConsumeAutoLedger('handoff');
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        scheduleConsumeAutoLedger('active');
      }
    });

    return () => {
      unsubHandoff();
      appStateSub.remove();
    };
  }, [dbReady]);

  return null;
}
