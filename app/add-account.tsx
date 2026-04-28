import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { createFinanceAccount, createFinanceTransaction, deleteFinanceAccountTypeByName, getFinanceAccountTypes, getFinanceAccounts } from '@/lib/repositories/finance/finance';
import { getCustomAccountTypeDraft, getCustomAccountTypeOptions, removeCustomAccountTypeOption, setCustomAccountTypeDraft } from '@/lib/state/account-type-draft';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
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

const BASE_TYPE_OPTIONS: { key: Exclude<AccountType, 'custom'>; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'cash_wallet', label: '现金与钱包', icon: 'account-balance-wallet' },
  { key: 'bank', label: '银行账户', icon: 'account-balance' },
  { key: 'investment', label: '投资项目', icon: 'trending-up' },
  { key: 'liability', label: '负债', icon: 'credit-card' },
];

export default function AddAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [accountType, setAccountType] = React.useState<AccountType>('bank');
  const [accountName, setAccountName] = React.useState('');
  const [balance, setBalance] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [iconKey, setIconKey] = React.useState<string>(() => getCustomAccountTypeDraft().iconKey || 'savings');
  const [saving, setSaving] = React.useState(false);
  const [customTypeName, setCustomTypeName] = React.useState(() => getCustomAccountTypeDraft().name);
  const [customIsLiability, setCustomIsLiability] = React.useState(() => getCustomAccountTypeDraft().isLiability);
  const [customTypeOptions, setCustomTypeOptions] = React.useState<Array<{ name: string; isLiability: boolean; iconKey: string }>>([]);

  // Page-level accent: brown / deep yellow
  const accentColor = isDark ? '#D97706' : '#B45309';

  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(242,243,255,0.95)';
  const surfaceLowest = theme.surface;

  const canSave =
    accountName.trim().length > 0 &&
    (accountType !== 'custom' || customTypeName.trim().length > 0) &&
    !saving;
  const isSelectedLiability = accountType === 'liability' || (accountType === 'custom' && customIsLiability);

  const loadCustomTypeOptions = React.useCallback(async () => {
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
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const draft = getCustomAccountTypeDraft();
      setCustomTypeName(draft.name);
      setCustomIsLiability(draft.isLiability);
      void loadCustomTypeOptions();
      if (accountType === 'custom' && draft.iconKey) {
        setIconKey(draft.iconKey);
      }
    }, [accountType, loadCustomTypeOptions]),
  );

  const onSave = React.useCallback(async () => {
    const name = accountName.trim();
    if (!name) {
      Alert.alert('请输入账户名称', '账户名称不能为空。');
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

      // Finance account balance is derived from transactions.
      // Asset initial balance is income-like; liability initial balance is expense-like debt.
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
  }, [accountName, accountType, balance, notes, iconKey, router, customIsLiability, customTypeName, isSelectedLiability]);

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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.72)' : 'rgba(250,248,255,0.82)',
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>添加账户</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 120 + Math.max(insets.bottom, 12) },
          ]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>选择账户类型</Text>
            <View style={styles.typeGrid}>
              {BASE_TYPE_OPTIONS.map((t) => {
                const active = t.key === accountType;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => {
                      setAccountType(t.key);
                    }}
                    style={({ pressed }) => [
                      styles.typeCard,
                      {
                        backgroundColor: surfaceLowest,
                        borderColor: active ? accentColor : outlineVariant,
                        shadowOpacity: active ? 0.08 : 0,
                      },
                      active && { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowRadius: 14, elevation: 3 },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View
                      style={[
                        styles.typeIconWrap,
                        { backgroundColor: active ? `${accentColor}1A` : surfaceLow },
                      ]}>
                      <MaterialIcons name={t.icon} size={22} color={accentColor} />
                    </View>
                    <Text style={[styles.typeLabel, { color: theme.text }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
              {customTypeOptions.map((t) => {
                const icon = FINANCE_ACCOUNT_ICON_OPTIONS.find((item) => item.key === t.iconKey)?.icon ?? 'tune';
                const active = accountType === 'custom' && customTypeName === t.name;
                return (
                  <Pressable
                    key={`custom-type-${t.name}`}
                    onPress={() => {
                      setAccountType('custom');
                      setCustomTypeName(t.name);
                      setCustomIsLiability(t.isLiability);
                      setIconKey(t.iconKey);
                    }}
                    onLongPress={() => {
                      void (async () => {
                        try {
                          const hasRelatedAccounts = await hasAccountsForCustomType(t.name);
                          if (hasRelatedAccounts) {
                            Alert.alert('无法删除', `“${t.name}”下已有账户，请先删除或转移账户后再试。`);
                            return;
                          }

                          Alert.alert(
                            '删除自定义类型',
                            `确认删除“${t.name}”吗？`,
                            [
                              { text: '取消', style: 'cancel' },
                              {
                                text: '删除',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await deleteFinanceAccountTypeByName(t.name);
                                    removeCustomAccountTypeOption(t.name);
                                    await loadCustomTypeOptions();
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
                            ],
                          );
                        } catch (e) {
                          console.warn('校验自定义类型是否可删除失败:', e);
                          Alert.alert('操作失败', '请稍后重试。');
                        }
                      })();
                    }}
                    style={({ pressed }) => [
                      styles.typeCard,
                      {
                        backgroundColor: surfaceLowest,
                        borderColor: active ? accentColor : outlineVariant,
                        shadowOpacity: active ? 0.08 : 0,
                      },
                      active && { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowRadius: 14, elevation: 3 },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View style={[styles.typeIconWrap, { backgroundColor: active ? `${accentColor}1A` : surfaceLow }]}>
                      <MaterialIcons name={icon} size={22} color={accentColor} />
                    </View>
                    <Text numberOfLines={1} style={[styles.typeLabel, { color: theme.text }]}>{t.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => {
                  setAccountType('custom');
                  setCustomAccountTypeDraft({
                    name: customTypeName,
                    isLiability: customIsLiability,
                    iconKey,
                  });
                  router.push('/add-account-type');
                }}
                style={({ pressed }) => [
                  styles.typeCard,
                  {
                    backgroundColor: surfaceLowest,
                    borderColor: accountType === 'custom' && !customTypeName ? accentColor : outlineVariant,
                  },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={[styles.typeIconWrap, { backgroundColor: `${accentColor}1A` }]}>
                  <MaterialIcons name="add" size={22} color={accentColor} />
                </View>
                <Text style={[styles.typeLabel, { color: theme.text }]}>自定义</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.section}>
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>账户名称</Text>
                <TextInput
                  value={accountName}
                  onChangeText={setAccountName}
                  placeholder="例如：招商银行储蓄卡"
                  placeholderTextColor={outlineVariant}
                  style={[styles.textInput, { color: theme.text, borderBottomColor: outlineVariant }]}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{isSelectedLiability ? '当前负债' : '当前余额'}</Text>
                <View style={[styles.balanceRow, { borderBottomColor: outlineVariant }]}> 
                  <Text style={[styles.currency, { color: accentColor }]}>¥</Text>
                  <TextInput
                    value={balance}
                    onChangeText={setBalance}
                    placeholder="0.00"
                    placeholderTextColor={outlineVariant}
                    keyboardType="default"
                    inputMode="decimal"
                    style={[styles.balanceInput, { color: theme.text }]}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>备注 (选填)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="添加备注信息..."
                  placeholderTextColor={outlineVariant}
                  multiline
                  style={[styles.notesInput, { backgroundColor: surfaceLow, color: theme.text }]}
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>个性化</Text>
            <View style={[styles.customCard, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
              <View style={styles.customBlock}>
                <Text style={[styles.customLabel, { color: theme.textSecondary }]}>账户图标</Text>
                <View style={styles.iconGrid}>
                  {FINANCE_ACCOUNT_ICON_OPTIONS.map((it) => {
                    const active = it.key === iconKey;
                    return (
                      <Pressable
                        key={it.key}
                        onPress={() => setIconKey(it.key)}
                        style={({ pressed }) => [
                          styles.iconCell,
                          pressed && { opacity: 0.9 },
                        ]}>
                        <View
                          style={[
                            styles.iconCellInner,
                            { backgroundColor: surfaceLow },
                            active && { backgroundColor: `${accentColor}1A` },
                          ]}>
                          <MaterialIcons name={it.icon} size={18} color={active ? accentColor : theme.text} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: isDark ? 'rgba(15,23,42,0.72)' : 'rgba(250,248,255,0.82)',
              borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
            },
          ]}>
          <View style={styles.footerInner}>
            <Pressable
              onPress={() => void onSave()}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.doneBtn,
                { backgroundColor: accentColor, opacity: !canSave ? 0.5 : pressed ? 0.92 : 1 },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}>
              <Text style={styles.doneText}>{saving ? '保存中...' : '完成'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    paddingTop: 92,
    paddingHorizontal: 18,
    gap: 24,
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  typeCard: {
    width: '31%',
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  typeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  textInput: {
    borderBottomWidth: 1,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '800',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  currency: {
    fontSize: 24,
    fontWeight: '900',
  },
  balanceInput: {
    flex: 1,
    padding: 0,
    fontSize: 32,
    fontWeight: '900',
  },
  notesInput: {
    borderRadius: 16,
    padding: 14,
    minHeight: 90,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  customCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    gap: 18,
  },
  customBlock: {
    gap: 10,
  },
  customLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  iconCell: {
    width: '20%',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  iconCellInner: {
    width: '100%',
    aspectRatio: 1,
    minWidth: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  footerInner: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  doneBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
  doneText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});

