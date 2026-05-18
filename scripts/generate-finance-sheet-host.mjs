import fs from 'fs';
import path from 'path';

const root = process.cwd();
const modalBody = fs.readFileSync(path.join(root, 'components/finance/_extracted-modal-body.txt'), 'utf8');
const sheetStyles = fs.readFileSync(path.join(root, 'components/finance/_extracted-modal-styles.txt'), 'utf8');

const viewFile = `import React from 'react';
import type { FinanceTransactionSheetController } from '@/hooks/use-finance-transaction-sheet-controller';

export type FinanceTransactionSheetViewProps = {
  c: FinanceTransactionSheetController;
};

export function FinanceTransactionSheetView({ c }: FinanceTransactionSheetViewProps) {
  const {
    styles,
    insets,
    isDark,
    surface,
    text,
    subtle,
    outlineVariant,
    tertiary,
    primary,
    secondary,
    router,
    closeSheet,
    sheetKeyboardInset,
    sheetModalMaxHeight,
    sheetModalBodyMaxHeight,
    activeSheetTab,
    resetSheetForm,
    transferFromAccount,
    transferToAccount,
    transferFromAccountId,
    transferToAccountId,
    setTransferFromAccountId,
    setTransferToAccountId,
    setIsDatePickerVisible,
    setIsTimePickerVisible,
    setIsAccountPickerVisible,
    setAccountPickerTarget,
    accountIcon,
    amountDisplay,
    sheetDateLabel,
    sheetTimeLabel,
    sheetNote,
    setSheetNote,
    isDatePickerVisible,
    isTimePickerVisible,
    selectedHappenedAt,
    handleChangeSheetDate,
    handleChangeSheetTime,
    handleAmountKeyPress,
    handleSaveTransaction,
    canSaveTransaction,
    activeCategories,
    selectedCategoryKey,
    setSelectedCategoryKey,
    zhipuTxnReady,
    aiLlmProviderLabel,
    sheetSentence,
    setSheetSentence,
    sentenceLedgerPreview,
    isSentencePreviewBusy,
    handleSentenceLedgerPreview,
    canSaveSentence,
    isParsingSentence,
    sheetIncludeInBudget,
    setSheetIncludeInBudget,
    selectedAccount,
    sheetImageUris,
    setSheetImageUris,
    formatCurrencyWithDecimals,
    handleDatePickerChange,
    handleTimePickerChange,
    isAccountPickerVisible,
    accountPickerTarget,
    financeAccounts,
    handleSelectAccount,
    formatCurrencyBalanceForAccount,
    accountPickerTarget: _apt,
    keypadRows,
  } = c;

  return (
${modalBody.replace(/closeSheet/g, 'closeSheet').replace(/styles\./g, 'styles.')}
  );
}
`;

// Fix: modal body uses styles from outer - pass via c.styles
const viewFileFixed = viewFile.replace(
  'return (\n',
  'return (\n    <>',
).replace(/\n}$/, '\n    </>\n  );\n}');

fs.writeFileSync(path.join(root, 'components/finance/finance-transaction-sheet-view.tsx'), viewFileFixed);
console.log('wrote view', viewFileFixed.length);
