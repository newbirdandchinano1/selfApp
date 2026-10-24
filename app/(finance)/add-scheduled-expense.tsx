import {
  FoldPopIn,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FinanceFoldSwitch } from '@/components/finance/finance-fold-switch';
import { Skeleton } from '@/components/ui';
import { Layout } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  findNextScheduledExpenseOccurrence,
  getScheduledFinanceExpenseById,
  newScheduledFinanceExpenseId,
  upsertScheduledFinanceExpense,
  type ScheduledExpenseRepeat,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import { scheduleRunScheduledFinanceExpenses } from '@/lib/finance-scheduled-expense-runner';
import { fetchFinanceCatalog } from '@/lib/finance-page-api';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
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

const PAGE_API_KEY = 'add-scheduled-expense';

const REPEAT_TABS: { key: ScheduledExpenseRepeat; label: string; hint: string }[] = [
  { key: 'daily', label: '每天', hint: '按天循环' },
  { key: 'weekly', label: '每周', hint: '选星期' },
  { key: 'monthly', label: '每月', hint: '选日期' },
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

const MONTH_QUICK_DAYS = [1, 5, 8, 15, 18, 24, 28];

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

function applyTemplate(template: string): {
  name: string;
  amountText: string;
  repeatOption: ScheduledExpenseRepeat;
  weeklyDays: number[];
  monthlyDays: number[];
  hour: number;
  minute: number;
} {
  switch (template) {
    case 'rent':
      return {
        name: '房租',
        amountText: '3000',
        repeatOption: 'monthly',
        weeklyDays: [1],
        monthlyDays: [1],
        hour: 9,
        minute: 0,
      };
    case 'membership':
      return {
        name: '会员订阅',
        amountText: '15',
        repeatOption: 'monthly',
        weeklyDays: [1],
        monthlyDays: [18],
        hour: 8,
        minute: 30,
      };
    case 'insurance':
      return {
        name: '保险',
        amountText: '200',
        repeatOption: 'monthly',
        weeklyDays: [1],
        monthlyDays: [1],
        hour: 10,
        minute: 0,
      };
    default:
      return {
        name: '',
        amountText: '',
        repeatOption: 'daily',
        weeklyDays: [1, 2, 3, 4, 5],
        monthlyDays: [1],
        hour: 8,
        minute: 0,
      };
  }
}

function Stepper({
  value,
  onMinus,
  onPlus,
  min,
  max,
  muted,
  ink,
  chipBg,
}: {
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  min: number;
  max: number;
  muted: string;
  ink: string;
  chipBg: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onMinus}
        disabled={value <= min}
        style={({ pressed }) => [
          styles.stepBtn,
          { backgroundColor: chipBg, opacity: value <= min ? 0.4 : pressed ? 0.8 : 1 },
        ]}>
        <Text style={{ color: muted, fontSize: 16, fontWeight: '600' }}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: ink }]}>{value}</Text>
      <Pressable
        onPress={onPlus}
        disabled={value >= max}
        style={({ pressed }) => [
          styles.stepBtn,
          { backgroundColor: chipBg, opacity: value >= max ? 0.4 : pressed ? 0.8 : 1 },
        ]}>
        <Text style={{ color: muted, fontSize: 16, fontWeight: '600' }}>＋</Text>
      </Pressable>
    </View>
  );
}

export default function AddScheduledExpenseScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; template?: string }>();
  const editId = pickParam(params.id)?.trim() ?? '';
  const templateKey = pickParam(params.template)?.trim() ?? '';
  const isEditMode = editId.length > 0;

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
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';
  const chipBg = isDark ? ff.paper2 : '#F3EDE1';
  const chipIdle = isDark ? ff.paper2 : '#F8F3E9';
  const chipBorder = isDark ? line : '#E5DBC9';

  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [loading, setLoading] = React.useState(isEditMode);
  const [saving, setSaving] = React.useState(false);
  const [savePop, setSavePop] = React.useState(false);

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
  const [monthPickerOpen, setMonthPickerOpen] = React.useState(false);

  React.useEffect(() => {
    void wrapLoad(async () => {
      try {
        const catalog = await fetchFinanceCatalog({ serverFallback: true });
        const accts = catalog.accounts;
        setAccounts(accts);
        if (!isEditMode && accts.length > 0) {
          setAccountId((prev) => prev || accts[0].id);
        }
        if (isEditMode) {
          const row = await getScheduledFinanceExpenseById(editId);
          if (!row) {
            toast.error('该定时支出可能已被删除。');
            router.back();
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
        } else if (templateKey) {
          const tpl = applyTemplate(templateKey);
          setName(tpl.name);
          setAmountText(tpl.amountText);
          setRepeatOption(tpl.repeatOption);
          setWeeklyDays(tpl.weeklyDays);
          setMonthlyDays(tpl.monthlyDays);
          const t = defaultScheduleTime();
          t.setHours(tpl.hour, tpl.minute, 0, 0);
          setScheduleTime(t);
        }
      } catch (e) {
        console.warn('Failed to load scheduled expense form:', e);
      } finally {
        setLoading(false);
      }
    });
  }, [editId, isEditMode, router, templateKey, wrapLoad]);

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const motionOn = foldAnimate && !loading;

  const previewItem = React.useMemo((): ScheduledFinanceExpense | null => {
    const amount = parseFloat(amountText.trim().replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      id: editId || 'preview',
      name: name.trim() || '定时支出',
      amount,
      accountId: accountId || 'preview',
      repeatOption,
      weeklyDays: repeatOption === 'weekly' ? weeklyDays : [],
      monthlyDays: repeatOption === 'monthly' ? monthlyDays : [],
      hour: scheduleTime.getHours(),
      minute: scheduleTime.getMinutes(),
      timesPerDay,
      includeInBudget,
      enabled,
      createdAt: new Date().toISOString(),
    };
  }, [
    accountId,
    amountText,
    editId,
    enabled,
    includeInBudget,
    monthlyDays,
    name,
    repeatOption,
    scheduleTime,
    timesPerDay,
    weeklyDays,
  ]);

  const nextPreview = React.useMemo(() => {
    if (!previewItem || !enabled) return null;
    return findNextScheduledExpenseOccurrence(previewItem);
  }, [enabled, previewItem]);

  const headerTitle = isEditMode ? '编辑定时支出' : '添加定时支出';
  const headerSub =
    repeatOption === 'daily'
      ? 'SCHEDULE · DAILY'
      : repeatOption === 'weekly'
        ? 'SCHEDULE · WEEKLY'
        : 'SCHEDULE · MONTHLY';

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
      toast.warn('请填写名称，例如：地铁通勤、Netflix 订阅、房租');
      return;
    }
    const amount = parseFloat(amountText.trim().replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.warn('请输入大于 0 的金额。');
      return;
    }
    if (!accountId) {
      toast.warn('需要指定用哪张卡/账户支付。');
      return;
    }
    if (repeatOption === 'weekly' && weeklyDays.length === 0) {
      toast.warn('每周模式下至少选择一天。');
      return;
    }
    if (repeatOption === 'monthly' && monthlyDays.length === 0) {
      toast.warn('每月模式下至少选择一天。');
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
      setSavePop(true);
      toast.success('已保存并重新计算下次执行');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
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

  const canSave = !saving && !loading;
  const saveBarBottom = 10 + Math.max(insets.bottom, 8);
  const accountTail =
    selectedAccount?.account_no && selectedAccount.account_no.length >= 4
      ? ` · ${selectedAccount.account_no.slice(-4)}`
      : '';

  const monthlyDayLabel =
    monthlyDays.length === 0
      ? '未选'
      : monthlyDays.length === 1
        ? `${monthlyDays[0]} 日`
        : `${monthlyDays.length} 天`;

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
        <View style={[styles.header, { paddingTop: insets.top, backgroundColor: headerScrim, borderBottomColor: line }]}>
          <View style={styles.headerInner}>
            <View style={[styles.foldIconBtn, { borderColor: line, backgroundColor: card }]}>
              <MaterialIcons name="arrow-back" size={16} color={ff.ink2} />
            </View>
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>{headerTitle}</Text>
              <Text style={[styles.headerSub, { color: subtle }]}>{headerSub}</Text>
            </View>
            <View style={{ width: 48 }} />
          </View>
        </View>
        <View style={styles.loadingWrap}>
          <Skeleton width="90%" height={120} borderRadius={18} />
          <Skeleton width="90%" height={160} borderRadius={18} style={{ marginTop: 10 }} />
        </View>
      </SafeAreaView>
    );
  }

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
            onPress={() => void handleSave()}
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

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: 82 + saveBarBottom,
              maxWidth: Layout.contentMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={11}>
            <View style={[styles.formCard, { backgroundColor: card, borderColor: line }]}>
              <View style={[styles.inputLine, { borderBottomColor: line }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>名称</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="例如：房租、会员"
                  placeholderTextColor={faint}
                  style={[styles.inputVal, { color: text }]}
                />
                <MaterialIcons name="edit" size={12} color={faint} />
              </View>
              <View style={[styles.inputLine, { borderBottomColor: line }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>金额</Text>
                <Text style={[styles.inputYuan, { color: ff.amberInk, fontFamily: ffFonts.mono }]}>¥</Text>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={faint}
                  style={[styles.inputVal, { color: text, fontFamily: ffFonts.mono }]}
                />
                <MaterialIcons name="edit" size={12} color={faint} />
              </View>
              <Pressable
                onPress={() => setAccountPickerOpen(true)}
                style={[styles.inputLine, { borderBottomColor: line }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>账户</Text>
                <Text
                  style={[styles.inputVal, { color: selectedAccount ? text : faint }]}
                  numberOfLines={1}>
                  {selectedAccount ? `${selectedAccount.name}${accountTail}` : '请选择'}
                </Text>
                <MaterialIcons name="chevron-right" size={16} color={faint} />
              </Pressable>
              <View style={[styles.formRow, { borderBottomColor: line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.formRowLabel, { color: text }]}>预扣本月预算</Text>
                  <Text style={[styles.formRowHint, { color: faint }]}>
                    开启后从可支配预算中预先扣除，自动记账不再计入已用
                  </Text>
                </View>
                <FinanceFoldSwitch
                  value={includeInBudget}
                  onValueChange={setIncludeInBudget}
                  accessibilityLabel="预扣本月预算"
                />
              </View>
              <View style={[styles.formRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.formRowLabel, { color: text }]}>启用定时记账</Text>
                <FinanceFoldSwitch value={enabled} onValueChange={setEnabled} accessibilityLabel="启用定时记账" />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={11}>
            <View style={[styles.formCard, { backgroundColor: card, borderColor: line }]}>
              <Text style={[styles.blockT, { color: faint }]}>重复规则</Text>
              <View style={styles.ruleCards}>
                {REPEAT_TABS.map((tab) => {
                  const active = tab.key === repeatOption;
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => setRepeatOption(tab.key)}
                      style={({ pressed }) => [
                        styles.ruleCard,
                        {
                          backgroundColor: active
                            ? isDark
                              ? ff.sage2
                              : '#E7EFE9'
                            : chipIdle,
                          borderColor: active ? (isDark ? ff.sage : '#A5C2B2') : chipBorder,
                        },
                        pressed && { opacity: 0.9 },
                      ]}>
                      <Text
                        style={[
                          styles.ruleLabel,
                          { color: active ? pine : subtle, fontWeight: active ? '750' : '600' },
                        ]}>
                        {tab.label}
                      </Text>
                      <Text style={[styles.ruleHint, { color: active ? '#6C8B7A' : faint }]}>{tab.hint}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {repeatOption === 'weekly' ? (
                <View style={styles.weekRow}>
                  {WEEKDAY_OPTIONS.map((opt) => {
                    const active = weeklyDays.includes(opt.value);
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => toggleWeeklyDay(opt.value)}
                        style={[
                          styles.weekChip,
                          {
                            backgroundColor: active ? pine : chipIdle,
                            borderColor: active ? pine : chipBorder,
                          },
                        ]}>
                        <Text style={{ color: active ? ff.onPine : subtle, fontSize: 12, fontWeight: '700' }}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {repeatOption === 'monthly' ? (
                <>
                  <View style={styles.monthHead}>
                    <Text style={[styles.monthHeadLab, { color: subtle }]}>每月日期</Text>
                    <Pressable
                      onPress={() => setMonthPickerOpen(true)}
                      style={[styles.tag, { backgroundColor: isDark ? ff.sage2 : '#E7EFE9' }]}>
                      <Text style={[styles.tagText, { color: pine }]}>{monthlyDayLabel}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.weekRow}>
                    {MONTH_QUICK_DAYS.map((day) => {
                      const active = monthlyDays.includes(day);
                      return (
                        <Pressable
                          key={day}
                          onPress={() => toggleMonthlyDay(day)}
                          style={[
                            styles.weekChip,
                            {
                              backgroundColor: active ? pine : chipIdle,
                              borderColor: active ? pine : chipBorder,
                            },
                          ]}>
                          <Text style={{ color: active ? ff.onPine : subtle, fontSize: 12, fontWeight: '700' }}>
                            {day}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable onPress={() => setMonthPickerOpen(true)} style={styles.moreDays}>
                    <Text style={{ color: subtle, fontSize: 12 }}>选择更多日期…</Text>
                  </Pressable>
                </>
              ) : null}

              <Pressable
                onPress={() => {
                  if (Platform.OS !== 'web') setTimePickerOpen(true);
                }}
                style={[styles.formRow, { borderBottomColor: line, marginTop: 4 }]}>
                <Text style={[styles.formRowLabel, { color: text }]}>记账时间</Text>
                <View style={styles.formRowRight}>
                  <MaterialIcons name="schedule" size={14} color={subtle} />
                  <Text style={[styles.formRowValue, { color: text, fontFamily: ffFonts.mono }]}>
                    {pad2(scheduleTime.getHours())}:{pad2(scheduleTime.getMinutes())}
                  </Text>
                </View>
              </Pressable>

              <View style={[styles.formRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.formRowLabel, { color: text }]}>每天记几笔</Text>
                <Stepper
                  value={timesPerDay}
                  min={1}
                  max={10}
                  onMinus={() => setTimesPerDay((v) => Math.max(1, v - 1))}
                  onPlus={() => setTimesPerDay((v) => Math.min(10, v + 1))}
                  muted={subtle}
                  ink="#3C4B42"
                  chipBg={chipBg}
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={11}>
            <View
              style={[
                styles.autoPreview,
                {
                  backgroundColor: isDark ? ff.sage2 : '#EDF3ED',
                  borderColor: isDark ? line : '#D8E5DA',
                },
              ]}>
              <MaterialIcons name="calendar-today" size={14} color="#527260" />
              <Text style={[styles.autoPreviewText, { color: '#527260' }]}>
                下次自动记账{' '}
                <Text style={{ fontFamily: ffFonts.mono, fontWeight: '700', color: '#365B48' }}>
                  {enabled && nextPreview
                    ? nextPreview.fullLabel
                    : enabled
                      ? '待计算'
                      : '已暂停'}
                </Text>
              </Text>
              {includeInBudget && enabled ? (
                <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(30,64,52,0.35)' : '#E7EFE9', marginLeft: 'auto' }]}>
                  <Text style={[styles.tagText, { color: pine }]}>预算已预扣</Text>
                </View>
              ) : null}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={11}>
            <View
              style={[
                styles.helper,
                {
                  backgroundColor: isDark ? 'rgba(216,154,77,0.1)' : '#F5EBD9',
                  borderColor: isDark ? line : '#EAD6B7',
                },
              ]}>
              <MaterialIcons name="lightbulb-outline" size={14} color={ff.amberInk} />
              <Text style={[styles.helperText, { color: isDark ? ff.amberInk : '#6F6452' }]}>
                定时支出会自动写入首页流水，并参与本月预算；删除规则不会删除已经生成的流水。
              </Text>
            </View>
          </FoldRiseIn>
        </ScrollView>

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
                borderColor: isDark ? line : '#E5DBC9',
                backgroundColor: isDark ? ff.paper2 : '#F7F2E7',
              },
              pressed && { opacity: 0.85 },
            ]}>
            <Text style={{ color: '#56645B', fontWeight: '700' }}>取消</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.savePrimary,
              {
                backgroundColor: pine,
                opacity: canSave ? 1 : 0.55,
                shadowColor: ff.shadow,
              },
              pressed && canSave && { opacity: 0.9 },
            ]}>
            <Text style={{ color: ff.onPine, fontWeight: '700', fontSize: 14 }}>
              {saving ? '保存中…' : '保存规则'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {Platform.OS === 'ios' && timePickerOpen ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setTimePickerOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTimePickerOpen(false)}>
            <Pressable style={[styles.modalSheet, { backgroundColor: card }]} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={scheduleTime}
                mode="time"
                display="spinner"
                onChange={(_, date) => {
                  if (date) setScheduleTime(date);
                }}
              />
              <Pressable
                onPress={() => setTimePickerOpen(false)}
                style={[styles.modalDone, { backgroundColor: pine }]}>
                <Text style={{ color: ff.onPine, fontWeight: '700' }}>确定</Text>
              </Pressable>
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

      <Modal
        transparent
        visible={accountPickerOpen}
        animationType="fade"
        onRequestClose={() => setAccountPickerOpen(false)}>
        <Pressable style={styles.modalBackdropCenter} onPress={() => setAccountPickerOpen(false)}>
          <View style={[styles.accountSheet, { backgroundColor: card, borderColor: line }]}>
            <Text style={[styles.sheetTitle, { color: text }]}>选择支付账户</Text>
            {accounts.length === 0 ? (
              <Text style={{ color: subtle }}>暂无账户，请先到资产页添加。</Text>
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
                    { borderBottomColor: line, opacity: pressed ? 0.75 : 1 },
                  ]}>
                  <Text style={{ color: text, flex: 1 }}>{acc.name}</Text>
                  {acc.id === accountId ? <MaterialIcons name="check" size={18} color={pine} /> : null}
                </Pressable>
              ))
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal
        transparent
        visible={monthPickerOpen}
        animationType="fade"
        onRequestClose={() => setMonthPickerOpen(false)}>
        <Pressable style={styles.modalBackdropCenter} onPress={() => setMonthPickerOpen(false)}>
          <View style={[styles.accountSheet, { backgroundColor: card, borderColor: line }]}>
            <Text style={[styles.sheetTitle, { color: text }]}>选择每月日期</Text>
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
                        backgroundColor: active ? pine : chipIdle,
                        borderColor: active ? pine : chipBorder,
                      },
                    ]}>
                    <Text style={{ color: active ? ff.onPine : subtle, fontSize: 12 }}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setMonthPickerOpen(false)}
              style={[styles.modalDone, { backgroundColor: pine, marginTop: 12 }]}>
              <Text style={{ color: ff.onPine, fontWeight: '700' }}>完成</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 60 },
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
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
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
  blockT: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '800',
    marginBottom: 6,
  },
  inputLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputLab: { width: 36, fontSize: 12, flexShrink: 0 },
  inputYuan: { fontSize: 13, fontWeight: '700' },
  inputVal: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  formRowLabel: { fontSize: 13, fontWeight: '600' },
  formRowHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  formRowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  formRowValue: { fontSize: 14, fontWeight: '700' },
  ruleCards: { flexDirection: 'row', gap: 5, marginBottom: 8 },
  ruleCard: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  ruleLabel: { fontSize: 13 },
  ruleHint: { fontSize: 10 },
  weekRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  weekChip: {
    flex: 1,
    height: 28,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  monthHeadLab: { fontSize: 13 },
  moreDays: { paddingVertical: 6, alignItems: 'center' },
  tag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontSize: 14, fontWeight: '700', minWidth: 14, textAlign: 'center' },
  autoPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  autoPreviewText: { fontSize: 12, flexShrink: 1 },
  helper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  helperText: { flex: 1, fontSize: 12, lineHeight: 18 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalBackdropCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalSheet: {
    padding: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  modalDone: {
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountSheet: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    maxHeight: '70%',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  monthChip: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
