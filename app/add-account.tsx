import { AppButton, AppCard, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  applyFinanceAccountBalanceCorrection,
  createFinanceAccount,
  createFinanceTransaction,
  deleteFinanceAccountTypeByName,
  financeBalanceInputTextFromLedger,
  financeTargetLedgerFromUserBalanceInput,
  getFinanceAccountTypes,
  getFinanceAccounts,
  getFinanceAccountsWithBalance,
  updateFinanceAccount,
} from '@/lib/repositories/finance/finance';
import {
  getCustomAccountTypeDraft,
  getCustomAccountTypeOptions,
  removeCustomAccountTypeOption,
  setCustomAccountTypeDraft,
} from '@/lib/state/account-type-draft';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type AccountType = 'cash_wallet' | 'bank' | 'investment' | 'liability' | 'custom';

const BASE_TYPE_OPTIONS: {
  key: Exclude<AccountType, 'custom'>;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { key: 'cash_wallet', label: '现金与钱包', icon: 'account-balance-wallet' },
  { key: 'bank', label: '银行账户', icon: 'account-balance' },
  { key: 'investment', label: '投资项目', icon: 'trending-up' },
  { key: 'liability', label: '负债', icon: 'credit-card' },
];

function SectionLabel({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return (
    <Text style={[Typography.kicker, styles.sectionLabel, { color: colors.textSecondary }]}>{children}</Text>
  );
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
  const [iconKey, setIconKey] = React.useState<string>(() => getCustomAccountTypeDraft().iconKey || 'savings');
  const [saving, setSaving] = React.useState(false);
  const [customTypeName, setCustomTypeName] = React.useState(() => getCustomAccountTypeDraft().name);
  const [customIsLiability, setCustomIsLiability] = React.useState(() => getCustomAccountTypeDraft().isLiability);
  const [customTypeOptions, setCustomTypeOptions] = React.useState<
    Array<{ name: string; isLiability: boolean; iconKey: string }>
  >([]);
  const [editSheetReady, setEditSheetReady] = React.useState(!isEditMode);

  const canSave =
    accountName.trim().length > 0 &&
    (accountType !== 'custom' || customTypeName.trim().length > 0) &&
    !saving &&
    (!isEditMode || editSheetReady);
  const isSelectedLiability = accountType === 'liability' || (accountType === 'custom' && customIsLiability);

  const reloadCustomTypes = React.useCallback(async (forceApi = false) => {
    await wrapLoad(async () => {
    try {
      const rows = await getFinanceAccountTypes();
      setCustomTypeOptions(
        rows.map((row) => ({
          name: row.name,
          isLiability: row.is_liability === 1,
          iconKey: row.icon_key || 'savings',
        })),
      );
    } catch (e) {
      console.warn('Failed to load custom account types:', e);
      setCustomTypeOptions(getCustomAccountTypeOptions());
    }
    }, forceApi);
  }, [wrapLoad]);

  const reload = React.useCallback(async (forceApi = false) => {
    if (isEditMode && editAccountId) {
      setEditSheetReady(false);
      await wrapLoad(async () => {
        try {
          const rows = await getFinanceAccountsWithBalance();
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
    if (accountType === 'custom' && draft.iconKey) {
      setIconKey(draft.iconKey);
    }
  }, [accountType, editAccountId, isEditMode, reloadCustomTypes, router, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onSave = React.useCallback(async () => {
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
          happened_at: new Date().toISOString(),
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

  const renderTypeCard = (
    key: string,
    active: boolean,
    onPress: () => void,
    onLongPress: (() => void) | undefined,
    icon: keyof typeof MaterialIcons.glyphMap,
    label: string,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.typeCard,
        {
          backgroundColor: colors.surface,
          borderColor: active ? colors.primary : colors.outline,
        },
        active && shadows.card,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.typeIconWrap, { backgroundColor: active ? colors.primaryMuted : colors.input }]}>
        <MaterialIcons name={icon} size={22} color={active ? colors.primary : colors.textSecondary} />
      </View>
      <Text numberOfLines={1} style={[Typography.bodyStrong, styles.typeLabel, { color: colors.text }]}>
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
            <View style={[styles.section, isEditMode && { opacity: 0.48 }]} pointerEvents={isEditMode ? 'none' : 'auto'}>
              <SectionLabel>选择账户类型</SectionLabel>
              {isEditMode ? (
                <Text style={[Typography.caption, styles.balanceEditFootnote, { color: colors.textSecondary }]}>
                  创建后不可修改类型；可改名称、卡号、图标与备注
                </Text>
              ) : null}
              <View style={styles.typeGrid}>
                {BASE_TYPE_OPTIONS.map((t) =>
                  renderTypeCard(
                    t.key,
                    t.key === accountType,
                    () => setAccountType(t.key),
                    undefined,
                    t.icon,
                    t.label,
                  ),
                )}
                {customTypeOptions.map((t) => {
                  const icon = FINANCE_ACCOUNT_ICON_OPTIONS.find((item) => item.key === t.iconKey)?.icon ?? 'tune';
                  const active = accountType === 'custom' && customTypeName === t.name;
                  return renderTypeCard(
                    `custom-type-${t.name}`,
                    active,
                    () => {
                      setAccountType('custom');
                      setCustomTypeName(t.name);
                      setCustomIsLiability(t.isLiability);
                      setIconKey(t.iconKey);
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
                                    setIconKey('savings');
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
                    icon,
                    t.name,
                  );
                })}
                {renderTypeCard(
                  'custom-add',
                  accountType === 'custom' && !customTypeName,
                  () => {
                    setAccountType('custom');
                    setCustomAccountTypeDraft({
                      name: customTypeName,
                      isLiability: customIsLiability,
                      iconKey,
                    });
                    router.push('/add-account-type');
                  },
                  undefined,
                  'add',
                  '自定义',
                )}
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.form}>
                <View style={styles.field}>
                  <SectionLabel>账户名称</SectionLabel>
                  <TextInput
                    value={accountName}
                    onChangeText={setAccountName}
                    placeholder="例如：招商银行储蓄卡"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.textInput, { color: colors.text, borderBottomColor: colors.outline }]}
                  />
                </View>

                <View style={styles.field}>
                  <SectionLabel>卡号 / 尾号 (选填)</SectionLabel>
                  <TextInput
                    value={accountNo}
                    onChangeText={setAccountNo}
                    placeholder="例如：6222 **** 1234"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.textInput, { color: colors.text, borderBottomColor: colors.outline }]}
                  />
                </View>

                <View style={styles.field}>
                  <SectionLabel>{isSelectedLiability ? '当前负债' : '当前余额'}</SectionLabel>
                  {isEditMode ? (
                    <Text style={[Typography.caption, styles.balanceEditFootnote, { color: colors.textSecondary }]}>
                      与流水汇总一致；修改数字并保存后，会记一笔「余额校正」流水。
                    </Text>
                  ) : null}
                  <View style={[styles.balanceRow, { borderBottomColor: colors.outline }]}>
                    <Text style={[Typography.h2, styles.currency, { color: colors.primary }]}>¥</Text>
                    <TextInput
                      value={balance}
                      onChangeText={handleBalanceChange}
                      placeholder="0.00"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      editable={!isEditMode || editSheetReady}
                      style={[styles.balanceInput, Typography.display, { color: colors.text }]}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <SectionLabel>备注 (选填)</SectionLabel>
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="添加备注信息..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    style={[
                      styles.notesInput,
                      {
                        backgroundColor: isDark ? colors.surfaceMuted : colors.input,
                        color: colors.text,
                        borderColor: colors.outline,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <SectionLabel>个性化</SectionLabel>
              <AppCard padded style={{ borderColor: colors.outline }}>
                <Text style={[Typography.caption, styles.customLabel, { color: colors.textSecondary }]}>账户图标</Text>
                <View style={styles.iconGrid}>
                  {FINANCE_ACCOUNT_ICON_OPTIONS.map((it) => {
                    const active = it.key === iconKey;
                    return (
                      <Pressable
                        key={it.key}
                        onPress={() => setIconKey(it.key)}
                        style={({ pressed }) => [styles.iconCell, pressed && styles.pressed]}>
                        <View
                          style={[
                            styles.iconCellInner,
                            {
                              backgroundColor: active ? colors.primaryMuted : colors.input,
                              borderColor: active ? colors.primary : colors.outline,
                            },
                            active && shadows.card,
                          ]}>
                          <MaterialIcons
                            name={it.icon}
                            size={18}
                            color={active ? colors.primary : colors.textSecondary}
                          />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </AppCard>
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Spacing['3xl'] + Math.max(insets.bottom, 0),
              backgroundColor: colors.headerScrim,
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
            onPress={() => void onSave()}
          />
        </View>
      </KeyboardAvoidingView>
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
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['6xl'],
  },
  section: { gap: Spacing.xl },
  sectionLabel: { opacity: 0.85 },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xl,
  },
  typeCard: {
    width: '31%',
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing['2xl'],
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: { fontSize: 13, textAlign: 'center' },
  form: { gap: Spacing['3xl'] },
  field: { gap: Spacing.md },
  balanceEditFootnote: {
    lineHeight: 16,
    marginBottom: Spacing.sm,
    marginTop: -Spacing.xs,
  },
  textInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.lg,
    fontSize: 16,
    fontWeight: '800',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
  },
  currency: {
    fontSize: 24,
    fontWeight: '900',
    marginBottom: Spacing.xs,
  },
  balanceInput: {
    flex: 1,
    padding: 0,
    includeFontPadding: false,
  },
  notesInput: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['2xl'],
    minHeight: 90,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  customLabel: {
    marginBottom: Spacing.lg,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -Spacing.sm,
  },
  iconCell: {
    width: '20%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  iconCellInner: {
    width: '100%',
    aspectRatio: 1,
    minWidth: 44,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  pressed: { opacity: 0.85 },
});
