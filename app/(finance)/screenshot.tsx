import { FinanceDeeplinkLoading } from '@/components/finance/finance-deeplink-loading';
import { setFinanceSheetLaunchIntent } from '@/lib/finance-transaction-sheet/controller';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

/**
 * 兼容旧链接 zheng://screenshot：标记剪贴板自动记账意图后跳转财务主 Tab。
 * Loading UI 对齐设计稿 19 · 扫描角标 / 步骤推进；无业务界面。
 */
export default function ScreenshotRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_pending' });
    const t = setTimeout(() => {
      router.replace('/(tabs)/finance');
    }, 720);
    return () => {
      clearTimeout(t);
    };
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <FinanceDeeplinkLoading variant="screenshot" />
    </>
  );
}
