import { AppInput, Skeleton } from '@/components/ui';
import { FoldPopIn, FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { Layout, Spacing } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { formatFinanceHappenedAt } from '@/lib/api-mysql-datetime';
import {
  FINANCE_ACCOUNT_ICON_OPTIONS,
  type FinanceAccountIconOption,
} from '@/lib/constants/finance-account-icons';
import { clearFinanceLastUsedAccountIfDeleted } from '@/lib/finance-last-used-account';
import { fetchFinanceCatalog } from '@/lib/finance-page-api';
import {
  applyFinanceAccountBalanceCorrection,
  createFinanceAccount,
  createFinanceTransaction,
  deleteFinanceAccount,
  deleteFinanceAccountTypeByName,
  financeBalanceInputTextFromLedger,
  financeTargetLedgerFromUserBalanceInput,
  getFinanceAccounts,
  loadFinanceAccountDetail,
  updateFinanceAccount,
  upsertFinanceAccountType,
} from '@/lib/repositories/finance/finance';
import {
  FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS,
  FINANCE_ACCOUNT_EXTRA_HIDE_FROM_HOME,
  isFinanceAccountExcludedFromAggregates,
  isFinanceAccountHiddenFromHome,
} from '@/lib/repositories/finance/finance-account-extra';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import {
  getCustomAccountTypeDraft,
  getCustomAccountTypeOptions,
  removeCustomAccountTypeOption,
  setCustomAccountTypeDraft,
  upsertCustomAccountTypeOption,
} from '@/lib/state/account-type-draft';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const ICON_ROW_COUNT = 5;

type AccountType = 'cash_wallet' | 'bank' | 'investment' | 'liability' | 'custom';

const BASE_TYPE_OPTIONS: {
  key: Exclude<AccountType, 'custom'>;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { key: 'cash_wallet', label: '现金', icon: 'wallet' },
  { key: 'bank', label: '银行', icon: 'account-balance' },
  { key: 'investment', label: '投资', icon: 'show-chart' },
  { key: 'liability', label: '负债', icon: 'credit-card-off' },
];

function resolveAccountTypeLabel(accountType: AccountType, customTypeName: string): string {
  if (accountType === 'custom') return customTypeName.trim() || '自定义类型';
  return BASE_TYPE_OPTIONS.find((t) => t.key === accountType)?.label ?? '银行';
}

function applyExtraFlags(
  base: Record<string, unknown>,
  opts: { excludeFromTotalAssets: boolean; hideFromHome: boolean; isLiability: boolean },
): Record<string, unknown> {
  const next = { ...base };
  if (opts.excludeFromTotalAssets && !opts.isLiability) {
    next[FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS] = true;
  } else {
    delete next[FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS];
  }
  if (opts.hideFromHome) {
    next[FINANCE_ACCOUNT_EXTRA_HIDE_FROM_HOME] = true;
  } else {
    delete next[FINANCE_ACCOUNT_EXTRA_HIDE_FROM_HOME];
  }
  return next;
}

const PAGE_API_KEY = 'add-account';

export default function AddAccountScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ editAccountId?: string }>();
  const editAccountId = typeof params.editAccountId === 'string' ? params.editAccountId.trim() : '';
  const isEditMode = editAccountId.length > 0;

  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const clay = ff.clay;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';

  const iconGridGap = 6;
  const [iconGridWidth, setIconGridWidth] = React.useState(0);
  const iconCellLayout = React.useMemo(() => {
    if (iconGridWidth <= 0) return { base: 0, lastColExtra: 0 };
    const gaps = iconGridGap * (ICON_ROW_COUNT - 1);
    const base = Math.floor((iconGridWidth - gaps) / ICON_ROW_COUNT);
    const remainder = iconGridWidth - gaps - base * ICON_ROW_COUNT;
    return { base, lastColExtra: remainder };
  }, [iconGridGap, iconGridWidth]);

  const editExtraBaselineRef = React.useRef<Record<string, unknown>>({});
  const editLedgerMetaRef = React.useRef<{
    sign_rule: number;
    account_type: string;
    ledger_balance: number;
  }>({
    sign_rule: 1,
    account_type: 'asset',
    ledger_balance: 0,
  });

  const [accountType, setAccountType] = React.useState<AccountType>('bank');
  const [accountName, setAccountName] = React.useState('');
  const [accountNo, setAccountNo] = React.useState('');
  const [balance, setBalance] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [iconKey, setIconKey] = React.useState('savings');
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [savePop, setSavePop] = React.useState(false);
  const [includeInTotalAssets, setIncludeInTotalAssets] = React.useState(true);
  const [showOnHome, setShowOnHome] = React.useState(true);
  const [customTypeName, setCustomTypeName] = React.useState(() => getCustomAccountTypeDraft().name);
  const [customIsLiability, setCustomIsLiability] = React.useState(() => getCustomAccountTypeDraft().isLiability);
  const [customTypeOptions, setCustomTypeOptions] = React.useState<Array<{ name: string; isLiability: boolean }>>(
    [],
  );
  const [editSheetReady, setEditSheetReady] = React.useState(!isEditMode);
  const [iconPickerExpanded, setIconPickerExpanded] = React.useState(false);

  const [customTypeModalOpen, setCustomTypeModalOpen] = React.useState(false);
  const [modalTypeName, setModalTypeName] = React.useState('');
  const [modalIsLiability, setModalIsLiability] = React.useState(false);
  const [modalSaving, setModalSaving] = React.useState(false);

  const canSave =
    accountName.trim().length > 0 &&
    (isEditMode || accountType !== 'custom' || customTypeName.trim().length > 0) &&
    !saving &&
    (!isEditMode || editSheetReady);
  const isSelectedLiability = accountType === 'liability' || (accountType === 'custom' && customIsLiability);
  const collapsedIconOptions = React.useMemo(() => {
    const all = FINANCE_ACCOUNT_ICON_OPTIONS;
    const selectedIndex = all.findIndex((item) => item.key === iconKey);
    if (selectedIndex < 0 || selectedIndex < ICON_ROW_COUNT) {
      return all.slice(0, ICON_ROW_COUNT);
    }
    return [...all.slice(0, ICON_ROW_COUNT - 1), all[selectedIndex]!];
  }, [iconKey]);
  const iconOptionsToShow = iconPickerExpanded ? FINANCE_ACCOUNT_ICON_OPTIONS : collapsedIconOptions;
  const canExpandIcons = FINANCE_ACCOUNT_ICON_OPTIONS.length > ICON_ROW_COUNT;
  const accountTypeLabel = React.useMemo(
    () => resolveAccountTypeLabel(accountType, customTypeName),
    [accountType, customTypeName],
  );
  const motionOn = foldAnimate && (!isEditMode || editSheetReady);
  const headerTitle = isEditMode ? '编辑账户' : '添加账户';
  const headerSub = isEditMode ? 'ACCOUNT · EDIT' : 'ACCOUNT · NEW';

  const reloadCustomTypes = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        try {
          const catalog = await fetchFinanceCatalog({ serverFallback: true });
          const rows = catalog.accountTypes;
          setCustomTypeOptions(
            rows.map((row) => ({
              name: row.name,
              isLiability: row.is_liability === 1,
            })),
          );
        } catch (e) {
          console.warn('Failed to load custom account types:', e);
          setCustomTypeOptions(getCustomAccountTypeOptions());
        }
      }, forceRefresh);
    },
    [wrapLoad],
  );

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      if (isEditMode && editAccountId) {
        setEditSheetReady(false);
        await wrapLoad(async () => {
          try {
            const catalog = await fetchFinanceCatalog({ serverFallback: true });
            let row: FinanceAccountBalanceRow | null | undefined = catalog.accounts.find(
              (r) => r.id === editAccountId,
            );
            // catalog 偶发缺少仅本地可见账户时，回退本地详情，避免误报「账户不存在」
            if (!row) {
              const local = await loadFinanceAccountDetail({
                accountId: editAccountId,
                cacheOnly: true,
              });
              row = local.account;
            }
            if (!row) {
              Alert.alert('账户不存在', '该账户可能已被删除。', [{ text: '确定', onPress: () => router.back() }]);
              return;
            }
            setAccountName(row.name);
            setAccountNo(row.account_no ?? '');
            setNotes(row.note ?? '');
            editLedgerMetaRef.current = {
              sign_rule: row.sign_rule,
              account_type: row.account_type,
              ledger_balance: typeof row.balance === 'number' && Number.isFinite(row.balance) ? row.balance : 0,
            };
            setBalance(financeBalanceInputTextFromLedger(row.balance ?? 0, row.sign_rule, row.account_type));
            let parsed: Record<string, unknown> = {};
            try {
              parsed = row.extra_data ? (JSON.parse(row.extra_data) as Record<string, unknown>) : {};
            } catch {
              parsed = {};
            }
            editExtraBaselineRef.current = { ...parsed };
            const uiType = parsed.ui_account_type;
            if (
              uiType === 'cash_wallet' ||
              uiType === 'bank' ||
              uiType === 'investment' ||
              uiType === 'liability' ||
              uiType === 'custom'
            ) {
              setAccountType(uiType);
            } else if (row.account_type === 'liability') {
              setAccountType('liability');
            } else {
              setAccountType('bank');
            }
            if (typeof parsed.ui_custom_type_name === 'string') setCustomTypeName(parsed.ui_custom_type_name);
            if (typeof parsed.ui_is_liability === 'boolean') setCustomIsLiability(parsed.ui_is_liability);
            const ik = parsed.ui_icon_key;
            if (typeof ik === 'string' && ik.length > 0) setIconKey(ik);
            setIncludeInTotalAssets(!isFinanceAccountExcludedFromAggregates(row.extra_data));
            setShowOnHome(!isFinanceAccountHiddenFromHome(row.extra_data));
            setEditSheetReady(true);
          } catch (e) {
            console.warn('Failed to load account for edit:', e);
            Alert.alert('加载失败', '请稍后重试。', [{ text: '确定', onPress: () => router.back() }]);
          }
        }, forceRefresh);
        return;
      }

      setEditSheetReady(true);
      setBalance('');
      setIncludeInTotalAssets(true);
      setShowOnHome(true);
      const draft = getCustomAccountTypeDraft();
      setCustomTypeName(draft.name);
      setCustomIsLiability(draft.isLiability);
      await reloadCustomTypes(forceRefresh);
    },
    [editAccountId, isEditMode, reloadCustomTypes, router, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openCustomTypeModal = React.useCallback(() => {
    setModalTypeName('');
    setModalIsLiability(false);
    setCustomTypeModalOpen(true);
  }, []);

  const closeCustomTypeModal = React.useCallback(() => {
    if (modalSaving) return;
    setCustomTypeModalOpen(false);
  }, [modalSaving]);

  const onSaveCustomType = React.useCallback(async () => {
    const nextName = modalTypeName.trim();
    if (!nextName) {
      toast.warn('请输入类型名称');
      return;
    }
    setModalSaving(true);
    try {
      await upsertFinanceAccountType({
        name: nextName,
        is_liability: modalIsLiability ? 1 : 0,
      });
      const option = { name: nextName, isLiability: modalIsLiability };
      upsertCustomAccountTypeOption(option);
      setCustomAccountTypeDraft(option);
      setAccountType('custom');
      setCustomTypeName(nextName);
      setCustomIsLiability(modalIsLiability);
      setCustomTypeModalOpen(false);
      await reloadCustomTypes();
      toast.success('已保存');
    } catch (e) {
      console.warn('保存自定义类型失败:', e);
      toast.error(toUserMessage(e, '自定义类型保存失败，请稍后重试'));
    } finally {
      setModalSaving(false);
    }
  }, [modalIsLiability, modalTypeName, reloadCustomTypes]);

  const onSave = React.useCallback(async () => {
    Keyboard.dismiss();
    const name = accountName.trim();
    if (!name) {
      toast.warn('请输入账户名称');
      return;
    }

    if (isEditMode) {
      if (!editSheetReady) return;
      const normalizedBalanceText = balance.trim().replace(/[^\d.-]/g, '');
      const balanceNum = normalizedBalanceText ? Number(normalizedBalanceText) : 0;
      if (!Number.isFinite(balanceNum)) {
        toast.warn('请输入正确的数字金额');
        return;
      }
      const meta = editLedgerMetaRef.current;
      const targetLedger = financeTargetLedgerFromUserBalanceInput({
        userNumeric: balanceNum,
        signRule: meta.sign_rule as -1 | 1,
        accountType: meta.account_type,
      });

      setSaving(true);
      try {
        const mergedExtra = applyExtraFlags(
          {
            ...editExtraBaselineRef.current,
            ui_account_type: accountType === 'custom' ? 'custom' : accountType,
            ui_custom_type_name: accountType === 'custom' ? customTypeName.trim() || null : null,
            ui_is_liability: accountType === 'custom' ? customIsLiability : null,
            ui_icon_key: iconKey,
          },
          {
            excludeFromTotalAssets: !includeInTotalAssets,
            hideFromHome: !showOnHome,
            isLiability: meta.account_type === 'liability' || meta.sign_rule < 0,
          },
        );
        await updateFinanceAccount(editAccountId, {
          name,
          account_no: accountNo.trim() ? accountNo.trim() : null,
          note: notes.trim() ? notes.trim() : null,
          extra_data: JSON.stringify(mergedExtra),
        });
        await applyFinanceAccountBalanceCorrection({
          accountId: editAccountId,
          targetLedgerBalance: targetLedger,
          signRule: meta.sign_rule,
          accountType: meta.account_type,
          currentLedgerBalance: meta.ledger_balance,
        });
        setSavePop(true);
        toast.success('已保存');
        router.back();
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      } finally {
        setSaving(false);
      }
      return;
    }

    const isLiability = isSelectedLiability;
    const signRule: -1 | 1 = isLiability ? -1 : 1;
    const accountTypeDb = isLiability ? 'liability' : 'asset';

    const customType = customTypeName.trim();
    if (accountType === 'custom' && !customType) {
      toast.warn('请输入自定义类型名称');
      return;
    }

    const normalizedBalanceText = balance.trim().replace(/[^\d.-]/g, '');
    const rawBalance = normalizedBalanceText ? Number(normalizedBalanceText) : 0;
    const absInitial = Number.isFinite(rawBalance) ? Math.abs(rawBalance) : NaN;
    if (!Number.isFinite(absInitial)) {
      toast.warn('请输入正确的数字金额');
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const random = Math.random().toString(16).slice(2);
      const accountId = `fa_${now}_${random}`;

      const extra = applyExtraFlags(
        {
          ui_account_type: accountType === 'custom' ? 'custom' : accountType,
          ui_custom_type_name: accountType === 'custom' ? customType : null,
          ui_is_liability: accountType === 'custom' ? customIsLiability : null,
          ui_icon_key: iconKey,
        },
        {
          excludeFromTotalAssets: !includeInTotalAssets,
          hideFromHome: !showOnHome,
          isLiability,
        },
      );

      await createFinanceAccount({
        id: accountId,
        name,
        account_no: accountNo.trim() ? accountNo.trim() : null,
        account_type: accountTypeDb,
        sign_rule: signRule,
        note: notes.trim() ? notes.trim() : null,
        extra_data: JSON.stringify(extra),
      });

      if (absInitial > 0) {
        const txnId = `ft_init_${now}_${random}`;
        await createFinanceTransaction({
          id: txnId,
          name: '初始余额',
          happened_at: formatFinanceHappenedAt(new Date()),
          account_id: accountId,
          transaction_type: isLiability ? 'expense' : 'income',
          amount: signRule * absInitial,
          note: null,
          extra_data: JSON.stringify({ reason: 'initial_balance' }),
        });
      }

      setSavePop(true);
      toast.success('已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [
    accountName,
    accountNo,
    accountType,
    balance,
    customIsLiability,
    customTypeName,
    editAccountId,
    editSheetReady,
    iconKey,
    includeInTotalAssets,
    isEditMode,
    isSelectedLiability,
    notes,
    router,
    showOnHome,
  ]);

  const onDeleteAccount = React.useCallback(() => {
    if (!isEditMode || deleting || !editAccountId) return;
    const targetName = accountName.trim() || '该账户';
    Alert.alert('删除账户', `确认删除“${targetName}”吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeleting(true);
            await deleteFinanceAccount(editAccountId);
            await clearFinanceLastUsedAccountIfDeleted(editAccountId);
            toast.success('已删除');
            router.back();
          } catch (err) {
            console.warn('Failed to delete finance account:', err);
            toast.error(toUserMessage(err, '删除失败，请稍后重试'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }, [accountName, deleting, editAccountId, isEditMode, router]);

  const handleBalanceChange = React.useCallback((textValue: string) => {
    let s = textValue.replace(/[^\d.-]/g, '');
    const negative = s.startsWith('-');
    s = s.replace(/-/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) {
      s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    }
    if (negative) s = `-${s}`;
    setBalance(s);
  }, []);

  const hasAccountsForCustomType = React.useCallback(async (typeName: string) => {
    const targetTypeName = typeName.trim();
    if (!targetTypeName) return false;
    const accounts = await getFinanceAccounts();
    return accounts.some((acc) => {
      if (!acc.extra_data) return false;
      try {
        const raw = JSON.parse(acc.extra_data) as unknown;
        if (!raw || typeof raw !== 'object') return false;
        const obj = raw as Record<string, unknown>;
        const uiType = obj.ui_account_type;
        const uiCustomTypeName = typeof obj.ui_custom_type_name === 'string' ? obj.ui_custom_type_name.trim() : '';
        return uiType === 'custom' && uiCustomTypeName === targetTypeName;
      } catch {
        return false;
      }
    });
  }, []);

  const confirmDeleteCustomType = React.useCallback(
    (typeName: string, isLiabilityType: boolean) => {
      void (async () => {
        try {
          const hasRelatedAccounts = await hasAccountsForCustomType(typeName);
          if (hasRelatedAccounts) {
            toast.warn(`“${typeName}”下已有账户，请先删除或转移账户后再试`);
            return;
          }

          Alert.alert('删除自定义类型', `确认删除“${typeName}”吗？`, [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deleteFinanceAccountTypeByName(typeName);
                  removeCustomAccountTypeOption(typeName);
                  await reloadCustomTypes();
                  if (accountType === 'custom' && customTypeName === typeName) {
                    setAccountType('bank');
                    setCustomTypeName('');
                    setCustomIsLiability(false);
                  }
                  toast.success('已删除');
                } catch (e) {
                  console.warn('删除自定义类型失败:', e);
                  toast.error(toUserMessage(e, '删除失败，请稍后重试'));
                }
              },
            },
          ]);
        } catch (e) {
          console.warn('校验自定义类型是否可删除失败:', e);
          toast.error(toUserMessage(e, '操作失败，请稍后重试'));
        }
      })();
      void isLiabilityType;
    },
    [accountType, customTypeName, hasAccountsForCustomType, reloadCustomTypes],
  );

  const renderIconOption = (it: FinanceAccountIconOption, index: number) => {
    const active = it.key === iconKey;
    const col = index % ICON_ROW_COUNT;
    const row = Math.floor(index / ICON_ROW_COUNT);
    const totalRows = Math.ceil(iconOptionsToShow.length / ICON_ROW_COUNT);
    const cellWidth =
      iconCellLayout.base + (col === ICON_ROW_COUNT - 1 ? iconCellLayout.lastColExtra : 0);
    const cellHeight = Math.max(iconCellLayout.base, 35);

    return (
      <Pressable
        key={it.key}
        onPress={() => setIconKey(it.key)}
        style={({ pressed }) => [
          {
            width: cellWidth,
            height: cellHeight,
            marginRight: col === ICON_ROW_COUNT - 1 ? 0 : iconGridGap,
            marginBottom: row === totalRows - 1 ? 0 : iconGridGap,
          },
          pressed && styles.pressed,
        ]}>
        <View
          style={[
            styles.iconOpt,
            {
              backgroundColor: active
                ? isDark
                  ? 'rgba(134,167,149,0.22)'
                  : '#E7EFE9'
                : isDark
                  ? ff.paper2
                  : '#F8F3E9',
              borderColor: active ? (isDark ? ff.sage : '#9DBAAB') : isDark ? line : '#E5DBC9',
            },
          ]}>
          <MaterialIcons name={it.icon} size={18} color={active ? pine : subtle} />
        </View>
      </Pressable>
    );
  };

  const renderTypeChip = (
    key: string,
    active: boolean,
    onPress: (() => void) | undefined,
    onLongPress: (() => void) | undefined,
    label: string,
    icon?: keyof typeof MaterialIcons.glyphMap,
    opts?: { liabilityTint?: boolean; locked?: boolean },
  ) => (
    <Pressable
      key={key}
      onPress={opts?.locked ? undefined : onPress}
      onLongPress={opts?.locked ? undefined : onLongPress}
      disabled={opts?.locked && !active}
      style={({ pressed }) => [
        styles.typeChip,
        {
          backgroundColor: active ? pine : isDark ? ff.paper2 : '#F8F3E9',
          borderColor: active ? pine : line,
          opacity: opts?.locked && !active ? 0.55 : 1,
        },
        pressed && !opts?.locked && styles.pressed,
      ]}>
      {icon ? (
        <MaterialIcons
          name={icon}
          size={13}
          color={active ? ff.onPine : opts?.liabilityTint ? clay : subtle}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          styles.typeChipLabel,
          {
            color: active ? ff.onPine : opts?.liabilityTint ? clay : subtle,
            fontWeight: active ? '750' : '600',
          },
        ]}>
        {label}
      </Text>
    </Pressable>
  );

  const typeChipsLocked = isEditMode;

  const saveBarBottom = 10 + Math.max(insets.bottom, 8);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: headerScrim, borderBottomColor: line }]}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.foldIconBtn,
              { borderColor: line, backgroundColor: card },
              pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="返回">
            <MaterialIcons name="arrow-back" size={16} color={ff.ink2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>{headerTitle}</Text>
            <Text style={[styles.headerSub, { color: subtle }]} numberOfLines={1}>
              {headerSub}
            </Text>
          </View>
          <Pressable
            onPress={() => void onSave()}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.pillSave,
              {
                backgroundColor: canSave ? pine : isDark ? ff.paper2 : '#EAE6DC',
                borderColor: canSave ? pine : line,
                opacity: canSave ? 1 : 0.7,
              },
              pressed && canSave && { opacity: 0.9, transform: [{ scale: 0.96 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="保存">
            {savePop ? (
              <FoldPopIn animate={foldAnimate} delayMs={0} duration={320}>
                <Text style={[styles.pillSaveText, { color: canSave ? ff.onPine : faint }]}>
                  {saving ? '…' : '保存'}
                </Text>
              </FoldPopIn>
            ) : (
              <Text style={[styles.pillSaveText, { color: canSave ? ff.onPine : faint }]}>
                {saving ? '…' : '保存'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {isEditMode && !editSheetReady ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={pine} />
            <Text style={{ color: subtle, marginTop: 10, fontSize: 13 }}>加载账户…</Text>
            <Skeleton width={120} height={10} borderRadius={6} style={{ marginTop: 14 }} />
          </View>
        ) : (
          <ScrollView
            refreshControl={refreshControl}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingBottom: 82 + saveBarBottom,
                maxWidth: Layout.contentMaxWidth,
                alignSelf: 'center',
                width: '100%',
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
            <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={11}>
              <View style={[styles.formCard, { backgroundColor: card, borderColor: line, paddingVertical: 10 }]}>
                <View style={styles.blockHead}>
                  <Text style={[styles.blockT, { color: faint }]}>账户类型</Text>
                  {typeChipsLocked ? (
                    <View style={[styles.lockTag, { backgroundColor: isDark ? ff.paper2 : '#EAE6DC' }]}>
                      <MaterialIcons name="lock-outline" size={10} color={subtle} />
                      <Text style={[styles.lockTagText, { color: subtle }]}>编辑时不可修改</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.typeRow}>
                  {BASE_TYPE_OPTIONS.filter((t) => t.key !== 'liability').map((t) =>
                    renderTypeChip(
                      t.key,
                      t.key === accountType,
                      () => setAccountType(t.key),
                      undefined,
                      t.label,
                      t.icon,
                      { locked: typeChipsLocked },
                    ),
                  )}
                  {!isEditMode
                    ? customTypeOptions.map((t) => {
                        const active = accountType === 'custom' && customTypeName === t.name;
                        return renderTypeChip(
                          `custom-type-${t.name}`,
                          active,
                          () => {
                            setAccountType('custom');
                            setCustomTypeName(t.name);
                            setCustomIsLiability(t.isLiability);
                          },
                          () => confirmDeleteCustomType(t.name, t.isLiability),
                          t.name,
                          t.isLiability ? 'credit-card' : 'tune',
                        );
                      })
                    : null}
                  {isEditMode && accountType === 'custom'
                    ? renderTypeChip(
                        'custom-current',
                        true,
                        undefined,
                        undefined,
                        accountTypeLabel,
                        customIsLiability ? 'credit-card' : 'tune',
                        { locked: true },
                      )
                    : null}
                  {!isEditMode
                    ? renderTypeChip('custom-add', false, openCustomTypeModal, undefined, '自定义', 'add')
                    : null}
                  {BASE_TYPE_OPTIONS.filter((t) => t.key === 'liability').map((t) =>
                    renderTypeChip(
                      t.key,
                      t.key === accountType,
                      () => setAccountType(t.key),
                      undefined,
                      t.label,
                      t.icon,
                      { locked: typeChipsLocked, liabilityTint: true },
                    ),
                  )}
                </View>

                <View
                  style={styles.iconGrid}
                  onLayout={(event) => {
                    const nextWidth = Math.floor(event.nativeEvent.layout.width);
                    setIconGridWidth((prev) => (prev === nextWidth ? prev : nextWidth));
                  }}>
                  {iconOptionsToShow.map((it, index) => renderIconOption(it, index))}
                </View>
                {canExpandIcons ? (
                  <Pressable
                    onPress={() => setIconPickerExpanded((expanded) => !expanded)}
                    accessibilityRole="button"
                    accessibilityLabel={iconPickerExpanded ? '收起图标列表' : '展开查看更多图标'}
                    style={({ pressed }) => [styles.iconExpandToggle, pressed && styles.pressed]}>
                    <Text style={{ color: pine, fontSize: 12, fontWeight: '700' }}>
                      {iconPickerExpanded
                        ? '收起'
                        : `查看更多（${FINANCE_ACCOUNT_ICON_OPTIONS.length - ICON_ROW_COUNT}+）`}
                    </Text>
                    <MaterialIcons
                      name={iconPickerExpanded ? 'expand-less' : 'expand-more'}
                      size={18}
                      color={pine}
                    />
                  </Pressable>
                ) : null}
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={11}>
              <View style={[styles.formCard, { backgroundColor: card, borderColor: line }]}>
                <Text style={[styles.blockT, { color: faint, marginBottom: 4 }]}>基本信息</Text>

                <View style={[styles.inputLine, { borderBottomColor: isDark ? line : '#ECE4D6' }]}>
                  <Text style={[styles.inputLab, { color: faint }]}>名称</Text>
                  <TextInput
                    value={accountName}
                    onChangeText={setAccountName}
                    placeholder="例如：招商银行"
                    placeholderTextColor={faint}
                    style={[styles.inputVal, { color: text }]}
                  />
                  <MaterialIcons name="edit" size={12} color={faint} />
                </View>

                <View style={[styles.inputLine, { borderBottomColor: isDark ? line : '#ECE4D6' }]}>
                  <Text style={[styles.inputLab, { color: faint }]}>卡号</Text>
                  <TextInput
                    value={accountNo}
                    onChangeText={setAccountNo}
                    placeholder="选填 · 尾号"
                    placeholderTextColor={faint}
                    style={[styles.inputVal, { color: text, fontFamily: ffFonts.mono }]}
                  />
                  <MaterialIcons name="edit" size={12} color={faint} />
                </View>

                <View style={[styles.inputLine, { borderBottomColor: isDark ? line : '#ECE4D6' }]}>
                  <Text style={[styles.inputLab, { color: faint }]}>
                    {isSelectedLiability ? '负债' : '余额'}
                  </Text>
                  <Text style={[styles.inputYuan, { color: isSelectedLiability ? clay : ff.income, fontFamily: ffFonts.mono }]}>
                    ¥
                  </Text>
                  <TextInput
                    value={balance}
                    onChangeText={handleBalanceChange}
                    placeholder="0.00"
                    placeholderTextColor={faint}
                    keyboardType="decimal-pad"
                    editable={!isEditMode || editSheetReady}
                    style={[
                      styles.inputVal,
                      {
                        color: isSelectedLiability ? clay : ff.income,
                        fontFamily: ffFonts.mono,
                        fontWeight: '650',
                      },
                    ]}
                  />
                  <MaterialIcons name="edit" size={12} color={faint} />
                </View>

                <View style={[styles.inputLine, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.inputLab, { color: faint }]}>备注</Text>
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="选填"
                    placeholderTextColor={faint}
                    style={[styles.inputVal, { color: subtle }]}
                  />
                  <MaterialIcons name="edit" size={12} color={faint} />
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={11}>
              <View
                style={[
                  styles.formCard,
                  { backgroundColor: card, borderColor: line, paddingTop: 4, paddingBottom: 4 },
                ]}>
                {!isSelectedLiability ? (
                  <View style={[styles.formRow, { borderBottomColor: isDark ? line : '#ECE4D7' }]}>
                    <Text style={[styles.formRowLabel, { color: subtle }]}>计入总资产</Text>
                    <Switch
                      value={includeInTotalAssets}
                      onValueChange={setIncludeInTotalAssets}
                      trackColor={{ false: isDark ? ff.line2 : '#D8D5CB', true: ff.sage }}
                      thumbColor={card}
                    />
                  </View>
                ) : null}
                <View style={[styles.formRow, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.formRowLabel, { color: subtle }]}>在首页账户卡片中显示</Text>
                  <Switch
                    value={showOnHome}
                    onValueChange={setShowOnHome}
                    trackColor={{ false: isDark ? ff.line2 : '#D8D5CB', true: ff.sage }}
                    thumbColor={card}
                  />
                </View>
              </View>
            </FoldRiseIn>

            {isEditMode ? (
              <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={11}>
                <View
                  style={[
                    styles.helperBox,
                    {
                      backgroundColor: isDark ? ff.amber2 : '#F5F0E5',
                      borderColor: isDark ? line : '#E8DFCF',
                    },
                  ]}>
                  <MaterialIcons name="info-outline" size={14} color={ff.amberInk} style={{ marginTop: 1 }} />
                  <Text style={[styles.helperText, { color: subtle }]}>
                    修改当前余额会生成一笔「余额校正」流水，用于解释账实差异，不占用预算。
                  </Text>
                </View>
              </FoldRiseIn>
            ) : null}

            {isEditMode ? (
              <FoldRiseIn animate={motionOn} index={4} staggerMs={45} fromY={11}>
                <Pressable
                  onPress={onDeleteAccount}
                  disabled={deleting}
                  style={({ pressed }) => [styles.dangerLink, (pressed || deleting) && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="删除此账户">
                  <MaterialIcons name="delete-outline" size={15} color={clay} />
                  <Text style={[styles.dangerLinkText, { color: clay }]}>
                    {deleting ? '删除中…' : '删除此账户'}
                  </Text>
                </Pressable>
              </FoldRiseIn>
            ) : null}
          </ScrollView>
        )}

        <View
          style={[
            styles.saveBar,
            {
              paddingBottom: saveBarBottom,
              backgroundColor: bg,
              borderTopColor: line,
            },
          ]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.saveGhost,
              {
                borderColor: ff.line2,
                backgroundColor: isDark ? ff.paper2 : 'rgba(255,252,245,0.55)',
              },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="取消">
            <Text style={{ color: ff.ink2, fontWeight: '700', fontSize: 13 }}>取消</Text>
          </Pressable>
          <Pressable
            onPressIn={() => Keyboard.dismiss()}
            onPress={() => void onSave()}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.savePrimary,
              {
                backgroundColor: pine,
                opacity: canSave ? 1 : 0.55,
                shadowColor: ff.shadow,
              },
              pressed && canSave && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="保存账户">
            <Text style={{ color: ff.onPine, fontWeight: '750', fontSize: 14 }}>
              {saving ? '保存中…' : '保存账户'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent animationType="fade" visible={customTypeModalOpen} onRequestClose={closeCustomTypeModal}>
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: 'rgba(29,41,35,0.42)' }]}
            onPress={closeCustomTypeModal}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
            pointerEvents="box-none">
            <View style={[styles.modalCard, { backgroundColor: card, borderColor: line }]}>
              <View style={[styles.modalIconWrap, { backgroundColor: isDark ? ff.sage2 : '#E7EFE9' }]}>
                <MaterialIcons name="tune" size={22} color={pine} />
              </View>
              <Text style={[styles.modalTitle, { color: text, fontFamily: ffFonts.serif }]}>自定义类型</Text>
              <Text style={{ color: subtle, fontSize: 13, marginBottom: 4 }}>创建后可在账户类型里快速选用</Text>

              <AppInput
                label="类型名称"
                value={modalTypeName}
                onChangeText={setModalTypeName}
                placeholder="例如：房产 / 保险 / 借款"
                editable={!modalSaving}
              />

              <View style={styles.modalField}>
                <Text style={[styles.blockT, { color: faint, marginBottom: 6 }]}>类型性质</Text>
                <View style={[styles.segmented, { backgroundColor: isDark ? ff.paper2 : '#F0EBE0' }]}>
                  <Pressable
                    onPress={() => setModalIsLiability(false)}
                    disabled={modalSaving}
                    style={({ pressed }) => [
                      styles.segmentItem,
                      !modalIsLiability && [
                        styles.segmentItemActive,
                        { backgroundColor: card, borderColor: line },
                      ],
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={{
                        color: !modalIsLiability ? pine : subtle,
                        fontWeight: '700',
                        fontSize: 14,
                      }}>
                      资产
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setModalIsLiability(true)}
                    disabled={modalSaving}
                    style={({ pressed }) => [
                      styles.segmentItem,
                      modalIsLiability && [
                        styles.segmentItemActive,
                        { backgroundColor: card, borderColor: line },
                      ],
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={{
                        color: modalIsLiability ? pine : subtle,
                        fontWeight: '700',
                        fontSize: 14,
                      }}>
                      负债
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeCustomTypeModal}
                  disabled={modalSaving}
                  style={({ pressed }) => [
                    styles.modalBtnGhost,
                    {
                      borderColor: ff.line2,
                      backgroundColor: isDark ? ff.paper2 : '#F7F2E7',
                    },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <Text style={{ color: '#56645B', fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={() => void onSaveCustomType()}
                  disabled={modalSaving || modalTypeName.trim().length === 0}
                  style={({ pressed }) => [
                    styles.modalBtnPrimary,
                    {
                      backgroundColor: pine,
                      opacity: modalSaving || modalTypeName.trim().length === and0 ? 0.55 : 1,
                    },
                    pressed && { opacity: 0.9 },
                  ]}>
                  <Text style={{ color: ff.onPine, fontWeight: '700' }}>
                    {modalSaving ? '保存中…' : '保存'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** typo guard — keep TS happy if refactored */
const and0 = 0;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 60,
  },
  headerInner: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  headerSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6 },
  foldIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSave: {
    minWidth: 48,
    height: 27,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSaveText: { fontSize: 12, fontWeight: '700' },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  formCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  blockT: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
  lockTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
  },
  lockTagText: { fontSize: 10, fontWeight: '700' },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 8,
  },
  typeChip: {
    flexGrow: 1,
    flexBasis: '18%',
    minWidth: 56,
    height: 31,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 6,
  },
  typeChipLabel: { fontSize: 11 },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    marginTop: 2,
  },
  iconOpt: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconExpandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  inputLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputLab: {
    width: 36,
    fontSize: 12,
    flexShrink: 0,
  },
  inputYuan: {
    fontSize: 13,
    fontWeight: '700',
  },
  inputVal: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 0,
    includeFontPadding: false,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  formRowLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  helperBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  helperText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  dangerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    marginTop: 2,
  },
  dangerLinkText: {
    fontSize: 13,
    fontWeight: '700',
  },
  saveBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  saveGhost: {
    width: 78,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savePrimary: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.17,
    shadowRadius: 18,
    elevation: 3,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCenter: {
    paddingHorizontal: Layout.pagePaddingX,
    justifyContent: 'center',
  },
  modalCard: {
    gap: Spacing.lg,
    maxWidth: Layout.contentMaxWidth,
    width: '100%',
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalField: {
    gap: 4,
  },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 10,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 0,
  },
  segmentItemActive: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  modalBtnGhost: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimary: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
