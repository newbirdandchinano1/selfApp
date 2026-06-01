import { AppButton, AppCard, AppInput, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { syncHabitReminderNotification } from '@/lib/habit-reminder-notifications';
import { createHabit, getHabitById, updateHabit } from '@/lib/repositories/habits/habit';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import { type HabitKind, parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type CycleTab = '每周定期' | '每周N天' | '每月定期' | '每月N天';

const WORK_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const WEEKEND_DAYS = ['周六', '周日'];
const MONTH_FILTERS = ['上旬', '中旬', '下旬', '单号', '双号', '全选'];
const PRESET_MONTHLY_N_DAYS = [5, 10, 15, 20, 25];
const DEFAULT_QUANTIFY_UNIT = '次';

/** Habit kind accents — semantic (not global primary) */
const HABIT_KIND_BUILD = '#14b8a6';
const HABIT_KIND_BREAK_BORDER = '#ea580c';

function defaultReminderTime(): Date {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  return d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 打卡图标备选（emoji，便于跨端一致显示） */
const HABIT_ICON_CHOICES = [
  '🥛',
  '🏃',
  '🧘',
  '📖',
  '✍️',
  '💧',
  '🍎',
  '🥗',
  '😴',
  '🪥',
  '🚶',
  '🚴',
  '🏋️',
  '⏰',
  '🎯',
  '📝',
  '📅',
  '☀️',
  '🌙',
  '🍵',
  '☕',
  '🧴',
  '💊',
  '🎧',
  '🌿',
  '🧹',
  '💪',
  '🚿',
  '🍽️',
  '🦷',
  '📵',
  '🎵',
  '🧠',
  '❤️',
  '🏊',
  '🤸',
  '🚭',
  '🧊',
  '🛏️',
] as const;

/** 数据库尚无情境时的占位列表（与 habit-context 空库行为一致） */
const FALLBACK_CONTEXT_OPTIONS = ['起床', '晨间', '中午', '午间', '晚间', '睡前', '全天'];

function pickParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function NumberControl({
  label,
  value,
  onMinus,
  onPlus,
  displayValue,
  showOptional = false,
  textColor,
  mutedColor,
}: {
  label: string;
  value: number | null;
  onMinus: () => void;
  onPlus: () => void;
  displayValue?: string;
  showOptional?: boolean;
  textColor: string;
  mutedColor: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.numberRow}>
      <Text style={[styles.numberLabel, { color: textColor }]}>
        {label}
        {showOptional ? <Text style={[styles.numberLabelHint, { color: mutedColor }]}>（可选）</Text> : null}
      </Text>
      <View style={styles.numberActions}>
        <Pressable
          onPress={onMinus}
          style={({ pressed }) => [
            styles.numberBtn,
            { backgroundColor: colors.surfaceMuted },
            pressed && { opacity: 0.75 },
          ]}>
          <MaterialIcons name="remove" size={16} color={mutedColor} />
        </Pressable>
        <Text style={[styles.numberValue, { color: textColor }]}>{displayValue ?? String(value ?? 0)}</Text>
        <Pressable
          onPress={onPlus}
          style={({ pressed }) => [
            styles.numberBtn,
            { backgroundColor: colors.surfaceMuted },
            pressed && { opacity: 0.75 },
          ]}>
          <MaterialIcons name="add" size={16} color={mutedColor} />
        </Pressable>
      </View>
    </View>
  );
}

const PAGE_API_KEY = 'add-habit';

export default function AddHabitScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    name?: string;
    icon?: string;
    context?: string;
    habitId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, scheme, shadows } = useAppTheme();

  const isEditMode = pickParam(params.mode) === 'edit';
  const initialName = pickParam(params.name) ?? '';
  const initialIcon = pickParam(params.icon) ?? '🥛';
  const initialContext = pickParam(params.context);
  const habitId = pickParam(params.habitId);

  const [habitName, setHabitName] = React.useState(initialName);
  const [habitIcon, setHabitIcon] = React.useState(initialIcon);
  const [quantifyEnabled, setQuantifyEnabled] = React.useState(true);
  const [contextOpen, setContextOpen] = React.useState(true);
  const [quantifyOpen, setQuantifyOpen] = React.useState(true);
  const [cycleOpen, setCycleOpen] = React.useState(true);
  const [contextOptions, setContextOptions] = React.useState<string[]>(() => [...FALLBACK_CONTEXT_OPTIONS]);
  /** 新建时不预设「起床」，避免用户删光情境后仍被选中被注入列表 */
  const [selectedContext, setSelectedContext] = React.useState(() => initialContext?.trim() ?? '');
  const [activeTab, setActiveTab] = React.useState<CycleTab>('每周N天');
  const [selectedDays, setSelectedDays] = React.useState<string[]>(['周一', '周二', '周三', '周四', '周五']);
  const [weeklyNDays, setWeeklyNDays] = React.useState(1);
  const [monthlyNDays, setMonthlyNDays] = React.useState(5);
  const [monthlySpecificDays, setMonthlySpecificDays] = React.useState<number[]>(
    Array.from({ length: 10 }, (_, i) => i + 1)
  );
  const [activeMonthlyFilter, setActiveMonthlyFilter] = React.useState('上旬');
  const [unitInput, setUnitInput] = React.useState('');
  const [eachPlus, setEachPlus] = React.useState(1);
  const [dailyGoal, setDailyGoal] = React.useState<number | null>(null);
  const [habitNote, setHabitNote] = React.useState('');
  const [habitKind, setHabitKind] = React.useState<HabitKind>('build');
  const [iconPickerOpen, setIconPickerOpen] = React.useState(false);
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [reminderEnabled, setReminderEnabled] = React.useState(false);
  const [reminderTime, setReminderTime] = React.useState<Date>(() => defaultReminderTime());
  const [reminderTimePickerOpen, setReminderTimePickerOpen] = React.useState(false);

  const loadContexts = React.useCallback(async () => {
    await wrapLoad(async () => {
    try {
      const rows = await getHabitContexts();
      const names = rows.map((r) => r.name);
      const unique = Array.from(new Set(names));
      const nextOptions = unique.length > 0 ? unique : [...FALLBACK_CONTEXT_OPTIONS];
      setContextOptions(nextOptions);
      // 新建打卡：选中项必须在当前可选列表中（不要用界面默认「起床」污染已删除的分类）
      if (!isEditMode) {
        setSelectedContext((prev) => {
          const p = prev.trim();
          if (p && nextOptions.includes(p)) return p;
          return nextOptions[0] ?? '';
        });
      }
    } catch (err) {
      console.warn('加载情境分类失败', err);
    }
    });
  }, [isEditMode, wrapLoad]);

  useFocusEffect(
    React.useCallback(() => {
      void loadContexts();
    }, [loadContexts])
  );

  const toggleWeekDay = React.useCallback((day: string) => {
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }, []);

  const handleMonthlyFilter = React.useCallback((name: string) => {
    setActiveMonthlyFilter(name);
    const allDays = Array.from({ length: 31 }, (_, i) => i + 1);
    if (name === '上旬') setMonthlySpecificDays(allDays.slice(0, 10));
    else if (name === '中旬') setMonthlySpecificDays(allDays.slice(10, 20));
    else if (name === '下旬') setMonthlySpecificDays(allDays.slice(20, 31));
    else if (name === '单号') setMonthlySpecificDays(allDays.filter((d) => d % 2 !== 0));
    else if (name === '双号') setMonthlySpecificDays(allDays.filter((d) => d % 2 === 0));
    else if (name === '全选') setMonthlySpecificDays(allDays);
  }, []);

  const toggleMonthlyDay = React.useCallback((day: number) => {
    setActiveMonthlyFilter('');
    setMonthlySpecificDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    if (!isEditMode || !habitId) return;
    (async () => {
      try {
        const row = await getHabitById(habitId);
        if (cancelled) return;
        if (!row) return;
        setHabitName(row.name ?? '');
        setHabitIcon(row.icon ?? '🥛');
        const rawCtx = row.context?.trim() ?? '';
        setContextOptions((opts) => {
          if (rawCtx && !opts.includes(rawCtx)) return [...opts, rawCtx];
          return opts;
        });
        setSelectedContext(rawCtx);
        setHabitNote(row.note?.trim() ? row.note : '');
        setHabitKind(parseHabitKind(row.extra_data));
        if (row.extra_data) {
          try {
            const parsed = JSON.parse(row.extra_data) as any;
            const schedule = parsed?.schedule;
            const quantifyEnabledRaw = parsed?.quantifyEnabled;
            const quantify = parsed?.quantify;

            if (schedule?.activeTab && typeof schedule.activeTab === 'string') {
              const v = schedule.activeTab as CycleTab;
              setActiveTab(v);
            }
            if (Array.isArray(schedule?.selectedDays)) {
              const next = schedule.selectedDays.filter((d: unknown): d is string => typeof d === 'string');
              if (next.length > 0) setSelectedDays(next);
            }
            if (typeof schedule?.weeklyNDays === 'number') {
              setWeeklyNDays(Math.max(1, Math.min(7, Math.round(schedule.weeklyNDays))));
            }
            if (typeof schedule?.monthlyFilter === 'string') {
              setActiveMonthlyFilter(schedule.monthlyFilter);
            }
            if (Array.isArray(schedule?.monthlySpecificDays)) {
              const next = schedule.monthlySpecificDays.filter((d: unknown): d is number => typeof d === 'number');
              if (next.length > 0) setMonthlySpecificDays(next.slice(0, 31));
            }
            if (typeof schedule?.monthlyNDays === 'number') {
              setMonthlyNDays(Math.max(1, Math.min(31, Math.round(schedule.monthlyNDays))));
            }

            if (typeof quantifyEnabledRaw === 'boolean') setQuantifyEnabled(quantifyEnabledRaw);
            if (quantify && typeof quantify === 'object') {
              if (typeof quantify.unit === 'string') setUnitInput(quantify.unit);
              if (typeof quantify.eachPlus === 'number') setEachPlus(Math.max(1, Math.min(99, Math.round(quantify.eachPlus))));
              if (quantify.dailyGoal === null) setDailyGoal(null);
              else if (typeof quantify.dailyGoal === 'number') {
                const g = Math.round(quantify.dailyGoal);
                if (g <= 0) setDailyGoal(null);
                else setDailyGoal(Math.min(99, Math.max(1, g)));
              }
            }

            const rem = parsed?.reminder;
            if (rem && typeof rem === 'object' && !Array.isArray(rem) && rem.enabled === true) {
              setReminderEnabled(true);
              const hh = typeof rem.hour === 'number' ? rem.hour : 20;
              const mm = typeof rem.minute === 'number' ? rem.minute : 0;
              setReminderTime(() => {
                const d = defaultReminderTime();
                d.setHours(Math.max(0, Math.min(23, Math.round(hh))), Math.max(0, Math.min(59, Math.round(mm))), 0, 0);
                return d;
              });
            } else {
              setReminderEnabled(false);
            }
          } catch {
            // ignore extra_data parse errors
          }
        }
      } catch (err) {
        console.warn('加载习惯失败', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [habitId, isEditMode]);

  const deriveToneByContext = React.useCallback((context: string): string => {
    const map: Record<string, string> = {
      起床: '#EFE5E9',
      晨间: '#F4EBE3',
      中午: '#F4EBE3',
      午间: '#EFF5E1',
      晚间: '#EFE1DF',
      睡前: '#E1EFEB',
      全天: '#EFE1DF',
    };
    return map[context] ?? '#EFE1DF';
  }, []);

  const deriveTagByCycle = React.useCallback((): string => {
    if (activeTab === '每周N天') return `每周${weeklyNDays}天`;
    if (activeTab === '每月N天') return `每月${monthlyNDays}天`;
    if (activeTab === '每周定期') return '每周定期';
    if (activeTab === '每月定期') return '每月定期';
    return '每天';
  }, [activeTab, monthlyNDays, weeklyNDays]);

  const handleSave = React.useCallback(async () => {
    const name = habitName.trim();
    if (!name) {
      Alert.alert('提示', '请先输入习惯名称');
      return;
    }

    const context = selectedContext;
    const tag = deriveTagByCycle();
    const tone = deriveToneByContext(context);

    let existingExtra: Record<string, unknown> = {};
    if (isEditMode && habitId) {
      const prevRow = await getHabitById(habitId);
      if (prevRow?.extra_data) {
        try {
          const parsed = JSON.parse(prevRow.extra_data) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            existingExtra = parsed as Record<string, unknown>;
          }
        } catch {
          /* keep empty */
        }
      }
    }

    const unitResolved = unitInput.trim() || DEFAULT_QUANTIFY_UNIT;

    const reminderPayload = reminderEnabled
      ? { enabled: true as const, hour: reminderTime.getHours(), minute: reminderTime.getMinutes() }
      : { enabled: false as const };

    const extraData = JSON.stringify({
      ...existingExtra,
      habitKind,
      quantifyEnabled,
      quantify: quantifyEnabled
        ? {
            unit: unitResolved,
            eachPlus,
            dailyGoal: dailyGoal !== null && dailyGoal < 1 ? null : dailyGoal,
          }
        : null,
      schedule: {
        activeTab,
        selectedDays,
        weeklyNDays,
        monthlyFilter: activeMonthlyFilter,
        monthlySpecificDays,
        monthlyNDays,
      },
      reminder: reminderPayload,
    });

    const note = habitNote.trim() || null;

    let savedHabitId: string;
    if (isEditMode && habitId) {
      await updateHabit(habitId, {
        context,
        name,
        tag,
        icon: habitIcon,
        tone,
        note,
        extra_data: extraData,
      });
      savedHabitId = habitId;
    } else {
      const id = makeTimestampEntityId('hb_', 8);
      await createHabit({
        id,
        context,
        name,
        icon: habitIcon,
        tag,
        tone,
        note,
        extra_data: extraData,
      });
      savedHabitId = id;
    }

    const { permissionDenied } = await syncHabitReminderNotification({
      habitId: savedHabitId,
      enabled: reminderEnabled,
      hour: reminderTime.getHours(),
      minute: reminderTime.getMinutes(),
      title: name,
    });
    if (reminderEnabled && permissionDenied) {
      Alert.alert(
        '提示',
        '已保存习惯，但系统未授予通知权限，每日提醒将无法送达。可在系统设置中为本应用开启通知。'
      );
    }

    router.back();
  }, [
    activeMonthlyFilter,
    activeTab,
    dailyGoal,
    deriveTagByCycle,
    deriveToneByContext,
    habitIcon,
    habitId,
    habitKind,
    habitName,
    habitNote,
    eachPlus,
    isEditMode,
    monthlyNDays,
    monthlySpecificDays,
    quantifyEnabled,
    reminderEnabled,
    reminderTime,
    router,
    selectedContext,
    selectedDays,
    unitInput,
    weeklyNDays,
  ]);

  const renderSectionHeader = (
    icon: React.ComponentProps<typeof MaterialIcons>['name'],
    title: string,
    isOpen: boolean,
    onToggle: () => void
  ) => (
    <Pressable onPress={onToggle} style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.82 }]}>
      <View style={styles.sectionHeaderLeft}>
        <MaterialIcons name={icon} size={20} color={colors.text} />
        <Text style={[Typography.bodyStrong, styles.sectionHeaderTitle, { color: colors.text }]}>{title}</Text>
      </View>
      <View style={styles.sectionHeaderRight}>
        <Text style={[Typography.caption, styles.sectionHeaderHint, { color: colors.textSecondary }]}>
          {isOpen ? '收起' : '展开'}
        </Text>
        <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={16} color={colors.textSecondary} />
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title={isEditMode ? '编辑习惯' : '新建习惯'}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => void handleSave()}
            hitSlop={Layout.hitSlop}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
            <Text style={[Typography.bodyStrong, styles.headerActionText, { color: colors.primary }]} numberOfLines={1}>
              {isEditMode ? '保存' : '创建打卡'}
            </Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing['7xl'] + 72 + Math.max(insets.bottom, Spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.main}>
          <View style={styles.nameRow}>
            <Pressable
              onPress={() => setIconPickerOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
              <View
                style={[
                  styles.emojiWrap,
                  {
                    backgroundColor: colors.primaryMuted,
                    borderColor: colors.outline,
                  },
                ]}>
                <Text style={styles.emoji}>{habitIcon}</Text>
                <View style={[styles.emojiEdit, { backgroundColor: colors.accentCard }]}>
                  <MaterialIcons name="edit" size={10} color={colors.onAccent} />
                </View>
              </View>
            </Pressable>
            <AppInput
              value={habitName}
              onChangeText={setHabitName}
              placeholder="输入打卡项目名称..."
              containerStyle={styles.nameInputContainer}
              inputWrapStyle={styles.nameInputWrap}
              inputStyle={[
                Typography.body,
                styles.nameInputText,
                Platform.OS === 'android' ? { textAlignVertical: 'center', includeFontPadding: false } : null,
              ]}
            />
          </View>

          <AppInput
            label="备注"
            value={habitNote}
            onChangeText={setHabitNote}
            placeholder="补充说明、提醒事项…（可选）"
            multiline
            textAlignVertical="top"
            inputWrapStyle={styles.noteInputWrap}
            inputStyle={[Typography.body, styles.noteInputText]}
          />

          <View style={styles.kindBlock}>
            <Text style={[Typography.caption, styles.kindBlockLabel, { color: colors.textSecondary }]}>打卡类型</Text>
            <View style={styles.kindRow}>
              <Pressable
                onPress={() => setHabitKind('build')}
                style={({ pressed }) => [
                  styles.kindCard,
                  {
                    backgroundColor:
                      habitKind === 'build'
                        ? isDark
                          ? 'rgba(20,184,166,0.22)'
                          : 'rgba(20,184,166,0.12)'
                        : colors.surfaceSubtle,
                    borderColor: habitKind === 'build' ? HABIT_KIND_BUILD : colors.outline,
                    borderWidth: habitKind === 'build' ? 2 : StyleSheet.hairlineWidth,
                  },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={styles.kindCardEmoji}>✨</Text>
                <Text style={[Typography.bodyStrong, styles.kindCardTitle, { color: colors.text }]}>养成习惯</Text>
                <Text style={[Typography.label, styles.kindCardSub, { color: colors.textSecondary }]}>主动完成一件事</Text>
              </Pressable>
              <Pressable
                onPress={() => setHabitKind('break')}
                style={({ pressed }) => [
                  styles.kindCard,
                  {
                    backgroundColor:
                      habitKind === 'break'
                        ? isDark
                          ? 'rgba(251,146,60,0.2)'
                          : 'rgba(251,146,60,0.12)'
                        : colors.surfaceSubtle,
                    borderColor: habitKind === 'break' ? HABIT_KIND_BREAK_BORDER : colors.outline,
                    borderWidth: habitKind === 'break' ? 2 : StyleSheet.hairlineWidth,
                  },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={styles.kindCardEmoji}>🛡️</Text>
                <Text style={[Typography.bodyStrong, styles.kindCardTitle, { color: colors.text }]}>戒坏习惯</Text>
                <Text style={[Typography.label, styles.kindCardSub, { color: colors.textSecondary }]}>坚持不去做某事</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.dashedSplit}>
            <View style={[styles.dashedLine, { borderColor: colors.outline }]} />
            <Text style={[Typography.caption, styles.splitText, { color: colors.textSecondary }]}>下列为可选设置</Text>
            <View style={[styles.dashedLine, { borderColor: colors.outline }]} />
          </View>

          <View>
            {renderSectionHeader('schedule', '打卡情境', contextOpen, () => setContextOpen((v) => !v))}
            {contextOpen ? (
              <AppCard variant="default" padded={false} style={styles.sectionCardInner}>
                <View style={styles.contextGrid}>
                  {contextOptions.map((ctx) => {
                    const active = ctx === selectedContext;
                    return (
                      <Pressable
                        key={ctx}
                        onPress={() => setSelectedContext(ctx)}
                        style={[
                          styles.contextChip,
                          active
                            ? {
                                backgroundColor: colors.primary,
                                borderColor: colors.primary,
                              }
                            : {
                                backgroundColor: colors.surface,
                                borderColor: colors.outline,
                              },
                        ]}>
                        <Text
                          style={[
                            Typography.bodyStrong,
                            { color: active ? colors.onPrimary : colors.textSecondary, fontSize: 14 },
                          ]}>
                          {ctx}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </AppCard>
            ) : null}
          </View>

          <View>
            {renderSectionHeader('bar-chart', '量化记录', quantifyOpen, () => setQuantifyOpen((v) => !v))}
            {quantifyOpen ? (
              <AppCard variant="default" padded={false} style={styles.sectionCardInner}>
                <View style={styles.quantifyTop}>
                  <View>
                    <Text style={[Typography.bodyStrong, styles.quantifyTitle, { color: colors.text }]}>启用量化记录</Text>
                    <Text style={[Typography.caption, styles.quantifyHint, { color: colors.textSecondary }]}>
                      追踪喝水杯数、运动时长等数值
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setQuantifyEnabled((v) => !v)}
                    style={[
                      styles.switchTrack,
                      {
                        backgroundColor: quantifyEnabled ? colors.successSwitch : colors.capsule,
                      },
                    ]}>
                    <View style={[styles.switchDot, quantifyEnabled && styles.switchDotOn]} />
                  </Pressable>
                </View>

                {quantifyEnabled ? (
                  <View style={[styles.quantifyBody, { borderTopColor: colors.outline }]}>
                    <View style={[styles.unitRow, { borderBottomColor: colors.outline }]}>
                      <Text style={[Typography.bodyStrong, styles.numberLabel, { color: colors.text }]}>单位</Text>
                      <TextInput
                        value={unitInput}
                        onChangeText={setUnitInput}
                        placeholder="杯 / 分钟 / 页"
                        placeholderTextColor={colors.textMuted}
                        style={[
                          styles.unitInput,
                          Typography.body,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            color: colors.text,
                            borderRadius: Radius.sm,
                          },
                        ]}
                      />
                    </View>
                    <NumberControl
                      label="每次 +"
                      value={eachPlus}
                      onMinus={() => setEachPlus((v) => Math.max(1, v - 1))}
                      onPlus={() => setEachPlus((v) => Math.min(99, v + 1))}
                      textColor={colors.text}
                      mutedColor={colors.textSecondary}
                    />
                    <NumberControl
                      label="每日目标"
                      value={dailyGoal}
                      displayValue={dailyGoal === null ? '不限' : String(dailyGoal)}
                      onMinus={() =>
                        setDailyGoal((v) => {
                          if (v === null) return null;
                          if (v <= 1) return null;
                          return v - 1;
                        })
                      }
                      onPlus={() => setDailyGoal((v) => (v === null ? 1 : Math.min(99, v + 1)))}
                      showOptional
                      textColor={colors.text}
                      mutedColor={colors.textSecondary}
                    />
                  </View>
                ) : null}
              </AppCard>
            ) : null}
          </View>

          <View>
            {renderSectionHeader('notifications-active', '打卡提醒', reminderOpen, () => setReminderOpen((v) => !v))}
            {reminderOpen ? (
              <AppCard variant="default" padded={false} style={styles.sectionCardInner}>
                <View style={styles.quantifyTop}>
                  <View style={styles.reminderIntro}>
                    <Text style={[Typography.bodyStrong, styles.quantifyTitle, { color: colors.text }]}>每日提醒打卡</Text>
                    <Text style={[Typography.caption, styles.quantifyHint, { color: colors.textSecondary }]}>
                      在设定时间推送本地通知（可选）
                      {Platform.OS === 'web' ? '；网页版不会登记系统提醒' : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setReminderEnabled((v) => !v)}
                    style={[
                      styles.switchTrack,
                      {
                        backgroundColor: reminderEnabled ? colors.successSwitch : colors.capsule,
                      },
                    ]}>
                    <View style={[styles.switchDot, reminderEnabled && styles.switchDotOn]} />
                  </Pressable>
                </View>

                {reminderEnabled ? (
                  <View style={[styles.quantifyBody, { borderTopColor: colors.outline }]}>
                    <Pressable
                      onPress={() => {
                        if (Platform.OS === 'web') return;
                        setReminderTimePickerOpen(true);
                      }}
                      style={[
                        styles.reminderTimeRow,
                        { borderColor: colors.outline, backgroundColor: colors.surfaceSubtle },
                        Platform.OS === 'web' && { opacity: 0.65 },
                      ]}>
                      <Text style={[Typography.bodyStrong, styles.numberLabel, { color: colors.text }]}>提醒时间</Text>
                      <View style={styles.reminderTimeRight}>
                        <Text style={[Typography.title, styles.reminderTimeValue, { color: colors.text }]}>
                          {pad2(reminderTime.getHours())}:{pad2(reminderTime.getMinutes())}
                        </Text>
                        {Platform.OS !== 'web' ? (
                          <MaterialIcons name="schedule" size={20} color={colors.textSecondary} />
                        ) : null}
                      </View>
                    </Pressable>
                  </View>
                ) : null}
              </AppCard>
            ) : null}
          </View>

          <View>
            {renderSectionHeader('calendar-month', '循环模式', cycleOpen, () => setCycleOpen((v) => !v))}
            {cycleOpen ? (
              <AppCard variant="muted" padded={false} style={styles.cycleSectionOuter}>
                <View style={[styles.tabWrap, { backgroundColor: colors.capsule }]}>
                  {(['每周定期', '每周N天', '每月定期', '每月N天'] as CycleTab[]).map((tab) => {
                    const active = tab === activeTab;
                    return (
                      <Pressable
                        key={tab}
                        onPress={() => setActiveTab(tab)}
                        style={({ pressed }) => [
                          styles.tabItem,
                          active && [{ backgroundColor: colors.surface }, shadows.card],
                          pressed && { opacity: 0.9 },
                        ]}>
                        <Text
                          style={[
                            Typography.caption,
                            styles.tabText,
                            { color: active ? colors.text : colors.textSecondary },
                          ]}>
                          {tab}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.cycleBody, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
                  {activeTab === '每周定期' ? (
                    <>
                      <Text style={[Typography.caption, styles.cycleLabel, { color: colors.textSecondary }]}>工作日</Text>
                      <View style={styles.dayRow}>
                        {WORK_DAYS.map((day) => {
                          const selected = selectedDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              onPress={() => toggleWeekDay(day)}
                              style={[
                                styles.dayBtn,
                                selected
                                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                  : { backgroundColor: colors.input, borderColor: colors.outline },
                              ]}>
                              <Text
                                style={[
                                  Typography.caption,
                                  styles.dayBtnText,
                                  { color: selected ? colors.onPrimary : colors.textSecondary },
                                ]}>
                                {day}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text
                        style={[
                          Typography.caption,
                          styles.cycleLabel,
                          { color: colors.textSecondary, marginTop: Spacing.lg },
                        ]}>
                        周末
                      </Text>
                      <View style={styles.dayRow}>
                        {WEEKEND_DAYS.map((day) => {
                          const selected = selectedDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              onPress={() => toggleWeekDay(day)}
                              style={[
                                styles.dayBtn,
                                selected
                                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                  : { backgroundColor: colors.input, borderColor: colors.outline },
                              ]}>
                              <Text
                                style={[
                                  Typography.caption,
                                  styles.dayBtnText,
                                  { color: selected ? colors.onPrimary : colors.textSecondary },
                                ]}>
                                {day}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}

                  {activeTab === '每周N天' ? (
                    <>
                      <Text style={[Typography.body, styles.cycleHintText, { color: colors.textSecondary }]}>
                        每周完成任意{' '}
                        <Text style={[Typography.h3, styles.cycleHintStrong, { color: colors.text }]}>{weeklyNDays}</Text>{' '}
                        天即可
                      </Text>
                      <View style={styles.dayRow}>
                        {Array.from({ length: 7 }, (_, i) => i + 1).map((num) => (
                          <Pressable
                            key={num}
                            onPress={() => setWeeklyNDays(num)}
                            style={[
                              styles.smallCountBtn,
                              { borderColor: colors.outline },
                              weeklyNDays === num && {
                                backgroundColor: colors.primary,
                                borderColor: colors.primary,
                              },
                            ]}>
                            <Text
                              style={[
                                Typography.bodyStrong,
                                styles.smallCountText,
                                { color: weeklyNDays === num ? colors.onPrimary : colors.text },
                              ]}>
                              {num}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {activeTab === '每月定期' ? (
                    <>
                      <View style={styles.monthFilterGrid}>
                        {MONTH_FILTERS.map((filter) => {
                          const active = activeMonthlyFilter === filter;
                          return (
                            <Pressable
                              key={filter}
                              onPress={() => handleMonthlyFilter(filter)}
                              style={[
                                styles.monthFilterBtn,
                                active
                                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                  : { backgroundColor: colors.surface, borderColor: colors.outline },
                              ]}>
                              <Text
                                style={[
                                  Typography.bodyStrong,
                                  styles.monthFilterText,
                                  { color: active ? colors.onPrimary : colors.textSecondary },
                                ]}>
                                {filter}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.monthDaysGrid}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => {
                          const selected = monthlySpecificDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              onPress={() => toggleMonthlyDay(day)}
                              style={[
                                styles.monthDayBtn,
                                selected
                                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                  : { backgroundColor: colors.surface, borderColor: colors.outline },
                              ]}>
                              <Text
                                style={[
                                  Typography.bodyStrong,
                                  styles.monthDayText,
                                  { color: selected ? colors.onPrimary : colors.textSecondary },
                                ]}>
                                {day}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}

                  {activeTab === '每月N天' ? (
                    <>
                      <Text style={[Typography.body, styles.cycleHintText, { color: colors.textSecondary }]}>
                        每月完成任意{' '}
                        <Text style={[Typography.h3, styles.cycleHintStrong, { color: colors.text }]}>{monthlyNDays}</Text>{' '}
                        天即可
                      </Text>
                      <View style={styles.monthNWrap}>
                        {PRESET_MONTHLY_N_DAYS.map((n) => (
                          <Pressable
                            key={n}
                            onPress={() => setMonthlyNDays(n)}
                            style={[
                              styles.monthNPreset,
                              { borderColor: colors.outline },
                              monthlyNDays === n && {
                                backgroundColor: colors.primary,
                                borderColor: colors.primary,
                              },
                            ]}>
                            <Text
                              style={[
                                Typography.bodyStrong,
                                styles.monthNPresetText,
                                { color: monthlyNDays === n ? colors.onPrimary : colors.text },
                              ]}>
                              {n}d
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={styles.customMonthNRow}>
                        <Text style={[Typography.bodyStrong, styles.numberLabel, { color: colors.textSecondary }]}>
                          自定义天数
                        </Text>
                        <View style={styles.numberActions}>
                          <Pressable
                            onPress={() => setMonthlyNDays((v) => Math.max(1, v - 1))}
                            style={({ pressed }) => [
                              styles.numberBtn,
                              { backgroundColor: colors.surfaceMuted },
                              pressed && { opacity: 0.75 },
                            ]}>
                            <MaterialIcons name="remove" size={16} color={colors.textSecondary} />
                          </Pressable>
                          <Text style={[Typography.bodyStrong, styles.numberValue, { color: colors.text }]}>{monthlyNDays}</Text>
                          <Pressable
                            onPress={() => setMonthlyNDays((v) => Math.min(31, v + 1))}
                            style={({ pressed }) => [
                              styles.numberBtn,
                              { backgroundColor: colors.surfaceMuted },
                              pressed && { opacity: 0.75 },
                            ]}>
                            <MaterialIcons name="add" size={16} color={colors.textSecondary} />
                          </Pressable>
                        </View>
                      </View>
                    </>
                  ) : null}
                </View>
              </AppCard>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: Spacing['3xl'] + Math.max(insets.bottom, Spacing.md),
            backgroundColor: colors.headerScrim,
            borderTopColor: colors.outline,
          },
        ]}>
        <AppButton
          variant="primary"
          size="lg"
          fullWidth
          label={isEditMode ? '保存修改' : '创建打卡'}
          onPress={() => void handleSave()}
        />
      </View>

      <Modal visible={iconPickerOpen} transparent animationType="fade" onRequestClose={() => setIconPickerOpen(false)}>
        <View style={styles.iconModalRoot}>
          <Pressable style={[styles.iconModalBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setIconPickerOpen(false)} />
          <View style={[styles.iconModalCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            <Text style={[Typography.title, styles.iconModalTitle, { color: colors.text }]}>选择图标</Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.iconModalScroll}
              contentContainerStyle={styles.iconModalScrollContent}>
              <View style={styles.iconPickerGrid}>
                {HABIT_ICON_CHOICES.map((ico) => {
                  const selected = habitIcon === ico;
                  return (
                    <Pressable
                      key={ico}
                      onPress={() => {
                        setHabitIcon(ico);
                        setIconPickerOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.iconPickerCell,
                        {
                          backgroundColor: selected ? colors.primaryMuted : colors.surfaceMuted,
                          borderColor: selected ? colors.primary : 'transparent',
                        },
                        pressed && { opacity: 0.85 },
                      ]}>
                      <Text style={styles.iconPickerEmoji}>{ico}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <Pressable
              onPress={() => setIconPickerOpen(false)}
              style={({ pressed }) => [styles.iconModalCloseBtn, pressed && { opacity: 0.8 }]}>
              <Text style={[Typography.bodyStrong, styles.iconModalCloseText, { color: colors.textSecondary }]}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={reminderTimePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReminderTimePickerOpen(false)}>
        <View style={styles.iconModalRoot}>
          <Pressable
            style={[styles.iconModalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={() => setReminderTimePickerOpen(false)}
          />
          <View style={[styles.reminderPickerCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            <Text style={[Typography.title, styles.iconModalTitle, { color: colors.text }]}>选择提醒时间</Text>
            <DateTimePicker
              value={reminderTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'spinner'}
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
              locale={Platform.OS === 'ios' ? 'zh_CN' : undefined}
              onChange={(_, date) => {
                if (date) setReminderTime(date);
              }}
            />
            <View style={styles.reminderPickerActions}>
              <Pressable
                onPress={() => setReminderTimePickerOpen(false)}
                style={({ pressed }) => [
                  styles.reminderPickerBtnGhost,
                  { borderColor: colors.outline },
                  pressed && { opacity: 0.85 },
                ]}>
                <Text style={[Typography.bodyStrong, styles.reminderPickerBtnGhostText, { color: colors.textSecondary }]}>
                  取消
                </Text>
              </Pressable>
              <AppButton
                variant="primary"
                size="md"
                label="确定"
                onPress={() => setReminderTimePickerOpen(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing['2xl'],
  },
  headerActionText: { fontSize: 15 },
  main: { gap: Spacing['3xl'], maxWidth: Layout.contentMaxWidth, alignSelf: 'center', width: '100%' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  nameInputContainer: { flex: 1, marginBottom: 0 },
  nameInputWrap: {
    minHeight: 48,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
  },
  nameInputText: { fontSize: 15 },
  emojiWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.icon,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  emoji: { fontSize: 24 },
  emojiEdit: {
    position: 'absolute',
    right: -Spacing.xs,
    bottom: -Spacing.xs,
    width: 16,
    height: 16,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconModalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing['4xl'] },
  iconModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  iconModalCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['2xl'],
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.lg,
    maxHeight: '78%',
  },
  iconModalTitle: { marginBottom: Spacing.lg, textAlign: 'center' },
  iconModalScroll: { maxHeight: 360 },
  iconModalScrollContent: { paddingBottom: Spacing.sm },
  iconPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
    justifyContent: 'center',
  },
  iconPickerCell: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPickerEmoji: { fontSize: 26 },
  iconModalCloseBtn: { alignSelf: 'center', paddingVertical: Spacing.lg, paddingHorizontal: Spacing['3xl'], marginTop: Spacing.xs },
  iconModalCloseText: { fontSize: 14 },
  reminderTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.xl,
  },
  reminderTimeRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reminderTimeValue: { fontVariant: ['tabular-nums'] },
  reminderIntro: { flex: 1, paddingRight: Spacing.md },
  reminderPickerCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.xl,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  reminderPickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.xl,
  },
  reminderPickerBtnGhost: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing['3xl'],
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reminderPickerBtnGhostText: { fontSize: 15 },
  noteInputWrap: {
    minHeight: 96,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xl,
    alignItems: 'stretch',
  },
  noteInputText: {
    minHeight: 72,
    lineHeight: 22,
    fontSize: 15,
  },
  kindBlock: { gap: Spacing.md },
  kindBlockLabel: { paddingLeft: Spacing.xs },
  kindRow: { flexDirection: 'row', gap: Spacing.lg },
  kindCard: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  kindCardEmoji: { fontSize: 22 },
  kindCardTitle: { fontSize: 14 },
  kindCardSub: { textAlign: 'center', lineHeight: 15 },
  dashedSplit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dashedLine: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  splitText: { fontSize: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sectionHeaderTitle: { fontSize: 15 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  sectionHeaderHint: { fontSize: 13 },
  sectionCardInner: {
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  cycleSectionOuter: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  contextGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  contextChip: {
    width: '31%',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.md + 1,
    alignItems: 'center',
  },
  quantifyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quantifyTitle: { fontSize: 15 },
  quantifyHint: { marginTop: 2 },
  switchTrack: {
    width: 48,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 3,
    justifyContent: 'center',
  },
  switchDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  switchDotOn: { alignSelf: 'flex-end' },
  quantifyBody: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.sm, paddingTop: Spacing.md, gap: 2 },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  unitInput: {
    minWidth: 120,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 14,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
  },
  numberLabel: { fontSize: 14 },
  numberLabelHint: { fontSize: 12, fontWeight: '400' },
  numberActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing['2xl'] },
  numberBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberValue: { width: 38, textAlign: 'center', fontSize: 15 },
  tabWrap: {
    borderRadius: Radius.md,
    padding: Spacing.xs,
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  tabItem: { flex: 1, borderRadius: Radius.sm, paddingVertical: Spacing.md, alignItems: 'center' },
  tabText: { fontSize: 12 },
  cycleBody: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.xl, gap: Spacing.lg },
  cycleLabel: { fontSize: 13 },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  dayBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayBtnText: { fontSize: 13 },
  cycleHintText: { fontSize: 14 },
  cycleHintStrong: { fontSize: 16 },
  smallCountBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallCountText: { fontSize: 16 },
  monthFilterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  monthFilterBtn: {
    width: '31%',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  monthFilterText: { fontSize: 14 },
  monthDaysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  monthDayBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDayText: { fontSize: 14 },
  monthNWrap: { flexDirection: 'row', gap: Spacing.md },
  monthNPreset: {
    flex: 1,
    height: 42,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNPresetText: { fontSize: 14 },
  customMonthNRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.lg,
  },
});
