import { FinanceTransactionSheetModal } from '@/components/finance/finance-transaction-sheet-modal';
import { subscribeFinanceSheetOpen } from '@/lib/finance-sheet-controller';
import { getFinanceSheetBridge } from '@/lib/finance-sheet-bridge';
import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import React from 'react';

/**
 * 全局记账弹窗宿主：财务 Tab 未挂载时在此渲染底部弹窗；
 * 财务 Tab 已挂载时由 finance.tsx 注册的 bridge 接管。
 */
export function FinanceSheetHost() {
  const [visible, setVisible] = React.useState(false);
  const [launchIntent, setLaunchIntent] = React.useState<FinanceSheetLaunchIntent | null>(null);

  React.useEffect(() => {
    return subscribeFinanceSheetOpen((intent) => {
      if (getFinanceSheetBridge()?.open) {
        getFinanceSheetBridge()!.open(intent);
        return;
      }
      setLaunchIntent(intent);
      setVisible(true);
    });
  }, []);

  const handleClose = React.useCallback(() => {
    setVisible(false);
    setLaunchIntent(null);
  }, []);

  if (!visible) return null;

  return (
    <FinanceTransactionSheetModal
      visible={visible}
      launchIntent={launchIntent}
      onClose={handleClose}
      onSaved={() => {
        setVisible(false);
        setLaunchIntent(null);
      }}
    />
  );
}
