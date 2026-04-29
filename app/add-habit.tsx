import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createHabit, getHabitById, updateHabit } from '@/lib/repositories/habits/habit';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type CycleTab = '每周定期' | '每周N天' | '每月定期' | '每月N天';

const CONTEXTS = ['起床', '晨间', '中午', '午间', '晚间', '睡前', '全天'];
const WORK_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const WEEKEND_DAYS = ['周六', '周日'];
const MONTH_FILTERS = ['上旬', '中旬', '下旬', '单号', '双号', '全选'];
const PRESET_MONTHLY_N_DAYS = [5, 10, 15, 20, 25];

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
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const isEditMode = pickParam(params.mode) === 'edit';
  const initialName = pickParam(params.name) ?? '';
  const initialIcon = pickParam(params.icon) ?? '🥛';
  const initialContext = pickParam(params.context);
  const habitId = pickParam(params.habitId);

  const [habitName, setHabitName] = React.useState(initialName);
  const [habitIcon, setHabitIcon] = React.useState(initialIcon);
  const [quantifyEnabled, setQuantifyEnabled] = React.useState(true);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [quantifyOpen, setQuantifyOpen] = React.useState(true);
  const [cycleOpen, setCycleOpen] = React.useState(true);
  const [selectedContext, setSelectedContext] = React.useState(
    initialContext && CONTEXTS.includes(initialContext) ? initialContext : '起床'
  );
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

  const bg = isDark ? theme.background : '#f8fafc';
  const card = isDark ? 'rgba(15,23,42,0.72)' : '#fff';
  const softCard = isDark ? 'rgba(30,41,59,0.55)' : '#f8fafc';
  const textMain = theme.text;
  const textSub = theme.textSecondary;
  const border = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.22)';
  const yellow = '#FFD600';

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
        setSelectedContext(row.context ?? '起床');
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
              else if (typeof quantify.dailyGoal === 'number') setDailyGoal(Math.max(0, Math.min(99, Math.round(quantify.dailyGoal))));
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
    const extraData = JSON.stringify({
      quantifyEnabled,
      quantify: quantifyEnabled
        ? {
            unit: unitInput,
            eachPlus,
            dailyGoal,
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

    if (isEditMode && habitId) {
      await updateHabit(habitId, {
        context,
        name,
        tag,
        icon: habitIcon,
        tone,
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
    habitName,
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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { backgroundColor: card, borderColor: border }]}>
          <Pressable onPress={() => router.back()}>
            <Text style={[styles.headerAction, { color: textSub }]}>放弃</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: textMain }]}>{isEditMode ? '编辑打卡' : '新建打卡'}</Text>
          <Pressable onPress={handleSave}>
            <Text style={[styles.headerAction, { color: textMain, fontWeight: '700' }]}>
              {isEditMode ? '保存' : '创建打卡'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.main}>
          <View style={styles.nameRow}>
            <View style={[styles.emojiWrap, { backgroundColor: isDark ? 'rgba(20,184,166,0.18)' : 'rgba(20,184,166,0.12)', borderColor: border }]}>
              <Text style={styles.emoji}>{habitIcon}</Text>
              <View style={styles.emojiEdit}>
                <MaterialIcons name="edit" size={10} color="#fff" />
              </View>
            </View>
            <TextInput
              value={habitName}
              onChangeText={setHabitName}
              placeholder="输入打卡项目名称..."
              placeholderTextColor={textSub}
              style={[styles.nameInput, { backgroundColor: softCard, color: textMain, borderColor: border }]}
            />
          </View>

          <Pressable style={({ pressed }) => [styles.remindCard, { backgroundColor: softCard, borderColor: border }, pressed && { opacity: 0.85 }]}>
            <View style={styles.remindLeft}>
              <View style={[styles.remindPlus, { backgroundColor: yellow }]}>
                <MaterialIcons name="add" size={14} color="#111827" />
              </View>
              <Text style={[styles.remindText, { color: textMain }]}>添加提醒</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={textSub} />
          </Pressable>

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
                  {CONTEXTS.map((ctx) => {
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
                      onMinus={() => setDailyGoal((v) => (v === null ? 0 : Math.max(0, v - 1)))}
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
                                active
                                  ? filter === '全选'
                                    ? { backgroundColor: card, borderColor: yellow, borderWidth: 1.5 }
                                    : styles.smallCountBtnOn
                                  : { backgroundColor: card, borderColor: border },
                              ]}>
                              <Text style={[styles.monthFilterText, { color: active ? (filter === '全选' ? '#b45309' : '#fff') : textSub }]}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 14 },
  header: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
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
  nameInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: '500',
  },
  remindCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  remindLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remindPlus: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  remindText: { fontSize: 14, fontWeight: '600' },
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
