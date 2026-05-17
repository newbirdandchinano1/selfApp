import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

/**
 * 深链 `zheng://auto-ledger`：App Intent 已写入待处理截图，跳转财务页自动记账。
 */
export default function AutoLedgerRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
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
