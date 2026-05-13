import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createHabit, getHabitById, updateHabit } from '@/lib/repositories/habits/habit';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import { type HabitKind, parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type CycleTab = '每周定期' | '每周N天' | '每月定期' | '每月N天';

const WORK_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const WEEKEND_DAYS = ['周六', '周日'];
const MONTH_FILTERS = ['上旬', '中旬', '下旬', '单号', '双号', '全选'];
const PRESET_MONTHLY_N_DAYS = [5, 10, 15, 20, 25];
const DEFAULT_QUANTIFY_UNIT = '次';

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
  return (
    <View style={styles.numberRow}>
      <Text style={[styles.numberLabel, { color: textColor }]}>
        {label}
        {showOptional ? <Text style={[styles.numberLabelHint, { color: mutedColor }]}>（可选）</Text> : null}
      </Text>
      <View style={styles.numberActions}>
        <Pressable onPress={onMinus} style={({ pressed }) => [styles.numberBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="remove" size={16} color={mutedColor} />
        </Pressable>
        <Text style={[styles.numberValue, { color: textColor }]}>{displayValue ?? String(value ?? 0)}</Text>
        <Pressable onPress={onPlus} style={({ pressed }) => [styles.numberBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="add" size={16} color={mutedColor} />
        </Pressable>
      </View>
    </View>
  );
}

export default function AddHabitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    name?: string;
    icon?: string;
    context?: string;
    habitId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const themeKey = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = Colors[themeKey];
  const isDark = themeKey === 'dark';
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

  const bg = isDark ? theme.background : '#f8fafc';
  const card = isDark ? 'rgba(15,23,42,0.72)' : '#fff';
  const softCard = isDark ? 'rgba(30,41,59,0.55)' : '#f8fafc';
  const textMain = theme.text;
  const textSub = theme.textSecondary;
  const border = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.22)';
  const yellow = '#FFD600';

  const loadContexts = React.useCallback(async () => {
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
  }, [isEditMode]);

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
    });

    const note = habitNote.trim() || null;

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
    } else {
      const id = `hb_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
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
        <MaterialIcons name={icon} size={20} color={textMain} />
        <Text style={[styles.sectionHeaderTitle, { color: textMain }]}>{title}</Text>
      </View>
      <View style={styles.sectionHeaderRight}>
        <Text style={[styles.sectionHeaderHint, { color: textSub }]}>{isOpen ? '收起' : '展开'}</Text>
        <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={16} color={textSub} />
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.headerFixed, { backgroundColor: card, borderBottomColor: border }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.8 }]}>
            <MaterialIcons name="arrow-back" size={22} color={textSub} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: textMain }]}>{isEditMode ? '编辑习惯' : '新建习惯'}</Text>
          <Pressable onPress={handleSave} hitSlop={10} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
            <Text style={[styles.headerAction, { color: textMain, fontWeight: '700' }]}>{isEditMode ? '保存' : '创建打卡'}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.main}>
          <View style={styles.nameRow}>
            <Pressable
              onPress={() => setIconPickerOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
              <View style={[styles.emojiWrap, { backgroundColor: isDark ? 'rgba(20,184,166,0.18)' : 'rgba(20,184,166,0.12)', borderColor: border }]}>
                <Text style={styles.emoji}>{habitIcon}</Text>
                <View style={styles.emojiEdit}>
                  <MaterialIcons name="edit" size={10} color="#fff" />
                </View>
              </View>
            </Pressable>
            <TextInput
              value={habitName}
              onChangeText={setHabitName}
              placeholder="输入打卡项目名称..."
              placeholderTextColor={textSub}
              style={[styles.nameInput, { backgroundColor: softCard, color: textMain, borderColor: border }]}
            />
          </View>

          <View style={styles.noteBlock}>
            <Text style={[styles.noteLabel, { color: textSub }]}>备注</Text>
            <TextInput
              value={habitNote}
              onChangeText={setHabitNote}
              placeholder="补充说明、提醒事项…（可选）"
              placeholderTextColor={textSub}
              multiline
              textAlignVertical="top"
              style={[styles.noteInput, { backgroundColor: softCard, color: textMain, borderColor: border }]}
            />
          </View>

          <View style={styles.kindBlock}>
            <Text style={[styles.kindBlockLabel, { color: textSub }]}>打卡类型</Text>
            <View style={styles.kindRow}>
              <Pressable
                onPress={() => setHabitKind('build')}
                style={({ pressed }) => [
                  styles.kindCard,
                  {
                    backgroundColor: habitKind === 'build' ? (isDark ? 'rgba(20,184,166,0.22)' : 'rgba(20,184,166,0.12)') : softCard,
                    borderColor: habitKind === 'build' ? '#14b8a6' : border,
                    borderWidth: habitKind === 'build' ? 2 : 1,
                  },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={styles.kindCardEmoji}>✨</Text>
                <Text style={[styles.kindCardTitle, { color: textMain }]}>养成习惯</Text>
                <Text style={[styles.kindCardSub, { color: textSub }]}>主动完成一件事</Text>
              </Pressable>
              <Pressable
                onPress={() => setHabitKind('break')}
                style={({ pressed }) => [
                  styles.kindCard,
                  {
                    backgroundColor: habitKind === 'break' ? (isDark ? 'rgba(251,146,60,0.2)' : 'rgba(251,146,60,0.12)') : softCard,
                    borderColor: habitKind === 'break' ? '#ea580c' : border,
                    borderWidth: habitKind === 'break' ? 2 : 1,
                  },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={styles.kindCardEmoji}>🛡️</Text>
                <Text style={[styles.kindCardTitle, { color: textMain }]}>戒坏习惯</Text>
                <Text style={[styles.kindCardSub, { color: textSub }]}>坚持不去做某事</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.dashedSplit}>
            <View style={[styles.dashedLine, { borderColor: border }]} />
            <Text style={[styles.splitText, { color: textSub }]}>下列为可选设置</Text>
            <View style={[styles.dashedLine, { borderColor: border }]} />
          </View>

          <View>
            {renderSectionHeader('schedule', '打卡情境', contextOpen, () => setContextOpen((v) => !v))}
            {contextOpen ? (
              <View style={[styles.sectionCard, { backgroundColor: card, borderColor: border }]}>
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
                            ? { backgroundColor: '#3A3A3C', borderColor: '#3A3A3C' }
                            : { backgroundColor: card, borderColor: border },
                        ]}>
                        <Text style={[styles.contextChipText, { color: active ? '#fff' : textSub }]}>{ctx}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>

          <View>
            {renderSectionHeader('bar-chart', '量化记录', quantifyOpen, () => setQuantifyOpen((v) => !v))}
            {quantifyOpen ? (
              <View style={[styles.sectionCard, { backgroundColor: card, borderColor: border }]}>
                <View style={styles.quantifyTop}>
                  <View>
                    <Text style={[styles.quantifyTitle, { color: textMain }]}>启用量化记录</Text>
                    <Text style={[styles.quantifyHint, { color: textSub }]}>追踪喝水杯数、运动时长等数值</Text>
                  </View>
                  <Pressable
                    onPress={() => setQuantifyEnabled((v) => !v)}
                    style={[
                      styles.switchTrack,
                      { backgroundColor: quantifyEnabled ? '#4CD964' : isDark ? '#334155' : '#e5e7eb' },
                    ]}>
                    <View style={[styles.switchDot, quantifyEnabled && styles.switchDotOn]} />
                  </Pressable>
                </View>

                {quantifyEnabled ? (
                  <View style={[styles.quantifyBody, { borderTopColor: border }]}>
                    <View style={[styles.unitRow, { borderBottomColor: border }]}>
                      <Text style={[styles.numberLabel, { color: textMain }]}>单位</Text>
                      <TextInput
                        value={unitInput}
                        onChangeText={setUnitInput}
                        placeholder="杯 / 分钟 / 页"
                        placeholderTextColor={textSub}
                        style={[styles.unitInput, { backgroundColor: softCard, color: textMain }]}
                      />
                    </View>
                    <NumberControl
                      label="每次 +"
                      value={eachPlus}
                      onMinus={() => setEachPlus((v) => Math.max(1, v - 1))}
                      onPlus={() => setEachPlus((v) => Math.min(99, v + 1))}
                      textColor={textMain}
                      mutedColor={textSub}
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
                      textColor={textMain}
                      mutedColor={textSub}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <View>
            {renderSectionHeader('calendar-month', '循环模式', cycleOpen, () => setCycleOpen((v) => !v))}
            {cycleOpen ? (
              <View style={[styles.sectionCard, { backgroundColor: softCard, borderColor: border }]}>
                <View style={[styles.tabWrap, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : '#e5e7eb' }]}>
                  {(['每周定期', '每周N天', '每月定期', '每月N天'] as CycleTab[]).map((tab) => {
                    const active = tab === activeTab;
                    return (
                      <Pressable
                        key={tab}
                        onPress={() => setActiveTab(tab)}
                        style={[styles.tabItem, active && { backgroundColor: card }]}>
                        <Text style={[styles.tabText, { color: active ? textMain : textSub }]}>{tab}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.cycleBody, { backgroundColor: card, borderColor: border }]}>
                  {activeTab === '每周定期' ? (
                    <>
                      <Text style={[styles.cycleLabel, { color: textSub }]}>工作日</Text>
                      <View style={styles.dayRow}>
                        {WORK_DAYS.map((day) => {
                          const selected = selectedDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              onPress={() => toggleWeekDay(day)}
                              style={[
                                styles.dayBtn,
                                selected ? styles.dayBtnOn : { backgroundColor: isDark ? '#1e293b' : '#f3f4f6' },
                              ]}>
                              <Text style={[styles.dayBtnText, { color: selected ? '#fff' : textSub }]}>{day}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={[styles.cycleLabel, { color: textSub, marginTop: 10 }]}>周末</Text>
                      <View style={styles.dayRow}>
                        {WEEKEND_DAYS.map((day) => {
                          const selected = selectedDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              onPress={() => toggleWeekDay(day)}
                              style={[
                                styles.dayBtn,
                                selected ? styles.dayBtnOn : { backgroundColor: isDark ? '#1e293b' : '#f3f4f6' },
                              ]}>
                              <Text style={[styles.dayBtnText, { color: selected ? '#fff' : textSub }]}>{day}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}

                  {activeTab === '每周N天' ? (
                    <>
                      <Text style={[styles.cycleHintText, { color: textSub }]}>
                        每周完成任意 <Text style={[styles.cycleHintStrong, { color: textMain }]}>{weeklyNDays}</Text> 天即可
                      </Text>
                      <View style={styles.dayRow}>
                        {Array.from({ length: 7 }, (_, i) => i + 1).map((num) => (
                          <Pressable
                            key={num}
                            onPress={() => setWeeklyNDays(num)}
                            style={[styles.smallCountBtn, weeklyNDays === num && styles.smallCountBtnOn]}>
                            <Text style={[styles.smallCountText, { color: weeklyNDays === num ? '#fff' : textMain }]}>{num}</Text>
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
                                active ? styles.smallCountBtnOn : { backgroundColor: card, borderColor: border },
                              ]}>
                              <Text style={[styles.monthFilterText, { color: active ? '#fff' : textSub }]}>
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
                                  ? styles.dayBtnOn
                                  : { backgroundColor: card, borderColor: border },
                              ]}>
                              <Text style={[styles.monthDayText, { color: selected ? '#fff' : textSub }]}>{day}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}

                  {activeTab === '每月N天' ? (
                    <>
                      <Text style={[styles.cycleHintText, { color: textSub }]}>
                        每月完成任意 <Text style={[styles.cycleHintStrong, { color: textMain }]}>{monthlyNDays}</Text> 天即可
                      </Text>
                      <View style={styles.monthNWrap}>
                        {PRESET_MONTHLY_N_DAYS.map((n) => (
                          <Pressable
                            key={n}
                            onPress={() => setMonthlyNDays(n)}
                            style={[styles.monthNPreset, monthlyNDays === n && styles.smallCountBtnOn]}>
                            <Text style={[styles.monthNPresetText, { color: monthlyNDays === n ? '#fff' : textMain }]}>{n}d</Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={styles.customMonthNRow}>
                        <Text style={[styles.numberLabel, { color: textSub }]}>自定义天数</Text>
                        <View style={styles.numberActions}>
                          <Pressable onPress={() => setMonthlyNDays((v) => Math.max(1, v - 1))} style={({ pressed }) => [styles.numberBtn, pressed && { opacity: 0.75 }]}>
                            <MaterialIcons name="remove" size={16} color={textSub} />
                          </Pressable>
                          <Text style={[styles.numberValue, { color: textMain }]}>{monthlyNDays}</Text>
                          <Pressable onPress={() => setMonthlyNDays((v) => Math.min(31, v + 1))} style={({ pressed }) => [styles.numberBtn, pressed && { opacity: 0.75 }]}>
                            <MaterialIcons name="add" size={16} color={textSub} />
                          </Pressable>
                        </View>
                      </View>
                    </>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: card,
            borderTopColor: border,
          },
        ]}>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.createBtn, { backgroundColor: yellow }, pressed && { opacity: 0.9 }]} >
          <Text style={styles.createBtnText}>{isEditMode ? '保存修改' : '创建打卡'}</Text>
        </Pressable>
      </View>

      <Modal visible={iconPickerOpen} transparent animationType="fade" onRequestClose={() => setIconPickerOpen(false)}>
        <View style={styles.iconModalRoot}>
          <Pressable style={styles.iconModalBackdrop} onPress={() => setIconPickerOpen(false)} />
          <View style={[styles.iconModalCard, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.iconModalTitle, { color: textMain }]}>选择图标</Text>
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
                          backgroundColor: selected
                            ? isDark
                              ? 'rgba(20,184,166,0.28)'
                              : 'rgba(20,184,166,0.2)'
                            : isDark
                              ? 'rgba(148,163,184,0.12)'
                              : 'rgba(148,163,184,0.1)',
                          borderColor: selected ? '#14b8a6' : 'transparent',
                        },
                        pressed && { opacity: 0.85 },
                      ]}>
                      <Text style={styles.iconPickerEmoji}>{ico}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <Pressable onPress={() => setIconPickerOpen(false)} style={({ pressed }) => [styles.iconModalCloseBtn, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.iconModalCloseText, { color: textSub }]}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 14 },
  headerFixed: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerAction: { fontSize: 15, fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  main: { gap: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emojiWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  emoji: { fontSize: 24 },
  emojiEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconModalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  iconModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.42)',
  },
  iconModalCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    maxHeight: '78%',
  },
  iconModalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  iconModalScroll: { maxHeight: 360 },
  iconModalScrollContent: { paddingBottom: 6 },
  iconPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  iconPickerCell: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPickerEmoji: { fontSize: 26 },
  iconModalCloseBtn: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, marginTop: 4 },
  iconModalCloseText: { fontSize: 14, fontWeight: '700' },
  nameInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: '500',
  },
  noteBlock: { gap: 6 },
  noteLabel: { fontSize: 13, fontWeight: '700', paddingLeft: 2 },
  noteInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '500',
    minHeight: 96,
    lineHeight: 22,
  },
  kindBlock: { gap: 8 },
  kindBlockLabel: { fontSize: 13, fontWeight: '700', paddingLeft: 2 },
  kindRow: { flexDirection: 'row', gap: 10 },
  kindCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
  },
  kindCardEmoji: { fontSize: 22 },
  kindCardTitle: { fontSize: 14, fontWeight: '800' },
  kindCardSub: { fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
  dashedSplit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dashedLine: { flex: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  splitText: { fontSize: 12, fontWeight: '500' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionHeaderTitle: { fontSize: 15, fontWeight: '800' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionHeaderHint: { fontSize: 13, fontWeight: '500' },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  contextGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contextChip: {
    width: '31%',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
    alignItems: 'center',
  },
  contextChipText: { fontSize: 14, fontWeight: '600' },
  quantifyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quantifyTitle: { fontSize: 15, fontWeight: '800' },
  quantifyHint: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  switchTrack: {
    width: 48,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 3,
    justifyContent: 'center',
  },
  switchDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  switchDotOn: { alignSelf: 'flex-end' },
  quantifyBody: { borderTopWidth: 1, marginTop: 6, paddingTop: 8, gap: 2 },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  unitInput: {
    minWidth: 120,
    textAlign: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  numberLabel: { fontSize: 14, fontWeight: '600' },
  numberLabelHint: { fontSize: 12, fontWeight: '400' },
  numberActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  numberBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(148,163,184,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberValue: { width: 38, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  tabWrap: {
    borderRadius: 12,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
  },
  tabItem: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  tabText: { fontSize: 12, fontWeight: '600' },
  cycleBody: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  cycleLabel: { fontSize: 13, fontWeight: '500' },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBtnOn: { backgroundColor: '#3A3A3C' },
  dayBtnText: { fontSize: 13, fontWeight: '600' },
  cycleHintText: { fontSize: 14, fontWeight: '500' },
  cycleHintStrong: { fontSize: 16, fontWeight: '800' },
  smallCountBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallCountBtnOn: { backgroundColor: '#3A3A3C', borderColor: '#3A3A3C' },
  smallCountText: { fontSize: 16, fontWeight: '700' },
  monthFilterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthFilterBtn: {
    width: '31%',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  monthFilterText: { fontSize: 14, fontWeight: '600' },
  monthDaysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthDayBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDayText: { fontSize: 14, fontWeight: '600' },
  monthNWrap: { flexDirection: 'row', gap: 8 },
  monthNPreset: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNPresetText: { fontSize: 14, fontWeight: '700' },
  customMonthNRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  createBtn: { borderRadius: 999, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  createBtnText: { color: '#111827', fontSize: 16, fontWeight: '900' },
});
