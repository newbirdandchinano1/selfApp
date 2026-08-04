import { Stack } from 'expo-router';

import { CashFlowProvider } from '@/screens/finance/cash-flow/cash-flow-ui';

export default function CashFlowLayout() {
  return (
    <CashFlowProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </CashFlowProvider>
  );
}
