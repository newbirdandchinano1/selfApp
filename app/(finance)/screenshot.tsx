import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

/** 兼容旧链接 zheng://screenshot，重定向到财务页弹窗记账。 */
export default function ScreenshotRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_pending' });
    router.replace('/(tabs)/finance');
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    </>
  );
}
