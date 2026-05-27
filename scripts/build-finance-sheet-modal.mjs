import fs from 'fs';
import path from 'path';

const root = process.cwd();
const financePath = path.join(root, 'app/(tabs)/finance.tsx');
const lines = fs.readFileSync(financePath, 'utf8').split(/\r?\n/);

// Helpers: lines 236-312 (1-based)
const helpers = lines.slice(235, 312).join('\n');

// Find sheet styles block
const styleStartIdx = lines.findIndex((l) => l.trim() === 'sheetOverlay: {');
let styleEndIdx = styleStartIdx;
let depth = 0;
for (let i = styleStartIdx; i < lines.length; i++) {
  if (lines[i].includes('sheetOverlay:') || lines[i].match(/^\s+\w+:/)) {
    if (lines[i].includes('{')) depth++;
  }
  if (lines[i].trim() === '},' && i > styleStartIdx) {
    styleEndIdx = i;
    if (lines[i + 1]?.trim().startsWith('budgetKeyboardAvoidingRoot')) break;
  }
}
const sheetStyles = lines.slice(styleStartIdx, styleEndIdx + 1).join('\n');

const header = `/**
 * 财务记账/转账底部弹窗（从 finance 页提取，供财务 Tab 与账户详情等共用）
 */
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  loadFinanceDefaultAccounts,
  sanitizeFinanceDefaultAccounts,
  type FinanceDefaultAccounts,
} from '@/lib/finance-default-accounts';
import { resolveFinanceAccountForAutoLedgerWithDefaults } from '@/lib/finance-account-match';
import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import { notifyFinanceSheetSaved } from '@/lib/finance-sheet-controller';
import {
  createFinanceTransaction,
  getFinanceAccountsWithBalance,
  getFinanceFlowCategories,
  validateFinanceLedgerBalanceAfterChange,
} from '@/lib/repositories/finance/finance';
import { scheduleGithubFinanceCloudSyncDebounced } from '@/lib/github-cloud-sync';
import {
  getActiveAiLlmApiKey,
  isActiveAiLlmConfigured,
  parseFinanceOneLinerFromText,
} from '@/lib/zhipu-image-parse';
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

`;

const footer = `
export type FinanceTransactionSheetModalProps = {
  visible: boolean;
  onClose: () => void;
  /** 打开时应用的意图（manual / transfer） */
  launchIntent?: FinanceSheetLaunchIntent | null;
  onSaved?: () => void;
};

// PLACEHOLDER: component body will be added in finance-transaction-sheet-modal.tsx manually
`;

const outPath = path.join(root, 'components/finance/finance-transaction-sheet-modal.tsx');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  header + helpers + '\n\nconst sheetStyles = StyleSheet.create({\n' + sheetStyles + '\n});\n\n' + footer,
);
console.log('Wrote skeleton to', outPath, 'styles', styleStartIdx + 1, '-', styleEndIdx + 1);
