import { AppButton, AppInput, ScreenHeader, Skeleton } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { formatFinanceHappenedAt } from '@/lib/api-mysql-datetime';
import {
  FINANCE_ACCOUNT_ICON_OPTIONS,
  type FinanceAccountIconOption,
} from '@/lib/constants/finance-account-icons';
import { fetchFinanceCatalog } from '@/lib/finance-page-api';
import {
  applyFinanceAccountBalanceCorrection,
  createFinanceAccount,
  createFinanceTransaction,
  deleteFinanceAccountTypeByName,
  financeBalanceInputTextFromLedger,
  financeTargetLedgerFromUserBalanceInput,
  getFinanceAccounts,
  updateFinanceAccount,
  upsertFinanceAccountType,
} from '@/lib/repositories/finance/finance';
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
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
  { key: 'cash_wallet', label: '现金与钱包', icon: 'wallet' },
  { key: 'bank', label: '银行账户', icon: 'account-balance' },
  { key: 'investment', label: '投资项目', icon: 'show-chart' },
  { key: 'liability', label: '负债', icon: 'credit-card-off' },
];

function resolveAccountTypeLabel(accountType: AccountType, customTypeName: string): string {
  if (accountType === 'custom') return customTypeName.trim() || '自定义类型';
  return BASE_TYPE_OPTIONS.find((t) => t.key === accountType)?.label ?? '银行账户';
}

const PAGE_API_KEY = 'add-account';

export default function AddAccountScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ editAccountId?: string }>();
  const editAccountId = typeof params.editAccountId === 'string' ? params.editAccountId.trim() : '';
  const isEditMode = editAccountId.length > 0;

  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();

  const iconGridGap = Spacing.sm;
  const [iconGridWidth, setIconGridWidth] = React.useState(0);
  const iconCellLayout = React.useMemo(() => {
    if (iconGridWidth <= 0) return { base: 0, lastColExtra: 0 };
    const gaps = iconGridGap * (ICON_ROW_COUNT - 1);
    const base = Math.floor((iconGridWidth - gaps) / ICON_ROW_COUNT);
    const remainder = iconGridWidth - gaps - base * ICON_ROW_COUNT;
    return { base, lastColExtra: remainder };
  }, [iconGridGap, iconGridWidth]);

  const editExtraBaselineRef = React.useRef<Record<string, unknown>>({});
  const editLedgerMetaRef = React.useRef<{ sign_rule: number; account_type: string }>({
    sign_rule: 1,
    account_type: 'asset',
  });

  const [accountType, setAccountType] = React.useState<AccountType>('bank');
  const [accountName, setAccountName] = React.useState('');
  const [accountNo, setAccountNo] = React.useState('');
  const [balance, setBalance] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [iconKey, setIconKey] = React.useState('savings');
  const [saving, setSaving] = React.useState(false);
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

  const panelStyle = React.useMemo(
    () => [
      styles.panel,
      {
        backgroundColor: colors.surface,
        borderColor: colors.outline,
      },
    ],
    [colors.outline, colors.surface],
  );

  const reloadCustomTypes = React.useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        try {
          const catalog = await fetchFinanceCatalog({ offlineFallback: true });
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
      }, forceApi);
    },
    [wrapLoad],
  );

  const reload = React.useCallback(
    async (forceApi = false) => {
      if (isEditMode && editAccountId) {
        setEditSheetReady(false);
        await wrapLoad(async () => {
          try {
            const catalog = await fetchFinanceCatalog({ offlineFallback: true });
            const rows = catalog.accounts;
            const row = rows.find((r) => r.id === editAccountId);
            if (!row) {
              Alert.alert('账户不存在', '该账户可能已被删除。', [{ text: '确定', onPress: () => router.back() }]);
              return;
            }
            setAccountName(row.name);
            setAccountNo(row.account_no ?? '');
            setNotes(row.note ?? '');
            editLedgerMetaRef.current = { sign_rule: row.sign_rule, account_type: row.account_type };
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
            setEditSheetReady(true);
          } catch (e) {
            console.warn('Failed to load account for edit:', e);
            Alert.alert('加载失败', '请稍后重试。', [{ text: '确定', onPress: () => router.back() }]);
          }
        }, forceApi);
        return;
      }

      setEditSheetReady(true);
      setBalance('');
      const draft = getCustomAccountTypeDraft();
      setCustomTypeName(draft.name);
      setCustomIsLiability(draft.isLiability);
      await reloadCustomTypes(forceApi);
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
      Alert.alert('请输入类型名称', '类型名称不能为空。');
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
    } catch (e) {
      console.warn('保存自定义类型失败:', e);
      Alert.alert('保存失败', '自定义类型保存失败，请稍后重试。');
    } finally {
      setModalSaving(false);
    }
  }, [modalIsLiability, modalTypeName, reloadCustomTypes]);

  const onSave = React.useCallback(async () => {
    Keyboard.dismiss();
    const name = accountName.trim();
    if (!name) {
      Alert.alert('请输入账户名称', '账户名称不能为空。');
      return;
    }

    if (isEditMode) {
      if (!editSheetReady) return;
      const normalizedBalanceText = balance.trim().replace(/[^\d.-]/g, '');
      const balanceNum = normalizedBalanceText ? Number(normalizedBalanceText) : 0;
      if (!Number.isFinite(balanceNum)) {
        Alert.alert('余额无效', '请输入正确的数字金额。');
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
        const mergedExtra = {
          ...editExtraBaselineRef.current,
          ui_account_type: accountType === 'custom' ? 'custom' : accountType,
          ui_custom_type_name: accountType === 'custom' ? customTypeName.trim() || null : null,
          ui_is_liability: accountType === 'custom' ? customIsLiability : null,
          ui_icon_key: iconKey,
        };
        await updateFinanceAccount(editAccountId, {
          name,
          account_no: accountNo.trim() ? accountNo.trim() : null,
          note: notes.trim() ? notes.trim() : null,
          extra_data: JSON.stringify(mergedExtra),
        });
        await applyFinanceAccountBalanceCorrection({
          accountId: editAccountId,
          targetLedgerBalance: targetLedger,
        });
        router.back();
      } catch (e) {
        Alert.alert('保存失败', e instanceof Error && e.message.trim() ? e.message : '请稍后重试。');
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
      Alert.alert('请输入类型名称', '自定义类型名称不能为空。');
      return;
    }

    const normalizedBalanceText = balance.trim().replace(/[^\d.-]/g, '');
    const rawBalance = normalizedBalanceText ? Number(normalizedBalanceText) : 0;
    const absInitial = Number.isFinite(rawBalance) ? Math.abs(rawBalance) : NaN;
    if (!Number.isFinite(absInitial)) {
      Alert.alert('余额无效', '请输入正确的数字金额。');
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const random = Math.random().toString(16).slice(2);
      const accountId = `fa_${now}_${random}`;

      await createFinanceAccount({
        id: accountId,
        name,
        account_no: accountNo.trim() ? accountNo.trim() : null,
        account_type: accountTypeDb,
        sign_rule: signRule,
        note: notes.trim() ? notes.trim() : null,
        extra_data: JSON.stringify({
          ui_account_type: accountType === 'custom' ? 'custom' : accountType,
          ui_custom_type_name: accountType === 'custom' ? customType : null,
          ui_is_liability: accountType === 'custom' ? customIsLiability : null,
          ui_icon_key: iconKey,
        }),
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

      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试。');
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
    isEditMode,
    isSelectedLiability,
    notes,
    router,
  ]);

  const handleBalanceChange = React.useCallback((text: string) => {
    let s = text.replace(/[^\d.-]/g, '');
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

  const renderIconOption = (it: FinanceAccountIconOption, index: number) => {
    const active = it.key === iconKey;
    const col = index % ICON_ROW_COUNT;
    const row = Math.floor(index / ICON_ROW_COUNT);
    const totalRows = Math.ceil(iconOptionsToShow.length / ICON_ROW_COUNT);
    const cellWidth =
      iconCellLayout.base + (col === ICON_ROW_COUNT - 1 ? iconCellLayout.lastColExtra : 0);
    const cellHeight = iconCellLayout.base;

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
            styles.iconGridCellInner,
            {
              backgroundColor: active
                ? isDark
                  ? 'rgba(96,165,250,0.22)'
                  : colors.primaryMuted
                : isDark
                  ? colors.surfaceMuted
                  : colors.input,
              borderColor: active ? colors.primary : 'transparent',
            },
          ]}>
          <MaterialIcons name={it.icon} size={20} color={active ? colors.primary : colors.textSecondary} />
        </View>
      </Pressable>
    );
  };

  const renderTypeChip = (
    key: string,
    active: boolean,
    onPress: () => void,
    onLongPress: (() => void) | undefined,
    label: string,
    icon?: keyof typeof MaterialIcons.glyphMap,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.typeChip,
        {
          backgroundColor: active
            ? isDark
              ? 'rgba(96,165,250,0.22)'
              : colors.primaryMuted
            : isDark
              ? colors.surfaceMuted
              : colors.input,
          borderColor: active ? colors.primary : 'transparent',
        },
        pressed && styles.pressed,
      ]}>
      {icon ? <MaterialIcons name={icon} size={16} color={active ? colors.primary : colors.textSecondary} /> : null}
      <Text
        numberOfLines={1}
        style={[Typography.bodyStrong, styles.typeLabel, { color: active ? colors.primary : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title={isEditMode ? '编辑账户' : '添加账户'} onBack={() => router.back()} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Spacing['7xl'] + 80 + Math.max(insets.bottom, 0) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={styles.content}>
            <View style={styles.hero}>
              <Text style={[Typography.kicker, styles.heroKicker, { color: colors.textSecondary }]}>
                {isEditMode ? '编辑资产账户' : '新建资产账户'}
              </Text>
              <Text style={[Typography.h2, { color: colors.text }]}>
                {isEditMode ? accountName.trim() || '账户信息' : '选类型，填余额'}
              </Text>
              <Text style={[Typography.body, { color: colors.textMuted }]}>
                {isEditMode ? '修改后会与资产页汇总同步' : '保存后会出现在资产页分组列表中'}
              </Text>
            </View>

            {isEditMode ? (
              <View style={panelStyle}>
                {!editSheetReady ? (
                  <View style={styles.editHeroLoading}>
                    <Skeleton width={96} height={28} borderRadius={14} />
                    <Skeleton width="70%" height={12} borderRadius={6} style={{ marginTop: Spacing.lg }} />
                  </View>
                ) : (
                  <View style={styles.editHeroMeta}>
                    <View style={styles.sectionTitleRow}>
                      <Text style={[Typography.title, { color: colors.text }]}>账户类型</Text>
                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor: isDark ? 'rgba(96,165,250,0.18)' : colors.primaryMuted,
                          },
                        ]}>
                        <Text style={[Typography.caption, styles.typeBadgeText, { color: colors.primary }]}>
                          {accountTypeLabel}
                        </Text>
                      </View>
                    </View>
                    <Text style={[Typography.caption, styles.editHeroHint, { color: colors.textSecondary }]}>
                      账户类型创建后不可修改
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={panelStyle}>
                <Text style={[Typography.title, { color: colors.text }]}>选择账户类型</Text>
                <View style={styles.typeGrid}>
                  {BASE_TYPE_OPTIONS.map((t) =>
                    renderTypeChip(t.key, t.key === accountType, () => setAccountType(t.key), undefined, t.label, t.icon),
                  )}
                  {customTypeOptions.map((t) => {
                    const active = accountType === 'custom' && customTypeName === t.name;
                    return renderTypeChip(
                      `custom-type-${t.name}`,
                      active,
                      () => {
                        setAccountType('custom');
                        setCustomTypeName(t.name);
                        setCustomIsLiability(t.isLiability);
                      },
                      () => {
                        void (async () => {
                          try {
                            const hasRelatedAccounts = await hasAccountsForCustomType(t.name);
                            if (hasRelatedAccounts) {
                              Alert.alert('无法删除', `“${t.name}”下已有账户，请先删除或转移账户后再试。`);
                              return;
                            }

                            Alert.alert('删除自定义类型', `确认删除“${t.name}”吗？`, [
                              { text: '取消', style: 'cancel' },
                              {
                                text: '删除',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await deleteFinanceAccountTypeByName(t.name);
                                    removeCustomAccountTypeOption(t.name);
                                    await reloadCustomTypes();
                                    if (accountType === 'custom' && customTypeName === t.name) {
                                      setAccountType('bank');
                                      setCustomTypeName('');
                                      setCustomIsLiability(false);
                                    }
                                  } catch (e) {
                                    console.warn('删除自定义类型失败:', e);
                                    Alert.alert('删除失败', '请稍后重试。');
                                  }
                                },
                              },
                            ]);
                          } catch (e) {
                            console.warn('校验自定义类型是否可删除失败:', e);
                            Alert.alert('操作失败', '请稍后重试。');
                          }
                        })();
                      },
                      t.name,
                      t.isLiability ? 'credit-card' : 'tune',
                    );
                  })}
                  {renderTypeChip('custom-add', false, openCustomTypeModal, undefined, '自定义', 'add')}
                </View>
              </View>
            )}

            <View style={panelStyle}>
              <Text style={[Typography.title, { color: colors.text }]}>账户图标</Text>
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
                  <Text style={[Typography.caption, { color: colors.primary, fontWeight: '700' }]}>
                    {iconPickerExpanded
                      ? '收起'
                      : `查看更多（${FINANCE_ACCOUNT_ICON_OPTIONS.length - ICON_ROW_COUNT}+）`}
                  </Text>
                  <MaterialIcons
                    name={iconPickerExpanded ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={colors.primary}
                  />
                </Pressable>
              ) : null}
            </View>

            <View style={panelStyle}>
              <Text style={[Typography.title, { color: colors.text }]}>基本信息</Text>
              <AppInput
                label="账户名称"
                value={accountName}
                onChangeText={setAccountName}
                placeholder="例如：招商银行储蓄卡"
              />
              <AppInput
                label="卡号 / 尾号"
                hint="选填"
                value={accountNo}
                onChangeText={setAccountNo}
                placeholder="例如：6222 **** 1234"
              />

              <View style={styles.amountRow}>
                <Text style={[Typography.bodyStrong, styles.fieldLabel, { color: colors.text }]}>
                  {isSelectedLiability ? '当前负债' : '当前余额'}
                </Text>
                {isEditMode ? (
                  <Text style={[Typography.caption, styles.balanceHint, { color: colors.textSecondary }]}>
                    与流水汇总一致；修改并保存后会记一笔「余额校正」流水
                  </Text>
                ) : null}
                <View
                  style={[
                    styles.amountWrap,
                    {
                      borderColor: colors.outline,
                      backgroundColor: isDark ? colors.surfaceMuted : colors.input,
                    },
                  ]}>
                  <Text
                    style={[
                      Typography.h2,
                      styles.currency,
                      { color: isSelectedLiability ? colors.danger : colors.primary },
                    ]}>
                    ¥
                  </Text>
                  <TextInput
                    value={balance}
                    onChangeText={handleBalanceChange}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    editable={!isEditMode || editSheetReady}
                    style={[styles.amountInput, Typography.title, { color: colors.text }]}
                  />
                </View>
              </View>

              <AppInput
                label="备注"
                hint="选填"
                value={notes}
                onChangeText={setNotes}
                placeholder="添加备注信息..."
                multiline
                inputWrapStyle={styles.notesWrap}
                inputStyle={styles.notesInput}
              />
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Spacing['3xl'] + Math.max(insets.bottom, 0),
              backgroundColor: colors.background,
              borderTopColor: colors.outline,
            },
          ]}>
          <AppButton
            label={saving ? '保存中...' : isEditMode ? '保存修改' : '完成'}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            onPressIn={() => Keyboard.dismiss()}
            onPress={() => void onSave()}
          />
        </View>
      </KeyboardAvoidingView>

      <Modal transparent animationType="fade" visible={customTypeModalOpen} onRequestClose={closeCustomTypeModal}>
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={closeCustomTypeModal}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
            pointerEvents="box-none">
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.outline,
                },
                shadows.sheet,
              ]}>
              <View style={[styles.modalIconWrap, { backgroundColor: colors.primaryMuted }]}>
                <MaterialIcons name="tune" size={22} color={colors.primary} />
              </View>
              <Text style={[Typography.h3, { color: colors.text }]}>自定义类型</Text>
              <Text style={[Typography.body, { color: colors.textMuted }]}>创建后可在账户类型里快速选用</Text>

              <AppInput
                label="类型名称"
                value={modalTypeName}
                onChangeText={setModalTypeName}
                placeholder="例如：房产 / 保险 / 借款"
                editable={!modalSaving}
              />

              <View style={styles.modalField}>
                <Text style={[Typography.kicker, styles.cardKicker, { color: colors.textSecondary }]}>类型性质</Text>
                <View style={[styles.segmented, { backgroundColor: colors.capsule }]}>
                  <Pressable
                    onPress={() => setModalIsLiability(false)}
                    disabled={modalSaving}
                    style={({ pressed }) => [
                      styles.segmentItem,
                      !modalIsLiability && [
                        styles.segmentItemActive,
                        { backgroundColor: colors.surface },
                        shadows.card,
                      ],
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[
                        Typography.bodyStrong,
                        { color: !modalIsLiability ? colors.primary : colors.textSecondary, fontSize: 14 },
                      ]}>
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
                        { backgroundColor: colors.surface },
                        shadows.card,
                      ],
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[
                        Typography.bodyStrong,
                        { color: modalIsLiability ? colors.primary : colors.textSecondary, fontSize: 14 },
                      ]}>
                      负债
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.modalActions}>
                <AppButton
                  label="取消"
                  variant="outline"
                  size="md"
                  onPress={closeCustomTypeModal}
                  disabled={modalSaving}
                  style={styles.modalBtn}
                />
                <AppButton
                  label={modalSaving ? '保存中…' : '保存'}
                  variant="primary"
                  size="md"
                  loading={modalSaving}
                  disabled={modalSaving || modalTypeName.trim().length === 0}
                  onPress={() => void onSaveCustomType()}
                  style={styles.modalBtn}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing['3xl'],
    gap: Spacing['4xl'],
  },
  hero: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  heroKicker: {
    letterSpacing: 1.2,
    fontSize: 12,
    textTransform: 'none',
  },
  panel: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing['3xl'],
  },
  cardKicker: { marginBottom: Spacing.xs },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.lg,
  },
  editHeroLoading: {
    paddingVertical: Spacing.md,
  },
  editHeroMeta: {
    gap: Spacing.md,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  typeBadgeText: {
    fontWeight: '700',
  },
  editHeroHint: {
    lineHeight: 18,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeLabel: { fontSize: 13, textAlign: 'center' },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  iconGridCellInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconExpandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  fieldLabel: { marginBottom: Spacing.xs },
  amountRow: { gap: Spacing.sm },
  balanceHint: {
    lineHeight: 17,
    marginBottom: Spacing.xs,
  },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    minHeight: 52,
    gap: Spacing.sm,
  },
  currency: {
    fontSize: 22,
    fontWeight: '900',
  },
  amountInput: {
    flex: 1,
    padding: 0,
    includeFontPadding: false,
  },
  notesWrap: {
    minHeight: 96,
    alignItems: 'flex-start',
    paddingVertical: Spacing.lg,
  },
  notesInput: {
    minHeight: 72,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.lg,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
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
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  modalField: {
    gap: Spacing.sm,
  },
  segmented: {
    flexDirection: 'row',
    padding: Spacing.xs,
    borderRadius: Radius.md,
    gap: Spacing.xs,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.sm,
    alignItems: 'center',
    minWidth: 0,
  },
  segmentItemActive: {},
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  modalBtn: {
    flex: 1,
  },
  pressed: { opacity: 0.85 },
});
