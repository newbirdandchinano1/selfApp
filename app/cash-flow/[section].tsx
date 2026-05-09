import { Redirect, useLocalSearchParams } from 'expo-router';

import { CashFlowShell, parseCashFlowSectionSlug } from './cash-flow-ui';

export default function CashFlowSectionRoute() {
  const { section } = useLocalSearchParams<{ section: string | string[] }>();
  const raw = Array.isArray(section) ? section[0] : section;
  const tab = parseCashFlowSectionSlug(raw);
  if (!tab) return <Redirect href="/cash-flow" />;
  return <CashFlowShell route={tab} />;
}
