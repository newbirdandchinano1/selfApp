import { FinanceDeeplinkLoading } from '@/components/finance/finance-deeplink-loading';
import { scheduleConsumeAutoLedger } from '@/lib/auto-ledger-runner';
import { prepareShortcutHandoffLaunchIntent } from '@/lib/shortcut-auto-ledger-handoff';
import { notifyShortcutHandoffConsume } from '@/lib/shortcut-auto-ledger-route-bridge';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

/**
 * 深链 `zheng://auto-ledger`：App Intent 已写入待处理截图，跳转财务页自动记账。
 * Loading UI 对齐设计稿 18 · 轨道旋转 / 步骤推进；无业务界面。
 */
export default function AutoLedgerRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    const goFinance = () => {
      void prepareShortcutHandoffLaunchIntent();
      scheduleConsumeAutoLedger('handoff');
      router.replace('/(tabs)/finance');
      notifyShortcutHandoffConsume();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          notifyShortcutHandoffConsume();
        });
      });
    };
    /** 略作停留，让 Loading 步骤与轨道动效可见 */
    const t = setTimeout(goFinance, 720);
    return () => {
      clearTimeout(t);
    };
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <FinanceDeeplinkLoading variant="auto-ledger" />
    </>
  );
}
