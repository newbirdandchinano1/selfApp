import fs from 'fs';
import path from 'path';

const root = process.cwd();
const financePath = path.join(root, 'app/(tabs)/finance.tsx');
const lines = fs.readFileSync(financePath, 'utf8').split(/\r?\n/);
const modalBody = fs.readFileSync(path.join(root, 'components/finance/_extracted-modal-body.txt'), 'utf8');

const styleStart = lines.findIndex((l) => l.trim() === 'sheetOverlay: {');
const styleEnd = lines.findIndex((l) => l.trim() === 'autoLedgerToastWrap: {') - 1;

const styleBlock = lines.slice(styleStart, styleEnd).join('\n');

const stylesFile = `import { StyleSheet } from 'react-native';

export const financeTransactionSheetStyles = StyleSheet.create({
${styleBlock}
});
`;

fs.writeFileSync(path.join(root, 'lib/finance-transaction-sheet/styles.ts'), stylesFile);

const destructureList = `
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
    keypadRows,
    setSelectedHappenedAt,
  } = c;
`;

const viewFile = `import type { FinanceTransactionSheetController } from '@/hooks/use-finance-transaction-sheet-controller';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

export function FinanceTransactionSheetView({ c }: { c: FinanceTransactionSheetController }) {
${destructureList}
  return (
${modalBody}
  );
}
`;

fs.writeFileSync(path.join(root, 'components/finance/finance-transaction-sheet-view.tsx'), viewFile);
console.log('done styles', styleStart + 1, '-', styleEnd);
