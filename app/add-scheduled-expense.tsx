import { AppButton, AppCard, AppInput, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  getScheduledFinanceExpenseById,
  newScheduledFinanceExpenseId,
  upsertScheduledFinanceExpense,
  type ScheduledExpenseRepeat,
} from '@/lib/finance-scheduled-expense';
import { scheduleRunScheduledFinanceExpenses } from '@/lib/finance-scheduled-expense-runner';
import { getFinanceAccountsWithBalance } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
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

const PAGE_API_KEY = 'add-scheduled-expense';

const REPEAT_TABS: { key: ScheduledExpenseRepeat; label: string }[] = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
];

const WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaultScheduleTime(): Date {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  return d;
}

function pickParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function NumberControl({
  label,
  value,
  onMinus,
  onPlus,
  min = 1,
  max = 10,
  textColor,
  mutedColor,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  min?: number;
  max?: number;
  textColor: string;
  mutedColor: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.numberRow}>
      <Text style={[Typography.bodyStrong, { color: textColor }]}>{label}</Text>
      <View style={styles.numberActions}>
        <Pressable
          onPress={onMinus}
          disabled={value <= min}
          style={({ pressed }) => [
            styles.numberBtn,
            { backgroundColor: colors.surfaceMuted, opacity: value <= min ? 0.45 : pressed ? 0.75 : 1 },
          ]}>
          <MaterialIcons name="remove" size={16} color={mutedColor} />
        </Pressable>
        <Text style={[styles.numberValue, { color: textColor }]}>{value}</Text>
        <Pressable
          onPress={onPlus}
          disabled={value >= max}
          style={({ pressed }) => [
            styles.numberBtn,
            { backgroundColor: colors.surfaceMuted, opacity: value >= max ? 0.45 : pressed ? 0.75 : 1 },
          ]}>
          <MaterialIcons name="add" size={16} color={mutedColor} />
        </Pressable>
      </View>
    </View>
  );
}

export default function AddScheduledExpenseScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = pickParam(params.id)?.trim() ?? '';
  const isEditMode = editId.length > 0;

  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();

  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [loading, setLoading] = React.useState(isEditMode);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState('');
  const [amountText, setAmountText] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [repeatOption, setRepeatOption] = React.useState<ScheduledExpenseRepeat>('daily');
  const [weeklyDays, setWeeklyDays] = React.useState<number[]>([1, 2, 3, 4, 5]);
  const [monthlyDays, setMonthlyDays] = React.useState<number[]>([1]);
  const [scheduleTime, setScheduleTime] = React.useState(defaultScheduleTime);
  const [timesPerDay, setTimesPerDay] = React.useState(1);
  const [includeInBudget, setIncludeInBudget] = React.useState(true);
  const [enabled, setEnabled] = React.useState(true);
  const [timePickerOpen, setTimePickerOpen] = React.useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = React.useState(false);

  React.useEffect(() => {
    void wrapLoad(async () => {
      try {
        const accts = await getFinanceAccountsWithBalance();
        setAccounts(accts);
        if (!isEditMode && accts.length > 0) {
          setAccountId((prev) => prev || accts[0].id);
        }
        if (isEditMode) {
          const row = await getScheduledFinanceExpenseById(editId);
          if (!row) {
            Alert.alert('未找到', '该定时支出可能已被删除。', [{ text: '返回', onPress: () => router.back() }]);
            return;
          }
          setName(row.name);
          setAmountText(row.amount.toFixed(2));
          setAccountId(row.accountId);
          setRepeatOption(row.repeatOption);
          setWeeklyDays(row.weeklyDays.length ? row.weeklyDays : [1]);
          setMonthlyDays(row.monthlyDays.length ? row.monthlyDays : [1]);
          const t = defaultScheduleTime();
          t.setHours(row.hour, row.minute, 0, 0);
          setScheduleTime(t);
          setTimesPerDay(row.timesPerDay);
          setIncludeInBudget(row.includeInBudget);
          setEnabled(row.enabled);
        }
      } catch (e) {
        console.warn('Failed to load scheduled expense form:', e);
      } finally {
        setLoading(false);
      }
    });
  }, [editId, isEditMode, router, wrapLoad]);

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

  const toggleWeeklyDay = React.useCallback((day: number) => {
    setWeeklyDays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length ? next : [day];
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }, []);

  const toggleMonthlyDay = React.useCallback((day: number) => {
    setMonthlyDays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length ? next : [day];
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }, []);

  const handleSave = React.useCallback(async () => {
    const title = name.trim();
    if (!title) {
      Alert.alert('请填写名称', '例如：地铁通勤、Netflix 订阅、房租');
      return;
    }
    const amount = parseFloat(amountText.trim().replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('金额无效', '请输入大于 0 的金额。');
      return;
    }
    if (!accountId) {
      Alert.alert('请选择账户', '需要指定用哪张卡/账户支付。');
      return;
    }
    if (repeatOption === 'weekly' && weeklyDays.length === 0) {
      Alert.alert('请选择星期', '每周模式下至少选择一天。');
      return;
    }
    if (repeatOption === 'monthly' && monthlyDays.length === 0) {
      Alert.alert('请选择日期', '每月模式下至少选择一天。');
      return;
    }

    setSaving(true);
    try {
      await upsertScheduledFinanceExpense({
        id: isEditMode ? editId : newScheduledFinanceExpenseId(),
        name: title,
        amount,
        accountId,
        repeatOption,
        weeklyDays: repeatOption === 'weekly' ? weeklyDays : [],
        monthlyDays: repeatOption === 'monthly' ? monthlyDays : [],
        hour: scheduleTime.getHours(),
        minute: scheduleTime.getMinutes(),
        timesPerDay,
        includeInBudget,
        enabled,
      });
      scheduleRunScheduledFinanceExpenses('save');
      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [
    accountId,
    amountText,
    editId,
    enabled,
    includeInBudget,
    isEditMode,
    monthlyDays,
    name,
    repeatOption,
    router,
    scheduleTime,
    timesPerDay,
    weeklyDays,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title={isEditMode ? '编辑定时支出' : '添加定时支出'} onBack={() => router.back()} />
        <View style={styles.loadingWrap}>
          <Text style={{ color: colors.textSecondary }}>加载中…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title={isEditMode ? '编辑定时支出' : '添加定时支出'} onBack={() => router.back()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <AppCard variant="default" padded style={styles.section}>
            <Text style={[Typography.kicker, { color: colors.textSecondary }]}>基本信息</Text>
            <AppInput label="支出名称" value={name} onChangeText={setName} placeholder="例如：地铁、房租" />
            <View style={styles.amountRow}>
              <Text style={[Typography.bodyStrong, styles.fieldLabel, { color: colors.text }]}>金额（每次）</Text>
              <View style={[styles.amountWrap, { borderColor: colors.outline }]}>
                <Text style={{ color: colors.textSecondary }}>¥</Text>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.amountInput, { color: colors.text }]}
                />
              </View>
            </View>

            <Pressable
              onPress={() => setAccountPickerOpen(true)}
              style={[styles.pickRow, { borderColor: colors.outline, backgroundColor: colors.surfaceSubtle }]}>
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>支付账户</Text>
              <View style={styles.pickRight}>
                <Text style={[Typography.body, { color: selectedAccount ? colors.text : colors.textSecondary }]}>
                  {selectedAccount?.name ?? '请选择'}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
              </View>
            </Pressable>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}>计入本月预算</Text>
                <Text style={[Typography.caption, { color: colors.textSecondary }]}>关闭后该笔自动记账不计入预算已用</Text>
              </View>
              <Switch
                value={includeInBudget}
                onValueChange={setIncludeInBudget}
                trackColor={{ false: colors.capsule, true: colors.successSwitch }}
              />
            </View>

            {isEditMode ? (
              <View style={styles.switchRow}>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}>启用定时记账</Text>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ false: colors.capsule, true: colors.successSwitch }}
                />
              </View>
            ) : null}
          </AppCard>

          <AppCard variant="muted" padded style={styles.section}>
            <Text style={[Typography.kicker, { color: colors.textSecondary }]}>重复周期</Text>
            <View style={[styles.tabWrap, { backgroundColor: colors.capsule }]}>
              {REPEAT_TABS.map((tab) => {
                const active = tab.key === repeatOption;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setRepeatOption(tab.key)}
                    style={({ pressed }) => [
                      styles.tabItem,
                      active && [{ backgroundColor: colors.surface }, shadows.card],
                      pressed && { opacity: 0.9 },
                    ]}>
                    <Text style={[Typography.bodyStrong, { color: active ? colors.text : colors.textSecondary }]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {repeatOption === 'weekly' ? (
              <View style={styles.dayGrid}>
                {WEEKDAY_OPTIONS.map((opt) => {
                  const active = weeklyDays.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => toggleWeeklyDay(opt.value)}
                      style={[
                        styles.dayChip,
                        {
                          borderColor: active ? colors.primary : colors.outline,
                          backgroundColor: active ? `${colors.primary}18` : colors.surface,
                        },
                      ]}>
                      <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '600' }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {repeatOption === 'monthly' ? (
              <View style={styles.monthGrid}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                  const active = monthlyDays.includes(day);
                  return (
                    <Pressable
                      key={day}
                      onPress={() => toggleMonthlyDay(day)}
                      style={[
                        styles.monthChip,
                        {
                          borderColor: active ? colors.primary : colors.outline,
                          backgroundColor: active ? `${colors.primary}18` : colors.surface,
                        },
                      ]}>
                      <Text style={{ color: active ? colors.primary : colors.textSecondary, fontSize: 13 }}>
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Pressable
              onPress={() => {
                if (Platform.OS !== 'web') setTimePickerOpen(true);
              }}
              style={[styles.pickRow, { borderColor: colors.outline, backgroundColor: colors.surfaceSubtle }]}>
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>记账时间</Text>
              <View style={styles.pickRight}>
                <Text style={[Typography.title, { color: colors.text }]}>
                  {pad2(scheduleTime.getHours())}:{pad2(scheduleTime.getMinutes())}
                </Text>
                <MaterialIcons name="schedule" size={20} color={colors.textSecondary} />
              </View>
            </Pressable>

            <NumberControl
              label="每天记几笔"
              value={timesPerDay}
              min={1}
              max={10}
              onMinus={() => setTimesPerDay((v) => Math.max(1, v - 1))}
              onPlus={() => setTimesPerDay((v) => Math.min(10, v + 1))}
              textColor={colors.text}
              mutedColor={colors.textSecondary}
            />
            <Text style={[Typography.caption, { color: colors.textSecondary, lineHeight: 18 }]}>
              到达设定时间后自动记 {timesPerDay} 笔，每笔金额为上方填写的金额。
            </Text>
          </AppCard>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: insets.bottom + Spacing.sm,
              backgroundColor: colors.background,
              borderTopColor: colors.outline,
            },
          ]}>
          <AppButton label={saving ? '保存中…' : '保存'} onPress={() => void handleSave()} disabled={saving} />
        </View>
      </KeyboardAvoidingView>

      {Platform.OS === 'ios' && timePickerOpen ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setTimePickerOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTimePickerOpen(false)}>
            <Pressable style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
              <DateTimePicker
                value={scheduleTime}
                mode="time"
                display="spinner"
                onChange={(_, date) => {
                  if (date) setScheduleTime(date);
                }}
              />
              <AppButton label="确定" onPress={() => setTimePickerOpen(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {Platform.OS === 'android' && timePickerOpen ? (
        <DateTimePicker
          value={scheduleTime}
          mode="time"
          display="default"
          onChange={(_, date) => {
            setTimePickerOpen(false);
            if (date) setScheduleTime(date);
          }}
        />
      ) : null}

      <Modal transparent visible={accountPickerOpen} animationType="fade" onRequestClose={() => setAccountPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAccountPickerOpen(false)}>
          <View style={[styles.accountSheet, { backgroundColor: colors.surface }]}>
            <Text style={[Typography.title, { color: colors.text, marginBottom: Spacing.sm }]}>选择支付账户</Text>
            {accounts.length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>暂无账户，请先到资产页添加。</Text>
            ) : (
              accounts.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => {
                    setAccountId(acc.id);
                    setAccountPickerOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { borderColor: colors.outline, opacity: pressed ? 0.75 : 1 },
                  ]}>
                  <Text style={{ color: colors.text, flex: 1 }}>{acc.name}</Text>
                  {acc.id === accountId ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                </Pressable>
              ))
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  section: { gap: Spacing.sm },
  fieldLabel: { marginBottom: 6 },
  amountRow: { gap: 6 },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    gap: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 12,
    marginTop: 4,
  },
  pickRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: 4,
  },
  tabWrap: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    padding: 4,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  monthChip: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  numberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  numberBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberValue: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    padding: Spacing.md,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  accountSheet: {
    marginHorizontal: Spacing.lg,
    marginVertical: '30%',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    maxHeight: '50%',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
