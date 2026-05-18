import { FinanceTransactionSheetView } from '@/components/finance/finance-transaction-sheet-view';
import {
  useFinanceTransactionSheetController,
  type FinanceTransactionSheetControllerOptions,
} from '@/hooks/use-finance-transaction-sheet-controller';
import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import React from 'react';
import { Modal } from 'react-native';

export type FinanceTransactionSheetModalProps = FinanceTransactionSheetControllerOptions & {
  visible: boolean;
  launchIntent?: FinanceSheetLaunchIntent | null;
};

export function FinanceTransactionSheetModal({
  visible,
  launchIntent,
  onClose,
  onSaved,
}: FinanceTransactionSheetModalProps) {
  const controller = useFinanceTransactionSheetController({
    visible,
    launchIntent,
    onClose,
    onSaved,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={controller.closeSheet}>
      <FinanceTransactionSheetView c={controller} />
    </Modal>
  );
}
