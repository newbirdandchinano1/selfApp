/**
 * Extracts finance transaction sheet Modal block from finance.tsx into a standalone component skeleton.
 * Run: node scripts/extract-sheet-to-component.mjs
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const financePath = path.join(root, 'app/(tabs)/finance.tsx');
const content = fs.readFileSync(financePath, 'utf8');
const lines = content.split(/\r?\n/);

const modalLine = lines.findIndex((l) => l.includes('<Modal visible={isSheetVisible}'));
let modalEnd = -1;
let depth = 0;
for (let i = modalLine; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('<Modal')) depth++;
  if (line.trim() === '</Modal>') {
    depth--;
    if (depth === 0) {
      modalEnd = i;
      break;
    }
  }
}

const modalInner = lines.slice(modalLine + 1, modalEnd);
// Replace isSheetVisible with visible prop usage - outer wrapper will be Modal with visible prop
const modalBody = modalInner.join('\n');

const styleStart = lines.findIndex((l) => l.trim() === 'sheetOverlay: {');
let styleEnd = styleStart;
for (let i = styleStart + 1; i < lines.length; i++) {
  if (lines[i].trim() === '},' && lines[i + 1]?.trim().startsWith('budgetKeyboardAvoidingRoot')) {
    styleEnd = i;
    break;
  }
}
const sheetStyleLines = lines.slice(styleStart, styleEnd + 1);

const out = `/* eslint-disable -- auto-extracted from finance.tsx; refine imports as needed */
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  loadFinanceDefaultAccounts,
  sanitizeFinanceDefaultAccounts,
  type FinanceDefaultAccounts,
} from '@/lib/finance-default-accounts';
import { resolveFinanceAccountForAutoLedgerWithDefaults } from '@/lib/finance-account-match';
import { notifyFinanceSheetSaved } from '@/lib/finance-sheet-controller';
import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import {
  createFinanceTransaction,
  getFinanceAccountsWithBalance,
  validateFinanceLedgerBalanceAfterChange,
} from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import { scheduleGithubFinanceCloudSyncDebounced } from '@/lib/github-cloud-sync';
import {
  getActiveAiLlmApiKey,
  getActiveAiLlmProviderLabel,
  isActiveAiLlmConfigured,
  parseFinanceOneLinerFromText,
} from '@/lib/zhipu-image-parse';
import {
  buildExpenseCategories,
  buildIncomeCategories,
  parseFinanceSentenceLocal,
  pickSheetCategoryForParsed,
  type AccountPickerTarget,
  type ParsedOneLiner,
  type SentenceLedgerPreviewState,
  type SentenceResolveResult,
  type SheetCategory,
  type SheetTab,
} from '@/lib/finance-transaction-sheet/helpers';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export type FinanceTransactionSheetModalProps = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

// NOTE: Component implementation is in finance-sheet-host.tsx which wires state + this view.
`;

fs.writeFileSync(path.join(root, 'components/finance/_extracted-modal-body.txt'), modalBody);
fs.writeFileSync(path.join(root, 'components/finance/_extracted-modal-styles.txt'), sheetStyleLines.join('\n'));
console.log('Modal lines', modalLine + 1, '-', modalEnd + 1, 'length', modalBody.length);
